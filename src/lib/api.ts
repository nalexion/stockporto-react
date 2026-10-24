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
              couponRate!,
              couponStartDate,
              settleDate,
              fidelis.nominalPar
            );
            if (calc && calc.daysElapsed > 0) {
              const accPerUnit = Number(
                (fidelis.nominalPar * (couponRate! / 100) * (calc.daysElapsed / 365)).toFixed(4)
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

const CUSTOM_API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || '';
const CLOUD_RUN_API_BASE =
  CUSTOM_API_BASE ||
  'https://ais-pre-adnpudfodqqdo7gypg5jls-345451106665.europe-west2.run.app';

function isStaticGithubPagesHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.endsWith('github.io');
}

async function apiFetch(endpoint: string, init?: RequestInit): Promise<Response> {
  if (isStaticGithubPagesHost()) {
    if (!CUSTOM_API_BASE) {
      throw new Error('Static GitHub Pages host: using client-side market & intelligence engine');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      return await fetch(`${CUSTOM_API_BASE}${endpoint}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  const localRes = await fetch(endpoint, init);
  if (localRes.status === 404 || localRes.status === 405) {
    return fetch(`${CLOUD_RUN_API_BASE}${endpoint}`, init);
  }
  return localRes;
}

const KNOWN_PROFILES: Record<string, { sector: string; industry: string; name?: string }> = {
  'TLV.RO': { sector: 'Financial Services', industry: 'Banks - Regional', name: 'Banca Transilvania S.A.' },
  'BRD.RO': { sector: 'Financial Services', industry: 'Banks - Regional', name: 'BRD - Groupe Société Générale' },
  'SNP.RO': { sector: 'Energy', industry: 'Oil & Gas Integrated', name: 'OMV Petrom S.A.' },
  'SNG.RO': { sector: 'Energy', industry: 'Oil & Gas E&P', name: 'S.N.G.N. Romgaz S.A.' },
  'H2O.RO': { sector: 'Utilities', industry: 'Utilities - Renewable', name: 'S.P.E.E.H. Hidroelectrica S.A.' },
  'SNN.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Electric', name: 'S.N. Nuclearelectrica S.A.' },
  'DIGI.RO': { sector: 'Communication Services', industry: 'Telecom Services', name: 'Digi Communications N.V.' },
  'FP.RO': { sector: 'Financial Services', industry: 'Asset Management', name: 'Fondul Proprietatea S.A.' },
  'TTS.RO': { sector: 'Industrials', industry: 'Marine Shipping & Logistics', name: 'Transport Trade Services S.A.' },
  'ONE.RO': { sector: 'Real Estate', industry: 'Real Estate - Development', name: 'One United Properties S.A.' },
  'AQ.RO': { sector: 'Industrials', industry: 'Trucking & Freight Logistics', name: 'Aquila Part Prod Com S.A.' },
  'M.RO': { sector: 'Healthcare', industry: 'Medical Care Facilities', name: 'MedLife S.A.' },
  'BVB.RO': { sector: 'Financial Services', industry: 'Financial Data & Stock Exchanges', name: 'Bursa de Valori Bucuresti S.A.' },
  'EL.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Electric', name: 'Societatea Energetica Electrica S.A.' },
  'TGN.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Gas', name: 'S.N.T.G.N. Transgaz S.A.' },
  'TEL.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Electric', name: 'C.N.T.E.E. Transelectrica S.A.' },
  'TRP.RO': { sector: 'Industrials', industry: 'Building Products & Piping', name: 'TeraPlast S.A.' },
  'WINE.RO': { sector: 'Consumer Defensive', industry: 'Beverages - Wineries & Distilleries', name: 'Purcari Wineries Public Co. Ltd.' },
  'BIO.RO': { sector: 'Healthcare', industry: 'Drug Manufacturers - Specialty', name: 'Biofarm S.A.' },
  'ALR.RO': { sector: 'Basic Materials', industry: 'Aluminum', name: 'Alro S.A.' },
  'SFG.RO': { sector: 'Consumer Cyclical', industry: 'Restaurants', name: 'Sphera Franchise Group S.A.' },
  'ATB.RO': { sector: 'Healthcare', industry: 'Drug Manufacturers - Specialty', name: 'Antibiotice S.A.' },
  'SOCP.RO': { sector: 'Energy', industry: 'Oil & Gas Equipment & Services', name: 'Socep S.A.' },
  'COTE.RO': { sector: 'Energy', industry: 'Oil & Gas Midstream', name: 'Conpet S.A.' },
  'IAR.RO': { sector: 'Industrials', industry: 'Aerospace & Defense', name: 'IAR S.A. Brasov' },
  'AROBS.RO': { sector: 'Technology', industry: 'Software - Application', name: 'AROBS Transilvania Software S.A.' },
  '2P.RO': { sector: 'Technology', industry: 'Advertising & Marketing Tech', name: '2Performant Network S.A.' },
  'SAFE.RO': { sector: 'Technology', industry: 'Cybersecurity & Infrastructure', name: 'Safetech Innovations S.A.' },
  'DN.RO': { sector: 'Consumer Defensive', industry: 'Farm Products & Dairy', name: 'DN Agrar Group S.A.' },
  'ROCE.RO': { sector: 'Basic Materials', industry: 'Chemicals & Plastics', name: 'Romcarbon S.A.' },
  'ALU.RO': { sector: 'Basic Materials', industry: 'Aluminum & Building Materials', name: 'Alumil Rom Industry S.A.' },
  'IMP.RO': { sector: 'Real Estate', industry: 'Real Estate - Development', name: 'Impact Developer & Contractor S.A.' },
  'TBK.RO': { sector: 'Financial Services', industry: 'Insurance Brokers', name: 'Transilvania Broker de Asigurare S.A.' },
  'EVER.RO': { sector: 'Financial Services', industry: 'Asset Management', name: 'EVERGENT Investments S.A.' },
  'INFINITY.RO': { sector: 'Financial Services', industry: 'Asset Management', name: 'Infinity Capital Investments S.A.' },
  'LION.RO': { sector: 'Financial Services', industry: 'Asset Management', name: 'Lion Capital S.A.' },
  'TRANSI.RO': { sector: 'Financial Services', industry: 'Asset Management', name: 'Transilvania Investments Alliance S.A.' },
  'CMCM.RO': { sector: 'Basic Materials', industry: 'Building Materials', name: 'COMCM S.A. Constanta' },
  'TVBETETF.RO': { sector: 'ETFs & Funds', industry: 'Index Tracking Equity ETFs', name: 'Fondul Deschis de Investitii ETF BET Patria-Tradeville' },
  'PTENGETF.RO': { sector: 'ETFs & Funds', industry: 'Energy Sector ETFs', name: 'ETF Energie Patria-Tradeville' },
  'CSPX.AS': { sector: 'ETFs & Funds', industry: 'Large Cap Blend Index ETFs', name: 'iShares Core S&P 500 UCITS ETF' },
  'VWCE.DE': { sector: 'ETFs & Funds', industry: 'Global Equity Index ETFs', name: 'Vanguard FTSE All-World UCITS ETF' },
  'VUAA.DE': { sector: 'ETFs & Funds', industry: 'Large Cap Blend Index ETFs', name: 'Vanguard S&P 500 UCITS ETF' },
  'EUNL.DE': { sector: 'ETFs & Funds', industry: 'Developed World Index ETFs', name: 'iShares Core MSCI World UCITS ETF' },
  'IS3N.DE': { sector: 'ETFs & Funds', industry: 'Emerging Markets Index ETFs', name: 'iShares Core MSCI EM IMI UCITS ETF' },
  'IWDA.AS': { sector: 'ETFs & Funds', industry: 'Developed World Index ETFs', name: 'iShares Core MSCI World UCITS ETF' },
  'QDVE.DE': { sector: 'ETFs & Funds', industry: 'Technology Sector ETFs', name: 'iShares S&P 500 Information Technology Sector UCITS ETF' },
  'SX8P.DE': { sector: 'ETFs & Funds', industry: 'Technology Sector ETFs', name: 'iShares STOXX Europe 600 Technology UCITS ETF' },
};

function getClientSectorProfile(symbol: string, quoteType?: string): { sector: string; industry: string; name?: string } {
  const upper = (symbol || '').trim().toUpperCase();
  const normalized = upper.endsWith('.NL') ? upper.replace('.NL', '.AS') : upper.endsWith('.US') ? upper.replace('.US', '') : upper;
  const fidelis = parseFidelisTicker(normalized);
  if (fidelis) {
    return {
      sector: 'Government Bonds (Fidelis)',
      industry: 'Romanian Sovereign Debt (BVB)',
      name: `Titluri de Stat Fidelis ${fidelis.maturityLabel} (${fidelis.currency})`,
    };
  }
  if (KNOWN_PROFILES[normalized]) {
    return KNOWN_PROFILES[normalized];
  }
  if (KNOWN_PROFILES[upper]) {
    return KNOWN_PROFILES[upper];
  }
  if (quoteType === 'ETF' || normalized.includes('ETF')) {
    return { sector: 'ETFs & Funds', industry: 'Exchange Traded Index Funds' };
  }
  return { sector: 'Diversified Operations', industry: 'Diversified Commercial Operations' };
}

function computeClientFxRate(
  fromCurrency: string,
  toCurrency: string,
  rates: { EUR: number; USD: number; RON: number }
): number {
  const from = (fromCurrency || 'RON').toUpperCase();
  const to = (toCurrency || from).toUpperCase();
  if (from === to) return 1;

  const eurRon = rates.EUR || 4.97;
  const usdRon = rates.USD || 4.60;

  let inRon = 1;
  if (from === 'RON') inRon = 1;
  else if (from === 'EUR') inRon = eurRon;
  else if (from === 'USD') inRon = usdRon;
  else if (from === 'GBP') inRon = eurRon * 1.17;
  else inRon = 1;

  if (to === 'RON') return inRon;
  if (to === 'EUR') return inRon / eurRon;
  if (to === 'USD') return inRon / usdRon;
  return 1;
}

// Client-side CORS proxy cascade & in-memory Yahoo Finance v8 chart cache
const CORS_PROXY_BUILDERS: ((url: string) => string)[] = [
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];
let preferredProxyIdx = 0;

const clientQuoteMetaCache = new Map<string, { meta: any; lastClose: number; timestamp: number }>();
const clientChartSeriesCache = new Map<string, { points: any[]; timestamp: number }>();
const inFlightYahooRequests = new Map<string, Promise<{ meta: any; points: any[] } | null>>();

async function fetchJsonViaCorsProxy(targetUrl: string, timeoutMs = 6500): Promise<any> {
  const totalProxies = CORS_PROXY_BUILDERS.length;
  for (let attempt = 0; attempt < totalProxies; attempt++) {
    const idx = (preferredProxyIdx + attempt) % totalProxies;
    const proxyUrl = CORS_PROXY_BUILDERS[idx](targetUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.trim().startsWith('<')) continue;
      const parsed = JSON.parse(text);
      preferredProxyIdx = idx;
      return parsed;
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

async function fetchTextViaCorsProxy(targetUrl: string, timeoutMs = 5000): Promise<string | null> {
  const totalProxies = CORS_PROXY_BUILDERS.length;
  for (let attempt = 0; attempt < totalProxies; attempt++) {
    const idx = (preferredProxyIdx + attempt) % totalProxies;
    const proxyUrl = CORS_PROXY_BUILDERS[idx](targetUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.length > 50) {
        preferredProxyIdx = idx;
        return text;
      }
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

function normalizeCurrencyAndPrice(rawPrice: number, rawCurrency?: string, symbol?: string): { price: number; currency: string } {
  let price = Number(rawPrice) || 0;
  let currency = (rawCurrency || (symbol?.endsWith('.RO') ? 'RON' : 'USD')).trim();
  if (currency === 'ROX') {
    price = price / 100;
    currency = 'RON';
  } else if (currency === 'GBp' || currency === 'GBX') {
    price = price / 100;
    currency = 'GBP';
  }
  return { price, currency: currency.toUpperCase() };
}

function mapPeriodToYahooRangeAndInterval(period: string): { range: string; interval: string } {
  switch (period) {
    case '1d':
      return { range: '2d', interval: '15m' };
    case '5d':
      return { range: '5d', interval: '60m' };
    case '1mo':
      return { range: '1mo', interval: '1d' };
    case '3mo':
      return { range: '3mo', interval: '1d' };
    case '6mo':
      return { range: '6mo', interval: '1d' };
    case '1y':
      return { range: '1y', interval: '1wk' };
    case '5y':
      return { range: '5y', interval: '1mo' };
    case 'ytd':
      return { range: 'ytd', interval: '1d' };
    case 'max':
      return { range: 'max', interval: '1mo' };
    default:
      return { range: '6mo', interval: '1d' };
  }
}

async function fetchYahooChartClient(
  symbol: string,
  range = '5d',
  interval = '1d'
): Promise<{ meta: any; points: any[] } | null> {
  const cleanSym = symbol.trim().toUpperCase();
  const cacheKey = `${cleanSym}::${range}::${interval}`;
  const now = Date.now();

  if (inFlightYahooRequests.has(cacheKey)) {
    return inFlightYahooRequests.get(cacheKey)!;
  }

  const promise = (async () => {
    const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
    for (const host of hosts) {
      const url = `${host}/v8/finance/chart/${encodeURIComponent(cleanSym)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false`;
      const json = await fetchJsonViaCorsProxy(url);
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const meta = result.meta || {};
      const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
      const quoteObj = result.indicators?.quote?.[0] || {};
      const closes: any[] = Array.isArray(quoteObj.close) ? quoteObj.close : [];
      const opens: any[] = Array.isArray(quoteObj.open) ? quoteObj.open : [];
      const highs: any[] = Array.isArray(quoteObj.high) ? quoteObj.high : [];
      const lows: any[] = Array.isArray(quoteObj.low) ? quoteObj.low : [];
      const volumes: any[] = Array.isArray(quoteObj.volume) ? quoteObj.volume : [];

      const rawCurrency = meta.currency || (cleanSym.endsWith('.RO') ? 'RON' : 'USD');
      const scaleFactor = rawCurrency === 'ROX' || rawCurrency === 'GBp' || rawCurrency === 'GBX' ? 0.01 : 1;

      const points: any[] = [];
      let lastValidClose = 0;
      for (let i = 0; i < timestamps.length; i++) {
        const rawClose = closes[i];
        if (typeof rawClose === 'number' && !Number.isNaN(rawClose) && rawClose > 0) {
          const close = Number((rawClose * scaleFactor).toFixed(4));
          const open = typeof opens[i] === 'number' && !Number.isNaN(opens[i]) ? Number((opens[i] * scaleFactor).toFixed(4)) : close;
          const high = typeof highs[i] === 'number' && !Number.isNaN(highs[i]) ? Number((highs[i] * scaleFactor).toFixed(4)) : close;
          const low = typeof lows[i] === 'number' && !Number.isNaN(lows[i]) ? Number((lows[i] * scaleFactor).toFixed(4)) : close;
          const volume = typeof volumes[i] === 'number' && !Number.isNaN(volumes[i]) ? volumes[i] : 0;
          lastValidClose = close;
          points.push({
            date: new Date(timestamps[i] * 1000).toISOString(),
            close,
            open,
            high,
            low,
            volume,
          });
        }
      }

      if (meta.regularMarketPrice || lastValidClose > 0) {
        clientQuoteMetaCache.set(cleanSym, {
          meta,
          lastClose: lastValidClose,
          timestamp: Date.now(),
        });
      }
      if (points.length > 0) {
        clientChartSeriesCache.set(cacheKey, { points, timestamp: Date.now() });
      }
      return { meta, points };
    }

    // If intraday interval (15m / 60m) failed on Yahoo, fallback to 1d interval
    if (interval !== '1d') {
      const fallbackUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSym)}?range=1mo&interval=1d&includePrePost=false`;
      const json = await fetchJsonViaCorsProxy(fallbackUrl);
      const result = json?.chart?.result?.[0];
      if (result) {
        const meta = result.meta || {};
        const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
        const quoteObj = result.indicators?.quote?.[0] || {};
        const closes: any[] = Array.isArray(quoteObj.close) ? quoteObj.close : [];
        const rawCurrency = meta.currency || (cleanSym.endsWith('.RO') ? 'RON' : 'USD');
        const scaleFactor = rawCurrency === 'ROX' || rawCurrency === 'GBp' || rawCurrency === 'GBX' ? 0.01 : 1;
        const points: any[] = [];
        let lastValidClose = 0;
        for (let i = 0; i < timestamps.length; i++) {
          const rawClose = closes[i];
          if (typeof rawClose === 'number' && !Number.isNaN(rawClose) && rawClose > 0) {
            const close = Number((rawClose * scaleFactor).toFixed(4));
            lastValidClose = close;
            points.push({
              date: new Date(timestamps[i] * 1000).toISOString(),
              close,
              open: close,
              high: close,
              low: close,
              volume: 0,
            });
          }
        }
        if (meta.regularMarketPrice || lastValidClose > 0) {
          clientQuoteMetaCache.set(cleanSym, { meta, lastClose: lastValidClose, timestamp: Date.now() });
        }
        return { meta, points };
      }
    }

    return null;
  })();

  inFlightYahooRequests.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlightYahooRequests.delete(cacheKey);
  }
}

async function fetchBvbSpotPriceClient(roTicker: string): Promise<number | null> {
  const baseSym = roTicker.trim().toUpperCase().replace(/\.RO$/i, '');
  const url = `https://m.bvb.ro/FinancialInstruments/Details/FinancialInstrumentsDetails.aspx?s=${encodeURIComponent(baseSym)}`;
  const html = await fetchTextViaCorsProxy(url, 4500);
  if (!html) return null;

  const patterns = [
    /ctl00_body_ctl02_PricesControl_dvCPrices[\s\S]*?(\d+[.,]\d{2,4})/i,
    /(?:Ultimul pret|Last price|Pret referinta|Reference price)[^0-9]{1,80}(\d+[.,]\d{2,4})/i,
  ];
  for (const regex of patterns) {
    const match = html.match(regex);
    if (match && match[1]) {
      const val = parseFloat(match[1].replace(',', '.'));
      if (!Number.isNaN(val) && val > 0) {
        return val;
      }
    }
  }
  return null;
}

async function fetchClientFallbackQuotes(
  originalTickers: string[],
  normalizedTickers: string[],
  targetCurrency: string
): Promise<Record<string, any>> {
  const rates = await fetchBnrRates();
  const safeTarget = (targetCurrency || 'RON').toUpperCase();
  const out: Record<string, any> = buildFallbackFidelisQuotes(originalTickers, safeTarget, rates);

  const uniqueStandard = Array.from(
    new Set(normalizedTickers.filter(t => !parseFidelisTicker(t) && t !== '$$CASH_TX'))
  );

  const now = Date.now();
  const QUOTE_TTL_MS = 5 * 60 * 1000;

  await Promise.all(
    uniqueStandard.map(async sym => {
      const upper = sym.trim().toUpperCase();

      // Handle explicit FX pair quotes if requested
      if (upper.endsWith('=X')) {
        const pair = upper.replace('=X', '');
        const from = pair.slice(0, 3);
        const to = pair.slice(3, 6) || 'RON';
        const fxPrice = computeClientFxRate(from, to, rates);
        out[sym] = {
          price: fxPrice,
          regularMarketPrice: fxPrice,
          convertedPrice: fxPrice,
          currency: to,
          fxRate: 1,
          targetCurrency: safeTarget,
          quoteType: 'CURRENCY',
          market: 'fx_market',
          exchange: 'CCY',
          shortName: upper,
          sector: 'Currencies',
          industry: 'Foreign Exchange',
        };
        return;
      }

      let meta: any = null;
      let fallbackLastClose = 0;
      const cached = clientQuoteMetaCache.get(upper);
      if (cached && now - cached.timestamp < QUOTE_TTL_MS) {
        meta = cached.meta;
        fallbackLastClose = cached.lastClose;
      } else {
        const chartData = await fetchYahooChartClient(upper, '5d', '1d');
        if (chartData) {
          meta = chartData.meta;
          fallbackLastClose =
            chartData.points.length > 0 ? chartData.points[chartData.points.length - 1].close : 0;
        }
      }

      const profile = getClientSectorProfile(upper, meta?.instrumentType);
      let rawPrice =
        Number(meta?.regularMarketPrice) ||
        Number(meta?.previousClose) ||
        Number(meta?.chartPreviousClose) ||
        fallbackLastClose ||
        0;
      let rawCurrency = meta?.currency || (upper.endsWith('.RO') ? 'RON' : 'USD');

      // Secondary fallback to BVB spot page for .RO equities/ETFs if Yahoo Finance did not return a price
      if (rawPrice <= 0 && upper.endsWith('.RO')) {
        const bvbPrice = await fetchBvbSpotPriceClient(upper);
        if (bvbPrice && bvbPrice > 0) {
          rawPrice = bvbPrice;
          rawCurrency = 'RON';
        }
      }

      if (rawPrice <= 0) return;

      const normalized = normalizeCurrencyAndPrice(
        // If fallbackLastClose was already scaled when rawMarketPrice was missing, avoid double-scaling
        Number(meta?.regularMarketPrice) || Number(meta?.previousClose) || Number(meta?.chartPreviousClose)
          ? rawPrice
          : fallbackLastClose,
        Number(meta?.regularMarketPrice) || Number(meta?.previousClose) || Number(meta?.chartPreviousClose)
          ? rawCurrency
          : rawCurrency === 'ROX'
            ? 'RON'
            : rawCurrency === 'GBp' || rawCurrency === 'GBX'
              ? 'GBP'
              : rawCurrency,
        upper
      );

      const fxRate = computeClientFxRate(normalized.currency, safeTarget, rates);
      const quotePayload = {
        price: normalized.price,
        regularMarketPrice: normalized.price,
        convertedPrice: normalized.price * fxRate,
        currency: normalized.currency,
        fxRate,
        targetCurrency: safeTarget,
        quoteType: meta?.instrumentType || (upper.includes('ETF') ? 'ETF' : 'EQUITY'),
        market: upper.endsWith('.RO') ? 'ro_market' : 'global_market',
        exchange: meta?.exchangeName || (upper.endsWith('.RO') ? 'BVB' : ''),
        shortName: profile.name || meta?.shortName || meta?.longName || upper,
        sector: profile.sector,
        industry: profile.industry,
      };

      out[upper] = quotePayload;
      if (upper.endsWith('.AS')) out[upper.replace('.AS', '.NL')] = quotePayload;
      const originalUS = originalTickers.find(t => t.toUpperCase() === `${upper}.US`);
      if (originalUS) out[originalUS] = quotePayload;
    })
  );

  return out;
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
  const normalizedTickers = tickers.map(t => {
    const trimmed = t.trim().toUpperCase();
    if (trimmed.endsWith('.NL')) return trimmed.replace('.NL', '.AS');
    if (trimmed.endsWith('.US')) return trimmed.replace('.US', '');
    return trimmed;
  });
  try {
    const res = await apiFetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: normalizedTickers, targetCurrency }),
    });
    if (!res.ok) {
      return fetchClientFallbackQuotes(originalTickers, normalizedTickers, targetCurrency);
    }
    const data = await res.json();
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      return fetchClientFallbackQuotes(originalTickers, normalizedTickers, targetCurrency);
    }
    const remappedData: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      remappedData[key] = val;
      if (key.endsWith('.AS')) remappedData[key.replace('.AS', '.NL')] = val;
      const originalUS = originalTickers.find(t => t.toUpperCase() === key.toUpperCase() + '.US');
      if (originalUS) remappedData[originalUS] = val;
    }
    return remappedData;
  } catch {
    return fetchClientFallbackQuotes(originalTickers, normalizedTickers, targetCurrency);
  }
}

