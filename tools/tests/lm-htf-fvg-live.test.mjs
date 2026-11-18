// Liquidity Master [TradeZoro] higher-timeframe FVGs on a LIVE chart (member Yuvan, thread 1572645626087473242, 18 Nov):
// HTF gaps appeared 5-10 min late and a real 15m gap never showed. A 5m chart streams tick by tick; checks: every 15m gap
// (computed here independently from the sample bars) is on the chart by the first tick after the bar that closes its third
// 15m candle unless a higher gap fully covers it, and the live chart ends up with the same gaps as a fresh run.
// Needs a local pinets 0.11.0:  PINETS=/path/to/node_modules/pinets node tools/tests/lm-htf-fvg-live.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const PINETS = process.env.PINETS;
if (!PINETS) { console.log('SKIP: set PINETS=<path to node_modules/pinets>'); process.exit(0); }
const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(here, '..', '..', 'assets', 'chart-pine-next-patches.js')).href);
// Sample data: a seeded random walk of 5m bars with sharp legs, so 15m / 1h gaps form (no real prices).
function mk(seed, N, t0){ let x = seed, p = 20000; const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const bars = []; let dir = 1, leg = 0;
  for (let i = 0; i < N; i++) { if (leg-- <= 0) { dir = rnd() < .5 ? 1 : -1; leg = 4 + Math.floor(rnd() * 14); } const o = p; p += dir * (2 + rnd() * 9) + (rnd() - .5) * 3; const c = Math.round(p * 4) / 4;
    bars.push({ openTime: t0 + i * 3e5, closeTime: t0 + (i + 1) * 3e5, open: o, high: Math.max(o, c) + rnd() * 2, low: Math.min(o, c) - rnd() * 2, close: c, volume: 100 }); }
  return bars; }
let src = fs.readFileSync(process.env.PINE_SRC || path.join(here, '..', '..', 'assets', 'pine', 'liquidity-master-tradezoro.pine'), 'utf8').replace(/\r/g, '');
// the member's settings: FVG Chart + 5m + 15m + 1h + 4h, highest timeframe wins, unlimited, last 5 days; other drawings off (faster, same FVG logic)
const set = (from, to) => { if (!src.includes(from)) throw new Error('setting not found: ' + from); src = src.replace(from, to); };
set('f5  = input.bool(false', 'f5  = input.bool(true'); set('f4h = input.bool(false', 'f4h = input.bool(true');
set('fvgAge   = input.string("Today + yesterday"', 'fvgAge   = input.string("Last N days"');
src = patches.rewriteSource(src);
const T0 = Date.UTC(2026, 10, 16, 23, 0);                 // Mon 18:00 New York
const TOT = Number(process.env.TOT || 900), START = Number(process.env.START || 700);
const all = mk(Number(process.env.SEED || 7), TOT, T0);
let clock = 0; const realNow = Date.now; Date.now = () => clock;
let n = START, partial = false;
function view(){ const cur = all.slice(0, n).map((b) => ({ ...b })); if (partial) { const l = cur[cur.length - 1]; l.close = (l.open + l.close) / 2; l.high = Math.max(l.open, l.close); l.low = Math.min(l.open, l.close); } return cur; }
let lastKey = '', served = 0, drawn = -1;             // served: feed updates handed to the engine; drawn: the last one it has drawn
const provider = { getMarketData: async (s, tf, limit, sDate) => {
    if (tf !== '5') return [];
    const cur = view(); const h = sDate == null ? cur : cur.filter((b) => b.openTime >= sDate); const d = h[h.length - 1];
    const k = h.length + '|' + (d && d.openTime) + '|' + (d && d.close) + '|' + (d && d.high); if (sDate != null && k === lastKey) return []; lastKey = k; served++; return h; },
  getSymbolInfo: async () => ({ ticker: 'NQ', tickerid: 'NQ', mintick: .25, pointvalue: 20, timezone: 'America/New_York', session: '1800-1700', type: 'futures', currency: 'USD', pricescale: 4, minmove: 1 }) };
const gapKey = (b) => [b.left, b.top, b.bottom].join(',');
const gapsOf = (ctx) => { const L = (ctx.plots.__labels__ ? ctx.plots.__labels__.data[0].value : []).filter((l) => !l._deleted && / FVG$/.test(l.text || ''));
  const B = (ctx.plots.__boxes__ ? ctx.plots.__boxes__.data[0].value : []).filter((b) => !b._deleted);
  return { boxes: new Map(B.map((b) => [gapKey(b), b])), labels: L.map((l) => l.text) }; };
