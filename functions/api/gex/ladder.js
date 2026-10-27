// GET /api/gex/ladder?u=SPX,QQQ,SPY&dte=0  — one small combined response for the GEX Ladder's per-second poll.
// Owner order 2026-10-16 ("auto update per second"). It adds NO data source and NO calculation: each market is
// read through the SAME handler as /api/gex/levels/<name> (same edge cache, same 0DTE/1DTE rules), then trimmed
// to what the ladder draws (spot, net, ladder rows, data time). The combined body is kept in the Cache API for
// 1 s and carries a strong ETag, so a poll with If-None-Match whose data did not change gets a 304 with no body.
// Education only. Not financial advice.
import { MARKETS, json } from './_engine.js';
import { onRequestGet as levelsGet } from './levels/[name].js';
import { gexAtSpot, netNear, ladderNear, flipAt, wallsAt } from '../../../assets/gex-fast-core.js';

// FAST path (InsightSentry add-on, 2026-10-16): the server feeder gex_fast.py rebuilds per-strike gamma x OI about every
// 15 s per underlying and posts the latest spot about once a second; this turns the newest block into the ladder at the
// newest spot with the SAME formula as the engine (assets/gex-fast-core.js, unit-tested against functions/api/gex/_engine.js).
// Anything missing / older than FAST_MAX_AGE_S -> the normal /api/gex/levels path (Cboe, ~1 min).
// Max age of a fast block, by expiry. Since 2026-10-25 (InsightSentry MONTHLY REST quota, CoS "is monthly quota 1026")
// gex_fast.py re-pulls each underlying's 0DTE chain every 120 s and its 1DTE chain every 600 s (was both every 15 s,
// ~9,700 REST calls a weekday). The ladder still moves every second: gamma is recomputed at the live spot below.
// Each block carries its own build time `b` (older feeders: the entry's `built`); the status shows that real age.
const FAST_MAX_AGE_S = { 0: 200, 1: 720 };
const FAST_SPOT_MAX_AGE_S = 20;
async function fetchFast(env) {
  const base = (env && env.GEX_CHAIN_URL) || 'https://book-recorder.theelitegrey.workers.dev/gex-chain';
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort('timeout'), 1500);
  try {
    const res = await fetch(base.replace(/\/gex-chain$/, '/gex-fast'), { signal: ctrl.signal, headers: { 'user-agent': 'TradeZoroGEX/1.0' } });
    if (!res.ok) return null;
    const text = await new Response(new Blob([await res.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  } catch (e) { return null; } finally { clearTimeout(timer); }
}
function fromFast(fast, u, dte, nowSec) {
  const e = fast && fast.u && fast.u[u], blk = e && e[String(dte)];
  const bt = blk && blk.b > 0 ? blk.b : e && e.built;
  if (!blk || blk.v !== 2 || !(nowSec - bt <= (FAST_MAX_AGE_S[dte] || 200))) return null;
  const sp = fast.spots && fast.spots[u];
  const spot = sp && sp.p > 0 && nowSec - sp.t <= FAST_SPOT_MAX_AGE_S ? sp.p : blk.s0;
  const rows = gexAtSpot(blk, spot);
  return { underlying: u, spot, net_gex: netNear(rows, spot), fetched_at: bt, built: bt, spot_t: sp ? sp.t : null, asof: null, expiry: blk.x,
    market: { state: 'open' }, ladder: ladderNear(rows, spot).map((r) => ({ strike: r.strike, gex: r.gex })), src: 'fast',
    max_pain: blk.mp == null ? null : blk.mp, zero_gamma: flipAt(blk, spot), ...wallsAt(blk, spot) };
}

const ALLOWED = ['SPX', 'QQQ', 'SPY'];
const TTL_S = 1;

function fnv(str) {                      // small stable hash for the ETag (not security)
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
function trim(d) {
  if (!d || d.error) return { error: (d && d.error) || 'no data' };
  const m = d.market || {};
  return {
    underlying: d.underlying, spot: d.spot, net_gex: d.net_gex, fetched_at: d.fetched_at, built: d.fetched_at, asof: d.asof, expiry: d.expiry,
    max_pain: d.max_pain, zero_gamma: d.zero_gamma, call_wall: d.call_wall, put_wall: d.put_wall, wall_method: d.wall_method,
    stale: d.stale ? true : undefined, market: { state: m.state, data_ts: m.data_ts, options_ts: m.options_ts },
    ladder: Array.isArray(d.ladder) ? d.ladder.map((r) => ({ strike: r.strike, gex: r.gex })) : []
  };
}
function notModified(request, etag) {
  const inm = request.headers.get('if-none-match');
  return inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);
}
function resp(body, etag, status) {
  const headers = { 'content-type': 'application/json; charset=utf-8', etag, 'cache-control': `public, max-age=0, s-maxage=${TTL_S}, must-revalidate` };
  return new Response(status === 304 ? null : body, { status: status || 200, headers });
}

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const want = [...new Set((url.searchParams.get('u') || 'SPX').toUpperCase().split(',').map((s) => s.trim()))].filter((s) => ALLOWED.includes(s) && MARKETS[s]).sort();
  if (!want.length) return json({ error: 'unknown market' }, { status: 400, cache: 'no-store' });
  const dte = Number(url.searchParams.get('dte') || 0);
  const safeDte = [0, 1, 7, 30].includes(dte) ? dte : 0;
  const cacheOk = typeof caches !== 'undefined' && caches.default;
  const key = new Request(`${url.origin}/api/gex/ladder?u=${want.join(',')}&dte=${safeDte}&gexcache=1s&v=583`, { method: 'GET' });
  if (cacheOk) {
    const hit = await caches.default.match(key);
    if (hit) { const etag = hit.headers.get('etag'); if (etag && notModified(request, etag)) return resp(null, etag, 304); return hit; }
  }
  const out = {};
  const nowSec = Date.now() / 1000;
  const fast = (safeDte === 0 || safeDte === 1) ? await fetchFast(env) : null;
  await Promise.all(want.map(async (u) => {
    const f = fast ? fromFast(fast, u, safeDte, nowSec) : null;
    if (f) {
      // Walls and zero gamma are the structure walls of /api/gex/levels (1-30 day chain, steady all day), the
      // same numbers the chart and the GEX page show. The fast block only moves the per-strike bars with spot.
      try {
        const r = await levelsGet({ request: new Request(`${url.origin}/api/gex/levels/${u}?dte=${safeDte}`, { method: 'GET' }), params: { name: u }, env });
        const lv = await r.json();
        if (lv && lv.wall_method === 'structure_1_30d') { f.call_wall = lv.call_wall; f.put_wall = lv.put_wall; f.zero_gamma = lv.zero_gamma; f.wall_method = lv.wall_method; }
      } catch (_) {}
      out[u] = f; return;
    }
    try {
      const r = await levelsGet({ request: new Request(`${url.origin}/api/gex/levels/${u}?dte=${safeDte}`, { method: 'GET' }), params: { name: u }, env });
      out[u] = trim(await r.json());
    } catch (e) { out[u] = { error: String(e && e.message || e).slice(0, 120) }; }
  }));
  const body = JSON.stringify({ dte: safeDte, u: out });
  const etag = '"' + fnv(body) + '"';
  const full = resp(body, etag, 200);
  if (cacheOk && want.every((u) => !out[u].error)) { try { await caches.default.put(key, full.clone()); } catch (_) {} }
  if (notModified(request, etag)) return resp(null, etag, 304);
  return full;
}
