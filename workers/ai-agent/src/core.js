// TradeZoro AI agent: pure helpers (no Cloudflare APIs), shared by the Worker, the Durable Object and the tests.
// "Connect your AI to ZoroCharts" (roadmap ai-chart-agent, Owner order 15 Nov 2026). Members bring their own AI client;
// we run no model. Nothing here logs, and no function returns a token's secret part after it was issued.
//
// TOKENS: <prefix><doId>.<secret>   prefix tzk_ = authorization code, tza_ = access, tzr_ = refresh, tzp_ = personal.
//   doId is the hex id of the member's Durable Object (AGENT.idFromName('u:'+uid).toString()). It only ROUTES the request
//   to the right object; nobody outside our namespace can compute it from a uid, and it never reveals the uid.
//   The object stores sha256(full token) and nothing else, so a storage leak gives no usable token.

export const ORIGIN = 'https://tradezoro.com';
export const RESOURCE = ORIGIN + '/mcp';
export const SCOPES = ['mcp:read', 'mcp:chart', 'mcp:alerts'];
export const SCOPE_LABEL = { 'mcp:read': 'Read your charts', 'mcp:chart': 'Control your charts', 'mcp:alerts': 'Alerts and watchlists' };
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 86400;
export const CODE_TTL_S = 60;
export const REQ_TTL_S = 600;            // a consent request waits up to 10 min (the member may have to sign in first)
export const PERSONAL_DAYS = [30, 90];
export const MAX_GRANTS = 20;
export const LIMITS = { read: 60, chart: 30, del: 5 };   // per grant per minute
export const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// Verified clients: an exact redirect on this list is the only thing that earns the "verified" mark on the consent page
// and the right to a big-brand client name. Every other client is shown as unverified.
export const VERIFIED_REDIRECTS = new Map([
  ['https://claude.ai/api/mcp/auth_callback', 'Claude'],
  ['https://claude.com/api/mcp/auth_callback', 'Claude'],
  ['https://chatgpt.com/connector_platform_oauth_redirect', 'ChatGPT']
]);
const BRAND_RE = /claude|anthropic|chat\s*gpt|openai|cursor|codex|tradezoro|zoro|stryker/i;

