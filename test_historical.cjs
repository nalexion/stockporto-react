async function run() {
  const fetch = (await import('node-fetch')).default;
  const res = await fetch('http://localhost:3000/api/historical', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'LX', period: '1mo' })
  });
  const data = await res.json();
  console.log("Historical LX (stripped) data count:", data.length);
  
  const res2 = await fetch('http://localhost:3000/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers: ['LX'], targetCurrency: 'USD' })
  });
  const data2 = await res2.json();
  console.log("Quote LX:", data2);
}
run();
