import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
async function test() {
  const data = await yahooFinance.chart('TVBETETF.RO', {
    period1: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    interval: '15m'
  });
  console.log('Quotes[0]:', data.quotes[0]);
}
test();
