// TradeZoro AI agent Worker ("Connect your AI to ZoroCharts", roadmap ai-chart-agent, Owner order 15 Nov 2026).
// Reached ONLY through the Pages service binding AI_AGENT (functions/_ai-proxy.js): workers_dev is false, so there is no
// public workers.dev URL that could skip the site's geo-block or fake the caller's IP header.
//
// ROUTES (all on https://tradezoro.com, forwarded unchanged by the Pages proxy)
//   GET  /.well-known/oauth-protected-resource[/mcp]       RFC 9728 metadata
//   GET  /.well-known/oauth-authorization-server[/mcp], /.well-known/openid-configuration   RFC 8414 metadata
//   POST /oauth/register     RFC 7591 dynamic client registration (public clients, PKCE only)
//   GET  /oauth/authorize    validates the request, stores it, 302 -> /ai/consent?r=<opaque id> (no params trusted later)
//   POST /oauth/token        authorization_code (+PKCE S256) and refresh_token (rotating, reuse kills the connection)
//   POST /oauth/revoke       RFC 7009
//   POST /mcp                MCP Streamable HTTP, JSON-RPC 2.0, JSON responses, stateless. GET/DELETE -> 405.
//   /api/ai/*                the member's own calls from tradezoro.com pages (Firebase ID token, same origin):
//                            request (consent page reads the validated request), approve, deny,
//                            grants (list), personal (create token), grant/delete (revoke), relay (chart tab WebSocket)
// Never logs a request body, a token or an Authorization / Sec-WebSocket-Protocol header.
import { AgentHub, AgentClients } from './hub.js';
import {
  ORIGIN, CODE_TTL_S, cleanScope, cleanText, parseToken, redirectKind, redirectLabel, CHALLENGE_RE, resourceOk,
  authServerMetadata, resourceMetadata, scopeStr
} from './core.js';
import { verifyMember, deviceName, LOOPBACK } from './auth.js';

export { AgentHub, AgentClients };

const RECENT_S = 900;   // consent and new personal tokens need a sign-in within the last 15 minutes
const JH = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id', 'access-control-expose-headers': 'www-authenticate, mcp-protocol-version', 'access-control-max-age': '86400' };
const json = (obj, status = 200, extra) => new Response(JSON.stringify(obj), { status, headers: { ...JH, ...(extra || {}) } });
const oerr = (error, error_description, status = 400, extra) => json({ error, ...(error_description ? { error_description } : {}) }, status, extra);

function originOf(env, request) {
  const h = new URL(request.url).hostname;
  if (env.DEV === '1' && LOOPBACK.test(h) && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.DEV_ORIGIN || '')) return env.DEV_ORIGIN;
  return ORIGIN;
}
const hubFor = (env, doId) => { try { return env.AGENT.get(env.AGENT.idFromString(doId)); } catch (e) { return null; } };
const hubOfUid = (env, uid) => { const id = env.AGENT.idFromName('u:' + uid); return { stub: env.AGENT.get(id), doId: id.toString() }; };
const clients = (env) => env.CLIENTS.get(env.CLIENTS.idFromName('clients'));
const call = (stub, path, body) => stub.fetch('https://do' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

async function readBody(request, max = 16384) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > max) return { tooBig: true };
  let t = ''; try { t = await request.text(); } catch (e) { return null; }
  if (t.length > max) return { tooBig: true };
  const ct = request.headers.get('content-type') || '';
  if (/application\/x-www-form-urlencoded/.test(ct)) return Object.fromEntries(new URLSearchParams(t));
  try { return JSON.parse(t || '{}'); } catch (e) { return null; }
}
const bearer = (request) => { const m = /^Bearer\s+(\S{10,600})$/i.exec(request.headers.get('authorization') || ''); return m ? m[1] : ''; };
function sameOrigin(request, origin) {
  const o = request.headers.get('origin');
  return o === origin;
}

export default {
  async fetch(request, env) {
    if (!env.AGENT || !env.CLIENTS) return json({ error: 'unavailable' }, 503);
    const url = new URL(request.url), p = url.pathname, origin = originOf(env, request);
    const isPublic = p === '/mcp' || p.startsWith('/oauth/') || p.startsWith('/.well-known/');
    if (request.method === 'OPTIONS' && isPublic) return new Response(null, { status: 204, headers: CORS });
    let res;
    try {
      if (p.startsWith('/.well-known/')) res = wellKnown(p, origin);
      else if (p === '/oauth/register') res = await register(request, env);
      else if (p === '/oauth/authorize') res = await authorize(request, env, origin);
      else if (p === '/oauth/token') res = await token(request, env, origin);
      else if (p === '/oauth/revoke') res = await revoke(request, env);
      else if (p === '/mcp') res = await mcp(request, env, origin);
      else if (p.startsWith('/api/ai/')) return await member(request, env, origin, p.slice(8));
      else res = json({ error: 'not_found' }, 404);
    } catch (e) { res = json({ error: 'server_error' }, 500); }
    if (isPublic && res.status !== 101) { const h = new Headers(res.headers); for (const [k, v] of Object.entries(CORS)) h.set(k, v); res = new Response(res.body, { status: res.status, headers: h }); }
    return res;
  }
};

