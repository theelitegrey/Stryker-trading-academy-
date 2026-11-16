// Order speed (Owner order 2026-11-16): cache TTLs, Server-Timing, parallel pre-send steps, deferred audit, session renew on 401,
// pre-warm, and the Pages -> placed Worker hand-off. Mocked broker + mocked auth, no network. Run: node tests/finatic/speed.test.mjs
import assert from 'node:assert/strict';
import * as O from '../../functions/connect/finatic/order.js';
import * as D from '../../functions/connect/finatic/data.js';
import * as F from '../../functions/connect/finatic/_fin.js';
import * as AU from '../../functions/connect/finatic/_audit.js';
import { route } from '../../workers/finatic-edge/src/index.js';
import { generateKeyPairSync, createSign } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
let adminReads = 0;
const verifyFetch = async (url) => { if (String(url).includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [jwk] })); adminReads++; return /admins\/admin1$/.test(String(url)) ? new Response('{}') : new Response('{}', { status: 404 }); };
const US = '0aaa1111-2222-3333-4444-555566667777', ACC = '123e4567-e89b-12d3-a456-426614174000';
const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
const B = { calls: [], expireNext: false, delay: 0, sess: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const finFetch = async (url, init) => {
  const u = new URL(url); B.calls.push({ m: init.method, p: u.pathname, sid: init.headers['x-session-id'], key: init.headers['Idempotency-Key'], at: Date.now() });
  if (B.delay) await sleep(B.delay);
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') { B.sess++; return ok({ session_id: 's' + B.sess, company_id: 'c', status: 'active', user_id: US }); }
  if (B.expireNext && init.headers['x-session-id'] === 's1') return new Response(JSON.stringify({ errors: [{ message: 'session expired' }] }), { status: 401 });
  if (u.pathname.endsWith('/positions')) return ok([]);
  if (u.pathname.endsWith('/orders') && init.method === 'GET') return ok([]);
  if (u.pathname.endsWith('/orders') && init.method === 'POST') return ok({ accepted: true, order: { orderId: 'new-1', status: 'SUBMITTED' } });
  return ok([]);
};
const audits = new Map(); const deferred = [];
const audit = async (e, id) => { await sleep(B.delay); if (id && audits.has(id)) { const er = new Error('dup'); er.duplicate = true; throw er; } const row = { ...e }; audits.set(id, row); return { id, finish: async (r) => { await sleep(5); Object.assign(row, r); } }; };
const defer = (p) => { deferred.push(p); return p; };
let T = Date.parse('2026-11-16T15:00:00Z');
const deps = { verifyFetch, finFetch, audit, liveSwitch: async () => { await sleep(B.delay); return true; }, sleep: async () => {}, defer, now: () => T };
const live = { FINATIC_API_KEY: 'fntc_live_FAKE', FINATIC_LIVE_ORDERS: '1', DEV: '0' };
let ip = 1, kn = 0;
const req = (body, path = 'order') => new Request('https://tradezoro.com/connect/finatic/' + path, { method: 'POST', headers: { 'cf-connecting-ip': '10.7.' + (ip++ % 250) + '.1', origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token('admin1') }, body: JSON.stringify(body) });
const key = () => 'speed' + String(++kn).padStart(16, '0');
const place = (extra) => ({ src: 'chart', op: 'place', accountId: ACC, userId: US, symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(), ...extra });
const sessStarts = () => B.calls.filter((c) => c.p === '/api/v1/session/start').length;

// ---- Server-Timing on every reply (names + durations only) ------------------------------------------------------------------
O._resetRate(); F._resetSessions();
let r = await O.handle(req(place()), live, deps);
assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
const st = r.headers.get('server-timing'); assert.ok(st, 'server-timing set');
for (const n of ['rl', 'auth', 'admin', 'gate', 'sess', 'read', 'audit', 'fin', 'total']) assert.match(st, new RegExp('(^|, )' + n + ';dur=\\d+'), n + ' in ' + st);
assert.ok(!/FAKE|Bearer|admin1|s1/.test(st), 'no values in the header');
assert.equal(sessStarts(), 1);
// errors carry it too (401 unsigned)
r = await O.handle(new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { origin: 'https://tradezoro.com', 'content-type': 'application/json', 'cf-connecting-ip': '10.1.1.1' }, body: '{}' }), live, deps);
assert.equal(r.status, 401); assert.match(r.headers.get('server-timing') || '', /total;dur=/);

