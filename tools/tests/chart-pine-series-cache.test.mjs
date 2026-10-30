// node tools/tests/chart-pine-series-cache.test.mjs  (request.security cache: dedupe, parallel, from-base, tail, LRU)
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { SeriesCache, aggregateBars } = await import(pathToFileURL(path.join(here, '..', '..', 'assets', 'chart-pine-series-cache.js')).href);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const M = 6e4, H = 36e5;
const T0 = Math.floor(1.79e12 / (4 * H)) * 4 * H;        // aligned to 4h
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
// deterministic 1m series
const mk = (n) => { const out = []; let p = 100; for (let i = 0; i < n; i++) { const o = p, c = o + (rnd() - .5), h = Math.max(o, c) + rnd() * .3, l = Math.min(o, c) - rnd() * .3; out.push({ time: T0 + i * M, open: o, high: h, low: l, close: c, volume: Math.floor(rnd() * 100) }); p = c; } return out; };
const m1 = mk(60 * 24 * 3);
const toTf = (bars, ms) => { const o = []; let cur = null; for (const b of bars) { const k = Math.floor(b.time / ms) * ms; if (!cur || cur.time !== k) { cur && o.push(cur); cur = { time: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }; } else { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += b.volume; } } cur && o.push(cur); return o; };
const server = { '1': m1, '60': toTf(m1, H), '240': toTf(m1, 4 * H) };
const now = T0 + m1.length * M;
let calls = [], live = 0, peak = 0;
const fetcher = async (sym, tf, r) => { calls.push(sym + '|' + tf); live++; peak = Math.max(peak, live); await new Promise((res) => setTimeout(res, 20)); live--; return (server[tf] || []).filter((b) => b.time >= r.from && b.time <= (r.to || Infinity)); };
const range = { from: T0 + 6 * H, to: now };

// 1. dedupe: 4 scripts x 5 identical calls -> 1 fetch per distinct (sym,tf)
{ calls = []; const c = new SeriesCache({ now: () => now });
  const jobs = []; for (let s = 0; s < 4; s++) for (const tf of ['D', '60', '15', 'W', '60']) jobs.push(c.get('NQ1!', tf, range, fetcher, null));
  const rs = await Promise.all(jobs);
  check(calls.length === 4, '4 scripts x 5 calls (4 distinct tf) -> 4 fetches, got ' + calls.length);
  check(rs[1] === rs[6] || rs[1].length === rs[6].length, 'shared result identical');
  const before = calls.length; await c.get('NQ1!', '60', range, fetcher, null); await c.get('NQ1!', '60', { from: range.from + H, to: now }, fetcher, null);
  check(calls.length === before, 'later re-runs / narrower ranges: 0 extra fetches'); }
// 2. parallel, capped
{ calls = []; peak = 0; const c = new SeriesCache({ now: () => now, maxInflight: 5 });
  const t = Date.now(); await Promise.all(Array.from({ length: 12 }, (_, i) => c.get('SYM' + i, '60', range, fetcher, null)));
  check(peak === 5, 'in flight capped at 5, peak ' + peak); check(Date.now() - t < 12 * 20 * 0.7, '12 fetches run parallel, not serial (' + (Date.now() - t) + ' ms)'); }
// 3. HTF from base equals real HTF
{ calls = []; const c = new SeriesCache({ now: () => now });
  const base = { symbol: 'NQ1!', timeframe: '1', bars: m1 };
  for (const tf of ['60', '240']) {
    const got = await c.get(tf === '240' ? 'BTCUSDT' : 'NQ1!', tf, range, fetcher, tf === '240' ? { ...base, symbol: 'BTCUSDT' } : base);
    const real = server[tf].filter((b) => b.time >= range.from - (tf === '60' ? H : 4 * H) && b.time <= now);
    const gt = got.filter((b) => b.time >= range.from); const rt = real.filter((b) => b.time >= range.from);
    const eq = gt.length === rt.length && gt.every((b, i) => b.time === rt[i].time && b.open === rt[i].open && b.high === rt[i].high && b.low === rt[i].low && b.close === rt[i].close && b.volume === rt[i].volume);
    check(eq && gt.length > 10, tf + ' built from 1m == fetched OHLCV (' + gt.length + ' bars)'); }
  check(calls.length === 0, 'no network used for HTF from base');
  await c.get('NQ1!', '240', range, fetcher, base);
  await c.get('NQ1!', 'D', range, fetcher, base); await c.get('OTHER', '60', range, fetcher, base);
  check(calls.length === 3, 'futures 4h, D and other symbol still go to the network');
  calls = []; await c.get('NQ1!', '60', { from: T0 - 5 * H, to: now }, fetcher, base);
  check(calls.length === 1, 'base does not cover range start -> fetch'); }
// 4. live tail only
{ calls = []; const ranges = []; let t = now; const c = new SeriesCache({ now: () => t });
  const f = async (s, tf, r) => { ranges.push(r); return server['60'].filter((b) => b.time >= r.from && b.time <= r.to); };
  await c.get('NQ1!', '60', { from: range.from, to: t }, f, null);
  t += 2 * H; server['60'].push({ time: Math.floor(now / H) * H + H, open: 1, high: 2, low: 0, close: 1, volume: 1 });
  const r2 = await c.get('NQ1!', '60', { from: range.from, to: t }, f, null);
  check(ranges.length === 2 && ranges[1].from > range.from + 10 * H, 'second ask fetches only the tail (from ' + (ranges[1].from - range.from) / H + 'h after start)');
  check(r2.length > 0 && r2[r2.length - 1].time === server['60'][server['60'].length - 1].time, 'tail merged, newest bar present');
  const times = r2.map((b) => b.time); check(new Set(times).size === times.length, 'no duplicate bars after merge'); }
// 5. LRU memory cap
{ const c = new SeriesCache({ now: () => now, maxBars: 150 });
  for (let i = 0; i < 5; i++) await c.get('S' + i, '1', { from: T0, to: T0 + 60 * M }, fetcher, null);
  server['1'] = m1; check(c._total() <= 150, 'LRU keeps total <= cap (' + c._total() + ')'); }
// 6. errors are not cached
{ const c = new SeriesCache({ now: () => now }); let n = 0;
  const bad = async () => { n++; if (n === 1) throw new Error('x'); return []; };
  let threw = false; try { await c.get('E', '60', range, bad, null); } catch (e) { threw = true; }
  await c.get('E', '60', range, bad, null); check(threw && n === 2, 'failed fetch retried next time'); }
process.exit(fails ? 1 : 0);
