// TICK ENGINE through the real Worker (src/index.js + the BookRecorder DO on node:sqlite). node workers/book-recorder/test/tick-engine-worker-local.mjs
// Proves the lane is the SERVER's call from the verified token: signed out / free / bad token -> bars cut at now-10 min, no seq; a live
// tier -> up to now with seq; a client-sent lane=live / to=future / cut= changes nothing; the delayed edge-cache entry never holds live
// data and a live answer is never cached; /te-ticks is live tiers only; the query is normalised (cache-busting by 1 ms moves nothing).
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';

let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const NOW = Date.UTC(2026, 10, 4, 15, 0, 20);   // Wed 10:00:20 ET, CME open
const realNow = Date.now; Date.now = () => NOW;
// signed Firebase-style tokens + fake Firestore (same fixture as ts-hub.test.mjs)
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tok = (uid) => { const now = Math.floor(NOW / 1000); const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
globalThis.fetch = async (url) => {
  url = String(url);
  if (/jwk/.test(url)) return Response.json({ keys: [jwk] });
  if (/admins\/adm1/.test(url)) return Response.json({ name: 'x' });
  if (/admins\//.test(url)) return new Response('{}', { status: 404 });
  if (/students\/mda1/.test(url)) return Response.json({ fields: { marketDataAgreement: { mapValue: { fields: { version: { stringValue: 'v1' }, nonProfessional: { booleanValue: true } } } } } });
  if (/students\//.test(url)) return Response.json({ fields: { plan: { stringValue: 'free' } } });
  if (/plans/.test(url)) return Response.json({ documents: [] });
  return new Response('{}', { status: 404 });
};
const cache = new Map();
globalThis.caches = { default: { async match(r) { const e = cache.get(r.url); return e ? e.clone() : undefined; }, async put(r, res) { cache.set(r.url, res.clone()); } } };
const { default: worker, BookRecorder } = await import('../src/index.js');
const db = new DatabaseSync(':memory:');
const conv = (a) => a.map((x) => (x instanceof Uint8Array ? Buffer.from(x) : x));
const sql = { exec(q, ...a) { const st = db.prepare(q); const sel = /^\s*SELECT|RETURNING/i.test(q); const rows = sel ? st.all(...conv(a)) : (st.run(...conv(a)), []); return { toArray: () => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? new Uint8Array(v) : v]))) }; }, get databaseSize() { return 0; } };
const env = { INGEST_SECRET: 'x'.repeat(40), SYMBOLS: 'BTCUSDT', TS_ACCESS: 'pro', TICKSTREAM_API_KEY: '', TE_SYMBOLS: 'NQ' };
const dobj = new BookRecorder({ storage: { sql, deleteAlarm: async () => {} } }, env);
env.RECORDER = { idFromName: () => 'main', get: () => ({ fetch: (u, init) => dobj.fetch(u instanceof Request ? u : new Request(u, init)) }) };
env.RL_OF = { limit: async () => ({ success: true }) }; env.RL = env.RL_OF; env.RLN = env.RL_OF;
const te = dobj.tickEngine;
assert.ok(te, 'engine on');
// 60 minutes of NQ trades up to now, one a second, price = minute index (so a bar's time tells its price)
te.up(NOW - 3600000 - 5000);
let k = 0;
for (let t = NOW - 3600000; t <= NOW; t += 1000) { te.clock = () => t; te.add('NQ', 28000 + Math.floor((t - (NOW - 3600000)) / 60000) * 0.25, 1, k++ % 2 ? 1 : -1, Math.floor(t / 1000), t); te.tick(t); }
te.clock = () => NOW;
const get = async (path, token, origin = 'https://tradezoro.com') => { const h = { origin }; if (token) h.authorization = 'Bearer ' + token; const r = await worker.fetch(new Request('https://book-recorder.example' + path, { headers: h }), env, { waitUntil: (p) => p }); return { r, j: r.headers.get('content-type') && r.headers.get('content-type').includes('json') ? await r.json() : await r.text() }; };
const cut = Math.floor((NOW - 600000) / 60000) * 60000;
const lastT = (j) => j.b[j.b.length - 1][0];

