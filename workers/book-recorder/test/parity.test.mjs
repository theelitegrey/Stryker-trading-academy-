// Book recorder unit tests (no network, no browser):
//   node workers/book-recorder/test/parity.test.mjs
// 1. Bucketing parity: for real Binance /depth snapshots (BTCUSDT, ETHUSDT, limit=5000, saved in
//    fixtures/), the Worker (src/bucket.js bucketSnapshot) and the Charts client
//    (assets/chart-orderflow.js domParity -> bookStoreRule + bucketBook) produce the SAME sample:
//    step, i0, mid, best bid / ask and every Float32 row bit-for-bit. Also at shifted prices
//    (step-rule edges) and on a thin book.
// 2. Wire format: Worker encodeSamples -> client decodeBookHistory round-trips exactly; a bad
//    magic or a truncated body decodes to null (the client then falls back silently).
// 3. Merge: recorder + local samples sorted; local wins inside the minute a recorder sample
//    stands for; recorder-only and local-only inputs pass through unchanged.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { bucketSnapshot, encodeSamples, decodeSamples, storeRule } from '../src/bucket.js';
import { validateIngest, alignRange } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..');
// the client module touches window/document only inside functions; give it a bare global
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.document = globalThis.document || { addEventListener() {}, removeEventListener() {}, hidden: false };
const client = await import(pathToFileURL(path.join(root, 'assets', 'chart-orderflow.js')).href);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const load = (n) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(here, 'fixtures', n))).toString());
const same = (a, b) => {
  if (!a || !b) return 'null sample';
  for (const k of ['ts', 'mid', 'bb', 'ba', 'step', 'i0']) if (a[k] !== b[k]) return k + ' ' + a[k] + ' vs ' + b[k];
  if (a.v.length !== b.v.length) return 'rows ' + a.v.length + ' vs ' + b.v.length;
  const x = new Uint32Array(a.v.buffer, a.v.byteOffset, a.v.length), y = new Uint32Array(b.v.buffer, b.v.byteOffset, b.v.length);
  for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return 'row ' + k + ' ' + a.v[k] + ' vs ' + b.v[k];
  return '';
};
// a copy of a snapshot with every price scaled (moves the mid across step-rule edges); the
// rounding creates repeated prices, which also checks both sides treat duplicates the same way
const scaled = (d, f) => ({ bids: d.bids.map(([p, q]) => [String(+(Number(p) * f).toFixed(2)), q]), asks: d.asks.map(([p, q]) => [String(+(Number(p) * f).toFixed(2)), q]) });

// ---- 1. parity ----
const TS = 1791880000000;
for (const name of ['btcusdt-depth.json.gz', 'ethusdt-depth.json.gz']) {
  const d = load(name);
  const w = bucketSnapshot(d, TS), c = client.domParity(d, TS);
  const diff = same(w, c);
  check(!diff, name + ': Worker and client rows identical (' + (w && w.v.length) + ' rows, step ' + (w && w.step) + ', mid ' + (w && w.mid) + ')' + (diff ? ' -- ' + diff : ''));
  const lo = w.i0 * w.step, hi = (w.i0 + w.v.length) * w.step;
  check((w.mid - lo) / w.mid > 0.009 && (hi - w.mid) / w.mid > 0.009, name + ': rows span ' + ((w.mid - lo) / w.mid * 100).toFixed(2) + '% below / ' + ((hi - w.mid) / w.mid * 100).toFixed(2) + '% above the mid (band +-2%, book depth permitting)');
  check(Math.abs(w.step / (w.mid * 0.0005) - 0.75) <= 0.26, name + ': row = nice step at or below 0.05% of the price (' + w.step + ' at ' + w.mid.toFixed(2) + ')');
  let bad = [];
  for (const f of [0.31, 0.5, 0.6, 0.999, 1.2, 1.5, 2.4, 3.3, 7.77, 12.5]) { const e = scaled(d, f); const r = same(bucketSnapshot(e, TS), client.domParity(e, TS)); if (r) bad.push(f + ': ' + r); }
  check(!bad.length, name + ': parity at 10 shifted price levels (step-rule edges)' + (bad.length ? ' -- ' + bad.join('; ') : ''));
}
const thin = { bids: [['100.00', '1.5'], ['99.50', '2']], asks: [['100.10', '3'], ['101.90', '0.25']] };
check(!same(bucketSnapshot(thin, TS), client.domParity(thin, TS)), 'thin 2-level book: identical');
check(bucketSnapshot({ bids: [], asks: [] }, TS) === null && client.domParity({ bids: [], asks: [] }, TS) === null, 'empty book: both null');
check(storeRule(83631.1).step === 25 && storeRule(2514.2).step === 1, 'step rule: BTC 83.6k -> $25, ETH 2.5k -> $1');

