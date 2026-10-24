import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
yahooFinance.quote(['AAPL', 'CIVI']).then(console.log).catch(console.error);
