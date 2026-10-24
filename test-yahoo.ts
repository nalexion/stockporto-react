import yf from 'yahoo-finance2';
const YahooFinance = (yf as any).default || yf;
const yahooFinance = new YahooFinance();
async function test() {
  const quotes = await yahooFinance.quote(['EURRON=X', 'USDRON=X']);
  console.log(quotes.map((q: any) => `${q.symbol}: ${q.regularMarketPrice}`));
}
test();
