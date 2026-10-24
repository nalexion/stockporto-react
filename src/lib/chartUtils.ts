import { TradeLot } from '../types';
import { fetchHistorical } from './api';

export async function generatePortfolioHistory(lots: TradeLot[], period: string): Promise<any[]> {
  const uniqueTickers = Array.from(new Set(lots.filter(l => l.ticker !== '$$CASH_TX').map(l => l.ticker)));
  
  // Fetch historical for all tickers in chunks of 3 to avoid rate limiting
  const histDataArr = [];
  for (let i = 0; i < uniqueTickers.length; i += 3) {
    const chunk = uniqueTickers.slice(i, i + 3);
    const chunkResults = await Promise.all(chunk.map(t => fetchHistorical(t, period)));
    histDataArr.push(...chunkResults);
    if (i + 3 < uniqueTickers.length) {
       await new Promise(r => setTimeout(r, 600)); // Sleep between chunks
    }
  }
  
  const end = new Date();
  const start = new Date();
  if (period === '1mo') start.setMonth(start.getMonth() - 1);
  if (period === '3mo') start.setMonth(start.getMonth() - 3);
  if (period === '6mo') start.setMonth(start.getMonth() - 6);
  if (period === '1y') start.setFullYear(start.getFullYear() - 1);
  if (period === '5y') start.setFullYear(start.getFullYear() - 5);
  if (period === 'max') start.setFullYear(2000);
  if (period === 'ytd') {
    start.setMonth(0);
    start.setDate(1);
  }
  
  const endStr = end.toISOString().split('T')[0];
  
  // Map history by ticker
  const histByTicker: Record<string, any[]> = {};
  uniqueTickers.forEach((t, i) => {
    histByTicker[t] = histDataArr[i] || [];
  });
  
  // Gather all unique dates from the histories
  const allDates = new Set<string>();
  Object.values(histByTicker).forEach(arr => {
    arr.forEach(d => {
      if (d && d.date) allDates.add(new Date(d.date).toISOString().split('T')[0]);
    });
  });

  // Fallback timeline generation when holdings are non-Yahoo assets (e.g. Fidelis Government Bonds)
  if (allDates.size < 3) {
    const cursor = new Date(start);
    while (cursor <= end) {
      allDates.add(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 7);
    }
    lots.forEach(l => {
      if (l.tradeDate && new Date(l.tradeDate) >= start) {
        allDates.add(l.tradeDate.split('T')[0]);
      }
    });
  }
  
  // Include today if not present
  allDates.add(endStr);
  const sortedDates = Array.from(allDates).sort((a, b) => a.localeCompare(b));
  
  let twrIndex = 100;
  let prevPortValue = 0;
  
  const data = sortedDates.map(dateStr => {
    const dateObj = new Date(dateStr);
    dateObj.setHours(23, 59, 59, 999);
    
    let cashBalance = 0;
    let netInvested = 0;
    
    // Lots up to this date
    const pastLots = lots.filter(l => new Date(l.tradeDate) <= dateObj);
    
    let dailyStockCashFlow = 0;
    const dailyLots = lots.filter(l => { 
       const dStr = new Date(l.tradeDate).toISOString().split('T')[0];
       return dStr === dateStr;
    });
    
    pastLots.forEach(lot => {
      if (lot.transactionType === 'DEPOSIT') {
        cashBalance += lot.shares;
        netInvested += lot.shares;
      } else if (lot.transactionType === 'WITHDRAWAL') {
        cashBalance -= lot.shares;
        netInvested -= lot.shares;
      } else if (lot.transactionType === 'BUY') {
        cashBalance -= (lot.shares * lot.buyPrice) + (lot.commission || 0);
      } else if (lot.transactionType === 'SELL') {
        cashBalance += (lot.shares * lot.buyPrice) - (lot.commission || 0);
      } else if (lot.transactionType === 'DIVIDEND') {
        cashBalance += lot.buyPrice + (lot.repaidAdvance || 0) - (lot.commission || 0);
      }
    });
    
    dailyLots.forEach(lot => { 
       if (lot.transactionType === 'BUY') dailyStockCashFlow += (lot.shares * lot.buyPrice) + (lot.commission || 0);
       if (lot.transactionType === 'SELL') dailyStockCashFlow -= (lot.shares * lot.buyPrice) - (lot.commission || 0);
       if (lot.transactionType === 'DIVIDEND') dailyStockCashFlow -= (lot.buyPrice + (lot.repaidAdvance || 0)) - (lot.commission || 0);
    });
    
    let portValue = cashBalance;
    let stockValue = 0;
    
    uniqueTickers.forEach(t => {
      const tLots = pastLots.filter(l => l.ticker === t).sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());
      let qty = 0;
      tLots.forEach(lot => {
        if (lot.transactionType === 'BUY') qty += lot.shares;
        else if (lot.transactionType === 'SPLIT') qty *= lot.shares;
        else if (lot.transactionType === 'SELL') qty -= lot.shares;
      });
      
      if (qty > 0) {
        const tHist = histByTicker[t];
        let price = 0;
        for (let i = tHist.length - 1; i >= 0; i--) {
          const histDateStr = new Date(tHist[i].date).toISOString().split('T')[0];
          if (histDateStr <= dateStr && tHist[i].close) {
            price = tHist[i].close;
            break;
          }
        }
        if (price === 0 && tHist.length > 0 && tHist[0].close) price = tHist[0].close;
        if (price === 0) {
          const lastBuy = [...tLots].reverse().find(l => l.transactionType === 'BUY');
          if (lastBuy && lastBuy.buyPrice) price = lastBuy.buyPrice;
        }
        
        portValue += qty * price;
        stockValue += qty * price;
      }
    });
    
    if (prevPortValue > 0) {
       const dailyReturn = (stockValue - dailyStockCashFlow - prevPortValue) / prevPortValue;
       twrIndex = twrIndex * (1 + dailyReturn);
    } else if (stockValue > 0 && dailyStockCashFlow > 0) {
       twrIndex = 100;
    }
    
    prevPortValue = stockValue;
    
    return {
      date: dateStr,
      value: portValue, 
      stockValue: stockValue, 
      invested: netInvested,
      twr: twrIndex
    };
  });
  
  return data;
}