// ---- 1b. the server feeder (feeder/feeder.py, Python stdlib) encodes byte-identical samples ----
for (const name of ['btcusdt-depth.json.gz', 'ethusdt-depth.json.gz']) {
  const hex = execFileSync('python3', [path.join(here, '..', 'feeder', 'feeder.py'), '--bucket', path.join(here, 'fixtures', name), String(TS)]).toString().trim();
  const py = Buffer.from(hex, 'hex');
  const js = Buffer.from(encodeSamples([client.domParity(load(name), TS)]));
  check(py.equals(js), name + ': feeder.py bytes == client bucketBook bytes (' + py.length + ' B)');
}

// ---- 1c. /ingest validation ----
{
  const ok = bucketSnapshot(load('btcusdt-depth.json.gz'), TS), okE = bucketSnapshot(load('ethusdt-depth.json.gz'), TS);
  const A = ['BTCUSDT', 'ETHUSDT'];
  const v = (syms, list, now) => validateIngest(syms, list, A, now == null ? TS + 1000 : now);
  check(v(['BTCUSDT', 'ETHUSDT'], [ok, okE]) === '', 'ingest: a real 2-symbol sample is accepted');
  check(v(['BTCUSDT'], [ok], TS + 10 * 60000) !== '', 'ingest: 10-min-old sample refused (freshness)');
  check(v(['DOGEUSDT'], [ok]) !== '', 'ingest: unrecorded symbol refused');
  check(v(['BTCUSDT', 'BTCUSDT'], [ok, ok]) !== '', 'ingest: duplicate symbol refused');
  check(v(['BTCUSDT'], [Object.assign({}, ok, { step: 10 })]) !== '', 'ingest: wrong step refused');
  check(v(['BTCUSDT'], [Object.assign({}, ok, { v: new Float32Array(2000) })]) !== '', 'ingest: oversized rows refused');
  check(v(['BTCUSDT'], [Object.assign({}, ok, { i0: ok.i0 - 200 })]) !== '', 'ingest: rows outside +-2% refused');
  check(v(['BTCUSDT'], [Object.assign({}, ok, { v: Float32Array.from([1, NaN]) })]) !== '', 'ingest: NaN row refused');
  check(v(['BTCUSDT'], null) !== '' && v(['BTCUSDT', 'ETHUSDT'], [ok]) !== '', 'ingest: bad body / count mismatch refused');
}

// ---- 2. wire format ----
const list = ['btcusdt-depth.json.gz', 'ethusdt-depth.json.gz'].map((n, k) => bucketSnapshot(load(n), TS + k * 60000));
const buf = encodeSamples(list);
const dec = client.decodeBookHistory(buf);
check(dec && dec.length === 2 && !same(dec[0], list[0]) && !same(dec[1], list[1]), 'encode (Worker) -> decode (client) round-trips exactly, ' + buf.byteLength + ' B for 2 samples');
check(dec && dec.every((s) => s.span === 60000 && s.remote === true), 'decoded recorder samples stand for 1 min each and are marked remote');
check(decodeSamples(buf).length === 2, 'Worker decodeSamples reads its own format');
const bad = buf.slice(0); new DataView(bad).setUint8(0, 0);
check(client.decodeBookHistory(bad) === null, 'bad magic -> null (client falls back)');
check(client.decodeBookHistory(buf.slice(0, buf.byteLength - 3)) === null, 'truncated body -> null (client falls back)');
check(client.decodeBookHistory(new ArrayBuffer(0)) === null && client.decodeBookHistory(null) === null, 'empty body -> null');
check(client.decodeBookHistory(encodeSamples([])).length === 0, 'zero samples decodes to []');

