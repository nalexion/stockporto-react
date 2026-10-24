import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
yahooFinance.chart('CIVI', { interval: '1d' }).then(console.log).catch(console.error);
