const yahooFinance = require('yahoo-finance2').default;
async function test() {
  try {
    const res = await yahooFinance.quote('BET.RO');
    console.log('BET.RO:', res.regularMarketPrice);
  } catch(e) { console.error('BET.RO failed', e.message); }
  try {
    const res = await yahooFinance.quote('^BETI');
    console.log('^BETI:', res.regularMarketPrice);
  } catch(e) { console.error('^BETI failed', e.message); }
  try {
    const res = await yahooFinance.quote('TVBETETF.RO');
    console.log('TVBETETF.RO:', res.regularMarketPrice);
  } catch(e) { console.error('TVBETETF.RO failed', e.message); }
}
test();
