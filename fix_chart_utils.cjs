const fs = require('fs');
let code = fs.readFileSync('src/lib/chartUtils.ts', 'utf8');

// We want to calculate the TWR of the *stock positions only*, meaning BUY is cash flow IN, SELL is cash flow OUT.
const replaceLogic = `
    let dailyCashFlow = 0;
    const dailyLots = lots.filter(l => {
       const dStr = new Date(l.tradeDate).toISOString().split('T')[0];
       return dStr === dateStr;
    });
    
    pastLots.forEach(lot => {
      if (lot.transactionType === 'DEPOSIT') {
        cashBalance += lot.shares;
        netInvested += lot.shares;
      } else if (lot.transactionType === 'WITHDRAWAL') {
        cashBalance -= lot.shares;
        netInvested -= lot.shares;
      } else if (lot.transactionType === 'BUY') {
        cashBalance -= (lot.shares * lot.buyPrice) + (lot.commission || 0);
      } else if (lot.transactionType === 'SELL') {
        cashBalance += (lot.shares * lot.buyPrice) - (lot.commission || 0);
      } else if (lot.transactionType === 'DIVIDEND') {
        cashBalance += lot.buyPrice - (lot.commission || 0);
      }
    });
    
    dailyLots.forEach(lot => {
       if (lot.transactionType === 'DEPOSIT') dailyCashFlow += lot.shares;
       if (lot.transactionType === 'WITHDRAWAL') dailyCashFlow -= lot.shares;
    });
    
    let portValue = cashBalance;
    let stockValue = 0;
`;

const newLogic = `
    let dailyStockCashFlow = 0;
    const dailyLots = lots.filter(l => {
       const dStr = new Date(l.tradeDate).toISOString().split('T')[0];
       return dStr === dateStr;
    });
    
    pastLots.forEach(lot => {
      if (lot.transactionType === 'DEPOSIT') {
        cashBalance += lot.shares;
        netInvested += lot.shares;
      } else if (lot.transactionType === 'WITHDRAWAL') {
        cashBalance -= lot.shares;
        netInvested -= lot.shares;
      } else if (lot.transactionType === 'BUY') {
        cashBalance -= (lot.shares * lot.buyPrice) + (lot.commission || 0);
      } else if (lot.transactionType === 'SELL') {
        cashBalance += (lot.shares * lot.buyPrice) - (lot.commission || 0);
      } else if (lot.transactionType === 'DIVIDEND') {
        cashBalance += lot.buyPrice - (lot.commission || 0);
      }
    });
    
    // Treat the "stock portfolio" as an isolated entity.
    // Buying a stock is a cash flow INTO the stock portfolio.
    // Selling a stock (or receiving dividends) is a cash flow OUT OF the stock portfolio.
    dailyLots.forEach(lot => {
       if (lot.transactionType === 'BUY') dailyStockCashFlow += (lot.shares * lot.buyPrice) + (lot.commission || 0);
       if (lot.transactionType === 'SELL') dailyStockCashFlow -= (lot.shares * lot.buyPrice) - (lot.commission || 0);
       if (lot.transactionType === 'DIVIDEND') dailyStockCashFlow -= lot.buyPrice - (lot.commission || 0);
    });
    
    let portValue = cashBalance;
    let stockValue = 0;
`;

code = code.replace(replaceLogic, newLogic);

const oldTWR = `
    if (prevPortValue > 0) {
       const dailyReturn = (portValue - dailyCashFlow - prevPortValue) / prevPortValue;
       twrIndex = twrIndex * (1 + dailyReturn);
    } else if (portValue > 0 && dailyCashFlow > 0) {
       twrIndex = 100;
    }
    
    prevPortValue = portValue;
`;

const newTWR = `
    if (prevPortValue > 0) {
       const dailyReturn = (stockValue - dailyStockCashFlow - prevPortValue) / prevPortValue;
       twrIndex = twrIndex * (1 + dailyReturn);
    } else if (stockValue > 0 && dailyStockCashFlow > 0) {
       twrIndex = 100;
    }
    
    prevPortValue = stockValue;
`;

code = code.replace(oldTWR, newTWR);

fs.writeFileSync('src/lib/chartUtils.ts', code);
