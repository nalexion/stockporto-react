import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
async function test() {
  try {
    const end = new Date();
    let start = new Date();
    start.setDate(start.getDate() - 2);
    
    // Testing chart() for intraday
    const data = await yahooFinance.chart('^GSPC', {
      period1: start,
      period2: end,
      interval: '15m'
    });
    console.log('^GSPC 15m:', data.quotes.length, 'records');
  } catch(e: any) {
    console.error('^GSPC failed:', e.message);
  }
}
test();
