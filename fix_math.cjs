const fs = require('fs');

// 1. PortfolioView.tsx
let pv = fs.readFileSync('src/components/PortfolioView.tsx', 'utf8');
pv = pv.replace(
  '  let totalValue = 0;',
  '  let totalValue = 0;' // leave for now
);
pv = pv.replace(
  '      totalInvested += bal;\n      totalValue += bal;',
  '      totalInvested += bal;' // Removed totalValue += bal. We will add cashBalance at the end.
);
// We must add cashBalance to totalValue. Wait, totalValue is accumulated for each ticker!
// Right after the allTickers.forEach loop, I can do:
pv = pv.replace(
  '  const filteredGroups = tickerGroups.filter(g => {',
  '  totalValue += cashBalance;\n  const filteredGroups = tickerGroups.filter(g => {'
);
fs.writeFileSync('src/components/PortfolioView.tsx', pv);

// 2. GlobalValuationBar.tsx
let gvb = fs.readFileSync('src/components/GlobalValuationBar.tsx', 'utf8');

const searchGVB = `          let portValue = 0;
          const tickers = Array.from(new Set(portLots.map(l => l.ticker)));
          for (const t of tickers) {
            const tLots = [...portLots.filter(l => l.ticker === t)].sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());
            
            if (t === '$$CASH_TX') {
              let bal = 0;
              tLots.forEach(l => {
                if (l.transactionType === 'DEPOSIT') bal += l.shares;
                if (l.transactionType === 'WITHDRAWAL') bal -= l.shares;
              });
              
              portValue += bal;
              console.log("CASH bal:", bal, "PortValue now:", portValue);
            } else {
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
                console.log("Ticker:", t, "Qty:", qty, "CurrentPrice:", currentPrice, "PortValue now:", portValue);
              }
            }
          }`;

const replaceGVB = `          let portValue = 0;
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

gvb = gvb.replace(searchGVB, replaceGVB);
fs.writeFileSync('src/components/GlobalValuationBar.tsx', gvb);

// 3. PortfolioList.tsx
let pl = fs.readFileSync('src/components/PortfolioList.tsx', 'utf8');

const searchPL = `        let totalInvested = 0;
        let totalValue = 0;
        
        // Simpler calculation: group by ticker
        const tickers = Array.from(new Set(pLots.map(l => l.ticker)));
        for (const t of tickers) {
          const tLots = [...pLots.filter(l => l.ticker === t)].sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());
          
          if (t === '$$CASH_TX') {
            let bal = 0;
            tLots.forEach(l => {
              if (l.transactionType === 'DEPOSIT') bal += l.shares;
              if (l.transactionType === 'WITHDRAWAL') bal -= l.shares;
            });
            totalInvested += bal;
            totalValue += bal;
          } else {
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
              const currentCost = qty * avgCost;
              totalInvested += currentCost;
              const currentPrice = pQuotes[t]?.convertedPrice || avgCost;
              totalValue += qty * currentPrice;
            }
          }
        }`;

const replacePL = `        let totalInvested = 0;
        let totalValue = 0;
        
        let cashBalance = 0;
        pLots.forEach(lot => {
          if (lot.transactionType === 'DEPOSIT') {
            totalInvested += lot.shares;
            cashBalance += lot.shares;
          } else if (lot.transactionType === 'WITHDRAWAL') {
            totalInvested -= lot.shares;
            cashBalance -= lot.shares;
          } else if (lot.transactionType === 'BUY') {
            cashBalance -= (lot.shares * lot.buyPrice) + (lot.commission || 0);
          } else if (lot.transactionType === 'SELL') {
            cashBalance += (lot.shares * lot.buyPrice) - (lot.commission || 0);
          } else if (lot.transactionType === 'DIVIDEND') {
            cashBalance += lot.buyPrice - (lot.commission || 0);
          }
        });
        
        totalValue += cashBalance;
        
        const tickers = Array.from(new Set(pLots.map(l => l.ticker)));
        for (const t of tickers) {
          if (t === '$$CASH_TX') continue;
          
          const tLots = [...pLots.filter(l => l.ticker === t)].sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());
          
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
            const currentCost = qty * avgCost;
            const currentPrice = pQuotes[t]?.convertedPrice || avgCost;
            totalValue += qty * currentPrice;
          }
        }`;

pl = pl.replace(searchPL, replacePL);
fs.writeFileSync('src/components/PortfolioList.tsx', pl);

console.log("Done patching math!");
