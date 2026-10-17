// GET /api/chart/bars/:sym?tf=15&page=N
// Futures and spot forex bars for the Charts page (assets/chart-futures-provider.js). Allow-listed symbols only.
// Response: { s, tf, page, bars: [[t, o, h, l, c, v], ...] } (t = bar open, epoch seconds).
// `page` is an epoch-aligned window index (see _bars.js); omitted = the page holding now.
// Protections copied from /api/gex/candles: edge cache, last-good fallback, in-flight de-dupe,
// upstream timeout. An out-of-range page (older than Yahoo keeps, or in the future) is [] not an error.
import { isRealtimeToken, bearerOf, RT_DELAY_S } from '../_rt.js';
import { TIMEFRAMES, INSIGHTSENTRY_CODES, isForex, normSym, normTf, pageOf, fetchPage, fetchInsightPage, mergeTail, ttlFor, OutOfRange } from '../_bars.js';

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

// Live tail: Yahoo's newest bar is ~10 min old, InsightSentry's is current but its series takes ~6 s
// to arrive, so it is fetched in the background (waitUntil) into a short "tail" cache entry and laid
// over the page on this and later requests (also on cache hits). Never blocks, never throws. The tail entry lives an hour (a stale tail still beats Yahoo's 10-min lag;
// the re-fetch is due after 12 s), so a quiet edge is rarely cold.
async function withTail(res, ctx, request, cache, sym, tf, page, current, now) {
  try {
    if (!cache || ctx.noTail || page < current - 1 || !INSIGHTSENTRY_CODES[sym] || !TIMEFRAMES[tf].page || ttlFor(tf, page, now, sym) > 60) return res;
    const k = `${sym}:${tf}:${page}`, tailKey = keyFor(request, sym, tf, page, 'tail');
    const hitT = await cache.match(tailKey);
    let tail = null, tailAge = 1e9;
    if (hitT) { const j = await hitT.json(); tail = j.bars; tailAge = now - j.at; }
    if (tailAge > 12 && !inflight.has('tail:' + k)) {
      const w = fetchInsightPage(sym, tf, page, now, ctx.env || {}, null, 15000).then((rows) => {
        if (rows && rows.length) { tail = tail || rows; return cache.put(tailKey, reply({ at: Math.floor(Date.now() / 1000), bars: rows }, 200, 3600)); }
      }).catch(() => {}).finally(() => inflight.delete('tail:' + k));
      inflight.set('tail:' + k, w);
      if (ctx.waitUntil) ctx.waitUntil(w);
      // Cold edge (no tail at all): wait for it once (about 6 s), so the first view is current too.
      if (!tail) await Promise.race([w, new Promise((r) => setTimeout(r, 9000))]);
    }
    if (!tail || !tail.length) return res;
    const body = await res.clone().json();
    body.bars = mergeTail(body.bars || [], tail);
    return reply(body, 200, Math.min(ttlFor(tf, page, now, sym), 15), res.headers.get('x-bars-cache') || 'MISS');
  } catch (e) { return res; }
}

async function serve(ctx, admin) {
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
  // Non-admins read a separate cache lane and a Yahoo-only source (no InsightSentry env at all), so a
  // real-time row can never enter their response; Yahoo's CME feed is itself ~10 min behind.
  const KD = admin || isForex(sym) ? '' : 'd';
  const env = admin || isForex(sym) ? (ctx.env || {}) : {};
  const freshKey = keyFor(request, sym, tf, page, 'fresh' + KD);
  try {
    if (cache) {
      const hit = await cache.match(freshKey);
      if (hit) return await withTail(hitOf(hit), ctx, request, cache, sym, tf, page, current, now);
    }
    const k = `${sym}:${tf}:${page}${KD}`;
    let p = inflight.get(k);
    if (!p) {
      p = fetchPage(sym, tf, page, now, fetch, env).finally(() => inflight.delete(k));
      inflight.set(k, p);
    }
    let bars = await p;
    const ttl = ttlFor(tf, page, now, sym);
    const body = { s: sym, tf, page, bars };
    if (cache) {
      const writes = [cache.put(freshKey, reply(body, 200, ttl))];
      if (bars.length) writes.push(cache.put(keyFor(request, sym, tf, page, 'lastgood' + KD), reply(body, 200, 7 * 86400)));
      const w = Promise.all(writes).catch(() => {});
      if (ctx.waitUntil) ctx.waitUntil(w); else await w;
    }
    const out = reply(body, 200, ttl, 'MISS');
    return await withTail(out, ctx, request, cache, sym, tf, page, current, now);
  } catch (error) {
    if (error instanceof OutOfRange) {
      const body = { s: sym, tf, page, bars: [] };
      if (cache) {
        const w = cache.put(freshKey, reply(body, 200, 86400)).catch(() => {});
        if (ctx.waitUntil) ctx.waitUntil(w); else await w;
      }
      return reply(body, 200, page === current ? 60 : 86400);
    }
    const last = cache ? await cache.match(keyFor(request, sym, tf, page, 'lastgood' + KD)) : null;
    if (last) {
      const body = await last.json();
      body.stale = true;
      return reply(body, 200, 20, 'STALE');
    }
    return reply({ error: 'upstream unavailable' }, 502, 0);
  }
}


// CME futures real-time is admin only (Owner 2026-10-16). Non-admins are served from the Yahoo-only
// lane above (~10 min behind by nature); delayRows is the belt on top: no bar opened after now - 10 min.
// (Forex is not CME and is untouched.) Admins get the InsightSentry tail as before.
export function delayRows(rows, nowSec) {
  const cut = nowSec - RT_DELAY_S;
  return rows.filter((r) => r[0] <= cut);
}

export async function onRequestGet(ctx) {
  const sym = normSym(ctx.params.sym);
  if (!sym || isForex(sym)) return serve(ctx, true);
  const admin = await isRealtimeToken(bearerOf(ctx.request));
  ctx.noTail = !admin;
  const res = await serve(ctx, admin);
  if (res.status !== 200) return res;
  const out = new Response(res.body, res);
  out.headers.set('vary', 'Authorization');
  if (admin) { out.headers.set('cache-control', 'private, max-age=10'); return out; }
  try {
    const body = await out.json();
    body.bars = delayRows(body.bars || [], Math.floor(Date.now() / 1000));
    const h = new Headers(out.headers);
    h.delete('content-length'); h.delete('content-encoding');
    return new Response(JSON.stringify(body), { status: 200, headers: h });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
}
