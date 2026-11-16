// Shared bits for the admin-only broker-sync (beta) functions. READ ONLY: no order/trading path exists in this file.
// Env (Pages secrets, optional): FINATIC_API_KEY, FINATIC_COMPANY_ID. The key stays on the server: never returned, never logged.
import { isAdminToken, verifyIdToken, bearerOf } from '../../api/chart/_rt.js';
import { okOrigin, rateLimited, json } from '../_token.js';

export { json };

// ---- speed (Owner order 2026-11-16 "orders as fast as possible") -----------------------------------------------------------
// Server-Timing: every handler gets deps.t (a timer); safe() writes `Server-Timing: auth;dur=12, admin;dur=0, fin;dur=58, …` on the reply
// (names and durations only, never a value), so the chart can show where the time went and the report can measure it.
export function timer(now = () => Date.now()) {
  const t0 = now(), marks = [];
  return {
    // time one awaited step: await t.step('fin', promise)
    async step(name, p) { const a = now(); try { return await p; } finally { marks.push([name, now() - a]); } },
    add(name, ms) { marks.push([name, ms]); },
    header() { const agg = new Map(); for (const [n, d] of marks) agg.set(n, (agg.get(n) || 0) + d); return [...agg].map(([n, d]) => n + ';dur=' + Math.round(d)).concat('total;dur=' + Math.round(now() - t0)).join(', '); },
  };
}
// Pages entry for the three routes. When the Pages project has the service binding FINATIC_EDGE (the tz-finatic-edge Worker,
// workers/finatic-edge, placed in aws:us-east-1 next to the broker API), the request is handed to it unchanged and runs THERE: one
// long hop from the visitor's edge instead of one per broker call (from India ~200 ms each). No binding (today, local, tests) = runs
// here as before. If the binding call itself throws, the request runs here too (nothing was sent: the Worker never answered).
// order.js passes { retryHere: false }: a write whose Worker call failed mid-way gets the 'unknown' answer (the chart then blocks new
// orders until a read settles it) instead of a second run here.
export function pagesEntry(handle, { retryHere = true } = {}) {
  return async (ctx) => {
    const { request, env } = ctx;
    if (env && env.FINATIC_EDGE && typeof env.FINATIC_EDGE.fetch === 'function') {
      const h = new Headers(request.headers);
      for (const k of [...h.keys()]) if (k.toLowerCase().startsWith('x-tz-')) h.delete(k);
      h.set('x-tz-ip', request.headers.get('cf-connecting-ip') || 'unknown');
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
      const a = Date.now();
      let r = null;
      try { r = await env.FINATIC_EDGE.fetch(new Request(request.url, { method: request.method, headers: h, body, redirect: 'manual' })); } catch (e) { r = null; }
      if (r && /^application\/json\b/i.test(r.headers.get('content-type') || '')) {
        const out = new Response(r.body, r);
        const st = r.headers.get('server-timing') || '', pl = r.headers.get('cf-placement') || '';
        out.headers.set('server-timing', (st ? st + ', ' : '') + 'edge;dur=' + (Date.now() - a) + (pl ? ', placement;desc="' + pl.replace(/[^A-Za-z0-9:-]/g, '') + '"' : ''));
        return out;
      }
      if (r) return fail(500, 'Broker sync hit an error on our side. Try again; if it keeps happening, tell support.', 'server_error');   // answered, but not our JSON: never run twice
      if (!retryHere) return fail(502, 'No clear answer from the broker. The order may or may not have gone through. Checking positions and orders.', 'unknown');
      try { console.warn('finatic: edge binding failed, running locally'); } catch (e) {}
      ctx = { ...ctx, request: new Request(request.url, { method: request.method, headers: request.headers, body, redirect: 'manual' }) };
    }
    return handle(ctx.request, ctx.env, { defer: deferOf(ctx) });
  };
}
// deps.defer(promise): run after the reply (ctx.waitUntil). Without a context (tests, Node) the promise just runs; errors are swallowed.
export const deferOf = (ctx) => (p) => { const q = Promise.resolve(p).catch(() => {}); try { if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(q); } catch (e) {} return q; };

