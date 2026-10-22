// Unit test for the futures stream bridge tick mode (functions/api/chart/stream/[sym].js).
//   node tools/tests/chart-stream-ticks.test.mjs
// Fakes the Pages WebSocketPair and the recorder's IS hub socket (since 2026-10-22 the bridge never opens an
// InsightSentry socket; it attaches to /is-live): the series leg sends one forming 1m bar, the tick leg 300 trades. Asserts: both legs subscribed, trades fold into the
// forming bar (close/high/low/volume), at most ~10 'bar' messages/s to the browser, a lagging series
// update does not move close back, a trade past the bar end starts the next bar, ticks=0 = one leg.
import assert from 'node:assert/strict';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let up = null, isOpened = 0, hubUrls = [];
globalThis.WebSocket = class { constructor() { isOpened++; } };   // must never be used by the bridge
class HubSock { constructor() { this.l = {}; } accept() {} addEventListener(e, f) { (this.l[e] = this.l[e] || []).push(f); } onmessage(ev) { for (const f of this.l.message || []) f(ev); } close() { this.closed = true; } send() {} }
const out = [];
globalThis.WebSocketPair = class { constructor() { const server = { accept() {}, send: (m) => out.push(JSON.parse(m)), close() {}, addEventListener() {} }; this[0] = {}; this[1] = server; } };
const OrigResponse = globalThis.Response;
globalThis.Response = class extends OrigResponse { constructor(body, init = {}) { super(body, init.status === 101 ? { status: 200 } : init); } };
const { onRequestGet } = await import('../../functions/api/chart/stream/[sym].js');
// admin stub (real time is admin only, 2026-10-16): throwaway RSA key, faked Google JWKS + admins/{uid}
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256' };
const b64u = (b) => Buffer.from(b).toString('base64url');
const hh = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })), pp = b64u(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'uid-admin', iat: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 3600 }));
const TOKEN = hh + '.' + pp + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(hh + '.' + pp)));
globalThis.fetch = async (u, init) => {
  if (String(u).includes('securetoken@system')) return new Response(JSON.stringify({ keys: [jwk] }));
  if (String(u).includes('/is-live')) { hubUrls.push({ u: String(u), auth: init.headers.authorization }); up = new HubSock(); up.legs = decodeURIComponent(new URL(String(u)).searchParams.get('legs')).split(';'); return { status: 101, webSocket: up }; }
  return new Response('{}');
};
const req = (q) => onRequestGet({ request: new Request('https://tradezoro.com/api/chart/stream/NQ?' + q, { headers: { upgrade: 'websocket', origin: 'https://tradezoro.com', 'sec-websocket-protocol': 'tz-auth, ' + TOKEN } }), params: { sym: 'NQ' }, env: { INSIGHTSENTRY_WEBSOCKET_API_KEY: 'k' } });

{
  await req('tf=1&ticks=1');
  await sleep(5);
  assert.deepEqual(up.legs, ['CME_MINI:NQ1!|minute|1', 'CME_MINI:NQ1!|tick|1']);
  assert.ok(hubUrls[0].u.startsWith('https://book-recorder.theelitegrey.workers.dev/is-live?') && hubUrls[0].auth === 'Bearer ' + TOKEN);
  assert.equal(isOpened, 0, 'no InsightSentry socket from the bridge');
  ok('ticks=1 attaches the series leg + the tick leg to the recorder hub (admin token forwarded, no IS socket)');
  const T = Math.floor(Date.now() / 1000 / 60) * 60;
  up.onmessage({ data: JSON.stringify({ code: 'CME_MINI:NQ1!', bar_type: '1m', series: [{ time: T, open: 100, high: 101, low: 99, close: 100, volume: 10 }] }) });
  out.length = 0;
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) {
    up.onmessage({ data: JSON.stringify({ code: 'CME_MINI:NQ1!', bar_type: '1T', series: [{ time: T + 1 + i / 1000, close: 100 + (i % 7) * 0.25 + (i === 150 ? 5 : 0), volume: 1 }] }) });
    await sleep(10);
  }
  await sleep(150);
  const secs = (Date.now() - t0) / 1000;
  const bars = out.filter((m) => m.event === 'bar');
  const last = bars[bars.length - 1].bar;
  assert.ok(bars.length >= secs * 5, `>= 5 bar msgs/s (${bars.length} in ${secs.toFixed(1)} s)`);
  assert.ok(bars.length <= secs * 11 + 2, `<= ~10 bar msgs/s (${bars.length} in ${secs.toFixed(1)} s)`);
  assert.equal(last[0], T); assert.equal(last[1], 100); assert.equal(last[2], 105.75); assert.equal(last[3], 99);
  assert.equal(last[5], 310);
  ok(`trades fold into the forming bar: ${bars.length} updates in ${secs.toFixed(1)} s, high ${last[2]}, vol ${last[5]}`);
  const lastClose = last[4];
  up.onmessage({ data: JSON.stringify({ code: 'CME_MINI:NQ1!', bar_type: '1m', series: [{ time: T, open: 100, high: 101, low: 99, close: 90.5, volume: 12 }] }) });
  const b2 = out.filter((m) => m.event === 'bar').pop().bar;
  assert.equal(b2[4], lastClose); assert.equal(b2[2], 105.75); assert.equal(b2[3], 99);
  ok('a lagging series update keeps the tick close and the widest range');
  up.onmessage({ data: JSON.stringify({ code: 'CME_MINI:NQ1!', bar_type: '1T', series: [{ time: T + 61, close: 101, volume: 2 }] }) });
  await sleep(150);
  const b3 = out.filter((m) => m.event === 'bar').pop().bar;
  assert.equal(b3[0], T + 60); assert.equal(b3[1], 101); assert.equal(b3[5], 2);
  ok('a trade past the bar end starts the next bar');
}
{
  await req('tf=1');
  await sleep(5);
  assert.equal(up.legs.length, 1);
  ok('without ticks=1 only the series leg');
  await req('tf=1S&ticks=1');
  await sleep(5);
  assert.deepEqual(up.legs, ['CME_MINI:NQ1!|second|1']);
  ok('seconds timeframe ignores ticks=1');
  // reconnect storm from one browser: 30 re-opens = 30 hub attaches, still 0 InsightSentry sockets
  for (let i = 0; i < 30; i++) await req('tf=1&ticks=1');
  await sleep(5);
  assert.equal(isOpened, 0);
  ok('30 browser reconnects -> 30 attaches to our hub, 0 InsightSentry sockets');
  // hub_full / hub_paused are passed on (browser polls), a ping from the hub carries its upstream age
  out.length = 0;
  up.onmessage({ data: JSON.stringify({ event: 'hub_paused', ms: 1000 }) });
  assert.ok(out.some((m) => m.event === 'hub_paused'));
  ok('hub_paused passed to the browser');
}
console.log(`\n${n} checks passed`);
assert.equal(isOpened, 0);
process.exit(0);
