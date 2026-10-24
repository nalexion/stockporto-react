import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import yf from 'yahoo-finance2';
const YahooFinance = (yf as any).default || yf;
const yahooFinance = new YahooFinance();
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';

// Initialize Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// Baseline HTTP Security Headers (VULN-06)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const PORT = 3000;

// Bounded cache & symbol validation helpers (VULN-02 & VULN-05)
const MAX_CACHE_ENTRIES = 500;
const MAX_TRACKED_SYMBOLS = 250;
const MAX_TICKERS_PER_REQUEST = 50;
const MAX_ADVISOR_HOLDINGS = 25;
const VALID_SYMBOL_REGEX = /^[A-Z0-9.^=-]{1,24}$/i;

function isValidTickerSymbol(sym: unknown): sym is string {
  return typeof sym === 'string' && VALID_SYMBOL_REGEX.test(sym.trim());
}

function sanitizeTextForPrompt(input: unknown, maxLen = 64): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[^\w\s.,()&-]/g, '').trim().slice(0, maxLen);
}

function setBoundedMap<K, V>(map: Map<K, V>, key: K, value: V, maxEntries = MAX_CACHE_ENTRIES) {
  if (!map.has(key) && map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, value);
}

// Per-IP sliding window rate limiter for LLM Advisor endpoints (VULN-03)
const advisorRateLimits = new Map<string, { count: number; windowStart: number }>();
function checkAdvisorRateLimit(ip: string, maxReqPerMin = 15): boolean {
  const now = Date.now();
  const entry = advisorRateLimits.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    setBoundedMap(advisorRateLimits, ip, { count: 1, windowStart: now }, 500);
    return true;
  }
  if (entry.count >= maxReqPerMin) return false;
  entry.count += 1;
  return true;
}

// Quotes API: fetch live prices and fx rates if needed
const yfCache = new Map<string, { data: any, timestamp: number }>();

// --- FIDELIS GOVERNMENT BONDS (BVB) ---
interface FidelisBondMeta {
  isFidelis: true;
  baseSymbol: string;
  currency: 'RON' | 'EUR';
  maturityYear: number;
  maturityMonth: string;
  maturityLabel: string;
  tranche: string;
  nominalPar: number;
}

function parseFidelisSymbol(symbol: string | undefined | null): FidelisBondMeta | null {
  if (!symbol) return null;
  const cleaned = symbol.trim().toUpperCase().replace(/\.RO$/i, '');
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

async function fetchBvbFidelisPrice(baseSymbol: string): Promise<number> {
  const cacheKey = `FIDELIS_${baseSymbol}`;
  const now = Date.now();
  const cached = yfCache.get(cacheKey);
  if (cached && (now - cached.timestamp < 15 * 60 * 1000)) {
    return cached.data;
  }

  let price = 100; // Default nominal par value (100 RON or 100 EUR)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const url = `https://m.bvb.ro/FinancialInstruments/Details/FinancialInstrumentsDetails.aspx?s=${encodeURIComponent(baseSymbol)}`;
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(timeout);
    if (resp.ok) {
      const html = await resp.text();
      // Look for BVB price display patterns (e.g. Pret / Ultimul pret around 80.00 - 120.00)
      const priceMatch =
        html.match(/ctl00_body_ctl02_PricesControl_dvCPrices[\s\S]*?([89]\d\.\d{2,4}|1[01]\d\.\d{2,4}|100(?:\.00)?)/i) ||
        html.match(/(?:Ultimul pret|Last price|Pret referinta|Reference price)[^0-9]*([89]\d[.,]\d{2,4}|1[01]\d[.,]\d{2,4}|100(?:[.,]00)?)/i);
      if (priceMatch && priceMatch[1]) {
        const parsed = parseFloat(priceMatch[1].replace(',', '.'));
        if (!Number.isNaN(parsed) && parsed >= 70 && parsed <= 130) {
          price = parsed;
        }
      }
    }
  } catch {
    // Fallback cleanly to 100.00 nominal par if BVB endpoint is unreachable
  }

  setBoundedMap(yfCache, cacheKey, { data: price, timestamp: now });
  return price;
}

// --- BACKGROUND CACHING ---
const trackedTickers = new Set<string>();
const trackedFxPairs = new Set<string>();

