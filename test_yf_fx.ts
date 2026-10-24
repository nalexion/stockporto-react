import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
async function test() {
  const date = '2023-01-10';
  const start = new Date(date);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const data = await yahooFinance.chart('USDRON=X', {
    period1: start,
    period2: end,
    interval: '1d'
  });
  console.log('USDRON on', date, ':', data.quotes[0]?.close);
}
test();
