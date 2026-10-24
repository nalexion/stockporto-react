import { generatePortfolioHistory } from './src/lib/chartUtils';
import { fetchHistorical } from './src/lib/api';

const lots = [
  { ticker: 'AAPL', tradeDate: '2023-01-01', shares: 10, buyPrice: 150, transactionType: 'BUY' },
  { ticker: 'CIVI', tradeDate: '2023-02-01', shares: 5, buyPrice: 50, transactionType: 'BUY' },
];

generatePortfolioHistory(lots as any, '1mo')
  .then(data => console.log("Success", data))
  .catch(err => console.error("Error", err));