async function refreshBackgroundCache() {
  const nonFidelisTickers = Array.from(trackedTickers).filter(t => !parseFidelisSymbol(t));
  const allSymbols = [...nonFidelisTickers, ...Array.from(trackedFxPairs)];
  if (allSymbols.length === 0) return;
  
  console.log(`[Background Cache] Refreshing ${allSymbols.length} tickers/FX...`);
  try {
    const quotes = await yahooFinance.quote(allSymbols, {}, { validateResult: false });
    const qArr = Array.isArray(quotes) ? quotes : [quotes];
    const now = Date.now();
    for (const q of qArr) {
      if (q && q.symbol) {
        setBoundedMap(yfCache, q.symbol, { data: q, timestamp: now });
      }
    }
    console.log(`[Background Cache] Refresh complete.`);
  } catch (err: any) {
    console.warn(`[Background Cache] Refresh warning:`, err?.message || err);
  }
}

// Start background task (every 5 minutes)
setInterval(refreshBackgroundCache, 5 * 60 * 1000);

async function getCachedQuotes(symbols: string[]) {
  const now = Date.now();
  const ttl = 15 * 60 * 1000; // 15 mins
  const missing: string[] = [];
  const res: any[] = [];
  
  for(const s of symbols) {
     const cached = yfCache.get(s);
     if (cached && (now - cached.timestamp < ttl)) {
         res.push(cached.data);
     } else {
         missing.push(s);
     }
  }
  
  if (missing.length > 0) {
     try {
       const quotes = await yahooFinance.quote(missing, {}, { validateResult: false });
       const qArr = Array.isArray(quotes) ? quotes : [quotes];
       for (const q of qArr) {
           if (q && q.symbol) {
             setBoundedMap(yfCache, q.symbol, { data: q, timestamp: now });
             res.push(q);
           }
       }
     } catch(e: any) {
       // If batch quote fails due to a single delisted/invalid symbol, try individually
       for (const sym of missing) {
         try {
           const singleQuote: any = await yahooFinance.quote(sym, {}, { validateResult: false });
           if (singleQuote && singleQuote.symbol) {
             setBoundedMap(yfCache, singleQuote.symbol, { data: singleQuote, timestamp: now });
             res.push(singleQuote);
           }
         } catch {
           // Ignore individual invalid/delisted symbol
         }
       }
     }
  }
  return res;
}


const historicalCache = new Map(); // Simple memory cache for historical index data

function extractValidQuotes(chartResult: any) {
  if (!chartResult) return [];
  if (Array.isArray(chartResult.quotes)) {
    return chartResult.quotes
      .map((q: any) => ({
        date: q.date,
        close: q.close,
        open: q.open,
        high: q.high,
        low: q.low,
        volume: q.volume
      }))
      .filter((q: any) => q.date && typeof q.close === 'number' && !Number.isNaN(q.close));
  }
  // Fallback if raw object format is returned
  const timestamps: number[] = Array.isArray(chartResult.timestamp) ? chartResult.timestamp : [];
  const quoteObj = chartResult.indicators?.quote?.[0] || {};
  const closes: any[] = Array.isArray(quoteObj.close) ? quoteObj.close : [];
  const opens: any[] = Array.isArray(quoteObj.open) ? quoteObj.open : [];
  const highs: any[] = Array.isArray(quoteObj.high) ? quoteObj.high : [];
  const lows: any[] = Array.isArray(quoteObj.low) ? quoteObj.low : [];
  const volumes: any[] = Array.isArray(quoteObj.volume) ? quoteObj.volume : [];

  const quotes = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close === 'number' && !Number.isNaN(close)) {
      quotes.push({
        date: new Date(timestamps[i] * 1000),
        close,
        open: typeof opens[i] === 'number' ? opens[i] : close,
        high: typeof highs[i] === 'number' ? highs[i] : close,
        low: typeof lows[i] === 'number' ? lows[i] : close,
        volume: typeof volumes[i] === 'number' ? volumes[i] : 0
      });
    }
  }
  return quotes;
}

