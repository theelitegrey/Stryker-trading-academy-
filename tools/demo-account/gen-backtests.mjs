// Runs the app's OWN replay-engine Simulator bar by bar over real NQ/ES/MNQ 5-minute history and stores the engine's
// snapshot trades (data/backtests.json). The entry rules below are simple coded scans of each model; fills, stops, targets,
// commissions, MAE/MFE and R all come from the engine. Results are whatever the engine returns (not tuned).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBars, nyToEpoch, nyParts } from './lib/bars.mjs';
import { replayEngine } from './lib/appcode.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E = replayEngine();
const SPEC = {
  NQ: { symbolId: 'NQ=F', label: 'NQ · Nasdaq 100 futures', symbol: 'NQ=F', pointValue: 20, tick: 0.25, decimals: 2, lotStep: 1, commission: 2.2, slippage: 0 },
  MNQ: { symbolId: 'MNQ=F', label: 'MNQ · Micro Nasdaq futures', symbol: 'MNQ=F', pointValue: 2, tick: 0.25, decimals: 2, lotStep: 1, commission: 0.6, slippage: 0 },
  ES: { symbolId: 'ES=F', label: 'ES · S&P 500 futures', symbol: 'ES=F', pointValue: 50, tick: 0.25, decimals: 2, lotStep: 1, commission: 2.2, slippage: 0 }
};
const RR = JSON.parse(process.env.RR || '{}'); const rr = (k) => RR[k] ?? 1;   // reward:risk of each scan, fixed at 1 (not optimised)
const tr = (p, t) => Math.round(p / t) * t;
const FROM = '2026-08-20', TO = '2026-10-14';
const days = []; for (let t = Date.parse(FROM + 'T12:00:00Z'); t <= Date.parse(TO + 'T12:00:00Z'); t += 86400000) { const d = new Date(t); if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10)); }

async function loadDays(sym) {
  const out = [];
  for (const d of days) {
    const bars = await getBars(sym, '5', nyToEpoch(d, 4 * 60), nyToEpoch(d, 16 * 60 + 5));
    if (bars.length > 100) out.push({ d, bars: bars.map((b) => ({ t: b[0] * 1000, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] })) });
  }
  return out;
}
const minOf = (b) => nyParts(b.t / 1000).minutes;

// ---- strategies: return an order (or null) for day, given bars so far; they are run through the engine bar by bar -------------
// Each strategy gets (ctx) and may call sim.submit once per day.
function rollRange(bars, i, n = 36) { if (i < n) return null; const w = bars.slice(i - n, i); return { hi: Math.max(...w.map((b) => b.h)), lo: Math.min(...w.map((b) => b.l)) }; }
function preRange(bars) { const pre = bars.filter((b) => minOf(b) >= 4 * 60 && minOf(b) < 9 * 60 + 30); if (pre.length < 20) return null; return { hi: Math.max(...pre.map((b) => b.h)), lo: Math.min(...pre.map((b) => b.l)) }; }
const avgBody = (bars, i, n = 12) => { let s = 0, c = 0; for (let k = Math.max(0, i - n); k < i; k++) { s += Math.abs(bars[k].c - bars[k].o); c++; } return c ? s / c : 0; };

