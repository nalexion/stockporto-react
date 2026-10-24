const fs = require('fs');

let content = fs.readFileSync('src/components/PortfolioList.tsx', 'utf8');

const searchLogic = `                if (newQty > 0) {
                  avgCost = ((qty * avgCost) + (lot.shares * lot.buyPrice)) / newQty;
                }
                qty = newQty;
              } else if (lot.transactionType === 'SELL') {`;

const replaceLogic = `                if (newQty > 0) {
                  avgCost = ((qty * avgCost) + (lot.shares * lot.buyPrice)) / newQty;
                }
                qty = newQty;
              } else if (lot.transactionType === 'SPLIT') {
                qty *= lot.shares;
                avgCost /= lot.shares;
              } else if (lot.transactionType === 'SELL') {`;

content = content.replace(searchLogic, replaceLogic);
fs.writeFileSync('src/components/PortfolioList.tsx', content);