app.post('/api/historical', async (req, res) => {
  let { symbol, period } = req.body;
  if (!isValidTickerSymbol(symbol)) {
    return res.json([]);
  }
  symbol = symbol.trim().toUpperCase();
  if (symbol.endsWith('.NL')) symbol = symbol.replace('.NL', '.AS');
  if (symbol.endsWith('.US')) symbol = symbol.replace('.US', '');

  // Romanian Fidelis Government Bonds are not indexed on Yahoo Finance; return empty so chart uses par/cost basis
  if (parseFidelisSymbol(symbol)) {
    return res.json([]);
  }
  
  const safePeriod = typeof period === 'string' ? period.slice(0, 10) : '1y';
  const cacheKey = `${symbol}-${safePeriod}`;
  if (historicalCache.has(cacheKey)) {
    const cached = historicalCache.get(cacheKey)!;
    if (Date.now() - cached.timestamp < 1000 * 60 * 60) { // 1 hour cache
      return res.json(cached.data);
    }
  }

  try {
    const end = new Date();
    let start = new Date();
    let interval: '1d' | '1wk' | '1mo' | '15m' | '60m' = '1d';
    
    switch (period) {
      case '1d':
        start.setDate(start.getDate() - 2);
        interval = '15m';
        break;
      case '5d':
        start.setDate(start.getDate() - 7);
        interval = '60m';
        break;
      case '1mo':
        start.setMonth(start.getMonth() - 1);
        interval = '1d';
        break;
      case '6mo':
        start.setMonth(start.getMonth() - 6);
        interval = '1d';
        break;
      case '1y':
        start.setFullYear(start.getFullYear() - 1);
        interval = '1wk';
        break;
      case '5y':
        start.setFullYear(start.getFullYear() - 5);
        interval = '1mo';
        break;
      case 'ytd':
        start.setMonth(0);
        start.setDate(1);
        interval = '1d';
        break;
      case 'max':
        start.setFullYear(2000); // 24 years of data
        interval = '1mo';
        break;
      default:
        start.setFullYear(start.getFullYear() - 1);
        interval = '1d';
    }
    
    let data: any[] = [];
    try {
      // Add a small artificial delay to avoid hammering the API if multiple simultaneous requests
      await new Promise(r => setTimeout(r, Math.random() * 300));
      const chartResult = await yahooFinance.chart(
        symbol,
        {
          period1: start,
          period2: end,
          interval: interval,
          return: 'object'
        },
        { validateResult: false }
      );
      data = extractValidQuotes(chartResult);
    } catch (err: any) {
      if (err?.result) {
        data = extractValidQuotes(err.result);
      } else if (interval !== '1d' && interval !== '1wk' && interval !== '1mo') {
        try {
          const fallbackResult = await yahooFinance.chart(
            symbol,
            {
              period1: start,
              period2: end,
              interval: '1d',
              return: 'object'
            },
            { validateResult: false }
          );
          data = extractValidQuotes(fallbackResult);
        } catch (fallbackErr: any) {
          if (fallbackErr?.result) {
            data = extractValidQuotes(fallbackErr.result);
          } else {
            throw fallbackErr;
          }
        }
      } else {
        throw err;
      }
    }
    
    setBoundedMap(historicalCache, cacheKey, { data, timestamp: Date.now() });
    res.json(data);
  } catch (error: any) {
    // Cache empty result for 1 hour so delisted/unindexed symbols are not repeatedly queried
    setBoundedMap(historicalCache, cacheKey, { data: [], timestamp: Date.now() });
    res.json([]); // Gracefully return empty array instead of failing
  }
});

app.post('/api/fx-historical-range', async (req, res) => {
  const { currency, startDate, endDate } = req.body;
  const safeCurrency =
    typeof currency === 'string' && ['USD', 'EUR', 'RON'].includes(currency.toUpperCase())
      ? currency.toUpperCase()
      : 'RON';
  if (safeCurrency === 'RON') {
    return res.json({});
  }

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return res.json({});
    }
    // Add a few days buffer to start and end
    start.setDate(start.getDate() - 5);
    end.setDate(end.getDate() + 1);

    const symbol = `${safeCurrency}RON=X`;
    const chartResult = await yahooFinance.chart(
      symbol,
      {
        period1: start,
        period2: end,
        interval: '1d',
        return: 'object'
      },
      { validateResult: false }
    );
    const quotes = extractValidQuotes(chartResult);

    const rates: Record<string, number> = {};
    let lastValidRate = 1;
    
    quotes.forEach((q: any) => {
      if (q.date && q.close) {
        const d = new Date(q.date).toISOString().split('T')[0];
        rates[d] = q.close;
        lastValidRate = q.close;
      }
    });

    // Fill in weekends/holidays with the previous valid rate
    const finalRates: Record<string, number> = {};
    let current = new Date(start);
    let currentRate = lastValidRate;
    
    while (current <= end) {
      const dString = current.toISOString().split('T')[0];
      if (rates[dString]) {
        currentRate = rates[dString];
      }
      finalRates[dString] = currentRate;
      current.setDate(current.getDate() + 1);
    }

    res.json(finalRates);
  } catch (err) {
    console.warn('Historical FX range fallback to empty:', err);
    res.json({});
  }
});

const profileCache = new Map<string, { sector: string; industry: string }>();

