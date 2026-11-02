// Feed compare: 1 h of prints from InsightSentry (IS, what stk_of_big / stk_of_delta / stk_of_cvd use) vs Tick-stream (TS, the new twins).
//   TICKSTREAM_ENV=/path/tickstream.env INSIGHTSENTRY_ENV=/path/insightsentry.env node tools/tests/feed-compare.mjs [SYM=NQ] [minutes=60] [IS contract code]
// Only counts and sums are printed. Keys are read from the env files (or TICKSTREAM_API_KEY / INSIGHTSENTRY_WEBSOCKET_API_KEY), never printed, never written.
// IS: REST /v3/symbols/<code>/trades?window=3h (the same call of-feeder uses), TS: /v1/ticks (paged, 100k a page). Prints without a side are left out of
// both sides' buy/sell (IS leaves some untyped; the count is shown). Big = size >= the 99.5th percentile of single IS prints in the window (the same rule
// as the chart's auto size), applied to BOTH feeds. Matching: same side, same price, |dt| <= 2 s, size within 10%.
import fs from 'node:fs';
import { compareFeeds, mergeFills } from '../../assets/chart-ts-data.js';
const [sym = 'NQ', mins = '60', codeArg] = process.argv.slice(2);
const envKey = (file, name) => { if (process.env[name]) return process.env[name]; const m = file && fs.existsSync(file) && new RegExp(name + '=(.*)').exec(fs.readFileSync(file, 'utf8')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };
const tsKey = envKey(process.env.TICKSTREAM_ENV, 'TICKSTREAM_API_KEY'), isKey = envKey(process.env.INSIGHTSENTRY_ENV, 'INSIGHTSENTRY_WEBSOCKET_API_KEY');
if (!tsKey || !isKey) { console.error('need TICKSTREAM_ENV and INSIGHTSENTRY_ENV (or the key variables)'); process.exit(2); }
const TICK = { NQ: 0.25, ES: 0.25, MNQ: 0.25, MES: 0.25, YM: 1, RTY: 0.1, CL: 0.01, GC: 0.1 }[sym];
const PFX = { NQ: 'CME_MINI:NQ', ES: 'CME_MINI:ES', MNQ: 'CME_MINI:MNQ', MES: 'CME_MINI:MES', YM: 'CBOT_MINI:YM', RTY: 'CME_MINI:RTY', CL: 'NYMEX:CL', GC: 'COMEX:GC' }[sym];
let t1 = Math.floor(Date.now() / 60000) * 60 - 60, t0 = 0;   // whole minutes, the open one left out

// ---- IS
const MONTHS = 'HMUZ', d = new Date(), y = d.getUTCFullYear();
const cands = [];
for (let k = 0; k < 8; k++) { const q = 'HMUZ'.indexOf(MONTHS[k % 4]); const yr = y + Math.floor((d.getUTCMonth() / 3 + k) / 4); cands.push(PFX + MONTHS[(Math.floor(d.getUTCMonth() / 3) + k) % 4] + (y + Math.floor((Math.floor(d.getUTCMonth() / 3) + k) / 4))); }
const isGet = async (code) => {
  const r = await fetch('https://api.insightsentry.com/v3/symbols/' + encodeURIComponent(code) + '/trades?date=' + new Date().toISOString().slice(0, 10) + '&window=3h', { headers: { authorization: 'Bearer ' + isKey } });
  if (!r.ok) return { code, rows: [], status: r.status };
  const j = await r.json(); return { code, rows: j.series || [], status: r.status };
};
let isRes = null;
for (const c of (codeArg ? [codeArg] : cands.slice(0, 2))) { const x = await isGet(c); if (!isRes || x.rows.length > isRes.rows.length) isRes = x; }
// the IS REST window can trail by a few minutes: end the window at IS's last whole minute so both sides cover the same time
const isLast = isRes.rows.length ? isRes.rows[isRes.rows.length - 1].time : t1;
t1 = Math.min(t1, Math.floor(isLast / 60) * 60); t0 = t1 - Number(mins) * 60;
const isRows = isRes.rows.filter((r) => r.time >= t0 && r.time < t1);

// ---- TS
const tsRows = []; let s = t0, pages = 0;
for (;;) {
  const r = await fetch('https://api.tick-stream.xyz/v1/ticks?symbol=' + sym + '&start=' + s + '&end=' + t1 + '&limit=100000', { headers: { authorization: 'Bearer ' + tsKey } });
  if (!r.ok) { console.error('TS http', r.status); process.exit(3); }
  const j = await r.json(); pages++;
  const last = tsRows.length ? tsRows[tsRows.length - 1].ts : -1;
  for (const x of j.ticks || []) if (x.ts > last) tsRows.push(x);
  if (!j.truncated || !j.ticks.length || pages > 30) break;
  s = Math.floor(j.ticks[j.ticks.length - 1].ts / 1e6);
}

// ---- shape both into what compareFeeds wants
const mkBars = new Map();
let isUntyped = 0;
for (const r of isRows) {
  if (r.type !== 'buy' && r.type !== 'sell') { isUntyped++; continue; }
  const t = Math.floor(r.time / 60) * 60000;
  let b = mkBars.get(t); if (!b) { b = { t, buy: [0], sell: [0], bigs: [], delta: 0 }; mkBars.set(t, b); }
  const buy = r.type === 'buy'; b[buy ? 'buy' : 'sell'][0] += r.volume; b.delta += buy ? r.volume : -r.volume;
  b.bigs.push([Math.round(r.time * 1000), Math.round(r.close / TICK), r.volume, buy ? 1 : 0]);
}
const isBars = [...mkBars.values()].sort((a, b) => a.t - b.t);
const sizes = isRows.filter((r) => r.type).map((r) => r.volume).sort((a, b) => a - b);
const thr = sizes.length ? sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * 0.995))] : 1;
const tsM = new Map(), tsTrades = []; let tsUntyped = 0;
for (const x of tsRows) {
  const side = x.side === 'buy' ? 1 : x.side === 'sell' ? -1 : 0;
  if (!side) { tsUntyped++; continue; }
  const ms = x.ts / 1000, t = Math.floor(ms / 60000) * 60000;   // x.ts is microseconds
  let m = tsM.get(t); if (!m) { m = { t, buy: 0, sell: 0 }; tsM.set(t, m); }
  m[side > 0 ? 'buy' : 'sell'] += x.size;
  tsTrades.push([ms, x.price, x.size, side]);
}
const tsFills = tsTrades.length;
const tsMerged = mergeFills(tsTrades, 0).map((o) => [Math.round(o[0]), o[1], o[2], o[3]]);   // one print per order (same microsecond), like InsightSentry
const tsMins = [...tsM.values()].sort((a, b) => a.t - b.t);
const R = compareFeeds({ isBars, tsMins, tsTrades: tsMerged, thr, tick: TICK, from: t0 * 1000, to: t1 * 1000 });
// per-minute delta correlation + CVD end-point over the window
const tmap = new Map(tsMins.map((m) => [m.t, m.buy - m.sell]));
let cvdIS = 0, cvdTS = 0; for (const b of isBars) cvdIS += b.delta; for (const m of tsMins) cvdTS += m.buy - m.sell;
const f = (v) => (v == null ? 'n/a' : typeof v === 'number' ? (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100)) : v);
const rows = [
  ['records (IS prints / TS fills)', isRows.length - isUntyped, tsFills],
  ['orders (TS fills merged, same µs)', isRows.length - isUntyped, tsMerged.length],
  ['prints without a side', isUntyped, tsUntyped],
  ['volume (contracts)', R.is.vol, R.ts.vol],
  ['buy volume', R.is.buy, R.ts.buy],
  ['sell volume', R.is.sell, R.ts.sell],
  ['buy share %', R.is.vol ? 100 * R.is.buy / R.is.vol : null, R.ts.vol ? 100 * R.ts.buy / R.ts.vol : null],
  ['big prints (>= ' + thr + ')', R.is.prints, R.ts.prints],
  ['big bubbles (merged)', R.is.bubbles, R.ts.bubbles],
  ['delta (window)', R.is.delta, R.ts.delta],
  ['CVD end (window start = 0)', cvdIS, cvdTS]
];
const pad = (v, n) => String(v).padEnd(n);
console.log(sym + ' last ' + mins + ' min, IS contract ' + (isRes.code || '?') + ' (http ' + isRes.status + '), TS /v1/ticks pages ' + pages);
console.log(pad('', 28) + pad('InsightSentry', 15) + 'Tick-stream');
for (const r of rows) console.log(pad(r[0], 28) + pad(f(r[1]), 15) + f(r[2]));
console.log('big prints matched          ' + R.matched + ' of IS ' + R.is.prints + ' = ' + f(R.matchedPct) + ' %  (same side, price, |dt| <= 2 s, size +-10 %)');
console.log('lag TS - IS (ms)            p50 ' + f(R.lagP50) + '   p90 ' + f(R.lagP90) + '   (negative = TS earlier)');
console.log('per-minute delta correlation ' + f(R.corr) + ' over ' + R.minutes + ' minutes');
