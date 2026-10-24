import React, { useState, useEffect } from 'react';
import { Portfolio, TradeLot, Currency } from '../types';
import { fetchPortfolios, createPortfolio, fetchAllLots, fetchQuotes, fetchBnrRates } from '../lib/api';
import { Plus, TrendingUp, TrendingDown } from 'lucide-react';
import PortfolioAllocation from './PortfolioAllocation';
import PortfolioMarketSegments from './PortfolioMarketSegments';
import { compareLotsChronologically, calculatePortfolioCashBalance } from '../lib/portfolioMath';

export default function PortfolioList({ 
  onSelect, 
  onPortfolioAdded, 
  globalCurrency = 'RON' 
}: { 
  onSelect: (p: Portfolio) => void, 
  onPortfolioAdded: () => void,
  globalCurrency?: Currency
}) {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'EUR' | 'RON'>('USD');
  const [portfolioStats, setPortfolioStats] = useState<Record<string, { totalValue: number, changePercent: number, invested: number }>>({});
  const [loadingStats, setLoadingStats] = useState(true);
  const [allLots, setAllLots] = useState<TradeLot[]>([]);
  const [bnrRates, setBnrRates] = useState<{ EUR: number, USD: number, RON: number } | null>(null);
  const [quotesMap, setQuotesMap] = useState<Record<string, any>>({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoadingStats(true);
    try {
      const [ports, lots, rates] = await Promise.all([
        fetchPortfolios(),
        fetchAllLots(),
        fetchBnrRates()
      ]);
      setPortfolios(ports);
      setAllLots(lots);
      setBnrRates(rates);
      
      // Calculate stats per portfolio in parallel
      const stats: Record<string, { totalValue: number, changePercent: number, invested: number }> = {};
      const accumulatedQuotes: Record<string, any> = {};

      await Promise.all(
        ports.map(async (p) => {
          const pLots = lots.filter(l => l.portfolioId === p.id);
          const pOpenTickers = Array.from(new Set(
            pLots.filter(l => l.status === 'OPEN' && !l.ticker.includes('CASH')).map(l => l.ticker)
          ));
          
          let pQuotes: Record<string, any> = {};
          if (pOpenTickers.length > 0) {
            pQuotes = await fetchQuotes(pOpenTickers, p.currency);
            Object.assign(accumulatedQuotes, pQuotes);
          }
          
          let totalInvested = 0;
          pLots.forEach(lot => {
            if (lot.transactionType === 'DEPOSIT') totalInvested += lot.shares;
            else if (lot.transactionType === 'WITHDRAWAL') totalInvested -= lot.shares;
          });
          
          const cashBalance = calculatePortfolioCashBalance(pLots);
          let totalValue = cashBalance;
          
          const tickers = Array.from(new Set(pLots.map(l => l.ticker)));
          for (const t of tickers) {
            if (t.includes('CASH')) continue;
            
            const tLots = [...pLots.filter(l => l.ticker === t)].sort(compareLotsChronologically);
            
            let qty = 0;
            let avgCost = 0;
            tLots.forEach(lot => {
              if (lot.transactionType === 'BUY') {
                const newQty = qty + lot.shares;
                if (newQty > 0) {
                  avgCost = ((qty * avgCost) + (lot.shares * lot.buyPrice)) / newQty;
                }
                qty = newQty;
              } else if (lot.transactionType === 'SPLIT') {
                qty *= lot.shares;
                avgCost /= lot.shares;
              } else if (lot.transactionType === 'SELL') {
                qty -= lot.shares;
                if (qty <= 0) {
                  avgCost = 0;
                  qty = 0;
                }
              } else if (lot.transactionType === 'DIVIDEND' && lot.repaidAdvance && lot.repaidAdvance > 0 && qty > 0) {
                avgCost = Math.max(0, avgCost - lot.repaidAdvance / qty);
              }
            });
            
            if (qty > 0) {
              const currentPrice = pQuotes[t]?.convertedPrice || pQuotes[t]?.regularMarketPrice || avgCost;
              totalValue += qty * currentPrice;
            }
          }
          
          const pnl = totalValue - totalInvested;
          const changePercent = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
          
          stats[p.id] = { totalValue, changePercent, invested: totalInvested };
        })
      );
      
      setQuotesMap(accumulatedQuotes);
      setPortfolioStats(stats);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingStats(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const newPort = await createPortfolio(name, currency);
    setPortfolios([...portfolios, newPort]);
    setPortfolioStats({ ...portfolioStats, [newPort.id]: { totalValue: 0, changePercent: 0, invested: 0 } });
    setIsCreating(false);
    setName('');
    onPortfolioAdded();
  }

  const formatRoundedCurrency = (val: number, curr: string) => {
    const rounded = Math.round(val);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: curr,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(rounded);
  };

  return (
    <div className="max-w-7xl mx-auto px-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-[#0F172A]">Portfolios</h1>
          <p className="text-xs text-[#64748B] mt-0.5">Institutional multi-currency capital accounts</p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="bg-[#1E40AF] hover:bg-[#1E3A8A] text-white px-4 py-2 rounded-lg flex items-center gap-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
        >
          <Plus size={16} /> New Portfolio
        </button>
      </div>

      {isCreating && (
        <form onSubmit={handleCreate} className="bg-white p-5 rounded-xl border border-[#E2E8F0] mb-6 flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs uppercase tracking-wider font-semibold text-[#64748B] mb-1.5">Portfolio Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-[#CBD5E1] rounded-lg px-3.5 py-2 text-sm text-[#0F172A] focus:ring-2 focus:ring-[#1E40AF] focus:border-[#1E40AF] outline-none"
              placeholder="e.g. Tradeville RON"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider font-semibold text-[#64748B] mb-1.5">Base Currency</label>
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value as any)}
              className="w-32 border border-[#CBD5E1] rounded-lg px-3.5 py-2 text-sm text-[#0F172A] focus:ring-2 focus:ring-[#1E40AF] focus:border-[#1E40AF] outline-none bg-white font-mono"
            >
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="RON">RON (lei)</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setIsCreating(false)} className="px-4 py-2 text-sm text-[#475569] hover:bg-[#F1F5F9] rounded-lg font-medium transition-colors whitespace-nowrap">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm bg-[#1E40AF] text-white rounded-lg font-medium hover:bg-[#1E3A8A] transition-colors whitespace-nowrap">Create</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {portfolios.map(p => {
          const stats = portfolioStats[p.id];
          const pnl = stats ? stats.totalValue - stats.invested : 0;
          return (
            <div
              key={p.id}
              onClick={() => onSelect(p)}
              className="bg-white rounded-xl p-5 border border-[#E2E8F0] cursor-pointer hover:border-[#1E40AF] transition-all group flex flex-col justify-between min-w-0"
            >
              <div className="flex justify-between items-baseline gap-3 pb-3 border-b border-[#F1F5F9]">
                <h2 className="text-lg font-display font-semibold tracking-tight text-[#0F172A] group-hover:text-[#1E40AF] transition-colors truncate" title={p.name}>
                  {p.name}
                </h2>
                <span className="text-xs font-mono font-semibold text-[#64748B] shrink-0">
                  {p.currency}
                </span>
              </div>
              
              <div className="pt-4 flex flex-col gap-3">
                {loadingStats ? (
                  <div className="animate-pulse flex flex-col gap-2">
                    <div className="h-7 bg-[#F1F5F9] rounded w-1/2"></div>
                    <div className="h-4 bg-[#F1F5F9] rounded w-2/3"></div>
                  </div>
                ) : stats ? (
                  <div>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-[#64748B]">
                        Current Valuation
                      </span>
                      <div className={`flex items-center gap-1 text-xs font-mono tabular-nums font-bold whitespace-nowrap ${stats.changePercent >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'}`}>
                        {stats.changePercent >= 0 ? <TrendingUp size={13} className="shrink-0" /> : <TrendingDown size={13} className="shrink-0" />}
                        <span>{stats.changePercent >= 0 ? '+' : ''}{stats.changePercent.toFixed(2)}%</span>
                      </div>
                    </div>
                    <div className="text-xl xl:text-2xl font-mono tabular-nums font-bold text-[#0F172A] tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
                      {formatRoundedCurrency(stats.totalValue, p.currency)}
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-[#F1F5F9] text-xs">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-0.5">Invested</div>
                        <div className="text-[#334155] font-mono tabular-nums font-semibold whitespace-nowrap overflow-hidden text-ellipsis">
                          {formatRoundedCurrency(stats.invested, p.currency)}
                        </div>
                      </div>
                      <div className="text-right min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-0.5">Net Return</div>
                        <div className={`font-mono tabular-nums font-semibold whitespace-nowrap overflow-hidden text-ellipsis ${pnl >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'}`}>
                          {pnl >= 0 ? '+' : ''}{formatRoundedCurrency(pnl, p.currency)}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-[#64748B] text-sm py-2">No transactions recorded</div>
                )}
              </div>
            </div>
          );
        })}
        {portfolios.length === 0 && !isCreating && (
          <div className="col-span-full bg-white rounded-xl border border-[#E2E8F0] text-center py-12 text-[#64748B]">
            You don't have any portfolios yet. Create one to get started.
          </div>
        )}
      </div>
      
      {/* Portfolio Allocation and Portfolio Market Segments side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        <PortfolioAllocation
          portfolios={portfolios}
          portfolioStats={portfolioStats}
          bnrRates={bnrRates}
          globalCurrency={globalCurrency}
          loading={loadingStats}
        />
        <PortfolioMarketSegments
          portfolios={portfolios}
          lots={allLots}
          quotes={quotesMap}
          bnrRates={bnrRates}
          globalCurrency={globalCurrency}
          loading={loadingStats}
        />
      </div>
    </div>
  );
}