const KNOWN_PROFILES: Record<string, { sector: string; industry: string }> = {
  'TLV.RO': { sector: 'Financial Services', industry: 'Banks - Regional' },
  'BRD.RO': { sector: 'Financial Services', industry: 'Banks - Regional' },
  'SNP.RO': { sector: 'Energy', industry: 'Oil & Gas Integrated' },
  'SNG.RO': { sector: 'Energy', industry: 'Oil & Gas E&P' },
  'H2O.RO': { sector: 'Utilities', industry: 'Utilities - Renewable' },
  'SNN.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Electric' },
  'DIGI.RO': { sector: 'Communication Services', industry: 'Telecom Services' },
  'FP.RO': { sector: 'Financial Services', industry: 'Asset Management' },
  'TTS.RO': { sector: 'Industrials', industry: 'Marine Shipping & Logistics' },
  'ONE.RO': { sector: 'Real Estate', industry: 'Real Estate - Development' },
  'AQ.RO': { sector: 'Industrials', industry: 'Trucking & Freight Logistics' },
  'M.RO': { sector: 'Healthcare', industry: 'Medical Care Facilities' },
  'BVB.RO': { sector: 'Financial Services', industry: 'Financial Data & Stock Exchanges' },
  'EL.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Electric' },
  'TGN.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Gas' },
  'TEL.RO': { sector: 'Utilities', industry: 'Utilities - Regulated Electric' },
  'TRP.RO': { sector: 'Industrials', industry: 'Building Products & Piping' },
  'WINE.RO': { sector: 'Consumer Defensive', industry: 'Beverages - Wineries & Distilleries' },
  'BIO.RO': { sector: 'Healthcare', industry: 'Drug Manufacturers - Specialty' },
  'ALR.RO': { sector: 'Basic Materials', industry: 'Aluminum' },
  'SFG.RO': { sector: 'Consumer Cyclical', industry: 'Restaurants' },
  'ATB.RO': { sector: 'Healthcare', industry: 'Drug Manufacturers - Specialty' },
  'SOCP.RO': { sector: 'Energy', industry: 'Oil & Gas Equipment & Services' },
  'COTE.RO': { sector: 'Energy', industry: 'Oil & Gas Midstream' },
  'IAR.RO': { sector: 'Industrials', industry: 'Aerospace & Defense' },
  'AROBS.RO': { sector: 'Technology', industry: 'Software - Application' },
  '2P.RO': { sector: 'Technology', industry: 'Advertising & Marketing Tech' },
  'SAFE.RO': { sector: 'Technology', industry: 'Cybersecurity & Infrastructure' },
  'DN.RO': { sector: 'Consumer Defensive', industry: 'Farm Products & Dairy' },
  'ROCE.RO': { sector: 'Basic Materials', industry: 'Chemicals & Plastics' },
  'ALU.RO': { sector: 'Basic Materials', industry: 'Aluminum & Building Materials' },
  'IMP.RO': { sector: 'Real Estate', industry: 'Real Estate - Development' },
  'TBK.RO': { sector: 'Financial Services', industry: 'Insurance Brokers' },
  'EVER.RO': { sector: 'Financial Services', industry: 'Asset Management' },
  'INFINITY.RO': { sector: 'Financial Services', industry: 'Asset Management' },
  'LION.RO': { sector: 'Financial Services', industry: 'Asset Management' },
  'TRANSI.RO': { sector: 'Financial Services', industry: 'Asset Management' },
  'CMCM.RO': { sector: 'Basic Materials', industry: 'Building Materials' },
  'TVBETETF.RO': { sector: 'ETFs & Funds', industry: 'Index Tracking Equity ETFs' },
  'PTENGETF.RO': { sector: 'ETFs & Funds', industry: 'Energy Sector ETFs' },
  'CSPX.AS': { sector: 'ETFs & Funds', industry: 'Large Cap Blend Index ETFs' },
  'VWCE.DE': { sector: 'ETFs & Funds', industry: 'Global Equity Index ETFs' },
  'VUAA.DE': { sector: 'ETFs & Funds', industry: 'Large Cap Blend Index ETFs' },
  'EUNL.DE': { sector: 'ETFs & Funds', industry: 'Developed World Index ETFs' },
  'IS3N.DE': { sector: 'ETFs & Funds', industry: 'Emerging Markets Index ETFs' },
  'IWDA.AS': { sector: 'ETFs & Funds', industry: 'Developed World Index ETFs' },
  'QDVE.DE': { sector: 'ETFs & Funds', industry: 'Technology Sector ETFs' },
  'SX8P.DE': { sector: 'ETFs & Funds', industry: 'Technology Sector ETFs' },
};

