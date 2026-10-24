const fs = require('fs');

let serverContent = fs.readFileSync('server.ts', 'utf8');

serverContent = serverContent.replace(
  "app.post('/api/quotes', async (req, res) => {\n  const { tickers, targetCurrency } = req.body;",
  "app.post('/api/quotes', async (req, res) => {\n  let { tickers, targetCurrency } = req.body;\n  if (tickers) tickers = tickers.map(t => t.endsWith('.NL') ? t.replace('.NL', '.AS') : t);"
);

fs.writeFileSync('server.ts', serverContent);
