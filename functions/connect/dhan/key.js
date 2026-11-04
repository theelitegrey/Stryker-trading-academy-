// Dhan "own API key" sign-in pass-through. DATA ONLY. Dhan's auth host refuses browser requests (no CORS) and steps 1 and 3 need the member's API secret, so the
// browser asks us and we forward exactly ONE call, with the member's own app_id/app_secret headers, then forget them. Nothing is stored, nothing is logged.
// Only these two Dhan URLs can be reached from here (step 2, the login page, is opened by the browser itself):
//   POST {grant:'start', clientId, appId, appSecret}  -> step 1  POST https://auth.dhan.co/app/generate-consent?client_id=<id>  -> {url} (the Dhan login page for this consent)
//   POST {grant:'code', appId, appSecret, code}       -> step 3  GET  https://auth.dhan.co/app/consumeApp-consent?tokenId=<code> -> {access_token, client_id, expires_at}
// Same checks as the other connect functions: Origin tradezoro.com, JSON only, rate limit, signed-in TradeZoro user.
import { verifyIdToken, bearerOf } from '../../api/chart/_rt.js';
import { json, fail, okOrigin, rateLimited } from '../_token.js';

const BASE = 'https://auth.dhan.co';
export const ALLOWED = (u) => { try { const x = new URL(u); return x.origin === BASE && x.hash === '' && (x.pathname === '/app/generate-consent' || x.pathname === '/app/consumeApp-consent') && x.username === '' && x.port === ''; } catch (e) { return false; } };
const KEY = /^[A-Za-z0-9._\-]{6,200}$/;
export async function handle(request, env, deps = {}) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (!okOrigin(request, env)) return fail(403, 'Forbidden');
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return fail(415, 'JSON only');
  if (await rateLimited(env, request, 'dhan-key')) return fail(429, 'Too many tries. Wait a minute.');
  if (!(await verifyIdToken(bearerOf(request), { fetchImpl: deps.verifyFetch }))) return fail(401, 'Sign in first');
  let b = null; try { const t = await request.text(); if (t.length <= 2048) b = JSON.parse(t); } catch (e) { b = null; }
  if (!b || typeof b !== 'object' || !KEY.test(String(b.appId || '')) || !KEY.test(String(b.appSecret || ''))) return fail(400, 'Bad request');
  let url, method;
  if (b.grant === 'start' && /^\d{4,20}$/.test(String(b.clientId || ''))) { url = BASE + '/app/generate-consent?client_id=' + encodeURIComponent(String(b.clientId)); method = 'POST'; }
  else if (b.grant === 'code' && /^[A-Za-z0-9._~\-]{8,200}$/.test(String(b.code || ''))) { url = BASE + '/app/consumeApp-consent?tokenId=' + encodeURIComponent(b.code); method = 'GET'; }
  else return fail(400, 'Bad request');
  if (!ALLOWED(url)) return fail(400, 'Bad request');
  let r, j = null;
  try { r = await (deps.fetchImpl || fetch)(url, { method, redirect: 'error', signal: AbortSignal.timeout(8000), headers: { app_id: b.appId, app_secret: b.appSecret, Accept: 'application/json' } }); }
  catch (e) { return fail(502, 'Dhan did not answer'); }
  try { j = await r.json(); } catch (e) { /* not json */ }
  const bad = () => fail(r.status >= 500 ? 502 : 400, 'Dhan did not accept this API key');
  if (b.grant === 'start') {
    if (!r.ok || !j || !/^[A-Za-z0-9\-]{8,100}$/.test(j.consentAppId || '')) return bad();
    return json({ url: BASE + '/login/consentApp-login?consentAppId=' + encodeURIComponent(j.consentAppId) });
  }
  if (!r.ok || !j || typeof j.accessToken !== 'string' || !/^\d{4,20}$/.test(String(j.dhanClientId || ''))) return bad();
  const at = Date.parse(String(j.expiryTime || '') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(j.expiryTime || '')) ? '' : '+05:30'));   // Dhan states the end time in India time
  return json({ access_token: j.accessToken, client_id: String(j.dhanClientId), expires_at: Number.isFinite(at) ? at : undefined });   // name and UCC are dropped
}
export const onRequest = ({ request, env }) => handle(request, env);
