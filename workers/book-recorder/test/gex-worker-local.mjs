// Local harness for the book-recorder Worker's GEX routes: real src/index.js + BookRecorder DO class
// on node:sqlite, fake caches/env. Not run in CI (needs node:sqlite); the deploy smoke test covers live.
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import worker, { BookRecorder, histRange } from '../src/index.js';
import { unpackHistory, snapAt } from '../src/gex-history.js';

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

// ---- GEX history: /gex-snap -> /gex-history + /gex-sessions ----
const nowS = Math.floor(Date.now() / 1000);
const day = new Date((nowS - 3600) * 1000).toISOString().slice(0, 10);
const mk = (u, d, t, spot) => ({ u, d, day, t, fa: t + 900, x: day, s: spot, cw: spot + 10, pw: spot - 10, zg: spot + 3, n: -12.5, em: [spot, 20.5],
  k: [spot - 5, spot, spot + 5], g: [-1.5, 0.25, 3] });
const snapBody = (snaps) => gzipSync(JSON.stringify({ v: 1, snaps }));
const t0 = nowS - 3600;
r = await W('/gex-snap', { method: 'POST', body: snapBody([mk('SPX', 0, t0, 7700)]) });
assert.equal(r.status, 401); console.log('PASS /gex-snap without key -> 401');
for (let i = 0; i < 5; i++) {
  r = await W('/gex-snap', { method: 'POST', body: snapBody([mk('SPX', 0, t0 + i * 120, 7700 + i), mk('QQQ', 1, t0 + i * 120, 730)]), headers: { 'x-ingest-key': SECRET } });
  assert.equal(r.status, 200, await r.clone().text());
}
r = await W('/gex-snap', { method: 'POST', body: snapBody([mk('SPX', 0, t0 + 4 * 120, 7704)]), headers: { 'x-ingest-key': SECRET } });
assert.equal(await r.text(), 'stored 0 new of 1'); console.log('PASS same chain time twice -> replaced, counted once');
r = await W('/gex-snap', { method: 'POST', body: snapBody([mk('SPX', 7, t0, 7700)]), headers: { 'x-ingest-key': SECRET } });
assert.equal(r.status, 400); console.log('PASS invalid snapshot -> 400', await r.text());
r = await W('/gex-history?u=SPX&dte=0&from=' + (t0 - 60) + '&to=' + nowS, { headers: { origin: 'https://strykertrading.com' } });
assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://strykertrading.com');
const hist = await r.json(), rows = unpackHistory(hist);
assert.equal(rows.length, 5); assert.deepEqual(rows[2].k, [7697, 7702, 7707]); assert.equal(rows[4].s, 7704);
console.log('PASS /gex-history returns 5 SPX 0DTE snapshots, axis', hist.k.length, 'strikes,', JSON.stringify(hist).length, 'B');
assert.equal(snapAt(rows, t0 + 130).t, t0 + 120); assert.equal(snapAt(rows, t0 - 1), null); console.log('PASS no-lookahead lookup on served rows');
r = await W('/gex-history?u=SPX&dte=0&from=' + (t0 - 60) + '&to=' + nowS);
assert.equal((await r.json()).t.length, 5); console.log('PASS second read (edge cache) identical');
r = await W('/gex-history?u=QQQ&dte=0');
assert.equal((await r.json()).t.length, 0); console.log('PASS QQQ 0DTE empty (only 1DTE stored)');
r = await W('/gex-history?u=XYZ&dte=0'); assert.equal(r.status, 400); console.log('PASS bad underlying -> 400');
r = await W('/gex-history?u=SPX&dte=0', { headers: { origin: 'https://evil.example' } }); assert.equal(r.status, 403); console.log('PASS foreign origin -> 403');
r = await W('/gex-sessions?u=SPX&dte=0');
const ses = await r.json(); assert.equal(ses.length, 1); assert.equal(ses[0].n, 5); assert.equal(ses[0].day, day); console.log('PASS /gex-sessions', JSON.stringify(ses));
r = await W('/gex-sessions'); assert.equal((await r.json()).length, 2); console.log('PASS /gex-sessions (all)');
const hr = histRange(null, null, nowS); assert.ok(hr.to - hr.from <= 8 * 86400 + 3600 && hr.from % 3600 === 0 && hr.to % 120 === 0); console.log('PASS histRange default', JSON.stringify(hr));
const hr2 = histRange(nowS - 30 * 86400, nowS, nowS); assert.ok(hr2.to - hr2.from <= 8 * 86400); console.log('PASS histRange capped at 8 days');
r = await W('/status'); const st2 = await r.json(); console.log('PASS /status gexHistory', JSON.stringify(st2.gexHistory));
console.log('ALL PASS');
