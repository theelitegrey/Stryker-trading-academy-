// tz-finatic-edge: the broker routes, run next to the broker API (see wrangler.jsonc). Reached ONLY through the Pages service binding
// FINATIC_EDGE (no public URL), so x-tz-ip (set by functions/connect/finatic/_fin.js pagesEntry from the visitor's cf-connecting-ip)
// is trusted and becomes cf-connecting-ip for the per-IP rate limit. Every guard (origin, admin, kill switch, caps, audit) runs inside
// the same handlers; this file only routes.
import { handle as order } from '../../../functions/connect/finatic/order.js';
import { handle as data } from '../../../functions/connect/finatic/data.js';
import { handle as session } from '../../../functions/connect/finatic/session.js';

export const ROUTES = { '/connect/finatic/order': order, '/connect/finatic/data': data, '/connect/finatic/session': session };

export function route(request, env, ctx) {
  const url = new URL(request.url);
  const h = ROUTES[url.pathname];
  if (!h) return new Response(JSON.stringify({ error: 'Not found', code: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  const hd = new Headers(request.headers);
  hd.set('cf-connecting-ip', request.headers.get('x-tz-ip') || 'unknown');
  for (const k of [...hd.keys()]) if (k.toLowerCase().startsWith('x-tz-')) hd.delete(k);
  const req = new Request(request.url, { method: request.method, headers: hd, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body, redirect: 'manual', duplex: 'half' });
  const defer = (p) => { const q = Promise.resolve(p).catch(() => {}); try { ctx && ctx.waitUntil && ctx.waitUntil(q); } catch (e) {} return q; };
  return h(req, env, { defer });
}

export default { fetch: (request, env, ctx) => route(request, env, ctx) };
