const fs = require('fs');

let server = fs.readFileSync('server.ts', 'utf8');

// 1. Let's add tracking variables
const trackingVars = `
// --- BACKGROUND CACHING ---
const trackedTickers = new Set<string>();
const trackedFxPairs = new Set<string>();

async function refreshBackgroundCache() {
  const allSymbols = [...Array.from(trackedTickers), ...Array.from(trackedFxPairs)];
  if (allSymbols.length === 0) return;
  
  console.log(\`[Background Cache] Refreshing \${allSymbols.length} tickers/FX...\`);
  try {
    const quotes = await yahooFinance.quote(allSymbols);
    const qArr = Array.isArray(quotes) ? quotes : [quotes];
    const now = Date.now();
    for (const q of qArr) {
      if (q && q.symbol) {
        yfCache.set(q.symbol, { data: q, timestamp: now });
      }
    }
    console.log(\`[Background Cache] Refresh complete.\`);
  } catch (err) {
    console.error(\`[Background Cache] Refresh failed:\`, err);
  }
}

// Start background task (every 5 minutes)
setInterval(refreshBackgroundCache, 5 * 60 * 1000);
`;

server = server.replace(
  'const yfCache = new Map<string, { data: any, timestamp: number }>();',
  'const yfCache = new Map<string, { data: any, timestamp: number }>();\n' + trackingVars
);

// 2. Track tickers on request
server = server.replace(
  'const quoteResults = await getCachedQuotes(uniqueTickers as string[]);',
  'uniqueTickers.forEach(t => trackedTickers.add(t as string));\n    const quoteResults = await getCachedQuotes(uniqueTickers as string[]);'
);

server = server.replace(
  'const fxQuoteArr = await getCachedQuotes(Array.from(fxPairs));',
  'Array.from(fxPairs).forEach(f => trackedFxPairs.add(f));\n        const fxQuoteArr = await getCachedQuotes(Array.from(fxPairs));'
);

// 3. Pre-fetch BNR rates in background
const bnrRefresh = `
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
      console.log(\`[Background Cache] BNR Rates refreshed: EUR=\${eur} USD=\${usd}\`);
    }
  } catch(e) {}
}
setInterval(refreshBnrBackground, 30 * 60 * 1000); // 30 min
// initial kick
setTimeout(refreshBnrBackground, 1000);
`;

server = server.replace(
  'let bnrCache = { rates: { EUR: 0, USD: 0, RON: 1 }, timestamp: 0 };',
  'let bnrCache = { rates: { EUR: 0, USD: 0, RON: 1 }, timestamp: 0 };\n' + bnrRefresh
);

fs.writeFileSync('server.ts', server);
