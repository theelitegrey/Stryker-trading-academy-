// Admin-only broker sync (beta): start a Finatic Connect session and hand back the portal URL (redirect flow).
//   GET  ?probe=1 -> {configured}      (flag only, nothing else)
//   POST {}                          -> {portalUrl, sessionId}   (admin ID token required: 401 unsigned, 403 non-admin)
// The portal URL is a secret: it goes only to the admin who asked. The API key never leaves this server.
import { gate, readBody, fin, startSession, sessionHeaders, json, fail, configured } from './_fin.js';

export async function handle(request, env, deps = {}) {
  if (request.method === 'GET') {
    if (new URL(request.url).searchParams.get('probe') !== '1') return fail(404, 'Not found');
    return json({ configured: configured(env) }, configured(env) ? 200 : 503);
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
  const g = await gate(request, env, deps, 'finatic-session');
  if (g instanceof Response) return g;
  const b = await readBody(request);
  if (!b || typeof b !== 'object') return fail(400, 'Bad request');
  const s = await startSession(env, deps, null);
  if (!s) return fail(502, 'Broker sync is unavailable right now');
  const p = await fin(env, deps, 'GET', '/api/v1/session/portal', { headers: sessionHeaders(s) });
  let url = p.ok && p.data && (p.data.portal_url || p.data.portalUrl);
  try { url = new URL(url); } catch (e) { url = null; }
  if (!url || url.protocol !== 'https:') return fail(502, 'Broker sync is unavailable right now');
  url.searchParams.set('parent_origin', 'https://tradezoro.com');
  url.searchParams.set('mode', b.mode === 'light' ? 'light' : 'dark');
  return json({ portalUrl: url.toString(), sessionId: s.sessionId });
}
export const onRequest = ({ request, env }) => handle(request, env);
