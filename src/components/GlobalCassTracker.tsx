import React, { useState, useEffect } from 'react';
import { fetchPortfolios, fetchAllLots, fetchFxHistoricalRange } from '../lib/api';
import { TradeLot } from '../types';
import { Download } from 'lucide-react';
import { calculateCapitalGainsTax, isFidelisBond } from '../config/taxRules';
import { compareLotsChronologically, resolveFxRateForDate } from '../lib/portfolioMath';

export default function GlobalCassTracker({ refreshTrigger, customTaxRules }: { refreshTrigger: number, customTaxRules?: any[] }) {
  const [totalCassPnl, setTotalCassPnl] = useState<number | null>(null);
  const [taxReportData, setTaxReportData] = useState<any[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function calculateGlobalCass() {
      try {
        const [portfolios, lots] = await Promise.all([
          fetchPortfolios(),
          fetchAllLots()
        ]);

        const currentYear = new Date().getFullYear();
        let globalCassRon = 0;
        const reportData: any[] = [];

        // Group lots by portfolio
        const lotsByPortfolio: Record<string, TradeLot[]> = {};
        lots.forEach(l => {
          if (!lotsByPortfolio[l.portfolioId]) lotsByPortfolio[l.portfolioId] = [];
          lotsByPortfolio[l.portfolioId].push(l);
        });

        // Determine required currencies for FX history (any currency other than RON)
        const requiredCurrencies = new Set<string>();
        portfolios.forEach(p => {
          if (p.currency !== 'RON') {
            requiredCurrencies.add(p.currency);
          }
        });

        // Fetch FX history for each required currency
        let oldestDateStr = `${currentYear}-01-01`;
        if (lots.length > 0) {
          const oldestLot = [...lots].sort(compareLotsChronologically)[0];
          oldestDateStr = oldestLot.tradeDate.split('T')[0];
        }
        const todayStr = new Date().toISOString().split('T')[0];

        const fxHistories: Record<string, Record<string, number>> = {};
        await Promise.all(
          Array.from(requiredCurrencies).map(async (currency) => {
            const history = await fetchFxHistoricalRange(currency, oldestDateStr, todayStr);
            fxHistories[currency] = history;
          })
        );

        // Process each portfolio's lots
        for (const p of portfolios) {
          const pLots = lotsByPortfolio[p.id] || [];
          const fxHistory = p.currency === 'RON' ? {} : (fxHistories[p.currency] || {});
          const fallbackFx = p.currency === 'EUR' ? 4.97 : p.currency === 'USD' ? 4.60 : 1;
          
          const tickers = Array.from(new Set(pLots.map(l => l.ticker)));
          
          for (const ticker of tickers) {
            // Skip cash movements and Romanian Government Bonds (Fidelis), which are 100% CASS & Tax Exempt under Art. 93 Codul Fiscal
            if (ticker === '$$CASH_TX' || isFidelisBond(ticker)) continue;
            
            const tLots = [...pLots.filter(l => l.ticker === ticker)].sort(compareLotsChronologically);
            
            const openBuys: { lot: TradeLot, remaining: number, cost: number, fx: number, buyCommPerShare: number }[] = [];
            
            for (const lot of tLots) {
              const lotDate = lot.tradeDate.split('T')[0];
              const lotFx = p.currency === 'RON' ? 1 : resolveFxRateForDate(fxHistory, lotDate, fallbackFx);
              
              if (lot.transactionType === 'BUY') {
                const buyCommPerShare = lot.shares > 0 ? (lot.commission || 0) / lot.shares : 0;
                openBuys.push({ lot, remaining: lot.shares, cost: lot.buyPrice, fx: lotFx, buyCommPerShare });
              } else if (lot.transactionType === 'SPLIT') {
                const ratio = lot.shares > 0 ? lot.shares : 1;
                openBuys.forEach(ob => {
                  ob.remaining *= ratio;
                  ob.cost /= ratio;
                  ob.buyCommPerShare /= ratio;
                });
              } else if (lot.transactionType === 'SELL') {
                let sharesToSell = lot.shares;
                let totalCostBaseRon = 0;
                let totalBuyCommRon = 0;
                let totalTaxRon = 0;
                const lotDateObj = new Date(lot.tradeDate);
                
                while(sharesToSell > 0 && openBuys.length > 0) {
                  const oldest = openBuys[0];
                  const toDeduct = Math.min(sharesToSell, oldest.remaining);
                  
                  const chunkCostRon = toDeduct * oldest.cost * oldest.fx;
                  const chunkBuyCommRon = toDeduct * oldest.buyCommPerShare * oldest.fx;
                  totalCostBaseRon += chunkCostRon;
                  totalBuyCommRon += chunkBuyCommRon;
                  
                  const buyDateObj = new Date(oldest.lot.tradeDate);
                  const holdingDays = Math.max(0, Math.ceil((lotDateObj.getTime() - buyDateObj.getTime()) / (1000 * 3600 * 24)));
                  
                  const chunkProceedsRon = toDeduct * lot.buyPrice * lotFx;
                  const chunkSellCommRon = (lot.commission || 0) * lotFx * (toDeduct / lot.shares);
                  const chunkPnlRon = chunkProceedsRon - chunkCostRon - chunkBuyCommRon - chunkSellCommRon;
                  
                  if (chunkPnlRon > 0) {
                    const tradeYear = parseInt(lotDate.substring(0, 4), 10);
                    totalTaxRon += calculateCapitalGainsTax(tradeYear, lot.brokerType, holdingDays, chunkPnlRon, customTaxRules);
                  }
                  
                  oldest.remaining -= toDeduct;
                  if (oldest.remaining <= 0) {
                    openBuys.shift();
                  }
                  sharesToSell -= toDeduct;
                }
                
                const proceedsNative = lot.shares * lot.buyPrice;
                const proceedsRon = proceedsNative * lotFx;
                const commNative = lot.commission || 0;
                const commRon = commNative * lotFx + totalBuyCommRon;
                
                const pnlRon = proceedsRon - totalCostBaseRon - commRon;
                const netPnlRon = pnlRon - totalTaxRon;
                
                const tradeD = new Date(lot.tradeDate);
                if (tradeD.getFullYear() === currentYear) {
                  globalCassRon += netPnlRon;
                  reportData.push({
                    ticker,
                    type: 'SELL',
                    date: lotDate,
                    proceedsRon: proceedsRon,
                    costBaseRon: totalCostBaseRon + commRon,
                    grossPnlRon: pnlRon,
                    taxWithheldRon: totalTaxRon,
                    netPnlRon: netPnlRon,
                    brokerType: lot.brokerType
                  });
                }
              } else if (lot.transactionType === 'DIVIDEND') {
                const proceedsNative = lot.buyPrice;
                const proceedsRon = proceedsNative * lotFx;
                const commNative = lot.commission || 0;
                const commRon = commNative * lotFx;
                
                const pnlRon = proceedsRon - commRon;
                const netPnlRon = pnlRon;
                
                const tradeD = new Date(lot.tradeDate);
                if (tradeD.getFullYear() === currentYear) {
                  globalCassRon += netPnlRon;
                  reportData.push({
                    ticker,
                    type: 'DIVIDEND',
                    date: lotDate,
                    proceedsRon: proceedsRon,
                    costBaseRon: commRon,
                    grossPnlRon: pnlRon,
                    taxWithheldRon: 0,
                    netPnlRon: netPnlRon,
                    brokerType: lot.brokerType
                  });
                }
              }
            }
          }
        }

        setTotalCassPnl(globalCassRon);
        setTaxReportData(reportData);
      } catch (err) {
        console.error("Failed to load CASS data", err);
        setError(true);
      }
    }
    calculateGlobalCass();
  }, [refreshTrigger, customTaxRules]);

  if (error || totalCassPnl === null) return null;

  const currentYear = new Date().getFullYear();
  const T6 = 24300;
  const T12 = 48600;
  const T24 = 97200;
  
  let cassObligation = 0;
  let cassNextThreshold = 0;
  let cassHeadroom = 0;
  let cassProgress = 0;
  
  if (totalCassPnl >= T24) {
    cassObligation = T24 * 0.10;
    cassProgress = 100;
  } else if (totalCassPnl >= T12) {
    cassObligation = T12 * 0.10;
    cassNextThreshold = T24;
    cassHeadroom = T24 - totalCassPnl;
    cassProgress = (totalCassPnl / T24) * 100;
  } else if (totalCassPnl >= T6) {
    cassObligation = T6 * 0.10;
    cassNextThreshold = T12;
    cassHeadroom = T12 - totalCassPnl;
    cassProgress = (totalCassPnl / T24) * 100;
  } else {
    cassNextThreshold = T6;
    cassHeadroom = T6 - Math.max(0, totalCassPnl);
    cassProgress = (Math.max(0, totalCassPnl) / T24) * 100;
  }

  const handleExportTaxReport = () => {
    const sanitizeCsvCell = (val: string) => {
      const str = String(val || '');
      const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
      return safe.includes(',') || safe.includes('"') ? `"${safe.replace(/"/g, '""')}"` : safe;
    };

    const headers = ['Ticker', 'Type', 'Date', 'Proceeds (RON)', 'Cost Basis (RON)', 'Gross PnL (RON)', 'Tax (RON)', 'Net PnL (RON)', 'Broker'];
    const csvRows = [headers.join(',')];
    
    let sumProceeds = 0;
    let sumCost = 0;
    let sumGross = 0;
    let sumTax = 0;
    let sumNet = 0;

    taxReportData.forEach(row => {
      sumProceeds += row.proceedsRon;
      sumCost += row.costBaseRon;
      sumGross += row.grossPnlRon;
      sumTax += row.taxWithheldRon;
      sumNet += row.netPnlRon;

      csvRows.push([
        sanitizeCsvCell(row.ticker),
        sanitizeCsvCell(row.type),
        sanitizeCsvCell(row.date),
        row.proceedsRon.toFixed(2),
        row.costBaseRon.toFixed(2),
        row.grossPnlRon.toFixed(2),
        row.taxWithheldRon.toFixed(2),
        row.netPnlRon.toFixed(2),
        sanitizeCsvCell(row.brokerType)
      ].join(','));
    });

    csvRows.push('');
    csvRows.push(['TOTALS', '', '', sumProceeds.toFixed(2), sumCost.toFixed(2), sumGross.toFixed(2), sumTax.toFixed(2), sumNet.toFixed(2), ''].join(','));
    csvRows.push(['CASS OBLIGATION', '', '', '', '', '', '', cassObligation.toFixed(2), ''].join(','));

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `Declaratia_Unica_${currentYear}.csv`);
    a.click();
  };

  return (
    <div className="bg-white border-b border-[#E2E8F0]">
      <div className="max-w-7xl mx-auto px-6 py-3.5">
        <div className="bg-[#F8FAFC] px-5 py-4 rounded-xl border border-[#E2E8F0] relative group">
          <div className="flex flex-col md:flex-row justify-between md:items-center gap-3 mb-2.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-xs uppercase tracking-wider font-display font-bold text-[#0F172A]">
                Global CASS Compliance (<span className="font-mono tabular-nums">{currentYear}</span>)
              </h3>
              <span className="text-[#CBD5E1] hidden sm:inline">·</span>
              <p className="text-xs text-[#64748B]">
                Realized Net Gains: <span className="font-mono tabular-nums font-semibold text-[#0F172A]">{Math.round(Math.max(0, totalCassPnl)).toLocaleString('en-US')} RON</span>
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-left md:text-right flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-xs font-semibold text-[#0F172A] whitespace-nowrap">
                  Obligation: <span className={`font-mono tabular-nums ${cassObligation > 0 ? "text-[#E11D48]" : "text-[#059669]"}`}>{Math.round(cassObligation).toLocaleString('en-US')} RON</span>
                </p>
                {cassNextThreshold > 0 && (
                  <>
                    <span className="text-[#CBD5E1]">·</span>
                    <p className="text-xs text-[#64748B] whitespace-nowrap">
                      Headroom: <span className="font-mono tabular-nums font-semibold text-[#334155]">{Math.round(cassHeadroom).toLocaleString('en-US')} RON</span>
                    </p>
                  </>
                )}
              </div>
              <button 
                onClick={handleExportTaxReport}
                className="text-xs font-medium bg-white border border-[#E2E8F0] text-[#334155] px-3 py-1 rounded-md flex items-center gap-1.5 hover:bg-[#F8FAFC] hover:border-[#1E40AF] hover:text-[#1E40AF] transition-colors whitespace-nowrap shrink-0"
                title="Export Declaratia Unica (CSV)"
              >
                <Download size={13} />
                Export Tax CSV
              </button>
            </div>
          </div>
          <div className="w-full bg-[#E2E8F0] rounded-xs h-2 relative mt-2">
            <div
              className={`h-2 rounded-xs transition-all duration-300 relative z-10 ${
                cassObligation > 0 ? 'bg-[#D97706]' : 'bg-[#1E40AF]'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, cassProgress))}%` }}
            ></div>
            {/* Markers */}
            <div className="absolute top-0 w-full h-full z-0">
              <div className="absolute h-3.5 w-0.5 bg-[#94A3B8] -top-0.5" style={{ left: `${(T6 / T24) * 100}%` }} title={`6 Wages (${T6.toLocaleString('en-US')} RON)`}></div>
              <div className="absolute h-3.5 w-0.5 bg-[#94A3B8] -top-0.5" style={{ left: `${(T12 / T24) * 100}%` }} title={`12 Wages (${T12.toLocaleString('en-US')} RON)`}></div>
              <div className="absolute h-3.5 w-0.5 bg-[#94A3B8] -top-0.5" style={{ left: '100%' }} title={`24 Wages (${T24.toLocaleString('en-US')} RON)`}></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
