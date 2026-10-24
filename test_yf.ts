import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
async function test() {
  try {
    const end = new Date();
    let start = new Date();
    start.setDate(start.getDate() - 2);
    
    const data = await yahooFinance.historical('TVBETETF.RO', {
      period1: start,
      period2: end,
      interval: '1d'
    });
    console.log('TVBETETF.RO 1d history:', data.length, 'records');
  } catch(e: any) {
    console.error('TVBETETF.RO history failed:', e.message);
  }
}
test();
