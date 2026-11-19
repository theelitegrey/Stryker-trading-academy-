// Fast desktop download (Owner 14 Nov "github download is slow"): /dl/TradeZoro-Setup.exe and /dl/TradeZoro-Portable.exe.
// Streams the latest GitHub release asset through Cloudflare and caches it at the edge for a day, so after the first
// download in a region every member gets it from Cloudflare's network instead of GitHub. Only the two known file names.
// The edge cache key carries the release tag (/dl/desktop-v1.0.1/<file>), so publishing a new release serves the new
// exe within LATEST_TTL_S (5 min) instead of the old one for up to a day. The tag comes from github.com's own
// /releases/latest redirect (no API rate limit), itself cached for LATEST_TTL_S. Tests: tools/tests/dl-cache.test.mjs.
const FILES = new Set(['TradeZoro-Setup.exe', 'TradeZoro-Portable.exe']);
const REPO = 'theelitegrey/Stryker-trading-academy-';
const LATEST_TTL_S = 300;
const TAG_RE = /^desktop-v\d+\.\d+\.\d+$/;

// -> 'desktop-vX.Y.Z' or null. deps.fetchImpl / deps.cache are for tests.
export async function latestTag(request, deps = {}) {
  const cache = deps.cache || caches.default, fetchImpl = deps.fetchImpl || fetch;
  const key = new Request(new URL('/dl/__latest-tag', request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key).catch(() => null);
  if (hit) { const t = (await hit.text()).trim(); if (TAG_RE.test(t)) return t; }
  try {
    const r = await fetchImpl(`https://github.com/${REPO}/releases/latest`, { method: 'HEAD', redirect: 'manual' });
    const m = /\/releases\/tag\/([^/?#]+)$/.exec(r.headers.get('location') || '');
    const tag = m ? decodeURIComponent(m[1]) : '';
    if (!TAG_RE.test(tag)) return null;
    await cache.put(key, new Response(tag, { headers: { 'Cache-Control': `public, max-age=${LATEST_TTL_S}`, 'Content-Type': 'text/plain' } })).catch(() => {});
    return tag;
  } catch (e) { return null; }
}

export async function serve({ params, request, waitUntil }, deps = {}) {
  const name = String(params.file || '');
  if (!FILES.has(name)) return new Response('Not found', { status: 404 });
  const cache = deps.cache || caches.default, fetchImpl = deps.fetchImpl || fetch;
  const tag = await latestTag(request, deps);
  // No tag (GitHub hiccup): stream "latest" without the edge cache, so a stale exe is never pinned.
  const src = tag ? `https://github.com/${REPO}/releases/download/${tag}/${name}` : `https://github.com/${REPO}/releases/latest/download/${name}`;
  const key = tag ? new Request(new URL(`/dl/${tag}/${name}`, request.url).toString(), { method: 'GET' }) : null;
  // The tagged copy is kept a day in our own cache; what the browser/edge gets for /dl/<file> lives only LATEST_TTL_S,
  // otherwise Cloudflare pins the old exe on the plain URL for a day after a release (seen with desktop-v1.1.0).
  const outer = (r) => { const o = new Response(r.body, r); o.headers.set('Cache-Control', `public, max-age=${LATEST_TTL_S}, s-maxage=${LATEST_TTL_S}`); return o; };
  if (key) { const hit = await cache.match(key); if (hit) return outer(hit); }
  const up = await fetchImpl(src, tag ? { redirect: 'follow', cf: { cacheEverything: true, cacheTtl: 86400 } } : { redirect: 'follow' });
  if (!up.ok || !up.body) return Response.redirect(src, 302);
  const h = new Headers();
  h.set('Content-Type', 'application/vnd.microsoft.portable-executable');
  h.set('Content-Disposition', `attachment; filename="${name}"`);
  h.set('Cache-Control', `public, max-age=${LATEST_TTL_S}, s-maxage=86400`);
  if (tag) h.set('X-TZ-Release', tag);
  const len = up.headers.get('content-length'); if (len) h.set('Content-Length', len);
  if (!key) return outer(new Response(up.body, { status: 200, headers: h }));
  const [a, b] = up.body.tee();
  waitUntil(cache.put(key, new Response(b, { status: 200, headers: h })).catch(() => {}));
  return outer(new Response(a, { status: 200, headers: h }));
}

export const onRequestGet = (ctx) => serve(ctx);

export const onRequestHead = async (ctx) => {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
};
