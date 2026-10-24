import { Portfolio, TradeLot, UserSettings } from '../types';
import { collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where, writeBatch } from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  parseFidelisTicker,
  getFidelisCouponSchedule,
  inferFidelisTenorAndStartDate,
  calculateFidelisAccruedInterest,
  addBusinessDaysToIsoDate,
} from '../config/taxRules';

const generateId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
const syncedCouponIdsInSession = new Set<string>();

// Short-TTL in-flight request deduplication cache to prevent 3x redundant Firestore & BNR reads on dashboard mount
const DEDUPE_TTL_MS = 2500;
let portfoliosCache: { promise: Promise<Portfolio[]> | null; timestamp: number } = { promise: null, timestamp: 0 };
let allLotsCache: { promise: Promise<TradeLot[]> | null; timestamp: number } = { promise: null, timestamp: 0 };
let bnrRatesCache: { promise: Promise<{ EUR: number; USD: number; RON: number }> | null; timestamp: number } = {
  promise: null,
  timestamp: 0,
};

export function invalidateDataCache() {
  portfoliosCache = { promise: null, timestamp: 0 };
  allLotsCache = { promise: null, timestamp: 0 };
}

async function ensureFidelisPastCoupons(lots: TradeLot[]): Promise<TradeLot[]> {
  if (!auth.currentUser || lots.length === 0) return lots;

  const todayStr = new Date().toISOString().split('T')[0];
  const groups = new Map<string, TradeLot[]>();

  for (const lot of lots) {
    const fidelis = parseFidelisTicker(lot.ticker);
    if (!fidelis) continue;
    const key = `${lot.portfolioId}::${fidelis.baseSymbol}`;
    const list = groups.get(key) || [];
    list.push(lot);
    groups.set(key, list);
  }

  if (groups.size === 0) return lots;

  const newCouponLots: TradeLot[] = [];
  const batch = writeBatch(db);
  let batchCount = 0;

  for (const [, groupLots] of groups.entries()) {
    const buyLots = groupLots
      .filter(l => l.transactionType === 'BUY')
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    if (buyLots.length === 0) continue;

    const firstBuy = buyLots[0];
    const fidelis = parseFidelisTicker(firstBuy.ticker);
    if (!fidelis) continue;

    let couponRate: number | undefined;
    let couponStartDate: string | undefined;
    let maturityYears: number | undefined;

    for (const l of groupLots) {
      if (l.couponRate !== undefined && l.couponRate > 0 && couponRate === undefined) {
        couponRate = l.couponRate;
      }
      if (l.couponStartDate && !couponStartDate) {
        couponStartDate = l.couponStartDate;
      }
      if (l.maturityYears && !maturityYears) {
        maturityYears = l.maturityYears;
      }
    }

    if (couponRate === undefined) {
      for (const l of groupLots) {
        const match = l.comment?.match(/Coupon:\s*([\d.]+)%/i);
        if (match) {
          const parsed = parseFloat(match[1]);
          if (!isNaN(parsed) && parsed > 0) {
            couponRate = parsed;
            break;
          }
        }
      }
    }

    if (couponRate === undefined || couponRate <= 0) continue;

    if (!couponStartDate || !maturityYears) {
      const inferred = inferFidelisTenorAndStartDate(fidelis, firstBuy.tradeDate);
      if (!couponStartDate) couponStartDate = inferred.couponStartDate;
      if (!maturityYears) maturityYears = inferred.maturityYears;
    }

    const scheduleInfo = getFidelisCouponSchedule(
      couponStartDate,
      maturityYears,
      couponRate,
      1,
      fidelis.nominalPar
    );
    if (!scheduleInfo) continue;

    const existingDividends = groupLots.filter(l => l.transactionType === 'DIVIDEND');
    const existingDividendDates = new Set(existingDividends.map(l => l.tradeDate));
    const existingDividendYears = new Set(existingDividends.map(l => l.tradeDate.slice(0, 4)));
    const existingIds = new Set(groupLots.map(l => l.id));

    // Option A (Subscription) = 0.00 accrued advance; Option B (Secondary Buy) = deduct accrued interest advanced to seller on Year 1
    const totalInterestAdvancedOnBuys = Number(
      buyLots
        .reduce((acc, l) => {
          if (l.acquisitionMethod === 'SUBSCRIPTION') return acc;
          if (l.totalInterestAdvanced !== undefined && l.totalInterestAdvanced > 0) {
            return acc + l.totalInterestAdvanced;
          }
          if (l.accruedInterest && l.accruedInterest > 0) {
            return acc + l.shares * l.accruedInterest;
          }
          if (couponStartDate && l.tradeDate > couponStartDate) {
            const settleDate = addBusinessDaysToIsoDate(l.tradeDate, 2);
            const calc = calculateFidelisAccruedInterest(
              settleDate,
              couponStartDate,
              couponRate!,
              fidelis.nominalPar
            );
            if (calc && calc.daysAccrued > 0) {
              const accPerUnit = Number(
                (fidelis.nominalPar * (couponRate! / 100) * (calc.daysAccrued / 365)).toFixed(4)
              );
              return acc + l.shares * accPerUnit;
            }
          }
          return acc;
        }, 0)
        .toFixed(2)
    );

    let firstCouponAfterPurchaseSeen = false;

    for (const item of scheduleInfo.schedule) {
      if (item.couponDate <= firstBuy.tradeDate) continue;
      const isFirstCouponAfterBuy = !firstCouponAfterPurchaseSeen;
      firstCouponAfterPurchaseSeen = true;

      if (item.couponDate > todayStr) continue;

      // Calculate net bond units held on this coupon payment date
      let unitsHeld = 0;
      for (const l of groupLots) {
        if (l.transactionType === 'BUY' && l.tradeDate < item.couponDate) {
          unitsHeld += l.shares;
        } else if (l.transactionType === 'SELL' && l.tradeDate <= item.couponDate) {
          unitsHeld -= l.shares;
        }
      }
      unitsHeld = Math.max(0, unitsHeld);
      if (unitsHeld <= 0) continue;

      const deterministicId = `coupon_${firstBuy.portfolioId}_${fidelis.baseSymbol}_${item.couponDate}`;
      const couponYear = item.couponDate.slice(0, 4);

      const grossCouponCash = Number((unitsHeld * item.couponPerBond).toFixed(2));
      if (grossCouponCash <= 0) continue;

      const repaidAdvance =
        isFirstCouponAfterBuy && totalInterestAdvancedOnBuys > 0
          ? totalInterestAdvancedOnBuys
          : 0;
      const netCouponProfit = Math.max(0, Number((grossCouponCash - repaidAdvance).toFixed(2)));

      // Check if an unsplit auto-generated v2.2.2 Year 1 coupon exists and upgrade it to Bucket 1 + Bucket 2
      const existingAutoLot = existingDividends.find(
        d => d.id === deterministicId || d.tradeDate === item.couponDate
      );
      if (existingAutoLot) {
        if (
          isFirstCouponAfterBuy &&
          repaidAdvance > 0 &&
          existingAutoLot.repaidAdvance === undefined &&
          Math.abs(existingAutoLot.buyPrice - grossCouponCash) < 0.05 &&
          !syncedCouponIdsInSession.has(`upgraded_${existingAutoLot.id}`)
        ) {
          syncedCouponIdsInSession.add(`upgraded_${existingAutoLot.id}`);
          existingAutoLot.buyPrice = netCouponProfit;
          existingAutoLot.repaidAdvance = repaidAdvance;
          existingAutoLot.grossCouponCash = grossCouponCash;
          existingAutoLot.comment = `Year 1 Coupon (Secondary BVB) · Gross: ${grossCouponCash.toFixed(2)} · Bucket 1 Advance Reimbursed: ${repaidAdvance.toFixed(2)} · Bucket 2 Net Profit: ${netCouponProfit.toFixed(2)}`;
          const docRef = doc(db, 'lots', existingAutoLot.id);
          batch.set(docRef, Object.fromEntries(Object.entries(existingAutoLot).filter(([_, v]) => v !== undefined)));
          batchCount++;
        }
        continue;
      }

      if (
        existingIds.has(deterministicId) ||
        existingDividendDates.has(item.couponDate) ||
        existingDividendYears.has(couponYear)
      ) {
        continue;
      }

      const commentText =
        repaidAdvance > 0
          ? `Year 1 Coupon (Secondary BVB) · Gross: ${grossCouponCash.toFixed(2)} · Bucket 1 Advance Reimbursed: ${repaidAdvance.toFixed(2)} · Bucket 2 Net Profit: ${netCouponProfit.toFixed(2)}`
          : `Year ${item.yearIndex} Fidelis Annual Coupon (${couponRate}% p.a. on ${unitsHeld} units)`;

      const newLot: TradeLot = {
        id: deterministicId,
        portfolioId: firstBuy.portfolioId,
        userId: auth.currentUser.uid,
        ticker: firstBuy.ticker.toUpperCase(),
        tradeDate: item.couponDate,
        shares: unitsHeld,
        buyPrice: netCouponProfit,
        repaidAdvance: repaidAdvance > 0 ? repaidAdvance : undefined,
        grossCouponCash,
        brokerType: 'Resident',
        status: 'CLOSED',
        transactionType: 'DIVIDEND',
        commission: 0,
        comment: commentText,
        couponRate,
        couponStartDate,
        maturityYears,
        maturityDate: scheduleInfo.maturityDate,
      };

      const cleanNewLot = Object.fromEntries(
        Object.entries(newLot).filter(([_, v]) => v !== undefined)
      ) as TradeLot;

      newCouponLots.push(cleanNewLot);
      existingIds.add(deterministicId);
      existingDividendDates.add(item.couponDate);
      existingDividendYears.add(couponYear);

      if (!syncedCouponIdsInSession.has(deterministicId)) {
        syncedCouponIdsInSession.add(deterministicId);
        const docRef = doc(db, 'lots', deterministicId);
        batch.set(docRef, cleanNewLot);
        batchCount++;
      }
    }
  }

  if (batchCount > 0) {
    try {
      await batch.commit();
    } catch (err) {
      console.error('Failed to auto-sync past Fidelis coupons:', err);
    }
  }

  return newCouponLots.length > 0 ? [...lots, ...newCouponLots] : lots;
}

