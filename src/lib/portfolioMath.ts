import { EnrichedTradeLot, TickerGroup, TradeLot } from '../types';
import { calculateCapitalGainsTax, isFidelisBond } from '../config/taxRules';

export interface PortfolioStats {
  tickerGroups: TickerGroup[];
  globalRealizedPnl: number;
  globalClosedCostBasis: number;
  globalEstimatedTaxRon: number;
  totalInvested: number;
  totalValue: number;
  harvestableLossRon: number;
  cashBalance: number;
}

const TX_TYPE_PRIORITY: Record<string, number> = {
  DEPOSIT: 1,
  BUY: 2,
  SPLIT: 3,
  DIVIDEND: 4,
  SELL: 5,
  WITHDRAWAL: 6,
};

/**
 * Deterministic chronological sort for trade lots.
 * If two transactions occur on the same calendar day, orders them safely:
 * DEPOSIT -> BUY -> SPLIT -> DIVIDEND (Coupon) -> SELL (Redemption) -> WITHDRAWAL.
 */
export function compareLotsChronologically(a: TradeLot, b: TradeLot): number {
  const dateA = (a.tradeDate || '').split('T')[0];
  const dateB = (b.tradeDate || '').split('T')[0];
  if (dateA !== dateB) {
    return dateA.localeCompare(dateB);
  }
  const prioA = TX_TYPE_PRIORITY[a.transactionType] ?? 99;
  const prioB = TX_TYPE_PRIORITY[b.transactionType] ?? 99;
  return prioA - prioB;
}

/**
 * Resolves the BNR FX rate for a given YYYY-MM-DD date string.
 * If the exact date falls on a weekend or bank holiday, walks backward up to 7 days
 * to find the most recent published BNR business-day rate before falling back.
 */
export function resolveFxRateForDate(
  fxHistory: Record<string, number>,
  dateStr: string,
  fallbackRate = 1
): number {
  if (!fxHistory) return fallbackRate;
  const cleanDate = (dateStr || '').split('T')[0];
  if (fxHistory[cleanDate] !== undefined && fxHistory[cleanDate] > 0) {
    return fxHistory[cleanDate];
  }

  // Walk backward up to 7 calendar days for weekend / holiday coverage
  const parsed = new Date(`${cleanDate}T00:00:00Z`);
  if (!isNaN(parsed.getTime())) {
    for (let i = 1; i <= 7; i++) {
      parsed.setUTCDate(parsed.getUTCDate() - 1);
      const prevStr = parsed.toISOString().split('T')[0];
      if (fxHistory[prevStr] !== undefined && fxHistory[prevStr] > 0) {
        return fxHistory[prevStr];
      }
    }
  }

  // Fallback to the closest available historical key <= cleanDate, or earliest key
  const sortedDates = Object.keys(fxHistory).sort();
  if (sortedDates.length > 0) {
    for (let i = sortedDates.length - 1; i >= 0; i--) {
      if (sortedDates[i] <= cleanDate && fxHistory[sortedDates[i]] > 0) {
        return fxHistory[sortedDates[i]];
      }
    }
    return fxHistory[sortedDates[0]] || fallbackRate;
  }

  return fallbackRate;
}

/**
 * Unified cash balance calculator across all portfolio views.
 */
export function calculatePortfolioCashBalance(lots: TradeLot[]): number {
  let cashBal = 0;
  const sorted = [...lots].sort(compareLotsChronologically);
  sorted.forEach(lot => {
    if (lot.transactionType === 'DEPOSIT') {
      cashBal += lot.shares;
    } else if (lot.transactionType === 'WITHDRAWAL') {
      cashBal -= lot.shares;
    } else if (lot.transactionType === 'BUY') {
      cashBal -= lot.shares * lot.buyPrice + (lot.commission || 0);
    } else if (lot.transactionType === 'SELL') {
      cashBal += lot.shares * lot.buyPrice - (lot.commission || 0);
    } else if (lot.transactionType === 'DIVIDEND') {
      cashBal += lot.buyPrice + (lot.repaidAdvance || 0) - (lot.commission || 0);
    }
  });
  return Math.round(cashBal * 100) / 100;
}

