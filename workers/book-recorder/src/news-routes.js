// News + economic calendar routes of the book-recorder Worker (src/index.js hooks them in).
// Data model and rules: src/news.js. Feeder: news-feeder/news_feeder.mjs (this server).
//
//   POST /news-ingest            feeder only (x-ingest-key), JSON { items: [compact news] } <= 512 KB
//   POST /cal-ingest?kind=K      feeder only, JSON { fetched_at, days?, items } <= 512 KB
//   GET  /news?sym=&q=&from=&to=&limit=   public (our origins), edge-cached 60 s
//        sym: NQ ES YM GC SI CL BTC ETH or empty (all markets); from/to epoch seconds (or ms);
//        `to` is also the bar-replay cut-off: nothing published after it is returned.
//   GET  /cal?kind=events&from=YYYY-MM-DD&to=YYYY-MM-DD   (<= 45 days), or kind=earnings|dividends|ipos
//        edge-cached 5 min.
// Reads have their own per-IP limit (RLN, 60/min) so typing in the search box is not refused by
// the 20/min book-history limit.
import {
  validateNewsItems, queryNews, NEWS_KEEP_S, NEWS_MAX_BODY, CAL_MAX_BODY, NEWS_SYMS, CAL_KINDS, validateCal, calRange,
  storeInit, storeNewsIngest, storeNewsRead, storeNewsStats, storeCalIngest, storeCalRead, storeCalStats
} from './news.js';

export { storeInit };

const json = (o, status, headers) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers || {}) });

// ---- Durable Object side ----------------------------------------------------------------------
export async function newsDo(self, u, req) {
  const p = u.pathname;
  const nowSec = Math.floor(Date.now() / 1000);
  if (p === '/n/news-ingest') {
    const { items } = await req.json();
    const r = storeNewsIngest(self.sql, items, nowSec);
    self.newsAll = null;
    self.meta('newsLast', JSON.stringify({ ts: nowSec, n: items.length, added: r.added, total: r.total }));
    return json(r);
  }
  if (p === '/n/news') {
    if (!self.newsAll || nowSec - self.newsAll.at > 300) self.newsAll = { at: nowSec, items: storeNewsRead(self.sql, nowSec - NEWS_KEEP_S, nowSec + 3600) };
    const q = Object.fromEntries(u.searchParams);
    const items = queryNews(self.newsAll.items, q);
    const last = JSON.parse(self.meta('newsLast') || 'null');
    return json({ items, updated: last ? last.ts : null });
  }
  if (p === '/n/cal-ingest') {
    const body = await req.json();
    const kind = u.searchParams.get('kind');
    const n = storeCalIngest(self.sql, kind, body, Date.now());
    self.meta('calLast:' + kind, String(body.fetched_at));
    return json({ stored: n });
  }
  if (p === '/n/cal') {
    return json(storeCalRead(self.sql, u.searchParams.get('kind'), u.searchParams.get('from'), u.searchParams.get('to')));
  }
  return new Response('not found', { status: 404 });
}
newsDo.stats = (self) => ({ store: storeNewsStats(self.sql), last: JSON.parse(self.meta('newsLast') || 'null'), cal: storeCalStats(self.sql) });

// ---- Worker side ------------------------------------------------------------------------------
async function ingestCommon(req, env, authorized, max) {
  if (req.method !== 'POST') return { res: new Response('POST only', { status: 405 }) };
  if (!(await authorized(req, env))) return { res: new Response('unauthorized', { status: 401 }) };
  if (Number(req.headers.get('content-length') || 0) > max) return { res: new Response('too large', { status: 413 }) };
  const buf = await req.arrayBuffer();
  if (buf.byteLength > max) return { res: new Response('too large', { status: 413 }) };
  try { return { body: JSON.parse(new TextDecoder().decode(buf)) }; } catch (e) { return { res: new Response('bad json', { status: 400 }) }; }
}
export async function newsIngestRoute(req, env, authorized, stub) {
  const r = await ingestCommon(req, env, authorized, NEWS_MAX_BODY);
  if (r.res) return r.res;
  const v = validateNewsItems(r.body && r.body.items, Math.floor(Date.now() / 1000));
  if (v.error) return new Response(v.error, { status: 400 });
  return stub(env).fetch('https://do/n/news-ingest', { method: 'POST', body: JSON.stringify({ items: v.items }) });
}
export async function calIngestRoute(req, env, u, authorized, stub) {
  const r = await ingestCommon(req, env, authorized, CAL_MAX_BODY);
  if (r.res) return r.res;
  const kind = String(u.searchParams.get('kind') || '');
  const v = validateCal(kind, r.body, Date.now());
  if (v.error) return new Response(v.error, { status: 400 });
  return stub(env).fetch('https://do/n/cal-ingest?kind=' + kind, { method: 'POST', body: JSON.stringify(r.body) });
}