// ---- 3. merge ----
const M = 60000, T0 = TS;
const R = (t) => ({ ts: t, span: M, remote: true, v: new Float32Array(1) });
const L = (t) => ({ ts: t, v: new Float32Array(1) });
const remote = [0, 1, 2, 3, 4, 5].map((k) => R(T0 + k * M));
const local = [];
for (let t = T0 + 3 * M + 10000; t <= T0 + 4 * M + 50000; t += 1000) local.push(L(t)); // local from 3:10 to 4:50
const m = client.mergeBookHistory(remote, local);
const sorted = m.every((s, k) => k === 0 || s.ts >= m[k - 1].ts);
const rTs = m.filter((s) => s.remote).map((s) => (s.ts - T0) / M);
check(sorted, 'merged history sorted by time (' + m.length + ' samples)');
check(JSON.stringify(rTs) === '[0,1,2,5]', 'local wins where it overlaps: recorder minutes kept ' + JSON.stringify(rTs) + ' (3 and 4 dropped, local covers them)');
check(m.filter((s) => !s.remote).length === local.length, 'every local sample kept');
check(client.mergeBookHistory([], local) === local && client.mergeBookHistory(remote, []) === remote && client.mergeBookHistory(null, local) === local, 'one side empty -> the other unchanged');
// local sample 4 s before a recorder minute also wins (clock skew between page and recorder)
const m2 = client.mergeBookHistory([R(T0)], [L(T0 - 4000)]);
check(m2.length === 1 && !m2[0].remote, 'local sample 4 s before a recorder sample replaces it');
const m3 = client.mergeBookHistory([R(T0)], [L(T0 - 30000)]);
check(m3.length === 2, 'local sample 30 s before does not replace it');

// ---- 4. /book-history range alignment (cache-miss abuse) ----
{
  const Q = 15 * 60000, now = Date.parse('2026-10-13T12:07:31Z');
  const froms = [];
  for (let k = 0; k < 15; k++) froms.push(alignRange(Date.parse('2026-10-13T06:00:00Z') + k * 60000 + 1234, now, now).from);
  check(new Set(froms).size === 1 && froms[0] === Date.parse('2026-10-13T06:00:00Z'), 'Worker: 15 different from= minutes in one quarter-hour -> one aligned from (' + new Date(froms[0]).toISOString() + ')');
  const r = alignRange(Date.parse('2026-10-13T06:14:59Z'), now, now);
  check(r.from % Q === 0 && r.from === Date.parse('2026-10-13T06:00:00Z'), 'Worker: from aligned DOWN to 15 min');
  check(r.to === Date.parse('2026-10-13T12:08:00Z'), 'Worker: to = the current minute, rounded up');
  const old = alignRange(now - 3 * 86400000, null, now);
  check(old.from === Math.floor((now - 86400000) / 60000) * 60000, 'Worker: from older than 24 h clamped to the keep window');
  check(alignRange(null, null, now).to > alignRange(null, null, now).from, 'Worker: no query -> a valid 24 h range');
  // the client asks with the same 15-min grid, so the Worker leaves a client from unchanged
  const cf = Math.floor(Date.parse('2026-10-13T09:41:00Z') / Q) * Q;
  check(alignRange(cf, now, now).from === cf, 'Worker keeps the client\'s 15-min-aligned from as it is');
}

// ---- storage maths (printed for the README) ----
for (const s of list) {
  const perDay = 1440, row = s.v.length * 4 + 60; // BLOB + key, numbers, SQLite row overhead
  console.log('INFO ' + (s.mid > 10000 ? 'BTCUSDT' : 'ETHUSDT') + ': ' + s.v.length + ' rows x 4 B = ' + s.v.length * 4 + ' B/sample; 24 h = ' + perDay + ' samples ~ ' + Math.round(perDay * row / 1024) + ' KB');
}
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
