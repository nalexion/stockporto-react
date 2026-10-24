import { TaxConfig } from './config/taxRules';

export type Currency = 'USD' | 'EUR' | 'RON';
export type BrokerType = 'Resident' | 'Non-Resident';
export type LotStatus = 'OPEN' | 'CLOSED';
export type TransactionType = 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'DIVIDEND' | 'SPLIT';

export interface Portfolio {
  userId?: string;
  id: string;
  name: string;
  currency: Currency;
}

export interface TradeLot {
  userId?: string;
  id: string;
  portfolioId: string;
  ticker: string;
  tradeDate: string; // YYYY-MM-DD
  shares: number;
  buyPrice: number;
  brokerType: BrokerType;
  status: LotStatus;
  transactionType: TransactionType;
  commission: number;
  comment: string;
  // Optional Fidelis Government Bond metadata
  acquisitionMethod?: 'SUBSCRIPTION' | 'SECONDARY';
  allocatedBudget?: number;
  orderDate?: string; // Date transaction is requested YYYY-MM-DD
  settlementDate?: string; // Settlement date YYYY-MM-DD (T+2 for SECONDARY, orderDate for SUBSCRIPTION)
  nextCouponDate?: string; // Official next annual coupon payment date YYYY-MM-DD
  lastCouponDate?: string; // 1 year before nextCouponDate YYYY-MM-DD
  cleanPrice?: number;
  accruedInterest?: number;
  dirtyPrice?: number;
  totalInterestAdvanced?: number; // units_bought * accrued_interest_per_unit
  repaidAdvance?: number; // Bucket 1 on Year 1 coupon: reimbursed seller accrued interest
  grossCouponCash?: number; // Gross coupon cash paid by State before Bucket 1 split
  couponRate?: number; // Annual coupon rate % (e.g. 7.55)
  couponStartDate?: string; // Issue / coupon start date YYYY-MM-DD
  maturityYears?: number; // Tenor in years (e.g. 1, 2, 3, 5, 10)
  maturityDate?: string; // Exact maturity date YYYY-MM-DD
}

// Additional derived info for UI
export interface EnrichedTradeLot extends TradeLot {
  currentPrice?: number;
  pnl?: number; // unrealized P&L in portfolio currency for OPEN lots
  pnlPercentage?: number; // unrealized P&L percentage for OPEN lots
  realizedPnl?: number; // realized P&L for SELL lots
  realizedPnlPercentage?: number; // realized P&L percentage for SELL lots
  remainingShares?: number; // Shares remaining for OPEN buy lots
  holdingAgeDays?: number; // Age of the lot in days
  estimatedTaxRon?: number; // Estimated tax in RON for OPEN buy lots
  realizedPnlRon?: number; // Realized P&L strictly in RON for SELL lots
  buyFxRate?: number; // BNR rate on buy date
  sellFxRate?: number; // BNR rate on sell date
}

export interface TickerGroup {
  ticker: string;
  lots: EnrichedTradeLot[];
  netQty: number;
  avgCost: number;
  currentPrice?: number;
  unrealizedPnl?: number;
  unrealizedPnlPercent?: number;
  realizedPnl: number;
  status: LotStatus;
}

export interface UserSettings {
  userId?: string;
  taxRules?: TaxConfig[];
}