async function limited(req, env, h) {
  const lim = env.RLN || env.RL;
  if (!lim) return null;
  try {
    const { success } = await lim.limit({ key: 'n:' + (req.headers.get('cf-connecting-ip') || 'anon') });
    if (!success) return new Response('slow down', { status: 429, headers: Object.assign({ 'retry-after': '30' }, h) });
  } catch (e) {}
  return null;
}
async function cached(ckey, maxAge, ctx, h, load) {
  const cache = caches.default, key = new Request(ckey);
  let res = await cache.match(key);
  if (!res) {
    const d = await load();
    res = new Response(await d.arrayBuffer(), { status: d.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + maxAge } });
    if (d.status === 200) ctx.waitUntil(cache.put(key, res.clone()));
  }
  const out = new Response(res.body, res);
  Object.entries(h).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}

// Normalised /news query: shared cache entries for every viewer. `to` rounds UP to the minute
// (never past the current minute), `from` DOWN to the hour, at most 7 days back.
export function newsParams(sp, nowSec) {
  const sym = String(sp.get('sym') || '').toUpperCase();
  if (sym && sym !== 'ALL' && !NEWS_SYMS.includes(sym)) return null;
  const q = String(sp.get('q') || '').toLowerCase().replace(/[^a-z0-9&.\-' ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  let to = Number(sp.get('to')) || nowSec, from = Number(sp.get('from')) || 0;
  if (to > 1e11) to = Math.floor(to / 1000);
  if (from > 1e11) from = Math.floor(from / 1000);
  const nowM = Math.ceil(nowSec / 60) * 60;
  to = Math.min(Math.ceil(to / 60) * 60, nowM);
  from = Math.max(from ? Math.floor(from / 3600) * 3600 : 0, Math.floor((nowSec - NEWS_KEEP_S) / 3600) * 3600);
  const limit = Math.max(1, Math.min(500, Math.round(Number(sp.get('limit')) || 100)));
  if (!(to > from)) return null;
  return { sym: sym === 'ALL' ? '' : sym, q, from, to, limit, final: to < nowSec - 3600 };
}
export async function newsRoute(req, u, env, ctx, h, stub) {
  const rl = await limited(req, env, h);
  if (rl) return rl;
  const p = newsParams(u.searchParams, Date.now() / 1000);
  if (!p) return new Response('bad request', { status: 400, headers: h });
  const qs = 'sym=' + p.sym + '&q=' + encodeURIComponent(p.q) + '&from=' + p.from + '&to=' + p.to + '&limit=' + p.limit;
  return cached('https://book-recorder.cache/news/v1?' + qs, p.final ? 600 : 60, ctx, h, () => stub(env).fetch('https://do/n/news?' + qs));
}
export async function calRoute(req, u, env, ctx, h, stub) {
  const rl = await limited(req, env, h);
  if (rl) return rl;
  const kind = String(u.searchParams.get('kind') || 'events');
  if (!CAL_KINDS.includes(kind)) return new Response('bad kind', { status: 400, headers: h });
  let qs = 'kind=' + kind;
  if (kind === 'events') {
    const r = calRange(u.searchParams.get('from'), u.searchParams.get('to'), Date.now());
    if (!r) return new Response('bad range', { status: 400, headers: h });
    qs += '&from=' + r.from + '&to=' + r.to;
  }
  const bucket = Math.floor(Date.now() / 300000);
  return cached('https://book-recorder.cache/cal/v1/' + bucket + '?' + qs, 300, ctx, h, () => stub(env).fetch('https://do/n/cal?' + qs));
}
