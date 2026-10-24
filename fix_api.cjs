const fs = require('fs');
let code = fs.readFileSync('src/lib/api.ts', 'utf8');

code = code.replace(
  "tickers = tickers.map(t => t.endsWith('.NL') ? t.replace('.NL', '.AS') : t);",
  "const originalTickers = [...tickers];\n  tickers = tickers.map(t => {\n    if (t.endsWith('.NL')) return t.replace('.NL', '.AS');\n    if (t.endsWith('.US')) return t.replace('.US', '');\n    return t;\n  });"
);

code = code.replace(
  "  for (const [key, val] of Object.entries(data)) {\n    remappedData[key] = val;\n    if (key.endsWith('.AS')) remappedData[key.replace('.AS', '.NL')] = val;\n  }",
  "  for (const [key, val] of Object.entries(data)) {\n    remappedData[key] = val;\n    if (key.endsWith('.AS')) remappedData[key.replace('.AS', '.NL')] = val;\n    // also remap to original .US if present\n    const originalUS = originalTickers.find(t => t === key + '.US');\n    if (originalUS) remappedData[originalUS] = val;\n  }"
);

code = code.replace(
  "symbol = symbol.endsWith('.NL') ? symbol.replace('.NL', '.AS') : symbol;",
  "if (symbol.endsWith('.NL')) symbol = symbol.replace('.NL', '.AS');\n  if (symbol.endsWith('.US')) symbol = symbol.replace('.US', '');"
);

fs.writeFileSync('src/lib/api.ts', code);