export async function fetchPortfolios(): Promise<Portfolio[]> {
  if (!auth.currentUser) return [];
  const now = Date.now();
  if (portfoliosCache.promise && now - portfoliosCache.timestamp < DEDUPE_TTL_MS) {
    return portfoliosCache.promise;
  }
  const uid = auth.currentUser.uid;
  const promise = (async () => {
    const q = query(collection(db, 'portfolios'), where('userId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Portfolio));
  })();
  portfoliosCache = { promise, timestamp: now };
  return promise;
}

export async function createPortfolio(name: string, currency: string): Promise<Portfolio> {
  if (!auth.currentUser) throw new Error("Not logged in");
  const id = generateId();
  const portfolio = { id, name, currency, userId: auth.currentUser.uid };
  await setDoc(doc(db, 'portfolios', id), portfolio);
  invalidateDataCache();
  return portfolio as Portfolio;
}

export async function updatePortfolio(id: string, name: string): Promise<Portfolio> {
  if (!auth.currentUser) throw new Error("Not logged in");
  await updateDoc(doc(db, 'portfolios', id), { name });
  invalidateDataCache();
  const snap = await getDoc(doc(db, 'portfolios', id));
  return { id: snap.id, ...snap.data() } as Portfolio;
}

export async function fetchLots(portfolioId: string): Promise<TradeLot[]> {
  if (!auth.currentUser) return [];
  const q = query(collection(db, 'lots'), where('portfolioId', '==', portfolioId), where('userId', '==', auth.currentUser.uid));
  const snap = await getDocs(q);
  const rawLots = snap.docs.map(d => ({ id: d.id, ...d.data() } as TradeLot));
  return await ensureFidelisPastCoupons(rawLots);
}

export async function createLots(portfolioId: string, lots: Partial<TradeLot>[]): Promise<TradeLot[]> {
  if (!auth.currentUser) throw new Error("Not logged in");
  const batch = writeBatch(db);
  const result: TradeLot[] = [];
  
  lots.forEach(lot => {
    const id = lot.id || generateId();
    const docRef = doc(db, 'lots', id);
    const rawLot: Record<string, any> = { ...lot, id, portfolioId, userId: auth.currentUser!.uid };
    const cleanLot = Object.fromEntries(Object.entries(rawLot).filter(([_, v]) => v !== undefined));
    batch.set(docRef, cleanLot);
    result.push(cleanLot as TradeLot);
  });
  
  await batch.commit();
  invalidateDataCache();
  return result;
}

export async function fetchAllLots(): Promise<TradeLot[]> {
  if (!auth.currentUser) return [];
  const now = Date.now();
  if (allLotsCache.promise && now - allLotsCache.timestamp < DEDUPE_TTL_MS) {
    return allLotsCache.promise;
  }
  const uid = auth.currentUser.uid;
  const promise = (async () => {
    const q = query(collection(db, 'lots'), where('userId', '==', uid));
    const snap = await getDocs(q);
    const rawLots = snap.docs.map(d => ({ id: d.id, ...d.data() } as TradeLot));
    return await ensureFidelisPastCoupons(rawLots);
  })();
  allLotsCache = { promise, timestamp: now };
  return promise;
}

export async function updateLot(id: string, lot: Partial<TradeLot>): Promise<TradeLot> {
  if (!auth.currentUser) throw new Error("Not logged in");
  const cleanLot = Object.fromEntries(Object.entries(lot).filter(([_, v]) => v !== undefined));
  await updateDoc(doc(db, 'lots', id), cleanLot);
  invalidateDataCache();
  const snap = await getDoc(doc(db, 'lots', id));
  return { id: snap.id, ...snap.data() } as TradeLot;
}

export async function deleteLot(id: string): Promise<void> {
  if (!auth.currentUser) throw new Error("Not logged in");
  await deleteDoc(doc(db, 'lots', id));
  invalidateDataCache();
}

const CLOUD_RUN_API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL ||
  'https://ais-pre-adnpudfodqqdo7gypg5jls-345451106665.europe-west2.run.app';

function isStaticGithubPagesHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.endsWith('github.io');
}

async function apiFetch(endpoint: string, init?: RequestInit): Promise<Response> {
  if (isStaticGithubPagesHost()) {
    return fetch(`${CLOUD_RUN_API_BASE}${endpoint}`, init);
  }
  const localRes = await fetch(endpoint, init);
  if (localRes.status === 404 || localRes.status === 405) {
    return fetch(`${CLOUD_RUN_API_BASE}${endpoint}`, init);
  }
  return localRes;
}

async function fetchClientFallbackFxRates(): Promise<{ EUR: number; USD: number; RON: number }> {
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=RON,USD');
    if (res.ok) {
      const data = await res.json();
      const eurRon = Number(data?.rates?.RON);
      const eurUsd = Number(data?.rates?.USD);
      if (eurRon > 0 && eurUsd > 0) {
        return {
          EUR: Number(eurRon.toFixed(4)),
          USD: Number((eurRon / eurUsd).toFixed(4)),
          RON: 1,
        };
      }
    }
  } catch {
    // Fall through to default rates
  }
  return { EUR: 4.97, USD: 4.60, RON: 1 };
}

