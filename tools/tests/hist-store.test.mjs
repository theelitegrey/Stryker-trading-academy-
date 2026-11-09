// DEEP HISTORY store + HISTORY GAP 2 fix, node tests. node tools/tests/hist-store.test.mjs
// 1) workers/book-recorder/src/hist-store.js: ingest validation, 1m -> 5m/15m/30m aggregation, the 10-minute cut, read limits.
// 2) functions/api/chart/_bars.js fetchPage with the flag on: old pages come from our store, young pages from the old source,
//    a page the store does not hold falls back; flag off = untouched. Constants equal on server and page.
// 3) assets/chart-tick-engine.js teGetBars (the 08 Nov bug): every scroll-back read older than the record start returns OLDER bars
//    (the memo was keyed by the record start alone and handed back the first chunk -> 'genesis'), and a short first window (weekend)
//    reaches back to the record start before the old source is asked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };

const H = await import(ROOT + '/workers/book-recorder/src/hist-store.js');
{
  const st = H.histMemory(), day = '2025-11-04', t0 = Date.UTC(2025, 10, 4) / 1000;
  const rows = []; for (let i = 0; i < 30; i++) rows.push([t0 + 3600 + i * 60, 100 + i, 101 + i, 99 + i, 100.5 + i, 10, 6, 3]);
  assert.deepEqual(H.histIngest(st, { sym: 'NQ', day, rows }), { ok: true, n: 30 });
  assert.equal(H.histIngest(st, { sym: 'XX', day, rows }).error, 'unknown symbol');
  assert.equal(H.histIngest(st, { sym: 'NQ', day: '2025-11-05', rows }).error, 'row outside the day');
  assert.equal(H.histIngest(st, { sym: 'NQ', day, rows: [[t0, 100, 99, 101, 100, 1]] }).error, 'bad prices');   // high < low
  assert.equal(H.histIngest(st, { sym: 'NQ', day, rows: [[t0 + 30, 100, 101, 99, 100, 1]] }).error, 'row outside the day');   // not a whole minute
  const b5 = H.histBars(st, 'NQ', '5', t0, t0 + 86400, t0 + 86400 * 400);
  assert.equal(b5.length, 6);
  assert.deepEqual(b5[0], [t0 + 3600, 100, 105, 99, 104.5, 50]);
  const b30 = H.histBars(st, 'NQ', '30', t0, t0 + 86400, t0 + 86400 * 400);
  assert.deepEqual(b30, [[t0 + 3600, 100, 130, 99, 129.5, 300]]);
  // the 10-minute cut: "now" 15 min after the first bar -> only the minutes up to now - 10 min
  assert.equal(H.histBars(st, 'NQ', '1', t0, t0 + 86400, t0 + 3600 + 15 * 60).length, 6);
  assert.equal(H.histBars(st, 'NQ', '1', t0, t0 + 50 * 86400), null);   // a read over 40 days is refused
  // re-ingest replaces the day (top-up): fewer rows, no leftovers
  H.histIngest(st, { sym: 'NQ', day, rows: rows.slice(0, 5) });
  assert.equal(H.histBars(st, 'NQ', '1', t0, t0 + 86400, t0 + 86400 * 400).length, 5);
  ok('store: ingest validation, aggregation 1m -> 5m/30m, 10-minute cut, read cap, a day upload replaces the day');
}