const enc = new TextEncoder();
export function b64u(bytes) {
  let s = ''; const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const randB64u = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256b64u(s) { return b64u(await crypto.subtle.digest('SHA-256', enc.encode(String(s)))); }
export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// PKCE S256 (RFC 7636): verifier 43-128 chars of [A-Za-z0-9-._~]; challenge = b64u(sha256(verifier)).
export const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
export const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
export async function pkceOk(verifier, challenge) {
  if (!VERIFIER_RE.test(String(verifier || '')) || !CHALLENGE_RE.test(String(challenge || ''))) return false;
  return safeEqual(await sha256b64u(verifier), challenge);
}

// token <-> parts
const TOKEN_RE = /^(tzk|tza|tzr|tzp)_([0-9a-f]{64})\.([A-Za-z0-9_-]{43})$/;
export function parseToken(t) {
  const m = TOKEN_RE.exec(String(t || ''));
  return m ? { kind: m[1], doId: m[2], full: m[0] } : null;
}
export const makeToken = (kind, doId) => kind + '_' + doId + '.' + randB64u(32);

// scopes: always a subset of SCOPES, mcp:read always included, stable order.
export function cleanScope(s) {
  const want = new Set(String(Array.isArray(s) ? s.join(' ') : s || '').split(/\s+/).filter(Boolean));
  want.add('mcp:read');
  return SCOPES.filter((x) => want.has(x));
}
export const scopeStr = (arr) => cleanScope(arr).join(' ');

// redirect URIs (DCR + authorize). Allowed: https with a host, http on loopback only, or a private-use app scheme
// (reverse-DNS style, e.g. cursor://, com.example.app:/cb). Never userinfo, never a fragment, never script-ish schemes.
const BAD_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ws:', 'wss:', 'ftp:', 'chrome:', 'view-source:']);
export function redirectKind(uri) {
  const s = String(uri || '');
  if (!s || s.length > 512 || /[\s<>"']/.test(s)) return null;
  let u; try { u = new URL(s); } catch (e) { return null; }
  if (u.hash || u.username || u.password) return null;
  if (s.includes('#')) return null;
  if (BAD_SCHEMES.has(u.protocol)) return null;
  if (u.protocol === 'https:') return u.hostname ? 'web' : null;
  if (u.protocol === 'http:') return (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') ? 'loopback' : null;
  if (/^[a-z][a-z0-9+.-]{1,40}:$/.test(u.protocol)) return 'app';
  return null;
}
// What the consent page shows as "where you'll be sent": the host for web, a plain phrase otherwise.
export function redirectLabel(uri) {
  const k = redirectKind(uri); if (!k) return '';
  const u = new URL(uri);
  if (k === 'web') return u.hostname;      // URL() already gives punycode (xn--) for IDN hosts
  if (k === 'loopback') return 'an app on this computer';
  return 'an app on this device (' + u.protocol.replace(/:$/, '') + ')';
}

export function cleanText(s, n = 60) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069<>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
}

// DCR (RFC 7591) request -> client record or { error }.
export function validateRegistration(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_client_metadata', error_description: 'JSON object expected' };
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5) return { error: 'invalid_redirect_uri', error_description: '1 to 5 redirect_uris' };
  for (const u of uris) if (typeof u !== 'string' || !redirectKind(u)) return { error: 'invalid_redirect_uri', error_description: 'redirect_uri not allowed' };
  const gt = body.grant_types == null ? ['authorization_code', 'refresh_token'] : body.grant_types;
  if (!Array.isArray(gt) || gt.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) return { error: 'invalid_client_metadata', error_description: 'grant_types: authorization_code, refresh_token' };
  const rt = body.response_types == null ? ['code'] : body.response_types;
  if (!Array.isArray(rt) || rt.some((r) => r !== 'code')) return { error: 'invalid_client_metadata', error_description: 'response_types: code' };
  const verified = uris.every((u) => VERIFIED_REDIRECTS.has(u));
  let name = cleanText(body.client_name, 60) || 'AI app';
  if (!verified && BRAND_RE.test(name)) name = 'Unverified app';   // only an allow-listed redirect may use a big-brand name
  if (verified) name = VERIFIED_REDIRECTS.get(uris[0]);
  return { client: { name, redirect_uris: uris.slice(), verified, created: Date.now() } };
}

export function negotiateProtocol(v) { return PROTOCOLS.includes(v) ? v : PROTOCOLS[0]; }

// Accept the canonical resource and its two harmless spellings; anything else is a different audience.
export function resourceOk(r, origin = ORIGIN) {
  if (r == null || r === '') return true;
  return r === origin + '/mcp' || r === origin + '/mcp/' || r === origin || r === origin + '/';
}

// Minute-window rate limiter kept in memory by the Durable Object (single-threaded, so the count is exact per object).
export function makeLimiter(now = () => Date.now()) {
  const m = new Map();
  return (key, max) => {
    const w = Math.floor(now() / 60000), k = key + '|' + w;
    if (m.size > 2000) for (const x of m.keys()) if (!x.endsWith('|' + w)) m.delete(x);
    const n = (m.get(k) || 0) + 1; m.set(k, n);
    return n <= max;
  };
}

export function authServerMetadata(o = ORIGIN) {
  const ORIGIN = o;
  return {
    issuer: ORIGIN,
    authorization_endpoint: ORIGIN + '/oauth/authorize',
    token_endpoint: ORIGIN + '/oauth/token',
    registration_endpoint: ORIGIN + '/oauth/register',
    revocation_endpoint: ORIGIN + '/oauth/revoke',
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: SCOPES.slice(),
    authorization_response_iss_parameter_supported: true,
    service_documentation: ORIGIN + '/ai'
  };
}
export function resourceMetadata(o = ORIGIN) {
  return { resource: o + '/mcp', authorization_servers: [o], scopes_supported: SCOPES.slice(), bearer_methods_supported: ['header'], resource_name: 'TradeZoro ZoroCharts', resource_documentation: o + '/ai' };
}
