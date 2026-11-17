// Phantom routes on the real src/index.js + BookRecorder DO (node:sqlite), fake caches/env. No network.
//   node workers/book-recorder/test/phantom-worker-local.mjs
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import worker, { BookRecorder } from '../src/index.js';
import { checkBoard, phQuery } from '../src/phantom.js';

crypto.subtle.timingSafeEqual = (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...a) { const st = db.prepare(q); const isSel = /^\s*SELECT/i.test(q); const rows = isSel ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; }, get databaseSize() { return 0; } };
const ctx = { storage: { sql, deleteAlarm: async () => {} } };
const SECRET = 'x'.repeat(40);
const env = { INGEST_SECRET: SECRET, SYMBOLS: 'BTCUSDT,ETHUSDT' };
const doObj = new BookRecorder(ctx, env);
env.RECORDER = { idFromName: () => 'id', get: () => ({ fetch: (u, init) => doObj.fetch(new Request(u, init)) }) };
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
const W = (path, init) => worker.fetch(new Request('https://w.dev' + path, init), env, { waitUntil: (p) => p });
const ok = (m) => console.log('PASS', m);
const K1 = 'SPXW261120C07000000', K2 = 'SPXW261120P06900000';
const nowS = Math.floor(Date.now() / 1000);
const mk = (day, t, over) => Object.assign({ v: 1, u: 'SPX', day, t, spot: 7000.5, from: t - 600, prevDay: null, exps: ['2026-11-20'], cols: ['k', 'x', 's', 'c', 'v', 'oi', 'p', 'n', 'px', 'doi', 'pv'],
  rows: [[K1, 0, 7000, 'C', 140, 500, 26500, 22000, 2, null, null], [K2, 0, 6900, 'P', 52, 40, 5200, -5200, 1, null, null]],
  tot: { cp: 26500, pp: 5200, cn: 22000, pn: -5200, cv: 140, pv: 52 }, mcols: ['t', 'k', 'dv', 'p', 'px', 'v', 'oi'], moves: [[t, K1, 100, 20000, 2, 100, 500]], lm: [[K1, 10, 2000, 140, 500]],
  minute: { [K1]: [10, 2000] } }, over);
const post = (d, key = SECRET, u = 'SPX') => W('/phantom-ingest?u=' + u, { method: 'POST', body: gzipSync(JSON.stringify(d)), headers: key ? { 'x-ingest-key': key } : {} });

// pure checks
assert.equal(checkBoard('SPX', mk('2026-11-17', nowS), nowS), ''); ok('a good board validates');
assert.match(checkBoard('SPX', mk('2026-11-17', nowS, { rows: [[K1, 0, 7000, 'C', 1, 1, 10, 50, 1, null, null]] }), nowS), /bad row/); ok('|net| > premium refused');
assert.match(checkBoard('SPX', mk('2026-11-17', nowS, { minute: { 'DROP TABLE': [1, 1] } }), nowS), /bad minute/); ok('a non-OCC minute key refused');
assert.match(checkBoard('SPX', mk('2026-11-17', nowS, { u: 'QQQ' }), nowS), /bad header/); ok('u must match the query');
assert.equal(phQuery(new URL('https://x/phantom/contract?u=SPX&day=2026-11-17&k=' + K1 + ",SPX')--")).error, 'bad k/day'); ok('contract keys must be OCC (no SQL through json_extract)');

let r = await post(mk('2026-11-17', nowS - 120), null); assert.equal(r.status, 401); ok('ingest without key -> 401');
r = await post(mk('2026-11-17', nowS - 120), SECRET, 'XYZ'); assert.equal(r.status, 400); ok('unknown symbol -> 400');
// two days of samples: day 1 (3 minutes), day 2 (1 minute, overnight OI change on K1)
const d1 = '2026-11-16', d2 = '2026-11-17';
for (let i = 0; i < 3; i++) { r = await post(mk(d1, nowS - 86000 + i * 60, { minute: { [K1]: [10 + i, 2000 + i], [K2]: [1, 100] } })); assert.equal(r.status, 200, await r.clone().text()); }
r = await post(mk(d2, nowS - 60, { prevDay: d1, rows: [[K1, 0, 7000, 'C', 5, 620, 1000, 1000, 2, 120, 140]], tot: { cp: 1000, pp: 0, cn: 1000, pn: 0, cv: 5, pv: 0 } }));
assert.equal(r.status, 200); ok('2 sessions stored');
r = await W('/phantom/summary', { headers: { origin: 'https://strykertrading.com' } }); assert.equal(r.status, 403); ok('signed out -> 403 (gated)');
const svc = { 'x-ingest-key': SECRET };
r = await W('/phantom/summary', { headers: svc }); let j = await r.json();
assert.equal(j.day, d2); assert.equal(j.u.SPX.tot.cp, 1000); assert.equal(j.u.SPX.moves.length, 1); ok('summary: newest day, totals + moves (service key)');
r = await W('/phantom/summary?day=' + d1, { headers: svc }); assert.equal((await r.json()).u.SPX.tot.cp, 26500); ok('summary of a past day');
r = await W('/phantom/days?u=SPX', { headers: svc }); assert.deepEqual((await r.json()).days, [d2, d1]); ok('days newest first');
r = await W('/phantom/board?u=SPX&day=' + d1, { headers: svc }); assert.equal(r.headers.get('x-ph-gzip'), '1'); assert.equal(r.headers.get('x-ph-day'), d1);
j = JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString()); assert.equal(j.rows.length, 2); assert.equal(j.minute, undefined); ok('board: gzip, no minute map inside');
r = await W('/phantom/contract?u=SPX&day=' + d1 + '&k=' + K1 + ',' + K2, { headers: svc }); j = await r.json();
assert.equal(j.t.length, 3); assert.deepEqual(j.s[0], [[10, 2000], [11, 2001], [12, 2002]]); assert.deepEqual(j.s[1][0], [1, 100]);
assert.equal(j.next.day, d2); assert.deepEqual(j.next.doi, [120, null]); ok('contract drilldown: per-minute series + next session OI change');
r = await W('/phantom/contract?u=SPX&day=' + d1 + '&k=A,B,C,D,E', { headers: svc }); assert.equal(r.status, 400); ok('more than 4 contracts / bad keys -> 400');
r = await W('/phantom/board?u=GLD', { headers: svc }); assert.equal(r.status, 404); ok('no board yet -> 404');
r = await W('/phantom/nope?u=SPX', { headers: svc }); assert.equal(r.status, 404); ok('unknown route -> 404');
r = await W('/phantom/summary', { method: 'POST', headers: svc }); assert.equal(r.status, 405); ok('read routes are GET only');
console.log('ALL PASS');