export async function fetchBnrRates(): Promise<{ EUR: number, USD: number, RON: number }> {
  const now = Date.now();
  if (bnrRatesCache.promise && now - bnrRatesCache.timestamp < 30000) {
    return bnrRatesCache.promise;
  }
  const promise = (async () => {
    try {
      const res = await apiFetch('/api/bnr-rates');
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.EUR === 'number' && data.EUR > 0 && typeof data?.USD === 'number' && data.USD > 0) {
          return { EUR: data.EUR, USD: data.USD, RON: 1 };
        }
      }
    } catch {
      // Fall through to client-side ECB/Frankfurter FX fallback
    }
    return fetchClientFallbackFxRates();
  })();
  bnrRatesCache = { promise, timestamp: now };
  return promise;
}

function buildFallbackFidelisQuotes(
  tickers: string[],
  targetCurrency: string,
  rates: { EUR: number; USD: number; RON: number }
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const t of tickers) {
    const meta = parseFidelisTicker(t);
    if (!meta) continue;
    const bondCurrency = meta.currency;
    let fxRate = 1;
    if (targetCurrency && bondCurrency !== targetCurrency) {
      const inRon = bondCurrency === 'EUR' ? (rates.EUR || 4.97) : 1;
      if (targetCurrency === 'RON') fxRate = inRon;
      else if (targetCurrency === 'EUR') fxRate = inRon / (rates.EUR || 4.97);
      else if (targetCurrency === 'USD') fxRate = inRon / (rates.USD || 4.60);
    }
    out[t] = {
      price: meta.nominalPar,
      regularMarketPrice: meta.nominalPar,
      convertedPrice: meta.nominalPar * fxRate,
      currency: bondCurrency,
      fxRate,
      targetCurrency: targetCurrency || bondCurrency,
      quoteType: 'BOND',
      market: 'ro_market',
      exchange: 'BVB',
      shortName: `Titluri de Stat Fidelis ${meta.maturityLabel} (${meta.currency})`,
      sector: 'Government Bonds (Fidelis)',
      industry: 'Romanian Sovereign Debt (BVB)',
    };
  }
  return out;
}

