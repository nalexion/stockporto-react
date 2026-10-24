async function run() {
  const fetch = (await import('node-fetch')).default;
  // wait, node 22 has built-in fetch!
  const resPorts = await fetch('http://localhost:3000/api/portfolios', { headers: { 'user-email': 'NAlexIon@gmail.com' } });
  const ports = await resPorts.json();
  
  const resLots = await fetch('http://localhost:3000/api/lots', { headers: { 'user-email': 'NAlexIon@gmail.com' } });
  const lots = await resLots.json();
  
  for (const p of ports) {
    const pLots = lots.filter(l => l.portfolioId === p.id);
    const pOpenTickers = Array.from(new Set(
      pLots.filter(l => l.status === 'OPEN' && !l.ticker.includes('CASH')).map(l => l.ticker)
    ));
    
    let pQuotes = {};
    if (pOpenTickers.length > 0) {
      const qRes = await fetch('http://localhost:3000/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: pOpenTickers, targetCurrency: p.currency })
      });
      pQuotes = await qRes.json();
      const remappedData = {};
      for (const [key, val] of Object.entries(pQuotes)) {
        remappedData[key] = val;
        if (key.endsWith('.AS')) remappedData[key.replace('.AS', '.NL')] = val;
      }
      pQuotes = remappedData;
    }
    
    let totalInvested = 0;
    let totalValue = 0;
    const tickers = Array.from(new Set(pLots.map(l => l.ticker)));
    for (const t of tickers) {
      const tLots = [...pLots.filter(l => l.ticker === t)].sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());
      
      if (t === '$$CASH_TX') {
        let bal = 0;
        tLots.forEach(l => {
          if (l.transactionType === 'DEPOSIT') bal += l.shares;
          if (l.transactionType === 'WITHDRAWAL') bal -= l.shares;
        });
        totalInvested += bal;
        totalValue += bal;
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
          const currentCost = qty * avgCost;
          totalInvested += currentCost;
          const currentPrice = pQuotes[t]?.convertedPrice || avgCost;
          totalValue += qty * currentPrice;
        }
      }
    }
    console.log("PortList:", p.name, "totalValue:", totalValue);
  }
}
run();
