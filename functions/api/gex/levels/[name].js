import { buildLevels, json, MARKETS } from '../_engine.js';

const inflight = new Map();

function cacheAvailable() { return typeof caches !== 'undefined' && caches.default; }
function cacheKey(request, name, dte, kind = 'fresh') {
  const u = new URL(request.url);
  u.search = `dte=${dte}&gexcache=${kind}&v=385`;
  return new Request(u.toString(), { method: 'GET' });
}
function cacheTtl(data) {
  const state = data?.market?.state;
  return (state === 'closed' || state === 'cash_closed') ? 1800 : 90;
}
function cacheHeaders(ttl, stale = 300) {
  return { 'cache-control': `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${stale}` };
}
async function readCached(request, name, dte, kind = 'fresh') {
  if (!cacheAvailable()) return null;
  const res = await caches.default.match(cacheKey(request, name, dte, kind));
  return res || null;
}
async function writeCached(request, name, dte, data) {
  if (!cacheAvailable()) return;
  const ttl = cacheTtl(data);
  const fresh = json(data, { headers: cacheHeaders(ttl, ttl), cache: cacheHeaders(ttl, ttl)['cache-control'] });
  const stale = json(data, { headers: cacheHeaders(172800, 0), cache: cacheHeaders(172800, 0)['cache-control'] });
  await Promise.all([
    caches.default.put(cacheKey(request, name, dte, 'fresh'), fresh.clone()),
    caches.default.put(cacheKey(request, name, dte, 'lastgood'), stale.clone())
  ]);
}
async function staleResponse(request, name, dte, error) {
  const cached = await readCached(request, name, dte, 'lastgood');
  if (!cached) return null;
  const data = await cached.json();
  data.stale = true;
  data.stale_reason = error?.message || String(error || 'refresh failed');
  return json(data, { headers: cacheHeaders(30, 300), cache: cacheHeaders(30, 300)['cache-control'] });
}

export async function onRequestGet({ request, params }) {
  const name = String(params.name || '').toUpperCase();
  if (!MARKETS[name]) return json({ error: 'unknown market' }, { status: 404, cache: 'no-store' });
  const url = new URL(request.url);
  const dte = Number(url.searchParams.get('dte') || 1);
  const safeDte = [0, 1, 7, 30].includes(dte) ? dte : 1;
  try {
    const cached = await readCached(request, name, safeDte, 'fresh');
    if (cached) return cached;
    const key = `${name}:${safeDte}`;
    let p = inflight.get(key);
    if (!p) {
      p = buildLevels(name, safeDte).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const data = await p;
    await writeCached(request, name, safeDte, data);
    return json(data, { headers: cacheHeaders(cacheTtl(data), cacheTtl(data)), cache: cacheHeaders(cacheTtl(data), cacheTtl(data))['cache-control'] });
  } catch (error) {
    const stale = await staleResponse(request, name, safeDte, error);
    if (stale) return stale;
    return json({ error: error.message || String(error) }, { status: 500, cache: 'no-store' });
  }
}
