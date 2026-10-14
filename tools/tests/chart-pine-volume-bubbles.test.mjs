// Volume Bubbles [QuantAlgo] (open-source on TradingView), Owner order 2026-10-14.
//   PINETS=/path/to/node_modules/pinets node tools/tests/chart-pine-volume-bubbles.test.mjs
// 1. The shipped .pine is byte-identical to the published TradingView source (CRLF kept).
// 2. One PICKER_SCRIPTS entry, section 'community', the author's own name.
// 3. rewriteLibraryImports: only `import TradingView/ta/N as X` + `[_, _, _, d] = X.requestVolumeDelta(tf)`
//    are rewritten (pinets has no import); other scripts and other imports pass through untouched.
// 4. With PINETS: the full script runs on 1m and 5m bars (NQ-like) with the lower-timeframe request,
//    draws its bubble labels, and the rewritten delta equals a hand-computed signed LTF volume sum.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

const ID = 'volume-bubbles-quantalgo';
const NAME = 'Volume Bubbles [QuantAlgo]';
const MD5 = '07013b75beeb58c5e360ec675c95fabc';
const { PICKER_SCRIPTS } = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-builtins.js')).href);
const hits = PICKER_SCRIPTS.filter((x) => x.id === ID);
check(hits.length === 1, 'exactly one PICKER_SCRIPTS entry');
const b = hits[0];
check(b && b.name === NAME && b.author === 'QuantAlgo' && b.section === 'community', 'entry ' + JSON.stringify(b && [b.name, b.author, b.section]));
const buf = fs.readFileSync(path.join(root, 'assets', b.source.split('?')[0]));
check(crypto.createHash('md5').update(buf).digest('hex') === MD5, 'md5 ' + MD5 + ' (published TradingView source)');
check(buf.includes(Buffer.from('\r\n')) && buf.includes(Buffer.from('QuantAlgo')), 'CRLF and author credit kept');
const patches = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-next-patches.js')).href);
const code = buf.toString('utf8');
const rw = patches.rewriteLibraryImports(code);
check(!/^\s*import\s/m.test(rw) && !/requestVolumeDelta/.test(rw) && /request\.security_lower_tf\(syminfo\.tickerid, lowerTimeframe/.test(rw), 'import + requestVolumeDelta rewritten');
check(patches.rewriteLibraryImports('//@version=6\nindicator("x")\nplot(close)') === '//@version=6\nindicator("x")\nplot(close)', 'scripts without the import pass through unchanged');
const other = '//@version=6\nimport foo/bar/1 as q\nindicator("x")\nplot(q.f())';
check(patches.rewriteLibraryImports(other) === other, 'other imports untouched');

const PINETS = process.env.PINETS;
if (!PINETS) { console.log('SKIP engine checks: set PINETS=<path to node_modules/pinets>'); process.exit(fails ? 1 : 0); }
const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
patches.install(pt.Context, pt, globalThis);
let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const N = 3000; let p = 20000; const base = [];
for (let i = 0; i < N; i++) { const o = p; p += (rnd() - 0.5) * 10; base.push({ openTime: 1.75e12 + i * 6e4, closeTime: 1.75e12 + (i + 1) * 6e4, open: o, high: Math.max(o, p) + rnd() * 4, low: Math.min(o, p) - rnd() * 4, close: p, volume: 100 + rnd() * 900 }); }
const tfMin = (tf) => { tf = String(tf); if (/^\d+$/.test(tf)) return +tf; return /S$/.test(tf) ? 1 / 60 : 1440; };
const agg = (mins) => { const out = []; const ms = mins * 6e4; for (const x of base) { const t = Math.floor(x.openTime / ms) * ms; const l = out[out.length - 1]; if (l && l.openTime === t) { l.high = Math.max(l.high, x.high); l.low = Math.min(l.low, x.low); l.close = x.close; l.volume += x.volume; } else out.push({ ...x, openTime: t, closeTime: t + ms }); } return out; };
for (const tfm of [1, 5]) {
  const bars = tfm === 1 ? base : agg(tfm);
  const src = { getMarketData: async (s, tf) => { const m = tfMin(tf); return m <= 1 ? base : agg(m); }, getSymbolInfo: async () => ({ ticker: 'NQ1!', tickerid: 'CME_MINI:NQ1!', timezone: 'America/New_York', type: 'futures', mintick: 0.25 }) };
  const t0 = performance.now();
  const r = await new pt.PineTS(src, 'NQ1!', String(tfm), bars.length).run(patches.rewriteSource(code));
  const ms = Math.round(performance.now() - t0);
  const lab = (r.plots.__labels__ && r.plots.__labels__.data[0] && r.plots.__labels__.data[0].value) || [];
  const n = lab.filter((x) => x && !x._deleted).length;
  console.log('PERF NQ-like', tfm + 'm', bars.length, 'bars', ms, 'ms', n, 'labels');
  check(n > 0, tfm + 'm: draws bubble labels (' + n + ')');
}
// the rewritten delta equals a hand-computed signed sum of the last 5m bar's 1m volumes
const d = `//@version=6
indicator("d")
import TradingView/ta/12 as taLib
ltf = "1"
[_, _, _, lastDelta] = taLib.requestVolumeDelta(ltf)
plot(lastDelta, "delta")`;
const bars5 = agg(5);
const src5 = { getMarketData: async (s, tf) => (tfMin(tf) <= 1 ? base : bars5), getSymbolInfo: async () => ({ ticker: 'NQ1!', tickerid: 'CME_MINI:NQ1!', timezone: 'America/New_York', type: 'futures', mintick: 0.25 }) };
const rr = await new pt.PineTS(src5, 'NQ1!', '5', bars5.length).run(patches.rewriteSource(d));
const got = rr.plots.delta.data.map((x) => x.value);
const lastBar = bars5[bars5.length - 1];
const kids = base.filter((x) => x.openTime >= lastBar.openTime && x.openTime < lastBar.openTime + 5 * 6e4);
let prevC = base[base.indexOf(kids[0]) - 1].close, up = true, want = 0;
for (const k of kids) { up = k.close > k.open ? true : k.close < k.open ? false : k.close > prevC ? true : k.close < prevC ? false : up; want += up ? k.volume : -k.volume; prevC = k.close; }
check(Math.abs(got[got.length - 1] - want) < 1e-6, 'delta of the last 5m bar ' + got[got.length - 1].toFixed(2) + ' == hand-computed ' + want.toFixed(2));
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
