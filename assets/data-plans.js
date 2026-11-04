// TradeZoro — live DATA add-ons (ES module). Owner 2026-11-04: all tools are free; live futures data is two monthly add-ons.
// Depends on: assets/progress.js (global db, optional: the plans doc check). No prices here: the price is shown only on the
// checkout page and /pricing (standing rule), read from the plans docs.
//   L1 Data = plans/LiveData   (live trades, candles, best bid/ask)
//   L2 Data = plans/LiveDataL2 (the live order book, includes L1)
export const DATA_PLAN = { L1: 'LiveData', L2: 'LiveDataL2' };
export const DATA_LABEL = { L1: 'Data feed L1', L2: 'Data feed L2' };
export const L2_LOCK = 'Live order book needs L2 Data.';
export const L1_LOCK = 'Live trades need L1 Data.';
// Open the data checkout for L ('L1' | 'L2'). If that plan doc is not live yet (or archived), go to /pricing instead of a dead checkout.
export function goDataCheckout(L) {
  const id = DATA_PLAN[L] || DATA_PLAN.L2, url = 'checkout.html?plan=' + id;
  const go = (ok) => { location.href = ok ? url : '/pricing'; };
  try {
    if (typeof db === 'undefined' || !db) return go(true);
    db.collection('plans').doc(id).get().then((d) => go(d.exists && d.data().archived !== true), () => go(true));
  } catch (e) { go(true); }
}
if (typeof window !== 'undefined') window.STRYKER_DATA = { goDataCheckout, DATA_PLAN, DATA_LABEL };
