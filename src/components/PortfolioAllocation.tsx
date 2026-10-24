import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Portfolio, Currency } from '../types';
import { Briefcase, DollarSign } from 'lucide-react';

const COLORS = [
  '#1E40AF', // Cobalt Ledger Blue
  '#0F172A', // Deep Obsidian Slate
  '#0D9488', // Institutional Teal
  '#0284C7', // Steel Blue
  '#059669', // Institutional Emerald
  '#475569', // Architectural Slate
  '#D97706', // Advisory Amber Gold
  '#1E3A8A', // Deep Navy
  '#0891B2', // Cyan Ledger
  '#64748B', // Muted Slate
];

interface PortfolioAllocationProps {
  portfolios: Portfolio[];
  portfolioStats: Record<string, { totalValue: number; changePercent: number; invested: number }>;
  bnrRates: { EUR: number; USD: number; RON: number } | null;
  globalCurrency?: Currency;
  loading?: boolean;
}

export default function PortfolioAllocation({
  portfolios,
  portfolioStats,
  bnrRates,
  globalCurrency = 'RON',
  loading = false,
}: PortfolioAllocationProps) {
  // Helper to convert any portfolio value to the global currency
  const convertToSelected = (val: number, fromCurrency: Currency): number => {
    if (!bnrRates) return val;
    if (fromCurrency === globalCurrency) return val;

    // First convert to RON
    let inRon = val;
    if (fromCurrency === 'EUR') inRon = val * (bnrRates.EUR || 4.97);
    else if (fromCurrency === 'USD') inRon = val * (bnrRates.USD || 4.60);

    // Then convert from RON to target
    if (globalCurrency === 'RON') return inRon;
    if (globalCurrency === 'EUR') return inRon / (bnrRates.EUR || 4.97);
    if (globalCurrency === 'USD') return inRon / (bnrRates.USD || 4.60);

    return inRon;
  };

  const chartData = useMemo(() => {
    if (!portfolios || portfolios.length === 0) return [];

    const items = portfolios.map((p) => {
      const stats = portfolioStats[p.id];
      const rawVal = stats ? Math.max(0, stats.totalValue) : 0;
      const convertedVal = convertToSelected(rawVal, p.currency);
      return {
        id: p.id,
        name: p.name,
        currency: p.currency,
        rawVal,
        value: convertedVal,
      };
    });

    const total = items.reduce((acc, item) => acc + item.value, 0);

    return items
      .filter((item) => item.value > 0)
      .map((item) => ({
        ...item,
        percentage: total > 0 ? (item.value / total) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [portfolios, portfolioStats, bnrRates, globalCurrency]);

  const totalValue = useMemo(() => {
    return chartData.reduce((acc, item) => acc + item.value, 0);
  }, [chartData]);

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
            <Briefcase size={18} className="text-[#1E40AF]" />
            Portfolio Allocation
          </h3>
          <p className="text-xs text-[#64748B] mt-0.5">
            Total Value · <span className="font-mono tabular-nums font-semibold text-[#0F172A] whitespace-nowrap">{formatCurrency(totalValue, globalCurrency)}</span>
          </p>
        </div>

        {/* Global Currency Indicator */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs font-mono text-[#64748B] whitespace-nowrap">
          <span>Base</span>
          <span>·</span>
          <span className="font-semibold text-[#1E40AF]">{globalCurrency}</span>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center relative min-h-[260px]">
        {loading ? (
          <div className="flex items-center justify-center text-[#64748B] text-sm py-12">
            Calculating portfolio allocation...
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-[#64748B] text-sm py-12">
            <DollarSign size={32} className="text-[#CBD5E1] mb-2" />
            <p>No funded portfolios yet.</p>
            <p className="text-xs text-[#64748B] mt-1">Add transactions to visualize portfolio values.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div className="h-[220px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${entry.id}`} fill={COLORS[index % COLORS.length]} />
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
              {/* Center stat in donut */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-[#64748B]">Total</span>
                <span className="text-xs font-mono font-bold text-[#0F172A]">{globalCurrency}</span>
              </div>
            </div>

            {/* Breakdown List */}
            <div className="divide-y divide-[#F1F5F9] border-t border-b border-[#F1F5F9] max-h-[240px] overflow-y-auto pr-1">
              {chartData.map((item, index) => (
                <div
                  key={item.id}
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
                    <span className="text-[10px] font-mono text-[#64748B] shrink-0">· {item.currency}</span>
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