const STRATS = {
  orb(sim, st, bars, i, S) {
    const m = minOf(bars[i]); if (st.done || m < 9 * 60 + 35 || m > 11 * 60) return;
    if (!st.rng) { const f = bars.find((b) => minOf(b) === 9 * 60 + 30); if (f) st.rng = { hi: f.h, lo: f.l }; return; }
    const b = bars[i], w = st.rng.hi - st.rng.lo; if (w < 4) return;
    if (b.c > st.rng.hi) { st.done = 1; sim.submit({ side: 'buy', type: 'market', size: S, sl: tr((st.rng.hi + st.rng.lo) / 2, .25), tp: tr(b.c + rr('orb',1.5) * (b.c - (st.rng.hi + st.rng.lo) / 2), .25), tags: ['ORB'] }); }
    else if (b.c < st.rng.lo) { st.done = 1; sim.submit({ side: 'sell', type: 'market', size: S, sl: tr((st.rng.hi + st.rng.lo) / 2, .25), tp: tr(b.c - rr('orb',1.5) * ((st.rng.hi + st.rng.lo) / 2 - b.c), .25), tags: ['ORB'] }); }
  },
  sweep(sim, st, bars, i, S) {
    const m = minOf(bars[i]); if (st.done || m < 9 * 60 + 35 || m > 14 * 60 + 30) return;
    st.pre = rollRange(bars, i); if (!st.pre) return;
    const b = bars[i];
    if (b.h > st.pre.hi && b.c < st.pre.hi) { st.done = 1; const sl = tr(b.h + 0.5 * avgBody(bars, i, 20) * 3, .25), e = b.c; sim.submit({ side: 'sell', type: 'market', size: S, sl, tp: tr(e - rr('sweep',1.5) * (sl - e), .25), tags: ['Liquidity Sweep'] }); }
    else if (b.l < st.pre.lo && b.c > st.pre.lo) { st.done = 1; const sl = tr(b.l - 0.5 * avgBody(bars, i, 20) * 3, .25), e = b.c; sim.submit({ side: 'buy', type: 'market', size: S, sl, tp: tr(e + rr('sweep',1.5) * (e - sl), .25), tags: ['Liquidity Sweep'] }); }
  },
  fvg(sim, st, bars, i, S) {
    const m = minOf(bars[i]); if (st.done || m < 9 * 60 + 40 || m > 14 * 60 + 30 || i < 3) return;
    const a = bars[i - 2], c = bars[i];
    if (!st.pend) {
      if (a.h < c.l && c.l - a.h >= 4 && (bars[i - 1].c - bars[i - 1].o) > 1.3 * avgBody(bars, i - 1)) { st.pend = { side: 'buy', px: tr(c.l, .25), sl: tr(a.l, .25), at: i }; }
      else if (a.l > c.h && a.l - c.h >= 4 && (bars[i - 1].o - bars[i - 1].c) > 1.3 * avgBody(bars, i - 1)) { st.pend = { side: 'sell', px: tr(c.h, .25), sl: tr(a.h, .25), at: i }; }
      if (st.pend) { const p = st.pend, risk = Math.abs(p.px - p.sl); if (risk < 6 || risk > 45) { st.pend = null; return; } if (bars[i].c !== p.px) { try { sim.submit({ side: p.side, type: 'limit', price: p.px, size: S, sl: p.sl, tp: tr(p.px + (p.side === 'buy' ? rr('fvg',1.5) : -rr('fvg',1.5)) * risk, .25), tags: ['FVG'] }); st.done = 1; } catch (e) { st.pend = null; } } }
    }
  },
  ifvg(sim, st, bars, i, S) {
    const m = minOf(bars[i]); if (st.done || m < 9 * 60 + 40 || m > 14 * 60 + 30 || i < 6) return;
    st.gaps = st.gaps || [];
    const a = bars[i - 2], c = bars[i];
    if (a.h < c.l && c.l - a.h >= 4) st.gaps.push({ kind: 'bull', lo: a.h, hi: c.l, i });
    if (a.l > c.h && a.l - c.h >= 4) st.gaps.push({ kind: 'bear', lo: c.h, hi: a.l, i });
    for (const g of st.gaps) {
      if (g.used || i <= g.i + 1) continue;
      if (g.kind === 'bull' && c.c < g.lo) { g.used = 1; st.done = 1; const sl = tr(g.hi + 1, .25), risk = sl - c.c; if (risk > 3 && risk < 50) sim.submit({ side: 'sell', type: 'market', size: S, sl, tp: tr(c.c - rr('ifvg',2) * risk, .25), tags: ['IFVG'] }); }
      else if (g.kind === 'bear' && c.c > g.hi) { g.used = 1; st.done = 1; const sl = tr(g.lo - 1, .25), risk = c.c - sl; if (risk > 3 && risk < 50) sim.submit({ side: 'buy', type: 'market', size: S, sl, tp: tr(c.c + rr('ifvg',2) * risk, .25), tags: ['IFVG'] }); }
      if (st.done) break;
    }
  },
  mss(sim, st, bars, i, S) {
    const m = minOf(bars[i]); if (st.done || m < 9 * 60 + 40 || m > 14 * 60 + 30 || i < 8) return;
    st.pre = rollRange(bars, i); if (!st.pre) return;
    const b = bars[i];
    if (b.l < st.pre.lo && !st.swLow) st.swLow = { px: b.l, hi: b.h };
    if (b.h > st.pre.hi && !st.swHigh) st.swHigh = { px: b.h, lo: b.l };
    if (st.swLow) { st.swLow.px = Math.min(st.swLow.px, b.l); st.swLow.hi = Math.max(st.swLow.hi, bars[i - 1].h); if (b.c > st.swLow.hi && bars[i - 1].h <= st.swLow.hi) { st.done = 1; const sl = tr(st.swLow.px - 1, .25), r = b.c - sl; if (r > 4 && r < 80) sim.submit({ side: 'buy', type: 'market', size: S, sl, tp: tr(b.c + rr('mss',1.5) * r, .25), tags: ['MSS'] }); } }
    else if (st.swHigh) { st.swHigh.px = Math.max(st.swHigh.px, b.h); st.swHigh.lo = Math.min(st.swHigh.lo, bars[i - 1].l); if (b.c < st.swHigh.lo && bars[i - 1].l >= st.swHigh.lo) { st.done = 1; const sl = tr(st.swHigh.px + 1, .25), r = sl - b.c; if (r > 4 && r < 80) sim.submit({ side: 'sell', type: 'market', size: S, sl, tp: tr(b.c - rr('mss',1.5) * r, .25), tags: ['MSS'] }); } }
  },
  ict2022(sim, st, bars, i, S) {
    const m = minOf(bars[i]); if (st.done || m < 9 * 60 + 40 || m > 14 * 60 + 30 || i < 8) return;
    st.pre = rollRange(bars, i); if (!st.pre) return;
    const b = bars[i];
    if (!st.sw) { if (b.l < st.pre.lo) st.sw = { side: 'buy', ext: b.l, i }; else if (b.h > st.pre.hi) st.sw = { side: 'sell', ext: b.h, i }; return; }
    if (st.sw.side === 'buy') st.sw.ext = Math.min(st.sw.ext, b.l); else st.sw.ext = Math.max(st.sw.ext, b.h);
    if (i - st.sw.i > 30 || st.pendingDone) return;
    const a = bars[i - 2], disp = (bars[i - 1].c - bars[i - 1].o) * (st.sw.side === 'buy' ? 1 : -1) > 1.0 * avgBody(bars, i - 1);
    if (disp && st.sw.side === 'buy' && a.h < b.l && b.l - a.h >= 2) { const px = tr(b.l, .25), sl = tr(st.sw.ext - 1, .25), r = px - sl; st.pendingDone = 1; if (r > 5 && r < 60 && b.c > px) { try { sim.submit({ side: 'buy', type: 'limit', price: px, size: S, sl, tp: tr(px + rr('ict',2) * r, .25), tags: ['ICT 2022'] }); st.done = 1; } catch (e) {} } }
    if (disp && st.sw.side === 'sell' && a.l > b.h && a.l - b.h >= 2) { const px = tr(b.h, .25), sl = tr(st.sw.ext + 1, .25), r = sl - px; st.pendingDone = 1; if (r > 5 && r < 60 && b.c < px) { try { sim.submit({ side: 'sell', type: 'limit', price: px, size: S, sl, tp: tr(px - rr('ict',2) * r, .25), tags: ['ICT 2022'] }); st.done = 1; } catch (e) {} } }
  }
};

