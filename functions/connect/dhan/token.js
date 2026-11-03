// Dhan partner one-tap sign-in (3-step consent). OFF until the Pages secrets DHAN_PARTNER_ID and DHAN_PARTNER_SECRET exist (needs a Dhan partner application).
//   GET  ?probe=1                -> {configured:true} | 503 {configured:false}
//   POST {grant:'start'}         -> step 1 here (partner credentials stay on this server) -> {url} = Dhan's login page for this one consent (step 2, opened by the browser)
//   POST {grant:'code', code}    -> step 3: code = the tokenId Dhan put in the redirect; -> {access_token, client_id, expires_at}. Nothing else of Dhan's reply (name, UCC) goes back.
// Same checks as the other connect functions: Origin tradezoro.com, JSON only, rate limit, signed-in TradeZoro user. Stores nothing, logs nothing. Redirect URL registered with Dhan:
// https://tradezoro.com/connect/dhan/callback. DATA ONLY: the token is used by the browser only for the allow-listed price calls (ALLOW.dhan in assets/byo-core.js).
import { verifyIdToken, bearerOf } from '../../api/chart/_rt.js';
import { json, fail, okOrigin, rateLimited } from '../_token.js';

const BASE = 'https://auth.dhan.co';
export async function handle(request, env, deps = {}) {
  const configured = !!(env.DHAN_PARTNER_ID && env.DHAN_PARTNER_SECRET);
  if (request.method === 'GET') {
    if (new URL(request.url).searchParams.get('probe') !== '1') return fail(404, 'Not found');
    return configured ? json({ configured: true }) : json({ configured: false }, 503);
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
  if (!configured) return fail(503, 'Dhan sign-in is coming soon');
  if (!okOrigin(request, env)) return fail(403, 'Forbidden');
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return fail(415, 'JSON only');
  if (await rateLimited(env, request, 'dhan')) return fail(429, 'Too many tries. Wait a minute.');
  if (!(await verifyIdToken(bearerOf(request), { fetchImpl: deps.verifyFetch }))) return fail(401, 'Sign in first');
  let b = null; try { const t = await request.text(); if (t.length <= 2048) b = JSON.parse(t); } catch (e) { b = null; }
  const hdr = { partner_id: env.DHAN_PARTNER_ID, partner_secret: env.DHAN_PARTNER_SECRET, Accept: 'application/json' };
  const go = async (url, init) => { try { const r = await (deps.fetchImpl || fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(8000), ...init, headers: hdr }); let j = null; try { j = await r.json(); } catch (e) { /* not json */ } return { r, j }; } catch (e) { return null; } };
  if (b && b.grant === 'start') {
    const x = await go(BASE + '/partner/generate-consent', { method: 'POST' });
    if (!x) return fail(502, 'Dhan did not answer');
    if (!x.r.ok || !x.j || !/^[A-Za-z0-9\-]{8,80}$/.test(x.j.consentId || '')) return fail(x.r.status >= 500 ? 502 : 400, 'Dhan did not accept this sign-in');
    return json({ url: BASE + '/consent-login?consentId=' + encodeURIComponent(x.j.consentId) });
  }
  if (b && b.grant === 'code' && typeof b.code === 'string' && /^[A-Za-z0-9._~\-]{8,200}$/.test(b.code)) {
    const x = await go(BASE + '/partner/consume-consent?tokenId=' + encodeURIComponent(b.code), { method: 'GET' });
    if (!x) return fail(502, 'Dhan did not answer');
    const j = x.j;
    if (!x.r.ok || !j || typeof j.accessToken !== 'string' || !/^\d{4,20}$/.test(String(j.dhanClientId || ''))) return fail(x.r.status >= 500 ? 502 : 400, 'Dhan did not accept this sign-in');
    const at = Date.parse(String(j.expiryTime || '') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(j.expiryTime || '')) ? '' : '+05:30'));   // Dhan states the end time in India time
    return json({ access_token: j.accessToken, client_id: String(j.dhanClientId), expires_at: Number.isFinite(at) ? at : undefined });
  }
  return fail(400, 'Bad request');
}
export const onRequest = ({ request, env }) => handle(request, env);
