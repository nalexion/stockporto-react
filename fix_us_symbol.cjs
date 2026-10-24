const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  "if (symbol && symbol.endsWith('.NL')) symbol = symbol.replace('.NL', '.AS'); // period: '1d', '5d', '1mo', '6mo', '1y', '5y'",
  "if (symbol) {\n    if (symbol.endsWith('.NL')) symbol = symbol.replace('.NL', '.AS');\n    if (symbol.endsWith('.US')) symbol = symbol.replace('.US', '');\n  }"
);

code = code.replace(
  "if (tickers) tickers = tickers.map(t => t.endsWith('.NL') ? t.replace('.NL', '.AS') : t);",
  "if (tickers) tickers = tickers.map(t => {\n    if (t.endsWith('.NL')) return t.replace('.NL', '.AS');\n    if (t.endsWith('.US')) return t.replace('.US', '');\n    return t;\n  });"
);

fs.writeFileSync('server.ts', code);
