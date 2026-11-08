// TradeZoro — Dark Pool Prints: more detail per print (DP-DETAIL, Owner 2026-11-07: "whether dark pool order was buy or sell, limit
// or market etc more details?"). Pure helpers, used by assets/chart-darkpool.js. Tests: tools/tests/chart-darkpool-detail.test.mjs.
// TRUTH: an off-exchange trade report has NO side and NO order type. Nobody reports buy/sell or limit/market for these trades, so:
//  - SIDE is an ESTIMATE made by the feeder (workers/book-recorder/dp-feeder/dp_feeder.py SideEstimator) from the exchange trades of the
//    5 seconds before the print: at/above their high and over their VWAP -> 'b' likely buy; at/below the low and under VWAP -> 's' likely
//    sell; otherwise 'u' unclear; 'l' late report (the report carries the report time only). Parts stored before DP-DETAIL have no side.
//  - ORDER TYPE is never shown. TYPE OF PRINT comes from the sale conditions the report does carry (printType).
// Day context (dv in the v2 part: day volume, regular-session VWAP) -> % of the day's volume, distance from VWAP.
// Wording: plain English, never live / real-time; no vendor names. Education only. Not financial advice.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const SIDE = { b: 'Likely buy', s: 'Likely sell', u: 'Unclear', l: 'Unclear (late report)' };
export const sideText = (d) => SIDE[d] || '';
export const SIDE_NOTE = 'Buy or sell is an estimate from exchange prices in the 5 seconds before. The report does not give the side or the order type.';
// sale condition code -> plain English (every code of the US trade report specs; the ones seen on real prints are first)
const COND = {
  B: 'Average-price trade', W: 'Average-price trade', 4: 'Derivatively priced (tied to options or swaps)',
  7: 'Contingent trade (paired with another deal)', V: 'Contingent trade (paired with another deal)',
  P: 'Prior reference price (priced earlier, reported now)', Z: 'Late report', U: 'Late report',
  F: 'Intermarket sweep', I: 'Odd lot', C: 'Cash trade (same-day settlement)', X: 'Cross trade', O: 'Opening print', 6: 'Closing print',
  M: 'Official close', Q: 'Official open', 9: 'Corrected close', 5: 'Reopening print', N: 'Next-day settlement', R: "Seller's option",
  H: 'Price variation', L: 'Sold last', K: 'Rule 155 trade', E: 'Automatic execution', A: 'Acquisition', D: 'Distribution',
  S: 'Split trade', 1: 'Stopped stock', 8: 'Exempt trade'
};
// NY day key: sessions run 04:00-20:00 ET, so t - 5 h is on the same UTC date in both EST and EDT (no time-zone lookup per row)
export const dayKey = (t) => new Date(t - 5 * 3600e3).toISOString().slice(0, 10);
const nyMin = (t) => { try { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)); const g = (k) => +p.find((x) => x.type === k).value; return g('hour') * 60 + g('minute'); } catch (e) { return 600; } };
// conditions (+ time, for the session) -> 'Regular block · after hours', 'Average-price trade · pre-market', ...
export function printType(c, t, big) {
  const out = [];
  for (const k of String(c || '')) { const s = COND[k]; if (s && !out.includes(s)) out.push(s); }
  if (out.includes('Late report')) out[out.indexOf('Late report')] = 'Late report (original trade time not given)';
  if (!out.length || (out.length === 1 && out[0] === 'Intermarket sweep')) out.unshift(big ? 'Regular block' : 'Regular trade');
  const m = isNum(t) ? nyMin(t) : 600;
  if (m < 570) out.push('pre-market'); else if (m >= 960) out.push('after hours');
  return out.join(' · ');
}
// conditions whose price is not the market price of that moment: they never make a level
const OFF = /[4BW7VPZUC]/;
export const offMarket = (c) => OFF.test(String(c || ''));
const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const usdS = (v) => (v >= 1e9 ? '$' + (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B' : '$' + (v >= 1e7 ? Math.round(v / 1e6) : (v / 1e6).toFixed(1).replace(/\.0$/, '')) + 'M');
const fx2 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// part -> per-row context aligned with part.rows: { day, rank, nDay, pct, typ, lvl:{n,v} | null, vw }. Cached per part object.
const cache = new WeakMap();
export function contextOf(part) {
  if (!part || typeof part !== 'object') return [];
  if (cache.has(part)) return cache.get(part);
  const rows = Array.isArray(part.rows) ? part.rows : [];
  const ok = (r) => Array.isArray(r) && isNum(r[0]) && isNum(r[1]) && isNum(r[2]);
  const vals = [], days = new Map(), lv = new Map();
  rows.forEach((r, i) => {
    if (!ok(r)) return;
    const v = r[1] * r[2], d = dayKey(r[0]);
    vals.push(v);
    (days.get(d) || days.set(d, []).get(d)).push(i);
    if (!offMarket(r[3])) { const k = d + '|' + r[1].toFixed(2), e = lv.get(k) || { n: 0, v: 0 }; e.n++; e.v += v; lv.set(k, e); }
  });
  vals.sort((a, b) => a - b);
  const med = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : 0;
  const dv = part.dv && typeof part.dv === 'object' ? part.dv : {};
  const out = new Array(rows.length).fill(null);
  for (const [d, idx] of days) {
    idx.sort((a, b) => rows[b][1] * rows[b][2] - rows[a][1] * rows[a][2]);
    const e = Array.isArray(dv[d]) ? dv[d] : null, vol = e && isNum(e[0]) && e[0] > 0 ? e[0] : 0, vw = e && isNum(e[1]) && e[1] > 0 ? e[1] : 0;
    idx.forEach((i, k) => {
      const r = rows[i], l = offMarket(r[3]) ? null : lv.get(d + '|' + r[1].toFixed(2));
      out[i] = { day: d, rank: k + 1, nDay: idx.length, pct: vol ? r[2] / vol * 100 : null, typ: med ? r[1] * r[2] / med : null, lvl: l && l.n > 1 ? l : null, vw: vw || null };
    });
  }
  cache.set(part, out);
  return out;
}
// one print (from chart-darkpool.js prints(): { t, p, s, v, c, d, k, fut?, ep? }) -> the detail rows of the card
export function detailRows(x) {
  const k = x.k, rows = [];
  if (!k) return rows;
  const ep = x.fut ? x.ep : x.p;
  if (isNum(k.pct)) rows.push(['Day volume', (k.pct < 0.1 ? '<0.1' : k.pct.toFixed(k.pct < 10 ? 1 : 0)) + '% of shares']);
  if (isNum(k.typ)) rows.push(['Size', (k.typ < 10 ? k.typ.toFixed(1) : Math.round(k.typ)) + '× typical print']);
  rows.push(['Rank', k.rank === 1 ? 'Biggest of the day' : ord(k.rank) + ' biggest of ' + k.nDay]);
  if (k.lvl) rows.push(['Level', k.lvl.n + ' prints at ' + fx2(ep) + ' · ' + usdS(k.lvl.v)]);
  if (k.vw && isNum(ep)) { const d = (ep / k.vw - 1) * 100; rows.push(['Day VWAP', Math.abs(d) < 0.005 ? 'at VWAP' : Math.abs(d).toFixed(2) + '% ' + (d > 0 ? 'above' : 'below')]); }
  return rows;
}
// repeated prints at one price on one day adding up to >= minUsd (market-price prints only): [{ day, p, n, v, t0, t1 }], biggest first.
// list: prints (time order) with p = the drawn price (futures: mapped) and ep = the ETF price when mapped.
export function levels(list, minUsd) {
  const m = new Map();
  for (const x of list || []) {
    if (offMarket(x.c)) continue;
    const day = dayKey(x.t), key = day + '|' + (x.fut ? x.ep : x.p).toFixed(2);
    const e = m.get(key) || { day, p: 0, n: 0, v: 0, t0: x.t, t1: x.t };
    e.n++; e.v += x.v; e.p += x.p; e.t1 = x.t; m.set(key, e);
  }
  const out = [];
  for (const e of m.values()) if (e.n > 1 && e.v >= (minUsd || 0)) out.push(Object.assign(e, { p: Math.round(e.p / e.n * 100) / 100 }));
  return out.sort((a, b) => b.v - a.v);
}
