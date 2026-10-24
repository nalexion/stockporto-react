const fs = require('fs');

let pv = fs.readFileSync('src/components/PortfolioView.tsx', 'utf8');

pv = pv.replace(
  '        netQty: bal,\n        avgCost: 1,\n        currentPrice: 1,\n        unrealizedPnl: 0,\n        unrealizedPnlPercent: 0,\n        realizedPnl: 0,\n        status: bal > 0.0001 ? \'OPEN\' : \'CLOSED\'',
  '        netQty: cashBalance,\n        avgCost: 1,\n        currentPrice: 1,\n        unrealizedPnl: 0,\n        unrealizedPnlPercent: 0,\n        realizedPnl: 0,\n        status: Math.abs(cashBalance) > 0.01 ? \'OPEN\' : \'CLOSED\''
);

fs.writeFileSync('src/components/PortfolioView.tsx', pv);
