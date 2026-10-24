import { generatePortfolioHistory } from './src/lib/chartUtils';
import { fetchHistorical } from './src/lib/api';

const lots = [
  { ticker: 'AAPL', tradeDate: '2023-01-01', shares: 10, buyPrice: 150, transactionType: 'BUY' },
];

async function run() {
  try {
    const data = await generatePortfolioHistory(lots as any, '6mo');
    console.log("Success", data);
  } catch (err) {
    console.error("Error in generatePortfolioHistory", err);
  }
}
run();
