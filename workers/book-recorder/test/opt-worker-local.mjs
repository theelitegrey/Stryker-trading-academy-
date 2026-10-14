// Local harness for the options analytics routes (/opt-ingest, /opt-analytics): real src/index.js +
// BookRecorder on node:sqlite, fake caches/env. Not run in CI (needs node:sqlite).
//   node workers/book-recorder/test/opt-worker-local.mjs
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import worker, { BookRecorder } from '../src/index.js';
import { sample } from './options.test.mjs';

crypto.subtle.timingSafeEqual = (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...a) { const st = db.prepare(q); const isSel = /^\s*SELECT/i.test(q); const rows = isSel ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; }, get databaseSize() { return 0; } };
const ctx = { storage: { sql, deleteAlarm: async () => {} } };
const SECRET = 'y'.repeat(40);
const env = { INGEST_SECRET: SECRET };
const doObj = new BookRecorder(ctx, env);
env.RECORDER = { idFromName: () => 'id', get: () => ({ fetch: (u, init) => doObj.fetch(new Request(u, init)) }) };
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
const W = (path, init) => worker.fetch(new Request('https://w.dev' + path, init), env, { waitUntil: (p) => p });
const body = (items) => gzipSync(JSON.stringify({ v: 1, items }));

let r = await W('/opt-ingest', { method: 'POST', body: body([sample()]) });
assert.equal(r.status, 401); console.log('PASS no key -> 401');
r = await W('/opt-ingest', { method: 'POST', body: body([sample('SPX', { day: '2026-10-13', atm30: 0.15 })]), headers: { 'x-ingest-key': SECRET } });
assert.equal(r.status, 200, await r.clone().text());
r = await W('/opt-ingest', { method: 'POST', body: body([sample(), sample('QQQ')]), headers: { 'x-ingest-key': SECRET } });
assert.equal(r.status, 200); console.log('PASS ingest ->', await r.text());
r = await W('/opt-ingest', { method: 'POST', body: body([sample('SPX', { spot: -1 })]), headers: { 'x-ingest-key': SECRET } });
assert.equal(r.status, 400); console.log('PASS invalid -> 400', await r.text());
r = await W('/opt-analytics?u=SPX', { headers: { origin: 'https://strykertrading.com' } });
assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://strykertrading.com');
const j = await r.json();
assert.equal(j.em[0].k, '0DTE'); assert.deepEqual(j.hist.map((h) => h[0]), ['2026-10-13', '2026-10-14']); assert.equal(j.hist[0][1], 0.15);
console.log('PASS read: latest blob + daily history oldest first', JSON.stringify(j.hist));
r = await W('/opt-analytics?u=SPY'); assert.equal(r.status, 404); console.log('PASS no data -> 404');
r = await W('/opt-analytics?u=AAPL'); assert.equal(r.status, 400); console.log('PASS unknown -> 400');
r = await W('/opt-analytics?u=QQQ', { headers: { origin: 'https://evil.example' } }); assert.equal(r.status, 403); console.log('PASS foreign origin -> 403');
console.log('ALL PASS');
