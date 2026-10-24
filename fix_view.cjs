const fs = require('fs');
let code = fs.readFileSync('src/components/PortfolioView.tsx', 'utf8');

// Add state for portfolioChartData
if (!code.includes("const [portfolioChartData, setPortfolioChartData]")) {
  code = code.replace(
    "const [isEditingName, setIsEditingName] = useState(false);",
    "const [isEditingName, setIsEditingName] = useState(false);\n  const [portfolioChartData, setPortfolioChartData] = useState<any[]>([]);"
  );
}

// Wrap in grid
const oldRender = `<PortfolioChart lots={lots} portfolio={portfolio} quotes={quotesMap} />
      <IndexCharts />`;

const newRender = `<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <PortfolioChart lots={lots} portfolio={portfolio} quotes={quotesMap} onDataUpdate={setPortfolioChartData} />
        <IndexCharts portfolioHistory={portfolioChartData} />
      </div>`;

code = code.replace(oldRender, newRender);

fs.writeFileSync('src/components/PortfolioView.tsx', code);
