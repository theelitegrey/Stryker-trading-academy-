import { yahooCandles, json, FUTURES } from '../_engine.js';

const inflight = new Map();
function cacheAvailable() { return typeof caches !== 'undefined' && caches.default; }
function cacheKey(request, fut, interval, kind = 'fresh') {
  const u = new URL(request.url);
  u.search = `interval=${encodeURIComponent(interval)}&gexcache=${kind}&v=485`;
  return new Request(u.toString(), { method: 'GET' });
}
function headers(ttl, stale = 300) { return { 'cache-control': `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${stale}` }; }
async function cached(request, fut, interval, kind = 'fresh') {
  if (cacheAvailable()) return caches.default.match(cacheKey(request, fut, interval, kind));
  return null;
}
async function writeCached(request, fut, interval, data) {
  if (!cacheAvailable()) return;
  await Promise.all([
    caches.default.put(cacheKey(request, fut, interval, 'fresh'), json(data, { headers: headers(60, 300), cache: headers(60, 300)['cache-control'] })),
    caches.default.put(cacheKey(request, fut, interval, 'lastgood'), json(data, { headers: headers(86400, 0), cache: headers(86400, 0)['cache-control'] }))
  ]);
}

export async function onRequestGet({ request, params }) {
  const fut = String(params.fut || '').toUpperCase();
  if (!FUTURES[fut]) return json({ error: 'unknown futures symbol' }, { status: 404, cache: 'no-store' });
  const url = new URL(request.url);
  const interval = url.searchParams.get('interval') || '5m';
  try {
    const hit = await cached(request, fut, interval, 'fresh');
    if (hit) return hit;
    const key = `${fut}:${interval}`;
    let p = inflight.get(key);
    if (!p) {
      p = yahooCandles(fut, interval).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const data = await p;
    await writeCached(request, fut, interval, data);
    return json(data, { headers: headers(60, 300), cache: headers(60, 300)['cache-control'] });
  } catch (error) {
    const last = await cached(request, fut, interval, 'lastgood');
    if (last) {
      const data = await last.json();
      data.stale = true;
      data.stale_reason = error.message || String(error);
      return json(data, { headers: headers(30, 300), cache: headers(30, 300)['cache-control'] });
    }
    return json({ error: error.message || String(error) }, { status: 500, cache: 'no-store' });
  }
}
