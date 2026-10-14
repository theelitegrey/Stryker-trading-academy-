// Market scanner ingest validation (src/scan.js) + the routes on a real BookRecorder when node:sqlite
// exists. CI runs it (the route part is skipped without node:sqlite).
//   node workers/book-recorder/test/scan.test.mjs
import { gzipSync, gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { validateScan, validateScanPart, SCAN_COLS } from '../src/scan.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };
const now = Math.floor(Date.now() / 1000);
const row = (s, chg) => [s, 'Name ' + s, 10.5, chg, 1e6, 2.1, 1.2, 55.5, 12, 8, 3e9, 20.1, 'Tech', 1.1, 5.5];
export const presets = (o) => Object.assign({ v: 1, t: now - 30, cols: SCAN_COLS, presets: { gainers: { title: 'Top gainers', kind: 'stock', rows: [row('NASDAQ:AAA', 9), row('NYSE:BBB', 5)] } } }, o || {});
export const table = (o) => {
  const rows = [row('NASDAQ:AAA', 9), row('NYSE:BBB', 5), row('NYSE:CCC', -3)];
  const d = {}; SCAN_COLS.forEach((c, i) => { d[c] = rows.map((r) => r[i]); });
  return Object.assign({ v: 1, t: now - 30, cols: SCAN_COLS, n: rows.length, d }, o || {});
};
const gz = (x) => { const b = gzipSync(JSON.stringify(x)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

ok(validateScanPart('presets', presets(), now) === '', 'presets valid');
ok(validateScanPart('stock', table(), now) === '', 'table valid');
ok(validateScanPart('bonds', table(), now) === 'bad part', 'unknown part');
ok(validateScanPart('stock', table({ t: now - 3600 }), now) === 'stale or future t', 'stale rejected');
ok(validateScanPart('stock', table({ cols: ['s'] }), now) === 'bad cols', 'wrong columns rejected');
ok(validateScanPart('stock', table({ n: 9 }), now).startsWith('bad column'), 'n mismatch rejected');
const t2 = table(); t2.d.chg[0] = { evil: 1 };
ok(validateScanPart('stock', t2, now) === 'bad cells chg', 'object cell rejected');
const p2 = presets(); p2.presets['Bad Key!'] = p2.presets.gainers;
ok(/bad preset/.test(validateScanPart('presets', p2, now)), 'bad preset key rejected');
const p3 = presets(); p3.presets.gainers.rows[0] = ['x'];
ok(/bad row/.test(validateScanPart('presets', p3, now)), 'short row rejected');
ok((await validateScan('stock', gz(table()), Date.now())).t === now - 30, 'gzip body ok');
ok((await validateScan('stock', new TextEncoder().encode(JSON.stringify(table())).buffer, Date.now())).error === 'not gzip', 'plain JSON rejected');

// ---- routes on a real DO (node:sqlite) ----
let sqlite = null;
try { sqlite = await import('node:sqlite'); } catch (e) {}
if (sqlite) {
  const nodeCrypto = await import('node:crypto');
  const { default: worker, BookRecorder } = await import('../src/index.js');
  crypto.subtle.timingSafeEqual = (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const db = new sqlite.DatabaseSync(':memory:');
  const sql = { exec(q, ...a) { const st = db.prepare(q); const isSel = /^\s*SELECT/i.test(q); const rows = isSel ? st.all(...a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x))) : (st.run(...a.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x))), []); return { toArray: () => rows }; }, get databaseSize() { return 0; } };
  const SECRET = 'z'.repeat(40);
  const env = { INGEST_SECRET: SECRET };
  const doObj = new BookRecorder({ storage: { sql, deleteAlarm: async () => {} } }, env);
  env.RECORDER = { idFromName: () => 'id', get: () => ({ fetch: (u, init) => doObj.fetch(new Request(u, init)) }) };
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
  const W = (path, init) => worker.fetch(new Request('https://w.dev' + path, init), env, { waitUntil: (p) => p });
  let r = await W('/scan-ingest?part=presets', { method: 'POST', body: gz(presets()) });
  ok(r.status === 401, 'no key -> 401');
  r = await W('/scan-ingest?part=presets', { method: 'POST', body: gz(presets()), headers: { 'x-ingest-key': SECRET } });
  ok(r.status === 200, 'presets stored: ' + await r.text());
  r = await W('/scan-ingest?part=stock', { method: 'POST', body: gz(table({ t: 1 })), headers: { 'x-ingest-key': SECRET } });
  ok(r.status === 400, 'invalid part body -> 400 ' + await r.text());
  r = await W('/scan?part=presets', { headers: { origin: 'https://strykertrading.com' } });
  ok(r.status === 200 && r.headers.get('x-scan-gzip') === '1' && r.headers.get('access-control-allow-origin') === 'https://strykertrading.com', 'read presets (gzip flag, CORS)');
  const back = JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString());
  ok(back.presets.gainers.rows[0][0] === 'NASDAQ:AAA', 'round trip');
  r = await W('/scan?part=etf'); ok(r.status === 404, 'no data -> 404');
  r = await W('/scan?part=bonds'); ok(r.status === 400, 'bad part -> 400');
  r = await W('/scan?part=presets', { headers: { origin: 'https://evil.example' } }); ok(r.status === 403, 'foreign origin -> 403');
} else console.log('SKIP routes (no node:sqlite)');
console.log(n + ' passed');