function wellKnown(p, origin) {
  if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp') return json(resourceMetadata(origin), 200, { 'cache-control': 'public, max-age=3600' });
  if (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/oauth-authorization-server/mcp' || p === '/.well-known/openid-configuration' || p === '/.well-known/openid-configuration/mcp') return json(authServerMetadata(origin), 200, { 'cache-control': 'public, max-age=3600' });
  return json({ error: 'not_found' }, 404);
}

async function register(request, env) {
  if (request.method !== 'POST') return oerr('invalid_request', 'POST only', 405);
  const body = await readBody(request, 8192);
  if (!body || body.tooBig) return oerr('invalid_client_metadata', 'JSON body expected');
  const r = await call(clients(env), '/register', { ip: request.headers.get('x-tz-ip') || 'unknown', meta: body });
  const d = await r.json();
  if (!r.ok) return json(d, r.status);
  const c = d.client;
  return json({ client_id: d.client_id, client_id_issued_at: Math.floor(c.created / 1000), client_name: c.name, redirect_uris: c.redirect_uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'mcp:read mcp:chart mcp:alerts' }, 201);
}

// Errors before the redirect_uri is known to be registered are shown on our own page, never sent to that URI.
function errorPage(origin, msg) {
  return new Response(null, { status: 302, headers: { location: origin + '/ai/consent?e=' + encodeURIComponent(cleanText(msg, 120)), 'cache-control': 'no-store' } });
}
async function authorize(request, env, origin) {
  if (request.method !== 'GET') return oerr('invalid_request', 'GET only', 405);
  const q = new URL(request.url).searchParams, g = (k) => q.get(k) || '';
  const clientId = g('client_id').slice(0, 64), redirect = g('redirect_uri');
  const cr = await clients(env).fetch('https://do/client?id=' + encodeURIComponent(clientId));
  if (!cr.ok) return errorPage(origin, 'This AI app is not registered with TradeZoro. Remove the connector in your AI app and add it again.');
  const client = (await cr.json()).client;
  const redir = redirect || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : '');
  if (!redir || !client.redirect_uris.includes(redir) || !redirectKind(redir)) return errorPage(origin, 'The return address of this AI app does not match its registration.');
  const back = (error, desc) => { const u = new URL(redir); u.searchParams.set('error', error); if (desc) u.searchParams.set('error_description', desc); if (g('state')) u.searchParams.set('state', g('state')); u.searchParams.set('iss', origin); return new Response(null, { status: 302, headers: { location: u.toString(), 'cache-control': 'no-store' } }); };
  if (g('response_type') !== 'code') return back('unsupported_response_type', 'response_type must be code');
  if (g('code_challenge_method') !== 'S256' || !CHALLENGE_RE.test(g('code_challenge'))) return back('invalid_request', 'PKCE with S256 is required');
  if (!resourceOk(g('resource'), origin)) return back('invalid_target', 'resource must be ' + origin + '/mcp');
  if (g('state').length > 512) return back('invalid_request', 'state too long');
  const req = { client_id: clientId, client_name: client.name, verified: !!client.verified, redirect_uri: redir, redirect_label: redirectLabel(redir), code_challenge: g('code_challenge'), state: g('state'), scope: scopeStr(g('scope') || 'mcp:read mcp:chart') };
  const r = await call(clients(env), '/req/put', { req });
  const { id } = await r.json();
  return new Response(null, { status: 302, headers: { location: origin + '/ai/consent?r=' + encodeURIComponent(id), 'cache-control': 'no-store' } });
}

async function token(request, env, origin) {
  if (request.method !== 'POST') return oerr('invalid_request', 'POST only', 405);
  const b = await readBody(request, 8192);
  if (!b || b.tooBig) return oerr('invalid_request', 'form body expected');
  const raw = b.grant_type === 'refresh_token' ? b.refresh_token : b.code;
  const t = parseToken(raw);
  if (!t) return oerr('invalid_grant', 'unknown code or token');
  const stub = hubFor(env, t.doId); if (!stub) return oerr('invalid_grant', 'unknown code or token');
  const r = await call(stub, '/token', { grant_type: String(b.grant_type || ''), code: b.code, refresh_token: b.refresh_token, code_verifier: b.code_verifier, client_id: b.client_id, redirect_uri: b.redirect_uri, resource: b.resource, scope: b.scope, doId: t.doId, origin });
  return new Response(r.body, { status: r.status, headers: { ...JH, pragma: 'no-cache' } });
}
async function revoke(request, env) {
  if (request.method !== 'POST') return oerr('invalid_request', 'POST only', 405);
  const b = await readBody(request, 4096);
  const t = parseToken(b && b.token);
  if (t) { const stub = hubFor(env, t.doId); if (stub) await call(stub, '/revoke', { token: t.full }); }
  return json({});
}