async function fetchClientFallbackHistorical(symbol: string, period: string): Promise<any[]> {
  const cleanSym = symbol.trim().toUpperCase();
  if (parseFidelisTicker(cleanSym)) return [];

  const { range, interval } = mapPeriodToYahooRangeAndInterval(period);
  const cacheKey = `${cleanSym}::${range}::${interval}`;
  const cached = clientChartSeriesCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000 && cached.points.length > 0) {
    return cached.points;
  }

  const res = await fetchYahooChartClient(cleanSym, range, interval);
  return res?.points || [];
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
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch {
    if (retries > 0 && !isStaticGithubPagesHost()) {
      await new Promise(r => setTimeout(r, 500));
      return fetchHistorical(symbol, period, retries - 1);
    }
  }
  return fetchClientFallbackHistorical(symbol, period);
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

function getClientGeminiApiKey(): string {
  const key = ((import.meta as any).env?.VITE_GEMINI_API_KEY || '').trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return '';
  return key;
}

function buildQuantitativeHoldingsAnalysis(holdings: any[]): AnalyzeResult[] {
  return (holdings || []).map(holding => {
    const safeTicker = String(holding?.ticker || 'UNKNOWN').trim().toUpperCase();
    const profile = getClientSectorProfile(safeTicker);
    const fidelis = parseFidelisTicker(safeTicker);
    const safeCompany = String(holding?.companyName || profile.name || safeTicker).trim();
    const avg = Number(holding?.avgBuyPrice) || 0;
    const cur = Number(holding?.currentPrice) || avg || 0;
    const pnl = Number(holding?.unrealizedPnL) || (cur - avg) * (Number(holding?.shares) || 0);
    const days = Math.max(0, Math.floor(Number(holding?.holdingDays) || 0));
    const pnlPercent = avg > 0 ? ((cur - avg) / avg) * 100 : 0;

    const priceDirection: 'Up' | 'Down' | 'Flat' =
      pnlPercent > 0.25 ? 'Up' : pnlPercent < -0.25 ? 'Down' : 'Flat';

    if (fidelis) {
      return {
        ticker: safeTicker,
        companyName: safeCompany,
        currentPrice: cur,
        priceDirection,
        marketSentiment: 'Bullish',
        objectiveBullets: [
          `Romanian sovereign Fidelis issue (${fidelis.currency}) maturing in ${fidelis.maturityLabel}; coupon and capital gains are 100% exempt from Romanian income tax and CASS.`,
          `Trading at ${cur.toFixed(2)} ${fidelis.currency} vs. cost basis of ${avg.toFixed(2)} ${fidelis.currency} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% clean price variance over ${days} holding days).`,
          `Provides sovereign fixed-income ballast and predictable annual coupon cash flows with low mark-to-market volatility.`,
        ],
        recommendation: pnlPercent < -1.5 ? 'BUY' : 'WAIT',
        recommendationRationale: `Hold to collect tax-exempt sovereign coupons through ${fidelis.maturityLabel}; secondary market discounts below par offer attractive yield-to-maturity entry points.`,
      };
    }

    const sentiment: 'Bullish' | 'Bearish' | 'Neutral' =
      pnlPercent > 6 ? 'Bullish' : pnlPercent < -6 ? 'Bearish' : 'Neutral';

    let recommendation: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
    if (pnlPercent <= -12) {
      recommendation = 'BUY';
    } else if (pnlPercent >= 30 && days >= 365) {
      recommendation = 'SELL';
    } else if (pnlPercent >= -5 && pnlPercent <= 10 && (profile.sector === 'ETFs & Funds' || days < 180)) {
      recommendation = 'BUY';
    }

    const taxHorizonNote =
      days >= 365
        ? `Position has surpassed the 365-day threshold (${days} days held), qualifying for the reduced long-term resident brokerage capital gains tax tier.`
        : `Held for ${days} days (${Math.max(0, 365 - days)} days remaining to reach the 365-day long-term resident capital gains tax reduction threshold).`;

    const sectorCatalystNote =
      profile.sector === 'ETFs & Funds'
        ? `Broad index exposure via ${profile.industry} mitigates single-company idiosyncratic risk and compounds reinvested distributions.`
        : profile.sector === 'Financial Services'
          ? `Positioned in ${profile.sector} (${profile.industry}), where net asset value discounts, capital returns, and dividend distributions drive total shareholder return.`
          : `Operates within ${profile.sector} (${profile.industry}), with valuation anchored by cash generation, margin resilience, and regional demand.`;

    return {
      ticker: safeTicker,
      companyName: safeCompany,
      currentPrice: cur,
      priceDirection,
      marketSentiment: sentiment,
      objectiveBullets: [
        `Trading at ${cur.toFixed(2)} against an average cost basis of ${avg.toFixed(2)}, representing a ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% unrealized return (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}).`,
        sectorCatalystNote,
        taxHorizonNote,
      ],
      recommendation,
      recommendationRationale:
        recommendation === 'BUY'
          ? `Current valuation (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% vs. cost basis) supports disciplined accumulation in ${safeTicker}.`
          : recommendation === 'SELL'
            ? `Strong appreciation (+${pnlPercent.toFixed(1)}%) and long-term holding eligibility (>365 days) favor partial profit-taking and rebalancing.`
            : `Position exhibits ${priceDirection.toLowerCase()} trajectory (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%); maintain current allocation and monitor upcoming earnings/dividend catalysts.`,
    };
  });
}

