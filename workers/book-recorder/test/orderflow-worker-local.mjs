// Local harness for the book-recorder Worker's order-flow routes: real src/index.js + the
// BookRecorder DO class on node:sqlite, fake caches/env. Run: node test/orderflow-worker-local.mjs
// (not in CI: needs node:sqlite; the deploy smoke test covers the live Worker).
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { splitPayload, buildPayload, decodeRecord } from '../src/orderflow.js';
import { decodeOrderflow } from '../../../assets/chart-footprint-data.js';

const here = dirname(fileURLToPath(import.meta.url));
crypto.subtle.timingSafeEqual = (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// The fixture hour is 2026-10-13 12:00-13:00 UTC: pretend "now" is 13:00:20 that day.
const NOW = Date.UTC(2026, 9, 13, 13, 0, 20);
const realNow = Date.now;
Date.now = () => NOW;

const { default: worker, BookRecorder } = await import('../src/index.js');
const db = new DatabaseSync(':memory:');
let writes = 0;
const sql = { exec(q, ...a) { const st = db.prepare(q); const isSel = /^\s*SELECT/i.test(q); if (!isSel) writes++; const rows = isSel ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; }, get databaseSize() { return 0; } };
const ctx = { storage: { sql, deleteAlarm: async () => {} } };
const SECRET = 'x'.repeat(40);
const env = { INGEST_SECRET: SECRET, SYMBOLS: 'BTCUSDT,ETHUSDT' };
let doObj = new BookRecorder(ctx, env);
env.RECORDER = { idFromName: () => 'id', get: () => ({ fetch: (u, init) => doObj.fetch(new Request(u, init)) }) };
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
const W = (path, init) => worker.fetch(new Request('https://w.dev' + path, init), env, { waitUntil: (p) => p });

// Admin token stub (Owner order 2026-10-16: real time is admin only). Throwaway RSA key; Google's JWKS
// and the Firestore admins/{uid} read are faked. No real token anywhere.
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = (b) => Buffer.from(b).toString('base64url');
async function mint(sub) {
  const now = Math.floor(NOW / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })), p = b64u(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub, iat: now - 5, exp: now + 3600 }));
  return h + '.' + p + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p)));
}
globalThis.fetch = async (url) => String(url).includes('securetoken@system') ? new Response(JSON.stringify({ keys: [jwk] })) : String(url).endsWith('/admins/uid-admin') ? new Response('{}') : new Response('{}', { status: 403 });
const ADMIN = { authorization: 'Bearer ' + await mint('uid-admin') }, PRO = { authorization: 'Bearer ' + await mint('uid-pro') };

const out = join(mkdtempSync(join(tmpdir(), 'of-')), 'nq.bin');
execFileSync('python3', [join(here, '../of-feeder/of_feeder.py'), '--dry-run', join(here, 'fixtures/nq-trades-20261013-12utc.json.gz'), 'NQ', out]);
const payload = new Uint8Array(readFileSync(out));
const body = gzipSync(payload);

let r = await W('/of-ingest?sym=NQ', { method: 'POST', body });
assert.equal(r.status, 401); console.log('PASS no key -> 401');
r = await W('/of-ingest?sym=NQ', { method: 'GET', headers: { 'x-ingest-key': SECRET } });
assert.equal(r.status, 405); console.log('PASS GET ingest -> 405');
r = await W('/of-ingest?sym=ES', { method: 'POST', body, headers: { 'x-ingest-key': SECRET } });
assert.equal(r.status, 400); console.log('PASS NQ bars posted as ES -> 400', await r.text());
writes = 0;
r = await W('/of-ingest?sym=NQ', { method: 'POST', body, headers: { 'x-ingest-key': SECRET } });
assert.equal(r.status, 200, await r.clone().text());
const txt = await r.text();
assert.equal(txt, '60 stored, 0 open');
console.log('PASS ingest ->', txt, '| SQLite writes:', writes);

