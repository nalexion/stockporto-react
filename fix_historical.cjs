const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const oldRoute = `app.post('/api/historical', async (req, res) => {`;
const newRoute = `
const historicalCache = new Map(); // Simple memory cache for historical index data

app.post('/api/historical', async (req, res) => {`;
code = code.replace(oldRoute, newRoute);

const oldCacheLogic = `    let data;
    try {
      const chartResult = await yahooFinance.chart(symbol, {
        period1: start,
        period2: end,
        interval: interval
      });`;
      
const newCacheLogic = `    const cacheKey = \`\${symbol}-\${period}\`;
    if (historicalCache.has(cacheKey)) {
       const cached = historicalCache.get(cacheKey);
       if (Date.now() - cached.timestamp < 1000 * 60 * 60) { // 1 hour cache
         return res.json(cached.data);
       }
    }
    
    let data;
    try {
      // Add a small artificial delay to avoid hammering the API if multiple simultaneous requests
      await new Promise(r => setTimeout(r, Math.random() * 300));
      const chartResult = await yahooFinance.chart(symbol, {
        period1: start,
        period2: end,
        interval: interval
      });`;
      
code = code.replace(oldCacheLogic, newCacheLogic);

const oldData = `    res.json(data);`;
const newData = `    historicalCache.set(cacheKey, { data, timestamp: Date.now() });
    res.json(data);`;
code = code.replace(oldData, newData);

fs.writeFileSync('server.ts', code);
