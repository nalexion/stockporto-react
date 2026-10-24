const fs = require('fs');
let code = fs.readFileSync('src/components/GlobalValuationBar.tsx', 'utf8');

const regex = /let portValue = 0;[\s\S]*?console\.log\("Ticker:", t, "Qty:", qty, "CurrentPrice:", currentPrice, "PortValue now:", portValue\);\n              \}\n            \}\n          \}/;

const replacement = `let portValue = 0;
          let cashBalance = 0;
          portLots.forEach(lot => {
            if (lot.transactionType === 'DEPOSIT') cashBalance += lot.shares;
            else if (lot.transactionType === 'WITHDRAWAL') cashBalance -= lot.shares;
            else if (lot.transactionType === 'BUY') cashBalance -= (lot.shares * lot.buyPrice) + (lot.commission || 0);
            else if (lot.transactionType === 'SELL') cashBalance += (lot.shares * lot.buyPrice) - (lot.commission || 0);
            else if (lot.transactionType === 'DIVIDEND') cashBalance += lot.buyPrice - (lot.commission || 0);
          });
          portValue += cashBalance;
          
          const tickers = Array.from(new Set(portLots.map(l => l.ticker)));
          for (const t of tickers) {
            if (t === '$$CASH_TX') continue;
            
            const tLots = [...portLots.filter(l => l.ticker === t)].sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());
            
            let qty = 0;
            let avgCost = 0;
            tLots.forEach(lot => {
              if (lot.transactionType === 'BUY') {
                const newQty = qty + lot.shares;
                if (newQty > 0) {
                  avgCost = ((qty * avgCost) + (lot.shares * lot.buyPrice)) / newQty;
                }
                qty = newQty;
              } else if (lot.transactionType === 'SPLIT') {
                qty *= lot.shares;
                avgCost /= lot.shares;
              } else if (lot.transactionType === 'SELL') {
                qty -= lot.shares;
                if (qty <= 0) {
                  avgCost = 0;
                  qty = 0;
                }
              }
            });
            
            if (qty > 0) {
              const currentPrice = quotes[t]?.convertedPrice || avgCost;
              portValue += qty * currentPrice;
            }
          }`;

const newCode = code.replace(regex, replacement);
fs.writeFileSync('src/components/GlobalValuationBar.tsx', newCode);