clock = all[START - 1].closeTime + 1;
const p = new pt.PineTS(provider, 'NQ', '5', START);
await p.ready();
const ev = p.stream(src, { live: true, interval: 25, pageSize: START });
let last = null; ev.on('data', (ctx) => { last = ctx; drawn = served; }); ev.on('error', (e) => console.log('ERR', e && e.message || e));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 400 && !last; i++) await sleep(50);
const firstSeen = new Map();                                  // gap box key -> virtual clock time it was first seen live
const snaps = [];                                             // [clock, live gap boxes] after every tick
const note = () => { if (!last) return; const bx = gapsOf(last).boxes; snaps.push([clock, [...bx.values()].map((b) => ({ left: b.left, top: b.top, bottom: b.bottom }))]); for (const k of bx.keys()) if (!firstSeen.has(k)) firstSeen.set(k, clock); };
note();
// one feed update: wait (real time) until the engine has drawn it, then note what is on the chart at that virtual time.
// pinets paces tick-only updates at ~1 s, so a fixed short sleep would read stale drawings.
let stale = 0;
async function step(t, part){ partial = part; clock = t; const want = served + 1; for (let w = 0; w < 1000 && drawn < want; w++) await sleep(10); if (drawn < want) stale++; note(); }
for (let i = START; i < TOT; i++) {
  n = i + 1; await step(all[i].openTime + 60000, true);      // first tick of the forming bar
  await step(all[i].openTime + 180000, false);               // a later tick (final prices)
}
clock = all[TOT - 1].closeTime + 1;
await sleep(1500); ev.stop();
const live = gapsOf(last);
clock = all[TOT - 1].closeTime + 1;
const ref = await new pt.PineTS(all.slice(0, TOT), 'NQ', '5').run(src);
const fresh = gapsOf(ref);
// Independent check: 15m candles built here from the 5m sample bars, and their FVGs (three-candle rule).
const c15 = []; for (const b of all) { const t = Math.floor(b.openTime / 9e5) * 9e5, c = c15[c15.length - 1];
  if (!c || c.t !== t) c15.push({ t, h: b.high, l: b.low, end: b.closeTime }); else { c.h = Math.max(c.h, b.high); c.l = Math.min(c.l, b.low); c.end = b.closeTime; } }
const g15 = [];
for (let i = 2; i < c15.length; i++) { const a = c15[i - 2], z = c15[i];
  if (z.l > a.h) g15.push({ left: c15[i - 1].t, top: z.l, bottom: a.h, due: z.end });
  if (z.h < a.l) g15.push({ left: c15[i - 1].t, top: a.l, bottom: z.h, due: z.end }); }
const near = (x, y) => Math.abs(x - y) < 1e-6;
const allBoxes = [...fresh.boxes.values()];
let missing = [], extra = [], hidden = [];
for (const b of allBoxes) if (!live.boxes.has(gapKey(b))) missing.push(gapKey(b));
for (const k of live.boxes.keys()) if (!fresh.boxes.has(k)) extra.push(k);
const watched = g15.filter((g) => g.due > all[START].openTime && g.due < all[TOT - 1].openTime);
const has = (boxes, g) => boxes.some((b) => b.left === g.left && near(b.top, g.top) && near(b.bottom, g.bottom));
for (const g of watched) {
  // the first live snapshot after the chart bar that closes the third 15m candle: the first tick of the next chart bar
  // (the engine settles a closed bar once the next one starts). No later bar can have mitigated it yet.
  const s = snaps.find((x) => x[0] > g.due); if (!s) continue;
  const at = new Date(g.left).toISOString().slice(5, 16);
  if (has(s[1], g)) continue;
  // "highest timeframe wins": hidden only when a higher gap (it starts earlier) on the chart fully covers it
  if (s[1].some((b) => b.left < g.left && b.top >= g.top - 1e-9 && b.bottom <= g.bottom + 1e-9)) continue;
  hidden.push(at);
}
const shown = watched.length - hidden.length;
let fails = 0; const check = (ok, m, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + m + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 600))); if (!ok) fails++; };
const tfCount = (labels) => labels.reduce((a, t) => (a[t] = (a[t] || 0) + 1, a), {});
console.log('NOTE stale feed steps', stale);
console.log('NOTE fresh', JSON.stringify(tfCount(fresh.labels)), 'live', JSON.stringify(tfCount(live.labels)), '15m gaps formed while streaming', watched.length);
check(watched.length >= 3 && shown >= 3, 'sample data forms 15m FVGs while the chart streams (' + watched.length + ' formed, ' + shown + ' shown)');
check(hidden.length === 0, 'every 15m FVG is on the chart by the first tick after the bar that closes its third 15m candle, unless a higher gap fully covers it', hidden);
check(missing.length === 0, 'every FVG a fresh run draws is drawn live too', missing.slice(0, 8));
check(extra.length === 0, 'no FVG live that a fresh run does not draw', extra.slice(0, 8));
Date.now = realNow;
process.exit(fails ? 1 : 0);