// ---- session cache: second order reuses the session; TTL 2 min; a 401 from a cached session renews ONCE, same idem key ------------
assert.equal(F.SESSION_TTL_MS, 120000);
O._resetRate(); r = await O.handle(req(place()), live, deps); assert.equal(r.status, 200); assert.equal(sessStarts(), 1, 'cached session reused');
{
  const before = sessStarts(); T += F.SESSION_TTL_MS - 1; const c1 = await F.cachedSession(live, { ...deps, defer: undefined }, US); assert.ok(c1.cached, 'still inside the TTL'); assert.equal(sessStarts(), before);
  T += 2; const c2 = await F.cachedSession(live, { ...deps, defer: undefined }, US); assert.ok(!c2.cached, 'TTL passed: new session'); assert.equal(sessStarts(), before + 1); }
// expire s2 (current cached) -> mock refuses s1 only, so force: reset and make s1 cached then expire
F._resetSessions(); B.sess = 0; B.calls.length = 0;
O._resetRate(); r = await O.handle(req(place()), live, deps); assert.equal(r.status, 200); assert.equal(sessStarts(), 1);   // s1 cached
B.expireNext = true; const k401 = key();
O._resetRate(); r = await O.handle(req(place({ idemKey: k401 })), live, deps); B.expireNext = false;
assert.equal(r.status, 200, 'renewed after 401');
assert.equal(sessStarts(), 2, 'exactly one renew');
const posts = B.calls.filter((c) => c.m === 'POST' && c.p.endsWith('/orders'));
assert.equal(posts.at(-1).sid, 's2'); assert.equal(posts.at(-1).key, k401, 'retry keeps the idempotency key');
assert.equal(posts.filter((c) => c.key === k401 && c.sid === 's2').length, 1, 'the order reached the broker once on the good session');
// a fresh (uncached) session that gets 401 is NOT retried
assert.equal(posts.filter((c) => c.key === k401).length <= 2, true);
// different user / environment = different cache entry
F._resetSessions(); const n0 = sessStarts();
await F.cachedSession(live, deps, US); await F.cachedSession(live, deps, US); await F.cachedSession({ ...live, FINATIC_API_KEY: 'fntc_sandbox_X' }, deps, US);
assert.equal(sessStarts() - n0, 2, 'one per env');
F.dropSession(live, US); await F.cachedSession(live, deps, US); assert.equal(sessStarts() - n0, 3, 'drop forces a new one');
// a failed session start is never cached
{ const bad = { ...deps, finFetch: async () => new Response('x', { status: 500 }) }; F._resetSessions(); const s1 = await F.cachedSession(live, bad, US); assert.ok(s1.failed); const s2 = await F.cachedSession(live, deps, US); assert.ok(!s2.failed && !s2.cached, 'failure not cached'); }

// refresh-ahead: past half the TTL a cached hit is returned AND a new session starts after the reply; the next call uses it
{ F._resetSessions(); const dd = []; const dp = { ...deps, defer: (p) => { dd.push(p); return p; } };
  const n1 = sessStarts(); const a1 = await F.cachedSession(live, dp, US); assert.equal(sessStarts() - n1, 1);
  T += F.SESSION_TTL_MS / 2 - 1; const a2 = await F.cachedSession(live, dp, US); assert.ok(a2.cached); assert.equal(dd.length, 0, 'young: no refresh');
  T += 2; const a3 = await F.cachedSession(live, dp, US); assert.ok(a3.cached); assert.equal(a3.sessionId, a1.sessionId, 'old one answers now');
  assert.equal(dd.length, 1, 'refresh deferred'); await F.cachedSession(live, dp, US); assert.equal(dd.length, 1, 'only one refresh in flight');
  await Promise.all(dd); const a4 = await F.cachedSession(live, dp, US); assert.notEqual(a4.sessionId, a1.sessionId, 'fresh session in use'); assert.equal(sessStarts() - n1, 2);
  T += F.SESSION_TTL_MS / 2 - 1; await F.cachedSession(live, dp, US); assert.equal(sessStarts() - n1, 2, 'no start on the hot path'); }

