import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Portfolio, TradeLot } from '../types';
import { generatePortfolioHistory } from '../lib/chartUtils';

interface PortfolioChartProps {
  onDataUpdate?: (data: any[]) => void;
  portfolio: Portfolio;
  lots: TradeLot[];
  quotes: Record<string, any>;
}

export default function PortfolioChart({ portfolio, lots, quotes, onDataUpdate }: PortfolioChartProps) {
  const [period, setPeriod] = useState<'1mo' | '3mo' | '6mo' | '1y' | '5y' | 'ytd' | 'max'>('6mo');
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadChart() {
      setLoading(true);
      try {
        const data = await generatePortfolioHistory(lots, period);
        setChartData(data);
        if (onDataUpdate) onDataUpdate(data);
      } catch (err) {
        console.error('Failed to load chart data', err);
      } finally {
        setLoading(false);
      }
    }
    
    if (lots.length > 0) {
      loadChart();
    }
  }, [portfolio, lots, period, quotes]);

  if (lots.length === 0) return null;

  return (
    <div className="bg-white p-5 rounded-xl border border-[#E2E8F0] flex-1 flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-[#0F172A] font-display font-semibold tracking-tight text-lg">Performance History</h3>
        <div className="flex bg-[#F1F5F9] rounded-lg p-1 border border-[#E2E8F0]">
          {(['1mo', '3mo', '6mo', '1y', '5y', 'ytd', 'max'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-md text-xs font-mono font-semibold transition-colors ${period === p ? 'bg-white text-[#1E40AF] shadow-2xs border border-[#E2E8F0]' : 'text-[#475569] hover:text-[#0F172A]'}`}
            >
              {p === 'max' ? 'ALL' : p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      
      <div className="h-[300px] w-full">
        {loading ? (
          <div className="w-full h-full flex justify-center items-center text-[#64748B]">Loading chart data...</div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1E40AF" stopOpacity={0.22}/>
                  <stop offset="95%" stopColor="#1E40AF" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorInvested" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#64748B" stopOpacity={0.15}/>
                  <stop offset="95%" stopColor="#64748B" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'var(--font-mono)' }}
                tickFormatter={(val) => {
                  const d = new Date(val);
                  return `${d.getMonth()+1}/${d.getDate()}`;
                }}
                axisLine={false}
                tickLine={false}
                minTickGap={30}
              />
              <YAxis 
                domain={['auto', 'auto']}
                tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'var(--font-mono)' }}
                tickFormatter={(val) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(val)}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgb(15 23 42 / 0.08)', fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#0F172A' }}
                formatter={(value: number, name: string) => [
                  new Intl.NumberFormat('en-US', { style: 'currency', currency: portfolio.currency }).format(value),
                  name
                ]}
                labelFormatter={(label) => new Date(label as string).toLocaleDateString()}
              />
              <Area 
                type="monotone" 
                dataKey="invested" 
                name="Net Invested"
                stroke="#64748B" 
                strokeWidth={1.75}
                fillOpacity={1} 
                fill="url(#colorInvested)" 
              />
              <Area 
                type="monotone" 
                dataKey="stockValue" 
                name="Portfolio Value"
                stroke="#1E40AF" 
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorValue)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full flex justify-center items-center text-[#64748B]">No data available</div>
        )}
      </div>
    </div>
  );
}
