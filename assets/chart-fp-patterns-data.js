// TradeZoro — Charts: FOOTPRINT PATTERNS maths (pure, no DOM). Owner order 2026-11-10.
// Reuses the footprint's own per-bar, per-price bid/ask volume (assets/chart-footprint-data.js: rows, imbalances, stacked,
// unfinished) and the swing pivots from chart-of-pro-data.js. No second aggregator: callers pass the order-flow bars the
// footprint already uses: { t, lo, hi, o, c (tick idx), buy[], sell[] (index 0 = lo), vol, delta }.
// buy = aggressor lifted the ask, sell = aggressor hit the bid.
//
// Six patterns (descriptions only, never a trade instruction):
//   abs   Absorption        heavy aggressive volume at the bar's extreme, price did not progress and closed back off it
//   exh   Exhaustion        aggressive volume shrinks row by row toward the bar's extreme
//   stk   Stacked imbalances N+ diagonal imbalances in a row on one side (zone until price trades through it)
//   unf   Unfinished auction  bid AND ask both traded at the bar's high / low (line until price revisits it)
//   div   Delta divergence  a new swing high with less bar delta than the previous swing high (or the mirror at lows)
//   trap  Trapped traders   heavy aggressive buying at the high (or selling at the low), then a close beyond the whole zone
// dir: +1 = green (buyers in control of the read: sellers absorbed / sellers exhausted / buy imbalance / low unfinished / bullish
// divergence / sellers trapped), -1 = red (the opposite).
// Education only. Not financial advice.
import { rows, imbalances, stacked, unfinished } from './chart-footprint-data.js?v=962';
import { swingPivots } from './chart-of-pro-data.js?v=962';

export const DEFAULTS = {
  rowTicks: 1,
  absMult: 2, absRows: 2,
  exhRows: 4, exhPct: 25,
  ratio: 300, stack: 3,
  divLen: 3, divDrop: 25, divGap: 60,
  trapMult: 1.5, trapRows: 3, trapBars: 5,
  maxBars: 300
};
export const KINDS = ['abs', 'exh', 'stk', 'unf', 'div', 'trap'];
export const NUM = { abs: 1, exh: 2, stk: 3, unf: 4, div: 5, trap: 6 };

const opt = (o) => Object.assign({}, DEFAULTS, o || {});
const sum = (a) => a.reduce((x, y) => x + y, 0);