export async function fetchQuotes(tickers: string[], targetCurrency: string): Promise<Record<string, any>> {
  const originalTickers = [...tickers];
  tickers = tickers.map(t => {
    if (t.endsWith('.NL')) return t.replace('.NL', '.AS');
    if (t.endsWith('.US')) return t.replace('.US', '');
    return t;
  });
  try {
    const res = await apiFetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, targetCurrency }),
    });
    if (!res.ok) {
      const rates = await fetchBnrRates();
      return buildFallbackFidelisQuotes(originalTickers, targetCurrency, rates);
    }
    const data = await res.json();
    const remappedData: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      remappedData[key] = val;
      if (key.endsWith('.AS')) remappedData[key.replace('.AS', '.NL')] = val;
      const originalUS = originalTickers.find(t => t === key + '.US');
      if (originalUS) remappedData[originalUS] = val;
    }
    return remappedData;
  } catch {
    const rates = await fetchBnrRates();
    return buildFallbackFidelisQuotes(originalTickers, targetCurrency, rates);
  }
}

export async function fetchHistorical(symbol: string, period: string, retries = 2): Promise<any[]> {
  if (symbol.endsWith('.NL')) symbol = symbol.replace('.NL', '.AS');
  if (symbol.endsWith('.US')) symbol = symbol.replace('.US', '');
  if (parseFidelisTicker(symbol)) return [];
  try {
    const res = await apiFetch('/api/historical', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, period }),
    });
    if (!res.ok) {
      return [];
    }
    return await res.json();
  } catch {
    if (retries > 0 && !isStaticGithubPagesHost()) {
      await new Promise(r => setTimeout(r, 500));
      return fetchHistorical(symbol, period, retries - 1);
    }
    return [];
  }
}

