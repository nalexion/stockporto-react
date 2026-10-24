const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/advisor/analyze-portfolio',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Body: ${data}`);
  });
});

req.write(JSON.stringify({
  holdings: [{ ticker: 'AAPL', shares: 10, value: 1500 }],
  currency: 'USD',
  totalValue: 1500
}));
req.end();
