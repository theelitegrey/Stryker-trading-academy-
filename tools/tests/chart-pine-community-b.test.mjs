// Community built-ins batch B (ICT Pro+, iFVG Ultimate+ Deluxe, CISD Model+, Forever Pro°,
// Unicorn Model) + the generic pine-next engine fixes they needed.
//   PINETS=/path/to/node_modules/pinets node tools/tests/chart-pine-community-b.test.mjs
// 1. Every shipped source is BYTE-IDENTICAL to the file the Owner sent (no normalisation:
//    CRLF line endings are kept as-is) when the saved originals are on this machine.
// 2. The BUILTIN_PINE entries: section 'community', third-party author, never Stryker.
// 3. Engine fixes (assets/chart-pine-next-patches.js) against real pinets 0.11.0:
//    request.security in a function called from two call sites, time("D", tz),
//    the cached Intl.DateTimeFormat giving the same parts.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

const SCRIPTS = {
  'ict-pro-plus-timmynq': ['ICT Pro+ | TimmyNQ [TakingProphets]', 'TimmyNQ (TakingProphets)'],
  'ifvg-ultimate-deluxe-dodgysdd': ['iFVG Ultimate+ Deluxe | DodgysDD', 'DodgysDD'],
  'cisd-model-plus-triton': ['CISD Model+ | Triton Trades', 'Triton Trades'],
  'forever-pro': ['Forever Pro°', 'Community'],
  'unicorn-model': ['Unicorn Model', 'Community']
};
const ORIG = process.env.ORIG || '/root/projects/stryker-notes/reports/workers/pine-imports/community';
const { BUILTIN_PINE } = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-builtins.js')).href);
for (const [id, [name, author]] of Object.entries(SCRIPTS)) {
  const b = BUILTIN_PINE.find((x) => x.id === id);
  if (!b) { console.log('SKIP ' + id + ': not in BUILTIN_PINE (not shipped yet)'); continue; }
  check(b.name === name && b.author === author && b.section === 'community' && !/stryker/i.test(b.author + b.name), id + ': entry ' + JSON.stringify([b.name, b.author, b.section]));
  const file = path.join(root, 'assets', b.url.split('?')[0]);
  check(b.source === b.url && fs.existsSync(file), id + ': source file ' + b.url);
  const orig = path.join(ORIG, id + '.pine');
  if (fs.existsSync(orig)) check(Buffer.compare(fs.readFileSync(file), fs.readFileSync(orig)) === 0, id + ': byte-identical to the Owner file (CRLF kept, no normalising)');
  else console.log('SKIP ' + id + ': original not on this machine');
}

const PINETS = process.env.PINETS;
if (!PINETS) { console.log('SKIP engine checks: set PINETS=<path to node_modules/pinets>'); process.exit(fails ? 1 : 0); }
const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-next-patches.js')).href);

const INLINE_SECURITY = `//@version=5
indicator("inline")
f_secReq(_tf, _src) =>
    request.security(syminfo.tickerid, _tf, _src, gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_off)
a = f_secReq("15", high)
b = f_secReq("60", low)
plot(a)
plot(b)`;
const inlined = patches.rewriteSource(INLINE_SECURITY);
check(!/f_secReq\("15"/.test(inlined) && /request\.security\(syminfo\.tickerid, "15", high/.test(inlined) && /request\.security\(syminfo\.tickerid, "60", low/.test(inlined), 'rewriteSource inlines simple request.security wrapper calls');

const bars = Array.from({ length: 600 }, (_, i) => {
  const o = 100 + Math.sin(i / 17) * 5, c = 100 + Math.sin((i + 1) / 17) * 5;
  return { openTime: 1.7e12 + i * 3e5, closeTime: 1.7e12 + (i + 1) * 3e5, open: o, high: Math.max(o, c) + 0.5, low: Math.min(o, c) - 0.5, close: c, volume: 1 };
});
const agg = (mins) => { const out = []; const ms = mins * 6e4; for (const b of bars) { const t = Math.floor(b.openTime / ms) * ms; const l = out[out.length - 1]; if (l && l.openTime === t) { l.high = Math.max(l.high, b.high); l.low = Math.min(l.low, b.low); l.close = b.close; } else out.push({ openTime: t, closeTime: t + ms, open: b.open, high: b.high, low: b.low, close: b.close, volume: 1 }); } return out; };
const src = { getMarketData: async (s, tf) => (tf === '5' ? bars : agg(Number(tf) || 1440)), getSymbolInfo: async () => ({ ticker: 'X', tickerid: 'X', timezone: 'UTC', type: 'crypto' }) };
const run = async (code) => { const r = await new pt.PineTS(src, 'X', '5', bars.length).run(code); return Object.values(r.plots).map((p) => p.data.map((d) => d.value)); };

const TWO_SITES = `//@version=6
indicator("x")
f(string tf) =>
    request.security(syminfo.tickerid, tf, [high[1], low[1]], barmerge.gaps_off, barmerge.lookahead_off)
[a1, b1] = f("15")
[a2, b2] = f("60")
plot(a1)
plot(a2)
plot(b2)`;
const TOP = `//@version=6
indicator("y")
h15 = request.security(syminfo.tickerid, "15", high[1], lookahead = barmerge.lookahead_off)
plot(h15)`;
const TZ = `//@version=5
indicator("z")
d = time("D", "America/New_York")
s = time(timeframe.period, "0300-0500", "UTC")
plot(d)
plot(s)`;

let before = null, err = null;
try { before = await run(TOP); await run(TWO_SITES); } catch (e) { err = e.message; }
check(!!err, 'unpatched pinets fails on a two-call-site function security (' + err + ')');
let tzErr = null; try { await run(TZ); } catch (e) { tzErr = e.message; }
check(/Invalid session/.test(tzErr || ''), 'unpatched pinets fails on time("D", tz) (' + tzErr + ')');

const fmtParts = (F) => JSON.stringify(new F('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false }).formatToParts(new Date(1.7e12)));
const plainParts = fmtParts(Intl.DateTimeFormat);
patches.install(pt.Context, pt, globalThis);
check(fmtParts(Intl.DateTimeFormat) === plainParts && new Intl.DateTimeFormat('en-US') === new Intl.DateTimeFormat('en-US'), 'cached DateTimeFormat: same object, same parts');
check(new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).format(0) === '1/1/1970', 'cached DateTimeFormat.format works');

const two = await run(TWO_SITES);
const top = await run(TOP);
const fin = (a) => a.filter((v) => Number.isFinite(v)).length;
check(two.length >= 3 && fin(two[0]) > 500 && fin(two[1]) > 400 && fin(two[2]) > 400, 'patched: both call sites return values (' + two.slice(0, 3).map(fin).join('/') + ' finite)');
check(JSON.stringify(top) === JSON.stringify(before), 'top-level security (sliced) unchanged by the patch');
// the 15m value from the function must equal the top-level 15m value
check(JSON.stringify(two[0]) === JSON.stringify(top[0]), 'function call site 1 (15) == top-level request.security 15');
const tz = await run(TZ);
check(fin(tz[0]) === bars.length, 'time("D", "America/New_York") runs (tz treated as no session)');
check(fin(tz[1]) > 0 && fin(tz[1]) < bars.length, 'valid session filter still filters (' + fin(tz[1]) + ' bars in 0300-0500)');
check(patches.pruneSlices({ p3: "x $$.id + 'p3' y", p7: "request.param(low, 2, 'p7')" }).p7 && !patches.pruneSlices({ p3: "$$.id + 'p3'" }), 'pruneSlices drops only function-local slices');
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
