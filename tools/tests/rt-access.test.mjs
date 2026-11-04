// Real-time futures access gate (Owner order 2026-10-16). Run: node tools/tests/rt-access.test.mjs
// Uses a throwaway RSA key and stubbed Google endpoints; no real token or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as A from '../../functions/api/chart/_rt.js';
import * as B from '../../workers/book-recorder/src/rt-auth.js';
import { redactFutures } from '../../workers/book-recorder/src/terminal.js';
import { delayRows, onRequestGet as barsGet } from '../../functions/api/chart/bars/[sym].js';
import { onRequestGet as streamGet } from '../../functions/api/chart/stream/[sym].js';
import { onRequestGet as rtGet } from '../../functions/api/chart/rt.js';

// the worker copy must be the same code
assert.equal(readFileSync(new URL('../../functions/api/chart/_rt.js', import.meta.url), 'utf8'), readFileSync(new URL('../../workers/book-recorder/src/rt-auth.js', import.meta.url), 'utf8'), 'rt-auth.js copies differ');

const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = (b) => Buffer.from(b).toString('base64url');
async function mint(over = {}, key = kp.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'uid-admin', iat: now - 5, exp: now + 3600, ...over }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(sig);
}
const studentDocs = { 'uid-demo': { demo: { booleanValue: true } }, 'uid-demo-false': { demo: { booleanValue: false } }, 'uid-demo-str': { demo: { stringValue: 'true' } }, 'uid-pro': { plan: { stringValue: 'Pro' }, subscriptionStatus: { stringValue: 'active' }, paidThroughMillis: { integerValue: String(Date.now() + 86400e3) } }, 'uid-pro-nopt': { plan: { stringValue: 'Pro' } }, 'uid-pro-grace': { plan: { stringValue: 'Pro' }, subscriptionStatus: { stringValue: 'grace' }, paidThroughMillis: { integerValue: String(Date.now() - 86400e3) } }, 'uid-pro-lapsed': { plan: { stringValue: 'Pro' }, paidThroughMillis: { integerValue: String(Date.now() - 5 * 86400e3) } }, 'uid-pro-expired': { plan: { stringValue: 'Pro' }, subscriptionStatus: { stringValue: 'expired' } }, 'uid-ld': { plan: { stringValue: 'Starter' }, liveData: { mapValue: { fields: { active: { booleanValue: true }, paidThroughMillis: { integerValue: String(Date.now() + 86400e3) }, source: { stringValue: 'stripe' } } } } }, 'uid-ld-grace': { liveData: { mapValue: { fields: { active: { booleanValue: true }, paidThroughMillis: { integerValue: String(Date.now() - 86400e3) } } } } }, 'uid-ld-pro': { plan: { stringValue: 'Pro' }, liveData: { mapValue: { fields: { active: { booleanValue: true }, paidThroughMillis: { integerValue: String(Date.now() + 86400e3) } } } } }, 'uid-ld-lapsed': { liveData: { mapValue: { fields: { active: { booleanValue: true }, paidThroughMillis: { integerValue: String(Date.now() - 5 * 86400e3) } } } } }, 'uid-ld-off': { liveData: { mapValue: { fields: { active: { booleanValue: false }, paidThroughMillis: { integerValue: String(Date.now() + 86400e3) } } } } }, 'uid-ld-str': { liveData: { stringValue: 'true' } }, 'uid-ld-manual': { liveData: { mapValue: { fields: { active: { booleanValue: true }, source: { stringValue: 'manual' } } } } }, 'uid-gf': { plan: { stringValue: 'Pro' }, subscriptionStatus: { stringValue: 'active' }, paidThroughMillis: { integerValue: String(Date.now() + 86400e3) }, liveFeed: { booleanValue: true }, liveFeedGrandfathered: { booleanValue: true } }, 'uid-gf-found': { plan: { stringValue: 'Pro' }, foundingMember: { booleanValue: true }, liveFeed: { booleanValue: true }, liveFeedGrandfathered: { booleanValue: true } }, 'uid-gf-trial': { plan: { stringValue: 'Pro' }, subscriptionStatus: { stringValue: 'trialing' }, liveFeed: { booleanValue: true }, liveFeedGrandfathered: { booleanValue: true } }, 'uid-gf-cancelled': { plan: { stringValue: 'Pro' }, subscriptionStatus: { stringValue: 'cancelled' }, liveFeed: { booleanValue: true }, liveFeedGrandfathered: { booleanValue: true } }, 'uid-gf-expired': { plan: { stringValue: 'Pro' }, paidThroughMillis: { integerValue: String(Date.now() - 5 * 86400e3) }, liveFeed: { booleanValue: true }, liveFeedGrandfathered: { booleanValue: true } }, 'uid-gf-trialend': { plan: { stringValue: 'Free' }, subscriptionStatus: { stringValue: 'expired' }, liveFeed: { booleanValue: true }, liveFeedGrandfathered: { booleanValue: true } }, 'uid-gf-addon': { plan: { stringValue: 'Free' }, liveFeed: { booleanValue: true }, liveFeedGrandfathered: { booleanValue: true }, liveData: { mapValue: { fields: { active: { booleanValue: true } } } } }, 'uid-gf-flagfalse': { plan: { stringValue: 'Free' }, liveFeed: { booleanValue: true }, liveFeedGrandfathered: { booleanValue: false } }, 'uid-starter': { plan: { stringValue: 'Starter' } }, 'uid-live': { plan: { stringValue: 'Starter' }, liveFeed: { booleanValue: true } }, 'uid-live-str': { liveFeed: { stringValue: 'true' } }, 'uid-live-false': { liveFeed: { booleanValue: false } }, 'uid-mda': { plan: { stringValue: 'Free' }, marketDataAgreement: { mapValue: { fields: { version: { stringValue: A.MDA_VERSION }, nonProfessional: { booleanValue: true } } } } }, 'uid-mda-old': { plan: { stringValue: 'Free' }, marketDataAgreement: { mapValue: { fields: { version: { stringValue: 'v0' }, nonProfessional: { booleanValue: true } } } } }, 'uid-mda-pro': { marketDataAgreement: { mapValue: { fields: { version: { stringValue: A.MDA_VERSION }, nonProfessional: { booleanValue: false } } } } }, 'uid-mda-str': { marketDataAgreement: { stringValue: 'v1' } }, 'uid-free': { plan: { stringValue: 'Free' } } };
let adminUids = new Set(['uid-admin']), fsDown = false, fsCalls = 0;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('securetoken@system')) return new Response(JSON.stringify({ keys: [jwk] }));
  if (url.includes('firestore.googleapis.com')) {
    fsCalls++;
    if (fsDown) return new Response('x', { status: 503 });
    if (url.includes('/documents/plans')) return new Response(JSON.stringify({ documents: [
      { name: 'x/plans/Sj1', fields: { name: { stringValue: 'Pro' }, rank: { integerValue: '1' } } },
      { name: 'x/plans/proYearly', fields: { name: { stringValue: 'Pro' }, rank: { stringValue: '1' } } },
      { name: 'x/plans/St', fields: { name: { stringValue: 'Starter' }, rank: { integerValue: '0' } } }] }), { status: 200 });
    if (url.includes('/students/')) {
      const su = decodeURIComponent(url.split('/students/')[1]);
      if (fsDown) return new Response('x', { status: 503 });
      if (!(su in studentDocs)) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ fields: studentDocs[su] }), { status: 200 });
    }
    const uid = decodeURIComponent(url.split('/admins/')[1]);
    assert.ok(/^Bearer /.test(init.headers.authorization));
    return adminUids.has(uid) ? new Response('{}', { status: 200 }) : new Response('{}', { status: 403 });
  }
  throw new Error('unexpected fetch ' + url);
};

