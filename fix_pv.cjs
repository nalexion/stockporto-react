const fs = require('fs');

let pv = fs.readFileSync('src/components/PortfolioView.tsx', 'utf8');

pv = pv.replace(
  'totalInvested += currentCostBaseNative;\n        \n        const lotWithPrice = tLots.find',
  '        const lotWithPrice = tLots.find'
);

// wait let's do a more robust replace
pv = pv.replace(/totalInvested \+= currentCostBaseNative;\s+const lotWithPrice/g, 'const lotWithPrice');

fs.writeFileSync('src/components/PortfolioView.tsx', pv);
