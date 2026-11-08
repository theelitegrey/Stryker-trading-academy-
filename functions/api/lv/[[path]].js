// /api/lv/*  (LEVELS-EXPORT): same-origin pass-through to the book-recorder Worker's /lv/* routes (workers/book-recorder/src/levels-feed.js).
//   /api/lv/pack, /api/lv/token   the member's sign-in token is forwarded; the Worker checks Pro (fail closed). Nothing is decided here.
//   /api/lv/feed/<secret>.<ext>   the member's secret link for platform plugins; the secret is the credential. The path is never logged here.
// Responses are never stored by a shared cache. Education only. Not financial advice.
const WORKER = 'https://book-recorder.theelitegrey.workers.dev/lv/';
const J = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const OK = /^(pack|token|feed\/[A-Za-z0-9_-]{43}\.[a-z]{2,6})$/;

export async function onRequest({ request, params, env }) {
  const path = [].concat(params.path || []).join('/');
  if (!OK.test(path)) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: J });
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return new Response('method not allowed', { status: 405, headers: J });
  if (path.startsWith('feed/') && request.method !== 'GET') return new Response('GET only', { status: 405, headers: J });
  const url = new URL(request.url);
  const base = (env && env.LV_WORKER_URL) || WORKER;
  const auth = request.headers.get('authorization');
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort('timeout'), 8000);
  try {
    const r = await fetch(base + path + url.search, { method: request.method, signal: ctrl.signal, headers: Object.assign({ 'user-agent': 'TradeZoroLevels/1.0' }, auth ? { authorization: auth } : {}) });
    const h = new Headers({ 'content-type': r.headers.get('content-type') || J['content-type'], 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', vary: 'Authorization' });
    const ra = r.headers.get('retry-after'); if (ra) h.set('retry-after', ra);
    return new Response(r.body, { status: r.status, headers: h });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: J });
  } finally { clearTimeout(timer); }
}
