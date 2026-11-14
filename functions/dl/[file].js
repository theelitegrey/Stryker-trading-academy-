// Fast desktop download (Owner 14 Nov "github download is slow"): /dl/TradeZoro-Setup.exe and /dl/TradeZoro-Portable.exe.
// Streams the latest GitHub release asset through Cloudflare and caches it at the edge for a day, so after the first
// download in a region every member gets it from Cloudflare's network instead of GitHub. Only the two known file names.
const FILES = new Set(['TradeZoro-Setup.exe', 'TradeZoro-Portable.exe']);
const REPO = 'theelitegrey/Stryker-trading-academy-';

export async function onRequestGet({ params, request, waitUntil }) {
  const name = String(params.file || '');
  if (!FILES.has(name)) return new Response('Not found', { status: 404 });
  const cache = caches.default;
  const key = new Request(new URL('/dl/' + name, request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const up = await fetch(`https://github.com/${REPO}/releases/latest/download/${name}`, {
    redirect: 'follow', cf: { cacheEverything: true, cacheTtl: 86400 },
  });
  if (!up.ok || !up.body) return Response.redirect(`https://github.com/${REPO}/releases/latest/download/${name}`, 302);
  const h = new Headers();
  h.set('Content-Type', 'application/vnd.microsoft.portable-executable');
  h.set('Content-Disposition', `attachment; filename="${name}"`);
  h.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  const len = up.headers.get('content-length'); if (len) h.set('Content-Length', len);
  const [a, b] = up.body.tee();
  waitUntil(cache.put(key, new Response(b, { status: 200, headers: h })).catch(() => {}));
  return new Response(a, { status: 200, headers: h });
}

export const onRequestHead = async (ctx) => {
  const r = await onRequestGet(ctx);
  return new Response(null, { status: r.status, headers: r.headers });
};