const B = await import(ROOT + '/functions/api/chart/_bars.js');
{
  const now = Math.floor(Date.now() / 1000), calls = [];
  const fake = async (u) => {
    calls.push(String(u));
    if (String(u).includes('/hist-bars')) {
      const q = new URL(u).searchParams, f = +q.get('from'), step = +q.get('tf') * 60;
      if (f < now - 300 * 86400) return new Response(JSON.stringify({ bars: [] }));   // the store has nothing that old
      return new Response(JSON.stringify({ bars: [[Math.ceil(f / step) * step, 1.111, 2, 0.5, 1.5, 7]] }));
    }
    return new Response(JSON.stringify({ chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } }));
  };
  const pageAt = (tf, ago) => B.pageOf(tf, now - ago);
  // flag off: an old 1m page is out of range for the old source, the store is never asked
  await assert.rejects(B.fetchPage('NQ', '1', pageAt('1', 100 * 86400), now, fake), B.OutOfRange);
  assert.equal(calls.filter((c) => c.includes('/hist-bars')).length, 0);
  B._setDeepForTests(true);
  const r = await B.fetchPage('NQ', '5', pageAt('5', 200 * 86400), now, fake);
  assert.equal(r.length, 1); assert.equal(r[0][1], 1.11);   // rounded to the contract's decimals
  assert.ok(calls.at(-1).includes('/hist-bars?sym=NQ&tf=5'));
  // older than what the store holds (but inside 366 d): [] (scroll-back keeps walking), older than 366 d: OutOfRange
  assert.deepEqual(await B.fetchPage('NQ', '1', pageAt('1', 330 * 86400), now, fake), []);
  await assert.rejects(B.fetchPage('NQ', '1', pageAt('1', 380 * 86400), now, fake), B.OutOfRange);
  // a young page (inside 2 days) never asks the store; a symbol not in DEEP_SYMS never asks the store
  const before = calls.length;
  await B.fetchPage('NQ', '1', pageAt('1', 3600), now, fake);
  await assert.rejects(B.fetchPage('CL', '1', pageAt('1', 100 * 86400), now, fake), B.OutOfRange);
  assert.equal(calls.slice(before).filter((c) => c.includes('/hist-bars')).length, 0);
  B._setDeepForTests(false);
  ok('bars source: flag off untouched; on = old pages from our store (decimals), young pages + other symbols untouched, 366 d end');
}
{
  const src = fs.readFileSync(ROOT + '/assets/chart-futures-provider.js', 'utf8'), bs = fs.readFileSync(ROOT + '/functions/api/chart/_bars.js', 'utf8');
  const arr = (s, name) => JSON.parse(new RegExp('export const ' + name + ' = (\\[[^\\]]*\\])').exec(s)[1].replace(/'/g, '"'));
  assert.deepEqual(arr(src, 'DEEP_ROOTS'), arr(bs, 'DEEP_SYMS'));
  assert.equal(+/DEEP_DEPTH_DAYS = (\d+)/.exec(src)[1] * 86400, 366 * 86400);
  assert.ok(/DEEP_DEPTH_S = 366 \* D/.test(bs));
  assert.equal(/export const DEEP_HISTORY = (\w+)/.exec(src)[1], /export let DEEP_HISTORY = (\w+)/.exec(bs)[1], 'page and server switch agree');
  const ui = fs.readFileSync(ROOT + '/workers/book-recorder/src/hist-store.js', 'utf8') + fs.readFileSync(ROOT + '/assets/chart-history-pager.js', 'utf8');
  assert.ok(!/tick-?stream|insight/i.test(ui.replace(/\/\/.*$/gm, '')), 'no vendor name in code paths');
  ok('page and server DEEP constants equal; no vendor name in the new code');
}

// ---- 3) the tick-engine scroll-back (fixture record from REC, old source 60 days)
{
  const MIN = 60000, now = Date.now(), REC = Math.floor((now - 5 * 864e5) / MIN) * MIN;
  for (const [tf, weekendH] of [['1', 0], ['5', 0], ['1', 40], ['15', 40]]) {
    const ms = +tf * MIN, recB = Math.ceil(REC / ms) * ms, endRec = now - weekendH * 3600000;
    const all = []; for (let t = Math.floor((now - 60 * 864e5) / ms) * ms; t < now; t += ms) all.push(t);
    globalThis.fetch = async (u) => {
      const q = new URL(u).searchParams, from = +q.get('from'), to = +q.get('to');
      const b = all.filter((t) => t >= Math.max(from, recB) && t < to && t < endRec).map((t) => [t, 2, 2, 2, 2, 1]);
      return { ok: true, headers: { get: () => 'live' }, json: async () => ({ b, rec: recB, e: 1, q: 5, more: 0 }) };
    };
    const { teGetBars } = await import(ROOT + '/assets/chart-tick-engine.js?t=' + tf + weekendH);
    const old = async (r) => { let x = all.filter((t) => t <= r.to && (r.from == null || t >= r.from)).map((t) => ({ time: t, volume: 0 })); if (r.limit != null) x = x.slice(-r.limit); return x; };
    let bars = await teGetBars('NQ', tf, { to: now, limit: 500 }, old);
    if (weekendH) assert.ok(bars.filter((b) => b.volume === 1).length > 100, tf + 'm weekend: the record bars before the quiet hours are on the first load');
    for (let i = 0; i < 6 && bars[0].time > REC - 2 * 864e5; i++) {
      const oldest = bars[0].time, head = (await teGetBars('NQ', tf, { to: oldest, limit: 1501 }, old)).filter((b) => b.time < oldest);
      assert.ok(head.length > 0, tf + 'm: scroll-back read ' + i + ' returned older bars (genesis = the 08 Nov bug)');
      for (let k = 1; k < head.length; k++) assert.ok(head[k].time > head[k - 1].time);
      bars = head.concat(bars);
    }
    assert.ok(bars[0].time < REC - 864e5, tf + 'm: reached more than a day before the record start');
  }
  ok('tick engine: every scroll-back read past the record start returns older bars (1m, 5m, 15m; weekday + weekend)');
}
console.log('ALL', n, 'PASS');
