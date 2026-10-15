// GET /api/chart/bars/:sym?tf=15&page=N
// Futures and spot forex bars for the Charts page (assets/chart-futures-provider.js). Allow-listed symbols only.
// Response: { s, tf, page, bars: [[t, o, h, l, c, v], ...] } (t = bar open, epoch seconds).
// `page` is an epoch-aligned window index (see _bars.js); omitted = the page holding now.
// Protections copied from /api/gex/candles: edge cache, last-good fallback, in-flight de-dupe,
// upstream timeout. An out-of-range page (older than Yahoo keeps, or in the future) is [] not an error.
import { TIMEFRAMES, INSIGHTSENTRY_CODES, normSym, normTf, pageOf, fetchPage, fetchInsightPage, mergeTail, ttlFor, OutOfRange } from '../_bars.js';

const VERSION = 1;
const inflight = new Map();

function reply(data, status, ttl, state) {
  const cc = ttl > 0 ? `public, max-age=${Math.min(ttl, 3600)}, s-maxage=${ttl}` : 'no-store';
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': cc, 'access-control-allow-origin': '*' };
  if (state) headers['x-bars-cache'] = state; // HIT / MISS / STALE: read by tools/tests/chart-switch-perf.js
  return new Response(JSON.stringify(data), { status, headers });
}
// A cached copy, marked as a cache hit (the stored response itself carries no x-bars-cache).
function hitOf(res) {
  const out = new Response(res.body, res);
  out.headers.set('x-bars-cache', 'HIT');
  return out;
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
      if (hit) return hitOf(hit);
    }
    const k = `${sym}:${tf}:${page}`;
    let p = inflight.get(k);
    if (!p) {
      p = fetchPage(sym, tf, page, now, fetch, ctx.env || {}).finally(() => inflight.delete(k));
      inflight.set(k, p);
    }
    let bars = await p;
    // Live tail: Yahoo's newest bar is ~10 min old, InsightSentry's is current but its series takes
    // ~5 s to arrive, so it is fetched in the background (waitUntil) into a 2-min "tail" cache entry
    // and laid over the page on this and the next requests (staleness <= ~ the page TTL + 20 s).
    if (cache && page >= current - 1 && INSIGHTSENTRY_CODES[sym] && TIMEFRAMES[tf].page && ttlFor(tf, page, now, sym) <= 60) {
      const tailKey = keyFor(request, sym, tf, page, 'tail');
      const hitT = await cache.match(tailKey);
      let tail = null, tailAge = 1e9;
      if (hitT) { try { const j = await hitT.json(); tail = j.bars; tailAge = now - j.at; } catch (e) {} }
      if (tailAge > 15 && !inflight.has('tail:' + k)) {
        const w = fetchInsightPage(sym, tf, page, now, ctx.env || {}, null, 15000).then((rows) => {
          if (rows && rows.length) return cache.put(tailKey, reply({ at: Math.floor(Date.now() / 1000), bars: rows }, 200, 120));
        }).catch(() => {}).finally(() => inflight.delete('tail:' + k));
        inflight.set('tail:' + k, w);
        if (ctx.waitUntil) ctx.waitUntil(w);
      }
      if (tail && tail.length) bars = mergeTail(bars, tail);
    }
    const ttl = ttlFor(tf, page, now, sym);
    const body = { s: sym, tf, page, bars };
    if (cache) {
      const writes = [cache.put(freshKey, reply(body, 200, ttl))];
      if (bars.length) writes.push(cache.put(keyFor(request, sym, tf, page, 'lastgood'), reply(body, 200, 7 * 86400)));
      const w = Promise.all(writes).catch(() => {});
      if (ctx.waitUntil) ctx.waitUntil(w); else await w;
    }
    return reply(body, 200, ttl, 'MISS');
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
      return reply(body, 200, 20, 'STALE');
    }
    return reply({ error: 'upstream unavailable' }, 502, 0);
  }
}

