// Liquidity Master [TradeZoro] (Owner 2026-10-12 "add this indicator").
//   PINETS=/path/to/node_modules/pinets node tools/tests/chart-liquidity-master.test.mjs
// 1. The shipped .pine differs from the Owner's original ONLY on the 4 brand lines (3, 4, 25,
//    1175): "[Stryker]" -> "[TradeZoro]" and the header credit. CRLF kept. Every other byte equal.
// 2. One PICKER_SCRIPTS entry, Editors' picks, author TradeZoro.
// 3. Engine (with PINETS): the language features the script uses, then the session-anchored
//    periods fix (chart-pine-next-patches.js): on a futures symbol (session 1800-1700 ET)
//    time("D"/"240"/"W"/"M") and time_close() follow the 18:00 ET trading day like TradingView;
//    on a 24x7 symbol they keep pinets' UTC values. Then the full script runs 5,000 bars of 5m
//    and 1m under the 20 s cap and draws its tables, sessions, PDH/PDL, FVGs and REQ lines.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

const FILE = path.join(root, 'assets', 'pine', 'liquidity-master-tradezoro.pine');
const ORIG = process.env.ORIG || '/root/projects/stryker-notes/reports/workers/pine-imports/liquidity-master-original.pine';
const buf = fs.readFileSync(FILE);
check(buf.includes(Buffer.from('\r\n')), 'CRLF line endings kept');
check(!/stryker/i.test(buf.toString('utf8')), 'no "Stryker" left in the shipped script');
if (fs.existsSync(ORIG)) {
  const o = fs.readFileSync(ORIG);
  check(crypto.createHash('md5').update(o).digest('hex').startsWith('bd29b7c11b6b'), 'original is the Owner file (md5 bd29b7c11b6b...)');
  const a = o.toString('utf8').split('\r\n'), b = buf.toString('utf8').split('\r\n');
  const diff = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff.push(i + 1);
  check(a.length === b.length && JSON.stringify(diff) === '[3,4,25,1175]', 'only lines 3, 4, 25, 1175 differ: ' + JSON.stringify(diff));
  const rebrand = (s) => s.split('[Stryker]').join('[TradeZoro]').split('© Stryker Trading  ·  strykertrading.com').join('© TradeZoro  ·  tradezoro.com');
  check(diff.every((n) => rebrand(a[n - 1]) === b[n - 1]), 'those lines are exactly the rebrand');
} else console.log('SKIP original not on this machine');

const { PICKER_SCRIPTS } = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-builtins.js')).href);
const hits = PICKER_SCRIPTS.filter((x) => x.id === 'liquidity-master-tradezoro');
check(hits.length === 1 && hits[0].name === 'Liquidity Master [TradeZoro]' && hits[0].author === 'TradeZoro' && hits[0].section === 'picks', 'picker entry: ' + JSON.stringify(hits[0] && [hits[0].name, hits[0].author, hits[0].section]));
check(hits[0] && hits[0].source.split('?')[0] === 'pine/liquidity-master-tradezoro.pine', 'picker source path');
check(buf.length <= 131072, 'under the built-in source cap (' + buf.length + ' B)');

const PINETS = process.env.PINETS;
if (!PINETS) { console.log('SKIP engine checks: set PINETS=<path to node_modules/pinets>'); process.exit(fails ? 1 : 0); }
const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-next-patches.js')).href);
patches.install(pt.Context, pt, globalThis);

const FUT = { ticker: 'NQ1!', tickerid: 'CME_MINI:NQ1!', timezone: 'America/New_York', session: '1800-1700', type: 'futures', mintick: 0.25 };
const CRY = { ticker: 'BTCUSDT', tickerid: 'BTCUSDT', timezone: 'Etc/UTC', session: '24x7', type: 'crypto', mintick: 0.01 };
function mk(N, tfm, start){
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; let p = 20000; const out = [];
  for (let i = 0; i < N; i++) { const o = p; p += (rnd() - 0.49) * 12; out.push({ openTime: start + i * tfm * 6e4, closeTime: start + (i + 1) * tfm * 6e4, open: o, high: Math.max(o, p) + rnd() * 6, low: Math.min(o, p) - rnd() * 6, close: p, volume: 100 + rnd() * 900 }); }
  return out;
}
async function run(code, N, tfm, info, start){
  const bars = mk(N, tfm, start);
  const src = { getMarketData: async () => bars, getSymbolInfo: async () => info };
  const t0 = Date.now();
  const r = await new pt.PineTS(src, info.ticker, String(tfm), N).run(patches.rewriteSource(code));
  const plots = {}, draw = {};
  for (const [k, p] of Object.entries(r.plots || {})) {
    if (k.startsWith('__')) { const v = p.data[0] && p.data[0].value; draw[k] = Array.isArray(v) ? v.filter((x) => x && !x._deleted) : []; }
    else plots[k] = p.data.map((d) => d.value);
  }
  return { ms: Date.now() - t0, plots, draw, bars };
}
const ET = (t) => new Date(t).toLocaleString('sv-SE', { timeZone: 'America/New_York' }).slice(0, 16);

