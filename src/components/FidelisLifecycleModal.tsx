import React, { useState, useMemo } from 'react';
import { Portfolio, TickerGroup } from '../types';
import { createLots, updateLot } from '../lib/api';
import { X, Landmark, Calendar, CheckCircle2, PlusCircle, ShieldCheck } from 'lucide-react';
import {
  parseFidelisTicker,
  suggestFidelisStartDate,
  inferFidelisTenorAndStartDate,
  getFidelisCouponSchedule,
} from '../config/taxRules';

export default function FidelisLifecycleModal({
  portfolio,
  group,
  onClose,
  onSuccess,
}: {
  portfolio: Portfolio;
  group: TickerGroup;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const fidelisInfo = parseFidelisTicker(group.ticker);

  // Extract existing parameters from the group's lots
  const initialMeta = useMemo(() => {
    let foundRate: number | undefined;
    let foundStart: string | undefined;
    let foundTenor: number | undefined;

    for (const lot of group.lots) {
      if (lot.couponRate !== undefined && foundRate === undefined) foundRate = lot.couponRate;
      if (lot.couponStartDate && !foundStart) foundStart = lot.couponStartDate;
      if (lot.maturityYears && !foundTenor) foundTenor = lot.maturityYears;
    }

    const firstBuy = group.lots.find(l => l.transactionType === 'BUY');
    const inferred = fidelisInfo
      ? inferFidelisTenorAndStartDate(
          fidelisInfo,
          firstBuy?.tradeDate || '',
          firstBuy?.tradeDate?.split('-')[2] || '15'
        )
      : { maturityYears: 1, couponStartDate: new Date().toISOString().split('T')[0] };

    return {
      couponRate: foundRate !== undefined ? foundRate.toString() : '6.50',
      couponStartDate: foundStart || inferred.couponStartDate,
      maturityYears: foundTenor || inferred.maturityYears,
    };
  }, [group.lots, fidelisInfo?.baseSymbol]);

  const [couponRate, setCouponRate] = useState(initialMeta.couponRate);
  const [couponStartDate, setCouponStartDate] = useState(initialMeta.couponStartDate);
  const [maturityYears, setMaturityYears] = useState<number>(initialMeta.maturityYears);
  const [redemptionDate, setRedemptionDate] = useState(() => {
    const sched = getFidelisCouponSchedule(
      initialMeta.couponStartDate,
      initialMeta.maturityYears,
      parseFloat(initialMeta.couponRate || '0'),
      group.netQty > 0 ? group.netQty : 100
    );
    return sched?.maturityDate || new Date().toISOString().split('T')[0];
  });
  const [includeFinalCouponOnRedeem, setIncludeFinalCouponOnRedeem] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savedTermsNotice, setSavedTermsNotice] = useState(false);

  const referenceUnits = useMemo(() => {
    if (group.netQty > 0) return group.netQty;
    const totalBought = group.lots
      .filter(l => l.transactionType === 'BUY')
      .reduce((acc, l) => acc + l.shares, 0);
    return totalBought > 0 ? totalBought : 0;
  }, [group.netQty, group.lots]);

  const loggedCouponsByDate = useMemo(() => {
    const map: Record<string, import('../types').TradeLot> = {};
    group.lots.forEach(l => {
      if (l.transactionType === 'DIVIDEND') {
        map[l.tradeDate] = l;
      }
    });
    return map;
  }, [group.lots]);

  const loggedCouponDates = useMemo(() => {
    return new Set(Object.keys(loggedCouponsByDate));
  }, [loggedCouponsByDate]);

  const earliestBuyDate = useMemo(() => {
    const buys = group.lots
      .filter(l => l.transactionType === 'BUY')
      .map(l => l.tradeDate)
      .sort();
    return buys[0] || '';
  }, [group.lots]);

  const totalBuyAccrued = useMemo(() => {
    return Number(
      group.lots
        .filter(l => l.transactionType === 'BUY')
        .reduce((acc, l) => {
          if (l.totalInterestAdvanced !== undefined) return acc + l.totalInterestAdvanced;
          if (l.accruedInterest && l.accruedInterest > 0) return acc + l.shares * l.accruedInterest;
          return acc;
        }, 0)
        .toFixed(2)
    );
  }, [group.lots]);

  const scheduleInfo = useMemo(() => {
    if (!fidelisInfo) return null;
    return getFidelisCouponSchedule(
      couponStartDate,
      maturityYears,
      parseFloat(couponRate || '0'),
      referenceUnits,
      fidelisInfo.nominalPar
    );
  }, [fidelisInfo?.baseSymbol, couponStartDate, maturityYears, couponRate, referenceUnits]);

  const [customRowAmounts, setCustomRowAmounts] = useState<Record<string, string>>({});

  function handleTenorChange(newTenor: number) {
    setMaturityYears(newTenor);
    if (fidelisInfo) {
      const day = couponStartDate?.split('-')[2] || '15';
      const suggestedStart = suggestFidelisStartDate(fidelisInfo, newTenor, day);
      setCouponStartDate(suggestedStart);
      const nextSched = getFidelisCouponSchedule(
        suggestedStart,
        newTenor,
        parseFloat(couponRate || '0'),
        referenceUnits,
        fidelisInfo.nominalPar
      );
      if (nextSched) setRedemptionDate(nextSched.maturityDate);
    }
  }

  function handleStartDateChange(newStart: string) {
    setCouponStartDate(newStart);
    if (fidelisInfo) {
      const nextSched = getFidelisCouponSchedule(
        newStart,
        maturityYears,
        parseFloat(couponRate || '0'),
        referenceUnits,
        fidelisInfo.nominalPar
      );
      if (nextSched) setRedemptionDate(nextSched.maturityDate);
    }
  }

  async function persistTermsToBuyLots() {
    const parsedRate = parseFloat(couponRate || '0');
    const buyLots = group.lots.filter(l => l.transactionType === 'BUY');
    await Promise.all(
      buyLots.map(lot =>
        updateLot(lot.id, {
          couponRate: !isNaN(parsedRate) ? parsedRate : undefined,
          couponStartDate,
          maturityYears,
          maturityDate: scheduleInfo?.maturityDate,
        })
      )
    );
  }

  async function handleSaveTermsOnly() {
    setSubmitting(true);
    await persistTermsToBuyLots();
    setSubmitting(false);
    setSavedTermsNotice(true);
    setTimeout(() => setSavedTermsNotice(false), 2500);
    onSuccess();
  }

  async function handleLogSingleCoupon(yearIndex: number, couponDate: string, amount: number) {
    if (amount < 0 || !fidelisInfo) return;
    setSubmitting(true);
    await persistTermsToBuyLots();
    const existingDiv = loggedCouponsByDate[couponDate];
    const grossAmount = scheduleInfo ? scheduleInfo.annualCouponTotal : amount;
    const firstAfterBuy = scheduleInfo?.schedule.find(
      s => !earliestBuyDate || s.couponDate > earliestBuyDate
    );
    const isFirstAfterBuy = firstAfterBuy?.couponDate === couponDate;
    const repaidAdv =
      isFirstAfterBuy && totalBuyAccrued > 0 && amount < grossAmount
        ? Number((grossAmount - amount).toFixed(2))
        : 0;

    const commentText =
      repaidAdv > 0
        ? `Year 1 Coupon (Secondary BVB) · Gross: ${grossAmount.toFixed(2)} · Bucket 1 Advance Reimbursed: ${repaidAdv.toFixed(2)} · Bucket 2 Net Profit: ${amount.toFixed(2)}`
        : `Year ${yearIndex} Fidelis Annual Coupon (${couponRate}% p.a. on ${referenceUnits} units)`;

    if (existingDiv) {
      await updateLot(existingDiv.id, {
        shares: referenceUnits,
        buyPrice: amount,
        repaidAdvance: repaidAdv,
        grossCouponCash: grossAmount,
        comment: commentText,
        couponRate: parseFloat(couponRate || '0'),
        couponStartDate,
        maturityYears,
        maturityDate: scheduleInfo?.maturityDate,
      });
    } else {
      await createLots(portfolio.id, [
        {
          id: `coupon_${portfolio.id}_${fidelisInfo.baseSymbol}_${couponDate}`,
          ticker: group.ticker,
          tradeDate: couponDate,
          shares: referenceUnits,
          buyPrice: amount,
          repaidAdvance: repaidAdv > 0 ? repaidAdv : undefined,
          grossCouponCash: grossAmount,
          brokerType: 'Resident',
          status: 'CLOSED',
          transactionType: 'DIVIDEND',
          commission: 0,
          comment: commentText,
          couponRate: parseFloat(couponRate || '0'),
          couponStartDate,
          maturityYears,
          maturityDate: scheduleInfo?.maturityDate,
        },
      ]);
    }
    setSubmitting(false);
    onSuccess();
  }

  async function handleLogAllDueCoupons() {
    if (!scheduleInfo || !fidelisInfo) return;
    const todayIso = new Date().toISOString().split('T')[0];
    const unloggedDue = scheduleInfo.schedule.filter(
      s => s.couponDate <= todayIso && !loggedCouponDates.has(s.couponDate) && s.totalCouponAmount > 0
    );
    if (!unloggedDue.length) return;

    setSubmitting(true);
    await persistTermsToBuyLots();
    await createLots(
      portfolio.id,
      unloggedDue.map(item => ({
        id: `coupon_${portfolio.id}_${fidelisInfo.baseSymbol}_${item.couponDate}`,
        ticker: group.ticker,
        tradeDate: item.couponDate,
        shares: referenceUnits,
        buyPrice: item.totalCouponAmount,
        brokerType: 'Resident',
        status: 'CLOSED',
        transactionType: 'DIVIDEND',
        commission: 0,
        comment: `Year ${item.yearIndex} Fidelis Annual Coupon (${couponRate}% p.a. on ${referenceUnits} units)`,
        couponRate: parseFloat(couponRate || '0'),
        couponStartDate,
        maturityYears,
        maturityDate: scheduleInfo.maturityDate,
      }))
    );
    setSubmitting(false);
    onSuccess();
  }

  async function handleMaturityRedemption() {
    if (group.netQty <= 0 || !fidelisInfo) return;
    setSubmitting(true);
    await persistTermsToBuyLots();

    const lotsToCreate: any[] = [];
    const finalCouponAmount = scheduleInfo ? scheduleInfo.annualCouponTotal : 0;
    const finalCouponAlreadyLogged = loggedCouponDates.has(redemptionDate);

    if (includeFinalCouponOnRedeem && finalCouponAmount > 0 && !finalCouponAlreadyLogged) {
      lotsToCreate.push({
        ticker: group.ticker,
        tradeDate: redemptionDate,
        shares: group.netQty,
        buyPrice: finalCouponAmount,
        brokerType: 'Resident',
        status: 'CLOSED',
        transactionType: 'DIVIDEND',
        commission: 0,
        comment: `Final Maturity Coupon (${couponRate}% on ${group.netQty} units)`,
        couponRate: parseFloat(couponRate || '0'),
        couponStartDate,
        maturityYears,
        maturityDate: redemptionDate,
      });
    }

    // Principal redemption at 100.00 Par (0 commission)
    lotsToCreate.push({
      ticker: group.ticker,
      tradeDate: redemptionDate,
      shares: group.netQty,
      buyPrice: fidelisInfo.nominalPar,
      cleanPrice: fidelisInfo.nominalPar,
      accruedInterest: 0,
      dirtyPrice: fidelisInfo.nominalPar,
      brokerType: 'Resident',
      status: 'CLOSED',
      transactionType: 'SELL',
      commission: 0,
      comment: `Maturity Redemption at ${fidelisInfo.nominalPar}.00 Par (0% Tax & 0 Fee)`,
      couponRate: parseFloat(couponRate || '0'),
      couponStartDate,
      maturityYears,
      maturityDate: redemptionDate,
    });

    await createLots(portfolio.id, lotsToCreate);
    setSubmitting(false);
    onClose();
  }

  if (!fidelisInfo) return null;

  const todayIso = new Date().toISOString().split('T')[0];
  const unloggedDueCoupons = scheduleInfo
    ? scheduleInfo.schedule.filter(
        s => s.couponDate <= todayIso && !loggedCouponDates.has(s.couponDate) && s.totalCouponAmount > 0
      )
    : [];

  return (
    <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-xl w-full max-w-xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="flex justify-between items-center px-6 py-4 border-b border-[#E2E8F0] shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Landmark size={18} className="text-[#0D9488]" />
              <h2 className="text-lg font-display font-semibold tracking-tight text-[#0F172A]">
                {group.ticker} — Fidelis Coupon &amp; Maturity Manager
              </h2>
            </div>
            <p className="text-xs text-[#64748B] font-mono mt-0.5">
              {fidelisInfo.currency} Sovereign Bond · Par {fidelisInfo.nominalPar}.00 · Open Units: {group.netQty} · 0% Tax &amp; CASS Exempt
            </p>
          </div>
          <button onClick={onClose} className="text-[#64748B] hover:text-[#0F172A] transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {/* 1. Bond Coupon & Tenor Configuration */}
          <div className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#0F172A] flex items-center gap-1.5">
                <Calendar size={14} className="text-[#0D9488]" />
                1. Issue Date, Tenor &amp; Coupon Rate
              </span>
              <button
                type="button"
                onClick={handleSaveTermsOnly}
                disabled={submitting}
                className="text-xs font-medium text-[#1E40AF] hover:underline disabled:opacity-50"
              >
                {savedTermsNotice ? 'Saved to Bond Lots ✓' : 'Save Terms to Bond'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Coupon Rate (% p.a.)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  max="25"
                  value={couponRate}
                  onChange={e => setCouponRate(e.target.value)}
                  className="w-full border border-[#CBD5E1] rounded-md px-3 py-1.5 text-sm font-mono tabular-nums text-[#0F172A] bg-white focus:ring-2 focus:ring-[#1E40AF] outline-none"
                  placeholder="6.85"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Maturity Years</label>
                <select
                  value={maturityYears}
                  onChange={e => handleTenorChange(parseInt(e.target.value, 10))}
                  className="w-full border border-[#CBD5E1] rounded-md px-3 py-1.5 text-sm font-mono text-[#0F172A] bg-white focus:ring-2 focus:ring-[#1E40AF] outline-none"
                >
                  <option value={1}>1 Year (1Y)</option>
                  <option value={2}>2 Years (2Y)</option>
                  <option value={3}>3 Years (3Y)</option>
                  <option value={5}>5 Years (5Y)</option>
                  <option value={10}>10 Years (10Y)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Coupon Start Date</label>
                <input
                  type="date"
                  value={couponStartDate}
                  onChange={e => handleStartDateChange(e.target.value)}
                  className="w-full border border-[#CBD5E1] rounded-md px-2.5 py-1.5 text-sm font-mono tabular-nums text-[#0F172A] bg-white focus:ring-2 focus:ring-[#1E40AF] outline-none"
                />
              </div>
            </div>
          </div>

          {/* 2. Automatic Annual Coupon Schedule */}
          {scheduleInfo && (
            <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#0F172A]">
                    2. Calculated Annual Coupon Schedule ({referenceUnits} units)
                  </h3>
                  <p className="text-[11px] text-[#64748B] font-mono">
                    Annual Coupon: {scheduleInfo.annualCouponPerBond.toFixed(2)} / unit · Total:{' '}
                    <strong className="text-[#059669]">
                      {scheduleInfo.annualCouponTotal.toFixed(2)} {portfolio.currency} / year
                    </strong>
                  </p>
                </div>
                {unloggedDueCoupons.length > 0 && (
                  <button
                    type="button"
                    onClick={handleLogAllDueCoupons}
                    disabled={submitting}
                    className="px-3 py-1.5 bg-[#0D9488] hover:bg-[#0F766E] text-white rounded-md text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    1-Click Log Due ({unloggedDueCoupons.length})
                  </button>
                )}
              </div>

              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[#64748B] border-b border-[#E2E8F0] bg-white">
                    <th className="py-2 px-4 font-semibold">Tranche Year</th>
                    <th className="py-2 px-4 font-semibold">Coupon Date</th>
                    <th className="py-2 px-4 text-right font-semibold">Tax-Exempt Amount ({portfolio.currency})</th>
                    <th className="py-2 px-4 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {scheduleInfo.schedule.map(item => {
                    const existingDiv = loggedCouponsByDate[item.couponDate];
                    const isLogged = Boolean(existingDiv);
                    const isBeforePurchase = earliestBuyDate && item.couponDate <= earliestBuyDate;
                    const isDue = item.couponDate <= todayIso && !isBeforePurchase;

                    const firstAfterBuy = scheduleInfo.schedule.find(
                      s => !earliestBuyDate || s.couponDate > earliestBuyDate
                    );
                    const isFirstCouponAfterBuy = firstAfterBuy?.couponDate === item.couponDate;
                    const netAfterAccrued =
                      isFirstCouponAfterBuy && totalBuyAccrued > 0
                        ? Math.max(0, Number((item.totalCouponAmount - totalBuyAccrued).toFixed(2)))
                        : null;

                    const defaultAmount = existingDiv
                      ? existingDiv.buyPrice
                      : item.totalCouponAmount;
                    const inputVal =
                      customRowAmounts[item.couponDate] !== undefined
                        ? customRowAmounts[item.couponDate]
                        : defaultAmount.toFixed(2);
                    const parsedInputVal = parseFloat(inputVal);
                    const hasChangedFromLogged =
                      existingDiv && !isNaN(parsedInputVal) && Math.abs(parsedInputVal - existingDiv.buyPrice) > 0.005;

                    return (
                      <tr key={item.yearIndex} className={`hover:bg-[#F8FAFC] ${isBeforePurchase ? 'opacity-50 bg-[#F8FAFC]/60' : ''}`}>
                        <td className="py-2.5 px-4 font-mono text-[#0F172A]">
                          <div>Year {item.yearIndex} {item.isMaturity ? '· Maturity' : ''}</div>
                          {isBeforePurchase && (
                            <span className="text-[10px] text-[#64748B]">Prior to purchase ({earliestBuyDate})</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-[#334155]">
                          <div>
                            {item.couponDate}
                            {!isLogged && isDue && (
                              <span className="ml-2 text-[10px] font-semibold text-[#D97706]">DUE</span>
                            )}
                          </div>
                          {netAfterAccrued !== null && !isBeforePurchase && (
                            <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                              <button
                                type="button"
                                onClick={() =>
                                  setCustomRowAmounts(prev => ({
                                    ...prev,
                                    [item.couponDate]: netAfterAccrued.toFixed(2),
                                  }))
                                }
                                className="text-[#0D9488] hover:underline font-medium"
                              >
                                Set Net (-Accrued): {netAfterAccrued.toFixed(2)}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setCustomRowAmounts(prev => ({
                                    ...prev,
                                    [item.couponDate]: item.totalCouponAmount.toFixed(2),
                                  }))
                                }
                                className="text-[#1E40AF] hover:underline"
                              >
                                Full: {item.totalCouponAmount.toFixed(2)}
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {isBeforePurchase ? (
                            <span className="text-[#94A3B8]">-</span>
                          ) : (
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={inputVal}
                              onChange={e =>
                                setCustomRowAmounts(prev => ({
                                  ...prev,
                                  [item.couponDate]: e.target.value,
                                }))
                              }
                              className="w-28 border border-[#CBD5E1] rounded px-2 py-1 text-xs font-mono font-semibold tabular-nums text-[#059669] bg-white focus:ring-2 focus:ring-[#1E40AF] outline-none text-right"
                            />
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {isBeforePurchase ? (
                            <span className="text-[11px] font-mono text-[#94A3B8]">N/A</span>
                          ) : isLogged && !hasChangedFromLogged ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#059669] font-medium">
                              <CheckCircle2 size={13} /> Logged
                            </span>
                          ) : isLogged && hasChangedFromLogged ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleLogSingleCoupon(item.yearIndex, item.couponDate, parsedInputVal)
                              }
                              disabled={submitting || isNaN(parsedInputVal) || parsedInputVal <= 0}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#0D9488] hover:bg-[#0F766E] text-white font-medium text-[11px] transition-colors disabled:opacity-50"
                            >
                              Save ({parsedInputVal.toFixed(2)})
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                handleLogSingleCoupon(
                                  item.yearIndex,
                                  item.couponDate,
                                  !isNaN(parsedInputVal) && parsedInputVal > 0
                                    ? parsedInputVal
                                    : item.totalCouponAmount
                                )
                              }
                              disabled={submitting || (isNaN(parsedInputVal) || parsedInputVal <= 0)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#EFF6FF] hover:bg-[#DBEAFE] text-[#1E40AF] font-medium text-[11px] transition-colors disabled:opacity-50"
                            >
                              <PlusCircle size={12} /> Log Coupon
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 3. 1-Click Maturity Redemption at 100.00 Par */}
          <div className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] border-l-2 border-l-[#1E40AF] rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#0F172A]">
                  3. 1-Click Maturity Principal Redemption (100.00 Par)
                </h3>
                <p className="text-[11px] text-[#64748B] mt-0.5">
                  At maturity, the Ministry of Finance repays 100.00 Par per unit with 0 broker commission and 0% tax.
                </p>
              </div>
              <ShieldCheck size={18} className="text-[#1E40AF] shrink-0" />
            </div>

            {group.netQty > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-medium text-[#475569] mb-1">
                      Maturity Redemption Date
                    </label>
                    <input
                      type="date"
                      value={redemptionDate}
                      onChange={e => setRedemptionDate(e.target.value)}
                      className="w-full border border-[#CBD5E1] rounded-md px-3 py-1.5 text-xs font-mono tabular-nums text-[#0F172A] bg-white focus:ring-2 focus:ring-[#1E40AF] outline-none"
                    />
                  </div>
                  <div className="flex flex-col justify-end">
                    <div className="px-3 py-1.5 bg-white border border-[#E2E8F0] rounded-md text-xs font-mono flex items-center justify-between">
                      <span className="text-[#64748B]">Principal ({group.netQty} × 100):</span>
                      <strong className="text-[#0F172A]">
                        {(group.netQty * fidelisInfo.nominalPar).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        {portfolio.currency}
                      </strong>
                    </div>
                  </div>
                </div>

                {scheduleInfo && scheduleInfo.annualCouponTotal > 0 && !loggedCouponDates.has(redemptionDate) && (
                  <label className="flex items-center gap-2 text-xs text-[#334155] cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={includeFinalCouponOnRedeem}
                      onChange={e => setIncludeFinalCouponOnRedeem(e.target.checked)}
                      className="rounded border-[#CBD5E1] text-[#1E40AF] focus:ring-[#1E40AF]"
                    />
                    <span>
                      Also record Final Annual Coupon of{' '}
                      <strong className="font-mono text-[#059669]">
                        +{scheduleInfo.annualCouponTotal.toFixed(2)} {portfolio.currency}
                      </strong>{' '}
                      on {redemptionDate}
                    </span>
                  </label>
                )}

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleMaturityRedemption}
                    disabled={submitting}
                    className="px-4 py-2 bg-[#1E40AF] hover:bg-[#1E3A8A] text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {submitting
                      ? 'Processing Redemption...'
                      : `Redeem ${group.netQty} Units at 100.00 Par${
                          includeFinalCouponOnRedeem &&
                          scheduleInfo &&
                          scheduleInfo.annualCouponTotal > 0 &&
                          !loggedCouponDates.has(redemptionDate)
                            ? ' + Final Coupon'
                            : ''
                        }`}
                  </button>
                </div>
              </>
            ) : (
              <div className="text-xs font-mono text-[#059669] flex items-center gap-1.5 pt-1">
                <CheckCircle2 size={14} /> This Fidelis position is already redeemed / closed (0 open units).
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-[#E2E8F0] bg-[#F8FAFC] flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-[#475569] hover:text-[#0F172A] hover:bg-[#E2E8F0]/50 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
