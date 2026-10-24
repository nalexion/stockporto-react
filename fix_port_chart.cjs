const fs = require('fs');
let code = fs.readFileSync('src/components/PortfolioChart.tsx', 'utf8');

const importRegex = /import \{ fetchHistorical \} from '\.\.\/lib\/api';/;
code = code.replace(importRegex, "import { fetchHistorical } from '../lib/api';\nimport { generatePortfolioHistory } from '../lib/chartUtils';");

const oldLoadChart = `    async function loadChart() {
      setLoading(true);
      try {
        const uniqueTickers = Array.from(new Set(lots.filter(l => l.ticker !== '$$CASH_TX').map(l => l.ticker)));`;

const replaceRegex = /    async function loadChart\(\) \{[\s\S]*?if \(onDataUpdate\) onDataUpdate\(data\);\n      \} catch \(err\) \{/;

const newLoadChart = `    async function loadChart() {
      setLoading(true);
      try {
        const data = await generatePortfolioHistory(lots, period);
        setChartData(data);
        if (onDataUpdate) onDataUpdate(data);
      } catch (err) {`;

code = code.replace(replaceRegex, newLoadChart);

// Wait, the area chart plots 'value' and 'invested'. But the user said: "compare the Portofolio performance on the open/close positions not adding the CASH deposits".
// Does the user also want the PortfolioChart to NOT show cash deposits in 'value' and 'invested'?
// Usually yes, if they don't want cash deposits. I can plot 'stockValue' instead of 'value'.
code = code.replace(
  `dataKey="value"`,
  `dataKey="stockValue"`
);

// We need to also remove cash from 'invested'. In generatePortfolioHistory, 'invested' is netInvested which includes cash deposits. 
// If we want 'stockInvested', we didn't calculate it. But they said "compare the Portofolio performance". That's the IndexCharts part. The main Portfolio chart might still want to show the total absolute value, or maybe just the stock value. I'll change the AreaChart to use stockValue and keep 'invested' as total deposited? Or maybe hide invested if it doesn't make sense.
// Actually, let's keep 'value' for the AreaChart so it shows total portfolio value (which includes cash), but IndexCharts will use 'twr' which completely isolates the stock performance.

fs.writeFileSync('src/components/PortfolioChart.tsx', code);
