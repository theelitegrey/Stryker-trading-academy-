// Local harness for the book-recorder Worker's GEX routes: real src/index.js + BookRecorder DO class
// on node:sqlite, fake caches/env. Not run in CI (needs node:sqlite); the deploy smoke test covers live.
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import worker, { BookRecorder } from '../src/index.js';

import nodeCrypto from 'node:crypto';
// Workers-only API, polyfilled for node
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
const wctx = { waitUntil: (p) => p };
const W = (path, init) => worker.fetch(new Request('https://w.dev' + path, init), env, wctx);

const now = Date.now() / 1000;
const chain = { v: 1, part: 'near', symbol: 'QQQ', spot: 741.6, iv30: 18.4, chain_time: 't', fetched_at: Math.round(now - 20), cols: [], expiries: { '2026-10-13': [[742, 'C', 10, 0.13, 1, 1.1, 1, 0.5]] } };
const body = gzipSync(JSON.stringify(chain));
let r = await W('/gex-ingest?sym=QQQ&part=near', { method: 'POST', body });
assert.equal(r.status, 401); console.log('PASS no key -> 401');
r = await W('/gex-ingest?sym=QQQ&part=near', { method: 'POST', body, headers: { 'x-ingest-key': SECRET } });
assert.equal(r.status, 200, await r.clone().text()); console.log('PASS ingest ->', await r.text());
r = await W('/gex-chain?sym=QQQ&part=near');
assert.equal(r.status, 200); assert.equal(r.headers.get('x-gex-fetched-at'), String(chain.fetched_at));
const back = Buffer.from(await r.arrayBuffer());
assert.ok(back.equals(body)); console.log('PASS read back identical gzip', back.length, 'B');
r = await W('/gex-chain?sym=QQQ&part=near', { headers: { origin: 'https://evil.example' } });
assert.equal(r.status, 403); console.log('PASS browser origin -> 403');
r = await W('/gex-chain?sym=SPX&part=near');
assert.equal(r.status, 404); console.log('PASS missing chain -> 404');
r = await W('/status');
const st = await r.json(); assert.ok(st.gex['QQQ:near'].bytes === body.length); console.log('PASS /status shows gex', JSON.stringify(st.gex));
console.log('ALL PASS');