async function getSectorProfile(symbol: string, quoteType?: string): Promise<{ sector: string; industry: string }> {
  if (profileCache.has(symbol)) {
    return profileCache.get(symbol)!;
  }
  if (parseFidelisSymbol(symbol)) {
    const fidelisProfile = { sector: 'Government Bonds (Fidelis)', industry: 'Romanian Sovereign Debt (BVB)' };
    setBoundedMap(profileCache, symbol, fidelisProfile);
    return fidelisProfile;
  }
  if (KNOWN_PROFILES[symbol]) {
    setBoundedMap(profileCache, symbol, KNOWN_PROFILES[symbol]);
    return KNOWN_PROFILES[symbol];
  }
  if (quoteType === 'ETF' || symbol.includes('ETF')) {
    const res = { sector: 'ETFs & Funds', industry: 'Exchange Traded Index Funds' };
    setBoundedMap(profileCache, symbol, res);
    return res;
  }
  try {
    const summary: any = await yahooFinance.quoteSummary(symbol, { modules: ['assetProfile'] }, { validateResult: false });
    const sector = summary?.assetProfile?.sector;
    const industry = summary?.assetProfile?.industry;
    if (sector || industry) {
      const res = {
        sector: sector || 'Diversified Operations',
        industry: industry || sector || 'Diversified Commercial Operations'
      };
      setBoundedMap(profileCache, symbol, res);
      return res;
    }
  } catch (e) {
    // ignore
  }

  const fallback = { sector: 'Diversified Operations', industry: 'Diversified Commercial Operations' };
  setBoundedMap(profileCache, symbol, fallback);
  return fallback;
}

app.post('/api/quotes', async (req, res) => {
  let { tickers, targetCurrency } = req.body;
  if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
    return res.json({});
  }
  const safeTargetCurrency =
    typeof targetCurrency === 'string' && ['USD', 'EUR', 'RON'].includes(targetCurrency.toUpperCase())
      ? targetCurrency.toUpperCase()
      : 'RON';
  targetCurrency = safeTargetCurrency;

  tickers = tickers
    .slice(0, MAX_TICKERS_PER_REQUEST)
    .filter(isValidTickerSymbol)
    .map(t => {
      const upper = t.trim().toUpperCase();
      if (upper.endsWith('.NL')) return upper.replace('.NL', '.AS');
      if (upper.endsWith('.US')) return upper.replace('.US', '');
      return upper;
    });
  if (tickers.length === 0) {
    return res.json({});
  }

  try {
    const uniqueTickers = Array.from(new Set(tickers as string[]));
    const fidelisTickers: string[] = [];
    const standardTickers: string[] = [];

    uniqueTickers.forEach(t => {
      if (parseFidelisSymbol(t)) {
        fidelisTickers.push(t);
      } else {
        standardTickers.push(t);
        if (trackedTickers.size < MAX_TRACKED_SYMBOLS) {
          trackedTickers.add(t);
        }
      }
    });

    const quoteResults = standardTickers.length > 0 ? await getCachedQuotes(standardTickers) : [];
    const result: Record<string, any> = {};

    const fxPairs = new Set<string>();
    quoteResults.forEach(q => {
      if (q && q.currency && targetCurrency && q.currency !== targetCurrency) {
        fxPairs.add(`${q.currency}${targetCurrency}=X`);
      }
    });

    // Also include FX pairs required for Fidelis bonds (RON or EUR -> targetCurrency)
    fidelisTickers.forEach(ft => {
      const meta = parseFidelisSymbol(ft);
      if (meta && targetCurrency && meta.currency !== targetCurrency) {
        fxPairs.add(`${meta.currency}${targetCurrency}=X`);
      }
    });

    const fxRates: Record<string, number> = {};
    if (fxPairs.size > 0) {
      try {
        Array.from(fxPairs).forEach(f => trackedFxPairs.add(f));
        const fxQuoteArr = await getCachedQuotes(Array.from(fxPairs));
        fxQuoteArr.forEach(fq => {
          if (fq && fq.symbol && fq.regularMarketPrice) {
            fxRates[fq.symbol] = fq.regularMarketPrice;
          }
        });
      } catch (err) {
        console.warn('Error fetching FX rates:', err);
      }
    }

    // Resolve standard Yahoo Finance quotes
    await Promise.all(quoteResults.map(async q => {
      if (q && q.symbol) {
        let price = q.regularMarketPrice || 0;
        const stockCurrency = q.currency || targetCurrency;
        let fxRate = 1;

        if (stockCurrency !== targetCurrency) {
          const fxSymbol = `${stockCurrency}${targetCurrency}=X`;
          fxRate = fxRates[fxSymbol] || 1;
        }

        const profile = await getSectorProfile(q.symbol, q.quoteType);

        result[q.symbol] = {
          price: price,
          regularMarketPrice: price,
          convertedPrice: price * fxRate,
          currency: stockCurrency,
          fxRate,
          targetCurrency,
          quoteType: q.quoteType || 'EQUITY',
          market: q.market || 'us_market',
          exchange: q.exchange || '',
          shortName: q.shortName || q.longName || q.symbol,
          sector: profile.sector,
          industry: profile.industry
        };
      }
    }));

    // Resolve Romanian Fidelis Government Bond quotes (BVB live or 100.00 nominal par)
    await Promise.all(fidelisTickers.map(async ft => {
      const meta = parseFidelisSymbol(ft);
      if (!meta) return;

      const bondPrice = await fetchBvbFidelisPrice(meta.baseSymbol);
      const bondCurrency = meta.currency;
      let fxRate = 1;

      if (targetCurrency && bondCurrency !== targetCurrency) {
        const fxSymbol = `${bondCurrency}${targetCurrency}=X`;
        if (fxRates[fxSymbol]) {
          fxRate = fxRates[fxSymbol];
        } else {
          // Fallback using BNR cached rates
          const eurRon = bnrCache.rates.EUR || 4.97;
          const usdRon = bnrCache.rates.USD || 4.60;
          const inRon = bondCurrency === 'EUR' ? eurRon : 1;
          if (targetCurrency === 'RON') fxRate = inRon;
          else if (targetCurrency === 'EUR') fxRate = inRon / eurRon;
          else if (targetCurrency === 'USD') fxRate = inRon / usdRon;
        }
      }

      result[ft] = {
        price: bondPrice,
        regularMarketPrice: bondPrice,
        convertedPrice: bondPrice * fxRate,
        currency: bondCurrency,
        fxRate,
        targetCurrency: targetCurrency || bondCurrency,
        quoteType: 'BOND',
        market: 'ro_market',
        exchange: 'BVB',
        shortName: `Titluri de Stat Fidelis ${meta.maturityLabel} (${meta.currency})`,
        sector: 'Government Bonds (Fidelis)',
        industry: 'Romanian Sovereign Debt (BVB)'
      };
    }));

    res.json(result);
  } catch (error) {
    console.warn('Error fetching quotes:', error);
    res.json({});
  }
});

