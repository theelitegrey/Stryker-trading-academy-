// Real-Time Big Trades Bubbles & Absorbtions & Deep Pressure (samet_lezki, open-source on
// TradingView), Owner order 2026-10-14 "Add this indicator to chart and to my favourites".
//   PINETS=/path/to/node_modules/pinets node tools/tests/chart-pine-big-trades.test.mjs
// 1. The shipped .pine is byte-identical to the published TradingView source (CRLF kept).
// 2. One PICKER_SCRIPTS entry, section 'community', the author's own name.
// 3. With PINETS: the full script runs 5,000 bars (NQ-like 1m / 5m, BTC-like 1m) and every one of
//    its 10 plotshape series (3+3 bubble sizes, 2 absorption diamonds, 2 deep-pressure dots)
//    fires at least once; reports the compute time.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

const ID = 'realtime-big-trades-bubbles-samet-lezki';
const NAME = 'Real-Time Big Trades Bubbles & Absorbtions & Deep Pressure';
const MD5 = '0b7052878ce39f71494ead399ce59e30';
const { PICKER_SCRIPTS } = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-builtins.js')).href);
const hits = PICKER_SCRIPTS.filter((x) => x.id === ID);
check(hits.length === 1, 'exactly one PICKER_SCRIPTS entry');
const b = hits[0];
check(b && b.name === NAME && b.author === 'samet_lezki' && b.section === 'community', 'entry ' + JSON.stringify(b && [b.name, b.author, b.section]));
const buf = fs.readFileSync(path.join(root, 'assets', b.source.split('?')[0]));
check(crypto.createHash('md5').update(buf).digest('hex') === MD5, 'md5 ' + MD5 + ' (published TradingView source)');
check(buf.includes(Buffer.from('\r\n')) && buf.includes(Buffer.from('// © samet_lezki')), 'CRLF and author credit kept');

const PINETS = process.env.PINETS;
if (!PINETS) { console.log('SKIP engine checks: set PINETS=<path to node_modules/pinets>'); process.exit(fails ? 1 : 0); }
const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-next-patches.js')).href);
patches.install(pt.Context, pt, globalThis);

const mk = (N, tfm, p0, step) => { let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; let p = p0; const out = [];
  for (let i = 0; i < N; i++) { const o = p; p += (rnd() - 0.5) * step; const v = 100 + rnd() * 900 * (rnd() < 0.05 ? 8 : 1);
    out.push({ openTime: 1.75e12 + i * tfm * 6e4, closeTime: 1.75e12 + (i + 1) * tfm * 6e4, open: o, high: Math.max(o, p) + rnd() * step / 2, low: Math.min(o, p) - rnd() * step / 2, close: p, volume: v }); }
  return out; };
const code = buf.toString('utf8');
const SERIES = ['Big Buy Bubble Small', 'Big Buy Bubble Medium', 'Big Buy Bubble Large', 'Big Sell Bubble Small', 'Big Sell Bubble Medium', 'Big Sell Bubble Large', 'Bull Absorption', 'Bear Absorption', 'Deep Buy Pressure', 'Deep Sell Pressure'];
for (const [label, sym, tfm, p0, step] of [['NQ1! 1m', 'NQ1!', 1, 20000, 8], ['NQ1! 5m', 'NQ1!', 5, 20000, 18], ['BTCUSDT 1m', 'BTCUSDT', 1, 65000, 40]]) {
  const bars = mk(5000, tfm, p0, step);
  const src = { getMarketData: async () => bars, getSymbolInfo: async () => ({ ticker: sym, tickerid: sym, timezone: 'America/New_York', type: 'futures', mintick: 0.25 }) };
  const t0 = performance.now();
  const r = await new pt.PineTS(src, sym, String(tfm), 5000).run(patches.rewriteSource(code));
  const ms = Math.round(performance.now() - t0);
  const counts = {};
  for (const k of SERIES) { const p = r.plots && r.plots[k]; counts[k] = p ? p.data.filter((d) => d.value != null && !Number.isNaN(d.value) && d.value !== false).length : -1; }
  console.log('PERF', label, '5000 bars', ms, 'ms', JSON.stringify(counts));
  check(SERIES.every((k) => counts[k] > 0), label + ': all 10 plotshape series fire');
}
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
