// TradeZoro — Hyperliquid ladders: the maths (pure, no DOM). Used by chart-hl-ladders.js; tested by tools/tests/hl-ladders.test.mjs.
// Input: the normalised /hl-clusters answer of chart-wallet-intel.js (normClusters): bands of one server step (~0.25 % of price),
// liquidation clusters (kind 'liq') and trigger-order clusters (kind 'stop'). Output: rows regrouped to a bucket size for three
// ladders: liq (liquidation prices), sl (resting stop losses), tp (resting take profits). Tracked wallets only; nothing invented.
// Honest limit: the server groups by band, so a row can never be finer than the server step (BTC: 200).

export const LADDERS = [['liq', 'Liquidations'], ['sl', 'Stop losses'], ['tp', 'Take profits']];
export const MULTS = [1, 2, 5, 10, 20, 50, 100, 200, 500];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Server clusters -> one flat list at server resolution, each tagged with its ladder.
// A trigger order is a stop loss or a take profit: the server names it per wallet (kind). The wallets listed per band are the 20
// biggest, so any rest of the band (total minus listed) is placed by where the trigger sits against the price:
// a sell trigger below the price (or a buy trigger above it) protects a position = stop loss; the other way = take profit.
export function splitLevels(cl) {
  if (!cl) return [];
  const out = [], mid = cl.mid;
  for (const c of cl.liq || []) out.push({ ladder: 'liq', lo: c.lo, ntl: c.ntl, n: c.n, side: c.side, wallets: c.wallets });
  for (const c of cl.stops || []) {
    const geo = (c.side < 0 ? c.hi <= mid : c.lo >= mid) ? 'sl' : 'tp';
    const by = { sl: [], tp: [], x: [] };
    for (const w of c.wallets) (w.kind === 'Stop loss' ? by.sl : w.kind === 'Take profit' ? by.tp : by.x).push(w);
    const sum = (a) => a.reduce((s, w) => s + (isNum(w.ntl) ? w.ntl : 0), 0);
    const known = sum(by.sl) + sum(by.tp), restNtl = Math.max(0, c.ntl - known);
    const restN = Math.max(0, (c.n || 0) - by.sl.length - by.tp.length);
    const part = { sl: { ntl: sum(by.sl), n: by.sl.length, w: by.sl }, tp: { ntl: sum(by.tp), n: by.tp.length, w: by.tp } };
    part[geo].ntl += restNtl; part[geo].n += restN; part[geo].w = part[geo].w.concat(by.x);
    for (const k of ['sl', 'tp']) if (part[k].ntl > 0) out.push({ ladder: k, lo: c.lo, ntl: part[k].ntl, n: part[k].n, side: c.side, wallets: part[k].w });
  }
  return out;
}

// Regroup server bands into rows of `size` (a multiple of the server step). A band goes to the row that holds its start price.
export function rebucket(levels, ladder, size) {
  const rows = new Map();
  for (const l of levels) {
    if (l.ladder !== ladder || !(l.ntl > 0)) continue;
    const i = Math.floor(l.lo / size + 1e-9);
    let r = rows.get(i);
    if (!r) rows.set(i, r = { ladder, lo: +(i * size).toFixed(10), hi: +((i + 1) * size).toFixed(10), ntl: 0, n: 0, long: 0, short: 0, wallets: [] });
    r.ntl += l.ntl; r.n += l.n || 0;
    if (ladder === 'liq') r[l.side > 0 ? 'long' : 'short'] += l.ntl;
    r.wallets = r.wallets.concat(l.wallets || []);
  }
  const out = [...rows.values()].sort((a, b) => b.lo - a.lo);   // high price first
  for (const r of out) r.wallets.sort((a, b) => (b.ntl || 0) - (a.ntl || 0));
  return out;
}

// Row size: a multiple of the server step. Auto = the smallest one that fits the visible price range into maxRows rows.
// manual = a multiplier from MULTS (or 'auto'). Never below the server step (the data has no finer detail).
export function pickSize(step, lo, hi, maxRows, manual) {
  if (!(step > 0)) return 0;
  if (isNum(manual) && MULTS.includes(manual)) return +(step * manual).toFixed(10);
  const range = Math.max(0, hi - lo);
  for (const m of MULTS) if (range / (step * m) <= Math.max(1, maxRows)) return +(step * m).toFixed(10);
  return +(step * MULTS[MULTS.length - 1]).toFixed(10);
}

// Column numbers: total over every row, the part inside [lo, hi], the biggest row, and the rows to highlight (top 3, each >= 10 % of the biggest).
export function columnStats(rows, lo, hi) {
  const total = rows.reduce((s, r) => s + r.ntl, 0);
  const view = rows.filter((r) => r.hi > lo && r.lo < hi);
  const inView = view.reduce((s, r) => s + r.ntl, 0);
  const max = view.reduce((m, r) => Math.max(m, r.ntl), 0);
  const big = new Set(view.slice().sort((a, b) => b.ntl - a.ntl).slice(0, 3).filter((r) => r.ntl >= max * 0.1).map((r) => r.lo));
  return { total, inView, max, view, big, pctView: total > 0 ? inView / total * 100 : 0 };
}
// bar length and colour strength 0..1 (square root: one huge row does not flatten the rest)
export const strength = (ntl, max) => (max > 0 && ntl > 0 ? Math.sqrt(Math.min(1, ntl / max)) : 0);
export const pctOf = (ntl, total) => (total > 0 ? ntl / total * 100 : 0);
export function fmtPct(p) { return !isNum(p) ? '—' : p >= 10 ? Math.round(p) + '%' : p >= 1 ? p.toFixed(1).replace(/\.0$/, '') + '%' : p > 0 ? '<1%' : '0%'; }

// The wallet-list cluster a row opens (same shape as chart-wallet-intel.js clusters)
export function rowCluster(r) {
  const side = r.ladder === 'liq' ? (r.long >= r.short ? 1 : -1) : (r.wallets[0] ? r.wallets[0].side : 1);
  return { kind: r.ladder === 'liq' ? 'liq' : 'stop', side, lo: r.lo, hi: r.hi, px: (r.lo + r.hi) / 2, ntl: r.ntl, n: r.n || r.wallets.length, wallets: r.wallets.slice(0, 50), cut: (r.n || 0) > r.wallets.length,
    title: r.ladder === 'liq' ? 'Liquidations' : r.ladder === 'sl' ? 'Stop losses' : 'Take profits' };
}