let bnrCache = { rates: { EUR: 0, USD: 0, RON: 1 }, timestamp: 0 };

async function refreshBnrBackground() {
  try {
    const response = await fetch('https://www.bnr.ro/nbrfxrates.xml', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/xml,application/xml'
      }
    });
    const text = await response.text();
    const eurMatch = text.match(/<Rate currency="EUR"[^>]*>([0-9.]+)/);
    const usdMatch = text.match(/<Rate currency="USD"[^>]*>([0-9.]+)/);
    
    let eur = eurMatch ? parseFloat(eurMatch[1]) : 0;
    let usd = usdMatch ? parseFloat(usdMatch[1]) : 0;
    
    if (eur > 0 && usd > 0) {
      bnrCache.rates = { EUR: eur, USD: usd, RON: 1 };
      bnrCache.timestamp = Date.now();
      console.log(`[Background Cache] BNR Rates refreshed: EUR=${eur} USD=${usd}`);
    }
  } catch(e) {}
}
setInterval(refreshBnrBackground, 30 * 60 * 1000); // 30 min
// initial kick
setTimeout(refreshBnrBackground, 1000);

app.get('/api/bnr-rates', async (req, res) => {
  const now = Date.now();
  if (now - bnrCache.timestamp < 1000 * 60 * 60 && bnrCache.rates.EUR > 0) {
    return res.json(bnrCache.rates);
  }
  
  let eur = 0;
  let usd = 0;
  
  try {
    const response = await fetch('https://www.bnr.ro/nbrfxrates.xml', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/xml,application/xml'
      }
    });
    const text = await response.text();
    const eurMatch = text.match(/<Rate currency="EUR"[^>]*>([0-9.]+)/);
    const usdMatch = text.match(/<Rate currency="USD"[^>]*>([0-9.]+)/);
    
    eur = eurMatch ? parseFloat(eurMatch[1]) : 0;
    usd = usdMatch ? parseFloat(usdMatch[1]) : 0;
  } catch (err) {
    console.log("Failed to fetch BNR from xml, falling back to Yahoo Finance...");
  }
  
  // Fallback to Yahoo Finance if BNR is blocking the Cloud Run IP
  if (!eur || !usd) {
    try {
      console.log("Falling back to Yahoo Finance for FX rates...");
      const quotes: any = await yahooFinance.quote(['EURRON=X', 'USDRON=X'], {}, { validateResult: false });
      const qArr = Array.isArray(quotes) ? quotes : [quotes];
      qArr.forEach((q: any) => {
        if (q?.symbol === 'EURRON=X' && q?.regularMarketPrice) eur = q.regularMarketPrice;
        if (q?.symbol === 'USDRON=X' && q?.regularMarketPrice) usd = q.regularMarketPrice;
      });
    } catch (err) {
      console.warn("Failed to fetch FX rates from Yahoo Finance fallback", err);
    }
  }
  
  // Only cache if we actually got valid rates
  if (eur > 0 && usd > 0) {
    bnrCache.rates = { EUR: eur, USD: usd, RON: 1 };
    bnrCache.timestamp = now;
  }
  
  res.json({ EUR: eur || 4.97, USD: usd || 4.60, RON: 1 }); // hardcoded ultimate fallback just in case
});

