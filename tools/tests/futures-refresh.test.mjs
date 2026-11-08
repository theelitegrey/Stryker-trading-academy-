// Futures chart loads the same way every time (member bug 2026-11-05). Run: node tools/tests/futures-refresh.test.mjs
// One test per root cause fixed:
//  1. rt-access: an unreachable /api/chart/rt is UNKNOWN, never "not entitled" (it used to set ready + admin=false: the 10-minute pill
//     and the 10-minute bars on that load). A new user's answer starts unknown. rtHeadersReady waits for the answer, not 4 s.
//  2. provider page memo: keyed by lane, so rows read before the answer (10-minute lane) are never served to the current lane.
//  3. bars endpoint: a signed-in "no" is never cacheable (it was public, max-age=15 under the same hour-long token).
//  4. pill copy follows the futures copy rule (no delayed / behind / live / real-time).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const RT = await import('../../assets/rt-access.js?v=918');   // the same instance the provider imports
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const user = (uid) => ({ uid, getIdToken: async () => 'tok-' + uid });
const realFetch = globalThis.fetch;

// ---- 1. unknown is not "no"
let answer = 'fail';
globalThis.fetch = async (url) => {
  if (!String(url).includes('/api/chart/rt')) return realFetch(url);
  if (answer === 'fail') return new Response('x', { status: 503 });
  return new Response(JSON.stringify({ admin: answer === 'yes' }), { status: 200 });
};
RT._rtResetForTests();
await RT._rtOnUserForTests(user('u1'));
assert.equal(RT.rtKnown(), false, 'server unreachable: the answer stays unknown');
assert.equal(RT.rtState().known, false);
assert.equal(RT.isRealtimeAdmin(), false, 'unknown is not live either');
// the re-ask comes fast (1 s first) and decides it
answer = 'yes';
await wait(1300);
assert.equal(RT.rtKnown(), true, 'fast re-ask decides it');
assert.equal(RT.isRealtimeAdmin(), true, 'entitled member: live');
assert.deepEqual(RT.rtHeaders(), { authorization: 'Bearer tok-u1' });
// a different user starts unknown, not with u1's yes
answer = 'fail';
await RT._rtOnUserForTests(user('u2'));
assert.equal(RT.rtKnown(), false, 'new user: unknown');
assert.equal(RT.isRealtimeAdmin(), false, 'new user never inherits the old yes');
// a definite no is known (the pill may show)
answer = 'no';
await RT.rtRecheck(true);
assert.equal(RT.rtKnown(), true); assert.equal(RT.isRealtimeAdmin(), false);
// signed out: known, not live
await RT._rtOnUserForTests(null);
assert.equal(RT.rtKnown(), true); assert.equal(RT.isRealtimeAdmin(), false);
RT._rtResetForTests();
globalThis.fetch = realFetch;

