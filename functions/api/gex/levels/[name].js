import { buildLevels, json, MARKETS, cashScheduleOpen, secsToCashOpen } from '../_engine.js';

const inflight = new Map();

function cacheAvailable() { return typeof caches !== 'undefined' && caches.default; }
function cacheKey(request, name, dte, kind = 'fresh') {
  const u = new URL(request.url);
  u.search = `dte=${dte}&gexcache=${kind}&v=487`;
  return new Request(u.toString(), { method: 'GET' });
}
// Edge TTL (s-maxage) and stale-while-revalidate, in seconds.
// Long caching only while the cash session is closed BY SCHEDULE (weekend, overnight, before 09:30 /
// after 16:15 ET), and never past the next 09:30 ET open. Inside cash hours (incl. the opening gap,
// when Cboe's ~15-min delayed chain is still from the prior session) everything stays short.
function cacheTtl(data, now = Date.now() / 1000) {
  const state = data?.market?.state;
  const t = data?.market?.now || now;
  if ((state === 'closed' || state === 'cash_closed') && !cashScheduleOpen(t) && !cashScheduleOpen(now)) {
    const toOpen = secsToCashOpen(now, 2400);
    const ttl = Math.max(60, Math.min(1800, toOpen - 60));
    // edge TTL + stale window together must end before 09:30 ET
    return { edge: ttl, swr: Math.max(0, Math.min(300, toOpen - ttl)) };
  }
  if (state === 'open') return { edge: 90, swr: 120 };
  return { edge: 60, swr: 60 };
}
// Browser max-age is capped at 60 s; long caching happens only at the edge via s-maxage.
function cacheHeaders(ttl, stale = 300) {
  const edge = typeof ttl === 'object' ? ttl.edge : ttl;
  const swr = typeof ttl === 'object' ? ttl.swr : stale;
  return { 'cache-control': `public, max-age=${Math.min(60, edge)}, s-maxage=${edge}, stale-while-revalidate=${swr}` };
}
async function readCached(request, name, dte, kind = 'fresh') {
  if (!cacheAvailable()) return null;
  const res = await caches.default.match(cacheKey(request, name, dte, kind));
  return res || null;
}
async function writeCached(request, name, dte, data) {
  if (!cacheAvailable()) return;
  const ttl = cacheTtl(data);
  const fresh = json(data, { headers: cacheHeaders(ttl), cache: cacheHeaders(ttl)['cache-control'] });
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

export { cacheTtl, cacheHeaders };

export async function onRequestGet({ request, params, env }) {
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
      p = buildLevels(name, safeDte, env || {}).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const data = await p;
    await writeCached(request, name, safeDte, data);
    const ttl = cacheTtl(data);
    return json(data, { headers: cacheHeaders(ttl), cache: cacheHeaders(ttl)['cache-control'] });
  } catch (error) {
    const stale = await staleResponse(request, name, safeDte, error);
    if (stale) return stale;
    return json({ error: error.message || String(error) }, { status: 500, cache: 'no-store' });
  }
}
