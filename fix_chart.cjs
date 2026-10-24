const fs = require('fs');
let code = fs.readFileSync('src/components/PortfolioChart.tsx', 'utf8');

code = code.replace(
  "const [period, setPeriod] = useState<'1mo' | '3mo' | '6mo' | '1y' | 'ytd'>('6mo');",
  "const [period, setPeriod] = useState<'1mo' | '3mo' | '6mo' | '1y' | '5y' | 'ytd' | 'max'>('6mo');"
);

code = code.replace(
  "if (period === '1y') start.setFullYear(start.getFullYear() - 1);",
  "if (period === '1y') start.setFullYear(start.getFullYear() - 1);\n        if (period === '5y') start.setFullYear(start.getFullYear() - 5);\n        if (period === 'max') start.setFullYear(2000);"
);

code = code.replace(
  "{(['1mo', '3mo', '6mo', '1y', 'ytd'] as const).map(p => (",
  "{(['1mo', '3mo', '6mo', '1y', '5y', 'ytd', 'max'] as const).map(p => ("
);

code = code.replace(
  "{p.toUpperCase()}",
  "{p === 'max' ? 'ALL' : p.toUpperCase()}"
);

fs.writeFileSync('src/components/PortfolioChart.tsx', code);