app.post('/api/advisor/analyze', async (req, res) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkAdvisorRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Too many analysis requests. Please wait a minute.' });
    }

    const { holdings } = req.body;
    if (!holdings || !Array.isArray(holdings) || holdings.length === 0) {
      return res.status(400).json({ error: 'Holdings array is required' });
    }

    const boundedHoldings = holdings.slice(0, MAX_ADVISOR_HOLDINGS);
    const results = [];
    const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];

    for (const holding of boundedHoldings) {
      const safeTicker = sanitizeTextForPrompt(holding?.ticker, 20).toUpperCase() || 'UNKNOWN';
      const safeCompany = sanitizeTextForPrompt(holding?.companyName || safeTicker, 60) || safeTicker;
      const safeShares = Number(holding?.shares) || 0;
      const safeAvg = Number(holding?.avgBuyPrice) || 0;
      const safeCur = Number(holding?.currentPrice) || 0;
      const safePnl = Number(holding?.unrealizedPnL) || 0;
      const safeDays = Math.max(0, Math.floor(Number(holding?.holdingDays) || 0));

      const profile = await getSectorProfile(safeTicker);
      const prompt = `Analyze the current market situation and position metrics for ${safeCompany} (${safeTicker}). 
Operating Sector: ${profile.sector}, Industry: ${profile.industry}
User holding context:
- Shares: ${safeShares}
- Average Buy Price: ${safeAvg}
- Current Price: ${safeCur}
- Unrealized PnL: ${safePnl}
- Holding Days: ${safeDays}

Provide objective market insights, corporate catalysts, price direction (Up, Down, Flat), market sentiment (Bullish, Bearish, Neutral), recommendation (BUY, SELL, WAIT), and a concise rationale.`;

      let parsedResult: any = null;

      if (process.env.GEMINI_API_KEY) {
        for (const model of modelsToTry) {
          try {
            const response = await ai.models.generateContent({
              model,
              contents: prompt,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    ticker: { type: Type.STRING },
                    companyName: { type: Type.STRING },
                    currentPrice: { type: Type.NUMBER },
                    priceDirection: { type: Type.STRING, description: "Up, Down, or Flat" },
                    marketSentiment: { type: Type.STRING, description: "Bullish, Bearish, or Neutral" },
                    objectiveBullets: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: "Specific corporate/financial catalysts"
                    },
                    recommendation: { type: Type.STRING, description: "BUY, SELL, or WAIT" },
                    recommendationRationale: { type: Type.STRING, description: "Single concise sentence explaining the trade verdict based on position P&L and recent catalysts." }
                  },
                  required: ["ticker", "companyName", "currentPrice", "priceDirection", "marketSentiment", "objectiveBullets", "recommendation", "recommendationRationale"]
                }
              }
            });

            if (response.text) {
              parsedResult = JSON.parse(response.text);
              break;
            }
          } catch (modelErr: any) {
            console.warn(`Model ${model} analysis for ${safeTicker} skipped:`, modelErr.message?.substring(0, 100));
          }
        }
      }

      if (parsedResult) {
        results.push(parsedResult);
      } else {
        // Deterministic financial metrics fallback when API quota is exhausted
        const pnl = safePnl;
        const avg = safeAvg || 1;
        const cur = safeCur || avg;
        const pnlPercent = avg > 0 ? ((cur - avg) / avg) * 100 : 0;
        const isUp = pnl > 0.01;
        const isDown = pnl < -0.01;
        const direction = isUp ? 'Up' : isDown ? 'Down' : 'Flat';
        const sentiment = pnlPercent > 8 ? 'Bullish' : pnlPercent < -8 ? 'Bearish' : 'Neutral';
        const rec = pnlPercent > 25 ? 'SELL' : pnlPercent < -15 ? 'BUY' : 'WAIT';

        results.push({
          ticker: safeTicker,
          companyName: safeCompany,
          currentPrice: cur,
          priceDirection: direction,
          marketSentiment: sentiment,
          objectiveBullets: [
            `Position currently reflects ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% unrealized return across ${safeDays} holding days.`,
            `Classified under ${profile.sector} (${profile.industry}) with an established operating track record.`,
            `Cost basis of ${avg.toFixed(2)} compared against current trading level of ${cur.toFixed(2)}.`
          ],
          recommendation: rec,
          recommendationRationale: `Position exhibits ${direction.toLowerCase()} momentum with ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% performance; maintaining a ${rec} stance is recommended based on position discipline.`
        });
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Advisor analyze error:', error);
    res.status(500).json({ error: 'Failed to run analysis' });
  }
});

