import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
yahooFinance.chart('CIVI', { period1: new Date('2020-01-01'), interval: '1d' }).then(console.log).catch(console.error);
