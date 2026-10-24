// Live order flow for admins ("deep data speed" a1, CoS GO 2026-10-24).
//   node tools/tests/chart-live-of.test.mjs
// 1. Bridge (functions/api/chart/stream/[sym].js, recorder hub faked as in chart-stream-ticks.test.mjs):
//    of=1 passes every tick-leg print WITH its side as {event:'trades'} at most every ~250 ms, no extra hub
//    leg; without of=1 (or for a root other than NQ/ES) nothing extra is sent.
// 2. Parity on the REAL InsightSentry fixture (workers/book-recorder/test/fixtures/nq-trades-20261013-12utc.json.gz,
//    9,826 NQ prints, 1 h): the prints fed to assets/chart-live-of.js in random batches (as the socket delivers
//    them) give, minute by minute, the SAME footprint (every price row buy/sell), open/close, delta, running
//    delta high/low, print count and big trades as the server feeder's Python codec (of_feeder.py --dry-run,
//    decoded with assets/chart-footprint-data.js decodeOrderflow). Then: duplicates (a reconnect replay) are
//    ignored, a minute seen only in part never replaces the recorder's, the more complete copy wins, and the
//    5-minute re-aggregation of the overlay equals the recorder's.
// 3. Flag: off by default; localStorage 'stk_live_of' = '1' turns it on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 1. bridge
let up = null, isOpened = 0;
globalThis.WebSocket = class { constructor() { isOpened++; } };
class HubSock { constructor() { this.l = {}; } accept() {} addEventListener(e, f) { (this.l[e] = this.l[e] || []).push(f); } onmessage(ev) { for (const f of this.l.message || []) f(ev); } close() { this.closed = true; } send() {} }
const out = [];
globalThis.WebSocketPair = class { constructor() { const server = { accept() {}, send: (m) => out.push(JSON.parse(m)), close() {}, addEventListener() {} }; this[0] = {}; this[1] = server; } };
const OrigResponse = globalThis.Response;
globalThis.Response = class extends OrigResponse { constructor(body, init = {}) { super(body, init.status === 101 ? { status: 200 } : init); } };
const { onRequestGet } = await import(ROOT + '/functions/api/chart/stream/[sym].js');
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256' };
const b64u = (b) => Buffer.from(b).toString('base64url');
const hh = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })), pp = b64u(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'uid-admin', iat: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 3600 }));
const TOKEN = hh + '.' + pp + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(hh + '.' + pp)));
globalThis.fetch = async (u) => {
  if (String(u).includes('securetoken@system')) return new OrigResponse(JSON.stringify({ keys: [jwk] }));
  if (String(u).includes('/is-live')) { up = new HubSock(); up.legs = decodeURIComponent(new URL(String(u)).searchParams.get('legs')).split(';'); return { status: 101, webSocket: up }; }
  return new OrigResponse('{}');
};
const req = (sym, q) => onRequestGet({ request: new Request('https://tradezoro.com/api/chart/stream/' + sym + '?' + q, { headers: { upgrade: 'websocket', origin: 'https://tradezoro.com', 'sec-websocket-protocol': 'tz-auth, ' + TOKEN } }), params: { sym }, env: { INSIGHTSENTRY_WEBSOCKET_API_KEY: 'k' } });

