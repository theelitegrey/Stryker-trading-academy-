// GET /api/vest/<endpoint> — thin pass-through for Vest's PUBLIC market data (no keys, no accounts, no orders).
// Why: Vest's REST answers only to its own web app's origin (CORS), so the browser cannot read it from our pages.
// The public WebSocket has no such check and is read browser-direct (assets/orderflow-venue-vest.js).
// Allow-list: exchangeInfo, klines, trades, depth, ticker/latest, ticker/24hr, funding/history. GET only, a fixed
// set of query names with strict values, a short edge cache so many viewers make few upstream calls.
// Education only. Not financial advice.
const UPSTREAM = 'https://server-prod.hz.vestmarkets.com/v2/';
const PATHS = { exchangeInfo: 300, klines: 3, trades: 2, depth: 1, 'ticker/latest': 3, 'ticker/24hr': 30, 'funding/history': 60 };   // endpoint -> edge cache seconds
const PARAMS = {
  symbol: /^[A-Za-z0-9-]{1,30}$/,
  symbols: /^[A-Za-z0-9,-]{1,600}$/,
  interval: /^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w)$/,
  limit: /^\d{1,4}$/,
  startTime: /^\d{10,14}$/,
  endTime: /^\d{10,14}$/,
};
const HEAD = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' };
const fail = (status, msg) => new Response(JSON.stringify({ error: msg }), { status, headers: Object.assign({ 'cache-control': 'no-store' }, HEAD) });

export function buildUrl(pathParts, search) {
  const path = (Array.isArray(pathParts) ? pathParts : [pathParts]).filter(Boolean).join('/');
  if (!Object.prototype.hasOwnProperty.call(PATHS, path)) return { error: 'Not found', status: 404 };
  const out = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(search)) {
    if (!Object.prototype.hasOwnProperty.call(PARAMS, k) || !PARAMS[k].test(v)) return { error: 'Bad parameter ' + k, status: 400 };
    out.set(k, v);
  }
  const q = out.toString();
  return { url: UPSTREAM + path + (q ? '?' + q : ''), ttl: PATHS[path] };
}

export async function onRequestGet({ request, params }) {
  const b = buildUrl(params.path, new URL(request.url).search);
  if (b.error) return fail(b.status, b.error);
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const key = new Request(b.url, { method: 'GET' });
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  let up;
  try { up = await fetch(b.url, { headers: { xrestservermm: 'restserver0', accept: 'application/json' }, signal: AbortSignal.timeout(6000) }); }
  catch (e) { return fail(502, 'Vest data is not reachable right now'); }
  const body = await up.text();
  const ok = up.status === 200;
  const res = new Response(body, { status: up.status === 200 || up.status === 400 || up.status === 404 ? up.status : 502, headers: Object.assign({ 'cache-control': ok ? 'public, max-age=' + b.ttl : 'no-store' }, HEAD) });
  if (ok && cache) { try { await cache.put(key, res.clone()); } catch (e) {} }
  return res;
}