for (const [who, t] of [['signed out', ''], ['free member, no agreement', tok('free1')], ['garbage token', 'a.b.c']]) {
  const { r, j } = await get('/te-bars?sym=NQ&tf=1&from=' + (NOW - 7200000) + '&to=' + (NOW + 86400000) + '&lane=live&cut=0', t);
  assert.equal(r.status, 200); assert.equal(r.headers.get('x-te-lane'), 'delayed', who);
  assert.ok(lastT(j) < cut && lastT(j) === cut - 60000, who + ': newest bar is the minute before the cut');
  assert.equal(j.q, null, who + ': no seq'); assert.equal(j.cut, cut);
  const tk = await get('/te-ticks?sym=NQ&from=' + (NOW - 300000) + '&to=' + NOW, t);
  assert.equal(tk.r.status, 403, who + ': no raw trades');
}
ok('delayed lane: signed out / free without agreement / bad token get bars cut at the whole minute 10 min ago, no seq, no /te-ticks; lane=live&to=future ignored');

for (const [who, t] of [['admin', tok('adm1')], ['member with the agreement (L1)', tok('mda1')]]) {
  const { r, j } = await get('/te-bars?sym=NQ&tf=1&from=' + (NOW - 7200000), t);
  assert.equal(r.headers.get('x-te-lane'), 'live', who); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(lastT(j), Math.floor(NOW / 60000) * 60000, who + ': the forming minute');
  assert.equal(j.q, te.S.get('NQ').seq, who + ': seq');
  const tk = await get('/te-ticks?sym=NQ&from=' + (NOW - 120000) + '&to=' + (NOW + 1000), t);
  assert.equal(tk.r.status, 200); assert.ok(tk.j.t.length >= 120);
}
ok('live lane: admin and an L1 member (agreement) get bars up to the forming minute with seq; never cached (private, no-store); /te-ticks allowed');

// cache: only delayed entries, none newer than the cut
const keys = [...cache.keys()];
assert.ok(keys.length >= 1 && keys.every((u) => u.includes('/te-delayed/') && u.includes('lane=delayed')), 'only delayed keys');
for (const [, res] of cache) { const j = await res.clone().json(); assert.ok(j.b.every((b) => b[0] < cut) && j.q == null, 'cached body holds no live data'); }
// normalised query: 1 ms changes share an entry
await get('/te-bars?sym=NQ&tf=1&from=' + (NOW - 7200000 + 1) + '&to=' + (NOW + 7), '');
const before = cache.size;
await get('/te-bars?sym=NQ&tf=1&from=' + (NOW - 7200000 + 2) + '&to=' + (NOW + 9), '');
assert.equal(cache.size, before, 'no new cache entries for 1 ms changes');
ok('edge cache: delayed entries only (bodies hold nothing newer than the cut, no seq); from/to normalised so 1 ms changes hit the same entry');

// N-tick bars (100T): live lane up to the newest trade, counted from the session open; delayed lane cut; paging by an exact `to`
{
  const L = await get('/te-bars?sym=NQ&tf=100T&limit=20', tok('adm1'));
  assert.equal(L.r.status, 200); assert.equal(L.j.b.length, 20, '20 bars'); assert.equal(L.j.q, te.S.get('NQ').seq, 'seq');
  assert.ok(L.j.b[19][5] <= 100 && L.j.b[0][5] === 100, 'each bar = 100 trades (size 1 each), the forming one fewer');
  const P = await get('/te-bars?sym=NQ&tf=100T&limit=5&to=' + L.j.b[0][0], tok('adm1'));
  assert.ok(P.j.b.length === 5 && P.j.b[4][0] < L.j.b[0][0], 'page 2 ends right before page 1');
  const D = await get('/te-bars?sym=NQ&tf=100T&limit=20&to=' + (NOW + 7), '');
  assert.equal(D.r.headers.get('x-te-lane'), 'delayed'); assert.ok(D.j.b.length && D.j.b.every((b) => b[0] < cut) && D.j.q == null, 'delayed tick bars cut');
  assert.equal((await get('/te-bars?sym=NQ&tf=0T', '')).r.status, 400); assert.equal((await get('/te-bars?sym=NQ&tf=9999T', '')).r.status, 400);
}
ok('tick bars: /te-bars tf=100T live = 100 trades a bar with seq, pages by exact `to`; delayed = cut at now-10 min; 0T / 9999T = 400');
assert.equal((await get('/te-bars?sym=NQ&tf=W', '')).r.status, 400);
assert.equal((await get('/te-bars?sym=../x&tf=1', '')).r.status, 400);
assert.equal((await get('/te-bars?sym=NQ&tf=1', '', 'https://evil.example')).r.status, 403);
const h = await get('/te-health', '');
assert.equal(h.r.status, 200); assert.ok(!JSON.stringify(h.j).match(/key|token/i), 'health holds no secrets');
ok('bad timeframe / symbol = 400, foreign origin = 403, /te-health has counts only');
Date.now = realNow;
console.log('\n' + n + ' passed');
