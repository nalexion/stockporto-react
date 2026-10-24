const fs = require('fs');

let apiContent = fs.readFileSync('src/lib/api.ts', 'utf8');

// Patch fetchQuotes
apiContent = apiContent.replace(
  "export async function fetchQuotes(tickers: string[], targetCurrency: string): Promise<Record<string, any>> {",
  "export async function fetchQuotes(tickers: string[], targetCurrency: string): Promise<Record<string, any>> {\n  tickers = tickers.map(t => t.endsWith('.NL') ? t.replace('.NL', '.AS') : t);"
);
apiContent = apiContent.replace(
  "  return res.json();\n}",
  "  const data = await res.json();\n  const remappedData: Record<string, any> = {};\n  for (const [key, val] of Object.entries(data)) {\n    remappedData[key] = val;\n    if (key.endsWith('.AS')) remappedData[key.replace('.AS', '.NL')] = val;\n  }\n  return remappedData;\n}"
);

// Patch fetchHistorical
apiContent = apiContent.replace(
  "export async function fetchHistorical(symbol: string, period: string): Promise<any[]> {",
  "export async function fetchHistorical(symbol: string, period: string): Promise<any[]> {\n  symbol = symbol.endsWith('.NL') ? symbol.replace('.NL', '.AS') : symbol;"
);

fs.writeFileSync('src/lib/api.ts', apiContent);