const RAW = JSON.parse(zlib.gunzipSync(fs.readFileSync(ROOT + '/workers/book-recorder/test/fixtures/nq-trades-20261013-12utc.json.gz'))).series;
{
  await req('NQ', 'tf=1&ticks=1&of=1');
  await sleep(5);
  assert.deepEqual(up.legs, ['CME_MINI:NQ1!|minute|1', 'CME_MINI:NQ1!|tick|1']);
  ok('of=1 adds no hub leg (reuses the tick leg)');
  out.length = 0;
  const t0 = Date.now(), N = 1200;
  for (let i = 0; i < N; i += 10) {
    up.onmessage({ data: JSON.stringify({ code: 'CME_MINI:NQ1!', bar_type: '1T', series: RAW.slice(i, i + 10) }) });
    await sleep(10);
  }
  await sleep(350);
  const secs = (Date.now() - t0) / 1000;
  const tm = out.filter((m) => m.event === 'trades');
  const rows = tm.flatMap((m) => m.tr);
  assert.equal(rows.length, N, 'every print passed on');
  assert.ok(tm.length <= Math.ceil(secs / 0.25) + 2, `<= ~4 trades messages/s (${tm.length} in ${secs.toFixed(1)} s)`);
  assert.ok(tm.length >= 2);
  for (let i = 0; i < N; i++) {
    const x = RAW[i], r = rows[i];
    assert.equal(r[0], Math.round(x.time * 1e6) / 1e6); assert.equal(r[1], x.close); assert.equal(r[2], x.volume);
    assert.equal(r[3], x.type === 'buy' ? 1 : x.type === 'sell' ? 0 : -1);
  }
  ok(`${N} real prints passed on with time/price/size/side, in ${tm.length} messages over ${secs.toFixed(1)} s`);
  assert.ok(out.some((m) => m.event === 'bar'), 'the candle still moves');
  ok('candle updates unchanged next to the trades messages');
  out.length = 0;
  await req('NQ', 'tf=1&ticks=1');
  await sleep(5);
  up.onmessage({ data: JSON.stringify({ code: 'CME_MINI:NQ1!', bar_type: '1T', series: RAW.slice(0, 50) }) });
  await sleep(350);
  assert.equal(out.filter((m) => m.event === 'trades').length, 0);
  ok('without of=1 no trades messages (today\'s behaviour)');
  await req('GC', 'tf=1&ticks=1&of=1');
  await sleep(5);
  out.length = 0;
  up.onmessage({ data: JSON.stringify({ code: 'COMEX:GC1!', bar_type: '1T', series: [{ time: Date.now() / 1000, close: 4000, volume: 1, type: 'buy' }] }) });
  await sleep(350);
  assert.equal(out.filter((m) => m.event === 'trades').length, 0);
  ok('of=1 on a root other than NQ/ES sends nothing extra');
}

