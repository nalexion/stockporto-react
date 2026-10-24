import React, { useMemo } from 'react';
import { X, Calendar, TrendingUp, TrendingDown, Landmark, Receipt, AlertCircle, FileText, ShieldCheck } from 'lucide-react';
import { EnrichedTradeLot } from '../types';
import { calculateDividendTax, getTaxRatesForYear, isFidelisBond } from '../config/taxRules';

export default function TaxDashboardModal({ lots, onClose, customTaxRules }: { lots: EnrichedTradeLot[], onClose: () => void, customTaxRules?: any[] }) {
  const currentYear = new Date().getFullYear();
  
  const { yearlyData, currentUnrealizedTax, taxExemptFidelisIncomeRon } = useMemo(() => {
    const dataByYear: Record<string, {
      realizedGains: number,
      realizedLosses: number,
      realizedTax: number,
      dividends: number,
      dividendTax: number
    }> = {};

    let unrealizedTax = 0;
    let fidelisExemptRon = 0;

    lots.forEach(lot => {
      if (isFidelisBond(lot.ticker)) {
        if (lot.transactionType === 'SELL' || lot.transactionType === 'DIVIDEND') {
          fidelisExemptRon += (lot.realizedPnlRon || 0);
        }
        return; // 100% exempt under Art. 93 Codul Fiscal
      }

      // Unrealized tax for OPEN BUY lots
      if (lot.transactionType === 'BUY' && lot.remainingShares && lot.remainingShares > 0) {
        if (lot.estimatedTaxRon) unrealizedTax += lot.estimatedTaxRon;
      }
      
      const year = lot.tradeDate.substring(0, 4);
      if (!dataByYear[year]) {
        dataByYear[year] = { realizedGains: 0, realizedLosses: 0, realizedTax: 0, dividends: 0, dividendTax: 0 };
      }
      
      if (lot.transactionType === 'SELL') {
        const pnl = lot.realizedPnlRon || 0;
        if (pnl > 0) dataByYear[year].realizedGains += pnl;
        else dataByYear[year].realizedLosses += Math.abs(pnl);
        
        dataByYear[year].realizedTax += lot.estimatedTaxRon || 0;
      } else if (lot.transactionType === 'DIVIDEND') {
        const divRon = lot.realizedPnlRon || 0;
        dataByYear[year].dividends += divRon;
        dataByYear[year].dividendTax += calculateDividendTax(parseInt(year), divRon, customTaxRules, lot.ticker);
      }
    });

    return {
      yearlyData: Object.entries(dataByYear).map(([year, data]) => ({ year, ...data })).sort((a, b) => Number(b.year) - Number(a.year)),
      currentUnrealizedTax: unrealizedTax,
      taxExemptFidelisIncomeRon: fidelisExemptRon
    };
  }, [lots, customTaxRules]);

  return (
    <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col">
        <div className="sticky top-0 bg-white border-b border-[#E2E8F0] p-6 flex justify-between items-center z-10">
          <div>
            <h2 className="text-2xl font-display font-semibold tracking-tight text-[#0F172A] flex items-center gap-2">
              <Landmark className="text-[#1E40AF]" />
              Advanced Tax & Dividend Dashboard
            </h2>
            <p className="text-[#64748B] mt-1 text-sm">Estimated tax obligations and dividend income in RON</p>
          </div>
          <button onClick={onClose} className="text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] p-2 rounded-lg transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-6 space-y-8 flex-1">
          {/* Current Exposure Summary */}
          <section>
            <h3 className="text-sm font-display font-semibold text-[#64748B] tracking-wide mb-4 flex items-center gap-2">
              <AlertCircle size={16} /> Current Open Tax Exposure (RON)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-[#FFF1F2] border border-[#FECDD3] p-5 rounded-xl">
                <div className="text-[#E11D48] font-medium text-sm mb-1 flex items-center gap-1"><Receipt size={16}/> Unrealized Gains Tax Liability</div>
                <div className="text-2xl text-[#BE123C] font-mono tabular-nums font-bold">{currentUnrealizedTax.toFixed(2)} RON</div>
                <p className="text-xs text-[#E11D48] mt-1">Estimated tax if all profitable taxable positions were closed today</p>
              </div>
              <div className="bg-[#ECFDF5] border border-[#A7F3D0] p-5 rounded-xl">
                <div className="text-[#047857] font-medium text-sm mb-1 flex items-center gap-1"><ShieldCheck size={16}/> Fidelis Sovereign Bonds (Tax & CASS Exempt)</div>
                <div className="text-2xl text-[#059669] font-mono tabular-nums font-bold">
                  {taxExemptFidelisIncomeRon >= 0 ? '+' : ''}{taxExemptFidelisIncomeRon.toFixed(2)} RON
                </div>
                <p className="text-xs text-[#047857] mt-1">0% tax & excluded from CASS thresholds (Art. 93 Codul Fiscal)</p>
              </div>
            </div>
          </section>

          {/* Historical Breakdowns */}
          <section>
            <h3 className="text-sm font-display font-semibold text-[#64748B] tracking-wide mb-4 flex items-center gap-2">
              <Calendar size={16} /> Historical Breakdown by Year
            </h3>
            
            <div className="space-y-6">
              {yearlyData.length > 0 ? yearlyData.map(data => {
                const netRealized = data.realizedGains - data.realizedLosses;
                return (
                  <div key={data.year} className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white">
                    <div className="bg-[#F8FAFC] px-5 py-3 border-b border-[#E2E8F0] flex justify-between items-center">
                      <div className="text-lg font-display font-semibold text-[#0F172A]"><span className="font-mono tabular-nums">{data.year}</span> Tax Year</div>
                      {Number(data.year) === currentYear && <span className="bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E40AF] px-2 py-0.5 rounded text-xs font-medium">Current</span>}
                    </div>
                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      
                      {/* Capital Gains */}
                      <div className="flex flex-col">
                        <span className="text-[#64748B] text-xs mb-1">Realized Gains (Gross)</span>
                        <span className="text-[#059669] font-mono tabular-nums font-semibold flex items-center gap-1"><TrendingUp size={14} /> +{data.realizedGains.toFixed(2)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[#64748B] text-xs mb-1">Realized Losses</span>
                        <span className="text-[#E11D48] font-mono tabular-nums font-semibold flex items-center gap-1"><TrendingDown size={14} /> -{data.realizedLosses.toFixed(2)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[#64748B] text-xs mb-1">Net Capital Gains</span>
                        <span className={`font-mono tabular-nums font-semibold ${netRealized >= 0 ? 'text-[#059669]' : 'text-[#E11D48]'}`}>
                          {netRealized >= 0 ? '+' : ''}{netRealized.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[#64748B] text-xs mb-1">Est. Capital Gains Tax</span>
                        <span className="text-[#BE123C] font-mono tabular-nums font-semibold">{data.realizedTax.toFixed(2)} RON</span>
                      </div>

                      <div className="col-span-full border-t border-[#E2E8F0] my-1"></div>

                      {/* Dividends */}
                      <div className="flex flex-col">
                        <span className="text-[#64748B] text-xs mb-1">Total Dividends Received</span>
                        <span className="text-[#059669] font-mono tabular-nums font-semibold flex items-center gap-1"><FileText size={14} /> +{data.dividends.toFixed(2)}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[#64748B] text-xs mb-1">Est. Dividend Tax (<span className="font-mono tabular-nums">{((getTaxRatesForYear(parseInt(data.year), customTaxRules).dividend) * 100).toFixed(0)}%</span>)</span>
                        <span className="text-[#BE123C] font-mono tabular-nums font-semibold">{data.dividendTax.toFixed(2)} RON</span>
                      </div>
                      
                      {/* Summary */}
                      <div className="col-span-1 md:col-span-2 flex flex-col justify-end bg-[#F8FAFC] p-3 rounded-lg border border-[#E2E8F0]">
                        <span className="text-[#64748B] text-xs mb-1">Total Estimated Tax Liability (<span className="font-mono tabular-nums">{data.year}</span>)</span>
                        <span className="text-[#BE123C] font-mono tabular-nums font-bold text-lg">{(data.realizedTax + data.dividendTax).toFixed(2)} RON</span>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="text-center py-12 text-[#64748B] bg-[#F8FAFC] rounded-xl border border-[#CBD5E1] border-dashed">
                  No tax data or transactions available yet.
                </div>
              )}
            </div>
          </section>
          
          <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl p-4 text-sm text-[#1E3A8A]">
            <strong>Disclaimer:</strong> This dashboard provides estimated tax figures based on standard non-professional rules (e.g. 1%/3% resident, 16% non-resident, country-specific dividend tax). It does not constitute official tax advice. Please consult with an authorized tax consultant for your annual ANAF declaration.
          </div>
        </div>
      </div>
    </div>
  );
}