app.post('/api/advisor/analyze-portfolio', async (req, res) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkAdvisorRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Too many analysis requests. Please wait a minute.' });
    }

    const { holdings, currency, totalValue } = req.body;
    if (!holdings || !Array.isArray(holdings) || holdings.length === 0) {
      return res.status(400).json({ error: 'Holdings array is required' });
    }

    const safeCurrency = ['USD', 'EUR', 'RON'].includes(String(currency).toUpperCase())
      ? String(currency).toUpperCase()
      : 'RON';
    const safeTotalValue = Number(totalValue) || 0;
    const boundedHoldings = holdings.slice(0, MAX_ADVISOR_HOLDINGS);

    const holdingsStr = boundedHoldings.map(h => {
      const t = sanitizeTextForPrompt(h?.ticker, 20).toUpperCase();
      const sh = Number(h?.shares) || 0;
      const val = Number(h?.value) || 0;
      const pct = safeTotalValue > 0 ? ((val / safeTotalValue) * 100).toFixed(1) : '0.0';
      return `- ${t}: ${sh} shares, Current Value: ${val.toFixed(2)} ${safeCurrency} (${pct}% of portfolio)`;
    }).join('\n');

    const prompt = `As an expert wealth manager and risk analyst, analyze the following stock portfolio.
The portfolio is denominated in ${safeCurrency} and has a total value of ${safeTotalValue.toFixed(2)} ${safeCurrency}.

Holdings:
${holdingsStr}

Provide a concise portfolio-wide risk and diversification analysis. Keep all commentary brief and to the point.`;

    let json: any = null;

    if (process.env.GEMINI_API_KEY) {
      for (const model of ['gemini-3.1-flash-lite', 'gemini-3.8-flash']) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              temperature: 0.7,
              maxOutputTokens: 2048,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  riskLevel: { type: Type.STRING, description: "Overall Risk Level (e.g., 'Low', 'Moderate', 'High', 'Aggressive')" },
                  diversificationScore: { type: Type.INTEGER, description: "Score from 0 to 100 indicating how well diversified the portfolio is" },
                  keyObservations: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "3 to 5 key bullet points observing the portfolio's allocation, concentration, and potential risks."
                  },
                  actionableRecommendations: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "2 to 4 actionable recommendations to improve the portfolio's risk/reward profile or diversification."
                  },
                  sectorBreakdownEstimate: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        sectorName: { type: Type.STRING },
                        percentage: { type: Type.INTEGER, description: "Estimated percentage of portfolio in this sector" },
                        commentary: { type: Type.STRING, description: "Short commentary on this sector's weight" }
                      }
                    }
                  }
                },
                required: ["riskLevel", "diversificationScore", "keyObservations", "actionableRecommendations", "sectorBreakdownEstimate"]
              }
            }
          });

          let text = response.text || '';
          const startIndex = text.indexOf('{');
          const endIndex = text.lastIndexOf('}');
          if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
            text = text.substring(startIndex, endIndex + 1);
          }
          json = JSON.parse(text);
          break;
        } catch (e: any) {
          console.warn(`Portfolio analysis with ${model} failed:`, e.message?.substring(0, 100));
        }
      }
    }

    if (!json) {
      json = {
        riskLevel: holdings.length > 5 ? 'Moderate' : 'Concentrated',
        diversificationScore: Math.min(90, Math.max(30, holdings.length * 15)),
        keyObservations: [
          `Portfolio is distributed across ${holdings.length} distinct holdings.`,
          `Total portfolio valuation is ${totalValue.toFixed(2)} ${currency}.`,
          `Largest position accounts for ${((Math.max(...holdings.map(h => h.value)) / (totalValue || 1)) * 100).toFixed(1)}% of total assets.`
        ],
        actionableRecommendations: [
          'Maintain balanced allocation between core dividend payers and growth assets.',
          'Consider periodic rebalancing to ensure position weights remain within target risk tolerances.'
        ],
        sectorBreakdownEstimate: [
          { sectorName: 'Equities & Holdings', percentage: 100, commentary: 'Core equity investment distribution' }
        ]
      };
    }

    res.json(json);
  } catch (error: any) {
    console.error('Portfolio analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze portfolio' });
  }
});


async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  
const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

startServer();
