export interface TaxConfig {
  year: number;
  residentShortTerm: number; // < 365 days
  residentLongTerm: number;  // >= 365 days
  nonResident: number;
  dividend: number;
}

// These can be extended or fetched from an API in the future
export const DEFAULT_TAX_RULES: TaxConfig[] = [
  {
    year: 2023,
    residentShortTerm: 0.03, 
    residentLongTerm: 0.01,
    nonResident: 0.10,
    dividend: 0.08
  },
  {
    year: 2024,
    residentShortTerm: 0.06,
    residentLongTerm: 0.03,
    nonResident: 0.16,
    dividend: 0.08
  },
  {
    year: 2025,
    residentShortTerm: 0.06,
    residentLongTerm: 0.03,
    nonResident: 0.16,
    dividend: 0.08
  },
  {
    year: 2026,
    residentShortTerm: 0.06,
    residentLongTerm: 0.03,
    nonResident: 0.16,
    dividend: 0.08
  }
];

export function getTaxRatesForYear(year: number, customRules?: TaxConfig[]): TaxConfig {
  const rules = (customRules && customRules.length > 0) ? customRules : DEFAULT_TAX_RULES;
  const config = rules.find(r => r.year === year);
  if (config) return config;
  
  // Fallback to the most recent configured year
  const sorted = [...rules].sort((a, b) => b.year - a.year);
  return sorted[0]; 
}

export interface FidelisBondInfo {
  isFidelis: true;
  baseSymbol: string;
  currency: 'RON' | 'EUR';
  maturityYear: number;
  maturityMonth: string;
  maturityLabel: string;
  tranche: string;
  nominalPar: number;
}

/**
 * Recognizes BVB-listed Romanian Ministry of Finance Fidelis government bonds.
 * Standard BVB convention: R + YY (maturity year) + MM (maturity month) + Tranche (A/B/C for RON, AE/BE/CE/E for EUR)
 * Examples: R2512A, R2608AE, R2704A.RO, R2810AE.RO, R2912B
 */
export function parseFidelisTicker(ticker: string | undefined | null): FidelisBondInfo | null {
  if (!ticker) return null;
  const cleaned = ticker.trim().toUpperCase().replace(/\.RO$/i, '');
  const match = cleaned.match(/^R(\d{2})(0[1-9]|1[0-2])([A-Z]{1,3})$/);
  if (!match) return null;

  const [, yy, mm, tranche] = match;
  const maturityYear = 2000 + parseInt(yy, 10);
  const isEur = tranche.endsWith('E');

  return {
    isFidelis: true,
    baseSymbol: cleaned,
    currency: isEur ? 'EUR' : 'RON',
    maturityYear,
    maturityMonth: mm,
    maturityLabel: `${maturityYear}-${mm}`,
    tranche,
    nominalPar: 100
  };
}

export function isFidelisBond(ticker: string | undefined | null): boolean {
  return parseFidelisTicker(ticker) !== null;
}

export interface FidelisCouponScheduleItem {
  yearIndex: number;
  couponDate: string;
  isMaturity: boolean;
  couponPerBond: number;
  totalCouponAmount: number;
}