// The patterns that need one bar only. Returns { abs, exh, stk, unf, trapC } (each null when absent).
// Prices are tick indexes (multiply by the tick for a price). rowTicks groups ticks into rows like the footprint's Rows setting.
export function barPatterns(bar, o) {
  o = opt(o);
  const m = Math.max(1, Math.round(o.rowTicks)), rs = rows(bar, m), n = rs.length;
  const out = { abs: null, exh: null, stk: null, unf: null, trapC: [] };
  if (n < 2) return out;
  const tot = sum(rs.map((r) => r.buy + r.sell)), avg = tot / n;
  if (!(avg > 0)) return out;
  const R = Math.min(Math.max(1, Math.round(o.absRows)), n - 1);

  // 1 Absorption: the extreme rows' own-side volume vs the bar's average row, and the close left the zone
  const cands = [];
  { // low: sellers hit the bid at the low
    const z = rs.slice(0, R), s = sum(z.map((r) => r.sell)), b = sum(z.map((r) => r.buy));
    if (s / R >= o.absMult * avg && s > b && bar.c >= rs[R].p) cands.push({ dir: 1, at: 'lo', p: bar.lo, x: s / R / avg, vol: s });
  }
  { // high: buyers lifted the ask at the high
    const z = rs.slice(n - R), b = sum(z.map((r) => r.buy)), s = sum(z.map((r) => r.sell));
    if (b / R >= o.absMult * avg && b > s && bar.c < rs[n - R].p) cands.push({ dir: -1, at: 'hi', p: bar.hi, x: b / R / avg, vol: b });
  }
  if (cands.length) out.abs = cands.sort((a, c) => c.x - a.x)[0];

  // 2 Exhaustion: the aggressive side shrinks toward the extreme; the last row is <= exhPct % of the row (exhRows-1) in
  const E = Math.max(3, Math.round(o.exhRows)), ex = [];
  if (n >= E) {
    const chk = (vals, dir, at, p) => {   // vals: aggressive volume from the extreme row inwards
      const ref = vals[E - 1];
      for (let t = 0; t < E - 1; t++) if (vals[t] > vals[t + 1]) return;
      if (ref < 0.5 * avg || vals[0] > ref * o.exhPct / 100) return;
      ex.push({ dir, at, p, pct: vals[0] / ref * 100, ref });
    };
    chk(rs.slice(n - E).map((r) => r.buy).reverse(), -1, 'hi', bar.hi);   // buying fades into the high
    chk(rs.slice(0, E).map((r) => r.sell), 1, 'lo', bar.lo);              // selling fades into the low
  }
  if (ex.length) out.exh = ex.sort((a, c) => a.pct - c.pct)[0];

  // 3 Stacked imbalances (the footprint's own diagonal rule), the longest run wins
  const runs = stacked(imbalances(rs, o.ratio / 100), Math.max(2, Math.round(o.stack)));
  if (runs.length) {
    const r = runs.sort((a, c) => (c.k1 - c.k0) - (a.k1 - a.k0))[0];
    out.stk = { dir: r.side ? 1 : -1, lo: rs[r.k0].p, hi: rs[r.k1].p + m, n: r.k1 - r.k0 + 1 };
  }

  // 4 Unfinished auction (the footprint's own rule); both ends -> the one with more total volume
  const u = unfinished(rs);
  if (u.high || u.low) {
    const hi = u.high && (!u.low || rs[n - 1].buy + rs[n - 1].sell >= rs[0].buy + rs[0].sell);
    out.unf = hi ? { dir: -1, at: 'hi', p: bar.hi } : { dir: 1, at: 'lo', p: bar.lo };
  }

  // 6 (first half) trapped-trader candidates: heavy aggression in the top / bottom rows
  const T = Math.min(Math.max(1, Math.round(o.trapRows)), n - 1);
  { const z = rs.slice(n - T), b = sum(z.map((r) => r.buy)), s = sum(z.map((r) => r.sell));
    if (b / T >= o.trapMult * avg && b > s) out.trapC.push({ dir: -1, lo: rs[n - T].p, hi: rs[n - 1].p + m, x: b / T / avg }); }   // buyers at the high
  { const z = rs.slice(0, T), s = sum(z.map((r) => r.sell)), b = sum(z.map((r) => r.buy));
    if (s / T >= o.trapMult * avg && s > b) out.trapC.push({ dir: 1, lo: rs[0].p, hi: rs[T - 1].p + m, x: s / T / avg }); }       // sellers at the low
  return out;
}

