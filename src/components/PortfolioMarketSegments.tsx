import React, { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Portfolio, TradeLot, Currency } from '../types';
import { PieChart as PieChartIcon, Layers, ChevronDown } from 'lucide-react';
import { isFidelisBond } from '../config/taxRules';

const COLORS = [
  '#1E40AF', // Cobalt Ledger Blue
  '#0D9488', // Institutional Teal
  '#0F172A', // Deep Obsidian Slate
  '#0284C7', // Steel Blue
  '#059669', // Institutional Emerald
  '#475569', // Architectural Slate
  '#D97706', // Advisory Amber Gold
  '#1E3A8A', // Deep Navy
  '#0891B2', // Cyan Ledger
  '#334155', // Dark Slate
  '#64748B', // Muted Slate
  '#94A3B8', // Cool Grey
];

type SegmentMode = 'market' | 'asset' | 'sector' | 'industry';

interface PortfolioMarketSegmentsProps {
  portfolios: Portfolio[];
  lots: TradeLot[];
  quotes: Record<string, any>;
  bnrRates: { EUR: number; USD: number; RON: number } | null;
  globalCurrency?: Currency;
  loading?: boolean;
}

// Fallback dictionary for common Romanian & international tickers
const FALLBACK_PROFILES: Record<string, { sector: string; industry: string }> = {
  'TLV.RO': { sector: 'Financial Services', industry: 'Banks - Regional' },
  'BRD.RO': { sector: 'Financial Services', industry: 'Banks - Regional' },
  'SNP.RO': { sector: 'Energy', industry: 'Oil & Gas Integrated' },
  'SNG.RO': { sector: 'Energy', industry: 'Oil & Gas E&P' },
  'H2O.RO': { sector: 'Utilities', industry: 'Utilities - Renewable' },
  'SNN.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Electric' },
  'DIGI.RO': { sector: 'Communication Services', industry: 'Telecom Services' },
  'FP.RO': { sector: 'Financial Services', industry: 'Asset Management' },
  'TTS.RO': { sector: 'Industrials', industry: 'Marine Shipping & Logistics' },
  'ONE.RO': { sector: 'Real Estate', industry: 'Real Estate - Development' },
  'AQ.RO': { sector: 'Industrials', industry: 'Trucking & Freight Logistics' },
  'M.RO': { sector: 'Healthcare', industry: 'Medical Care Facilities' },
  'BVB.RO': { sector: 'Financial Services', industry: 'Financial Data & Stock Exchanges' },
  'EL.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Electric' },
  'TGN.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Gas' },
  'TEL.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Electric' },
  'TRP.RO': { sector: 'Industrials', industry: 'Building Products & Piping' },
  'WINE.RO': { sector: 'Consumer Defensive', industry: 'Beverages - Wineries & Distilleries' },
  'BIO.RO': { sector: 'Healthcare', industry: 'Drug Manufacturers - Specialty' },
  'ALR.RO': { sector: 'Basic Materials', industry: 'Aluminum' },
  'SFG.RO': { sector: 'Consumer Cyclical', industry: 'Restaurants' },
  'ATB.RO': { sector: 'Healthcare', industry: 'Drug Manufacturers - Specialty' },
  'SOCP.RO': { sector: 'Energy', industry: 'Oil & Gas Equipment & Services' },
  'COTE.RO': { sector: 'Energy', industry: 'Oil & Gas Midstream' },
  'IAR.RO': { sector: 'Industrials', industry: 'Aerospace & Defense' },
  'AROBS.RO': { sector: 'Technology', industry: 'Software - Application' },
  '2P.RO': { sector: 'Technology', industry: 'Advertising & Marketing Tech' },
  'SAFE.RO': { sector: 'Technology', industry: 'Cybersecurity & Infrastructure' },
  'DN.RO': { sector: 'Consumer Defensive', industry: 'Farm Products & Dairy' },
  'ROCE.RO': { sector: 'Basic Materials', industry: 'Chemicals & Plastics' },
  'ALU.RO': { sector: 'Basic Materials', industry: 'Aluminum & Building Materials' },
  'IMP.RO': { sector: 'Real Estate', industry: 'Real Estate - Development' },
  'TBK.RO': { sector: 'Financial Services', industry: 'Insurance Brokers' },
  'EVER.RO': { sector: 'Financial Services', industry: 'Asset Management' },
  'INFINITY.RO': { sector: 'Financial Services', industry: 'Asset Management' },
  'LION.RO': { sector: 'Financial Services', industry: 'Asset Management' },
  'TRANSI.RO': { sector: 'Financial Services', industry: 'Asset Management' },
  'CMCM.RO': { sector: 'Basic Materials', industry: 'Building Materials' },
  'TVBETETF.RO': { sector: 'ETFs & Funds', industry: 'Index Tracking Equity ETFs' },
  'CSPX.AS': { sector: 'ETFs & Funds', industry: 'Large Cap Blend Index ETFs' },
  'VWCE.DE': { sector: 'ETFs & Funds', industry: 'Global Equity Index ETFs' },
  'VUAA.DE': { sector: 'ETFs & Funds', industry: 'Large Cap Blend Index ETFs' },
  'EUNL.DE': { sector: 'ETFs & Funds', industry: 'Developed World Index ETFs' },
  'IS3N.DE': { sector: 'ETFs & Funds', industry: 'Emerging Markets Index ETFs' },
  'IWDA.AS': { sector: 'ETFs & Funds', industry: 'Developed World Index ETFs' },
  'QDVE.DE': { sector: 'ETFs & Funds', industry: 'Technology Sector ETFs' },
  'SX8P.DE': { sector: 'ETFs & Funds', industry: 'Technology Sector ETFs' },
};

