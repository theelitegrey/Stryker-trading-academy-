// Community batch C (Owner 2026-10-12 "Add these third party indicators"): Trend Average
// (Zeiierman) and Smart Signals Assistant (AlgoAlpha, "🧠 Smart Signals 2.0").
//   PINETS=/path/to/node_modules/pinets node tools/tests/chart-pine-community-c.test.mjs
// 1. Each shipped .pine is BYTE-IDENTICAL to the file the Owner sent (CRLF kept, no normalising).
// 2. PICKER_SCRIPTS: one entry each, stable id, section 'community', the script's own author.
// 3. Member uploads stay capped at 64 KB (Smart Signals is 63 KB; built-ins use the engine cap).
// 4. With PINETS: the language features both scripts lean on (UDT + methods, arrays of UDTs,
//    input.text_area/source/timeframe, request.security lookahead_on on a function call,
//    timeframe.in_seconds, plotcandle, barcolor, color.from_gradient, merged table footer,
//    sort_indices, percentile_linear_interpolation, str.format_time, alert/alertcondition) run on
//    pinets 0.11.0 + our patches, and both full scripts run 5,000 bars well inside the 20 s cap
//    and draw their Entry/Conf labels and signal labels + tables. alert()/alertcondition() are
//    accepted and do nothing (the Charts page has no alert delivery for Pine; nothing trades).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

const SCRIPTS = {
  'zeiierman-trend-average': ['Trend Average (Zeiierman)', 'Zeiierman', '5535f018e859eb06084d339c07ce4634'],
  'algoalpha-smart-signals-2': ['Smart Signals Assistant', 'AlgoAlpha', 'a0cdc74c97d0cc183a7e5acc2a1bafd5']
};
const ORIG = process.env.ORIG || '/root/projects/stryker-notes/reports/workers/pine-imports/community';
const crypto = await import('node:crypto');
const { PICKER_SCRIPTS } = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-builtins.js')).href);
for (const [id, [name, author, md5]] of Object.entries(SCRIPTS)) {
  const hits = PICKER_SCRIPTS.filter((x) => x.id === id);
  check(hits.length === 1, id + ': exactly one PICKER_SCRIPTS entry');
  const b = hits[0]; if (!b) continue;
  check(b.name === name && b.author === author && b.section === 'community' && !/stryker|tradezoro/i.test(b.author), id + ': ' + JSON.stringify([b.name, b.author, b.section]));
  const file = path.join(root, 'assets', b.source.split('?')[0]);
  const buf = fs.readFileSync(file);
  check(crypto.createHash('md5').update(buf).digest('hex') === md5, id + ': md5 ' + md5 + ' (the Owner file)');
  check(buf.includes(Buffer.from('\r\n')), id + ': CRLF line endings kept');
  const orig = path.join(ORIG, id + '.pine');
  if (fs.existsSync(orig)) check(Buffer.compare(buf, fs.readFileSync(orig)) === 0, id + ': byte-identical to the saved original');
  else console.log('SKIP ' + id + ': original not on this machine');
}
const cp = fs.readFileSync(path.join(root, 'assets', 'chart-pine.js'), 'utf8');
check(/const SRC_MAX = 65536;/.test(cp), 'member uploads still capped at 64 KB (SRC_MAX 65536)');

const PINETS = process.env.PINETS;
if (!PINETS) { console.log('SKIP engine checks: set PINETS=<path to node_modules/pinets>'); process.exit(fails ? 1 : 0); }
const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-next-patches.js')).href);
patches.install(pt.Context, pt, globalThis);

const mk = (N, tfm) => { let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; let p = 20000; const out = [];
  for (let i = 0; i < N; i++) { const o = p; p += (rnd() - 0.49) * 12; out.push({ openTime: 1.75e12 + i * tfm * 6e4, closeTime: 1.75e12 + (i + 1) * tfm * 6e4, open: o, high: Math.max(o, p) + rnd() * 6, low: Math.min(o, p) - rnd() * 6, close: p, volume: 100 + rnd() * 900 }); }
  return out; };
