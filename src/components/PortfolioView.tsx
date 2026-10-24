import React, { useState, useEffect, useMemo } from 'react';
import { Portfolio, TradeLot, EnrichedTradeLot } from '../types';
import { fetchLots, fetchQuotes, updatePortfolio, fetchFxHistoricalRange, analyzeHoldings, AnalyzeResult } from '../lib/api';
import { ArrowLeft, Plus, Upload, Download, TrendingUp, TrendingDown, Edit2, ArrowUp, ArrowDown, ChevronRight, ChevronDown, Check, X, Search, Sparkles, Loader2, RefreshCw, Landmark } from 'lucide-react';
import TransactionModal from './TransactionModal';
import CSVImportModal from './CSVImportModal';
import AnalysisModal from './AnalysisModal';
import PortfolioChart from './PortfolioChart';
import TaxDashboardModal from './TaxDashboardModal';
import IndexCharts from './IndexCharts';
import FidelisLifecycleModal from './FidelisLifecycleModal';
import { calculateCapitalGainsTax, parseFidelisTicker, isFidelisBond } from '../config/taxRules';
import { buildPortfolioGroups, calculatePortfolioCashBalance, resolveFxRateForDate } from '../lib/portfolioMath';

export default function PortfolioView({ portfolio, onBack, onTransactionAdded, onPortfolioUpdated, customTaxRules }: { portfolio: Portfolio, onBack: () => void, onTransactionAdded: () => void, onPortfolioUpdated: (p: Portfolio) => void, customTaxRules?: any[] }) {
  const [lots, setLots] = useState<EnrichedTradeLot[]>([]);
  const [fxHistory, setFxHistory] = useState<Record<string, number>>({});
  const [quotesMap, setQuotesMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [showCSVModal, setShowCSVModal] = useState(false);
  const [editLot, setEditLot] = useState<TradeLot | undefined>(undefined);
  const [sortField, setSortField] = useState<keyof import('../types').TickerGroup | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  
  const [isEditingName, setIsEditingName] = useState(false);
  const [portfolioChartData, setPortfolioChartData] = useState<any[]>([]);
  const [editedName, setEditedName] = useState(portfolio.name);
  
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<AnalyzeResult[] | null>(null);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [showTaxDashboard, setShowTaxDashboard] = useState(false);
  const [fidelisModalTicker, setFidelisModalTicker] = useState<string | null>(null);

  const handleSaveName = async () => {
    if (!editedName.trim() || editedName === portfolio.name) {
      setIsEditingName(false);
      setEditedName(portfolio.name);
      return;
    }
    
    try {
      const updated = await updatePortfolio(portfolio.id, editedName.trim());
      onPortfolioUpdated(updated);
      setIsEditingName(false);
    } catch (err) {
      console.error('Failed to update portfolio name', err);
      // Revert on failure
      setEditedName(portfolio.name);
      setIsEditingName(false);
    }
  };

  
  const handleExportCSV = () => {
    const escapeCsvField = (val: any, isStringField = false) => {
      if (val === undefined || val === null) return '';
      let str = String(val);
      // CWE-1236 CSV Formula Injection protection for text fields
      if (isStringField && /^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      'id',
      'portfolioId',
      'ticker',
      'tradeDate',
      'shares',
      'buyPrice',
      'brokerType',
      'status',
      'transactionType',
      'commission',
      'comment',
      'acquisitionMethod',
      'cleanPrice',
      'accruedInterest',
      'couponRate',
      'couponStartDate',
      'maturityYears',
      'repaidAdvance',
    ];
    const csvRows = [headers.join(',')];
    lots.forEach(lot => {
      csvRows.push(
        [
          escapeCsvField(lot.id, true),
          escapeCsvField(lot.portfolioId, true),
          escapeCsvField(lot.ticker, true),
          escapeCsvField(lot.tradeDate, true),
          escapeCsvField(lot.shares),
          escapeCsvField(lot.buyPrice),
          escapeCsvField(lot.brokerType, true),
          escapeCsvField(lot.status, true),
          escapeCsvField(lot.transactionType, true),
          escapeCsvField(lot.commission),
          escapeCsvField(lot.comment || '', true),
          escapeCsvField(lot.acquisitionMethod || '', true),
          escapeCsvField(lot.cleanPrice ?? ''),
          escapeCsvField(lot.accruedInterest ?? ''),
          escapeCsvField(lot.couponRate ?? ''),
          escapeCsvField(lot.couponStartDate || '', true),
          escapeCsvField(lot.maturityYears ?? ''),
          escapeCsvField(lot.repaidAdvance ?? ''),
        ].join(',')
      );
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `portfolio_${portfolio.name.replace(/\s+/g, '_')}_trades.csv`);
    a.click();
  };

  const handleSort = (field: keyof import('../types').TickerGroup) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleRow = (ticker: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  useEffect(() => {
    loadData();
  }, [portfolio.id]);

  async function loadData() {
    setLoading(true);
    try {
      const fetchedLots = await fetchLots(portfolio.id);
      
      const dates = fetchedLots.map(l => l.tradeDate).filter(Boolean).sort();
      const todayStr = new Date().toISOString().split('T')[0];
      const minDate = dates.length > 0 ? dates[0] : todayStr;
      const maxDate = todayStr;
      
      const tickers = Array.from(new Set(fetchedLots.filter(l => l.status === 'OPEN' && !l.ticker.includes('CASH')).map(l => l.ticker)));
      
      const [quotes, fxRates] = await Promise.all([
        tickers.length > 0 ? fetchQuotes(tickers, portfolio.currency) : Promise.resolve({} as Record<string, any>),
        portfolio.currency !== 'RON' ? fetchFxHistoricalRange(portfolio.currency, minDate, maxDate) : Promise.resolve({} as Record<string, number>)
      ]);
      
      setFxHistory(fxRates);
      setQuotesMap(quotes);

      const enriched = fetchedLots.map(lot => {
        if (lot.ticker.includes('CASH')) {
          return { ...lot, currentPrice: 1, pnl: 0, pnlPercentage: 0 };
        }
        const q = quotes[lot.ticker];
        const fallbackBondPrice = isFidelisBond(lot.ticker) ? (lot.buyPrice || 100) : 0;
        return { ...lot, currentPrice: q?.convertedPrice || fallbackBondPrice };
      });
      setLots(enriched);
    } catch (err: any) {
      console.error('Failed to load portfolio data:', err);
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (val: number) => {
    const rounded = Math.round(val * 100) / 100;
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: portfolio.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(rounded);
  };

  const formatRoundedCurrency = (val: number) => {
    const rounded = Math.round(val);
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: portfolio.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(rounded);
  };
  
  const toggleSelectTicker = (ticker: string) => {
    setSelectedTickers(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  const handleAnalyzeSelected = async () => {
    if (selectedTickers.size === 0) return;
    
    // Build context
    const holdingsToAnalyze = Array.from(selectedTickers).map(t => {
      const g = tickerGroups.find(tg => tg.ticker === t);
      if (!g) return null;
      let holdingDays = 0;
      let oldestDate = new Date();
      g.lots.filter(l => l.status === 'OPEN' && l.transactionType === 'BUY').forEach(l => {
        const d = new Date(l.tradeDate);
        if (d < oldestDate) oldestDate = d;
      });
      holdingDays = Math.max(0, Math.ceil((new Date().getTime() - oldestDate.getTime()) / (1000 * 3600 * 24)));
      
      return {
        ticker: g.ticker,
        companyName: g.ticker,
        shares: g.netQty,
        avgBuyPrice: g.avgCost,
        currentPrice: g.currentPrice || g.avgCost,
        unrealizedPnL: g.unrealizedPnl || 0,
        holdingDays: holdingDays
      };
    }).filter(Boolean);

    setIsAnalyzing(true);
    setShowAnalysisModal(true);
    setAnalysisResults(null);
    try {
      const results = await analyzeHoldings(holdingsToAnalyze);
      setAnalysisResults(results);
    } catch (err) {
      console.error('Analysis failed', err);
      // Could show an error state in the modal
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyzeSingle = async (ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTickers(new Set([ticker]));
    
    // Small timeout to allow state to update before we rely on it, though we could just pass it directly
    setTimeout(() => {
       const g = tickerGroups.find(tg => tg.ticker === ticker);
       if (!g) return;
       let holdingDays = 0;
       let oldestDate = new Date();
       g.lots.filter(l => l.status === 'OPEN' && l.transactionType === 'BUY').forEach(l => {
         const d = new Date(l.tradeDate);
         if (d < oldestDate) oldestDate = d;
       });
       holdingDays = Math.max(0, Math.ceil((new Date().getTime() - oldestDate.getTime()) / (1000 * 3600 * 24)));
       
       const holdingsToAnalyze = [{
         ticker: g.ticker,
         companyName: g.ticker,
         shares: g.netQty,
         avgBuyPrice: g.avgCost,
         currentPrice: g.currentPrice || g.avgCost,
         unrealizedPnL: g.unrealizedPnl || 0,
         holdingDays: holdingDays
       }];
       
       setIsAnalyzing(true);
       setShowAnalysisModal(true);
       setAnalysisResults(null);
       analyzeHoldings(holdingsToAnalyze).then(res => {
         setAnalysisResults(res);
         setIsAnalyzing(false);
       }).catch(err => {
         console.error('Analysis failed', err);
         setIsAnalyzing(false);
       });
    }, 0);
  };

  const {
    tickerGroups,
    globalRealizedPnl,
    globalClosedCostBasis,
    globalEstimatedTaxRon,
    totalInvested,
    totalValue,
    harvestableLossRon,
    cashBalance
  } = useMemo(() => {
    const todayDateObj = new Date();
    const todayStr = todayDateObj.toISOString().split('T')[0];
    const fallbackFx = portfolio.currency === 'EUR' ? 4.97 : portfolio.currency === 'USD' ? 4.60 : 1;
    const todayFxRate =
      portfolio.currency === 'RON' ? 1 : resolveFxRateForDate(fxHistory, todayStr, fallbackFx);

    const cashBal = calculatePortfolioCashBalance(lots);

    return buildPortfolioGroups(customTaxRules, lots, fxHistory, todayFxRate, cashBal);
  }, [lots, fxHistory, customTaxRules, portfolio.currency]);

  const filteredGroups = tickerGroups.filter(g => {
    if (filterStatus === 'ALL') return true;
    return g.status === filterStatus;
  });

  const sortedGroups = [...filteredGroups].sort((a, b) => {
    if (!sortField) return 0;
    const valA = a[sortField] || 0;
    const valB = b[sortField] || 0;
    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPnl = totalValue - totalInvested;
  const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  
  const realizedPnlPercent = globalClosedCostBasis > 0 ? (globalRealizedPnl / globalClosedCostBasis) * 100 : 0;

  return (
    <div className="max-w-7xl mx-auto px-6">
      <button onClick={onBack} className="flex items-center gap-2 text-[#64748B] hover:text-[#0F172A] mb-5 transition-colors text-xs uppercase tracking-wider font-semibold">
        <ArrowLeft size={15} /> Back to Portfolios
      </button>

      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="text-2xl sm:text-3xl font-display font-semibold text-[#0F172A] border-b border-[#CBD5E1] focus:border-[#1E40AF] outline-none bg-transparent px-1 py-0 w-64"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') {
                      setIsEditingName(false);
                      setEditedName(portfolio.name);
                    }
                  }}
                />
                <button onClick={handleSaveName} className="p-1 text-[#059669] hover:bg-[#ECFDF5] rounded">
                  <Check size={20} />
                </button>
                <button onClick={() => { setIsEditingName(false); setEditedName(portfolio.name); }} className="p-1 text-[#64748B] hover:bg-[#F1F5F9] rounded">
                  <X size={20} />
                </button>
              </div>
            ) : (
              <>
                <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-[#0F172A]">{portfolio.name}</h1>
                <button 
                  onClick={() => setIsEditingName(true)}
                  className="p-1.5 text-[#64748B] hover:text-[#1E40AF] hover:bg-[#F1F5F9] rounded-md transition-colors"
                  title="Edit portfolio name"
                >
                  <Edit2 size={16} />
                </button>
              </>
            )}
          </div>
          <p className="text-[#64748B] mt-0.5 text-xs">Base Currency · <span className="font-mono font-semibold text-[#334155]">{portfolio.currency}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="bg-white border border-[#E2E8F0] text-[#334155] px-3 py-2 rounded-lg hover:border-[#CBD5E1] focus:ring-2 focus:ring-[#1E40AF] transition-colors text-xs font-semibold outline-none whitespace-nowrap shrink-0"
          >
            <option value="ALL">All Statuses</option>
            <option value="OPEN">Open Only</option>
            <option value="CLOSED">Closed Only</option>
          </select>
          <button
            onClick={() => { setEditLot(undefined); setShowTransactionModal(true); }}
            className="flex items-center gap-1.5 bg-[#1E40AF] text-white px-3.5 py-2 rounded-lg hover:bg-[#1E3A8A] transition-colors text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <Plus size={15} /> Add Transaction
          </button>
          <button
            onClick={() => setShowTaxDashboard(true)}
            className="flex items-center gap-1.5 bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857] px-3.5 py-2 rounded-lg hover:bg-[#D1FAE5] transition-colors text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <TrendingUp size={15} /> Tax & Dividends
          </button>
          <button
            onClick={() => setShowCSVModal(true)}
            className="flex items-center gap-1.5 bg-white border border-[#E2E8F0] text-[#334155] px-3.5 py-2 rounded-lg hover:bg-[#F8FAFC] hover:border-[#CBD5E1] transition-colors text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <Upload size={15} /> Import CSV
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 bg-[#F1F5F9] text-[#334155] px-3.5 py-2 rounded-lg hover:bg-[#E2E8F0] transition-colors border border-[#E2E8F0] text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      {/* Section C: Exposed Hairline Bento KPI Strip with Single-Line Rounded Currency Figures */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 bg-[#E2E8F0] gap-px border border-[#E2E8F0] rounded-xl overflow-hidden mb-8">
        {/* Total Invested */}
        <div className="bg-white p-4 xl:p-5 flex flex-col justify-between min-w-0">
          <div>
            <h3 className="text-[#64748B] text-[11px] uppercase tracking-wider font-semibold mb-2 whitespace-nowrap">Total Invested</h3>
            <p className="text-lg sm:text-xl xl:text-[21px] font-mono tabular-nums font-bold text-[#0F172A] tracking-tight whitespace-nowrap overflow-hidden text-ellipsis" title={formatCurrency(totalInvested)}>
              {formatRoundedCurrency(totalInvested)}
            </p>
          </div>
          <div className="text-xs text-[#64748B] mt-3 font-medium whitespace-nowrap">
            Principal capital deployed
          </div>
        </div>

        {/* Idle Cash */}
        <div className="bg-white p-4 xl:p-5 flex flex-col justify-between min-w-0">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-[#64748B] text-[11px] uppercase tracking-wider font-semibold whitespace-nowrap">Idle Cash</h3>
              <span className="text-xs font-mono tabular-nums font-semibold text-[#475569] whitespace-nowrap">
                {totalInvested > 0 ? `${((cashBalance / totalInvested) * 100).toFixed(1)}%` : '0.0%'}
              </span>
            </div>
            <p className="text-lg sm:text-xl xl:text-[21px] font-mono tabular-nums font-bold text-[#0F172A] tracking-tight whitespace-nowrap overflow-hidden text-ellipsis" title={formatCurrency(cashBalance)}>
              {formatRoundedCurrency(cashBalance)}
            </p>
          </div>
          <div className="w-full bg-[#F1F5F9] h-1.5 mt-3 rounded-xs overflow-hidden">
            <div 
              className="bg-[#1E40AF] h-full rounded-xs transition-all" 
              style={{ width: `${Math.min(100, Math.max(0, totalInvested > 0 ? (cashBalance / totalInvested) * 100 : 0))}%` }}
            />
          </div>
        </div>

        {/* Current Value */}
        <div className="bg-white p-4 xl:p-5 flex flex-col justify-between min-w-0">
          <div>
            <h3 className="text-[#64748B] text-[11px] uppercase tracking-wider font-semibold mb-2 whitespace-nowrap">Current Value</h3>
            <p className="text-lg sm:text-xl xl:text-[21px] font-mono tabular-nums font-bold text-[#0F172A] tracking-tight whitespace-nowrap overflow-hidden text-ellipsis" title={formatCurrency(totalValue)}>
              {formatRoundedCurrency(totalValue)}
            </p>
          </div>
          <div className="text-xs text-[#64748B] mt-3 font-medium whitespace-nowrap">
            Cash + Open Holdings
          </div>
        </div>

        {/* Total Net Return */}
        <div className="bg-white p-4 xl:p-5 flex flex-col justify-between min-w-0">
          <div>
            <h3 className="text-[#64748B] text-[11px] uppercase tracking-wider font-semibold mb-2 whitespace-nowrap">Total Net Return</h3>
            <div className={`text-lg sm:text-xl xl:text-[21px] font-mono tabular-nums font-bold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis ${totalPnl >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'}`} title={formatCurrency(totalPnl)}>
              {totalPnl >= 0 ? '+' : ''}{formatRoundedCurrency(totalPnl)}
            </div>
            <div className={`flex items-center gap-1.5 mt-1.5 text-xs font-mono tabular-nums font-semibold whitespace-nowrap ${totalPnl >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'}`}>
              {totalPnl >= 0 ? <TrendingUp size={14} className="shrink-0" /> : <TrendingDown size={14} className="shrink-0" />}
              <span>{totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%</span>
              <span className="text-[#64748B] font-sans font-normal text-xs">· overall</span>
            </div>
          </div>
          {(globalEstimatedTaxRon > 0 || harvestableLossRon > 0) && (
            <div className="mt-2.5 pt-2 border-t border-[#F1F5F9] flex flex-col gap-1 text-xs">
              {globalEstimatedTaxRon > 0 && (
                <div className="text-[#64748B] flex justify-between items-center whitespace-nowrap">
                  <span>Est. Tax:</span>
                  <span className="font-mono tabular-nums font-semibold text-[#E11D48]" title={`${globalEstimatedTaxRon.toFixed(2)} RON`}>
                    {Math.round(globalEstimatedTaxRon).toLocaleString('en-US')} RON
                  </span>
                </div>
              )}
              {harvestableLossRon > 0 && (
                <div className="text-[#059669] font-medium flex justify-between items-center whitespace-nowrap">
                  <span>TLH Savings:</span>
                  <span className="font-mono tabular-nums">+{Math.round(harvestableLossRon * 0.16).toLocaleString('en-US')} RON</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Realized P&L */}
        <div className="bg-white p-4 xl:p-5 flex flex-col justify-between min-w-0">
          <div>
            <h3 className="text-[#64748B] text-[11px] uppercase tracking-wider font-semibold mb-2 whitespace-nowrap">Realized P&L</h3>
            <div className={`text-lg sm:text-xl xl:text-[21px] font-mono tabular-nums font-bold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis ${globalRealizedPnl >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'}`} title={formatCurrency(globalRealizedPnl)}>
              {globalRealizedPnl >= 0 ? '+' : ''}{formatRoundedCurrency(globalRealizedPnl)}
            </div>
            <div className={`flex items-center gap-1.5 mt-1.5 text-xs font-mono tabular-nums font-semibold whitespace-nowrap ${globalRealizedPnl >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'}`}>
              {globalRealizedPnl >= 0 ? <TrendingUp size={14} className="shrink-0" /> : <TrendingDown size={14} className="shrink-0" />}
              <span>{realizedPnlPercent >= 0 ? '+' : ''}{realizedPnlPercent.toFixed(2)}%</span>
              <span className="text-[#64748B] font-sans font-normal text-xs">· closed lots</span>
            </div>
          </div>
          <div className="text-xs text-[#64748B] mt-3 font-medium whitespace-nowrap">
            Realized gains & dividends
          </div>
        </div>
      </div>

      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <PortfolioChart lots={lots} portfolio={portfolio} quotes={quotesMap} onDataUpdate={setPortfolioChartData} />
        <IndexCharts portfolioHistory={portfolioChartData} />
      </div>

      {/* Section C: High-Density Exposed Hairline Financial Ledger Table */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
        {selectedTickers.size > 0 && (
          <div className="bg-[#EFF6FF] px-4 py-2.5 border-b border-[#BFDBFE] flex justify-between items-center">
            <span className="text-xs font-medium text-[#1E3A8A]"><span className="font-mono tabular-nums font-semibold">{selectedTickers.size}</span> selected</span>
            <button
              onClick={handleAnalyzeSelected}
              disabled={isAnalyzing}
              className="flex items-center gap-1.5 bg-[#1E40AF] hover:bg-[#1E3A8A] text-white px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-70 whitespace-nowrap"
            >
              {isAnalyzing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              Analyze Selected Holdings
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B] text-[11px] uppercase tracking-wider">
                <th className="py-3 px-3 w-9"></th>
                <th className="py-3 px-3 w-9">
                  <input
                    type="checkbox"
                    className="rounded border-[#CBD5E1] text-[#1E40AF] focus:ring-[#1E40AF] cursor-pointer"
                    checked={selectedTickers.size === sortedGroups.filter(g => g.ticker !== '$$CASH_TX').length && sortedGroups.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTickers(new Set(sortedGroups.filter(g => g.ticker !== '$$CASH_TX').map(g => g.ticker)));
                      } else {
                        setSelectedTickers(new Set());
                      }
                    }}
                  />
                </th>
                <th className="py-3 px-4 font-semibold cursor-pointer hover:bg-[#F1F5F9] transition-colors whitespace-nowrap" onClick={() => handleSort('ticker')}>
                  <div className="flex items-center gap-1">Ticker {sortField === 'ticker' && (sortDirection === 'asc' ? <ArrowUp size={13}/> : <ArrowDown size={13}/>)}</div>
                </th>
                <th className="py-3 px-4 font-semibold text-right cursor-pointer hover:bg-[#F1F5F9] transition-colors whitespace-nowrap border-l border-[#F1F5F9]" onClick={() => handleSort('netQty' as any)}>
                  <div className="flex items-center justify-end gap-1">Net Qty {sortField === 'netQty' as any && (sortDirection === 'asc' ? <ArrowUp size={13}/> : <ArrowDown size={13}/>)}</div>
                </th>
                <th className="py-3 px-4 font-semibold text-right cursor-pointer hover:bg-[#F1F5F9] transition-colors whitespace-nowrap" onClick={() => handleSort('avgCost' as any)}>
                  <div className="flex items-center justify-end gap-1">Avg Price {sortField === 'avgCost' as any && (sortDirection === 'asc' ? <ArrowUp size={13}/> : <ArrowDown size={13}/>)}</div>
                </th>
                <th className="py-3 px-4 font-semibold text-right cursor-pointer hover:bg-[#F1F5F9] transition-colors whitespace-nowrap" onClick={() => handleSort('currentPrice')}>
                  <div className="flex items-center justify-end gap-1">Current Price {sortField === 'currentPrice' && (sortDirection === 'asc' ? <ArrowUp size={13}/> : <ArrowDown size={13}/>)}</div>
                </th>
                <th className="py-3 px-4 font-semibold text-right cursor-pointer hover:bg-[#F1F5F9] transition-colors whitespace-nowrap border-l border-[#F1F5F9]" onClick={() => handleSort('unrealizedPnl' as any)}>
                  <div className="flex items-center justify-end gap-1">Unrealized P&L {sortField === 'unrealizedPnl' as any && (sortDirection === 'asc' ? <ArrowUp size={13}/> : <ArrowDown size={13}/>)}</div>
                </th>
                <th className="py-3 px-4 font-semibold text-right cursor-pointer hover:bg-[#F1F5F9] transition-colors whitespace-nowrap" onClick={() => handleSort('realizedPnl')}>
                  <div className="flex items-center justify-end gap-1">Realized P&L {sortField === 'realizedPnl' && (sortDirection === 'asc' ? <ArrowUp size={13}/> : <ArrowDown size={13}/>)}</div>
                </th>
                <th className="py-3 px-4 font-semibold text-center cursor-pointer hover:bg-[#F1F5F9] transition-colors whitespace-nowrap border-l border-[#F1F5F9]" onClick={() => handleSort('status')}>
                  <div className="flex items-center justify-center gap-1">Status {sortField === 'status' && (sortDirection === 'asc' ? <ArrowUp size={13}/> : <ArrowDown size={13}/>)}</div>
                </th>
                <th className="py-3 px-4 font-semibold text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-sm">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-[#64748B]">Loading portfolio data...</td>
                </tr>
              ) : sortedGroups.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-[#64748B]">No transactions yet. Add some to see them here.</td>
                </tr>
              ) : (
                sortedGroups.map(group => (
                  <React.Fragment key={group.ticker}>
                    <tr 
                      className="hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                      onClick={() => toggleRow(group.ticker)}
                    >
                      <td className="py-3 px-3 text-[#64748B]">
                        {expandedRows.has(group.ticker) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </td>
                      <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                        {group.ticker !== '$$CASH_TX' && (
                          <input
                            type="checkbox"
                            className="rounded border-[#CBD5E1] text-[#1E40AF] focus:ring-[#1E40AF] cursor-pointer"
                            checked={selectedTickers.has(group.ticker)}
                            onChange={() => toggleSelectTicker(group.ticker)}
                          />
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-[#0F172A] whitespace-nowrap">
                        {group.ticker === '$$CASH_TX' ? (
                          `${portfolio.currency} Cash`
                        ) : (
                          <div className="flex items-center gap-2">
                            <span>{group.ticker}</span>
                            {(() => {
                              const fidelis = parseFidelisTicker(group.ticker);
                              if (!fidelis) return null;
                              const lotWithMeta = group.lots.find(l => l.couponRate !== undefined || l.maturityDate);
                              return (
                                <span className="text-[10px] font-mono font-medium text-[#0D9488] tracking-wider uppercase">
                                  FIDELIS · {fidelis.currency} · {lotWithMeta?.maturityDate || fidelis.maturityLabel}
                                  {lotWithMeta?.couponRate ? ` · ${lotWithMeta.couponRate}%` : ''}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#0F172A] whitespace-nowrap border-l border-[#F1F5F9]">
                        {group.ticker === '$$CASH_TX' 
                          ? Number((Math.round(group.netQty * 100) / 100).toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) 
                          : group.netQty}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#334155] whitespace-nowrap">
                        {group.ticker === '$$CASH_TX' ? '-' : (group.avgCost > 0 ? formatCurrency(group.avgCost) : '-')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#334155] whitespace-nowrap">
                        {group.status === 'OPEN' && group.currentPrice !== undefined && group.ticker !== '$$CASH_TX' ? formatCurrency(group.currentPrice) : '-'}
                      </td>
                      <td className={`py-3 px-4 text-right font-mono tabular-nums font-medium whitespace-nowrap border-l border-[#F1F5F9] ${group.unrealizedPnl && group.unrealizedPnl > 0 ? 'text-[#059669]' : group.unrealizedPnl && group.unrealizedPnl < 0 ? 'text-[#E11D48]' : 'text-[#64748B]'}`}>
                        {group.status === 'OPEN' && group.unrealizedPnl !== undefined && group.ticker !== '$$CASH_TX' ? (
                          <>
                            <div>{group.unrealizedPnl > 0 ? '+' : ''}{formatCurrency(group.unrealizedPnl)}</div>
                            <div className="text-[11px]">{group.unrealizedPnlPercent?.toFixed(2)}%</div>
                          </>
                        ) : '-'}
                      </td>
                      <td className={`py-3 px-4 text-right font-mono tabular-nums font-medium whitespace-nowrap ${group.realizedPnl > 0 ? 'text-[#059669]' : group.realizedPnl < 0 ? 'text-[#E11D48]' : 'text-[#64748B]'}`}>
                        {group.ticker !== '$$CASH_TX' && group.realizedPnl !== 0 ? (
                          <div>{group.realizedPnl > 0 ? '+' : ''}{formatCurrency(group.realizedPnl)}</div>
                        ) : '-'}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap border-l border-[#F1F5F9]">
                        <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-xs border ${group.status === 'OPEN' ? 'bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]' : 'bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]'}`}>
                          {group.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {group.ticker !== '$$CASH_TX' && (
                          <div className="flex items-center justify-center gap-1.5">
                            {isFidelisBond(group.ticker) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFidelisModalTicker(group.ticker);
                                }}
                                className="px-2 py-1 text-[11px] font-mono font-medium text-[#0D9488] hover:text-[#0F766E] bg-[#F0FDFA] hover:bg-[#CCFBF1] border border-[#99F6E4] rounded transition-colors flex items-center gap-1"
                                title="1-Click Coupon Schedule & Maturity Redemption"
                              >
                                <Landmark size={12} />
                                <span>Coupon / Redeem</span>
                              </button>
                            )}
                            <button
                              onClick={(e) => handleAnalyzeSingle(group.ticker, e)}
                              className="p-1.5 text-[#64748B] hover:text-[#1E40AF] hover:bg-[#F1F5F9] rounded transition-colors"
                              title="Analyze this holding"
                            >
                              <Sparkles size={15} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    
                    {expandedRows.has(group.ticker) && (
                      <tr>
                        <td colSpan={10} className="p-0 bg-[#F8FAFC]">
                          <div className="pl-10 pr-6 py-3.5 border-b border-[#E2E8F0] border-l-2 border-l-[#1E40AF]">
                            {isFidelisBond(group.ticker) && (
                              <div className="mb-3 pb-2.5 border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs font-mono text-[#334155]">
                                  <strong className="text-[#0F172A]">Romanian Sovereign Bond (Fidelis)</strong> · 100% Tax &amp; CASS Exempt · Par 100.00
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setFidelisModalTicker(group.ticker)}
                                  className="px-2.5 py-1 text-xs font-medium text-[#1E40AF] bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE] rounded transition-colors flex items-center gap-1.5"
                                >
                                  <Landmark size={13} />
                                  <span>1-Click Coupon Schedule &amp; Maturity Redemption</span>
                                </button>
                              </div>
                            )}
                            <table className="w-full text-xs text-left">
                              <thead>
                                <tr className="text-[#64748B] text-[10px] uppercase tracking-wider border-b border-[#E2E8F0]">
                                  <th className="py-2 font-semibold">Date</th>
                                  <th className="py-2 font-semibold">Type</th>
                                  <th className="py-2 text-right font-semibold">Qty</th>
                                  <th className="py-2 text-right font-semibold">Price</th>
                                  <th className="py-2 text-right font-semibold">Commission</th>
                                  <th className="py-2 text-right font-semibold">Holding Age</th>
                                  <th className="py-2 text-right font-semibold">Realized P&L</th>
                                  <th className="py-2 text-right font-semibold">Tax / PnL (RON)</th>
                                  <th className="py-2 text-left font-semibold pl-4">Comment</th>
                                  <th className="py-2 text-center font-semibold">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.lots.map(lot => (
                                  <tr key={lot.id} className="border-b border-[#E2E8F0]/70 last:border-0 hover:bg-[#F1F5F9]/60 transition-colors">
                                    <td className="py-2 font-mono tabular-nums text-[#334155] whitespace-nowrap">{lot.tradeDate}</td>
                                    <td className="py-2 whitespace-nowrap">
                                      <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-xs border ${
                                        lot.transactionType === 'BUY' && lot.acquisitionMethod === 'SUBSCRIPTION'
                                          ? 'bg-[#F0FDFA] text-[#0D9488] border-[#99F6E4]'
                                          : lot.transactionType === 'BUY'
                                          ? 'bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]'
                                          : lot.transactionType === 'SELL'
                                          ? 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]'
                                          : lot.transactionType === 'DIVIDEND'
                                          ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]'
                                          : lot.transactionType === 'DEPOSIT'
                                          ? 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]'
                                          : lot.transactionType === 'SPLIT'
                                          ? 'bg-[#F1F5F9] text-[#334155] border-[#E2E8F0]'
                                          : 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]'
                                      }`}>
                                        {lot.transactionType === 'DIVIDEND' && isFidelisBond(group.ticker)
                                          ? 'COUPON'
                                          : lot.transactionType === 'BUY' && isFidelisBond(group.ticker)
                                          ? lot.acquisitionMethod === 'SUBSCRIPTION'
                                            ? 'SUBSCRIPTION'
                                            : 'BUY · BVB'
                                          : lot.transactionType}
                                      </span>
                                    </td>
                                    <td className="py-2 text-right font-mono tabular-nums text-[#0F172A] whitespace-nowrap">
                                      {lot.transactionType !== 'DIVIDEND' && (
                                        <>
                                          <div>
                                            {group.ticker === '$$CASH_TX' 
                                              ? Number((Math.round(lot.shares * 100) / 100).toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) 
                                              : lot.shares}
                                          </div>
                                          {lot.remainingShares !== undefined && lot.remainingShares < lot.shares && (
                                            <div className="text-[10px] text-[#64748B]">
                                              {group.ticker === '$$CASH_TX' 
                                                ? Number((Math.round(lot.remainingShares * 100) / 100).toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) 
                                                : lot.remainingShares} open
                                            </div>
                                          )}
                                        </>
                                      )}
                                      {lot.transactionType === 'DIVIDEND' && (
                                        isFidelisBond(group.ticker) && lot.shares > 0 ? `${lot.shares} units` : '-'
                                      )}
                                    </td>
                                    <td className="py-2 text-right font-mono tabular-nums text-[#334155] whitespace-nowrap">
                                      {lot.buyPrice > 0 || (lot.repaidAdvance && lot.repaidAdvance > 0) ? (
                                        <div>
                                          <div>{formatCurrency(lot.buyPrice)}</div>
                                          {isFidelisBond(group.ticker) && lot.transactionType !== 'DIVIDEND' && lot.cleanPrice !== undefined && (lot.accruedInterest || 0) > 0 && (
                                            <div className="text-[10px] text-[#64748B]">
                                              Clean {lot.cleanPrice.toFixed(2)} + {lot.accruedInterest?.toFixed(4)} accr
                                            </div>
                                          )}
                                          {isFidelisBond(group.ticker) && lot.transactionType === 'BUY' && lot.acquisitionMethod === 'SUBSCRIPTION' && (
                                            <div className="text-[10px] text-[#0D9488]">
                                              Par 100.00 · 0.00 accr
                                            </div>
                                          )}
                                          {isFidelisBond(group.ticker) && lot.transactionType === 'DIVIDEND' && lot.repaidAdvance && lot.repaidAdvance > 0 && (
                                            <div className="text-[10px] text-[#64748B]" title="Gross coupon split into Bucket 1 (Advance Reimbursed) + Bucket 2 (Net Profit)">
                                              Gross {(lot.grossCouponCash ?? (lot.buyPrice + lot.repaidAdvance)).toFixed(2)} (-{lot.repaidAdvance.toFixed(2)} Adv)
                                            </div>
                                          )}
                                        </div>
                                      ) : '-'}
                                    </td>
                                    <td className="py-2 text-right font-mono tabular-nums text-[#334155] whitespace-nowrap">{lot.commission > 0 ? formatCurrency(lot.commission) : '-'}</td>
                                    <td className={`py-2 text-right font-mono tabular-nums whitespace-nowrap ${
                                      ((lot.transactionType === 'BUY' && lot.remainingShares && lot.remainingShares > 0) || lot.transactionType === 'SELL') && lot.holdingAgeDays !== undefined
                                        ? isFidelisBond(group.ticker) ? 'text-[#0D9488] font-semibold' : lot.holdingAgeDays >= 365 ? 'text-[#059669] font-semibold' : 'text-[#D97706] font-semibold'
                                        : 'text-[#64748B]'
                                    }`}>
                                      {((lot.transactionType === 'BUY' && lot.remainingShares && lot.remainingShares > 0) || lot.transactionType === 'SELL') && lot.holdingAgeDays !== undefined ? `${lot.holdingAgeDays}d` : '-'}
                                    </td>
                                    <td className={`py-2 text-right font-mono tabular-nums whitespace-nowrap ${lot.realizedPnl && lot.realizedPnl > 0 ? 'text-[#059669]' : lot.realizedPnl && lot.realizedPnl < 0 ? 'text-[#E11D48]' : 'text-[#64748B]'}`}>
                                      {(lot.transactionType === 'SELL' || lot.transactionType === 'DIVIDEND') && lot.realizedPnl !== undefined ? (
                                        <>
                                          <div>{lot.realizedPnl > 0 ? '+' : ''}{formatCurrency(lot.realizedPnl)}</div>
                                          {lot.transactionType === 'SELL' && (
                                            <div className="text-[10px]">{lot.realizedPnlPercentage?.toFixed(2)}%</div>
                                          )}
                                        </>
                                      ) : '-'}
                                    </td>
                                    <td className="py-2 text-right font-mono tabular-nums whitespace-nowrap">
                                      {isFidelisBond(group.ticker) ? (
                                        <div>
                                          {(lot.transactionType === 'SELL' || lot.transactionType === 'DIVIDEND') && lot.realizedPnlRon !== undefined && (
                                            <div className={`text-xs ${lot.realizedPnlRon >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'}`}>
                                              {lot.realizedPnlRon >= 0 ? '+' : ''}{lot.realizedPnlRon.toFixed(2)} RON
                                            </div>
                                          )}
                                          <div title="Romanian Fidelis Government Bonds are 100% Tax & CASS Exempt (Art. 93 Codul Fiscal)" className="text-[10px] text-[#0D9488] font-medium">
                                            0.00 RON (Tax-Exempt)
                                          </div>
                                        </div>
                                      ) : lot.transactionType === 'BUY' && lot.estimatedTaxRon ? (
                                        <div title="Estimated Tax in RON" className="text-xs text-[#E11D48]">Est: {lot.estimatedTaxRon.toFixed(2)} RON</div>
                                      ) : (lot.transactionType === 'SELL' || lot.transactionType === 'DIVIDEND') && lot.realizedPnlRon !== undefined ? (
                                        <>
                                          <div title="Realized P&L in RON" className={`text-xs ${lot.realizedPnlRon > 0 ? 'text-[#059669]' : 'text-[#E11D48]'}`}>
                                            {lot.realizedPnlRon > 0 ? '+' : ''}{lot.realizedPnlRon.toFixed(2)} RON
                                          </div>
                                          {lot.estimatedTaxRon !== undefined && lot.estimatedTaxRon > 0 && (
                                            <div title="Calculated Tax in RON" className="text-[10px] text-[#E11D48]">- {lot.estimatedTaxRon.toFixed(2)} RON tax</div>
                                          )}
                                        </>
                                      ) : <span className="text-[#64748B]">-</span>}
                                    </td>
                                    <td className="py-2 pl-4 text-[#334155] text-xs break-words max-w-[220px]" title={lot.comment}>
                                      {lot.comment || '-'}
                                    </td>
                                    <td className="py-2 text-center">
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditLot(lot);
                                          setShowTransactionModal(true);
                                        }}
                                        className="text-[#64748B] hover:text-[#1E40AF] transition-colors"
                                        title="Edit transaction"
                                      >
                                        <Edit2 size={14} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showTransactionModal && (
        <TransactionModal
          portfolio={portfolio}
          editLot={editLot}
          existingTickers={Array.from(new Set(lots.map(l => l.ticker).filter(t => t !== '$$CASH_TX')))}
          existingLots={lots}
          onClose={() => setShowTransactionModal(false)}
          onSuccess={() => {
            setShowTransactionModal(false);
            loadData();
            onTransactionAdded();
          }}
        />
      )}

      {fidelisModalTicker && (() => {
        const targetGroup = sortedGroups.find(g => g.ticker === fidelisModalTicker);
        if (!targetGroup) return null;
        return (
          <FidelisLifecycleModal
            portfolio={portfolio}
            group={targetGroup}
            onClose={() => setFidelisModalTicker(null)}
            onSuccess={() => {
              loadData();
              onTransactionAdded();
            }}
          />
        );
      })()}
      
      {showCSVModal && (
        <CSVImportModal
          portfolio={portfolio}
          onClose={() => setShowCSVModal(false)}
          onSuccess={() => {
            setShowCSVModal(false);
            loadData();
            onTransactionAdded();
          }}
        />
      )}

      {showTaxDashboard && (
        <TaxDashboardModal
          lots={lots}
          customTaxRules={customTaxRules}
          onClose={() => setShowTaxDashboard(false)}
        />
      )}

      <AnalysisModal
        isOpen={showAnalysisModal}
        onClose={() => setShowAnalysisModal(false)}
        results={analysisResults}
        isAnalyzing={isAnalyzing}
      />
    </div>
  );
}
