import React, { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TradeLot } from '../types';
import { fetchQuotes } from '../lib/api';

const COLORS = ['#1E40AF', '#0D9488', '#0F172A', '#0284C7', '#059669', '#475569', '#D97706', '#1E3A8A', '#0891B2', '#64748B'];

interface AssetAllocationProps {
  lots: TradeLot[];
  currency?: string;
}

export default function AssetAllocation({ lots, currency = 'USD' }: AssetAllocationProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const openTickers = Array.from(new Set(
          lots.filter(l => l.status === 'OPEN' && !l.ticker.includes('CASH')).map(l => l.ticker)
        ));

        let quotes: Record<string, any> = {};
        if (openTickers.length > 0) {
          quotes = await fetchQuotes(openTickers, currency);
        }

        const holdings: Record<string, number> = {};
        
        let cashBalance = 0;
        lots.forEach(lot => {
          if (lot.transactionType === 'DEPOSIT') cashBalance += lot.shares;
          else if (lot.transactionType === 'WITHDRAWAL') cashBalance -= lot.shares;
          else if (lot.transactionType === 'BUY') cashBalance -= (lot.shares * lot.buyPrice) + (lot.commission || 0);
          else if (lot.transactionType === 'SELL') cashBalance += (lot.shares * lot.buyPrice) - (lot.commission || 0);
          else if (lot.transactionType === 'DIVIDEND') cashBalance += lot.buyPrice - (lot.commission || 0);
        });

        if (cashBalance > 0) {
           holdings['Cash'] = cashBalance;
        }

        lots.forEach(lot => {
          if (lot.ticker.includes('CASH')) return;
          if (!holdings[lot.ticker]) holdings[lot.ticker] = 0;
          if (lot.transactionType === 'BUY') holdings[lot.ticker] += lot.shares;
          else if (lot.transactionType === 'SELL') holdings[lot.ticker] -= lot.shares;
          else if (lot.transactionType === 'SPLIT') holdings[lot.ticker] *= lot.shares;
        });

        const chartData = [];
        for (const [ticker, qty] of Object.entries(holdings)) {
          if (qty > 0) {
            let value = qty;
            if (ticker !== 'Cash') {
               const price = quotes[ticker]?.regularMarketPrice || 0;
               value = qty * price;
            }
            if (value > 0) {
              chartData.push({ name: ticker, value });
            }
          }
        }
        
        chartData.sort((a, b) => b.value - a.value);
        
        // Group small holdings into "Other" if too many
        if (chartData.length > 8) {
           const top = chartData.slice(0, 7);
           const otherValue = chartData.slice(7).reduce((sum, item) => sum + item.value, 0);
           top.push({ name: 'Other', value: otherValue });
           setData(top);
        } else {
           setData(chartData);
        }

      } catch (err) {
        console.error("Failed to load asset allocation", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [lots, currency]);

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 flex-1 flex flex-col min-h-[400px]">
      <h3 className="text-[#0F172A] font-display font-semibold text-lg mb-6">Asset Allocation</h3>
      <div className="flex-1 w-full relative min-h-[300px]">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-[#64748B]">Loading allocation...</div>
        ) : data.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-[#64748B]">No assets found.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                formatter={(value: number) => [
                   new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(value), 
                   'Value'
                ]}
                contentStyle={{ borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgb(15 23 42 / 0.08)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
              />
              <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '12px', marginTop: '10px' }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