for (const M of [A, B]) {
  M._resetForTests();
  assert.equal(await M.verifyIdToken(await mint()), 'uid-admin');
  assert.equal(await M.verifyIdToken(await mint({ exp: 1 })), null, 'expired');
  assert.equal(await M.verifyIdToken(await mint({ aud: 'other' })), null, 'aud');
  assert.equal(await M.verifyIdToken(await mint({ iss: 'https://evil' })), null, 'iss');
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  assert.equal(await M.verifyIdToken(await mint({}, other.privateKey)), null, 'forged signature');
  const t = await mint(); const [h, p, s] = t.split('.');
  assert.equal(await M.verifyIdToken(h + '.' + b64u(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'uid-evil', exp: 9e9, iat: 1 })) + '.' + s), null, 'tampered payload');
  assert.equal(await M.verifyIdToken(''), null); assert.equal(await M.verifyIdToken('a.b.c'), null);
  assert.equal(await M.isAdminToken(await mint()), true, 'admin');
  assert.equal(await M.isAdminToken(await mint({ sub: 'uid-free' })), false, 'free user');
  assert.equal(await M.isAdminToken(await mint({ sub: 'uid-pro' })), false, 'pro user');
  assert.equal(await M.isAdminToken(''), false, 'signed out');
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-demo' })), true, 'demo account gets real-time');
  assert.equal(await M.isAdminToken(await mint({ sub: 'uid-demo' })), false, 'demo is not admin');
  for (const u of ['uid-demo-false', 'uid-demo-str', 'uid-starter', 'uid-pro-lapsed', 'uid-pro-expired', 'uid-none', 'uid-ld-lapsed', 'uid-ld-off', 'uid-ld-str']) assert.equal(await M.isRealtimeToken(await mint({ sub: u })), false, 'no real-time for ' + u);
  // grandfathered early Pro members (Owner 2026-10-30): live only while Pro stays active
  for (const u of ['uid-gf', 'uid-gf-found', 'uid-gf-trial', 'uid-gf-addon', 'uid-gf-flagfalse']) assert.equal(await M.isRealtimeToken(await mint({ sub: u })), true, 'grandfathered live: ' + u);
  for (const u of ['uid-gf-cancelled', 'uid-gf-expired', 'uid-gf-trialend']) assert.equal(await M.isRealtimeToken(await mint({ sub: u })), false, 'grandfathered but Pro ended: ' + u);
  // Owner 2026-10-30: Pro alone no longer includes real-time futures
  for (const u of ['uid-pro', 'uid-pro-nopt', 'uid-pro-grace']) assert.equal(await M.isRealtimeToken(await mint({ sub: u })), false, 'Pro without add-on is delayed: ' + u);
  for (const u of ['uid-ld', 'uid-ld-grace', 'uid-ld-pro', 'uid-ld-manual']) assert.equal(await M.isRealtimeToken(await mint({ sub: u })), true, 'active add-on gets real-time: ' + u);
  assert.equal(M.isActiveLiveDataDoc({ liveData: { mapValue: { fields: { active: { booleanValue: true }, paidThroughMillis: { integerValue: '1000' } } } } }, 1000 + 3 * 86400e3 + 1), false, 'past grace');
  assert.equal(M.isActiveLiveDataDoc({ liveData: { mapValue: { fields: { active: { booleanValue: true }, paidThroughMillis: { integerValue: '1000' } } } } }, 1000 + 3 * 86400e3 - 1), true, 'inside grace');
  assert.equal(await M.isAdminToken(await mint({ sub: 'uid-pro' })), false, 'Pro is not admin');
  assert.equal(await M.isRealtimeToken(''), false, 'signed out');
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-demo', exp: 1 })), false, 'expired demo token');
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-demo' }, kp.privateKey).then((t) => t.slice(0, -4) + 'AAAA')), false, 'bad signature');
  assert.equal(await M.isRealtimeToken(await mint()), true, 'admin still real-time');
  // per-user live feed (students/{uid}.liveFeed === true, admin-set, 2026-10-26)
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-live' })), true, 'liveFeed member gets real-time');
  assert.equal(await M.isAdminToken(await mint({ sub: 'uid-live' })), false, 'liveFeed member is not admin');
  for (const u of ['uid-live-str', 'uid-live-false']) assert.equal(await M.isRealtimeToken(await mint({ sub: u })), false, 'no real-time for ' + u);
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-live', exp: 1 })), false, 'expired liveFeed token');
  // switched OFF: still on inside the memo, cut once the 30 s memo runs out (well inside 1 min)
  {
    const realNow = Date.now, t0 = realNow(), tok = await mint({ sub: 'uid-live' });
    try {
      studentDocs['uid-live'].liveFeed = { booleanValue: false };
      Date.now = () => t0 + 20000; assert.equal(await M.isRealtimeToken(tok), true, 'inside the memo');
      Date.now = () => t0 + 31000; assert.equal(await M.isRealtimeToken(tok), false, 'switched off: cut after the 30 s memo');
      studentDocs['uid-live'].liveFeed = { booleanValue: true };
      Date.now = () => t0 + 62000; assert.equal(await M.isRealtimeToken(tok), true, 'switched back on');
    } finally { Date.now = realNow; studentDocs['uid-live'].liveFeed = { booleanValue: true }; }
  }
  // Free live L1 with the current Market Data Agreement (Owner 2026-11-04)
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-mda' })), true, 'Free + agreement: live L1');
  for (const u of ['uid-free', 'uid-mda-old', 'uid-mda-pro', 'uid-mda-str']) assert.equal(await M.isRealtimeToken(await mint({ sub: u })), false, 'no live L1 for ' + u);
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-mda', exp: 1 })), false, 'expired token + agreement');
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-mda', firebase: { sign_in_provider: 'anonymous' } })), false, 'anonymous token refused');
  assert.equal(await M.isGexProToken(await mint({ sub: 'uid-mda' })), false, 'agreement does not open GEX+ / the L2 book (Pro gate)');
  assert.equal(await M.isAdminToken(await mint({ sub: 'uid-mda' })), false, 'agreement is not admin');
  fsDown = true; M._resetForTests();
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-demo' })), false, 'outage fails closed (demo)');
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-mda' })), false, 'outage fails closed (agreement)');
  assert.equal(await M.isRealtimeToken(await mint({ sub: 'uid-live' })), false, 'outage fails closed (liveFeed)');
  assert.equal(await M.isAdminToken(await mint()), false, 'Firestore outage fails closed');
  fsDown = false;
}
assert.equal(A.wsTokenOf(new Request('https://x/', { headers: { 'sec-websocket-protocol': 'tz-auth, abc.def.ghi' } })), 'abc.def.ghi');
assert.equal(A.wsTokenOf(new Request('https://x/')), '');
assert.equal(A.bearerOf(new Request('https://x/', { headers: { authorization: 'Bearer tok' } })), 'tok');

