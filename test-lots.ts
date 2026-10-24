const lots = [
  { transactionType: 'DEPOSIT', shares: 1000, buyPrice: 1, ticker: 'CASH' },
  { transactionType: 'BUY', shares: 10, buyPrice: 50, ticker: 'AAPL', commission: 1 },
];
let cashBalance = 0;
lots.forEach(lot => {
  if (lot.transactionType === 'DEPOSIT') cashBalance += lot.shares;
  else if (lot.transactionType === 'WITHDRAWAL') cashBalance -= lot.shares;
  else if (lot.transactionType === 'BUY') cashBalance -= (lot.shares * lot.buyPrice) + (lot.commission || 0);
  else if (lot.transactionType === 'SELL') cashBalance += (lot.shares * lot.buyPrice) - (lot.commission || 0);
  else if (lot.transactionType === 'DIVIDEND') cashBalance += lot.buyPrice - (lot.commission || 0);
});
console.log("CashBalance:", cashBalance);