const PROJECTS = [
  { name: 'ICT 2022 Model · NQ 5m', sym: 'NQ', strat: 'ict2022', size: 1, created: '2026-10-09T15:12:00Z' },
  { name: 'Liquidity Sweeps · NQ 5m', sym: 'NQ', strat: 'sweep', size: 1, created: '2026-10-06T14:40:00Z' },
  { name: 'IFVG · NQ 5m', sym: 'NQ', strat: 'ifvg', size: 1, created: '2026-10-02T19:05:00Z' },
  { name: 'FVG Continuation · ES 5m', sym: 'ES', strat: 'fvg', size: 1, created: '2026-09-28T16:20:00Z' },
  { name: 'Opening Range Breakout · NQ 5m', sym: 'NQ', strat: 'orb', size: 1, created: '2026-09-24T13:55:00Z' },
  { name: 'MSS after Sweep · MNQ 5m', sym: 'MNQ', strat: 'mss', size: 4, created: '2026-09-19T18:30:00Z' }
];

const cache = {};
const out = [];
for (const P of PROJECTS) {
  const bsym = P.sym; cache[bsym] = cache[bsym] || await loadDays(bsym);
  const spec = SPEC[P.sym];
  const sim = new E.Simulator(spec, { balance: 100000 });
  let total = 0, idx = 0;
  for (const day of cache[bsym]) {
    const st = {}; const bars = day.bars;
    for (let i = 0; i < bars.length; i++) {
      sim.onBar(bars[i], idx++);
      if (!sim.positions.length && !sim.pending.length) STRATS[P.strat](sim, st, bars, i, P.size);
      // flat by 15:55 NY
      if (minOf(bars[i]) >= 15 * 60 + 55) { sim.pending.splice(0); sim.closeAll(); }
    }
    total += bars.length;
  }
  sim.pending.splice(0); sim.closeAll();
  const s = E.stats(sim.trades, sim.equity, sim.startBalance);
  console.log(P.name.padEnd(36), 'trades', s.count, 'win%', s.winRate, 'PF', s.profitFactor, 'net', s.net, 'maxDD', s.maxDD);
  const startMs = cache[bsym][0].bars[0].t, endMs = cache[bsym].at(-1).bars.at(-1).t;
  const id = 'rs_' + P.strat + '_' + P.sym.toLowerCase();
  out.push({ id, name: P.name, symbolId: spec.symbolId, symbolLabel: spec.label, startMs, endMs, cursor: idx - 1, total: idx, tf: '5m',
    summary: { net: s.net, count: s.count, winRate: s.winRate, pf: s.profitFactor === Infinity ? null : s.profitFactor, maxDD: s.maxDD, avgR: s.avgR },
    balance: sim.balance, startBalance: sim.startBalance, trades: sim.trades, updatedAt: Date.parse(P.created) });
}
fs.mkdirSync(path.join(HERE, 'data'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'data/backtests.json'), JSON.stringify(out));