// stream: refused without an admin token (no upstream is opened)
const env = { INSIGHTSENTRY_WEBSOCKET_API_KEY: 'x'.repeat(8) };
const wsReq = (hd) => new Request('https://tradezoro.com/api/chart/stream/NQ?tf=1', { headers: { upgrade: 'websocket', origin: 'https://tradezoro.com', ...hd } });
A._resetForTests();
assert.equal((await streamGet({ request: wsReq({}), params: { sym: 'NQ' }, env })).status, 403, 'signed-out stream');
assert.equal((await streamGet({ request: wsReq({ 'sec-websocket-protocol': 'tz-auth, ' + await mint({ sub: 'uid-starter' }) }), params: { sym: 'NQ' }, env })).status, 403, 'non-admin stream');
assert.equal((await streamGet({ request: wsReq({ 'sec-websocket-protocol': 'tz-auth, junk' }), params: { sym: 'NQ' }, env })).status, 403, 'junk token');
assert.equal((await streamGet({ request: wsReq({ 'sec-websocket-protocol': 'tz-auth, ' + await mint({ sub: 'uid-live-false' }) }), params: { sym: 'NQ' }, env })).status, 403, 'liveFeed false stream');

// /api/chart/rt
const rtRes = async (tok) => (await rtGet({ request: new Request('https://x/api/chart/rt', { headers: tok ? { authorization: 'Bearer ' + tok } : {} }) })).json();
assert.deepEqual(await rtRes(''), { admin: false });
assert.deepEqual(await rtRes(await mint()), { admin: true });
assert.deepEqual(await rtRes(await mint({ sub: 'uid-live' })), { admin: true }, '/rt says yes for a liveFeed member');
assert.deepEqual(await rtRes(await mint({ sub: 'uid-pro' })), { admin: false }, '/rt says no for Pro without the add-on');
assert.deepEqual(await rtRes(await mint({ sub: 'uid-ld' })), { admin: true }, '/rt says yes for an active add-on member');
assert.deepEqual(await rtRes(await mint({ sub: 'uid-pro-expired' })), { admin: false }, '/rt says no for an expired Pro');
assert.deepEqual(await rtRes(await mint({ sub: 'uid-starter' })), { admin: false }, '/rt says no for a normal member');
assert.deepEqual(await rtRes(await mint({ sub: 'uid-mda' })), { admin: true }, '/rt says yes for Free + agreement');
assert.deepEqual(await rtRes(await mint({ sub: 'uid-mda-old' })), { admin: false }, '/rt says no for an old agreement version');