export default function PortfolioMarketSegments({
  portfolios,
  lots,
  quotes,
  bnrRates,
  globalCurrency = 'RON',
  loading = false,
}: PortfolioMarketSegmentsProps) {
  // Default to first portfolio ID if available, or 'ALL'
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>('ALL');
  const [segmentMode, setSegmentMode] = useState<SegmentMode>('sector');

  // Update selection if portfolios change and selectedId is invalid
  React.useEffect(() => {
    if (portfolios.length > 0 && selectedPortfolioId !== 'ALL') {
      const exists = portfolios.some((p) => p.id === selectedPortfolioId);
      if (!exists) {
        setSelectedPortfolioId(portfolios[0].id);
      }
    }
  }, [portfolios, selectedPortfolioId]);

  const activePortfolio = useMemo(() => {
    if (selectedPortfolioId === 'ALL') return null;
    return portfolios.find((p) => p.id === selectedPortfolioId) || null;
  }, [portfolios, selectedPortfolioId]);

  // Helper to convert an amount in a given portfolio currency to the global display currency
  const convertAmount = (amount: number, fromCurrency: Currency, targetCurrency: Currency): number => {
    if (fromCurrency === targetCurrency || !bnrRates) return amount;
    // to RON
    let inRon = amount;
    if (fromCurrency === 'EUR') inRon = amount * (bnrRates.EUR || 4.97);
    else if (fromCurrency === 'USD') inRon = amount * (bnrRates.USD || 4.60);

    // to target
    if (targetCurrency === 'RON') return inRon;
    if (targetCurrency === 'EUR') return inRon / (bnrRates.EUR || 4.97);
    if (targetCurrency === 'USD') return inRon / (bnrRates.USD || 4.60);
    return inRon;
  };

  // Helper to classify market/region
  const getMarketRegion = (ticker: string, quote?: any): string => {
    if (ticker.includes('CASH') || ticker === '$$CASH_TX') return 'Cash & Liquidity';
    const upper = ticker.toUpperCase();
    if (isFidelisBond(upper) || upper.endsWith('.RO') || quote?.market === 'ro_market' || quote?.exchange === 'BVB') {
      return 'Romania (BVB)';
    }
    if (
      upper.endsWith('.AS') ||
      upper.endsWith('.DE') ||
      upper.endsWith('.NL') ||
      upper.endsWith('.PA') ||
      upper.endsWith('.L') ||
      upper.endsWith('.MI') ||
      ['AMS', 'GER', 'LSE', 'PAR'].includes(quote?.exchange)
    ) {
      return 'European Markets';
    }
    if (quote?.market === 'us_market' || ['NMS', 'NYQ', 'BATS'].includes(quote?.exchange) || !ticker.includes('.')) {
      return 'US Market';
    }
    return 'Other Global';
  };

  // Helper to classify asset type
  const getAssetType = (ticker: string, quote?: any): string => {
    if (ticker.includes('CASH') || ticker === '$$CASH_TX') return 'Cash & Liquidity';
    const upper = ticker.toUpperCase();
    if (isFidelisBond(upper) || quote?.quoteType === 'BOND' || upper.includes('BOND') || upper.includes('TBILL')) {
      return 'Bonds & Fixed Income';
    }
    const isEtf =
      quote?.quoteType === 'ETF' ||
      upper.includes('ETF') ||
      ['CSPX', 'VWCE', 'VUAA', 'VOO', 'SPY', 'QQQ', 'EUNL', 'IWDA', 'TVBETETF', 'BET-TR'].some((prefix) =>
        upper.startsWith(prefix)
      );
    if (isEtf) return 'ETFs & Funds';
    if (quote?.quoteType === 'CRYPTOCURRENCY' || upper.includes('BTC') || upper.includes('ETH')) {
      return 'Cryptocurrency';
    }
    return 'Equities / Stocks';
  };

  // Helper to resolve deep sector and industry
  const getHoldingProfile = (ticker: string, quote?: any): { sector: string; industry: string } => {
    if (ticker.includes('CASH') || ticker === '$$CASH_TX') {
      return { sector: 'Cash & Liquidity', industry: 'Liquid Cash Reserves' };
    }

    if (isFidelisBond(ticker)) {
      return {
        sector: 'Government Bonds (Fidelis)',
        industry: 'Romanian Sovereign Debt (BVB)',
      };
    }

    // 1. Check quote profile if populated from server quoteSummary
    if (quote?.sector && quote?.sector !== 'Other Equities') {
      return {
        sector: quote.sector,
        industry: quote.industry || quote.sector,
      };
    }

    // 2. Check fallback dictionary
    const upper = ticker.toUpperCase();
    if (FALLBACK_PROFILES[upper]) {
      return FALLBACK_PROFILES[upper];
    }

    // 3. Check if ETF
    if (getAssetType(ticker, quote) === 'ETFs & Funds') {
      return {
        sector: 'ETFs & Funds',
        industry: 'Exchange Traded Index Funds',
      };
    }

    // 4. Keyword heuristics based on ticker or company name
    const name = (quote?.shortName || quote?.longName || '').toLowerCase();
    if (name.includes('bank') || name.includes('financial') || name.includes('banc')) {
      return { sector: 'Financial Services', industry: 'Banks & Financial Institutions' };
    }
    if (name.includes('oil') || name.includes('petrol') || name.includes('gas') || name.includes('energy')) {
      return { sector: 'Energy', industry: 'Oil, Gas & Energy' };
    }
    if (name.includes('power') || name.includes('electric') || name.includes('hydro') || name.includes('utilit')) {
      return { sector: 'Utilities', industry: 'Utilities & Power Generation' };
    }
    if (name.includes('pharma') || name.includes('health') || name.includes('medic') || name.includes('bio')) {
      return { sector: 'Healthcare', industry: 'Healthcare & Pharmaceuticals' };
    }
    if (name.includes('soft') || name.includes('tech') || name.includes('cyber') || name.includes('data')) {
      return { sector: 'Technology', industry: 'Software & Information Technology' };
    }
    if (name.includes('real estate') || name.includes('imobil') || name.includes('prop')) {
      return { sector: 'Real Estate', industry: 'Real Estate Development & Holdings' };
    }
    if (name.includes('telecom') || name.includes('comms') || name.includes('digi') || name.includes('cellular')) {
      return { sector: 'Communication Services', industry: 'Telecommunications & Media' };
    }
    if (name.includes('transport') || name.includes('freight') || name.includes('logistic') || name.includes('ship')) {
      return { sector: 'Industrials', industry: 'Freight & Transportation Logistics' };
    }

    // If quote has sector even as fallback
    if (quote?.sector && quote.sector !== 'Other Equities') {
      return {
        sector: quote.sector,
        industry: quote.industry || quote.sector,
      };
    }

    return {
      sector: 'Diversified Operations',
      industry: 'Diversified Commercial Operations',
    };
  };

  const { segmentData, totalSegmentValue } = useMemo(() => {
    if (!lots || lots.length === 0) return { segmentData: [], totalSegmentValue: 0 };

    // Filter lots by portfolio
    const targetLots = selectedPortfolioId === 'ALL'
      ? lots
      : lots.filter((l) => l.portfolioId === selectedPortfolioId);

    if (targetLots.length === 0) return { segmentData: [], totalSegmentValue: 0 };

    const relevantPortfolios = selectedPortfolioId === 'ALL'
      ? portfolios
      : portfolios.filter((p) => p.id === selectedPortfolioId);

    const buckets: Record<string, { name: string; value: number }> = {};

    relevantPortfolios.forEach((port) => {
      const portLots = targetLots.filter((l) => l.portfolioId === port.id);
      if (portLots.length === 0) return;

      // 1. Calculate Cash Balance
      let cashBalance = 0;
      portLots.forEach((lot) => {
        if (lot.transactionType === 'DEPOSIT') cashBalance += lot.shares;
        else if (lot.transactionType === 'WITHDRAWAL') cashBalance -= lot.shares;
        else if (lot.transactionType === 'BUY') cashBalance -= lot.shares * lot.buyPrice + (lot.commission || 0);
        else if (lot.transactionType === 'SELL') cashBalance += lot.shares * lot.buyPrice - (lot.commission || 0);
        else if (lot.transactionType === 'DIVIDEND') cashBalance += lot.buyPrice - (lot.commission || 0);
      });

      cashBalance = Math.round(cashBalance * 100) / 100;

      if (cashBalance > 0.01) {
        const convertedCash = convertAmount(cashBalance, port.currency, globalCurrency);
        let key = 'Cash & Liquidity';
        if (segmentMode === 'market') {
          key = 'Cash Reserves';
        } else if (segmentMode === 'asset') {
          key = 'Cash & Liquidity';
        } else if (segmentMode === 'sector') {
          key = 'Cash & Liquidity';
        } else if (segmentMode === 'industry') {
          key = 'Cash & Treasury Reserves';
        }

        if (!buckets[key]) {
          buckets[key] = { name: key, value: 0 };
        }
        buckets[key].value += convertedCash;
      }

      // 2. Calculate Open Holdings
      const tickers = Array.from(new Set(portLots.map((l) => l.ticker).filter((t) => !t.includes('CASH'))));

      tickers.forEach((t) => {
        const tLots = [...portLots.filter(l => l.ticker === t)].sort(
          (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
        );

        let qty = 0;
        let avgCost = 0;
        tLots.forEach((lot) => {
          if (lot.transactionType === 'BUY') {
            const newQty = qty + lot.shares;
            if (newQty > 0) {
              avgCost = (qty * avgCost + lot.shares * lot.buyPrice) / newQty;
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
          }
        });

        if (qty > 0.0001) {
          const q = quotes[t];
          const price = q?.convertedPrice || q?.price || q?.regularMarketPrice || avgCost;
          const posValuePort = qty * price;
          const convertedPosValue = convertAmount(posValuePort, port.currency, globalCurrency);

          const profile = getHoldingProfile(t, q);

          let segKey = profile.sector;
          if (segmentMode === 'market') {
            segKey = getMarketRegion(t, q);
          } else if (segmentMode === 'asset') {
            segKey = getAssetType(t, q);
          } else if (segmentMode === 'sector') {
            segKey = profile.sector;
          } else if (segmentMode === 'industry') {
            segKey = profile.industry;
          }

          if (!buckets[segKey]) {
            buckets[segKey] = { name: segKey, value: 0 };
          }
          buckets[segKey].value += convertedPosValue;
        }
      });
    });

    const total = Object.values(buckets).reduce((sum, b) => sum + b.value, 0);

    const items = Object.values(buckets)
      .filter((b) => b.value > 0.01)
      .map((b) => ({
        ...b,
        percentage: total > 0 ? (b.value / total) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);

    return { segmentData: items, totalSegmentValue: total };
  }, [lots, portfolios, quotes, bnrRates, selectedPortfolioId, segmentMode, globalCurrency]);

  const formatCurrency = (val: number, curr: Currency) => {
    const rounded = Math.round(val);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: curr,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(rounded);
  };

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 flex flex-col min-h-[420px]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 mb-4 border-b border-[#F1F5F9]">
        <div>
          <h3 className="text-[#0F172A] font-display font-semibold tracking-tight text-base flex items-center gap-2">
            <PieChartIcon size={18} className="text-[#1E40AF]" />
            Portfolio Market Segments
          </h3>
          <p className="text-xs text-[#64748B] mt-0.5">
            Total Analyzed · <span className="font-mono tabular-nums font-semibold text-[#0F172A] whitespace-nowrap">{formatCurrency(totalSegmentValue, globalCurrency)}</span>
          </p>
        </div>

        {/* Portfolio Selector & Global Currency Indicator */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="relative">
            <select
              value={selectedPortfolioId}
              onChange={(e) => setSelectedPortfolioId(e.target.value)}
              className="text-xs font-semibold bg-[#F8FAFC] border border-[#E2E8F0] text-[#334155] rounded-lg pl-3 pr-8 py-1.5 outline-none hover:border-[#CBD5E1] focus:ring-2 focus:ring-[#1E40AF] max-w-[240px] appearance-none cursor-pointer"
            >
              <option value="ALL">All Portfolios</option>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.currency})
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748B] pointer-events-none" />
          </div>

          <span className="text-xs font-mono font-semibold text-[#1E40AF] whitespace-nowrap">
            · {globalCurrency}
          </span>
        </div>
      </div>

      {/* Segment Mode Toggle including deep Industry mode */}
      <div className="flex items-center gap-1 bg-[#F1F5F9] p-1 rounded-lg border border-[#E2E8F0] mb-4 self-start flex-wrap">
        <span className="text-[11px] text-[#64748B] font-medium px-2 flex items-center gap-1 whitespace-nowrap">
          <Layers size={13} /> View:
        </span>
        <button
          onClick={() => setSegmentMode('sector')}
          className={`px-2.5 py-0.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
            segmentMode === 'sector'
              ? 'bg-white text-[#1E40AF] shadow-2xs border border-[#E2E8F0]'
              : 'text-[#475569] hover:text-[#0F172A]'
          }`}
        >
          Sector
        </button>
        <button
          onClick={() => setSegmentMode('industry')}
          className={`px-2.5 py-0.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
            segmentMode === 'industry'
              ? 'bg-white text-[#1E40AF] shadow-2xs border border-[#E2E8F0]'
              : 'text-[#475569] hover:text-[#0F172A]'
          }`}
        >
          Industry (Deep)
        </button>
        <button
          onClick={() => setSegmentMode('market')}
          className={`px-2.5 py-0.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
            segmentMode === 'market'
              ? 'bg-white text-[#1E40AF] shadow-2xs border border-[#E2E8F0]'
              : 'text-[#475569] hover:text-[#0F172A]'
          }`}
        >
          Market / Region
        </button>
        <button
          onClick={() => setSegmentMode('asset')}
          className={`px-2.5 py-0.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
            segmentMode === 'asset'
              ? 'bg-white text-[#1E40AF] shadow-2xs border border-[#E2E8F0]'
              : 'text-[#475569] hover:text-[#0F172A]'
          }`}
        >
          Asset Class
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-center relative min-h-[260px]">
        {loading ? (
          <div className="flex items-center justify-center text-[#64748B] text-sm py-12">
            Loading market segments...
          </div>
        ) : segmentData.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-[#64748B] text-sm py-12">
            <PieChartIcon size={32} className="text-[#CBD5E1] mb-2" />
            <p>No holdings found in {activePortfolio ? activePortfolio.name : 'portfolios'}.</p>
            <p className="text-xs text-[#64748B] mt-1">Add transactions to view market segmentation.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div className="h-[220px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={segmentData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                  >
                    {segmentData.map((entry, index) => (
                      <Cell key={`cell-${entry.name}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: any, name: any, item: any) => [
                      `${formatCurrency(Number(value) || 0, globalCurrency)} (${item.payload.percentage.toFixed(1)}%)`,
                      name,
                    ]}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 4px 6px -1px rgb(15 23 42 / 0.08)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      color: '#0F172A',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-[#64748B]">
                  {segmentMode === 'market' ? 'Region' : segmentMode === 'asset' ? 'Class' : segmentMode === 'sector' ? 'Sector' : 'Industry'}
                </span>
                <span className="text-xs font-mono font-bold text-[#0F172A]">{globalCurrency}</span>
              </div>
            </div>

            {/* Breakdown List */}
            <div className="divide-y divide-[#F1F5F9] border-t border-b border-[#F1F5F9] max-h-[260px] overflow-y-auto pr-1">
              {segmentData.map((item, index) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between text-xs py-2.5 px-2 hover:bg-[#F8FAFC] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    <span className="font-medium text-[#0F172A] truncate" title={item.name}>
                      {item.name}
                    </span>
                  </div>
                  <div className="text-right shrink-0 font-mono tabular-nums whitespace-nowrap">
                    <span className="font-semibold text-[#0F172A]">
                      {formatCurrency(item.value, globalCurrency)}
                    </span>
                    <span className="text-[#64748B] ml-2 font-medium">
                      {item.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