export function addYearsToIsoDate(dateStr: string, years: number): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return dateStr;
  const [y, m, d] = parts;
  const targetYear = y + years;
  // Handle Feb 29 leap year edge case cleanly
  const maxDay = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
  const clampedDay = Math.min(d, maxDay);
  return `${targetYear}-${String(m).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

/**
 * Suggests a default issue / coupon start date based on the Fidelis ticker's encoded YYMM
 * maturity and the selected maturity tenor in years (e.g., R2608AE with 2Y tenor -> 2024-08-15).
 */
export function suggestFidelisStartDate(fidelis: FidelisBondInfo, maturityYears: number, existingDay = '15'): string {
  const startYear = fidelis.maturityYear - maturityYears;
  const day = existingDay.padStart(2, '0');
  return `${startYear}-${fidelis.maturityMonth}-${day}`;
}

/**
 * Infers the appropriate Maturity Tenor (1, 2, 3, 5, 10) and Coupon Start Date (in the bond's maturity month)
 * such that the issue date is on or before the purchase tradeDate (handling secondary-market purchases).
 */
export function inferFidelisTenorAndStartDate(
  fidelis: FidelisBondInfo,
  tradeDate: string,
  preferredDay = '15'
): { maturityYears: number; couponStartDate: string } {
  const validTenors = [1, 2, 3, 5, 10];
  const day = (preferredDay || '15').padStart(2, '0');

  if (!tradeDate) {
    return {
      maturityYears: 1,
      couponStartDate: suggestFidelisStartDate(fidelis, 1, day),
    };
  }

  for (const tenor of validTenors) {
    const candidateStart = suggestFidelisStartDate(fidelis, tenor, day);
    if (candidateStart <= tradeDate) {
      return { maturityYears: tenor, couponStartDate: candidateStart };
    }
  }

  return {
    maturityYears: 10,
    couponStartDate: suggestFidelisStartDate(fidelis, 10, day),
  };
}

/**
 * Calculates BVB ACT/ACT Accrued Interest per bond on a given trade/settlement date
 * based on the issue/coupon start date and annual coupon rate (%).
 */
export function calculateFidelisAccruedInterest(
  couponRate: number,
  couponStartDate: string,
  tradeDate: string,
  nominalPar = 100
): {
  accruedPerBond: number;
  daysElapsed: number;
  daysInPeriod: number;
  lastCouponDate: string;
  nextCouponDate: string;
} | null {
  if (!couponStartDate || !tradeDate || isNaN(couponRate) || couponRate <= 0) return null;
  const startMs = Date.parse(`${couponStartDate}T00:00:00Z`);
  const tradeMs = Date.parse(`${tradeDate}T00:00:00Z`);
  if (isNaN(startMs) || isNaN(tradeMs) || tradeMs < startMs) {
    return {
      accruedPerBond: 0,
      daysElapsed: 0,
      daysInPeriod: 365,
      lastCouponDate: couponStartDate,
      nextCouponDate: addYearsToIsoDate(couponStartDate, 1),
    };
  }

  let yearOffset = 0;
  let lastCouponDate = couponStartDate;
  let nextCouponDate = addYearsToIsoDate(couponStartDate, 1);

  while (yearOffset < 20) {
    const candidateNext = addYearsToIsoDate(couponStartDate, yearOffset + 1);
    const candidateNextMs = Date.parse(`${candidateNext}T00:00:00Z`);
    if (tradeMs >= candidateNextMs) {
      yearOffset++;
      lastCouponDate = candidateNext;
      nextCouponDate = addYearsToIsoDate(couponStartDate, yearOffset + 1);
    } else {
      break;
    }
  }

  const lastMs = Date.parse(`${lastCouponDate}T00:00:00Z`);
  const nextMs = Date.parse(`${nextCouponDate}T00:00:00Z`);
  const daysElapsed = Math.max(0, Math.round((tradeMs - lastMs) / 86400000));
  const daysInPeriod = Math.max(365, Math.round((nextMs - lastMs) / 86400000));
  const accruedPerBond = Number((nominalPar * (couponRate / 100) * (daysElapsed / daysInPeriod)).toFixed(4));

  return {
    accruedPerBond,
    daysElapsed,
    daysInPeriod,
    lastCouponDate,
    nextCouponDate,
  };
}

/**
 * Generates the annual coupon payment schedule and final maturity date from
 * the bond's Coupon Start Date, Maturity Tenor (Years), Coupon Rate (%), and Bond Units.
 */
export function getFidelisCouponSchedule(
  couponStartDate: string,
  maturityYears: number,
  couponRate: number,
  units: number,
  nominalPar = 100
): {
  maturityDate: string;
  annualCouponPerBond: number;
  annualCouponTotal: number;
  schedule: FidelisCouponScheduleItem[];
} | null {
  if (!couponStartDate || !maturityYears || maturityYears < 1 || maturityYears > 15) return null;
  const startMs = Date.parse(`${couponStartDate}T00:00:00Z`);
  if (isNaN(startMs)) return null;

  const safeRate = isNaN(couponRate) || couponRate < 0 ? 0 : couponRate;
  const safeUnits = isNaN(units) || units < 0 ? 0 : units;
  const annualCouponPerBond = Number((nominalPar * (safeRate / 100)).toFixed(4));
  const annualCouponTotal = Number((safeUnits * annualCouponPerBond).toFixed(2));

  const schedule: FidelisCouponScheduleItem[] = [];
  for (let yr = 1; yr <= maturityYears; yr++) {
    const couponDate = addYearsToIsoDate(couponStartDate, yr);
    schedule.push({
      yearIndex: yr,
      couponDate,
      isMaturity: yr === maturityYears,
      couponPerBond: annualCouponPerBond,
      totalCouponAmount: annualCouponTotal,
    });
  }

  const maturityDate = addYearsToIsoDate(couponStartDate, maturityYears);
  return {
    maturityDate,
    annualCouponPerBond,
    annualCouponTotal,
    schedule,
  };
}

/**
 * Adds N business days (skipping Saturday and Sunday) to a YYYY-MM-DD date string (e.g. T+2 BVB settlement).
 */
export function addBusinessDaysToIsoDate(dateStr: string, businessDays = 2): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return dateStr;
  const [y, m, d] = parts;
  const cursor = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(cursor.getTime())) return dateStr;

  let remaining = businessDays;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dayOfWeek = cursor.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      remaining--;
    }
  }

  return cursor.toISOString().split('T')[0];
}

/**
 * Suggests the official upcoming annual coupon payment date (`next_coupon_date`)
 * for either Option A (12 months from order_date) or Option B (next occurrence of maturity month MM after settlement_date).
 */
export function suggestNextCouponDate(
  fidelis: FidelisBondInfo,
  referenceDate: string,
  acquisitionMethod: 'SUBSCRIPTION' | 'SECONDARY' = 'SECONDARY',
  preferredDay = '18'
): string {
  if (!referenceDate) {
    return `${fidelis.maturityYear}-${fidelis.maturityMonth}-${preferredDay.padStart(2, '0')}`;
  }
  if (acquisitionMethod === 'SUBSCRIPTION') {
    return addYearsToIsoDate(referenceDate, 1);
  }
  const refYear = parseInt(referenceDate.split('-')[0], 10);
  const day = (preferredDay || '18').padStart(2, '0');
  if (isNaN(refYear)) {
    return `${fidelis.maturityYear}-${fidelis.maturityMonth}-${day}`;
  }
  const sameYearCandidate = `${refYear}-${fidelis.maturityMonth}-${day}`;
  if (sameYearCandidate > referenceDate) {
    return sameYearCandidate;
  }
  return `${refYear + 1}-${fidelis.maturityMonth}-${day}`;
}

export interface FidelisExecutionScheduleItem {
  yearIndex: number; // 1 = Year 1 (next_coupon_date), 2..N = Subsequent Years
  couponDate: string;
  isMaturity: boolean;
  grossCashReceived: number;
  repaidAdvance: number; // Bucket 1: Advance reimbursement (total_interest_advanced on Year 1, 0 thereafter)
  netProfit: number; // Bucket 2: True net profit for holding period (gross - repaidAdvance)
  calendarYield: number; // (netProfit / totalInvested) * 100
}

export interface FidelisExecutionPlan {
  acquisitionMethod: 'SUBSCRIPTION' | 'SECONDARY';
  faceValue: number; // Fixed 100.00
  couponRate: number; // Annual % (e.g. 7.55)
  orderDate: string;
  settlementDate: string; // orderDate for SUBSCRIPTION; T+2 for SECONDARY
  lastCouponDate: string; // 1 year before nextCouponDate
  nextCouponDate: string; // Year 1 coupon payment date
  maturityDate: string; // Final coupon/maturity date
  daysElapsed: number; // 0 for SUBSCRIPTION; settlementDate - lastCouponDate for SECONDARY
  accruedInterestPerUnit: number; // 0 for SUBSCRIPTION; face_value * (coupon_rate/100) * (days_elapsed / 365)
  cleanPrice: number; // 100.00 for SUBSCRIPTION; market clean price for SECONDARY
  executionPrice: number; // dirty_price = clean_price + accrued_interest_per_unit (100.00 for SUBSCRIPTION)
  allocatedBudget: number;
  unitsBought: number; // floor(allocated_budget / execution_price)
  totalCleanPrincipal: number; // units_bought * clean_price
  totalInterestAdvanced: number; // units_bought * accrued_interest_per_unit
  totalInvested: number; // units_bought * execution_price
  unallocatedCash: number; // allocated_budget - total_invested
  // Step 2: Year 1 Coupon Inflow (at next_coupon_date)
  grossCashReceivedYear1: number;
  repaidAdvanceYear1: number; // Bucket 1 (Capital / Advance recovery)
  netProfitYear1: number; // Bucket 2 (True net profit for holding period)
  calendarYieldYear1: number; // (net_profit_year_1 / total_invested) * 100
  // Step 3: Subsequent Years (Years 2 through Maturity)
  annualNetProfitSubsequent: number;
  annualYieldSubsequent: number;
  schedule: FidelisExecutionScheduleItem[];
}

export function calculateFidelisExecutionPlan(params: {
  acquisitionMethod: 'SUBSCRIPTION' | 'SECONDARY';
  allocatedBudget: number;
  overrideUnits?: number;
  faceValue?: number;
  couponRate: number;
  cleanPrice?: number;
  overrideAccruedPerUnit?: number;
  orderDate: string;
  settlementDate?: string;
  nextCouponDate: string;
  maturityYear?: number;
}): FidelisExecutionPlan | null {
  const faceValue = params.faceValue ?? 100;
  const safeRate = isNaN(params.couponRate) || params.couponRate < 0 ? 0 : params.couponRate;
  const rateDecimal = safeRate / 100;
  const isSubscription = params.acquisitionMethod === 'SUBSCRIPTION';

  const orderDate = params.orderDate || new Date().toISOString().split('T')[0];
  const settlementDate = isSubscription
    ? orderDate
    : params.settlementDate || addBusinessDaysToIsoDate(orderDate, 2);

  const nextCouponDate = params.nextCouponDate || addYearsToIsoDate(orderDate, 1);
  const lastCouponDate = addYearsToIsoDate(nextCouponDate, -1);

  let daysElapsed = 0;
  let accruedInterestPerUnit = 0;

  if (!isSubscription) {
    const settleMs = Date.parse(`${settlementDate}T00:00:00Z`);
    const lastMs = Date.parse(`${lastCouponDate}T00:00:00Z`);
    if (!isNaN(settleMs) && !isNaN(lastMs) && settleMs > lastMs) {
      daysElapsed = Math.max(0, Math.round((settleMs - lastMs) / 86400000));
    }
    if (params.overrideAccruedPerUnit !== undefined && !isNaN(params.overrideAccruedPerUnit) && params.overrideAccruedPerUnit >= 0) {
      accruedInterestPerUnit = Number(params.overrideAccruedPerUnit.toFixed(4));
    } else {
      // Actual/365 standard convention as specified
      accruedInterestPerUnit = Number((faceValue * rateDecimal * (daysElapsed / 365)).toFixed(4));
    }
  }

  const cleanPrice = isSubscription
    ? faceValue
    : params.cleanPrice !== undefined && !isNaN(params.cleanPrice) && params.cleanPrice > 0
    ? params.cleanPrice
    : faceValue;

  const executionPrice = isSubscription
    ? faceValue
    : Number((cleanPrice + accruedInterestPerUnit).toFixed(4));

  const safeBudget = isNaN(params.allocatedBudget) || params.allocatedBudget < 0 ? 0 : params.allocatedBudget;

  let unitsBought = 0;
  if (params.overrideUnits !== undefined && !isNaN(params.overrideUnits) && params.overrideUnits >= 0) {
    unitsBought = Math.floor(params.overrideUnits);
  } else if (executionPrice > 0 && safeBudget > 0) {
    unitsBought = Math.floor(safeBudget / executionPrice);
  }

  const totalCleanPrincipal = Number((unitsBought * cleanPrice).toFixed(2));
  const totalInterestAdvanced = isSubscription
    ? 0
    : Number((unitsBought * accruedInterestPerUnit).toFixed(2));
  const totalInvested = Number((unitsBought * executionPrice).toFixed(2));
  const effectiveBudget = safeBudget > 0 ? safeBudget : totalInvested;
  const unallocatedCash = Math.max(0, Number((effectiveBudget - totalInvested).toFixed(2)));

  // Step 2: Year 1 Coupon Inflow (at next_coupon_date)
  const grossCashReceivedYear1 = Number((unitsBought * (faceValue * rateDecimal)).toFixed(2));
  const repaidAdvanceYear1 = isSubscription ? 0 : totalInterestAdvanced; // Bucket 1
  const netProfitYear1 = Number((grossCashReceivedYear1 - repaidAdvanceYear1).toFixed(2)); // Bucket 2
  const calendarYieldYear1 =
    totalInvested > 0 ? Number(((netProfitYear1 / totalInvested) * 100).toFixed(2)) : 0;

  // Step 3: Subsequent Years Logic (Years 2 through Maturity)
  const annualNetProfitSubsequent = grossCashReceivedYear1;
  const annualYieldSubsequent =
    totalInvested > 0 ? Number(((annualNetProfitSubsequent / totalInvested) * 100).toFixed(2)) : 0;

  // Build schedule from Year 1 (nextCouponDate) through maturityYear
  const nextCouponYear = parseInt(nextCouponDate.split('-')[0], 10);
  const targetMaturityYear =
    params.maturityYear && !isNaN(params.maturityYear) && params.maturityYear >= nextCouponYear
      ? params.maturityYear
      : nextCouponYear;
  const totalCouponYears = Math.max(1, Math.min(15, targetMaturityYear - nextCouponYear + 1));

  const schedule: FidelisExecutionScheduleItem[] = [];
  for (let i = 0; i < totalCouponYears; i++) {
    const yrIdx = i + 1;
    const cDate = i === 0 ? nextCouponDate : addYearsToIsoDate(nextCouponDate, i);
    const isFirstYear = i === 0;
    const isMaturity = i === totalCouponYears - 1;
    schedule.push({
      yearIndex: yrIdx,
      couponDate: cDate,
      isMaturity,
      grossCashReceived: grossCashReceivedYear1,
      repaidAdvance: isFirstYear ? repaidAdvanceYear1 : 0,
      netProfit: isFirstYear ? netProfitYear1 : annualNetProfitSubsequent,
      calendarYield: isFirstYear ? calendarYieldYear1 : annualYieldSubsequent,
    });
  }

  const maturityDate = schedule[schedule.length - 1]?.couponDate || nextCouponDate;

  return {
    acquisitionMethod: params.acquisitionMethod,
    faceValue,
    couponRate: safeRate,
    orderDate,
    settlementDate,
    lastCouponDate,
    nextCouponDate,
    maturityDate,
    daysElapsed,
    accruedInterestPerUnit,
    cleanPrice,
    executionPrice,
    allocatedBudget: effectiveBudget,
    unitsBought,
    totalCleanPrincipal,
    totalInterestAdvanced,
    totalInvested,
    unallocatedCash,
    grossCashReceivedYear1,
    repaidAdvanceYear1,
    netProfitYear1,
    calendarYieldYear1,
    annualNetProfitSubsequent,
    annualYieldSubsequent,
    schedule,
  };
}

export function calculateCapitalGainsTax(
  year: number, 
  brokerType: string | undefined,
  holdingDays: number,
  pnlRon: number,
  customRules?: TaxConfig[],
  ticker?: string
): number {
  if (pnlRon <= 0) return 0;
  // Romanian Government Bonds (Fidelis) are 100% tax-exempt under Codul Fiscal Art. 93
  if (ticker && isFidelisBond(ticker)) return 0;
  
  const rules = getTaxRatesForYear(year, customRules);
  
  if (brokerType === 'Resident') {
    return holdingDays < 365 
      ? pnlRon * rules.residentShortTerm 
      : pnlRon * rules.residentLongTerm;
  } else {
    // Non-Resident or other default
    return pnlRon * rules.nonResident;
  }
}

export function calculateDividendTax(
  year: number,
  grossDividendRon: number,
  customRules?: TaxConfig[],
  ticker?: string
): number {
  if (grossDividendRon <= 0) return 0;
  // Coupon interest on Romanian Government Bonds (Fidelis) is 100% tax-exempt
  if (ticker && isFidelisBond(ticker)) return 0;
  const rules = getTaxRatesForYear(year, customRules);
  return grossDividendRon * rules.dividend;
}


