import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TradeLot } from '../types';
import { fetchHistorical } from '../lib/api';
import { generatePortfolioHistory } from '../lib/chartUtils';

type Region = 'US' | 'EU' | 'RO';
type Period = '1d' | '5d' | '1mo' | '6mo' | '1y' | '5y';

const INDEX_CONFIG: Record<Region, { name: string, symbol: string }> = {
  US: { name: 'S&P 500 (US)', symbol: '^GSPC' },
  EU: { name: 'Euro Stoxx 50 (EU)', symbol: '^STOXX50E' },
  RO: { name: 'BET ETF (RO)', symbol: 'TVBETETF.RO' }
};

interface IndexChartsProps {
  portfolioHistory?: any[];
  lots?: TradeLot[];
}

export default function IndexCharts({ portfolioHistory = [], lots }: IndexChartsProps) {
  const [region, setRegion] = useState<Region>('US');
  const [period, setPeriod] = useState<Period>('6mo');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadData() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const symbol = INDEX_CONFIG[region].symbol;
        
        const fetchIndex = fetchHistorical(symbol, period).catch(err => {
           console.error("Index fetch error", err);
           return [];
        });
        
        const fetchPortfolio = (lots && lots.length > 0 && (!portfolioHistory || portfolioHistory.length === 0)) 
            ? generatePortfolioHistory(lots, period).catch(err => {
                console.error("Portfolio history error", err);
                return [];
              })
            : Promise.resolve(portfolioHistory);
            
        const [fetched, historyToUse] = await Promise.all([fetchIndex, fetchPortfolio]);
        
        if (!mounted) return;
        
        if (!fetched || fetched.length === 0) {
          setErrorMsg('Market data not available for this period.');
          setData([]);
        } else {
          let baseIndexPrice = 0;
          let basePortfolioValue = 100; // Base TWR

          const formatted = fetched.map((d: any, index: number) => {
            const dateStr = d.date.split('T')[0];
            let portValue = 100; 
            let hasHistory = false;
            
            if (historyToUse && historyToUse.length > 0) {
               hasHistory = true;
               const match = historyToUse.find(p => p.date === dateStr);
               if (match) {
                 portValue = match.twr || 100;
               } else {
                 for (let i = historyToUse.length - 1; i >= 0; i--) {
                   if (historyToUse[i].date <= dateStr) {
                     portValue = historyToUse[i].twr || 100;
                     break;
                   }
                 }
                 if (!portValue && historyToUse.length > 0) portValue = historyToUse[0].twr || 100;
               }
            }

            if (index === 0) {
              baseIndexPrice = d.close;
              basePortfolioValue = hasHistory ? portValue : 100;
            }

            return {
              date: new Date(d.date).toLocaleDateString(undefined, { 
                 month: 'short', 
                 day: 'numeric',
                 ...(period.includes('y') ? { year: '2-digit' } : {})
              }),
              time: new Date(d.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              fullDate: d.date,
              close: d.close,
              indexReturn: baseIndexPrice ? ((d.close - baseIndexPrice) / baseIndexPrice) * 100 : 0,
              portfolioReturn: basePortfolioValue && portValue ? ((portValue - basePortfolioValue) / basePortfolioValue) * 100 : 0
            };
          });

          setData(formatted);
        }
      } catch (err: any) {
        console.error(err);
        if (mounted) setErrorMsg(err.message || 'Unknown error');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadData();
    return () => { mounted = false; };
  }, [region, period, portfolioHistory, lots]);

  const periods: Period[] = ['1d', '5d', '1mo', '6mo', '1y', '5y'];

  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 flex-1 flex flex-col min-h-[400px]">
      <div className="flex flex-col justify-between items-start mb-6 gap-4">
        <div className="w-full flex justify-between items-center">
          <div>
            <h3 className="text-[#0F172A] font-display font-semibold tracking-tight text-lg">Portfolio vs Market</h3>
          </div>
          <div className="flex bg-[#F1F5F9] p-1 rounded-lg border border-[#E2E8F0]">
            {periods.map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-md text-xs font-mono font-semibold transition-colors uppercase ${period === p ? 'bg-white shadow-2xs border border-[#E2E8F0] text-[#1E40AF]' : 'text-[#475569] hover:text-[#0F172A]'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex bg-[#F1F5F9] p-1 rounded-lg border border-[#E2E8F0]">
          {(Object.keys(INDEX_CONFIG) as Region[]).map(r => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`px-4 py-1 rounded-md text-xs font-semibold transition-colors ${region === r ? 'bg-white shadow-2xs border border-[#E2E8F0] text-[#1E40AF]' : 'text-[#475569] hover:text-[#0F172A]'}`}
            >
              {INDEX_CONFIG[r].name}
            </button>
          ))}
        </div>
      </div>
      
      <div className="flex-1 w-full relative min-h-[300px]">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-[#64748B]">Loading chart data...</div>
        ) : errorMsg ? (
          <div className="absolute inset-0 flex items-center justify-center text-[#E11D48] font-medium">{errorMsg}</div>
        ) : data.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-[#64748B]">Market data not available for this period.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis 
                 dataKey={period === '1d' || period === '5d' ? 'time' : 'date'}
                 axisLine={false}
                 tickLine={false}
                 tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'var(--font-mono)' }}
                 minTickGap={30}
              />
              <YAxis 
                 domain={['auto', 'auto']}
                 axisLine={false}
                 tickLine={false}
                 tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'var(--font-mono)' }}
                 tickFormatter={(val) => val.toFixed(1) + '%'}
                 width={60}
              />
              <Tooltip 
                 contentStyle={{ borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgb(15 23 42 / 0.08)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                 labelStyle={{ fontWeight: 600, color: '#334155' }}
                 formatter={(value: number, name: string) => [
                   (value >= 0 ? '+' : '') + value.toFixed(2) + '%',
                   name === 'indexReturn' ? INDEX_CONFIG[region].name : 'Your Portfolio'
                 ]}
                 labelFormatter={(label, payload) => {
                   if (payload && payload.length > 0 && payload[0].payload) {
                     const fullDate = new Date(payload[0].payload.fullDate);
                     return fullDate.toLocaleString();
                   }
                   return label;
                 }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', fontFamily: 'var(--font-sans)' }} />
              <Line 
                 type="monotone" 
                 name="indexReturn"
                 dataKey="indexReturn" 
                 stroke="#64748B" 
                 strokeWidth={1.75} 
                 dot={false}
                 activeDot={{ r: 4, strokeWidth: 0 }}
              />
              {(portfolioHistory && portfolioHistory.length > 0) || (lots && lots.length > 0) ? (
              <Line 
                 type="monotone" 
                 name="portfolioReturn"
                 dataKey="portfolioReturn" 
                 stroke="#1E40AF" 
                 strokeWidth={2} 
                 dot={false}
                 activeDot={{ r: 4, strokeWidth: 0 }}
              />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