export function buildPortfolioGroups(
  customTaxRules: import('../config/taxRules').TaxConfig[] | undefined,
  lots: EnrichedTradeLot[],
  fxHistory: Record<string, number>,
  todayFxRate: number,
  cashBalance: number
): PortfolioStats {
  const roundedCash = Math.round(cashBalance * 100) / 100;
  const tickerGroups: TickerGroup[] = [];
  let globalRealizedPnl = 0;
  let globalClosedCostBasis = 0;
  let globalEstimatedTaxRon = 0;
  let totalInvested = 0;
  let totalValue = 0;
  let harvestableLossRon = 0;

  const allTickers = Array.from(new Set<string>(lots.map(l => l.ticker)));

  allTickers.forEach(ticker => {
    const tLots = [...lots.filter(l => l.ticker === ticker)].sort(compareLotsChronologically);
    const isTaxExemptBond = isFidelisBond(ticker);

    if (ticker === '$$CASH_TX') {
      let bal = 0;
      tLots.forEach(l => {
        if (l.transactionType === 'DEPOSIT') bal += l.shares;
        if (l.transactionType === 'WITHDRAWAL') bal -= l.shares;
      });

      totalInvested += Math.round(bal * 100) / 100;

      tickerGroups.push({
        ticker,
        lots: tLots,
        netQty: roundedCash,
        avgCost: 1,
        currentPrice: 1,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        realizedPnl: 0,
        status: Math.abs(roundedCash) > 0.01 ? 'OPEN' : 'CLOSED',
      });
    } else {
      let qty = 0;
      let realPnl = 0;

      const openBuys: {
        lot: EnrichedTradeLot;
        remaining: number;
        cost: number;
        fx: number;
        buyCommPerShare: number;
      }[] = [];

      tLots.forEach(lot => {
        const lotDate = lot.tradeDate.split('T')[0];
        const lotDateObj = new Date(lot.tradeDate);
        const lotFx = resolveFxRateForDate(fxHistory, lotDate, todayFxRate || 1);
        lot.buyFxRate = lotFx;

        if (lot.transactionType === 'BUY') {
          qty += lot.shares;
          lot.remainingShares = lot.shares;
          const buyCommPerShare = lot.shares > 0 ? (lot.commission || 0) / lot.shares : 0;
          openBuys.push({
            lot,
            remaining: lot.shares,
            cost: lot.buyPrice,
            fx: lotFx,
            buyCommPerShare,
          });
        } else if (lot.transactionType === 'SPLIT') {
          const ratio = lot.shares > 0 ? lot.shares : 1;
          qty *= ratio;
          openBuys.forEach(ob => {
            ob.remaining *= ratio;
            ob.cost /= ratio;
            ob.buyCommPerShare /= ratio;
            ob.lot.remainingShares = ob.remaining;
          });
        } else if (lot.transactionType === 'SELL') {
          let sharesToSell = lot.shares;

          let totalCostBaseNative = 0;
          let totalCostBaseRon = 0;
          let totalBuyCommNative = 0;
          let totalBuyCommRon = 0;
          let totalTaxRon = 0;
          let weightedHoldingDaysSum = 0;
          let totalDeductedShares = 0;

          while (sharesToSell > 0 && openBuys.length > 0) {
            const oldest = openBuys[0];
            const toDeduct = Math.min(sharesToSell, oldest.remaining);

            const chunkCostNative = toDeduct * oldest.cost;
            const chunkCostRon = toDeduct * oldest.cost * oldest.fx;
            const chunkBuyCommNative = toDeduct * oldest.buyCommPerShare;
            const chunkBuyCommRon = chunkBuyCommNative * oldest.fx;

            totalCostBaseNative += chunkCostNative;
            totalCostBaseRon += chunkCostRon;
            totalBuyCommNative += chunkBuyCommNative;
            totalBuyCommRon += chunkBuyCommRon;

            const buyDateObj = new Date(oldest.lot.tradeDate);
            const holdingDays = Math.max(
              0,
              Math.ceil((lotDateObj.getTime() - buyDateObj.getTime()) / (1000 * 3600 * 24))
            );
            weightedHoldingDaysSum += holdingDays * toDeduct;
            totalDeductedShares += toDeduct;

            const chunkProceedsRon = toDeduct * lot.buyPrice * lotFx;
            const chunkSellCommRon = (lot.commission || 0) * lotFx * (toDeduct / lot.shares);
            const chunkPnlRon = chunkProceedsRon - chunkCostRon - chunkBuyCommRon - chunkSellCommRon;

            if (chunkPnlRon > 0 && !isTaxExemptBond) {
              const tradeYear = parseInt(lotDateObj.getFullYear().toString(), 10);
              totalTaxRon += calculateCapitalGainsTax(
                tradeYear,
                lot.brokerType,
                holdingDays,
                chunkPnlRon,
                customTaxRules,
                ticker
              );
            }

            oldest.remaining -= toDeduct;
            oldest.lot.remainingShares = oldest.remaining;

            if (oldest.remaining <= 0) {
              openBuys.shift();
            }
            sharesToSell -= toDeduct;
          }

          lot.sellFxRate = lotFx;
          lot.estimatedTaxRon = totalTaxRon;
          lot.holdingAgeDays =
            totalDeductedShares > 0 ? Math.round(weightedHoldingDaysSum / totalDeductedShares) : 0;

          const proceedsNative = lot.shares * lot.buyPrice;
          const proceedsRon = proceedsNative * lotFx;
          const commNative = (lot.commission || 0) + totalBuyCommNative;
          const commRon = (lot.commission || 0) * lotFx + totalBuyCommRon;

          const pnlNative = proceedsNative - totalCostBaseNative - commNative;
          const pnlRon = proceedsRon - totalCostBaseRon - commRon;

          lot.realizedPnl = pnlNative;
          lot.realizedPnlRon = pnlRon;
          lot.realizedPnlPercentage =
            totalCostBaseNative > 0 ? (pnlNative / totalCostBaseNative) * 100 : 0;

          realPnl += pnlNative;
          globalRealizedPnl += pnlNative;
          globalClosedCostBasis += totalCostBaseNative;

          qty -= lot.shares;
          if (qty < 0) qty = 0;
        } else if (lot.transactionType === 'DIVIDEND') {
          lot.sellFxRate = lotFx;
          const proceedsNative = lot.buyPrice; // Bucket 2: True net profit
          const proceedsRon = proceedsNative * lotFx;
          const commNative = lot.commission || 0;
          const commRon = commNative * lotFx;

          const pnlNative = proceedsNative - commNative;
          const pnlRon = proceedsRon - commRon;

          lot.realizedPnl = pnlNative;
          lot.realizedPnlRon = pnlRon;
          lot.realizedPnlPercentage = 0;
          lot.estimatedTaxRon = 0;

          // Bucket 1 (Advance reimbursement on Year 1 Secondary Market BVB coupon):
          // Reimburses the upfront seller accrued interest included in the BUY dirty_price
          if (lot.repaidAdvance && lot.repaidAdvance > 0 && openBuys.length > 0) {
            const totalOpenShares = openBuys.reduce((sum, ob) => sum + ob.remaining, 0);
            if (totalOpenShares > 0) {
              const advancePerShare = lot.repaidAdvance / totalOpenShares;
              openBuys.forEach(ob => {
                ob.cost = Math.max(0, ob.cost - advancePerShare);
              });
            }
          }

          realPnl += pnlNative;
          globalRealizedPnl += pnlNative;
        }
      });

      let currentCostBaseNative = 0;
      openBuys.forEach(ob => {
        currentCostBaseNative += ob.remaining * ob.cost;
      });
      const avgCost = qty > 0 ? currentCostBaseNative / qty : 0;

      const group: TickerGroup = {
        ticker,
        lots: tLots,
        netQty: qty,
        avgCost,
        realizedPnl: realPnl,
        status: qty > 0.0001 ? 'OPEN' : 'CLOSED',
      };

      if (qty > 0) {
        const lotWithPrice = tLots.find(l => l.currentPrice !== undefined && l.currentPrice > 0);
        const currentPrice = lotWithPrice ? lotWithPrice.currentPrice! : avgCost;
        group.currentPrice = currentPrice;
        group.unrealizedPnl = (currentPrice - avgCost) * qty;
        group.unrealizedPnlPercent = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;

        totalValue += qty * currentPrice;

        openBuys.forEach(ob => {
          const buyDateObj = new Date(ob.lot.tradeDate);
          ob.lot.holdingAgeDays = Math.max(
            0,
            Math.ceil((new Date().getTime() - buyDateObj.getTime()) / (1000 * 3600 * 24))
          );

          const currentValNative = ob.remaining * currentPrice;
          const costValNative = ob.remaining * (ob.cost + ob.buyCommPerShare);
          const currentValRon = currentValNative * todayFxRate;
          const costValRon = costValNative * ob.fx;

          const pnlRon = currentValRon - costValRon;
          if (isTaxExemptBond) {
            ob.lot.estimatedTaxRon = 0;
          } else if (pnlRon > 0) {
            const currentYear = new Date().getFullYear();
            ob.lot.estimatedTaxRon = calculateCapitalGainsTax(
              currentYear,
              ob.lot.brokerType,
              ob.lot.holdingAgeDays || 0,
              pnlRon,
              customTaxRules,
              ticker
            );
            globalEstimatedTaxRon += ob.lot.estimatedTaxRon;
          } else {
            ob.lot.estimatedTaxRon = 0;
            if (ob.lot.brokerType === 'Non-Resident') {
              harvestableLossRon += Math.abs(pnlRon);
            }
          }
        });
      }

      tickerGroups.push(group);
    }
  });

  totalValue += roundedCash;

  return {
    tickerGroups,
    globalRealizedPnl,
    globalClosedCostBasis,
    globalEstimatedTaxRon,
    totalInvested: Math.round(totalInvested * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    harvestableLossRon,
    cashBalance: roundedCash,
  };
}
