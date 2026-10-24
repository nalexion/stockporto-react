import React from 'react';
import { X, Sparkles, AlertTriangle, ShieldCheck, PieChart, Activity, Info } from 'lucide-react';
import { PortfolioAnalysisResult } from '../lib/api';

interface PortfolioAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: PortfolioAnalysisResult | null;
  isAnalyzing: boolean;
}

export default function PortfolioAnalysisModal({ isOpen, onClose, result, isAnalyzing }: PortfolioAnalysisModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex justify-between items-center bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E40AF] flex items-center justify-center">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-xl font-display font-semibold text-[#0F172A]">Portfolio Diagnostics</h2>
              <p className="text-sm text-[#64748B]">Risk & Diversification Analysis</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-[#F8FAFC]">
          {isAnalyzing ? (
            <div className="flex flex-col items-center justify-center py-20 text-[#1E40AF]">
              <div className="animate-spin mb-4">
                <Sparkles size={32} />
              </div>
              <p className="font-medium text-[#0F172A]">Synthesizing portfolio allocation...</p>
              <p className="text-sm text-[#64748B] mt-2">Analyzing sector exposure and systemic risks.</p>
            </div>
          ) : result ? (
            <div className="flex flex-col gap-6">
              
              {/* Top Metrics Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[#64748B] mb-1">Overall Risk Level</h3>
                    <p className={`text-2xl font-display font-bold ${
                      result.riskLevel.toLowerCase().includes('high') || result.riskLevel.toLowerCase().includes('aggressive') ? 'text-[#E11D48]' :
                      result.riskLevel.toLowerCase().includes('low') || result.riskLevel.toLowerCase().includes('conservative') ? 'text-[#059669]' :
                      'text-[#D97706]'
                    }`}>{result.riskLevel}</p>
                  </div>
                  <div className={`p-3 rounded-lg border ${
                      result.riskLevel.toLowerCase().includes('high') || result.riskLevel.toLowerCase().includes('aggressive') ? 'bg-[#FFF1F2] text-[#E11D48] border-[#FECDD3]' :
                      result.riskLevel.toLowerCase().includes('low') || result.riskLevel.toLowerCase().includes('conservative') ? 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]' :
                      'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]'
                    }`}>
                    {result.riskLevel.toLowerCase().includes('high') ? <AlertTriangle size={24} /> : <Activity size={24} />}
                  </div>
                </div>
                
                <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[#64748B] mb-1">Diversification Score</h3>
                    <div className="flex items-end gap-2 font-mono tabular-nums">
                      <p className={`text-2xl font-bold ${
                        result.diversificationScore >= 70 ? 'text-[#059669]' :
                        result.diversificationScore >= 40 ? 'text-[#D97706]' : 'text-[#E11D48]'
                      }`}>{result.diversificationScore}</p>
                      <span className="text-[#64748B] font-medium mb-1">/ 100</span>
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg border ${
                        result.diversificationScore >= 70 ? 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]' :
                        result.diversificationScore >= 40 ? 'bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]' : 'bg-[#FFF1F2] text-[#E11D48] border-[#FECDD3]'
                      }`}>
                    {result.diversificationScore >= 70 ? <ShieldCheck size={24} /> : <PieChart size={24} />}
                  </div>
                </div>
              </div>

              {/* Main Two Columns */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Left Column: Key Observations & Actionable Recommendations */}
                <div className="flex flex-col gap-6">
                  <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
                    <div className="bg-[#F8FAFC] px-5 py-3 border-b border-[#E2E8F0]">
                      <h4 className="font-display font-semibold text-[#0F172A] flex items-center gap-2">
                        <Activity size={16} className="text-[#1E40AF]" />
                        Key Observations
                      </h4>
                    </div>
                    <div className="p-5">
                      <ul className="space-y-3">
                        {result.keyObservations.map((obs, i) => (
                          <li key={i} className="text-sm text-[#334155] flex items-start gap-2">
                            <span className="text-[#1E40AF] mt-0.5">•</span>
                            <span>{obs}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
                    <div className="bg-[#EFF6FF] px-5 py-3 border-b border-[#BFDBFE]">
                      <h4 className="font-display font-semibold text-[#1E3A8A] flex items-center gap-2">
                        <Sparkles size={16} className="text-[#1E40AF]" />
                        Actionable Recommendations
                      </h4>
                    </div>
                    <div className="p-5">
                      <ul className="space-y-3">
                        {result.actionableRecommendations.map((rec, i) => (
                          <li key={i} className="text-sm text-[#334155] flex items-start gap-2">
                            <span className="text-[#1E40AF] mt-0.5 shrink-0">→</span>
                            <span className="font-medium text-[#0F172A]">{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Right Column: Sector Breakdown */}
                <div className="bg-white rounded-xl border border-[#E2E8F0] flex flex-col h-full">
                  <div className="bg-[#F8FAFC] px-5 py-3 border-b border-[#E2E8F0]">
                    <h4 className="font-display font-semibold text-[#0F172A] flex items-center gap-2">
                      <PieChart size={16} className="text-[#1E40AF]" />
                      Estimated Sector Allocation
                    </h4>
                  </div>
                  <div className="p-5 flex-1 overflow-y-auto">
                    <div className="space-y-5">
                      {result.sectorBreakdownEstimate.map((sector, i) => (
                        <div key={i}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-semibold text-[#334155]">{sector.sectorName}</span>
                            <span className="text-sm font-mono tabular-nums font-bold text-[#0F172A]">{sector.percentage}%</span>
                          </div>
                          <div className="w-full bg-[#F1F5F9] rounded-full h-2 mb-2">
                            <div 
                              className="bg-[#1E40AF] h-2 rounded-full" 
                              style={{ width: `${sector.percentage}%` }}
                            ></div>
                          </div>
                          <p className="text-xs text-[#64748B]">{sector.commentary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
              
            </div>
          ) : (
            <div className="text-center py-10 text-[#64748B]">No results to display.</div>
          )}
        </div>
      </div>
    </div>
  );
}