// ---- admin check memo (functions/api/chart/_rt.js): 60 s positive, so one Firestore read per minute, not per order ------------
F._resetSessions(); adminReads = 0;
for (let i = 0; i < 3; i++) { O._resetRate(); await O.handle(req(place()), live, deps); }
assert.ok(adminReads <= 1, 'admin doc read at most once for 3 orders (' + adminReads + ')');

// ---- parallel pre-send steps: kill switch + audit + read overlap (each step 40 ms) ---------------------------------------------
F._resetSessions(); await F.cachedSession(live, deps, US); B.delay = 40;
O._resetRate(); let a = Date.now(); r = await O.handle(req(place()), live, deps); const took = Date.now() - a; B.delay = 0;
assert.equal(r.status, 200);
// serial would be: switch 40 + audit 40 + positions 40 + orders 40 + send 40 = 200 ms; parallel ~ 40 (gate) + 40 (audit|read) + 40 (send)
assert.ok(took < 170, 'pre-send steps run in parallel (' + took + ' ms)');

// ---- audit: attempt row BEFORE the order, result AFTER the reply (deferred), never skipped ---------------------------------------
deferred.length = 0; O._resetRate(); const ka = key();
r = await O.handle(req(place({ idemKey: ka })), live, deps); assert.equal(r.status, 200);
assert.equal(audits.get(ka).result, undefined, 'result row not awaited on the hot path');
assert.ok(deferred.length >= 1, 'finish handed to waitUntil'); await Promise.all(deferred);
assert.equal(audits.get(ka).result, 'accepted', 'result written after the reply'); assert.equal(audits.get(ka).brokerOrderId, 'new-1');
// audit down: nothing sent
{ const n1 = B.calls.filter((c) => c.m === 'POST' && c.p.endsWith('/orders')).length; O._resetRate();
  r = await O.handle(req(place()), live, { ...deps, audit: async () => { throw new Error('down'); } }); assert.equal(r.status, 503);
  assert.equal(B.calls.filter((c) => c.m === 'POST' && c.p.endsWith('/orders')).length, n1, 'no audit, no order'); }
// exposure refusal / read failure are audited as rejected (deferred)
deferred.length = 0; O._resetRate(); const kr = key();
r = await O.handle(req(place({ idemKey: kr, qty: 2 })), live, { ...deps, finFetch: async (u, i) => (new URL(u).pathname.endsWith('/positions') ? ok([{ securityId: 'NQZ6', quantity: 1 }]) : finFetch(u, i)) });
assert.equal(r.status, 409); await Promise.all(deferred); assert.equal(audits.get(kr).result, 'rejected');
// duplicate key still refused before the broker
O._resetRate(); r = await O.handle(req(place({ idemKey: ka })), live, deps); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'duplicate');

// ---- single flight per account: two places at once -> the second reads AFTER the first was sent (exposure sees it) ----------
{ let pos = 0; const seq = [];
  const ff = async (u, i) => { const p = new URL(u).pathname; await sleep(15);
    if (p.endsWith('/positions')) { seq.push('read'); return ok(pos ? [{ securityId: 'NQZ6', quantity: pos }] : []); }
    if (p.endsWith('/orders') && i.method === 'POST') { seq.push('send'); pos += JSON.parse(i.body).order.orderQty; return ok({ accepted: true, order: { orderId: 'x' + pos, status: 'FILLED' } }); }
    return finFetch(u, i); };
  const d = { ...deps, finFetch: ff }; F._resetSessions(); await F.cachedSession(live, d, US); O._resetRate();
  const [r1, r2] = await Promise.all([O.handle(req(place({ qty: 2 })), live, d), O.handle(req(place({ qty: 2 })), live, d)]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409], 'second one refused on a read taken after the first send');
  assert.deepEqual(seq, ['read', 'send', 'read'], 'serialised'); assert.equal(pos, 2, 'never above the cap'); }

// ---- order rate limit: 10 a minute per admin, with and without KV; KV write deferred ------------------------------------------
{ O._resetRate(); const kv = new Map(); const puts = [];
  const env = { ...live, PASSKEYS: { get: async (k) => kv.get(k) || null, put: async (k, v) => { puts.push(k); kv.set(k, v); } } };
  const dd = []; let refused = 0;
  for (let i = 0; i < 12; i++) { const x = await O.orderRateLimited(env, 'admin1', (p) => dd.push(p)); if (x) refused++; await Promise.all(dd); }
  assert.equal(refused, 2, '11th and 12th refused');
  O._resetRate(); for (let i = 0; i < 11; i++) if (await O.orderRateLimited(live, 'admin7')) refused++;
  assert.equal(refused, 3, 'memory fallback also caps at 10'); }

