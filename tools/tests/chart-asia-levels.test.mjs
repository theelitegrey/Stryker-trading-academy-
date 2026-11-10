// BUG-ASIA (member GK, 2026-11-10): the 15m and 1m charts showed two different Asia High/Low.
// Cause: the session scripts took "the session so far" from the FIRST bar they were given, so when the
// loaded data began inside the Asia session (a 1m chart has few bars loaded) they drew that PARTIAL
// high/low as if it were the whole session. Fix: a session that starts on the first bar is not drawn.
//   PINETS=<node_modules/pinets> node tools/tests/chart-asia-levels.test.mjs      (default: ./node_modules/pinets)
// Same NQ-like 1m data, aggregated to 5m and 15m, across the US DST change (Sun 2026-11-01), run in
// browser timezones Asia/Kolkata, UTC and America/New_York (child processes): every Asia High/Low the
// Liquidity Master draws must be a true 20:00-00:00 New York value, and 1m = 5m = 15m.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const PINETS = process.env.PINETS || path.join(root, 'node_modules', 'pinets');
if (!process.env.ASIA_CHILD) {
  let bad = 0;
  for (const tz of ['Asia/Kolkata', 'UTC', 'America/New_York']) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, ASIA_CHILD: '1', TZ: tz }, stdio: 'inherit' });
    if (r.status) bad++;
  }
  console.log(bad ? 'FAILED' : 'ALL PASS'); process.exit(bad ? 1 : 0);
}
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + `[${process.env.TZ}] ` + msg); if (!ok) fails++; };
const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-next-patches.js')).href);
patches.install(pt.Context, pt, globalThis);
const FUT = { ticker: 'NQ1!', tickerid: 'CME_MINI:NQ1!', timezone: 'America/New_York', session: '1800-1700', type: 'futures', mintick: 0.25 };
const nyf = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
const ny = (t) => { const p = nyf.formatToParts(t), g = (k) => p.find((x) => x.type === k).value; return { wd: g('weekday'), m: +g('hour') * 60 + +g('minute') }; };
function gen(a, b) { // 1m bars on the CME schedule (Sun 18:00 - Fri 17:00 NY, 17:00-18:00 closed)
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; let p = 27000; const out = [];
  for (let t = a; t < b; t += 60000) {
    const { wd, m } = ny(t);
    if (wd === 'Sat' || (wd === 'Fri' && m >= 1020) || (wd === 'Sun' && m < 1080) || (m >= 1020 && m < 1080)) continue;
    const o = p; p += (rnd() - 0.49) * 6;
    out.push({ openTime: t, closeTime: t + 60000, open: o, high: Math.max(o, p) + rnd() * 3, low: Math.min(o, p) - rnd() * 3, close: p, volume: 100 });
  }
  return out;
}
function agg(b, tf) {
  const ms = tf * 60000, out = [];
  for (const x of b) { const k = Math.floor(x.openTime / ms) * ms, l = out[out.length - 1]; if (l && l.openTime === k) { l.high = Math.max(l.high, x.high); l.low = Math.min(l.low, x.low); l.close = x.close; l.volume += x.volume; } else out.push({ ...x, openTime: k, closeTime: k + ms }); }
  return out;
}
const code = fs.readFileSync(path.join(root, 'assets', 'pine', 'liquidity-master-tradezoro.pine'), 'utf8');
async function asiaLevels(bars, tf) {
  const src = { getMarketData: async () => bars, getSymbolInfo: async () => FUT };
  const r = await new pt.PineTS(src, 'NQ1!', String(tf), bars.length).run(patches.rewriteSource(code));
  const lb = (r.plots.__labels__ && r.plots.__labels__.data[0] && r.plots.__labels__.data[0].value) || [];
  return lb.filter((l) => l && !l._deleted && /Asia (High|Low)/.test(l.text)).map((l) => +l.y.toFixed(4)).sort((a, b) => a - b);
}
const truthOf = (bars) => { // true Asia 20:00-00:00 NY per night, from the 1m bars
  const m = new Map();
  for (const b of bars) { const { m: mm } = ny(b.openTime); if (mm < 1200) continue; const k = Math.floor((b.openTime - 5 * 3600000) / 864e5); const e = m.get(k) || { h: -1e9, l: 1e9 }; e.h = Math.max(e.h, b.high); e.l = Math.min(e.l, b.low); m.set(k, e); }
  return m;
};
const all = gen(Date.UTC(2026, 9, 29, 22), Date.UTC(2026, 10, 3, 12));
const truth = truthOf(all); const tv = [...truth.values()].flatMap((e) => [+e.h.toFixed(4), +e.l.toFixed(4)]);
check(truth.size === 3, 'fixture has 3 Asia nights, one after the DST change (Nov 1)');
const got = {};
for (const [tf, b] of [[1, all], [5, agg(all, 5)], [15, agg(all, 15)]]) got[tf] = await asiaLevels(b, tf);
for (const tf of [1, 5, 15]) check(got[tf].length >= 4 && got[tf].every((y) => tv.some((t) => Math.abs(t - y) < 1e-3)), `${tf}m: every Asia level is a true 20:00-00:00 NY high/low (${got[tf].length} drawn)`);
check(JSON.stringify(got[1]) === JSON.stringify(got[5]) && JSON.stringify(got[5]) === JSON.stringify(got[15]), '1m = 5m = 15m: identical Asia levels');
// data that STARTS inside the Asia session (a short 1m load): that night must not be drawn at all
const startMid = all.filter((b) => b.openTime >= Date.UTC(2026, 10, 2, 3, 0)); // Nov 1 22:00 NY: 2 h into the Nov 1 Asia night
for (const tf of [1, 15]) {
  const y = await asiaLevels(tf === 1 ? startMid : agg(startMid, 15), tf);
  check(y.every((v) => tv.some((t) => Math.abs(t - v) < 1e-3)), `${tf}m from mid-session: no partial Asia level drawn (${y.length} drawn, all true)`);
}
process.exit(fails ? 1 : 0);
