// GET /connect/ctrader/ws?env=live|demo — WebSocket relay to the cTrader Open API (JSON, port 5036). DATA ONLY, view-only.
// Needs a signed-in member: the Firebase ID token arrives as the subprotocol ("tz-auth", "<jwt>"), never in the URL.
// Origin must be https://tradezoro.com. The client secret (CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET, Pages secrets) is
// added here and never leaves. The strict allow-list is functions/connect/ctrader/_relay.js. Stores and logs nothing.
import { verifyIdToken, wsTokenOf } from '../../api/chart/_rt.js';
import { createRelay, LIMITS } from './_relay.js';

const ORIGIN = 'https://tradezoro.com', HOSTS = { live: 'https://live.ctraderapi.com:5036', demo: 'https://demo.ctraderapi.com:5036' };
const RATE_MAX = 12;
const err = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const open = new Map(), mem = new Map();   // shortcut: per-isolate socket counts (ip and uid); the hard limit is a Cloudflare WAF rule

const devOk = (request, env) => env.DEV === '1' && new URL(request.url).hostname !== 'tradezoro.com' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(request.headers.get('origin') || '');
async function rateLimited(env, request) {
  const key = 'rl:ctws:' + (request.headers.get('cf-connecting-ip') || 'unknown') + ':' + Math.floor(Date.now() / 60000);
  try {
    if (env.PASSKEYS) {
      const n = Number(await env.PASSKEYS.get(key)) || 0;
      if (n >= RATE_MAX) return true;
      await env.PASSKEYS.put(key, String(n + 1), { expirationTtl: 120 });
      return false;
    }
    for (const k of mem.keys()) if (k !== key) mem.delete(k);
    const n = (mem.get(key) || 0) + 1; mem.set(key, n); return n > RATE_MAX;
  } catch (e) { return true; }
}
const bump = (k, d) => { const n = (open.get(k) || 0) + d; if (n <= 0) open.delete(k); else open.set(k, n); return n; };

// deps.connect(url) -> upstream WebSocket-like; deps.verifyFetch for tests.
export async function handle(request, env, deps = {}) {
  const configured = !!(env.CTRADER_CLIENT_ID && env.CTRADER_CLIENT_SECRET);
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
  if (!configured) return err(503, 'cTrader is coming soon');
  if (request.headers.get('upgrade') !== 'websocket') return err(426, 'websocket required');
  if (!(request.headers.get('origin') === ORIGIN || devOk(request, env))) return err(403, 'Forbidden');
  const envName = new URL(request.url).searchParams.get('env') === 'demo' ? 'demo' : 'live';
  if (await rateLimited(env, request)) return err(429, 'Too many tries. Wait a minute.');
  const tok = wsTokenOf(request);
  const uid = await verifyIdToken(tok, { fetchImpl: deps.verifyFetch });
  if (!uid) return err(401, 'Sign in first');
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if ((open.get('ip:' + ip) || 0) >= LIMITS.perIp || (open.get('uid:' + uid) || 0) >= LIMITS.perUid) return err(429, 'Too many connections');
  let expMs = Date.now() + LIMITS.session;
  try { expMs = Math.min(expMs, JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000); } catch (e) { /* default */ }

  let upstream;
  try {
    if (deps.connect) upstream = await deps.connect(envName);
    else {
      const r = await fetch(HOSTS[envName], { headers: { Upgrade: 'websocket' } });
      upstream = r.webSocket; if (!upstream) return err(502, 'cTrader did not answer');
    }
  } catch (e) { return err(502, 'cTrader did not answer'); }

  const pair = new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.accept(); if (upstream.accept) upstream.accept();
  bump('ip:' + ip, 1); bump('uid:' + uid, 1);
  let timer = null;
  const relay = createRelay({ client: server, up: upstream, clientId: env.CTRADER_CLIENT_ID, clientSecret: env.CTRADER_CLIENT_SECRET });
  const done = () => { clearInterval(timer); if (!done.d) { done.d = true; bump('ip:' + ip, -1); bump('uid:' + uid, -1); } };
  server.addEventListener('message', (e) => { relay.onClient(e.data); if (relay.closed) done(); });
  upstream.addEventListener('message', (e) => { relay.onUp(typeof e.data === 'string' ? e.data : ''); if (relay.closed) done(); });
  server.addEventListener('close', () => { relay.onClientClose(); done(); });
  server.addEventListener('error', () => { relay.onClientClose(); done(); });
  upstream.addEventListener('close', () => { relay.onUpClose(); done(); });
  upstream.addEventListener('error', () => { relay.onUpClose(); done(); });
  timer = setInterval(() => { relay.tick(); if (Date.now() > expMs) { try { server.close(1001, 'session'); } catch (e) { /* closed */ } relay.onClientClose(); } if (relay.closed) done(); }, 5000);
  relay.start();
  return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'tz-auth' } });
}
export const onRequest = ({ request, env }) => handle(request, env);