async function fetchClientFallbackFxHistoricalRange(
  currency: string,
  startDate: string,
  endDate: string
): Promise<Record<string, number>> {
  const safeCurrency = currency.toUpperCase();
  if (safeCurrency === 'RON') return {};
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return {};
    }
    start.setDate(start.getDate() - 5);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    const res = await fetch(
      `https://api.frankfurter.dev/v1/${startStr}..${endStr}?base=${encodeURIComponent(safeCurrency)}&symbols=RON`
    );
    if (!res.ok) return {};
    const data = await res.json();
    const rawRates: Record<string, number> = {};
    let lastValidRate = safeCurrency === 'EUR' ? 4.97 : 4.60;
    for (const [d, obj] of Object.entries(data?.rates || {})) {
      const r = Number((obj as any)?.RON);
      if (r > 0) {
        rawRates[d] = r;
        lastValidRate = r;
      }
    }
    const finalRates: Record<string, number> = {};
    const current = new Date(start);
    let currentRate = Object.values(rawRates)[0] || lastValidRate;
    while (current <= end) {
      const dString = current.toISOString().split('T')[0];
      if (rawRates[dString]) {
        currentRate = rawRates[dString];
      }
      finalRates[dString] = currentRate;
      current.setDate(current.getDate() + 1);
    }
    return finalRates;
  } catch {
    return {};
  }
}

