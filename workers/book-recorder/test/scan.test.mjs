// Market scanner ingest validation (src/scan.js) + the routes on a real BookRecorder when node:sqlite
// exists. CI runs it (the route part is skipped without node:sqlite).
//   node workers/book-recorder/test/scan.test.mjs
import { gzipSync, gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { validateScan, validateScanPart, SCAN_COLS, SCAN_COLS_V2, MS_COLS, DP_COLS, SCAN_PARTS } from '../src/scan.js';

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

// Market Stats parts (ms-feeder): one row per session, 62 numeric columns
const msRow = (d) => MS_COLS.map((c, i) => (i === 0 ? d : i === 1 ? 2 : c === 'o15x' || c === 'o30x' || c === 'ibx' ? null : 1.5));
const ms = (o) => Object.assign({ v: 1, t: now - 30, sym: 'NQ', tf: 5, cols: MS_COLS, rows: [msRow(20261027), msRow(20261028)] }, o || {});
ok(validateScanPart('ms_nq', ms(), now) === '', 'market stats part valid (null extensions allowed)');
ok(validateScanPart('ms_es', ms(), now) === 'bad sym', 'market stats symbol must match the part');
ok(validateScanPart('ms_nq', ms({ cols: ['d'] }), now) === 'bad cols', 'market stats wrong columns rejected');
ok(validateScanPart('ms_nq', ms({ rows: [[1, 2]] }), now) === 'bad row', 'market stats short row rejected');
ok(validateScanPart('ms_nq', ms({ rows: [msRow('x')] }), now) === 'bad row', 'market stats text cell rejected');
ok(validateScanPart('ms_nq', ms({ t: now - 3000 }), now) === '', 'market stats stays fresh for an hour');
ok(validateScanPart('ms_nq', ms({ t: now - 4000 }), now) === 'stale or future t', 'market stats older than an hour rejected');
ok(validateScanPart('presets', presets(), now) === '', 'presets valid');
// Dark pool parts (dp-feeder): real-shaped rows (SPY 2026-11-06)
const dp = (o) => Object.assign({ v: 1, t: now - 30, sym: 'SPY', code: 'AMEX:SPY', min: 1e6, days: ['2026-11-06'], cols: DP_COLS,
  rows: [[1793966400219, 735.52, 27817, 'T'], [1793972383905, 733, 23200, 'TB']] }, o || {});
ok(SCAN_PARTS.includes('dp_spy') && SCAN_PARTS.includes('dp_aapl') && !SCAN_PARTS.includes('dp_xyz'), 'dark pool parts listed for the fixed symbols only');
ok(validateScanPart('dp_spy', dp(), now) === '', 'dark pool part valid');
ok(validateScanPart('dp_aapl', dp(), now) === 'bad sym', 'dark pool symbol must match the part');
ok(validateScanPart('dp_spy', dp({ rows: [[1793972383905, 733, 23200, ''], [1793966400219, 735.52, 27817, '']] }), now) === 'bad time', 'dark pool rows must be in time order');
ok(validateScanPart('dp_spy', dp({ rows: [[1793966400219, -1, 5, '']] }), now) === 'bad row', 'dark pool negative price rejected');
ok(validateScanPart('dp_spy', dp({ rows: [[1793966400219, 1, 5, 'x'.repeat(9)]] }), now) === 'bad row', 'dark pool long condition string rejected');
ok(validateScanPart('dp_spy', dp({ cols: ['t'] }), now) === 'bad cols', 'dark pool wrong columns rejected');
ok(validateScanPart('dp_spy', dp({ t: now - 3000 }), now) === '', 'dark pool part stays fresh for an hour');
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

// ---- screener v2 tables (more columns) and the futures part
const rowV2 = (s, chg) => row(s, chg).concat(['Software', 1.1, 0.5, 1793577600, 2.5, 3.2, 8.1, 20, 2e6, 9, 9.5, 8, 9.1, 9.4, 8.2]);
const tableV2 = (o) => { const rows = [rowV2('NASDAQ:AAA', 9), rowV2('CME_MINI:NQ1!', -3)]; const d = {}; SCAN_COLS_V2.forEach((c, i) => { d[c] = rows.map((r) => r[i]); }); return Object.assign({ v: 2, t: now - 30, cols: SCAN_COLS_V2, n: rows.length, d }, o || {}); };
ok(SCAN_COLS_V2.slice(0, SCAN_COLS.length).join() === SCAN_COLS.join(), 'v2 columns extend v1');
ok(validateScanPart('stock', tableV2(), now) === '', 'v2 stock table valid');
ok(validateScanPart('fut', tableV2(), now) === '', 'futures part valid');
ok(validateScanPart('stock', table(), now) === '', 'v1 table still valid (old feeder keeps working)');
ok(validateScanPart('stock', tableV2({ cols: SCAN_COLS }), now) === 'bad cols', 'v2 header with v1 columns rejected');
ok(validateScanPart('presets', tableV2(), now) === 'bad header', 'presets stay v1');
ok(/bad cells ind/.test(validateScanPart('stock', (() => { const t = tableV2(); t.d.ind[0] = { x: 1 }; return t; })(), now)), 'object cell rejected');
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
  const info = { v: 1, t: Math.floor(Date.now() / 1000), syms: { NQ: { kind: 'fut', code: 'CME_MINI:NQ1!', roll: [] }, AAPL: { kind: 'stock', code: 'NASDAQ:AAPL', fund: { cap: 1 } } } };
  r = await W('/scan-ingest?part=syminfo', { method: 'POST', body: gz(info), headers: { 'x-ingest-key': SECRET } });
  ok(r.status === 200, 'syminfo stored: ' + await r.text());
  r = await W('/scan-ingest?part=syminfo', { method: 'POST', body: gz({ ...info, syms: { 'bad key': info.syms.NQ } }), headers: { 'x-ingest-key': SECRET } });
  ok(r.status === 400, 'bad syminfo key -> 400');
  r = await W('/scan?part=syminfo', { headers: { origin: 'https://strykertrading.com' } });
  ok(r.status === 200 && JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString()).syms.NQ.kind === 'fut', 'read syminfo');
  r = await W('/scan-ingest?part=dp_spy', { method: 'POST', body: gz(dp({ t: Math.floor(Date.now() / 1000) })), headers: { 'x-ingest-key': SECRET } });
  ok(r.status === 200, 'dark pool part stored: ' + await r.text());
  r = await W('/scan?part=dp_spy', { headers: { origin: 'https://tradezoro.com' } });
  ok(r.status === 200 && JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString()).rows[0][2] === 27817, 'read dark pool part');
} else console.log('SKIP routes (no node:sqlite)');
console.log(n + ' passed');
