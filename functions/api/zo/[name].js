// GET /api/zo/<summary|profile|surface|history|activity|screen|cme|note|levels-export>  (ZoroOptions, spec section 6).
// A thin same-origin proxy to the book-recorder Worker's /zo/* routes (the browser never calls a vendor, and the Worker holds the data).
// GATE, twice (fail closed): here first, with the same token check as functions/api/gex/_pro.js (isGexProToken), then again in the Worker.
// No token / not Pro: only the SPX teaser reads (summary, profile 0DTE, note) pass, and the Worker cuts them down to the teaser fields.
// Responses are private (never stored by a shared cache) and carry Vary: Authorization. Education only. Not financial advice.
import { isGexProToken, bearerOf } from '../chart/_rt.js';
import { teaserEligible, ZO_ROUTES } from '../../../workers/book-recorder/src/zoro.js';

const WORKER = 'https://book-recorder.theelitegrey.workers.dev/zo/';
const J = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export async function onRequestGet({ request, params, env }) {
  const name = String(params.name || '');
  if (!ZO_ROUTES.includes(name) && name !== 'levels-export') return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: J });
  const url = new URL(request.url);
  const tok = bearerOf(request);
  let pro = false;
  try { pro = await isGexProToken(tok); } catch (e) { pro = false; }
  if (!pro && (name === 'levels-export' || !teaserEligible(name, url.searchParams))) {
    return new Response(JSON.stringify({ error: 'pro_required', message: 'ZoroOptions is part of Pro.', notice: 'Education only. Not financial advice.' }), { status: 403, headers: J });
  }
  const base = (env && env.ZO_WORKER_URL) || WORKER;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort('timeout'), 8000);
  try {
    const r = await fetch(base + name + url.search, { signal: ctrl.signal, headers: { 'user-agent': 'TradeZoroOptions/1.0', authorization: tok ? 'Bearer ' + tok : '' } });
    const h = new Headers({ 'content-type': r.headers.get('content-type') || J['content-type'], 'cache-control': r.status === 200 ? 'private, max-age=15' : 'no-store', vary: 'Authorization' });
    const cd = r.headers.get('content-disposition'); if (cd) { h.set('content-disposition', cd); h.set('cache-control', 'private, no-store'); }
    return new Response(r.body, { status: r.status, headers: h });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: J });
  } finally { clearTimeout(timer); }
}