export async function fetchFxHistoricalRange(currency: string, startDate: string, endDate: string, retries = 2): Promise<Record<string, number>> {
  if (currency.toUpperCase() === 'RON') return {};
  try {
    const res = await apiFetch('/api/fx-historical-range', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency, startDate, endDate }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        return data;
      }
    }
  } catch {
    if (retries > 0 && !isStaticGithubPagesHost()) {
      await new Promise(r => setTimeout(r, 500));
      return fetchFxHistoricalRange(currency, startDate, endDate, retries - 1);
    }
  }
  return fetchClientFallbackFxHistoricalRange(currency, startDate, endDate);
}

export interface AnalyzeResult {
  ticker: string;
  companyName: string;
  currentPrice: number;
  priceDirection: 'Up' | 'Down' | 'Flat';
  marketSentiment: 'Bullish' | 'Bearish' | 'Neutral';
  objectiveBullets: string[];
  recommendation: 'BUY' | 'SELL' | 'WAIT';
  recommendationRationale: string;
}

export async function analyzeHoldings(holdings: any[]): Promise<AnalyzeResult[]> {
  const res = await apiFetch('/api/advisor/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdings })
  });
  if (!res.ok) {
    throw new Error('Failed to run analysis');
  }
  return res.json();
}

export interface PortfolioAnalysisResult {
  riskLevel: string;
  diversificationScore: number;
  keyObservations: string[];
  actionableRecommendations: string[];
  sectorBreakdownEstimate: {
    sectorName: string;
    percentage: number;
    commentary: string;
  }[];
}

export async function analyzePortfolio(holdings: any[], currency: string, totalValue: number): Promise<PortfolioAnalysisResult> {
  const res = await apiFetch('/api/advisor/analyze-portfolio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdings, currency, totalValue }),
  });
  if (!res.ok) {
    throw new Error('Failed to analyze portfolio');
  }
  return res.json();
}

export async function fetchUserSettings(): Promise<UserSettings | null> {
  if (!auth.currentUser) return null;
  const snap = await getDoc(doc(db, 'userSettings', auth.currentUser.uid));
  if (snap.exists()) {
    return snap.data() as UserSettings;
  }
  return null;
}

export async function updateUserSettings(settings: Partial<UserSettings>): Promise<void> {
  if (!auth.currentUser) throw new Error("Not logged in");
  await setDoc(doc(db, 'userSettings', auth.currentUser.uid), settings, { merge: true });
}