// an open bar (13:00, minute still running) stays in memory only
const sp = splitPayload(payload);
const last = decodeRecord(sp.recs[59]);
const openRec = Uint8Array.from(sp.recs[59]);
// re-stamp minute t -> 13:00 (first uvarint): rebuild with t+1
const tNew = last.t + 1, tb = [];
let n = tNew; while (n >= 0x80) { tb.push((n % 128) | 0x80); n = Math.floor(n / 128); } tb.push(n);
let k = 0; while (openRec[k] >= 0x80) k++;
const openBar = new Uint8Array([...tb, ...openRec.subarray(k + 1)]);
writes = 0;
r = await W('/of-ingest?sym=NQ', { method: 'POST', body: gzipSync(buildPayload(sp.header, [openBar])), headers: { 'x-ingest-key': SECRET } });
const t2 = await r.text();
assert.equal(t2, '0 stored, 1 open');
assert.ok(writes <= 1, 'open bar wrote ' + writes + ' rows');
console.log('PASS open bar -> memory only:', t2, '| SQLite writes:', writes);

// read back today: 60 closed + 1 open, identical bytes
r = await W('/orderflow?sym=NQ&day=2026-10-13', { headers: { origin: 'https://strykertrading.com', ...ADMIN } });
assert.equal(r.status, 200);
assert.equal(r.headers.get('access-control-allow-origin'), 'https://strykertrading.com');
assert.equal(r.headers.get('x-of-gzip'), '1');
assert.match(r.headers.get('cache-control'), /no-store/);   // admin answers are never shared-cached
const gz = Buffer.from(await r.arrayBuffer());
const back = decodeOrderflow(new Uint8Array(gunzipSync(gz)));
assert.equal(back.bars.length, 61);
const src = decodeOrderflow(payload);
for (let i = 0; i < 60; i++) { assert.equal(back.bars[i].t, src.bars[i].t); assert.deepEqual([...back.bars[i].buy], [...src.bars[i].buy]); assert.deepEqual(back.bars[i].bigs, src.bars[i].bigs); assert.equal(back.bars[i].dmin, src.bars[i].dmin); }
assert.equal(back.header.thr, src.header.thr);
console.log('PASS /orderflow today: 61 bars (60 stored + the open one), identical to the feeder\'s, ' + gz.length + ' B gzip');

