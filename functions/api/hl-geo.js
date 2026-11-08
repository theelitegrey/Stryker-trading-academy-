// GET /api/hl-geo -> { country, region } from Cloudflare's own request.cf (no third-party lookup, nothing stored or logged).
// Used by assets/hl-trade.js (admin beta) to hide Hyperliquid trading where Hyperliquid's terms exclude it; the block list is
// CONFIG.blockedCountries / blockedRegions in assets/hl-trade-core.js. Not cached: the answer belongs to one visitor.
export function geoOf(request) {
  const cf = (request && request.cf) || {};
  const country = String(cf.country || request.headers.get('cf-ipcountry') || '').toUpperCase().slice(0, 2);
  const region = String(cf.regionCode || '').toUpperCase().slice(0, 3);
  return { country, region };
}
export function onRequestGet({ request }) {
  return new Response(JSON.stringify(geoOf(request)), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });
}