// Every error reply is JSON {error, code} so the sheet can show a plain-English line (never the generic "Request failed").
const CODES = { 400: 'bad_request', 401: 'signed_out', 403: 'forbidden', 404: 'not_found', 405: 'method', 409: 'needs_connect', 415: 'json_only', 429: 'rate_limited', 500: 'server_error', 502: 'upstream', 503: 'not_set_up' };
// 502 / 504 are never sent: Cloudflare's edge swaps the body of a 502/504 from a Pages function for its own HTML
// "Bad gateway" page (seen live 15 Nov), so the sheet lost our JSON. An upstream failure goes out as 503 {code:'upstream'}.
const EDGE_SAFE = (s) => (s === 502 || s === 504 ? 503 : s);
export const fail = (status, error, code) => json({ error, code: code || CODES[status] || 'error' }, EDGE_SAFE(status));
export const needsConnect = () => json({ error: 'Not connected yet', code: 'needs_connect', needsConnect: true }, 409);
export const methodNotAllowed = (allow) => new Response(JSON.stringify({ error: 'Method not allowed', code: 'method' }), { status: 405, headers: { allow, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export const UPSTREAM_MSG = 'The broker connection service is not answering properly right now. Try again in a minute.';

// Wraps a handler: an exception never becomes a Cloudflare HTML error page. Logs the handler name and error type only
// (never the message: it can carry a URL, token or key).
export function safe(name, fn) {
  return async (request, env, deps = {}) => {
    let r, t = timer();
    try {
      if (!deps.t || !deps.defer) deps = Object.assign(Object.create(deps), { t: deps.t || t, defer: deps.defer || deferOf(null) });
      t = deps.t;
      r = await fn(request, env, deps);
    }
    catch (e) { try { console.error('finatic ' + name + ': exception ' + ((e && e.name) || 'Error')); } catch (e2) {} return fail(500, 'Broker sync hit an error on our side. Try again; if it keeps happening, tell support.', 'server_error'); }
    // Last line of defence: only our own JSON leaves, never an upstream body or a 502/504 the edge would replace.
    const ct = r instanceof Response ? (r.headers.get('content-type') || '') : '';
    if (!/^application\/json\b/i.test(ct)) { try { console.error('finatic ' + name + ': non-JSON reply blocked'); } catch (e) {} return fail(500, 'Broker sync hit an error on our side. Try again; if it keeps happening, tell support.', 'server_error'); }
    if (r.status === 502 || r.status === 504) r = new Response(r.body, { status: 503, headers: r.headers });
    try { r.headers.set('server-timing', t.header() + (env && env.TZ_PLACED ? ', placed;desc="' + String(env.TZ_PLACED).replace(/[^A-Za-z0-9:-]/g, '') + '"' : '')); } catch (e) {}
    return r;
  };
}
export const API = 'https://api.finatic.dev';
const TIMEOUT_MS = 10000;
export const UUID = /^[0-9a-fA-F-]{8,64}$/;
export const ID = /^[A-Za-z0-9._:\-]{1,128}$/;

export const configured = (env) => !!env.FINATIC_API_KEY;

// Gate shared by both endpoints. Returns a Response to send, or {uid}.
export async function gate(request, env, deps, name) {
  if (!configured(env)) return fail(503, 'Not set up yet');
  if (!okOrigin(request, env)) return fail(403, 'Forbidden');
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return fail(415, 'JSON only');
  const t = deps.t || timer();
  // the KV counter write goes out after the reply (deps.defer); the read still decides
  if (await t.step('rl', rateLimited(env, request, name, deps.defer))) return fail(429, 'Too many tries. Wait a minute.');
  const token = bearerOf(request);
  const uid = await t.step('auth', verifyIdToken(token, { fetchImpl: deps.verifyFetch }));   // Google keys cached in the isolate
  if (!uid) return fail(401, 'Sign in first');
  if (!(await t.step('admin', isAdminToken(token, { fetchImpl: deps.verifyFetch })))) return fail(403, 'Admin only');   // admins/{uid}: 60 s memo (a "no" 5 s)
  return { uid };
}

export async function readBody(request) {
  try { const t = await request.text(); return t.length <= 8192 ? JSON.parse(t) : null; } catch (e) { return null; }
}

// One Finatic call. Returns {ok, data, status}. Handles both envelope shapes ({data,errors} and {success:{data}}).
export async function fin(env, deps, method, path, { headers = {}, query, body } = {}) {
  const url = new URL(API + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const h = { 'x-api-key': env.FINATIC_API_KEY, accept: 'application/json', ...headers };
  if (env.FINATIC_COMPANY_ID) h['x-company-id'] = env.FINATIC_COMPANY_ID;
  const fe = finEnvHeader(env); if (fe) h['X-Finatic-Environment'] = fe;   // unset = whatever the key implies
  if (body !== undefined) h['content-type'] = 'application/json';
  let r;
  const a0 = Date.now();
  try {
    // redirect 'manual', NOT 'error': the Workers runtime throws on redirect:'error' ("won't be implemented ... at the edge"),
    // which made every live call fail with status 0 while Node (tests, local runs) accepted it. A 3xx is refused below.
    r = await (deps.finFetch || fetch)(url.toString(), { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) { if (deps.t) deps.t.add('fin', Date.now() - a0); try { console.warn('finatic: fetch failed (' + ((e && e.name) || 'Error') + ')'); } catch (e2) {} return { ok: false, status: 0, data: null, bad: true }; }   // network error / timeout
  if (deps.t) deps.t.add(/\/session\//.test(path) ? 'sess' : 'fin', Date.now() - a0);
  if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) { console.warn('finatic: redirect refused, status ' + r.status); return { ok: false, status: r.status, data: null, bad: true }; }
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  if (!j || typeof j !== 'object') {   // HTML error page or garbage: never treat as success
    if (r.ok) console.warn('finatic: non-JSON answer, status ' + r.status);
    return { ok: false, status: r.status, data: null, bad: r.ok };
  }
  const errs = j.errors || j.error;
  const data = j.data !== undefined ? j.data : (j.success && j.success.data !== undefined ? j.success.data : null);
  return { ok: r.ok && !(Array.isArray(errs) ? errs.length : errs), status: r.status, data };
}

// X-Finatic-Environment. A live key always wins: FINATIC_ENV=sandbox next to an fntc_live_ key is ignored (with a warning).
export function finEnvHeader(env) {
  const v = env.FINATIC_ENV;
  if (v !== 'sandbox' && v !== 'live') return '';
  if (v === 'sandbox' && String(env.FINATIC_API_KEY || '').startsWith('fntc_live_')) { console.warn('finatic: FINATIC_ENV=sandbox ignored, the key is a live key'); return ''; }
  return v;
}

const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return ''; };

// Mint a one-time token and start a session (optionally for a known Finatic user).
// -> {sessionId, companyId, csrf, userId, authenticated} | {failed:true, staleUser, status}
//    staleUser = the stored user id was refused (4xx other than 429), e.g. a sandbox user id sent to the live environment.
export async function startSession(env, deps, finUserId) {
  const init = await fin(env, deps, 'POST', '/api/v1/session/init');
  const ott = init.ok && pick(init.data, 'one_time_token', 'oneTimeToken');
  if (!ott) { console.warn('finatic: session/init failed, status ' + init.status); return { failed: true, staleUser: false, status: init.status }; }
  const st = await fin(env, deps, 'POST', '/api/v1/session/start', { headers: { 'One-Time-Token': ott }, body: finUserId ? { user_id: finUserId } : {} });
  if (!st.ok) {
    console.warn('finatic: session/start failed, status ' + st.status);
    return { failed: true, staleUser: !!finUserId && st.status >= 400 && st.status < 500 && st.status !== 429, status: st.status };
  }
  const d = (st.data && typeof st.data === 'object') ? st.data : {};
  const sessionId = pick(d, 'session_id', 'sessionId');
  if (!sessionId) return { failed: true, staleUser: false, status: st.status };
  return { sessionId, companyId: pick(d, 'company_id', 'companyId'), csrf: pick(d, 'csrf_token', 'csrfToken'), userId: pick(d, 'user_id', 'userId'), authenticated: String(pick(d, 'status')).toLowerCase() === 'active' && !!pick(d, 'user_id', 'userId') };
}
// Session cache (memory of this isolate only, never KV: a session id is a credential). Key = environment + Finatic user.
// SESSION_TTL_MS short on purpose; a cached session the broker refuses with 401 is dropped and ONE fresh session is started
// (a 401/419/440 means the request was not accepted, so the retry cannot double an order). Same Idempotency-Key on the retry.
export const SESSION_TTL_MS = 120000;
const sessMemo = new Map(), sessFlight = new Map();
export const _resetSessions = () => { sessMemo.clear(); sessFlight.clear(); };
const sessKey = (env, userId) => envMode(env) + '|' + (env.FINATIC_COMPANY_ID || '') + '|' + userId;
export async function cachedSession(env, deps, userId) {
  const k = sessKey(env, userId), hit = sessMemo.get(k), now = (deps.now || Date.now)();
  if (hit && now - hit.at < SESSION_TTL_MS) {
    // refresh-ahead: past half its life, a new session is started after this reply (the 10 s chart poll keeps it fresh), so an
    // order never waits for a session start while the panel is open
    if (now - hit.at > SESSION_TTL_MS / 2 && deps.defer && !sessFlight.has(k) && !hit.refreshing) { hit.refreshing = true; deps.defer(startFresh(env, deps, userId, k, now)); }
    return { ...hit.s, cached: true };
  }
  if (sessFlight.has(k)) return sessFlight.get(k);   // parallel callers (positions + orders read) share one start
  return startFresh(env, deps, userId, k, now);
}
function startFresh(env, deps, userId, k, now) {
  const p = startSession(env, deps, userId).then((s) => {
    if (!s.failed && s.authenticated) { if (sessMemo.size > 50) sessMemo.clear(); sessMemo.set(k, { s, at: now }); }
    return s;
  }).finally(() => sessFlight.delete(k));
  sessFlight.set(k, p);
  return p;
}
// sessionId given: drop only if the cache still holds THAT session (a parallel caller may already have renewed it)
export const dropSession = (env, userId, sessionId) => { const k = sessKey(env, userId), h = sessMemo.get(k); if (!sessionId || (h && h.s.sessionId === sessionId)) sessMemo.delete(k); };
// one Finatic call on a (maybe cached) session; on 401 from a cached session: drop it, new session, same call once more.
// -> { r, s } ; s.failed / !s.authenticated when the new session could not be started
export async function finSession(env, deps, userId, s, method, path, opts = {}) {
  let r = await fin(env, deps, method, path, { ...opts, headers: { ...sessionHeaders(s), ...(opts.headers || {}) } });
  if ((r.status === 401 || r.status === 419 || r.status === 440) && s.cached) {   // session expired / unknown: the request was refused, retry is safe
    dropSession(env, userId, s.sessionId);
    const s2 = await cachedSession(env, deps, userId);
    if (s2.failed || !s2.authenticated) return { r, s: s2 };
    r = await fin(env, deps, method, path, { ...opts, headers: { ...sessionHeaders(s2), ...(opts.headers || {}) } });
    return { r, s: s2 };
  }
  return { r, s };
}
export const sessionHeaders = (s) => ({ 'x-session-id': s.sessionId, 'session-id': s.sessionId, ...(s.companyId ? { 'x-company-id': s.companyId } : {}), ...(s.csrf ? { 'x-csrf-token': s.csrf } : {}) });

// ---- order-test guard (Owner exception 2026-11-04: admin-only, sandbox-only testing) ----
// 'sandbox' only when the key itself says sandbox (fntc_sandbox_) or, for an unrecognised key, FINATIC_ENV=sandbox. A live-looking key or
// FINATIC_ENV=live is 'live'; anything unknown is treated as live (blocked).
export function envMode(env) {
  const k = String(env.FINATIC_API_KEY || '');
  if (k.startsWith('fntc_live_') || env.FINATIC_ENV === 'live') return 'live';
  if (k.startsWith('fntc_sandbox_') || env.FINATIC_ENV === 'sandbox') return 'sandbox';
  return 'live';
}
// null = orders allowed, else a Response. Live needs the second, separate switch FINATIC_LIVE_ORDERS=1.
export function ordersBlocked(env) {
  if (envMode(env) === 'sandbox') return null;
  return env.FINATIC_LIVE_ORDERS === '1' ? null : fail(403, 'Live orders are off');
}