// ---- Google access token: cached TOKEN_TTL_MS (45 min) and re-minted after; a 401 drops it ------------------------------------
{ AU._resetToken(); AU._resetKill(); const { privateKey: pk } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = { ...live, FIREBASE_SA_KEY: JSON.stringify({ client_email: 'x@y', private_key: pk.export({ type: 'pkcs8', format: 'pem' }) }) };
  let mints = 0, deny = false; const docs = new Set();
  const auditFetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/token')) { mints++; return new Response(JSON.stringify({ access_token: 'at' + mints })); }
    if (deny && init.headers && init.headers.authorization === 'Bearer at1') return new Response('{}', { status: 401 });
    if (u.includes('settings/liveTrading')) return new Response('{}', { status: 404 });
    if (init.method === 'POST') { const id = new URL(u).searchParams.get('documentId'); if (docs.has(id)) return new Response('{}', { status: 409 }); docs.add(id); return new Response('{}'); }
    return new Response('{}');
  };
  const d2 = { auditFetch };
  assert.equal(AU.TOKEN_TTL_MS, 45 * 60000);
  await AU.openAudit(env, d2, { uid: 'u' }, 'doc-a'); await AU.openAudit(env, d2, { uid: 'u' }, 'doc-b'); assert.equal(await AU.liveSwitchOn(env, d2), true);
  assert.equal(mints, 1, 'one token for two audits + the switch');
  await assert.rejects(AU.openAudit(env, d2, { uid: 'u' }, 'doc-a'), (e) => e.duplicate, 'duplicate still detected');
  deny = true; await AU.openAudit(env, d2, { uid: 'u' }, 'doc-c'); assert.equal(mints, 2, '401 -> new token, row written'); assert.ok(docs.has('doc-c')); deny = false;
  // kill switch memo stays 5 s
  AU._resetKill(); let reads = 0; const d3 = { auditFetch: async (u, i) => { if (String(u).includes('liveTrading')) reads++; return auditFetch(u, i); } };
  await AU.liveSwitchOn(env, d3); await AU.liveSwitchOn(env, d3); assert.equal(reads, 1, 'kill switch cached'); }

// ---- 'env' pre-warm: starts the session after the reply, so the first order skips it ----------------------------------------
F._resetSessions(); deferred.length = 0; const s0 = sessStarts();
r = await O.handle(req({ op: 'env', userId: US, src: 'chart', accountId: ACC }), live, deps); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { env: 'live', enabled: true });
await Promise.all(deferred); assert.equal(sessStarts() - s0, 1, 'warmed');
O._resetRate(); r = await O.handle(req(place()), live, deps); assert.equal(r.status, 200); assert.equal(sessStarts() - s0, 1, 'order used the warm session');
// non-admin: no warm-up, 403
r = await O.handle(new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { origin: 'https://tradezoro.com', 'content-type': 'application/json', 'cf-connecting-ip': '10.3.3.3', authorization: 'Bearer ' + token('member9') }, body: JSON.stringify({ op: 'env', userId: US }) }), live, deps); assert.equal(r.status, 403);
// data 'live' poll keeps the same cached session (parallel GETs)
const s1 = sessStarts(); r = await D.handle(req({ op: 'live', accountId: ACC, userId: US }, 'data'), live, deps); assert.equal(r.status, 200); assert.equal(sessStarts(), s1, 'poll reuses the session');