// ---------------------------------------------------------------- 2. parity with the server codec
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const L = await import(ROOT + '/assets/chart-live-of.js');
const { decodeOrderflow, aggregate } = await import(ROOT + '/assets/chart-footprint-data.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liveof-'));
const bin = path.join(tmp, 'nq.bin');
const dry = JSON.parse(execFileSync('python3', [ROOT + '/workers/book-recorder/of-feeder/of_feeder.py', '--dry-run', ROOT + '/workers/book-recorder/test/fixtures/nq-trades-20261013-12utc.json.gz', 'NQ', bin]).toString().trim().split('\n').pop());
const rec = decodeOrderflow(new Uint8Array(fs.readFileSync(bin)));
fs.rmSync(tmp, { recursive: true, force: true });
{
  const f = new L.LiveFlow('NQ', rec.header.thr, 120);
  // random batches, like socket messages (seeded: reproducible)
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const rows = RAW.map((x) => [x.time, x.close, x.volume, x.type === 'buy' ? 1 : x.type === 'sell' ? 0 : -1]);
  for (let i = 0; i < rows.length;) { const k = 1 + Math.floor(rnd() * 60); f.add(rows.slice(i, i + k)); i += k; }
  f.flushGroup();
  const live = f.list();
  assert.equal(live.length, rec.bars.length, 'same minutes');
  let rowsChecked = 0, bigs = 0;
  for (let k = 0; k < live.length; k++) {
    const a = live[k], b = rec.bars[k];
    const tag = new Date(b.t).toISOString().slice(11, 16);
    for (const key of ['t', 'lo', 'hi', 'o', 'c', 'vol', 'delta', 'dmax', 'dmin', 'trades']) assert.equal(a[key], b[key], tag + ' ' + key);
    assert.deepEqual([...a.buy], [...b.buy], tag + ' buy rows'); assert.deepEqual([...a.sell], [...b.sell], tag + ' sell rows');
    assert.deepEqual(a.bigs, b.bigs, tag + ' big trades');
    rowsChecked += a.buy.length; bigs += a.bigs.length;
  }
  assert.equal(f.prints, dry.prints);
  ok(`real NQ hour: ${live.length} minutes, ${rowsChecked} price rows, ${bigs} big trades (>= ${rec.header.thr}) identical to the feeder's codec (${dry.prints} prints)`);

  // a reconnect replays prints already held: ignored
  const before = JSON.stringify(f.list().map((b) => [b.t, b.vol, b.delta, b.trades]));
  assert.equal(f.add(rows.slice(-3000)), 0);
  assert.equal(JSON.stringify(f.list().map((b) => [b.t, b.vol, b.delta, b.trades])), before);
  ok('replayed (already seen) prints are skipped: no double counting');
  const g = new L.LiveFlow('NQ', 19);
  g.add(RAW.map((x) => [x.time, x.close, x.volume, x.type === 'buy' ? 1 : 0]));
  assert.ok(g.list().length <= 31);
  ok('only the newest ~30 minutes are kept in memory (default)');
}
{
  // browser joins mid-hour: the first minute is partial and never replaces the recorder's
  const f = new L.LiveFlow('NQ', rec.header.thr, 120);
  const rows = RAW.map((x) => [x.time, x.close, x.volume, x.type === 'buy' ? 1 : x.type === 'sell' ? 0 : -1]);
  const start = rows.findIndex((r) => r[0] >= RAW[0].time + 30 * 60 + 20);   // 20 s into minute 30
  f.add(rows.slice(start));
  const live = f.list();
  assert.ok(live[0].partial && !live[1].partial);
  // recorder copy "lags": its last 2 minutes are missing, its minute before has fewer prints (still forming)
  const recBars = rec.bars.slice(0, -2).map((b, i, a) => (i === a.length - 1 ? Object.assign({}, b, { trades: b.trades - 5 }) : b));
  const merged = L.overlayLive(recBars, live, rec.bars[0].t, rec.bars[rec.bars.length - 1].t);
  assert.equal(merged.length, rec.bars.length);
  const m30 = merged.find((b) => b.t === live[0].t);
  assert.ok(!m30.live, 'partial live minute did not replace the recorder');
  assert.ok(merged[merged.length - 1].live && merged[merged.length - 2].live && merged[merged.length - 3].live, 'newest minutes from live');
  assert.ok(!merged[merged.length - 4].live, 'equal copies keep the recorder\'s');
  ok('partial first minute keeps the recorder copy; newer / more complete live minutes win; ties keep the recorder');
  const a5 = aggregate(merged, 300000), r5 = aggregate(rec.bars, 300000);
  assert.equal(a5.length, r5.length);
  for (let k = 0; k < a5.length; k++) for (const key of ['t', 'lo', 'hi', 'o', 'c', 'vol', 'delta', 'dmax', 'dmin', 'trades']) assert.equal(a5[k][key], r5[k][key], '5m ' + k + ' ' + key);
  ok(`5-minute re-aggregation of the overlay equals the recorder's (${a5.length} bars)`);
}
{
  assert.equal(L.LIVE_OF_DEFAULT, false);
  assert.equal(L.liveOfOn(), false);
  ok('flag is OFF by default (ships dark)');
  localStorage.setItem('stk_live_of', '1');
  assert.equal(L.liveOfOn(), true);
  assert.equal(L.pushLiveTrades('NQ', [[Date.now() / 1000, 30000, 2, 1]]), 1);
  assert.equal(L.pushLiveTrades('GC', [[Date.now() / 1000, 4000, 2, 1]]), 0);
  assert.ok(L.liveFlow('NQ') && !L.liveFlow('GC'));
  ok('localStorage stk_live_of=1 turns it on; NQ/ES only');
  localStorage.setItem('stk_live_of', '0');
  assert.equal(L.liveOfOn(), false);
  ok('stk_live_of=0 turns it off again');
}
console.log(`\n${n} checks passed`);
assert.equal(isOpened, 0);
process.exit(0);