const tfMin = (tf) => { tf = String(tf); if (/^\d+$/.test(tf)) return +tf; const m = /^(\d*)([DWM])$/.exec(tf); return m ? (+m[1] || 1) * { D: 1440, W: 10080, M: 43200 }[m[2]] : 1440; };
async function run(code, N, tfm){
  const bars = mk(N, tfm);
  const agg = (mins) => { const out = []; const ms = mins * 6e4; for (const b of bars) { const t = Math.floor(b.openTime / ms) * ms; const l = out[out.length - 1]; if (l && l.openTime === t) { l.high = Math.max(l.high, b.high); l.low = Math.min(l.low, b.low); l.close = b.close; } else out.push({ ...b, openTime: t, closeTime: t + ms }); } return out; };
  const src = { getMarketData: async (s, tf) => (tfMin(tf) <= tfm ? bars : agg(tfMin(tf))), getSymbolInfo: async () => ({ ticker: 'NQ1!', tickerid: 'CME_MINI:NQ1!', timezone: 'America/New_York', type: 'futures', mintick: 0.25 }) };
  const t0 = Date.now();
  const r = await new pt.PineTS(src, 'NQ1!', String(tfm), N).run(patches.rewriteSource(code));
  const plots = {}; const draw = {};
  for (const [k, p] of Object.entries(r.plots || {})) {
    if (k.startsWith('__')) { const v = p.data[0] && p.data[0].value; draw[k] = Array.isArray(v) ? v.filter((x) => x && !x._deleted) : []; }
    else plots[k] = p.data.map((d) => d.value);
  }
  return { ms: Date.now() - t0, plots, draw };
}
const last = (a) => a[a.length - 1];

const f = await run(fs.readFileSync(path.join(here, 'fixtures', 'pine-community-c-features.pine'), 'utf8'), 300, 5);
check(last(f.plots.wr) > 0 && last(f.plots.wr) < 100, 'UDT field += and a method on it (' + last(f.plots.wr) + ')');
check(last(f.plots.wr2) === 50, 'array<UDT>.get(0).method()');
check([1, -1].includes(last(f.plots.hd)), 'request.security(tf, f(close)[1], lookahead_on) returns a series value');
check(last(f.plots.secs) === 14400 && last(f.plots.secs2) === 300, 'timeframe.in_seconds(input.timeframe) and of the chart');
check(Number.isFinite(last(f.plots.p50)) && Number.isInteger(last(f.plots.idx0)), 'percentile_linear_interpolation + sort_indices');
check(last(f.plots.talen) === 11 && Number.isFinite(last(f.plots.src)), 'input.text_area + input.source');
check(Array.isArray(last(f.plots.C)) && last(f.plots.C).length === 4, 'plotcandle gives OHLC per bar');
check(f.draw.__tables__ && f.draw.__tables__.length === 1 && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(f.draw.__tables__[0].cells[0][0].text), 'table with str.format_time cell + merged footer');

for (const [id, cap, want] of [['zeiierman-trend-average', 20000, ['Entry', 'Conf']], ['algoalpha-smart-signals-2', 20000, []]]) {
  const r = await run(fs.readFileSync(path.join(root, 'assets', 'pine', id + '.pine'), 'utf8'), 5000, 5);
  const texts = (r.draw.__labels__ || []).map((l) => l.text);
  console.log('PERF ' + id + ' 5000 bars (Node, one core): ' + r.ms + ' ms; labels ' + texts.length + ', lines ' + (r.draw.__lines__ || []).length + ', boxes ' + (r.draw.__boxes__ || []).length + ', tables ' + (r.draw.__tables__ || []).length);
  check(r.ms < cap, id + ': 5,000 bars in ' + r.ms + ' ms (< ' + cap + ')');
  check(texts.length > 0 && want.every((w) => texts.includes(w)), id + ': draws its labels ' + JSON.stringify(want));
  if (id.startsWith('algo')) check((r.draw.__tables__ || []).length >= 1 && Array.isArray(last(r.plots.Candles)), id + ': dashboard table + trend candles');
}
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