// /api/chart/bars end to end (Yahoo stubbed): liveFeed member = real-time lane, member / signed out = cut 10 min
{
  const realFetch = globalThis.fetch, nowS = Math.floor(Date.now() / 1000);
  const ts = []; for (let t = Math.floor((nowS - 3600) / 60) * 60; t <= nowS; t += 60) ts.push(t);
  const q = ts.map(() => 1);
  globalThis.fetch = async (url, init) => String(url).includes('finance.yahoo.com')
    ? new Response(JSON.stringify({ chart: { result: [{ meta: {}, timestamp: ts, indicators: { quote: [{ open: q, high: q, low: q, close: q, volume: q }] } }], error: null } }), { status: 200 })
    : realFetch(url, init);
  try {
    const bars = async (tok) => { const r = await barsGet({ request: new Request('https://x/api/chart/bars/NQ?tf=1', { headers: tok ? { authorization: 'Bearer ' + tok } : {} }), params: { sym: 'NQ' }, env: {}, waitUntil() {} }); return { rt: r.headers.get('x-tz-rt'), body: await r.json() }; };
    A._resetForTests();
    const live = await bars(await mint({ sub: 'uid-live' }));
    assert.notEqual(live.rt, '0', 'liveFeed member: real-time lane'); assert.notEqual(live.body.rt, false);
    const mda = await bars(await mint({ sub: 'uid-mda' }));
    assert.notEqual(mda.rt, '0', 'Free + agreement: real-time bars (L1 200)'); assert.notEqual(mda.body.rt, false);
    assert.equal((await bars(await mint({ sub: 'uid-mda-old' }))).rt, '0', 'old agreement: delayed bars');
    assert.equal((await bars(await mint({ sub: 'uid-free' }))).rt, '0', 'Free without agreement: delayed bars');
    for (const [who, tok] of [['normal member', await mint({ sub: 'uid-starter' })], ['signed out', '']]) {
      const d = await bars(tok);
      assert.equal(d.rt, '0', who + ': x-tz-rt 0'); assert.equal(d.body.rt, false, who + ': rt false');
      const last = d.body.bars.length ? d.body.bars[d.body.bars.length - 1][0] : 0;
      assert.ok(d.body.bars.length && last <= Math.floor(Date.now() / 1000) - 600, who + ': nothing newer than now - 10 min');
    }
  } finally { globalThis.fetch = realFetch; }
}