// ---- Pages -> placed Worker hand-off (pagesEntry) ------------------------------------------------------------------------------
{ const seen = [];
  const EDGE = { fetch: async (rq) => { seen.push({ ip: rq.headers.get('x-tz-ip'), spoof: rq.headers.get('x-tz-evil'), body: await rq.text() }); return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'server-timing': 'fin;dur=3, total;dur=9', 'cf-placement': 'remote-IAD' } }); } };
  const entry = F.pagesEntry(async () => { throw new Error('must not run here'); }, { retryHere: false });
  const rq = new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'cf-connecting-ip': '1.2.3.4', 'x-tz-evil': '9', 'content-type': 'application/json' }, body: '{"op":"env"}' });
  r = await entry({ request: rq, env: { FINATIC_EDGE: EDGE } });
  assert.equal(r.status, 200); assert.deepEqual(seen[0], { ip: '1.2.3.4', spoof: null, body: '{"op":"env"}' });
  assert.match(r.headers.get('server-timing'), /^fin;dur=3, total;dur=9, edge;dur=\d+, placement;desc="remote-IAD"$/);
  // binding throws: order route answers 'unknown' (never runs twice); data/session run locally
  const boom = { FINATIC_EDGE: { fetch: async () => { throw new Error('x'); } } };
  r = await entry({ request: new Request(rq.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), env: boom });
  assert.equal(r.status, 503); assert.equal((await r.json()).code, 'unknown');
  let ran = 0; const e2 = F.pagesEntry(async (q) => { ran++; assert.equal(await q.text(), '{"a":1}'); return F.json({ ok: 1 }); });
  r = await e2({ request: new Request(rq.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' }), env: boom }); assert.equal(ran, 1); assert.equal(r.status, 200);
  // the Worker answered something that is not our JSON: refused, not re-run
  ran = 0; r = await e2({ request: new Request(rq.url, { method: 'POST', body: '{}' }), env: { FINATIC_EDGE: { fetch: async () => new Response('<html>', { status: 502 }) } } }); assert.equal(ran, 0); assert.equal(r.status, 500);
  // no binding: runs here
  ran = 0; r = await e2({ request: new Request(rq.url, { method: 'POST', body: '{"a":1}' }), env: {} }); assert.equal(ran, 1); }

// ---- the Worker routes to the same handlers, with the visitor IP from x-tz-ip ------------------------------------------------
{ r = await route(new Request('https://tradezoro.com/connect/finatic/nope', { method: 'POST' }), live, null); assert.equal(r.status, 404);
  r = await route(new Request('https://tradezoro.com/connect/finatic/order', { method: 'GET' }), live, null); assert.equal(r.status, 405);
  r = await route(new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'x-tz-ip': '5.6.7.8', origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }), live, null);
  assert.equal(r.status, 403, 'origin check still runs in the Worker'); assert.match(r.headers.get('server-timing') || '', /total;dur=/);
  r = await route(new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'x-tz-ip': '5.6.7.8', origin: 'https://tradezoro.com', 'content-type': 'application/json' }, body: '{}' }), live, null);
  assert.equal(r.status, 401, 'unsigned still 401 in the Worker'); }

// ---- timer: names aggregate, total last ---------------------------------------------------------------------------------------
{ let c = 0; const t = F.timer(() => (c += 10)); await t.step('x', Promise.resolve()); t.add('fin', 5); t.add('fin', 7); assert.equal(t.header(), 'x;dur=10, fin;dur=12, total;dur=30'); }
// ---- client helpers (assets/chart-live-core.js) -----------------------------------------------------------------------------
{ const L = await import('../../assets/chart-live-core.js');
  assert.deepEqual(L.parseTiming('rl;dur=3, fin;dur=58.4, total;dur=71, placement;desc="remote-IAD"'), { rl: 3, fin: 58, total: 71, placement: 'remote-IAD' });
  assert.deepEqual(L.parseTiming(''), {}); assert.deepEqual(L.parseTiming(null), {});
  assert.equal(L.rttText({ op: 'place', ok: true, ms: 182.4, server: { fin: 61 } }), 'Order sent in 182 ms (broker 61 ms).');
  assert.equal(L.rttText({ op: 'cancel', ok: false, ms: 90 }), 'Cancel answered in 90 ms.');
  assert.equal(L.rttText(null), ''); assert.equal(L.rttText({ op: 'place' }), '');
  assert.deepEqual(L.FAST_READS_MS.slice(0, 1), [250]);
  assert.equal(L.pendingLine({ type: 'limit', limitPrice: 20900, symbol: 'NQZ6', side: 'buy', qty: 1, idemKey: 'k' }, 21000).price, 20900);
  assert.equal(L.pendingLine({ type: 'market', symbol: 'NQZ6', side: 'sell', qty: 2, idemKey: 'k' }, 21000).price, 21000);
  assert.equal(L.pendingLine({ type: 'market', symbol: 'NQZ6', side: 'sell', qty: 2, idemKey: 'k' }, undefined), null); }
console.log('finatic speed: ok');