export async function analyzeHoldings(holdings: any[]): Promise<AnalyzeResult[]> {
  try {
    const res = await apiFetch('/api/advisor/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdings }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch {
    // Fall through to client-side Gemini or quantitative engine
  }

  const clientApiKey = getClientGeminiApiKey();
  if (clientApiKey && Array.isArray(holdings) && holdings.length > 0) {
    try {
      const { GoogleGenAI, Type } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: clientApiKey });
      const results: AnalyzeResult[] = [];
      for (const holding of holdings.slice(0, 25)) {
        const safeTicker = String(holding?.ticker || 'UNKNOWN').trim().toUpperCase();
        const profile = getClientSectorProfile(safeTicker);
        const safeCompany = String(holding?.companyName || profile.name || safeTicker).trim();
        const prompt = `Analyze the current market situation and position metrics for ${safeCompany} (${safeTicker}).
Operating Sector: ${profile.sector}, Industry: ${profile.industry}
User holding context:
- Shares: ${Number(holding?.shares) || 0}
- Average Buy Price: ${Number(holding?.avgBuyPrice) || 0}
- Current Price: ${Number(holding?.currentPrice) || 0}
- Unrealized PnL: ${Number(holding?.unrealizedPnL) || 0}
- Holding Days: ${Math.max(0, Math.floor(Number(holding?.holdingDays) || 0))}

Provide objective market insights, corporate catalysts, price direction (Up, Down, Flat), market sentiment (Bullish, Bearish, Neutral), recommendation (BUY, SELL, WAIT), and a concise rationale.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                ticker: { type: Type.STRING },
                companyName: { type: Type.STRING },
                currentPrice: { type: Type.NUMBER },
                priceDirection: { type: Type.STRING },
                marketSentiment: { type: Type.STRING },
                objectiveBullets: { type: Type.ARRAY, items: { type: Type.STRING } },
                recommendation: { type: Type.STRING },
                recommendationRationale: { type: Type.STRING },
              },
              required: [
                'ticker',
                'companyName',
                'currentPrice',
                'priceDirection',
                'marketSentiment',
                'objectiveBullets',
                'recommendation',
                'recommendationRationale',
              ],
            },
          },
        });
        if (response.text) {
          results.push(JSON.parse(response.text));
        }
      }
      if (results.length > 0) return results;
    } catch {
      // Fall through to deterministic quantitative engine
    }
  }

  return buildQuantitativeHoldingsAnalysis(holdings);
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

function buildQuantitativePortfolioAnalysis(
  holdings: any[],
  currency: string,
  totalValue: number
): PortfolioAnalysisResult {
  const safeCurrency = (currency || 'RON').toUpperCase();
  const validHoldings = (holdings || []).filter(h => Number(h?.value) > 0);
  const computedTotal =
    totalValue > 0 ? totalValue : validHoldings.reduce((acc, h) => acc + (Number(h?.value) || 0), 0);
  const denom = computedTotal > 0 ? computedTotal : 1;

  const sortedHoldings = [...validHoldings].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  const weights = sortedHoldings.map(h => (Number(h.value) || 0) / denom);
  const hhi = weights.reduce((acc, w) => acc + w * w, 0);
  const effectivePositions = hhi > 0 ? 1 / hhi : sortedHoldings.length;
  const topWeightPct = weights.length > 0 ? weights[0] * 100 : 0;
  const topTicker = sortedHoldings[0]?.ticker || 'N/A';

  const sectorTotals = new Map<string, number>();
  let bondWeight = 0;
  let etfWeight = 0;

  for (const h of sortedHoldings) {
    const val = Number(h.value) || 0;
    const profile = getClientSectorProfile(h.ticker);
    sectorTotals.set(profile.sector, (sectorTotals.get(profile.sector) || 0) + val);
    if (profile.sector === 'Government Bonds (Fidelis)') bondWeight += val / denom;
    if (profile.sector === 'ETFs & Funds') etfWeight += val / denom;
  }

  const sectorBreakdownEstimate = Array.from(sectorTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([sectorName, val]) => {
      const pct = Math.max(1, Math.round((val / denom) * 100));
      let commentary = 'Core portfolio allocation segment.';
      if (sectorName === 'Government Bonds (Fidelis)') {
        commentary = 'Tax-exempt Romanian sovereign fixed income stabilizing portfolio volatility.';
      } else if (sectorName === 'ETFs & Funds') {
        commentary = 'Broad index-tracking exposure providing multi-constituent diversification.';
      } else if (pct > 40) {
        commentary = 'High sector concentration; monitor industry-specific regulatory and macro sensitivity.';
      } else if (pct >= 15) {
        commentary = 'Balanced strategic sector weighting contributing to growth and dividend yield.';
      } else {
        commentary = 'Satellite sector position enhancing overall portfolio breadth.';
      }
      return { sectorName, percentage: pct, commentary };
    });

  // Compute 0-100 diversification score factoring in effective positions, ETF/Bond breadth, and sector count
  const baseCountScore = Math.min(45, effectivePositions * 9);
  const sectorScore = Math.min(30, sectorTotals.size * 8);
  const indexCushionBonus = Math.min(25, (etfWeight + bondWeight) * 35);
  const concentrationPenalty = topWeightPct > 55 ? Math.round((topWeightPct - 55) * 0.5) : 0;
  const diversificationScore = Math.max(
    18,
    Math.min(95, Math.round(baseCountScore + sectorScore + indexCushionBonus - concentrationPenalty))
  );

  let riskLevel = 'Moderate';
  if (bondWeight >= 0.5) {
    riskLevel = 'Low';
  } else if (topWeightPct > 60 && etfWeight < 0.25 && bondWeight < 0.2) {
    riskLevel = 'High';
  } else if (diversificationScore >= 65) {
    riskLevel = 'Moderate';
  } else if (sortedHoldings.length <= 2 && etfWeight < 0.3) {
    riskLevel = 'Concentrated';
  }

  const keyObservations: string[] = [
    `Portfolio comprises ${sortedHoldings.length} active position${sortedHoldings.length === 1 ? '' : 's'} across ${sectorTotals.size} distinct sector${sectorTotals.size === 1 ? '' : 's'} with a total valuation of ${computedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${safeCurrency}.`,
    `Top holding (${topTicker}) represents ${topWeightPct.toFixed(1)}% of invested capital, yielding an effective diversification breadth of ${effectivePositions.toFixed(1)} equal-weight positions (HHI: ${(hhi * 10000).toFixed(0)}).`,
  ];

  if (etfWeight > 0 || bondWeight > 0) {
    keyObservations.push(
      `Index ETFs (${(etfWeight * 100).toFixed(1)}%) and Sovereign Fidelis Bonds (${(bondWeight * 100).toFixed(1)}%) account for ${((etfWeight + bondWeight) * 100).toFixed(1)}% of assets, cushioning single-stock drawdowns.`
    );
  } else {
    keyObservations.push(
      `100% of invested capital is allocated to individual equities without index ETF or sovereign bond ballast.`
    );
  }

  const actionableRecommendations: string[] = [];
  if (topWeightPct > 40 && getClientSectorProfile(topTicker).sector !== 'ETFs & Funds') {
    actionableRecommendations.push(
      `Consider directing new cash inflows toward broad index ETFs or underrepresented sectors to gradually bring ${topTicker} (${topWeightPct.toFixed(1)}%) below a 30–35% single-issuer threshold.`
    );
  } else {
    actionableRecommendations.push(
      `Maintain core allocation discipline by deploying incoming dividends and cash contributions into highest-conviction index or value holdings.`
    );
  }

  if (bondWeight === 0) {
    actionableRecommendations.push(
      `Evaluate allocating 10–20% to tax-exempt BVB Fidelis government bonds (RON or EUR) to lock in sovereign coupon yields without adding CASS or income tax drag.`
    );
  } else {
    actionableRecommendations.push(
      `Continue ladder-reinvesting annual Fidelis bond coupons to preserve tax-exempt yield generation and liquidity.`
    );
  }

  if (sectorTotals.size < 3) {
    actionableRecommendations.push(
      `Expand sector coverage across defensive and international equity segments (e.g., global UCITS ETFs or utilities/healthcare) to reduce domestic macro correlation.`
    );
  }

  return {
    riskLevel,
    diversificationScore,
    keyObservations,
    actionableRecommendations,
    sectorBreakdownEstimate:
      sectorBreakdownEstimate.length > 0
        ? sectorBreakdownEstimate
        : [{ sectorName: 'Equities & Holdings', percentage: 100, commentary: 'Core portfolio allocation' }],
  };
}

export async function analyzePortfolio(holdings: any[], currency: string, totalValue: number): Promise<PortfolioAnalysisResult> {
  try {
    const res = await apiFetch('/api/advisor/analyze-portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdings, currency, totalValue }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.diversificationScore === 'number') {
        return data;
      }
    }
  } catch {
    // Fall through to client-side Gemini or quantitative engine
  }

  const clientApiKey = getClientGeminiApiKey();
  if (clientApiKey && Array.isArray(holdings) && holdings.length > 0) {
    try {
      const { GoogleGenAI, Type } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: clientApiKey });
      const safeCurrency = (currency || 'RON').toUpperCase();
      const safeTotal = Number(totalValue) || 0;
      const holdingsStr = holdings
        .slice(0, 25)
        .map(h => {
          const t = String(h?.ticker || '').toUpperCase();
          const profile = getClientSectorProfile(t);
          const sh = Number(h?.shares) || 0;
          const val = Number(h?.value) || 0;
          const pct = safeTotal > 0 ? ((val / safeTotal) * 100).toFixed(1) : '0.0';
          return `- ${t} (${profile.sector} / ${profile.industry}): ${sh} shares, Value: ${val.toFixed(2)} ${safeCurrency} (${pct}%)`;
        })
        .join('\n');

      const prompt = `As an expert wealth manager and risk analyst, analyze the following stock portfolio denominated in ${safeCurrency} (Total Value: ${safeTotal.toFixed(2)} ${safeCurrency}).\nHoldings:\n${holdingsStr}\nProvide a concise portfolio-wide risk and diversification analysis.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          temperature: 0.7,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              riskLevel: { type: Type.STRING },
              diversificationScore: { type: Type.INTEGER },
              keyObservations: { type: Type.ARRAY, items: { type: Type.STRING } },
              actionableRecommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
              sectorBreakdownEstimate: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sectorName: { type: Type.STRING },
                    percentage: { type: Type.INTEGER },
                    commentary: { type: Type.STRING },
                  },
                },
              },
            },
            required: [
              'riskLevel',
              'diversificationScore',
              'keyObservations',
              'actionableRecommendations',
              'sectorBreakdownEstimate',
            ],
          },
        },
      });
      if (response.text) {
        return JSON.parse(response.text);
      }
    } catch {
      // Fall through to deterministic quantitative engine
    }
  }

  return buildQuantitativePortfolioAnalysis(holdings, currency, totalValue);
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