// language features (UDT with array/line/label/box fields, history refs in a loop inside a
// function, polyline from chart.point.from_index, merged table cells, str.* helpers, timestamp
// day rollover)
{
  const r = await run(`//@version=6
indicator("feat", overlay=true, max_polylines_count=100)
st = math.abs(close - close[1])
f(fire, b1) =>
    float p = 0.0
    if fire
        for b = b1 + 1 to bar_index
            int o = bar_index - b
            p += st[o]
    p
plot(f(bar_index > 10, bar_index - 3), "loop")
plot(st + st[1] + st[2], "direct")
type U
    array<float> H
    line l = na
    label lb = na
    box bx = na
var array<U> us = array.new<U>()
if barstate.isfirst
    U u = U.new()
    u.H := array.new<float>()
    array.push(us, u)
U u0 = array.get(us, 0)
array.push(u0.H, high)
if bar_index == 50
    u0.l := line.new(time[5], high, time, high, xloc = xloc.bar_time)
    u0.lb := label.new(time, high, "lbl", xloc = xloc.bar_time, style = label.style_label_lower_left)
    u0.bx := box.new(time[5], high, time, low, xloc = xloc.bar_time)
    pts = array.new<chart.point>()
    array.push(pts, chart.point.from_index(40, low))
    array.push(pts, chart.point.from_index(50, high))
    polyline.new(pts, curved = false, closed = false, xloc = xloc.bar_index)
if not na(u0.l)
    line.set_x2(u0.l, time)
plot(array.size(u0.H), "sz")
var table t = table.new(position.top_right, 3, 3)
if barstate.islast
    table.cell(t, 0, 0, "HDR")
    table.merge_cells(t, 0, 0, 2, 0)
a = str.split("8:30,10:00", ",")
plot(array.size(a), "spl")
plot(str.tonumber("1800"), "num")
plot(str.contains("240", "D") ? 1 : 0, "cont")
plot(timestamp("America/New_York", 2026, 10, 0, 18, 0), "d0")
plot(timestamp("America/New_York", 2026, 10, 32, 18, 0), "d32")
`, 120, 5, FUT, Date.UTC(2026, 9, 5, 12));
  const L = (k) => r.plots[k][r.plots[k].length - 1];
  check(Math.abs(L('loop') - L('direct')) < 1e-9, 'history refs inside a loop in a function (st[o])');
  check(L('sz') === 120, 'UDT holding an array');
  check(r.draw.__lines__.length === 1 && r.draw.__lines__[0].x2 === r.bars[119].openTime && r.draw.__labels__.length === 1 && r.draw.__boxes__.length === 1, 'UDT line/label/box, xloc.bar_time, line.set_x2');
  check(r.draw.__polylines__.length === 1 && r.draw.__polylines__[0].points.length === 2, 'polyline.new from chart.point.from_index');
  check(JSON.stringify(r.draw.__tables__[0]).includes('"_merged":true'), 'table.merge_cells');
  check(L('spl') === 2 && L('num') === 1800 && L('cont') === 0, 'str.split / str.tonumber / str.contains');
  check(ET(L('d0')) === '2026-09-30 18:00' && ET(L('d32')) === '2026-11-01 18:00', 'timestamp(tz, ...) day 0 / day 32 roll over');
}

