const fs = require('fs');
let code = fs.readFileSync('src/components/PortfolioChart.tsx', 'utf8');

code = code.replace(
  "interface PortfolioChartProps {",
  "interface PortfolioChartProps {\n  onDataUpdate?: (data: any[]) => void;"
);
code = code.replace(
  "export default function PortfolioChart({ portfolio, lots, quotes }: PortfolioChartProps) {",
  "export default function PortfolioChart({ portfolio, lots, quotes, onDataUpdate }: PortfolioChartProps) {"
);
code = code.replace(
  "setChartData(data);",
  "setChartData(data);\n        if (onDataUpdate) onDataUpdate(data);"
);
// Remove mb-8 from the main div so it fits nicely in a grid
code = code.replace(
  "className=\"bg-white p-5 rounded-xl shadow-sm border border-slate-100 mb-8\"",
  "className=\"bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex-1 flex flex-col\""
);

fs.writeFileSync('src/components/PortfolioChart.tsx', code);
