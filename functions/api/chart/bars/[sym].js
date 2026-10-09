// GET /api/chart/bars/:sym?tf=15&page=N
// Futures and spot forex bars for the Charts page (assets/chart-futures-provider.js). Allow-listed symbols only.
// Response: { s, tf, page, bars: [[t, o, h, l, c, v], ...] } (t = bar open, epoch seconds).
// `page` is an epoch-aligned window index (see _bars.js); omitted = the page holding now.
// Protections copied from /api/gex/candles: edge cache, last-good fallback, in-flight de-dupe,
// upstream timeout. An out-of-range page (older than Yahoo keeps, or in the future) is [] not an error.
import { TIMEFRAMES, normSym, normTf, pageOf, fetchPage, ttlFor, OutOfRange } from '../_bars.js';

const VERSION = 1;
const inflight = new Map();

function reply(data, status, ttl) {
  const cc = ttl > 0 ? `public, max-age=${Math.min(ttl, 3600)}, s-maxage=${ttl}` : 'no-store';
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cc, 'access-control-allow-origin': '*' }
  });
}
function edge() { return typeof caches !== 'undefined' && caches.default ? caches.default : null; }
function keyFor(request, sym, tf, page, kind) {
  const u = new URL(request.url);
  u.pathname = `/api/chart/bars/${sym}`;
  u.search = `tf=${tf}&page=${page}&k=${kind}&v=${VERSION}`;
  return new Request(u.toString(), { method: 'GET' });
}

export async function onRequestGet(ctx) {
  const { request, params } = ctx;
  const sym = normSym(params.sym);
  if (!sym) return reply({ error: 'unknown symbol' }, 404, 3600);
  const url = new URL(request.url);
  const tf = normTf(url.searchParams.get('tf') || '15');
  if (!tf) return reply({ error: 'unsupported timeframe', timeframes: Object.keys(TIMEFRAMES) }, 400, 3600);
  const now = Math.floor(Date.now() / 1000);
  const current = pageOf(tf, now);
  let page = url.searchParams.has('page') ? Number(url.searchParams.get('page')) : current;
  if (!Number.isInteger(page) || page < 0) return reply({ error: 'bad page' }, 400, 3600);
  if (page > current) return reply({ s: sym, tf, page, bars: [] }, 200, 300);

  const cache = edge();
  const freshKey = keyFor(request, sym, tf, page, 'fresh');
  try {
    if (cache) {
      const hit = await cache.match(freshKey);
      if (hit) return hit;
    }
    const k = `${sym}:${tf}:${page}`;
    let p = inflight.get(k);
    if (!p) {
      p = fetchPage(sym, tf, page, now, fetch, ctx.env || {}).finally(() => inflight.delete(k));
      inflight.set(k, p);
    }
    const bars = await p;
    const ttl = ttlFor(tf, page, now, sym);
    const body = { s: sym, tf, page, bars };
    if (cache) {
      const writes = [cache.put(freshKey, reply(body, 200, ttl))];
      if (bars.length) writes.push(cache.put(keyFor(request, sym, tf, page, 'lastgood'), reply(body, 200, 7 * 86400)));
      const w = Promise.all(writes).catch(() => {});
      if (ctx.waitUntil) ctx.waitUntil(w); else await w;
    }
    return reply(body, 200, ttl);
  } catch (error) {
    if (error instanceof OutOfRange) {
      const body = { s: sym, tf, page, bars: [] };
      if (cache) {
        const w = cache.put(freshKey, reply(body, 200, 86400)).catch(() => {});
        if (ctx.waitUntil) ctx.waitUntil(w); else await w;
      }
      return reply(body, 200, page === current ? 60 : 86400);
    }
    const last = cache ? await cache.match(keyFor(request, sym, tf, page, 'lastgood')) : null;
    if (last) {
      const body = await last.json();
      body.stale = true;
      return reply(body, 200, 20);
    }
    return reply({ error: 'upstream unavailable' }, 502, 0);
  }
}

