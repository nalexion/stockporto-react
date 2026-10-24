import yf from 'yahoo-finance2';
const YahooFinance = (yf as any).default || yf;
const yahooFinance = new YahooFinance();

async function run() {
    const end = new Date();
    let start = new Date();
    start.setMonth(start.getMonth() - 6);
    
    for (const sym of ['LION.RO', 'SDRL', 'NHY.OL', 'PTENGETF.RO', 'SPCX']) {
       try {
         const chartResult = await yahooFinance.chart(sym, {
           period1: start,
           period2: end,
           interval: '1d'
         });
         console.log(sym, "Result length:", chartResult.quotes.length);
       } catch (e: any) {
         console.error(sym, "FAIL:", e.message);
       }
    }
}
run();