// rtHeadersReady waits for the answer (ready), so the first bars carry the decided lane
const src = readFileSync(new URL('../../assets/rt-access.js', import.meta.url), 'utf8');
assert.match(src, /export async function rtHeadersReady\(ms = 15000\) \{\n  if \(!st\.ready\) await Promise\.race\(\[readyP/, 'rtHeadersReady waits for the decided answer (15 s cap)');


// ---- 2. lane-keyed page memo
const P = await import('../../assets/chart-futures-provider.js');
RT._rtSetForTests(false, '');
assert.equal(P.laneOf(), 'd');
const calls = [];
globalThis.fetch = async (url, init) => { calls.push(String(url)); const rt = P.laneOf() === 'rt'; return new Response(JSON.stringify({ bars: [[1000, rt ? 2 : 1, 2, 1, 2, 1]], rt })); };
const prov = new P.FuturesProvider({ base: 'https://t/api/chart/bars/' });
const a = await prov.fetchPage('NQ', '1', 5, 99, 0);
assert.equal(a[0][1], 1);
RT._rtSetForTests(true, 'tok');
assert.equal(P.laneOf(), 'rt');
const b = await prov.fetchPage('NQ', '1', 5, 99, 0);   // a CLOSED page: before the fix this came from memory (the 10-minute-lane rows)
assert.equal(calls.length, 2, 'the current lane re-reads the page, never reuses the other lane\'s rows');
assert.equal(b[0][1], 2);
assert.ok([...P._pagesForTests.keys()].every((k) => /\|(rt|d)$/.test(k)), 'every memo key carries its lane');
globalThis.fetch = realFetch;

// the futures cells reload cleanly when the lane changes (one series never mixes the two lanes)
const rep = readFileSync(new URL('../../assets/chart-bar-replay.js', import.meta.url), 'utf8');
assert.match(rep, /rtOnChange\(\(\) => \{ const now = laneOf\(\); if \(now === lane\) return; lane = now; if \(!S\.on\) reloadFutures\(\); \}\)/);
// the hub path follows liveVisible on every auth change (it used to try once and stay on the 10-minute poll for the whole load)
const prv = readFileSync(new URL('../../assets/chart-futures-provider.js', import.meta.url), 'utf8');
assert.match(prv, /const want = m\.liveVisible\(\) \? 'hub' : 'poll';/);

// the hub socket is not closed for a "book retry" unless the plan is known and not Free (a Free member live by the agreement was dropped twice per load)
const l2 = readFileSync(new URL('../../assets/chart-futures-l2.js', import.meta.url), 'utf8');
assert.match(l2, /liveVisible\(\) && tierKnown\(\) && !isFree\(\) && !testOn0\(\)/);

// ---- 3. bars endpoint: a signed-in "no" is not cacheable
const bars = readFileSync(new URL('../../functions/api/chart/bars/[sym].js', import.meta.url), 'utf8');
assert.match(bars, /if \(hadToken && !admin\) \{ out\.headers\.set\('x-tz-auth', 'not-admin-or-rejected'\); out\.headers\.set\('cache-control', 'private, no-store'\); \}/);
const { onRequestGet: barsGet } = await import('../../functions/api/chart/bars/[sym].js');
globalThis.fetch = async (url) => (String(url).includes('finance.yahoo.com')
  ? new Response(JSON.stringify({ chart: { result: [{ meta: {}, timestamp: [Math.floor(Date.now() / 1000) - 3600], indicators: { quote: [{ open: [1], high: [1], low: [1], close: [1], volume: [1] }] } }], error: null } }))
  : new Response('{}', { status: 404 }));
const r = await barsGet({ request: new Request('https://x/api/chart/bars/NQ?tf=1', { headers: { authorization: 'Bearer not.a.jwt' } }), params: { sym: 'NQ' }, env: {}, waitUntil() {} });
assert.equal(r.headers.get('x-tz-rt'), '0');
assert.equal(r.headers.get('cache-control'), 'private, no-store', 'signed-in no: not stored');
const r0 = await barsGet({ request: new Request('https://x/api/chart/bars/NQ?tf=1'), params: { sym: 'NQ' }, env: {}, waitUntil() {} });
assert.match(r0.headers.get('cache-control'), /public/, 'signed out: shared lane, still edge-cacheable');
globalThis.fetch = realFetch;

// ---- 4. pill copy
const ban = readFileSync(new URL('../../assets/chart-data-banner.js', import.meta.url), 'utf8');
const pill = /pill\.innerHTML = '([^\n]+)';/.exec(ban)[1] + /pill\.setAttribute\('aria-label', '([^']+)'\)/.exec(ban)[1];
assert.doesNotMatch(pill, /delayed|behind|live|real-time|realtime/i, 'pill copy rule');
assert.match(pill, /Updated 10 min ago/); assert.match(pill, /Sign the free data agreement/);
assert.doesNotMatch(ban, /setTimeout\(\(\) => \{ ready = true; sync\(\); \}, 6000\)/, 'the pill no longer shows on a 6 s timer');

console.log('futures-refresh: all ok');
process.exit(0);
