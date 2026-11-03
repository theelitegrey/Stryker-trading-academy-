// Dhan price-history pass-through. DATA ONLY. Dhan's REST host refuses browser requests (no CORS for any origin), so the member's browser asks us and we forward ONE
// of two calls: /v2/charts/historical (daily) or /v2/charts/intraday (minutes). The member's own access token (header x-dhan-token) is used for that single call and then
// forgotten: nothing is stored, nothing is logged, no other Dhan URL can be reached from here (orders, funds, holdings, profile...). Same sign-in + origin checks as the other connect functions.
// POST { kind: 'daily'|'intraday', securityId, exchangeSegment, instrument, fromDate, toDate, [interval] }  ->  { open[], high[], low[], close[], volume[], timestamp[] } (epoch seconds)
import { verifyIdToken, bearerOf } from '../../api/chart/_rt.js';
import { json, fail, okOrigin, rateLimited } from '../_token.js';

const UP = { daily: 'https://api.dhan.co/v2/charts/historical', intraday: 'https://api.dhan.co/v2/charts/intraday' };
const SEGS = ['NSE_EQ', 'BSE_EQ', 'IDX_I', 'NSE_FNO', 'MCX_COMM'], INSTR = ['EQUITY', 'INDEX', 'FUTIDX', 'FUTSTK', 'FUTCOM'], KEYS = ['open', 'high', 'low', 'close', 'volume', 'timestamp'];
export const clean = (b) => {   // returns the exact upstream body, or null. Nothing the client sends goes through unchecked.
  if (!b || typeof b !== 'object' || !UP[b.kind]) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/, min = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (!/^\d{1,10}$/.test(String(b.securityId)) || !SEGS.includes(b.exchangeSegment) || !INSTR.includes(b.instrument)) return null;
  const o = { securityId: String(b.securityId), exchangeSegment: b.exchangeSegment, instrument: b.instrument };
  if (b.kind === 'daily') { if (!day.test(b.fromDate) || !day.test(b.toDate)) return null; return { ...o, expiryCode: 0, oi: false, fromDate: b.fromDate, toDate: b.toDate }; }
  if (![1, 5, 15, 25, 60].includes(Number(b.interval)) || !(min.test(b.fromDate) && min.test(b.toDate))) return null;
  return { ...o, interval: String(Number(b.interval)), oi: false, fromDate: b.fromDate, toDate: b.toDate };
};
export async function handle(request, env, deps = {}) {
  if (request.method !== 'POST') return request.method === 'GET' ? fail(404, 'Not found') : new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (!okOrigin(request, env)) return fail(403, 'Forbidden');
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return fail(415, 'JSON only');
  if (await rateLimited(env, request, 'dhan-data')) return fail(429, 'Too many tries. Wait a minute.');
  if (!(await verifyIdToken(bearerOf(request), { fetchImpl: deps.verifyFetch }))) return fail(401, 'Sign in first');
  const tok = request.headers.get('x-dhan-token') || '';
  if (!/^[A-Za-z0-9._\-]{20,2048}$/.test(tok)) return fail(400, 'Bad request');
  let body = null; try { const t = await request.text(); if (t.length <= 2048) body = clean(JSON.parse(t)); } catch (e) { body = null; }
  if (!body) return fail(400, 'Bad request');
  const kind = body.interval ? 'intraday' : 'daily';
  let r;
  try { r = await (deps.fetchImpl || fetch)(UP[kind], { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'access-token': tok, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }); }
  catch (e) { return fail(502, 'Dhan did not answer'); }
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  if (r.status === 401 || (j && (j.errorCode === 'DH-901' || j.error_code === 'DH-901'))) return fail(401, 'Dhan did not accept this token');
  if (r.status === 429 || (j && (j.errorCode === 'DH-904' || j.error_code === 'DH-904'))) return fail(429, 'Dhan is limiting requests');
  if (j && (j.errorCode === 'DH-902' || j.error_code === 'DH-902')) return fail(402, 'Dhan Data plan is not active');
  if (!r.ok || !j || !Array.isArray(j.close)) return fail(r.status >= 500 ? 502 : 400, 'Dhan could not return this data');
  const out = {}; for (const k of KEYS) out[k] = Array.isArray(j[k]) ? j[k].slice(0, 100000) : [];   // only price arrays go back
  return json(out);
}
export const onRequest = ({ request, env }) => handle(request, env);
