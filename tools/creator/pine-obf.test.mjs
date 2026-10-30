// Protected-indicator shrinking (assets/pine-obfuscate.js): the rewritten script must give the SAME plots as the original.
//   PINETS=/path/to/node_modules/pinets node tools/creator/pine-obf.test.mjs
// Without PINETS only the text checks run (comments gone, names changed, watermark round-trip).
// Runs every shipped .pine file in assets/pine/ (big real scripts: 3k-4k lines, UDTs, methods, tuples, inputs).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const O = await import(pathToFileURL(path.join(root, 'assets', 'pine-obfuscate.js')).href);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const nameFor = (key) => (x) => 'v' + createHmac('sha256', key).update(x).digest('hex').slice(0, 7);

// ---- text checks ----
const SMALL = `//@version=5
// secret method: the trick is the 21 EMA
indicator("Mint Bands", overlay=true)  // trailing
lenX = input.int(21, "Length")
mySecretAvg(src, n) =>
    // inner comment
    ta.ema(src, n)
basisLine = mySecretAvg(close, lenX)
upperBand = basisLine + ta.atr(14)
var float lastHit = na
lastHit := close > upperBand ? close : lastHit
plot(basisLine, "Basis", color=color.teal)
plot(upperBand, title="Upper")
`;
const map = O.renameMap(SMALL, nameFor('buyer-1'));
const out = O.rewrite(SMALL, map);
check(!/secret method|inner comment|trailing/.test(out), 'comments stripped');
check(/^\/\/@version=5/.test(out), '//@version kept');
check(!/mySecretAvg|basisLine|upperBand|lastHit/.test(out), 'own names renamed: ' + [...map.keys()].join(','));
check(/lenX = input\.int/.test(out), 'input variable kept (settings key)');
check(/\(src, n\)/.test(out), 'function params kept');
check(/title="Upper"/.test(out) && /color=color\.teal/.test(out), 'named args and members untouched');
const out2 = O.rewrite(SMALL, O.renameMap(SMALL, nameFor('buyer-2')));
check(out !== out2, 'different buyers get different text');
check(O.rewrite(SMALL, O.renameMap(SMALL, nameFor('buyer-1'))) === out, 'same buyer, same text (stable settings)');
const mark = O.encodeMark(new Uint8Array([1, 2, 250, 77]));
const marked = O.insertMark(out, mark, 3);
const found = O.findMarks(marked);
check(found.length === 1 && [...found[0]].join() === '1,2,250,77', 'watermark round-trip');
check(!/[^\x00-\x7f]/.test(marked.replace(mark, '')), 'mark is the only non-ASCII');
check(marked.split('\n').some((l) => l === mark), 'mark sits on its own line');
const T1 = O.template(SMALL);
const f1 = O.fill(T1, O.namer('seed-a')), f2 = O.fill(T1, O.namer('seed-b'));
check(!/mySecretAvg|basisLine|upperBand|lastHit|secret method/.test(f1) && !/\u0001/.test(f1), 'template+fill: names and comments gone, no markers left');
check(f1 !== f2 && f1 === O.fill(T1, O.namer('seed-a')), 'template+fill: per-seed names, stable for one seed');

// ---- engine equivalence ----
const PINETS = process.env.PINETS;
if (!PINETS) { console.log('SKIP engine checks: set PINETS=<path to node_modules/pinets>'); process.exit(fails ? 1 : 0); }
const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-next-patches.js')).href);
try { patches.install(pt.Context, pt, globalThis); } catch (e) {}
const bars = Array.from({ length: 700 }, (_, i) => {
  const o = 100 + Math.sin(i / 17) * 5 + Math.sin(i / 3) * 1.3, c = 100 + Math.sin((i + 1) / 17) * 5 + Math.cos(i / 5);
  return { openTime: 1.7e12 + i * 3e5, closeTime: 1.7e12 + (i + 1) * 3e5, open: o, high: Math.max(o, c) + 0.7, low: Math.min(o, c) - 0.6, close: c, volume: 100 + (i % 13) * 7 };
});
const agg = (mins) => { const out = []; const ms = mins * 6e4; for (const b of bars) { const t = Math.floor(b.openTime / ms) * ms; const l = out[out.length - 1]; if (l && l.openTime === t) { l.high = Math.max(l.high, b.high); l.low = Math.min(l.low, b.low); l.close = b.close; l.volume += b.volume; } else out.push({ ...b, openTime: t, closeTime: t + ms }); } return out; };
const src = { getMarketData: async (s, tf) => (tf === '5' ? bars : agg(Number(tf) || 1440)), getSymbolInfo: async () => ({ ticker: 'X', tickerid: 'X', timezone: 'UTC', type: 'crypto', mintick: 0.01 }) };
const rw = patches.rewriteSource || ((s) => s);
async function run(code) {
  const r = await new pt.PineTS(src, 'X', '5', bars.length).run(rw(code));
  // Drawing objects carry an engine-wide running `id` (it keeps counting across runs in one process), so ids are
  // dropped before comparing; everything else (coordinates, colours, text, styles, plot values) must match.
  return JSON.stringify(Object.values(r.plots).map((p) => p.data.map((d) => d.value)),
    (k, v) => (k === 'id' ? undefined : typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
}
const files = [['inline', SMALL]].concat(fs.readdirSync(path.join(root, 'assets', 'pine')).filter((f) => f.endsWith('.pine')).map((f) => [f, fs.readFileSync(path.join(root, 'assets', 'pine', f), 'utf8')]));
let compared = 0;
for (const [name, code] of files) {
  let a;
  try { a = await run(code); } catch (e) { console.log('SKIP ' + name + ': original does not run headless (' + String(e.message).slice(0, 60) + ')'); continue; }
  if (/\btimenow\b/.test(code) && a !== await run(code)) { console.log('SKIP ' + name + ': output depends on the wall clock (timenow)'); continue; }
  // The shipped path: template once (publish), fill per buyer (delivery), watermark line inserted.
  const tp = O.template(code), m = tp.names;
  const obf = O.insertMark(O.fill(tp, O.namer('buyer-seed')), O.encodeMark(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9])), 7);
  let b;
  try { b = await run(obf); } catch (e) { check(false, name + ': obfuscated copy fails: ' + String(e.message).slice(0, 160)); continue; }
  compared++;
  check(a === b, name + ': same plots (' + m.length + ' names renamed, ' + code.length + ' -> ' + obf.length + ' chars)');
}
check(compared >= 5, compared + ' scripts compared on the engine');
process.exit(fails ? 1 : 0);
