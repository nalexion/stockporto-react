const fs = require('fs');

let pv = fs.readFileSync('src/components/PortfolioView.tsx', 'utf8');

pv = pv.replace(
  '<h3 className="text-slate-500 text-sm font-medium mb-1">Unrealized P&L</h3>',
  '<h3 className="text-slate-500 text-sm font-medium mb-1">Total Net Return</h3>'
);

fs.writeFileSync('src/components/PortfolioView.tsx', pv);
