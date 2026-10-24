const fs = require('fs');
let code = fs.readFileSync('src/components/PortfolioView.tsx', 'utf8');

// Imports
code = code.replace(
  "import AnalysisModal from './AnalysisModal';",
  "import AnalysisModal from './AnalysisModal';\nimport PortfolioAnalysisModal from './PortfolioAnalysisModal';"
);

code = code.replace(
  "import { fetchLots, fetchQuotes, updatePortfolio, fetchFxHistoricalRange, analyzeHoldings, AnalyzeResult } from '../lib/api';",
  "import { fetchLots, fetchQuotes, updatePortfolio, fetchFxHistoricalRange, analyzeHoldings, AnalyzeResult, analyzePortfolio, PortfolioAnalysisResult } from '../lib/api';"
);

// State
code = code.replace(
  "const [showAnalysisModal, setShowAnalysisModal] = useState(false);",
  "const [showAnalysisModal, setShowAnalysisModal] = useState(false);\n  const [showPortfolioAnalysisModal, setShowPortfolioAnalysisModal] = useState(false);\n  const [portfolioAnalysisResult, setPortfolioAnalysisResult] = useState<PortfolioAnalysisResult | null>(null);\n  const [isAnalyzingPortfolio, setIsAnalyzingPortfolio] = useState(false);"
);

// Button
code = code.replace(
  "<Upload size={16} /> Import CSV\n          </button>",
  "<Upload size={16} /> Import CSV\n          </button>\n          <button\n            onClick={handleAnalyzePortfolio}\n            className=\"flex items-center gap-2 bg-indigo-50 border border-indigo-200 text-indigo-700 px-4 py-2 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-medium\"\n          >\n            <Sparkles size={16} /> AI Diagnosis\n          </button>"
);

// Handler
const handlerCode = `
  const handleAnalyzePortfolio = async () => {
    setIsAnalyzingPortfolio(true);
    setShowPortfolioAnalysisModal(true);
    setPortfolioAnalysisResult(null);

    const holdingsToAnalyze = tickerGroups.map(g => ({
      ticker: g.ticker,
      shares: g.qty,
      avgBuyPrice: g.avgCost,
      currentPrice: g.currentPrice,
      unrealizedPnL: g.unrealizedPnL,
      value: g.currentValue,
      companyName: g.ticker // fallback if no name
    })).filter(h => h.shares > 0);

    try {
      const result = await analyzePortfolio(holdingsToAnalyze, portfolio.currency, totalCurrentValue);
      setPortfolioAnalysisResult(result);
    } catch (err) {
      console.error('Portfolio analysis failed', err);
    } finally {
      setIsAnalyzingPortfolio(false);
    }
  };
`;

code = code.replace(
  "const handleExportCSV = () => {",
  handlerCode + "\n  const handleExportCSV = () => {"
);

// Render Modal
code = code.replace(
  "<AnalysisModal\n        isOpen={showAnalysisModal}",
  "<PortfolioAnalysisModal\n        isOpen={showPortfolioAnalysisModal}\n        onClose={() => setShowPortfolioAnalysisModal(false)}\n        result={portfolioAnalysisResult}\n        isAnalyzing={isAnalyzingPortfolio}\n      />\n\n      <AnalysisModal\n        isOpen={showAnalysisModal}"
);

fs.writeFileSync('src/components/PortfolioView.tsx', code);
