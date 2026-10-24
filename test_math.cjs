async function run() {
  const fetch = (await import('node-fetch')).default;
  // wait, node 22 has built-in fetch!
  const resPorts = await fetch('http://localhost:3000/api/portfolios', { headers: { 'user-email': 'NAlexIon@gmail.com' } });
  const ports = await resPorts.json();
  
  const resLots = await fetch('http://localhost:3000/api/lots', { headers: { 'user-email': 'NAlexIon@gmail.com' } });
  const lots = await resLots.json();
  
  const resRates = await fetch('http://localhost:3000/api/bnr-rates');
  const rates = await resRates.json();
  
  let totalRon = 0;
  console.log("Ports:", ports.map(p => p.id));
  for (const port of ports) {
    const portLots = lots.filter(l => l.portfolioId === port.id);
    const openTickers = Array.from(new Set(
      portLots.filter(l => l.status === 'OPEN' && !l.ticker.includes('CASH')).map(l => l.ticker)
    ));
    
    let quotes = {};
    if (openTickers.length > 0) {
      const qRes = await fetch('http://localhost:3000/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: openTickers, targetCurrency: port.currency })
      });
      quotes = await qRes.json();
      const remappedData = {};
      for (const [key, val] of Object.entries(quotes)) {
        remappedData[key] = val;
        if (key.endsWith('.AS')) remappedData[key.replace('.AS', '.NL')] = val;
      }
      quotes = remappedData;
    }
    
    let portValue = 0;
    const tickers = Array.from(new Set(portLots.map(l => l.ticker)));
    for (const t of tickers) {
      const tLots = [...portLots.filter(l => l.ticker === t)].sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());
      
      if (t === '$$CASH_TX') {
        let bal = 0;
        tLots.forEach(l => {
          if (l.transactionType === 'DEPOSIT') bal += l.shares;
          if (l.transactionType === 'WITHDRAWAL') bal -= l.shares;
        });
        portValue += bal;
      } else {
        let qty = 0;
        let avgCost = 0;
        tLots.forEach(lot => {
          if (lot.transactionType === 'BUY') {
            const newQty = qty + lot.shares;
            if (newQty > 0) {
              avgCost = ((qty * avgCost) + (lot.shares * lot.buyPrice)) / newQty;
            }
            qty = newQty;
          } else if (lot.transactionType === 'SPLIT') {
            qty *= lot.shares;
            avgCost /= lot.shares;
          } else if (lot.transactionType === 'SELL') {
            qty -= lot.shares;
            if (qty <= 0) {
              avgCost = 0;
              qty = 0;
            }
          }
        });
        
        if (qty > 0) {
          const currentPrice = quotes[t]?.convertedPrice || avgCost;
          portValue += qty * currentPrice;
        }
      }
    }
    console.log("Port:", port.name, "portValue:", portValue);
    if (port.currency === 'RON') totalRon += portValue;
    else if (port.currency === 'EUR') totalRon += portValue * rates.EUR;
    else if (port.currency === 'USD') totalRon += portValue * rates.USD;
  }
  
  console.log("totalRon:", totalRon);
  let displayValue = totalRon / rates.EUR;
  console.log("displayValue (EUR):", displayValue);
}
run();
