const fs = require('fs');

let serverContent = fs.readFileSync('server.ts', 'utf8');

serverContent = serverContent.replace(
  "app.post('/api/quotes', async (req, res) => {\n  let { symbols } = req.body;\n  symbols = symbols.map(s => s.endsWith('.NL') ? s.replace('.NL', '.AS') : s);",
  "app.post('/api/quotes', async (req, res) => {\n  let { tickers, targetCurrency } = req.body;\n  if (tickers) tickers = tickers.map(s => s.endsWith('.NL') ? s.replace('.NL', '.AS') : s);"
);

fs.writeFileSync('server.ts', serverContent);