// bars: nothing newer than now - 10 min
const now = 1_800_000_000;
const rows = [[now - 1200, 1, 1, 1, 1, 1], [now - 600, 1, 1, 1, 1, 1], [now - 599, 1, 1, 1, 1, 1], [now - 60, 1, 1, 1, 1, 1], [now, 1, 1, 1, 1, 1]];
assert.deepEqual(delayRows(rows, now).map((r) => r[0]), [now - 1200, now - 600]);

// recorder: market map / brief futures prices hidden for non-admins
const map = { groups: [{ id: 'commodities', rows: [{ ticker: 'CLUSD', price: 95.66 }] }, { id: 'fx', rows: [{ ticker: 'EURUSD', price: 1.12 }] }] };
redactFutures('market-map', map);
assert.equal(map.groups[0].rows[0].price, null); assert.equal(map.groups[1].rows[0].price, 1.12);
const brief = { bullets: [{ title: 'Dollar and commodities: crude -1%', text: 'Currencies: EUR/USD 1.1247. Commodities, front-month futures: WTI crude 95.66 (-1.94%).' }] };
redactFutures('market-brief', brief);
assert.ok(!/95\.66|front-month/.test(JSON.stringify(brief)), JSON.stringify(brief));
assert.ok(/EUR\/USD 1\.1247/.test(brief.bullets[0].text));

