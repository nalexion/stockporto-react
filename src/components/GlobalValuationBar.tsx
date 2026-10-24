import React, { useState, useEffect } from 'react';
import { fetchPortfolios, fetchAllLots, fetchQuotes, fetchBnrRates } from '../lib/api';
import { Currency } from '../types';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { compareLotsChronologically, calculatePortfolioCashBalance } from '../lib/portfolioMath';

export default function GlobalValuationBar({ 
  refreshTrigger,
  currency,
  onCurrencyChange
}: { 
  refreshTrigger: number;
  currency?: Currency;
  onCurrencyChange?: (c: Currency) => void;
}) {
  const [totalValue, setTotalValue] = useState<number | null>(null);
  const [totalRealizedPnl, setTotalRealizedPnl] = useState<number>(0);
  const [netReturnValue, setNetReturnValue] = useState<number>(0);
  const [netReturnPercent, setNetReturnPercent] = useState<number>(0);
  const [localDisplayCurrency, setLocalDisplayCurrency] = useState<Currency>('RON');
  const [bnrRates, setBnrRates] = useState<{ EUR: number; USD: number; RON: number } | null>(null);
  const [error, setError] = useState(false);

  const displayCurrency = currency || localDisplayCurrency;
  
  useEffect(() => {
    async function load() {
      try {
        const [portfolios, lots, rates] = await Promise.all([
          fetchPortfolios(),
          fetchAllLots(),
          fetchBnrRates()
        ]);
        setBnrRates(rates);
        
        const toRon = (val: number, curr: Currency) => {
          if (curr === 'RON') return val;
          if (curr === 'EUR') return val * (rates.EUR || 4.97);
          if (curr === 'USD') return val * (rates.USD || 4.60);
          return val;
        };

        let totalRon = 0;
        let totalInvestedRon = 0;
        let totalRealizedRon = 0;
        let totalCostBasisRon = 0;
        
        const portMetrics = await Promise.all(
          portfolios.map(async (port) => {
            const portLots = lots.filter(l => l.portfolioId === port.id);
            const openTickers = Array.from(new Set(
              portLots
                .filter(l => l.status === 'OPEN' && !l.ticker.includes('CASH'))
                .map(l => l.ticker)
            ));
            
            let quotes: any = {};
            if (openTickers.length > 0) {
              quotes = await fetchQuotes(openTickers, port.currency);
            }
            
            let portInvested = 0;
            let portRealized = 0;
            let portOpenCostBasis = 0;
            let portOpenValue = 0;

            portLots.forEach(lot => {
              if (lot.transactionType === 'DEPOSIT') portInvested += lot.shares;
              else if (lot.transactionType === 'WITHDRAWAL') portInvested -= lot.shares;
            });

            const cashBalance = calculatePortfolioCashBalance(portLots);
            
            // Process positions with FIFO matching for realized P&L since inception
            const tickers = Array.from(new Set(portLots.map(l => l.ticker)));
            for (const t of tickers) {
              if (t === '$$CASH_TX' || t.includes('CASH')) continue;
              
              const tLots = [...portLots.filter(l => l.ticker === t)].sort(compareLotsChronologically);
              
              let qty = 0;
              const openBuys: { remaining: number; price: number; buyCommPerShare: number }[] = [];

              tLots.forEach(lot => {
                if (lot.transactionType === 'BUY') {
                  qty += lot.shares;
                  const buyCommPerShare = lot.shares > 0 ? (lot.commission || 0) / lot.shares : 0;
                  openBuys.push({ remaining: lot.shares, price: lot.buyPrice, buyCommPerShare });
                } else if (lot.transactionType === 'SPLIT') {
                  const ratio = lot.shares > 0 ? lot.shares : 1;
                  qty *= ratio;
                  openBuys.forEach(ob => {
                    ob.remaining *= ratio;
                    ob.price /= ratio;
                    ob.buyCommPerShare /= ratio;
                  });
                } else if (lot.transactionType === 'SELL') {
                  let sharesToSell = lot.shares;
                  let costOfSoldShares = 0;
                  let buyCommOfSold = 0;

                  while (sharesToSell > 0 && openBuys.length > 0) {
                    const oldest = openBuys[0];
                    const deduct = Math.min(sharesToSell, oldest.remaining);
                    costOfSoldShares += deduct * oldest.price;
                    buyCommOfSold += deduct * oldest.buyCommPerShare;
                    oldest.remaining -= deduct;

                    if (oldest.remaining <= 0) {
                      openBuys.shift();
                    }
                    sharesToSell -= deduct;
                  }

                  const proceeds = lot.shares * lot.buyPrice;
                  const commission = (lot.commission || 0) + buyCommOfSold;
                  const realizedGain = proceeds - costOfSoldShares - commission;
                  portRealized += realizedGain;

                  qty -= lot.shares;
                  if (qty < 0) qty = 0;
                } else if (lot.transactionType === 'DIVIDEND') {
                  const dividendAmount = lot.buyPrice;
                  const commission = lot.commission || 0;
                  portRealized += (dividendAmount - commission);
                  if (lot.repaidAdvance && lot.repaidAdvance > 0 && openBuys.length > 0) {
                    const totalOpen = openBuys.reduce((s, ob) => s + ob.remaining, 0);
                    if (totalOpen > 0) {
                      const advPerUnit = lot.repaidAdvance / totalOpen;
                      openBuys.forEach(ob => {
                        ob.price = Math.max(0, ob.price - advPerUnit);
                      });
                    }
                  }
                }
              });
              
              if (qty > 0.0001) {
                const currentPrice = quotes[t]?.convertedPrice || quotes[t]?.regularMarketPrice || (openBuys[0]?.price || 0);
                const posValue = qty * currentPrice;
                portOpenValue += posValue;

                let remainingCost = 0;
                openBuys.forEach(ob => {
                  remainingCost += ob.remaining * ob.price;
                });
                portOpenCostBasis += remainingCost;
              }
            }

            const portTotalValuation = cashBalance + portOpenValue;
            return {
              portTotalValuationRon: toRon(portTotalValuation, port.currency),
              portRealizedRon: toRon(portRealized, port.currency),
              portInvestedRon: toRon(portInvested, port.currency),
              portCostBasisRon: toRon(portOpenCostBasis + Math.max(0, cashBalance), port.currency),
            };
          })
        );

        portMetrics.forEach(m => {
          totalRon += m.portTotalValuationRon;
          totalRealizedRon += m.portRealizedRon;
          totalInvestedRon += m.portInvestedRon;
          totalCostBasisRon += m.portCostBasisRon;
        });

        // Calculate total Net return in percentage and monetary value
        const effectiveInvested = totalInvestedRon > 0 ? totalInvestedRon : totalCostBasisRon;
        const netReturnVal = totalRon - effectiveInvested;
        const netReturn = effectiveInvested > 0 
          ? (netReturnVal / effectiveInvested) * 100 
          : 0;
        
        setTotalValue(totalRon);
        setTotalRealizedPnl(totalRealizedRon);
        setNetReturnValue(netReturnVal);
        setNetReturnPercent(netReturn);
      } catch (err) {
        console.error("Failed to load global valuation", err);
        setError(true);
      }
    }
    load();
  }, [refreshTrigger]);
  
  if (error) return null;
  if (totalValue === null || !bnrRates) return (
    <div className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B] text-xs font-mono z-20 relative">
      <div className="max-w-7xl mx-auto px-6 h-11 flex items-center">
        Loading global valuation...
      </div>
    </div>
  ); 
  
  let displayValue = totalValue; // in RON
  let displayRealizedPnl = totalRealizedPnl; // in RON
  let displayNetReturnValue = netReturnValue; // in RON

  if (displayCurrency === 'EUR') {
    displayValue = totalValue / (bnrRates.EUR || 4.97);
    displayRealizedPnl = totalRealizedPnl / (bnrRates.EUR || 4.97);
    displayNetReturnValue = netReturnValue / (bnrRates.EUR || 4.97);
  } else if (displayCurrency === 'USD') {
    displayValue = totalValue / (bnrRates.USD || 4.60);
    displayRealizedPnl = totalRealizedPnl / (bnrRates.USD || 4.60);
    displayNetReturnValue = netReturnValue / (bnrRates.USD || 4.60);
  }
  
  const formatRounded = (val: number, cur: string) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(val));
  
  return (
    <div className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#0F172A] text-sm z-20 relative">
      <div className="max-w-7xl mx-auto px-6 py-2 flex flex-wrap justify-between items-center gap-3 min-h-[44px]">
        {/* Metrics Row: Global Valuation | Net Return | Realized P&L */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {/* Global Valuation */}
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-[#64748B] text-[11px] uppercase tracking-wider font-semibold">
              Global Valuation
            </span>
            <span className="text-sm sm:text-base font-mono tabular-nums font-bold tracking-tight text-[#0F172A]">
              {formatRounded(displayValue, displayCurrency)}
            </span>
          </div>

          <div className="h-3.5 w-px bg-[#CBD5E1] hidden md:block" />

          {/* Total Net Return % and Net Return Value */}
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-[#64748B] text-[11px] uppercase tracking-wider font-semibold">
              Net Return
            </span>
            <div className="flex items-center gap-1.5 font-mono tabular-nums">
              <span
                className={`text-xs sm:text-sm font-bold flex items-center gap-1 ${
                  netReturnPercent >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'
                }`}
              >
                {netReturnPercent >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {netReturnPercent >= 0 ? '+' : ''}
                {netReturnPercent.toFixed(2)}%
              </span>
              <span className="text-[#CBD5E1]">·</span>
              <span
                className={`text-xs sm:text-sm font-semibold tracking-tight ${
                  displayNetReturnValue >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'
                }`}
              >
                {displayNetReturnValue >= 0 ? '+' : ''}
                {formatRounded(displayNetReturnValue, displayCurrency)}
              </span>
            </div>
          </div>

          <div className="h-3.5 w-px bg-[#CBD5E1] hidden md:block" />

          {/* Realized P&L since inception */}
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span
              className="text-[#64748B] text-[11px] uppercase tracking-wider font-semibold"
              title="Total Realized Profit & Loss since inception across all portfolios"
            >
              Realized P&L
            </span>
            <span
              className={`text-xs sm:text-sm font-mono tabular-nums font-semibold tracking-tight ${
                displayRealizedPnl >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'
              }`}
            >
              {displayRealizedPnl >= 0 ? '+' : ''}
              {formatRounded(displayRealizedPnl, displayCurrency)}
            </span>
          </div>
        </div>

        {/* Right Controls: BNR Exchange Rates + Currency Segmented Selector */}
        <div className="flex items-center gap-3 sm:gap-4 ml-auto whitespace-nowrap">
          <span className="text-[#64748B] text-[11px] font-mono tabular-nums hidden xl:block">
            BNR: 1 EUR = {bnrRates.EUR.toFixed(4)} RON · 1 USD = {bnrRates.USD.toFixed(4)} RON
          </span>
          <div className="flex bg-[#F1F5F9] rounded-md p-0.5 border border-[#E2E8F0]">
            {(['RON', 'EUR', 'USD'] as Currency[]).map((c) => (
              <button
                key={c}
                onClick={() => {
                  if (onCurrencyChange) onCurrencyChange(c);
                  setLocalDisplayCurrency(c);
                }}
                className={`px-2.5 py-0.5 rounded-xs text-xs font-mono font-semibold transition-all whitespace-nowrap ${
                  displayCurrency === c
                    ? 'bg-[#1E40AF] text-white'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
