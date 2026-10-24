const fs = require('fs');
let code = fs.readFileSync('src/components/PortfolioView.tsx', 'utf8');

// 1. Move the button
const buttonCode = `<button
            onClick={handleAnalyzePortfolio}
            className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 text-indigo-700 px-4 py-2 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-medium"
          >
            <Sparkles size={16} /> AI Diagnosis
          </button>`;

// Remove it from its current position
code = code.replace(buttonCode, "");
code = code.replace("\n          \n", "\n");

// Insert it after "Add Transaction"
const addBtnEnd = `<Plus size={16} /> Add Transaction\n          </button>`;
code = code.replace(addBtnEnd, addBtnEnd + "\n          " + buttonCode);

// 2. Fix the mapping fields
code = code.replace(
  "shares: g.qty,",
  "shares: g.netQty,"
);
code = code.replace(
  "unrealizedPnL: g.unrealizedPnL,",
  "unrealizedPnL: g.unrealizedPnl || 0,"
);
code = code.replace(
  "value: g.currentValue,",
  "value: g.netQty * (g.currentPrice || g.avgCost),"
);

fs.writeFileSync('src/components/PortfolioView.tsx', code);