// All patterns over a list of bars (oldest first). `cache` (a Map, optional) keeps the per-bar results of FINISHED bars
// between calls; only the forming (last) bar and bars whose data changed are recomputed. `forming` = index of the forming bar or -1.
// Returns events sorted by bar index: { kind, i, t, dir, ... } at most one per kind per bar.
export function analyze(list, o, cache, forming = -1) {
  o = opt(o);
  const start = Math.max(0, list.length - Math.max(10, Math.round(o.maxBars)));
  const sigO = JSON.stringify(o);
  const per = [];
  for (let i = start; i < list.length; i++) {
    const b = list[i], sig = b.t + '|' + b.vol + '|' + b.lo + '|' + b.hi + '|' + b.c + '|' + b.buy.length + '|' + sigO;
    let c = cache && i !== forming ? cache.get(b.t) : null;
    if (!c || c.sig !== sig) { c = { sig, p: barPatterns(b, o) }; if (cache && i !== forming) cache.set(b.t, c); }
    per[i] = c.p;
  }
  const ev = [];
  const push = (e) => ev.push(Object.assign(e, { t: list[e.i].t, forming: e.i === forming }));
  for (let i = start; i < list.length; i++) {
    const p = per[i], b = list[i];
    if (p.abs) push({ kind: 'abs', i, dir: p.abs.dir, p: p.abs.p, x: p.abs.x, vol: p.abs.vol, at: p.abs.at });
    if (p.exh) push({ kind: 'exh', i, dir: p.exh.dir, p: p.exh.p, pct: p.exh.pct, at: p.exh.at });
    if (p.stk) {   // runs right until a later bar trades through the whole zone
      let end = -1;
      for (let j = i + 1; j < list.length; j++) if (p.stk.dir > 0 ? list[j].lo < p.stk.lo : list[j].hi >= p.stk.hi) { end = j; break; }
      push({ kind: 'stk', i, dir: p.stk.dir, lo: p.stk.lo, hi: p.stk.hi, n: p.stk.n, end });
    }
    if (p.unf) {   // runs right until a later bar revisits the price
      let end = -1;
      for (let j = i + 1; j < list.length; j++) if (p.unf.at === 'hi' ? list[j].hi >= p.unf.p : list[j].lo <= p.unf.p) { end = j; break; }
      push({ kind: 'unf', i, dir: p.unf.dir, p: p.unf.p, at: p.unf.at, end });
    }
    // 6 trapped: the first later bar within trapBars that closes beyond the whole zone
    let best = null;
    for (const t of p.trapC) {
      for (let j = i + 1; j < list.length && j <= i + Math.round(o.trapBars); j++) {
        const hit = t.dir < 0 ? list[j].c < t.lo : list[j].c >= t.hi;
        if (hit) { if (!best || j < best.j || (j === best.j && t.x > best.x)) best = { j, dir: t.dir, lo: t.lo, hi: t.hi, x: t.x }; break; }
      }
    }
    if (best) push({ kind: 'trap', i, dir: best.dir, lo: best.lo, hi: best.hi, x: best.x, j: best.j });
    void b;
  }
  // 5 delta divergence on swing pivots of the bars' own highs / lows
  const seg = list.slice(start), L = Math.max(1, Math.round(o.divLen));
  const pv = swingPivots(seg.map((b) => b.hi), seg.map((b) => b.lo), L);
  const prev = { hi: null, lo: null };
  for (const q of pv) {
    const a = prev[q.kind];
    prev[q.kind] = q;
    if (!a || q.i - a.i > o.divGap) continue;
    const da = seg[a.i].delta, db = seg[q.i].delta;
    const hi = q.kind === 'hi';
    if (hi ? (q.p > a.p && da > 0 && db <= da * (1 - o.divDrop / 100)) : (q.p < a.p && da < 0 && db >= da * (1 - o.divDrop / 100))) {
      push({ kind: 'div', i: start + q.i, dir: hi ? -1 : 1, from: start + a.i, p: hi ? seg[q.i].hi : seg[q.i].lo, pa: hi ? seg[a.i].hi : seg[a.i].lo, da, db, at: hi ? 'hi' : 'lo' });
    }
  }
  return ev.sort((a, c) => a.i - c.i);
}

// One plain line per pattern (what it is; never an instruction).
export const TIPS = {
  abs: 'Absorption: heavy aggressive volume hit the bar\'s extreme but price did not progress and closed back off it. A passive side took the other side of that flow.',
  exh: 'Exhaustion: aggressive volume shrank row by row toward the bar\'s extreme and was tiny at the last row. Nobody was pushing price any further.',
  stk: 'Stacked imbalances: several diagonal imbalances in a row on one side. The zone stays marked until price trades through it.',
  unf: 'Unfinished auction: both bid and ask traded at the bar\'s extreme, so the auction did not end there. The line stays until price returns to it.',
  div: 'Delta divergence: a new swing extreme with less bar delta than the previous swing extreme. Price moved further with less aggressive volume behind it.',
  trap: 'Trapped traders: heavy aggressive volume at the extreme, then a later bar closed beyond the whole zone, leaving those traders on the wrong side.'
};
export const NAMES = {
  abs: ['Absorption', 'Abs'], exh: ['Exhaustion', 'Exh'], stk: ['Stacked imbalances', 'Stk'], unf: ['Unfinished auction', 'Unf'],
  div: ['Delta divergence', 'Div'], trap: ['Trapped traders', 'Trap']
};
// Title of one event for the tooltip / label, e.g. "Trapped buyers", "Stacked sell imbalance".
export function titleOf(e) {
  const up = e.dir > 0;
  switch (e.kind) {
    case 'abs': return 'Absorption ' + (up ? '(sellers absorbed)' : '(buyers absorbed)');
    case 'exh': return 'Exhaustion ' + (up ? '(selling fading)' : '(buying fading)');
    case 'stk': return up ? 'Stacked buy imbalance' : 'Stacked sell imbalance';
    case 'unf': return 'Unfinished auction ' + (e.at === 'hi' ? '(high)' : '(low)');
    case 'div': return (up ? 'Bullish' : 'Bearish') + ' delta divergence';
    default: return up ? 'Trapped sellers' : 'Trapped buyers';
  }
}