// NON-ADMINS (signed out, and a signed-in non-admin): nothing newer than now - 10 min (13:00:20 -> last minute 12:49)
for (const [who, hd] of [['signed out', {}], ['non-admin', PRO]]) {
  store.clear();
  let rr = await W('/orderflow?sym=NQ&day=2026-10-13', { headers: { origin: 'https://strykertrading.com', ...hd } });
  assert.equal(rr.status, 200);
  const dl = decodeOrderflow(new Uint8Array(gunzipSync(Buffer.from(await rr.arrayBuffer()))));
  assert.ok(dl.bars.length > 0 && dl.bars.every((b) => b.t <= NOW - 600000), who + ': orderflow newest ' + (NOW - dl.bars[dl.bars.length - 1].t) / 1000 + ' s old');
  assert.equal(dl.bars.length, 50, who);
  rr = await W('/orderflow?sym=NQ&from=' + (NOW / 1000 - 1200) + '&to=' + NOW / 1000, { headers: hd });
  const dl2 = decodeOrderflow(new Uint8Array(gunzipSync(Buffer.from(await rr.arrayBuffer()))));
  assert.ok(dl2.bars.every((b) => b.t <= NOW - 600000), who + ': live tail leaks');
  rr = await W('/ticks1s?sym=NQ&from=' + Date.UTC(2026, 9, 13, 12) / 1000 + '&to=' + NOW / 1000, { headers: hd });
  const tj0 = await rr.json();
  assert.ok(tj0.m.length > 0 && tj0.m.every(([min]) => min * 1000 <= NOW - 600000), who + ': ticks1s leaks');
  rr = await W('/ticks1s?sym=NQ&from=' + (NOW / 1000 - 300) + '&to=' + NOW / 1000, { headers: hd });
  assert.equal(rr.status, 200); { const mm = (await rr.json()).m; assert.ok(mm.every(([min]) => min * 1000 <= NOW - 600000), who + ': last 5 min must be empty'); }
  console.log('PASS ' + who + ': /orderflow + /ticks1s end >= 10 min ago (tail and last minutes empty)');
}
store.clear();
r = await W('/ticks1s?sym=NQ&from=' + Date.UTC(2026, 9, 13, 12) / 1000 + '&to=' + Date.UTC(2026, 9, 13, 13) / 1000, { headers: { origin: 'https://strykertrading.com', ...ADMIN } });
assert.equal(r.status, 200);
const tj = await r.json();
assert.equal(tj.sym, 'NQ'); assert.equal(tj.prices, 'real'); assert.equal(tj.m.length, 61);
console.log('PASS /ticks1s 12:00-13:00 -> ' + tj.m.length + ' minutes, first second', JSON.stringify(tj.m[0][1][0]));
// /bars-tail (site's bars live tail): admin only, no browser origin, OHLCV minute rows from the stored records
r = await W('/bars-tail?sym=NQ', { headers: PRO }); assert.equal(r.status, 403);
r = await W('/bars-tail?sym=NQ', { headers: { origin: 'https://x.dev', ...ADMIN } }); assert.equal(r.status, 403);
r = await W('/bars-tail?sym=NQ'); assert.equal(r.status, 403);
r = await W('/bars-tail?sym=NQ', { headers: ADMIN }); assert.equal(r.status, 200, 'bars-tail status ' + r.status);
{ const bt = await r.json(); assert.ok(bt.rows.length > 0, 'bars-tail rows ' + JSON.stringify(bt).slice(0, 200)); assert.ok(bt.rows.every((x) => x.length === 6 && x[2] >= x[3])); }
console.log('PASS /bars-tail: admin only, server use only, OHLCV rows');

// a fresh DO (restart) loads the memory window from SQLite; the open bar is gone until the next POST
doObj = new BookRecorder(ctx, env);
store.clear();
r = await W('/orderflow?sym=NQ&from=' + Date.UTC(2026, 9, 13, 12) / 1000 + '&to=' + Date.UTC(2026, 9, 13, 12, 30) / 1000);
const half = decodeOrderflow(new Uint8Array(gunzipSync(Buffer.from(await r.arrayBuffer()))));
assert.equal(half.bars.length, 31);
console.log('PASS after a DO restart, from/to 12:00-12:30 -> 31 bars from SQLite');

// past day: cached a day; unknown symbol 404; other origin 403
Date.now = () => NOW + 86400000 * 2;
r = await W('/orderflow?sym=NQ&day=2026-10-13');
assert.match(r.headers.get('cache-control'), /max-age=3600/);
r = await W('/orderflow?sym=ES&day=2026-10-13', { headers: { origin: 'https://strykertrading.com' } });
assert.match(r.headers.get('cache-control'), /max-age=60$/);
console.log('PASS a past UTC day is cached 1 h; an empty one 60 s');
r = await W('/orderflow?sym=BTC&day=2026-10-13'); assert.equal(r.status, 404);
r = await W('/orderflow?sym=NQ&day=2026-10-13', { headers: { origin: 'https://evil.example' } }); assert.equal(r.status, 403);
r = await W('/orderflow?sym=NQ&day=nope'); assert.equal(r.status, 400);
console.log('PASS unknown symbol 404, foreign origin 403, bad day 400');
r = await W('/status');
const st = await r.json();
assert.equal(st.orderflow.NQ.bars, 60);
console.log('PASS /status orderflow', JSON.stringify(st.orderflow.NQ));
Date.now = realNow;
