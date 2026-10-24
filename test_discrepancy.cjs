async function run() {
  const fetch = (await import('node-fetch')).default;
  const headers = { 'user-email': 'NAlexIon@gmail.com' };
  
  const resPorts = await fetch('http://localhost:3000/api/portfolios', { headers });
  const ports = await resPorts.json();
  
  const resLots = await fetch('http://localhost:3000/api/lots', { headers });
  const lots = await resLots.json();
  
  const resRates = await fetch('http://localhost:3000/api/bnr-rates');
  const rates = await resRates.json();
  
  console.log("=== BNR Rates ===");
  console.log(rates);
  
  let globalTotalRon = 0;
  
  console.log("\n=== GlobalValuationBar Logic ===");
  for (const port of ports) {
    const portLots = lots.filter(l => l.portfolioId === port.id);
    const openTickers = Array.from(new Set(portLots.filter(l => l.status === 'OPEN' && !l.ticker.includes('CASH')).map(l => l.ticker)));
    
    let quotes = {};
    if (openTickers.length > 0) {
      const qRes = await fetch('http://localhost:3000/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: openTickers, targetCurrency: port.currency })
      });
      quotes = await qRes.json();
    }
    
    let portValue = 0;
    let cashBalance = 0;
    portLots.forEach(lot => {
      if (lot.transactionType === 'DEPOSIT') cashBalance += lot.shares;
      else if (lot.transactionType === 'WITHDRAWAL') cashBalance -= lot.shares;
      else if (lot.transactionType === 'BUY') cashBalance -= (lot.shares * lot.buyPrice) + (lot.commission || 0);
      else if (lot.transactionType === 'SELL') cashBalance += (lot.shares * lot.buyPrice) - (lot.commission || 0);
      else if (lot.transactionType === 'DIVIDEND') cashBalance += lot.buyPrice - (lot.commission || 0);
    });
    portValue += cashBalance;
    console.log(`[${port.name}] Cash Balance:`, cashBalance);
    
    const tickers = Array.from(new Set(portLots.map(l => l.ticker)));
    for (const t of tickers) {
      if (t === '$$CASH_TX') continue;
      const tLots = [...portLots.filter(l => l.ticker === t)].sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());
      
      let qty = 0;
      let avgCost = 0;
      tLots.forEach(lot => {
        if (lot.transactionType === 'BUY') {
          const newQty = qty + lot.shares;
          if (newQty > 0) avgCost = ((qty * avgCost) + (lot.shares * lot.buyPrice)) / newQty;
          qty = newQty;
        } else if (lot.transactionType === 'SPLIT') {
          qty *= lot.shares;
          avgCost /= lot.shares;
        } else if (lot.transactionType === 'SELL') {
          qty -= lot.shares;
          if (qty <= 0) { avgCost = 0; qty = 0; }
        }
      });
      
      if (qty > 0) {
        const currentPrice = quotes[t]?.convertedPrice || avgCost;
        const posValue = qty * currentPrice;
        portValue += posValue;
        console.log(`[${port.name}] Ticker: ${t}, Qty: ${qty}, Price: ${currentPrice}, PosValue: ${posValue}`);
      }
    }
    
    console.log(`[${port.name}] Total PortValue in ${port.currency}:`, portValue);
    
    if (port.currency === 'RON') globalTotalRon += portValue;
    else if (port.currency === 'EUR') globalTotalRon += portValue * rates.EUR;
    else if (port.currency === 'USD') globalTotalRon += portValue * rates.USD;
  }
  
  console.log("Global Total RON:", globalTotalRon);
  console.log("Global Total EUR:", globalTotalRon / rates.EUR);
  
  console.log("\n=== PortfolioList Logic ===");
  for (const p of ports) {
    const pLots = lots.filter(l => l.portfolioId === p.id);
    const pOpenTickers = Array.from(new Set(pLots.filter(l => l.status === 'OPEN' && !l.ticker.includes('CASH')).map(l => l.ticker)));
    
    let pQuotes = {};
    if (pOpenTickers.length > 0) {
      const qRes = await fetch('http://localhost:3000/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: pOpenTickers, targetCurrency: p.currency })
      });
      pQuotes = await qRes.json();
    }
    
    let totalValue = 0;
    let cashBalance = 0;
    pLots.forEach(lot => {
      if (lot.transactionType === 'DEPOSIT') cashBalance += lot.shares;
      else if (lot.transactionType === 'WITHDRAWAL') cashBalance -= lot.shares;
      else if (lot.transactionType === 'BUY') cashBalance -= (lot.shares * lot.buyPrice) + (lot.commission || 0);
      else if (lot.transactionType === 'SELL') cashBalance += (lot.shares * lot.buyPrice) - (lot.commission || 0);
      else if (lot.transactionType === 'DIVIDEND') cashBalance += lot.buyPrice - (lot.commission || 0);
    });
    totalValue += cashBalance;
    
    const tickers = Array.from(new Set(pLots.map(l => l.ticker)));
    for (const t of tickers) {
      if (t === '$$CASH_TX') continue;
      const tLots = [...pLots.filter(l => l.ticker === t)].sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());
      
      let qty = 0;
      let avgCost = 0;
      tLots.forEach(lot => {
        if (lot.transactionType === 'BUY') {
          const newQty = qty + lot.shares;
          if (newQty > 0) avgCost = ((qty * avgCost) + (lot.shares * lot.buyPrice)) / newQty;
          qty = newQty;
        } else if (lot.transactionType === 'SPLIT') {
          qty *= lot.shares;
          avgCost /= lot.shares;
        } else if (lot.transactionType === 'SELL') {
          qty -= lot.shares;
          if (qty <= 0) { avgCost = 0; qty = 0; }
        }
      });
      
      if (qty > 0) {
        const currentPrice = pQuotes[t]?.convertedPrice || avgCost;
        totalValue += qty * currentPrice;
      }
    }
    console.log(`[${p.name}] TotalValue:`, totalValue);
  }
}
run();