// GEX+ is Pro only (Owner 2026-11-01): admin, demo and an ACTIVE paid plan pass; Starter, lapsed/expired Pro, no plan, signed out and junk do not
for (const M of [A, B]) {
  M._resetForTests();
  for (const u of ['uid-admin', 'uid-demo', 'uid-pro']) assert.equal(await M.isGexProToken(await mint({ sub: u })), true, 'GEX allowed: ' + u);
  for (const u of ['uid-starter', 'uid-pro-lapsed', 'uid-pro-expired', 'uid-none', 'uid-demo-false']) assert.equal(await M.isGexProToken(await mint({ sub: u })), false, 'GEX refused: ' + u);
  assert.equal(await M.isGexProToken(''), false, 'GEX refused signed out');
  assert.equal(await M.isGexProToken('a.b.c'), false, 'GEX refused junk token');
  fsDown = true; M._resetForTests();
  assert.equal(await M.isGexProToken(await mint({ sub: 'uid-pro' })), false, 'GEX fails closed on an outage');
  fsDown = false; M._resetForTests();
}
{
  const { onRequestGet: lv } = await import('../../functions/api/gex/levels/[name].js');
  const { onRequestGet: lad } = await import('../../functions/api/gex/ladder.js');
  const { onRequestGet: flow } = await import('../../functions/api/gex/flow/[name].js');
  const { onRequestGet: cand } = await import('../../functions/api/gex/candles/[fut].js');
  A._resetForTests();
  const call = async (fn, path, params, tok) => fn({ request: new Request('https://x' + path, { headers: tok ? { authorization: 'Bearer ' + tok } : {} }), params, env: {} });
  for (const [who, tok] of [['signed out', ''], ['Starter', await mint({ sub: 'uid-starter' })], ['lapsed Pro', await mint({ sub: 'uid-pro-lapsed' })]]) {
    for (const [fn, path, params] of [[lv, '/api/gex/levels/SPX?dte=0', { name: 'SPX' }], [lad, '/api/gex/ladder?u=SPX&dte=0', {}], [flow, '/api/gex/flow/SPX', { name: 'SPX' }], [cand, '/api/gex/candles/ES?interval=5m', { fut: 'ES' }]]) {
      const r = await call(fn, path, params, tok);
      assert.equal(r.status, 403, who + ' ' + path);
      const j = await r.json(); assert.deepEqual(Object.keys(j).sort(), ['error', 'message'], 'no GEX data in the refusal'); assert.equal(j.error, 'pro_required');
      assert.equal(r.headers.get('cache-control'), 'no-store');
    }
  }
}
// /ts-live tiers: Free + agreement = 'trades' (L1) only, never 'book' (L2); Pro unchanged; no agreement = refused
{
  const { tsTier, tsAllowed } = await import('../../workers/book-recorder/src/ts-access.js');
  B._resetForTests();
  const pro = { TS_ACCESS: 'pro' };
  assert.equal(await tsTier(pro, await mint({ sub: 'uid-mda' })), 'trades', 'Free + agreement: L1 tier');
  assert.equal(await tsAllowed(pro, await mint({ sub: 'uid-mda' })), false, 'Free + agreement: no L2 history routes');
  assert.equal(await tsTier(pro, await mint({ sub: 'uid-free' })), null, 'Free without agreement: refused');
  assert.equal(await tsTier(pro, await mint({ sub: 'uid-mda-old' })), null, 'old agreement: refused');
  assert.equal(await tsTier(pro, await mint({ sub: 'uid-pro' })), 'book', 'Pro: L2 book unchanged');
  assert.equal(await tsTier(pro, await mint({ sub: 'uid-mda', exp: 1 })), null, 'expired token: refused');
  assert.equal(await tsTier({}, await mint({ sub: 'uid-mda' })), 'trades', 'admin-only book mode: agreement still L1 only');
}
// stream + bars for Free + agreement
assert.equal((await streamGet({ request: wsReq({ 'sec-websocket-protocol': 'tz-auth, ' + await mint({ sub: 'uid-free' }) }), params: { sym: 'NQ' }, env })).status, 403, 'Free without agreement: stream 403');
assert.equal((await streamGet({ request: wsReq({ 'sec-websocket-protocol': 'tz-auth, ' + await mint({ sub: 'uid-mda-old' }) }), params: { sym: 'NQ' }, env })).status, 403, 'old agreement: stream 403');
console.log('rt-access: all ok');