// session-anchored periods
const PER = `//@version=6
indicator("per")
plot(time("60"), "t60")
plot(time("240"), "t240")
plot(time("D"), "tD")
plot(time("W"), "tW")
plot(time("M"), "tM")
plot(time_close("D"), "tcD")
plot(time_close("W"), "tcW")
plot(time_close("M"), "tcM")
plot(time_close("240"), "tc240")
plot(time("D", "0930-1600", "America/New_York"), "tDs")
plot(time(timeframe.period, "2000-0000", "America/New_York"), "asia")
plot(time("D", 1), "tDb1")
`;
{
  // 5m bars from Fri 2026-10-30 16:00 ET (DST ends Sun 2026-11-01)
  const r = await run(PER, 1000, 5, FUT, Date.UTC(2026, 9, 30, 20, 0)); // to Mon 2 Nov ~06:00 EST
  const at = (k, et) => { const i = r.bars.findIndex((b) => ET(b.openTime) === et); return ET(r.plots[k][i]); };
  const atRaw = (k, et) => { const i = r.bars.findIndex((b) => ET(b.openTime) === et); return r.plots[k][i]; };
  check(at('tD', '2026-10-30 17:55') === '2026-10-29 18:00' && at('tD', '2026-10-30 18:00') === '2026-10-30 18:00', 'futures: D period opens 18:00 ET');
  check(at('tcD', '2026-10-30 18:00') === '2026-10-31 17:00', 'futures: time_close("D") = 17:00 ET next day');
  check(at('t240', '2026-10-30 21:55') === '2026-10-30 18:00' && at('t240', '2026-10-30 22:00') === '2026-10-30 22:00' && at('t240', '2026-10-31 02:00') === '2026-10-31 02:00', 'futures: 4H periods 18/22/02 ET');
  check(at('tc240', '2026-10-31 15:00') === '2026-10-31 17:00', 'futures: last 4H of the day closes at the 17:00 break');
  check(at('tW', '2026-10-30 12:00') === undefined || at('tW', '2026-10-30 16:00') === '2026-10-25 18:00', 'futures: week opens Sunday 18:00 ET');
  check(at('tcW', '2026-10-30 16:00') === '2026-10-30 17:00', 'futures: week closes Friday 17:00 ET');
  check(at('tM', '2026-10-30 16:00') === '2026-09-30 18:00' && at('tcM', '2026-10-30 16:00') === '2026-10-30 17:00', 'futures: month = first to last weekday session');
  check(at('tD', '2026-11-01 18:00') === '2026-11-01 18:00' && at('tcD', '2026-11-01 18:00') === '2026-11-02 17:00', 'futures: day across the DST change (EST)');
  check(Number.isNaN(atRaw('tDs', '2026-10-30 20:00')) && at('tDs', '2026-10-31 10:00') === '2026-10-30 18:00', 'futures: time("D", session, tz) na outside, D open inside');
  check(Number.isNaN(atRaw('asia', '2026-10-30 19:55')) && at('asia', '2026-10-30 20:00') === '2026-10-30 20:00', 'chart-TF session check unchanged (Asia 2000-0000)');
  check(at('tDb1', '2026-10-30 18:05') === '2026-10-30 18:00' && at('tDb1', '2026-10-30 18:00') === '2026-10-29 18:00', 'futures: bars_back honoured');
  check(at('t60', '2026-10-30 18:30') === '2026-10-30 18:00', 'futures: hourly unchanged in effect');
}
{
  const r = await run(PER, 300, 5, CRY, Date.UTC(2026, 8, 28, 0, 0));
  const iso = (k, i) => new Date(r.plots[k][i]).toISOString().slice(0, 16);
  check(iso('tD', 100) === '2026-09-28T00:00' && iso('t240', 100) === '2026-09-28T08:00' && iso('tW', 299) === '2026-09-28T00:00' && iso('tcD', 0) === '2026-09-29T00:00', '24x7 symbol: pinets UTC periods unchanged');
}
check(patches.parseOvernightSession('1800-1700') && !patches.parseOvernightSession('24x7') && !patches.parseOvernightSession('0930-1600') && patches.parseOvernightSession('1700-1700'), 'only overnight sessions are anchored');

// the full script, 5,000 bars, no history cap (Owner 2026-10-12: "dont change anything")
const code = buf.toString('utf8');
check(hits[0] && !('maxBars' in hits[0]), 'picker entry has no history cap');
for (const [tfm, label] of [[5, '5m'], [1, '1m']]) {
  const r = await run(code, 5000, tfm, FUT, Date.UTC(2026, 8, 1, 0, 0));
  const texts = (r.draw.__labels__ || []).map((l) => l.text).join(' | ');
  const tt = JSON.stringify(r.draw.__tables__ || []);
  console.log(`PERF Liquidity Master NQ1! ${label} 5000 bars (Node, one core): ${r.ms} ms; lines ${r.draw.__lines__.length}, boxes ${r.draw.__boxes__.length}, labels ${r.draw.__labels__.length}, polylines ${r.draw.__polylines__.length}, tables ${r.draw.__tables__.length}`);
  // Timing is INFO here: in one Node process after the runs above (GC, shared CPU) it reads
  // 1.5-2x a fresh worker. The 20 s cap is asserted on the real page by
  // chart-liquidity-master-browser.js.
  console.log(`INFO ${label}: 5,000 bars in ${r.ms} ms (browser suite asserts the 20 s cap)`);
  check(/DRAW ON LIQUIDITY  ·  ABOVE/.test(tt) && /DRAW ON LIQUIDITY  ·  BELOW/.test(tt) && /Liquidity Master \[TradeZoro\]/.test(tt), `${label}: both DOL tables + watermark`);
  check(/Asia (High|Low)/.test(texts) && /London (High|Low)/.test(texts) && /NY (High|Low)/.test(texts) && /PD[HL]/.test(texts) && /FVG/.test(texts) && /REQ[HL]/.test(texts), `${label}: sessions, PDH/PDL, FVG, REQ labels`);
  check(r.draw.__lines__.length <= 500 && r.draw.__boxes__.length <= 500 && r.draw.__labels__.length <= 500, `${label}: within 500 lines/boxes/labels`);
}
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
