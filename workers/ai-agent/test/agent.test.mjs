// Unit tests for the AI agent Worker (workers/ai-agent): OAuth 2.1 + PKCE, DCR, token lifetimes, revoke, scope enforcement,
// MCP JSON-RPC (initialize, tools/list, tools/call), rate limits and the relay dispatch. Runs in plain Node (no wrangler):
// the two Durable Object classes get an in-memory storage + fake WebSockets, and the member check is stubbed.
// Run: node workers/ai-agent/test/agent.test.mjs
import assert from 'node:assert/strict';
import worker, { AgentHub, AgentClients } from '../src/index.js';
import { pkceOk, sha256b64u, parseToken, validateRegistration, redirectKind, cleanScope, makeLimiter } from '../src/core.js';
import { checkArgs, TOOL } from '../src/tools.js';

let pass = 0, failN = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---- fake Durable Object runtime ------------------------------------------------------------------------------
class MemStorage {
  constructor() { this.m = new Map(); this.alarm = null; }
  async get(k) { if (Array.isArray(k)) return new Map(k.filter((x) => this.m.has(x)).map((x) => [x, clone(this.m.get(x))])); return clone(this.m.get(k)); }
  async put(k, v) { if (typeof k === 'object') { for (const [a, b] of Object.entries(k)) this.m.set(a, clone(b)); return; } this.m.set(k, clone(v)); }
  async delete(k) { if (Array.isArray(k)) { let n = 0; for (const x of k) n += this.m.delete(x) ? 1 : 0; return n; } return this.m.delete(k); }
  async list(o = {}) { const out = new Map(); for (const [k, v] of [...this.m].sort()) if (!o.prefix || k.startsWith(o.prefix)) out.set(k, clone(v)); return out; }
  async getAlarm() { return this.alarm; } async setAlarm(t) { this.alarm = t; }
}
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
class FakeWS {
  constructor(onCmd) { this.a = null; this.sent = []; this.onCmd = onCmd; this.closed = null; }
  serializeAttachment(a) { this.a = structuredClone(a); } deserializeAttachment() { return structuredClone(this.a); }
  send(s) { const m = JSON.parse(s); this.sent.push(m); if (m.t === 'cmd' && this.onCmd) queueMicrotask(() => this.onCmd(m, this)); }
  close(code) { this.closed = code; }
}
function makeNs(Cls, env) {
  const objs = new Map();
  return {
    idFromName(n) { const hex = [...Buffer.from(n)].map((b) => b.toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64); return { toString: () => hex, name: n }; },
    idFromString(s) { if (!/^[0-9a-f]{64}$/.test(s)) throw new Error('bad id'); return { toString: () => s }; },
    get(id) {
      const k = id.toString();
      if (!objs.has(k)) { const ctx = { storage: new MemStorage(), sockets: [], getWebSockets() { return this.sockets; }, acceptWebSocket(w) { this.sockets.push(w); }, setWebSocketAutoResponse() {} }; objs.set(k, new Cls(ctx, env)); }
      const o = objs.get(k);
      return { fetch: (u, init) => o.fetch(u instanceof Request ? u : new Request(u, init)), obj: o };
    }
  };
}
// member tokens: "id:<uid>" (signed in 1 min ago) or "old:<uid>" (signed in 2 h ago)
function makeEnv() {
  const env = {
    __TEST_VERIFY: async (t) => { const m = /^(id|old):member-([a-z0-9]+)$/.exec(String(t || '')); if (!m) return null; const now = Math.floor(Date.now() / 1000); return { uid: m[2], exp: now + 3600, authTime: m[1] === 'id' ? now - 60 : now - 7200 }; }
  };
  env.AGENT = makeNs(AgentHub, env); env.CLIENTS = makeNs(AgentClients, env);
  return env;
}
const O = 'https://tradezoro.com';
const go = (env, path, init = {}) => worker.fetch(new Request(O + path, init), env);
const memberPost = (env, path, body, tok = 'id:member-alice') => go(env, '/api/ai/' + path, { method: 'POST', headers: { origin: O, authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const rpc = (env, token, method, params, id = 1) => go(env, '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
const form = (o) => new URLSearchParams(o).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const REDIR = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'v'.repeat(20) + 'A1-._~' + 'x'.repeat(30);

async function register(env, redirect = REDIR, name = 'Claude') {
  const r = await go(env, '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) });
  return { status: r.status, body: await r.json() };
}
// full OAuth dance -> { access, refresh, client_id, ... }
async function connect(env, { scope = ['mcp:read', 'mcp:chart'], redirect = REDIR, ver = verifier, tok = 'id:member-alice' } = {}) {
  const { body: c } = await register(env, redirect);
  const challenge = await sha256b64u(ver);
  const q = new URLSearchParams({ response_type: 'code', client_id: c.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', scope: 'mcp:read mcp:chart mcp:alerts', resource: O + '/mcp' });
  const a = await go(env, '/oauth/authorize?' + q);
  assert.equal(a.status, 302);
  const loc = new URL(a.headers.get('location'));
  assert.equal(loc.pathname, '/ai/consent');
  const r = loc.searchParams.get('r');
  const ap = await memberPost(env, 'approve', { r, scope }, tok);
  const apd = await ap.json();
  if (ap.status !== 200) return { approveStatus: ap.status, approve: apd };
  const back = new URL(apd.redirect);
  return { client_id: c.client_id, code: back.searchParams.get('code'), state: back.searchParams.get('state'), iss: back.searchParams.get('iss'), r, redirect };
}
async function exchange(env, c, ver = verifier, extra = {}) {
  const r = await go(env, '/oauth/token', { method: 'POST', headers: FORM, body: form({ grant_type: 'authorization_code', code: c.code, code_verifier: ver, client_id: c.client_id, redirect_uri: c.redirect, resource: O + '/mcp', ...extra }) });
  return { status: r.status, body: await r.json() };
}
const hubOf = (env, uid = 'alice') => env.AGENT.get(env.AGENT.idFromName('u:' + uid)).obj;
// a fake chart tab that answers every command
function openTab(env, uid = 'alice', answer = (m) => ({ ok: true, data: { did: m.tool, args: m.args } }), extra = {}) {
  const hub = hubOf(env, uid);
  const ws = new FakeWS((m, w) => hub.webSocketMessage(w, JSON.stringify({ t: 'res', id: m.id, ...answer(m) })));
  ws.serializeAttachment({ uid, exp: Math.floor(Date.now() / 1000) + 3600, tabId: 'tab1', device: 'Mac', visible: true, paused: false, at: Date.now(), focusAt: Date.now(), ...extra });
  hub.ctx.sockets.push(ws);
  return { ws, hub };
}

// ================================================================ PKCE + helpers
test('PKCE S256: right verifier ok, wrong verifier / plain / short refused', async () => {
  const ch = await sha256b64u(verifier);
  assert.equal(await pkceOk(verifier, ch), true);
  assert.equal(await pkceOk(verifier.slice(0, -1) + 'y', ch), false);
  assert.equal(await pkceOk(verifier, verifier.slice(0, 43)), false);
  assert.equal(await pkceOk('short', ch), false);
  // RFC 7636 appendix B vector
  assert.equal(await sha256b64u('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('redirect URIs: https / loopback / app scheme ok; userinfo, fragment, javascript, http remote refused', () => {
  assert.equal(redirectKind('https://claude.ai/api/mcp/auth_callback'), 'web');
  assert.equal(redirectKind('http://127.0.0.1:33418/callback'), 'loopback');
  assert.equal(redirectKind('cursor://anysphere.cursor-retrieval/oauth/callback'), 'app');
  for (const bad of ['https://claude.ai@evil.com/cb', 'https://a.com/cb#x', 'javascript:alert(1)', 'http://evil.com/cb', 'data:text/html,x', '', 'https://a.com/<x>']) assert.equal(redirectKind(bad), null, bad);
});
test('DCR: brand names need an allow-listed redirect; limits on redirect count', () => {
  assert.equal(validateRegistration({ client_name: 'Claude', redirect_uris: ['https://evil.com/cb'] }).client.name, 'Unverified app');
  assert.equal(validateRegistration({ client_name: 'TradeZoro official', redirect_uris: ['https://evil.com/cb'] }).client.verified, false);
  const v = validateRegistration({ client_name: 'whatever', redirect_uris: [REDIR] }).client;
  assert.equal(v.verified, true); assert.equal(v.name, 'Claude');
  assert.ok(validateRegistration({ redirect_uris: Array(6).fill(REDIR) }).error);
  assert.ok(validateRegistration({ redirect_uris: [REDIR], grant_types: ['client_credentials'] }).error);
});
test('scopes: read is always included, unknown scopes dropped', () => {
  assert.deepEqual(cleanScope('mcp:chart mcp:trade admin'), ['mcp:read', 'mcp:chart']);
  assert.deepEqual(cleanScope([]), ['mcp:read']);
});
test('arguments schema check', () => {
  assert.equal(checkArgs(TOOL.get('chart_symbol').inputSchema, { symbol: 'NQ' }), '');
  assert.match(checkArgs(TOOL.get('chart_symbol').inputSchema, {}), /missing/);
  assert.match(checkArgs(TOOL.get('chart_symbol').inputSchema, { symbol: 'NQ', evil: 1 }), /unknown argument/);
  assert.match(checkArgs(TOOL.get('layout_set').inputSchema, { charts: 3 }), /one of/);
  assert.match(checkArgs(TOOL.get('drawing_add').inputSchema, { type: 'hline', points: [{ price: 'x' }] }), /number/);
});
test('limiter: exact per minute window', () => {
  let t = 0; const lim = makeLimiter(() => t);
  for (let i = 0; i < 30; i++) assert.equal(lim('g', 30), true);
  assert.equal(lim('g', 30), false);
  t = 60000; assert.equal(lim('g', 30), true);
});

// ================================================================ discovery
test('metadata: protected resource + authorization server (S256, DCR, resource)', async () => {
  const env = makeEnv();
  const pr = await (await go(env, '/.well-known/oauth-protected-resource')).json();
  assert.equal(pr.resource, O + '/mcp'); assert.deepEqual(pr.authorization_servers, [O]);
  const as = await (await go(env, '/.well-known/oauth-authorization-server')).json();
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.equal(as.registration_endpoint, O + '/oauth/register');
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ['none']);
  const oi = await go(env, '/.well-known/openid-configuration'); assert.equal(oi.status, 200);
  const pre = await go(env, '/mcp', { method: 'OPTIONS' }); assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /mcp-protocol-version/);
});
test('/mcp without a token: 401 + WWW-Authenticate pointing at the resource metadata', async () => {
  const env = makeEnv();
  const r = await go(env, '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}' });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /resource_metadata="https:\/\/tradezoro\.com\/\.well-known\/oauth-protected-resource"/);
  assert.match(r.headers.get('access-control-expose-headers'), /www-authenticate/);
  const g = await go(env, '/mcp'); assert.equal(g.status, 405);
});

// ================================================================ OAuth flow
test('OAuth: full flow -> access + refresh; state and iss come back; code is single use', async () => {
  const env = makeEnv();
  const c = await connect(env);
  assert.equal(c.state, 'st8'); assert.equal(c.iss, O); assert.ok(parseToken(c.code).kind === 'tzk');
  const t = await exchange(env, c);
  assert.equal(t.status, 200); assert.equal(t.body.token_type, 'Bearer'); assert.equal(t.body.expires_in, 3600);
  assert.equal(t.body.scope, 'mcp:read mcp:chart');
  assert.ok(t.body.access_token.startsWith('tza_') && t.body.refresh_token.startsWith('tzr_'));
  const again = await exchange(env, c);
  assert.equal(again.status, 400); assert.equal(again.body.error, 'invalid_grant');
  // reusing the code also killed the connection it made (RFC 6749 4.1.2)
  const r = await rpc(env, t.body.access_token, 'tools/list', {});
  assert.equal(r.status, 401);
});
test('OAuth: wrong PKCE verifier is refused and burns the code', async () => {
  const env = makeEnv();
  const c = await connect(env);
  const bad = await exchange(env, c, 'w'.repeat(50));
  assert.equal(bad.status, 400); assert.match(bad.body.error_description, /PKCE/);
  const good = await exchange(env, c);
  assert.equal(good.status, 400);
});
test('OAuth: client_id, redirect_uri and resource must match', async () => {
  const env = makeEnv();
  let c = await connect(env);
  assert.equal((await exchange(env, c, verifier, { client_id: 'tzc_other' })).body.error_description, 'client mismatch');
  c = await connect(env);
  assert.equal((await exchange(env, c, verifier, { redirect_uri: 'https://claude.com/api/mcp/auth_callback' })).body.error_description, 'redirect_uri mismatch');
  c = await connect(env);
  assert.equal((await exchange(env, c, verifier, { resource: 'https://evil.com/mcp' })).body.error, 'invalid_target');
});
test('OAuth: expired code refused', async () => {
  const env = makeEnv();
  const c = await connect(env);
  const hub = hubOf(env);
  for (const [k, v] of hub.ctx.storage.m) if (k.startsWith('k:')) { v.exp = 1; }
  const t = await exchange(env, c);
  assert.equal(t.status, 400); assert.match(t.body.error_description, /expired/);
});
test('authorize: no PKCE / plain PKCE / unregistered redirect / bad resource', async () => {
  const env = makeEnv();
  const { body: c } = await register(env);
  const base = { response_type: 'code', client_id: c.client_id, redirect_uri: REDIR, state: 's' };
  let r = await go(env, '/oauth/authorize?' + new URLSearchParams(base));
  assert.match(r.headers.get('location'), /^https:\/\/claude\.ai\/.*error=invalid_request/);
  r = await go(env, '/oauth/authorize?' + new URLSearchParams({ ...base, code_challenge: 'x'.repeat(43), code_challenge_method: 'plain' }));
  assert.match(r.headers.get('location'), /error=invalid_request/);
  r = await go(env, '/oauth/authorize?' + new URLSearchParams({ ...base, redirect_uri: 'https://evil.com/cb', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' }));
  assert.match(r.headers.get('location'), /^https:\/\/tradezoro\.com\/ai\/consent\?e=/);   // never sent to an unregistered URI
  r = await go(env, '/oauth/authorize?' + new URLSearchParams({ ...base, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: 'https://evil.com/mcp' }));
  assert.match(r.headers.get('location'), /error=invalid_target/);
});
test('consent: request id is single use, needs same origin + a recent sign-in; deny returns access_denied', async () => {
  const env = makeEnv();
  const { body: c } = await register(env, 'https://evil.example/cb', 'Claude');
  const q = new URLSearchParams({ response_type: 'code', client_id: c.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: await sha256b64u(verifier), code_challenge_method: 'S256', scope: 'mcp:read mcp:chart' });
  const r = new URL((await go(env, '/oauth/authorize?' + q)).headers.get('location')).searchParams.get('r');
  const info = await (await memberPost(env, 'request', { r })).json();
  assert.equal(info.verified, false); assert.equal(info.client, 'Unverified app'); assert.equal(info.redirect, 'evil.example');
  const cross = await go(env, '/api/ai/approve', { method: 'POST', headers: { origin: 'https://evil.example', authorization: 'Bearer id:member-alice' }, body: JSON.stringify({ r }) });
  assert.equal(cross.status, 403);
  const old = await memberPost(env, 'approve', { r, scope: ['mcp:read'] }, 'old:member-alice');
  assert.equal(old.status, 403);
  // a stale sign-in does not burn the request: after signing in again the member can approve; then it is used up
  const again = await memberPost(env, 'approve', { r, scope: ['mcp:read'] });
  assert.equal(again.status, 200);
  assert.equal((await memberPost(env, 'approve', { r, scope: ['mcp:read'] })).status, 410);
  const nosign = await memberPost(env, 'request', { r: 'x' }, 'bogus');
  assert.equal(nosign.status, 401);
  // deny
  const r2 = new URL((await go(env, '/oauth/authorize?' + q)).headers.get('location')).searchParams.get('r');
  const d = await (await memberPost(env, 'deny', { r: r2 })).json();
  assert.match(d.redirect, /error=access_denied/);
});
test('refresh: rotates; the old refresh token coming back kills the connection', async () => {
  const env = makeEnv();
  const c = await connect(env); const t = (await exchange(env, c)).body;
  const r1 = await go(env, '/oauth/token', { method: 'POST', headers: FORM, body: form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: c.client_id }) });
  const n = await r1.json(); assert.equal(r1.status, 200); assert.notEqual(n.refresh_token, t.refresh_token);
  assert.equal((await rpc(env, n.access_token, 'ping', {})).status, 200);
  const reuse = await go(env, '/oauth/token', { method: 'POST', headers: FORM, body: form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: c.client_id }) });
  assert.equal(reuse.status, 400);
  assert.equal((await rpc(env, n.access_token, 'ping', {})).status, 401);
  // widening scope on refresh is refused
  const c2 = await connect(env, { scope: ['mcp:read'] }); const t2 = (await exchange(env, c2)).body;
  const w = await go(env, '/oauth/token', { method: 'POST', headers: FORM, body: form({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, scope: 'mcp:read mcp:chart' }) });
  assert.equal((await w.json()).error, 'invalid_scope');
});
test('expired access token -> 401 invalid_token', async () => {
  const env = makeEnv();
  const c = await connect(env); const t = (await exchange(env, c)).body;
  const hub = hubOf(env);
  const h = await sha256b64u(t.access_token); hub.ctx.storage.m.get('t:' + h).exp = 1;
  const r = await rpc(env, t.access_token, 'tools/list', {});
  assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate'), /invalid_token/);
});
test('revoke (RFC 7009) and Remove on the agents page both end the connection at once', async () => {
  const env = makeEnv();
  let c = await connect(env); let t = (await exchange(env, c)).body;
  assert.equal((await go(env, '/oauth/revoke', { method: 'POST', headers: FORM, body: form({ token: t.access_token }) })).status, 200);
  assert.equal((await rpc(env, t.access_token, 'ping', {})).status, 401);
  c = await connect(env); t = (await exchange(env, c)).body;
  const list = await (await memberPost(env, 'grants', {})).json();
  assert.equal(list.grants.length, 1); assert.equal(list.grants[0].name, 'Claude');
  await memberPost(env, 'grant/delete', { id: list.grants[0].id });
  assert.equal((await rpc(env, t.access_token, 'ping', {})).status, 401);
  // another member can't delete alice's grant
  c = await connect(env); t = (await exchange(env, c)).body;
  const gid = (await (await memberPost(env, 'grants', {})).json()).grants[0].id;
  await memberPost(env, 'grant/delete', { id: gid }, 'id:member-mallory');
  assert.equal((await rpc(env, t.access_token, 'ping', {})).status, 200);
});
test('tokens are stored hashed only', async () => {
  const env = makeEnv();
  const c = await connect(env); const t = (await exchange(env, c)).body;
  const dump = JSON.stringify([...hubOf(env).ctx.storage.m]);
  for (const x of [t.access_token, t.refresh_token, c.code]) { assert.ok(!dump.includes(x.split('.')[1]), 'secret part stored'); }
  const p = await (await memberPost(env, 'personal', { name: 'Codex', scope: ['mcp:read'], days: 30 })).json();
  assert.ok(!JSON.stringify([...hubOf(env).ctx.storage.m]).includes(p.token.split('.')[1]));
});
test('personal tokens: need a recent sign-in; read scope; expire; listed with last used', async () => {
  const env = makeEnv();
  assert.equal((await memberPost(env, 'personal', { name: 'x' }, 'old:member-alice')).status, 403);
  const p = await (await memberPost(env, 'personal', { name: 'Codex laptop', scope: ['mcp:read', 'mcp:chart'], days: 90 })).json();
  assert.ok(p.token.startsWith('tzp_'));
  assert.equal((await rpc(env, p.token, 'ping', {})).status, 200);
  const g = (await (await memberPost(env, 'grants', {})).json()).grants[0];
  assert.equal(g.kind, 'personal'); assert.equal(g.name, 'Codex laptop'); assert.ok(g.lastUsed > 0);
  assert.ok(Math.abs(g.expires - (Date.now() + 90 * 86400000)) < 5000);
  for (const v of hubOf(env).ctx.storage.m.values()) if (v && v.gid && v.kind === 'personal' && v.scope) v.exp = 1;
  assert.equal((await rpc(env, p.token, 'ping', {})).status, 401);
});
test('a token for one member never reaches another member (doId routing)', async () => {
  const env = makeEnv();
  const p = await (await memberPost(env, 'personal', { name: 'a', scope: ['mcp:read'] })).json();
  const parts = p.token.split('_')[1].split('.');
  const forged = 'tzp_' + env.AGENT.idFromName('u:bob').toString() + '.' + parts[1];
  assert.equal((await rpc(env, forged, 'ping', {})).status, 401);
});

// ================================================================ MCP JSON-RPC
test('MCP: initialize, notifications, tools/list, ping, unknown method, batch', async () => {
  const env = makeEnv();
  const c = await connect(env); const t = (await exchange(env, c)).body;
  const i = await (await rpc(env, t.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).json();
  assert.equal(i.jsonrpc, '2.0'); assert.equal(i.id, 1); assert.equal(i.result.protocolVersion, '2025-06-18');
  assert.ok(i.result.capabilities.tools); assert.equal(i.result.serverInfo.name, 'tradezoro'); assert.match(i.result.instructions, /no trading tools/i);
  const old = await (await rpc(env, t.access_token, 'initialize', { protocolVersion: '1999-01-01' })).json();
  assert.equal(old.result.protocolVersion, '2025-06-18');
  const n = await go(env, '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + t.access_token }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(n.status, 202);
  const l = await (await rpc(env, t.access_token, 'tools/list', {})).json();
  const names = l.result.tools.map((x) => x.name);
  assert.ok(names.includes('chart_symbol') && names.includes('chart_read') && !names.includes('alert_create'));
  assert.ok(!names.some((x) => /order|trade|buy|sell/.test(x)), 'no trading tools');
  for (const tl of l.result.tools) assert.equal(tl.inputSchema.type, 'object');
  assert.deepEqual((await (await rpc(env, t.access_token, 'ping', {})).json()).result, {});
  assert.equal((await (await rpc(env, t.access_token, 'nope', {})).json()).error.code, -32601);
  const b = await go(env, '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + t.access_token }, body: '[{"jsonrpc":"2.0","id":1,"method":"ping"}]' });
  assert.equal((await b.json()).error.code, -32600);
  const pe = await go(env, '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + t.access_token }, body: '{oops' });
  assert.equal((await pe.json()).error.code, -32700);
});
test('scope enforcement: a read-only token cannot call chart_symbol (and the tab never sees it)', async () => {
  const env = makeEnv();
  const c = await connect(env, { scope: ['mcp:read'] }); const t = (await exchange(env, c)).body;
  assert.equal(t.scope, 'mcp:read');
  const { ws } = openTab(env);
  const names = (await (await rpc(env, t.access_token, 'tools/list', {})).json()).result.tools.map((x) => x.name);
  assert.ok(!names.includes('chart_symbol'));
  const r = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_symbol', arguments: { symbol: 'NQ' } })).json();
  assert.equal(r.result.isError, true); assert.match(r.result.content[0].text, /needs mcp:chart/);
  assert.equal(ws.sent.filter((m) => m.t === 'cmd').length, 0);
  const a = await (await rpc(env, t.access_token, 'tools/call', { name: 'alert_create', arguments: { symbol: 'NQ', price: 1 } })).json();
  assert.equal(a.result.isError, true);
  const ok = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_status', arguments: {} })).json();
  assert.equal(ok.result.isError, undefined);
});
test('tools/call: relayed to the open tab with the grant scope; answer becomes MCP content; image content for screenshots', async () => {
  const env = makeEnv();
  const c = await connect(env); const t = (await exchange(env, c)).body;
  const { ws } = openTab(env, 'alice', (m) => m.tool === 'chart_screenshot' ? { ok: true, data: { w: 1 }, image: 'iVBORw0KGgo=' } : { ok: true, data: { symbol: m.args.symbol } });
  const r = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_symbol', arguments: { symbol: 'NQ', tab: 'tab1' } })).json();
  assert.deepEqual(JSON.parse(r.result.content[0].text), { symbol: 'NQ' });
  const cmd = ws.sent.find((m) => m.t === 'cmd');
  assert.equal(cmd.tool, 'chart_symbol'); assert.deepEqual(cmd.args, { symbol: 'NQ' }); assert.deepEqual(cmd.scope, ['mcp:read', 'mcp:chart']); assert.equal(cmd.client, 'Claude');
  const s = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_screenshot', arguments: {} })).json();
  assert.equal(s.result.content[0].type, 'image'); assert.equal(s.result.content[0].mimeType, 'image/png');
  const bad = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_symbol', arguments: { symbol: '' } })).json();
  assert.match(bad.result.content[0].text, /Invalid arguments/);
});
test('no tab open -> clear "open a chart" error; paused tab -> paused error; chart_list works without a tab', async () => {
  const env = makeEnv();
  const c = await connect(env); const t = (await exchange(env, c)).body;
  const r = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_read', arguments: {} })).json();
  assert.equal(r.result.isError, true); assert.match(r.result.content[0].text, /open https:\/\/tradezoro\.com\/charts/);
  const l = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_list', arguments: {} })).json();
  assert.deepEqual(JSON.parse(l.result.content[0].text).tabs, []);
  openTab(env, 'alice', undefined, { paused: true });
  const p = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_read', arguments: {} })).json();
  assert.match(p.result.content[0].text, /paused/);
});
test('relay: only the tab that got a command may answer it; tab error passes through; close fails pending', async () => {
  const env = makeEnv();
  const c = await connect(env); const t = (await exchange(env, c)).body;
  const hub = hubOf(env);
  const other = new FakeWS(); other.serializeAttachment({ uid: 'alice', exp: Math.floor(Date.now() / 1000) + 3600, tabId: 'tab2', visible: false, focusAt: 0, at: 0 });
  let target;
  target = new FakeWS((m) => {
    hub.webSocketMessage(other, JSON.stringify({ t: 'res', id: m.id, ok: true, data: { forged: true } }));   // ignored
    hub.webSocketMessage(target, JSON.stringify({ t: 'res', id: m.id, ok: false, error: 'No indicator called "zzz".' }));
  });
  target.serializeAttachment({ uid: 'alice', exp: Math.floor(Date.now() / 1000) + 3600, tabId: 'tab1', visible: true, focusAt: Date.now(), at: Date.now() });
  hub.ctx.sockets.push(other, target);
  const r = await (await rpc(env, t.access_token, 'tools/call', { name: 'indicator_add', arguments: { name: 'zzz' } })).json();
  assert.equal(r.result.isError, true); assert.match(r.result.content[0].text, /No indicator/);
  // close while pending
  const hang = new FakeWS(() => queueMicrotask(() => hub.webSocketClose(hang)));
  hang.serializeAttachment({ uid: 'alice', exp: Math.floor(Date.now() / 1000) + 3600, tabId: 'tab3', visible: true, focusAt: Date.now() + 10, at: Date.now() });
  hub.ctx.sockets.length = 0; hub.ctx.sockets.push(hang);
  const z = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_read', arguments: {} })).json();
  assert.match(z.result.content[0].text, /closed/);
});
test('relay: a tab whose sign-in lapsed is not used; re-auth for another uid closes the socket', async () => {
  const env = makeEnv();
  const c = await connect(env); const t = (await exchange(env, c)).body;
  const { ws, hub } = openTab(env, 'alice', undefined, { exp: Math.floor(Date.now() / 1000) - 3600 });
  const r = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_read', arguments: {} })).json();
  assert.match(r.result.content[0].text, /No ZoroCharts tab/);
  await hub.webSocketMessage(ws, JSON.stringify({ t: 'auth', token: 'id:member-mallory' }));
  assert.equal(ws.closed, 4001);
});
test('rate limits: 30 chart actions/min and 60 reads/min per connection', async () => {
  const env = makeEnv();
  const c = await connect(env); const t = (await exchange(env, c)).body;
  openTab(env);
  let blocked = 0;
  for (let i = 0; i < 31; i++) { const r = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_timeframe', arguments: { timeframe: '5' } })).json(); if (r.result.isError) blocked++; }
  assert.equal(blocked, 1);
  blocked = 0;
  for (let i = 0; i < 61; i++) { const r = await (await rpc(env, t.access_token, 'tools/call', { name: 'chart_status', arguments: {} })).json(); if (r.result.isError && /Rate limit/.test(r.result.content[0].text)) blocked++; }
  assert.equal(blocked, 1);
  blocked = 0;
  for (let i = 0; i < 6; i++) { const r = await (await rpc(env, t.access_token, 'tools/call', { name: 'drawing_remove', arguments: { id: 'd' + i } })).json(); if (r.result.isError) blocked++; }
  assert.ok(blocked >= 1);
});
test('DCR: 10 registrations per IP per hour', async () => {
  const env = makeEnv();
  let last;
  for (let i = 0; i < 11; i++) last = await go(env, '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tz-ip': '1.2.3.4' }, body: JSON.stringify({ redirect_uris: [REDIR] }) });
  assert.equal(last.status, 429);
});
test('Worker answers 503 (not a crash) without its Durable Object bindings; unknown path 404', async () => {
  assert.equal((await worker.fetch(new Request(O + '/mcp', { method: 'POST' }), {})).status, 503);
  assert.equal((await go(makeEnv(), '/oauth/whatever')).status, 404);
});

// ================================================================ Pages proxy
test('Pages proxy: forwards only the agent paths, strips caller x-tz-* headers, 503 without binding', async () => {
  const { isAiAgentPath, proxyAiAgent } = await import('../../../functions/_ai-proxy.js');
  for (const p of ['/mcp', '/oauth/token', '/api/ai/grants', '/.well-known/oauth-protected-resource/mcp', '/.well-known/openid-configuration']) assert.ok(isAiAgentPath(p), p);
  for (const p of ['/mcp/llms.txt', '/ai', '/ai/consent', '/charts/agents', '/.well-known/assetlinks.json', '/api/chart/x']) assert.ok(!isAiAgentPath(p), p);
  let seen;
  const env = { AI_AGENT: { fetch: async (r) => { seen = r; return new Response('ok'); } } };
  await proxyAiAgent(new Request(O + '/mcp', { method: 'POST', headers: { 'x-tz-ip': '6.6.6.6', 'x-tz-uid': 'victim', 'cf-connecting-ip': '9.9.9.9' }, body: '{}' }), env);
  assert.equal(seen.headers.get('x-tz-ip'), '9.9.9.9'); assert.equal(seen.headers.get('x-tz-uid'), null);
  assert.equal((await proxyAiAgent(new Request(O + '/mcp'), {})).status, 503);
  seen = null;
  assert.equal((await proxyAiAgent(new Request('https://abc123.tradezoro.pages.dev/mcp', { method: 'POST', body: '{}' }), env)).status, 503);
  assert.equal(seen, null, 'pages.dev host never reaches the Worker');
});

// ================================================================ local test sign-in can never work on a real host
test('dev stand-in sign-in: loopback hosts only, and only with both DEV vars; wrangler.jsonc carries no vars', async () => {
  const { verifyMember } = await import('../src/auth.js');
  const env = { DEV: '1', DEV_FAKE_AUTH: '1' };
  assert.ok(await verifyMember('devtok.abc', env, { host: '127.0.0.1' }));
  assert.ok(await verifyMember('devtok.abc', env, { host: 'localhost' }));
  for (const host of ['tradezoro.com', 'www.tradezoro.com', 'abc123.tradezoro.pages.dev', 'evil.example', '127.0.0.1.evil.example', '']) {
    assert.equal(await verifyMember('devtok.abc', env, { host, fetchImpl: async () => new Response('{}', { status: 500 }) }).catch(() => null), null, host);
  }
  assert.equal(await verifyMember('devtok.abc', { DEV: '1' }, { host: '127.0.0.1', fetchImpl: async () => new Response('{}', { status: 500 }) }).catch(() => null), null);
  const fs = await import('node:fs');
  const cfg = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/"vars"|DEV_FAKE_AUTH|DEV_ORIGIN|"DEV"/.test(cfg), 'wrangler.jsonc must not set DEV vars');
  assert.ok(/"workers_dev"\s*:\s*false/.test(cfg) && /"preview_urls"\s*:\s*false/.test(cfg), 'no public URL');
});

for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log('ok   ' + name); }
  catch (e) { failN++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