async function mcp(request, env, origin) {
  const www = 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource"';
  if (request.method === 'GET' || request.method === 'DELETE') return new Response(JSON.stringify({ error: 'Use POST. This server answers with JSON only (no event stream).' }), { status: 405, headers: { ...JH, allow: 'POST, OPTIONS' } });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const raw = bearer(request), t = parseToken(raw);
  if (!t || (t.kind !== 'tza' && t.kind !== 'tzp')) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in required. Connect at ' + origin + '/ai' } }, 401, { 'www-authenticate': www });
  const stub = hubFor(env, t.doId);
  if (!stub) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Invalid token' } }, 401, { 'www-authenticate': www + ', error="invalid_token"' });
  const msg = await readBody(request, 65536);
  if (msg === null) return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  if (msg.tooBig) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } }, 413);
  const r = await call(stub, '/mcp', { token: t.full, msg });
  if (r.status === 401) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Token expired or revoked. Reconnect at ' + origin + '/ai' } }, 401, { 'www-authenticate': www + ', error="invalid_token"' });
  const h = new Headers(r.headers);
  const pv = request.headers.get('mcp-protocol-version'); if (pv) h.set('mcp-protocol-version', cleanText(pv, 20));
  return new Response(r.body, { status: r.status, headers: h });
}

// ---- the member's own calls from tradezoro.com pages ----------------------------------------------------------
async function member(request, env, origin, sub) {
  if (sub === 'relay') return relay(request, env, origin);
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!sameOrigin(request, origin)) return json({ error: 'forbidden' }, 403);
  const who = await verifyMember(bearer(request), env, { host: new URL(request.url).hostname });
  if (!who) return json({ error: 'Please sign in again.', code: 'signin' }, 401);
  const body = await readBody(request, 8192);
  if (!body || body.tooBig) return json({ error: 'bad request' }, 400);
  const recent = who.authTime && Math.floor(Date.now() / 1000) - who.authTime <= RECENT_S;
  const { stub, doId } = hubOfUid(env, who.uid);
  if (sub === 'request' || sub === 'approve' || sub === 'deny') {
    const id = String(body.r || '').slice(0, 64);
    if (sub === 'approve' && !recent) return json({ error: 'For your safety, sign in again, then approve.', code: 'recent-login' }, 403);   // before take: the request survives
    const r = await call(clients(env), sub === 'request' ? '/req/get' : '/req/take', { id });
    if (!r.ok) return json({ error: 'This sign-in request has expired. Go back to your AI app and connect again.', code: 'expired' }, 410);
    const req = (await r.json()).req;
    if (sub === 'request') return json({ client: req.client_name, verified: req.verified, redirect: req.redirect_label, scope: req.scope.split(' '), recent: !!recent });
    const ret = new URL(req.redirect_uri);
    if (req.state) ret.searchParams.set('state', req.state);
    ret.searchParams.set('iss', origin);
    if (sub === 'deny') { ret.searchParams.set('error', 'access_denied'); return json({ redirect: ret.toString() }); }
    const scope = cleanScope(body.scope);
    const c = await call(stub, '/code', { uid: who.uid, doId, req, scope, device: deviceName(request.headers.get('user-agent')) });
    const d = await c.json();
    if (!c.ok) return json({ error: d.error === 'too_many_connections' ? 'You have too many AI connections. Remove one on the AI agents page first.' : 'Could not connect. Try again.' }, c.status);
    ret.searchParams.set('code', d.code);
    return json({ redirect: ret.toString(), expiresIn: CODE_TTL_S });
  }
  if (sub === 'grants') return call(stub, '/grants', {});
  if (sub === 'personal') {
    if (!recent) return json({ error: 'For your safety, sign in again, then create the token.', code: 'recent-login' }, 403);
    return call(stub, '/personal', { uid: who.uid, doId, name: body.name, scope: body.scope, days: Number(body.days) });
  }
  if (sub === 'grant/delete') return call(stub, '/grant/delete', { id: body.id });
  return json({ error: 'not_found' }, 404);
}

// Chart tab WebSocket. The Firebase ID token arrives as the second subprotocol ("tz-auth", "<jwt>"), never in the URL;
// only "tz-auth" is echoed back. Origin must be our own site.
async function relay(request, env, origin) {
  if (request.headers.get('upgrade') !== 'websocket') return json({ error: 'WebSocket only' }, 426);
  if (!sameOrigin(request, origin)) return json({ error: 'forbidden' }, 403);
  const list = String(request.headers.get('sec-websocket-protocol') || '').split(',').map((x) => x.trim());
  const i = list.indexOf('tz-auth'), tok = i >= 0 ? list[i + 1] : '';
  const who = await verifyMember(tok, env, { host: new URL(request.url).hostname });
  if (!who) return json({ error: 'sign in' }, 401);
  const { stub } = hubOfUid(env, who.uid);
  const h = new Headers({ upgrade: 'websocket', 'x-tz-host': new URL(request.url).hostname, 'x-tz-uid': who.uid, 'x-tz-exp': String(who.exp), 'x-tz-device': deviceName(request.headers.get('user-agent')) });
  return stub.fetch('https://do/relay', { headers: h });
}
