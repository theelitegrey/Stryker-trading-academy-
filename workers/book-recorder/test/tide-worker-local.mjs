// Local harness for the ZoroTide routes: real src/index.js + BookRecorder DO class on node:sqlite, fake caches/env.
// node --experimental-sqlite? (Node 22+: node:sqlite)   node workers/book-recorder/test/tide-worker-local.mjs
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import worker, { BookRecorder } from '../src/index.js';
import { validateTide } from '../src/tide.js';

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

const nowS = Math.floor(Date.now() / 1000);
const mk = (u, t, over) => Object.assign({ u, day: new Date(t * 1000).toISOString().slice(0, 10), t, s: 7000.5, cn: 1000, pn: -500, cp: 2000, pp: 900, cv: 30, pv: 20 }, over);
const body = (snaps) => gzipSync(JSON.stringify({ v: 1, snaps }));
const post = (snaps, key = SECRET) => W('/tide-snap', { method: 'POST', body: body(snaps), headers: key ? { 'x-ingest-key': key } : {} });

let r = await post([mk('SPX', nowS - 600)], null); assert.equal(r.status, 401); ok('/tide-snap without key -> 401');
for (let i = 0; i < 5; i++) { r = await post([mk('SPX', nowS - 600 + i * 60, { cn: 100 * (i + 1) }), mk('QQQ', nowS - 600 + i * 60, { s: 600.1 })]); assert.equal(r.status, 200, await r.clone().text()); }
ok('5 minutes x 2 symbols stored');
r = await post([mk('SPX', nowS - 600)]); assert.equal(r.status, 200); ok('the same chain time again replaces the row');
r = await post([mk('SPX', nowS - 100, { cn: 5000, cp: 100 })]); assert.equal(r.status, 400); ok('|net| > gross -> 400 (' + (await r.text()) + ')');
r = await post([mk('SPX', nowS - 100, { cp: 6e10 })]); assert.equal(r.status, 400); ok('an impossible premium -> 400');
r = await post([mk('XYZ', nowS - 100)]); assert.equal(r.status, 400); ok('unknown symbol -> 400');
r = await post([mk('SPX', nowS + 9000)]); assert.equal(r.status, 400); ok('future time -> 400');
r = await post([mk('SPX', nowS - 100, { cn: 1.5 })]); assert.equal(r.status, 400); ok('non-integer premium -> 400');
assert.ok((await validateTide(new Uint8Array(30).buffer, Date.now())).error); ok('not gzip -> error');
r = await W('/tide?u=SPX&days=1', { headers: { origin: 'https://strykertrading.com' } });
assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://strykertrading.com');
const j = await r.json();
assert.equal(j.u, 'SPX'); assert.equal(j.days.length >= 1, true);
const total = j.days.reduce((a, d) => a + d.t.length, 0);
assert.equal(total, 5); assert.deepEqual(j.days[0].cn.slice(0, 3), [1000, 200, 300]); assert.equal(j.days[0].t[1] - j.days[0].t[0], 60);
ok('/tide returns the 5 SPX samples as columns (' + JSON.stringify(j).length + ' B)');
r = await W('/tide?u=QQQ'); assert.equal((await r.json()).days[0].s[0], 600.1); ok('QQQ served');
r = await W('/tide?u=SPY'); assert.equal((await r.json()).days.length, 0); ok('SPY empty, not an error');
r = await W('/tide?u=GLD'); assert.equal(r.status, 400); ok('GLD not served -> 400');
r = await W('/tide?u=SPX', { headers: { origin: 'https://evil.example' } }); assert.equal(r.status, 403); ok('foreign origin -> 403');
// 30-day trim: old rows go, recent stay (the trim runs at most hourly: force it)
const old = nowS - 31 * 86400;
db.prepare('INSERT INTO tide (u, t, j) VALUES (?, ?, ?)').run('SPX', old, '{}');
db.prepare("DELETE FROM meta WHERE k = 'tideTrim'").run();
await post([mk('SPX', nowS - 30)]);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tide WHERE t < ?').get(nowS - 30 * 86400).n, 0); ok('rows older than 30 days are deleted on ingest');
assert.ok(db.prepare('SELECT COUNT(*) AS n FROM tide').get().n >= 11); ok('recent rows kept');
r = await W('/status'); const st = await r.json(); assert.ok(st.tide.rows.length >= 2); ok('/status tide ' + JSON.stringify(st.tide.last));
console.log('ALL PASS');
