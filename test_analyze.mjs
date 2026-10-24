const res = await fetch('http://localhost:3000/api/advisor/analyze-portfolio', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    holdings: [
      { ticker: 'AAPL', shares: 10, value: 1500 }
    ],
    currency: 'USD',
    totalValue: 1500
  })
});
const text = await res.text();
console.log(text);
