// GET /api/chart/okx-stat?kind=oi|lsr&base=BTC&period=5m[&end=<ms>]
// OKX's statistics routes (open-interest history, long/short account ratio) answer browsers WITHOUT a CORS header (their other
// public routes have one), so the chart cannot read them directly. This pass-through returns OKX's own JSON unchanged.
// Not a geo-block workaround: OKX serves these routes publicly; it is only the missing browser header. Binance / Bybit are never
// fetched here (members' browsers call them directly; where those exchanges refuse a region, the chart says so).
// Allow-listed params only, 60 s edge cache, 8 s upstream timeout. Used by assets/chart-crypto-deriv.js. Deploys with the site.
const PERIODS = ['5m', '15m', '30m', '1H', '2H', '4H', '6H', '12H', '1D'];
const PATHS = { oi: 'open-interest-history', lsr: 'long-short-account-ratio-contract' };

function reply(body, status, ttl) {
  return new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*',
    'cache-control': ttl ? `public, max-age=${ttl}, s-maxage=${ttl}` : 'no-store' } });
}
// -> OKX URL or '' when a parameter is not allowed (exported for tools/tests/crypto-deriv.test.mjs)
export function upstreamUrl(sp) {
  const kind = sp.get('kind'), base = String(sp.get('base') || '').toUpperCase(), period = sp.get('period') || '5m', end = sp.get('end');
  if (!PATHS[kind] || !/^[A-Z0-9]{1,15}$/.test(base) || !PERIODS.includes(period) || (end && !/^\d{13}$/.test(end))) return '';
  return 'https://www.okx.com/api/v5/rubik/stat/contracts/' + PATHS[kind] + '?instId=' + base + '-USDT-SWAP&period=' + period + '&limit=100' + (end ? '&end=' + end : '');
}
export async function onRequestGet({ request }) {
  const u = upstreamUrl(new URL(request.url).searchParams);
  if (!u) return reply('{"error":"bad request"}', 400, 0);
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const key = new Request(u, { method: 'GET' });
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } }); } catch (e) { return reply('{"error":"upstream"}', 502, 0); }
  const body = await r.text();
  if (!r.ok) return reply(body, r.status, 0);
  const res = reply(body, 200, 60);
  if (cache) try { await cache.put(key, res.clone()); } catch (e) {}
  return res;
}
