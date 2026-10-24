import React from 'react';
import { X, Sparkles, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import { AnalyzeResult } from '../lib/api';

interface AnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: AnalyzeResult[] | null;
  isAnalyzing: boolean;
}

export default function AnalysisModal({ isOpen, onClose, results, isAnalyzing }: AnalysisModalProps) {
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
              <h2 className="text-xl font-display font-semibold text-[#0F172A]">Market Intelligence</h2>
              <p className="text-sm text-[#64748B]">Real-time equity and fundamental analysis</p>
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
              <p className="font-medium text-[#0F172A]">Synthesizing market data...</p>
              <p className="text-sm text-[#64748B] mt-2">This may take a few moments for multiple assets.</p>
            </div>
          ) : results ? (
            <div className="flex flex-col gap-6">
              {results.map((res, idx) => (
                <div key={idx} className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
                  <div className="p-5 border-b border-[#E2E8F0] flex justify-between items-start">
                    <div>
                      <h3 className="text-lg font-display font-bold text-[#0F172A] flex items-center gap-2">
                        {res.companyName} <span className="text-xs font-mono font-semibold text-[#475569] px-2 py-0.5 bg-[#F1F5F9] border border-[#E2E8F0] rounded">{res.ticker}</span>
                      </h3>
                      <p className="text-sm text-[#64748B] mt-1">Current Price: <span className="font-mono tabular-nums font-semibold text-[#334155]">{res.currentPrice.toFixed(2)}</span></p>
                    </div>
                    <div className="flex gap-2">
                      <span className={`px-2.5 py-1 text-xs font-mono font-semibold rounded border flex items-center gap-1 ${
                        res.priceDirection === 'Up' ? 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]' :
                        res.priceDirection === 'Down' ? 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]' :
                        'bg-[#F1F5F9] text-[#334155] border-[#E2E8F0]'
                      }`}>
                        {res.priceDirection === 'Up' ? <TrendingUp size={14} /> : res.priceDirection === 'Down' ? <TrendingDown size={14} /> : <Minus size={14} />}
                        {res.priceDirection}
                      </span>
                      <span className={`px-2.5 py-1 text-xs font-mono font-semibold rounded border flex items-center gap-1 ${
                        res.recommendation === 'BUY' ? 'bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]' :
                        res.recommendation === 'SELL' ? 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]' :
                        'bg-[#F1F5F9] text-[#334155] border-[#E2E8F0]'
                      }`}>
                        {res.recommendation}
                      </span>
                    </div>
                  </div>
                  
                  <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-xs font-semibold tracking-wide text-[#64748B] mb-3 flex items-center gap-1">
                        <Info size={14} /> Key Catalysts & News
                      </h4>
                      <ul className="space-y-2">
                        {res.objectiveBullets.map((bullet, i) => (
                          <li key={i} className="text-sm text-[#334155] flex items-start gap-2">
                            <span className="text-[#1E40AF] mt-0.5">•</span>
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-[#F8FAFC] rounded-lg p-4 border border-[#E2E8F0]">
                      <h4 className="text-xs font-semibold tracking-wide text-[#64748B] mb-2">Verdict Rationale</h4>
                      <p className="text-sm text-[#0F172A] leading-relaxed font-medium">
                        "{res.recommendationRationale}"
                      </p>
                      
                      <div className="mt-4 pt-4 border-t border-[#E2E8F0] flex items-center justify-between">
                        <span className="text-xs text-[#64748B]">Market Sentiment</span>
                        <span className={`text-xs font-semibold ${
                          res.marketSentiment === 'Bullish' ? 'text-[#059669]' :
                          res.marketSentiment === 'Bearish' ? 'text-[#E11D48]' : 'text-[#475569]'
                        }`}>{res.marketSentiment}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-[#64748B]">No results to display.</div>
          )}
        </div>
      </div>
    </div>
  );
}
