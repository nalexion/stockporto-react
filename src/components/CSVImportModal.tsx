import React, { useState, useRef } from 'react';
import { Portfolio, BrokerType, LotStatus, TransactionType } from '../types';
import { createLots } from '../lib/api';
import { X, UploadCloud, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';

export default function CSVImportModal({ portfolio, onClose, onSuccess }: { portfolio: Portfolio, onClose: () => void, onSuccess: () => void }) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseDate = (dateStr: string) => {
    if (!dateStr) return new Date().toISOString().split('T')[0];
    
    // Check if already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    
    // Check if YYYYMMDD
    if (/^\d{8}$/.test(dateStr)) {
      const year = dateStr.slice(0, 4);
      const month = dateStr.slice(4, 6);
      const day = dateStr.slice(6, 8);
      return `${year}-${month}-${day}`;
    }
    
    // Fallback to JS Date parser if it's something else like MM/DD/YYYY
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    
    return new Date().toISOString().split('T')[0];
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setImporting(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const lots = results.data.map((row: any) => {
            const ticker = row['Symbol'] || row['ticker'];
            const tradeDateStr = row['Trade Date'] || row['tradeDate'];
            const purchasePriceStr = row['Purchase Price'] ?? row['buyPrice'];
            const quantityStr = row['Quantity'] ?? row['shares'];
            const commissionStr = row['Commission'] ?? row['commission'];
            const comment = row['Comment'] ?? row['comment'] ?? '';
            const txTypeStr = row['Transaction Type'] || row['transactionType'] || 'BUY';
            const brokerTypeStr = row['brokerType'] || 'Resident';
            const acquisitionMethodStr = row['acquisitionMethod'];

            if (!ticker || quantityStr === undefined || quantityStr === '') {
              return null;
            }
            
            const transactionType = txTypeStr.toUpperCase() as TransactionType;
            const isClosedType =
              transactionType === 'SELL' || transactionType === 'DIVIDEND' || transactionType === 'SPLIT';
            const isCash = ticker === '$$CASH_TX';

            const rawTicker = String(ticker).trim().replace(/^'+/, '');
            if (!/^[A-Z0-9.^=$-]{1,24}$/i.test(rawTicker)) {
              return null;
            }
            const cleanComment = String(comment)
              .replace(/^'+([=+\-@\t\r])/, '$1')
              .replace(/^[=+\-@\t\r]+/, '')
              .slice(0, 1000);
            const parsedShares = Math.max(0, parseFloat(quantityStr) || 0);
            const parsedBuyPrice = Math.max(
              0,
              purchasePriceStr !== undefined && purchasePriceStr !== '' ? parseFloat(purchasePriceStr) || 0 : isCash ? 1 : 0
            );
            const parsedComm = Math.max(
              0,
              commissionStr !== undefined && commissionStr !== '' ? parseFloat(commissionStr) || 0 : 0
            );

            return {
              ticker: rawTicker.toUpperCase(),
              tradeDate: parseDate(tradeDateStr),
              shares: parsedShares,
              buyPrice: parsedBuyPrice,
              commission: parsedComm,
              comment: cleanComment,
              transactionType,
              brokerType: (brokerTypeStr === 'Non-Resident' ? 'Non-Resident' : 'Resident') as BrokerType,
              status: (row['status'] === 'CLOSED' || isClosedType ? 'CLOSED' : 'OPEN') as LotStatus,
              acquisitionMethod:
                acquisitionMethodStr === 'SUBSCRIPTION' || acquisitionMethodStr === 'SECONDARY'
                  ? (acquisitionMethodStr as 'SUBSCRIPTION' | 'SECONDARY')
                  : undefined,
              cleanPrice: row['cleanPrice'] ? parseFloat(row['cleanPrice']) : undefined,
              accruedInterest: row['accruedInterest'] ? parseFloat(row['accruedInterest']) : undefined,
              couponRate: row['couponRate'] ? parseFloat(row['couponRate']) : undefined,
              couponStartDate: row['couponStartDate'] || undefined,
              maturityYears: row['maturityYears'] ? parseInt(row['maturityYears'], 10) : undefined,
              repaidAdvance: row['repaidAdvance'] ? parseFloat(row['repaidAdvance']) : undefined,
            };
          }).filter(Boolean);

          await createLots(portfolio.id, lots);
          setImporting(false);
          onSuccess();
        } catch (err: any) {
          setError(err.message || 'Error processing CSV file.');
          setImporting(false);
        }
      },
      error: (error) => {
        setError(error.message);
        setImporting(false);
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b border-[#E2E8F0]">
          <h2 className="text-xl font-display font-semibold tracking-tight text-[#0F172A]">Import from CSV</h2>
          <button onClick={onClose} className="text-[#64748B] hover:text-[#0F172A] transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-8 text-center">
          <div className="w-16 h-16 bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E40AF] rounded-xl flex items-center justify-center mx-auto mb-4">
            <UploadCloud size={32} />
          </div>
          <h3 className="text-lg font-display font-semibold text-[#0F172A] mb-2">Upload Yahoo Finance CSV</h3>
          <p className="text-sm text-[#64748B] mb-6">
            Upload a quotes.csv file exported from Yahoo Finance. We'll automatically parse your open lots.
          </p>

          {error && (
            <div className="bg-[#FFF1F2] border border-[#FECDD3] text-[#BE123C] p-3 rounded-lg text-sm flex items-start gap-2 mb-6 text-left">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <input
            type="file"
            accept=".csv"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="w-full py-2.5 bg-[#1E40AF] hover:bg-[#1E3A8A] text-white rounded-lg font-medium transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
          >
            {importing ? 'Importing...' : 'Select CSV File'}
          </button>
          
          <button
            onClick={onClose}
            className="w-full mt-2.5 py-2.5 text-[#475569] hover:bg-[#F1F5F9] rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
