// Shared bits for the admin-only broker-sync (beta) functions. READ ONLY: no order/trading path exists in this file.
// Env (Pages secrets, optional): FINATIC_API_KEY, FINATIC_COMPANY_ID. The key stays on the server: never returned, never logged.
import { isAdminToken, verifyIdToken, bearerOf } from '../../api/chart/_rt.js';
import { okOrigin, rateLimited, json, fail } from '../_token.js';

export { json, fail };
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
  if (await rateLimited(env, request, name)) return fail(429, 'Too many tries. Wait a minute.');
  const token = bearerOf(request);
  const uid = await verifyIdToken(token, { fetchImpl: deps.verifyFetch });
  if (!uid) return fail(401, 'Sign in first');
  if (!(await isAdminToken(token, { fetchImpl: deps.verifyFetch }))) return fail(403, 'Admin only');
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
  if (env.FINATIC_ENV === 'sandbox' || env.FINATIC_ENV === 'live') h['X-Finatic-Environment'] = env.FINATIC_ENV;   // unset = whatever the key implies
  if (body !== undefined) h['content-type'] = 'application/json';
  let r;
  try {
    r = await (deps.finFetch || fetch)(url.toString(), { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) { return { ok: false, status: 502, data: null }; }
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  const errs = j && (j.errors || j.error);
  const data = j ? (j.data !== undefined ? j.data : (j.success && j.success.data !== undefined ? j.success.data : null)) : null;
  return { ok: r.ok && !(Array.isArray(errs) ? errs.length : errs), status: r.status, data };
}

const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return ''; };

// Mint a one-time token and start a session (optionally for a known Finatic user). -> {sessionId, companyId, csrf, userId, authenticated} | null
export async function startSession(env, deps, finUserId) {
  const init = await fin(env, deps, 'POST', '/api/v1/session/init');
  const ott = init.ok && pick(init.data, 'one_time_token', 'oneTimeToken');
  if (!ott) return null;
  const st = await fin(env, deps, 'POST', '/api/v1/session/start', { headers: { 'One-Time-Token': ott }, body: finUserId ? { user_id: finUserId } : {} });
  if (!st.ok) return null;
  const d = st.data || {};
  const sessionId = pick(d, 'session_id', 'sessionId');
  if (!sessionId) return null;
  return { sessionId, companyId: pick(d, 'company_id', 'companyId'), csrf: pick(d, 'csrf_token', 'csrfToken'), userId: pick(d, 'user_id', 'userId'), authenticated: String(pick(d, 'status')).toLowerCase() === 'active' && !!pick(d, 'user_id', 'userId') };
}
export const sessionHeaders = (s) => ({ 'x-session-id': s.sessionId, 'session-id': s.sessionId, ...(s.companyId ? { 'x-company-id': s.companyId } : {}), ...(s.csrf ? { 'x-csrf-token': s.csrf } : {}) });
