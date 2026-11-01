// GEX is Pro only (Owner order 2026-11-01). Wraps a Pages Function so it answers only an admin / demo / active Pro token.
// Everyone else gets 403 {error:'pro_required'} and NO GEX data. The check runs before any cache read, and the answer is never
// stored by a shared cache (private + Vary: Authorization). Education only. Not financial advice.
import { isGexProToken, bearerOf } from '../chart/_rt.js';

export function gexPro(handler) {
  return async (ctx) => {
    const tok = bearerOf(ctx.request);
    if (!(await isGexProToken(tok))) {
      return new Response(JSON.stringify({ error: 'pro_required', message: 'GEX+ is part of Pro.' }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    // the recorder's raw chain reads (/gex-chain, /gex-fast) re-check this same token (env.GEX_AUTH)
    const r = await handler(Object.assign({}, ctx, { env: Object.assign({}, ctx.env, { GEX_AUTH: 'Bearer ' + tok }) }));
    const h = new Headers(r.headers);
    h.set('cache-control', (h.get('cache-control') || 'no-store').replace(/\bpublic\b/g, 'private').replace(/,?\s*s-maxage=\d+/g, ''));
    h.append('vary', 'Authorization');
    return new Response(r.status === 304 ? null : r.body, { status: r.status, headers: h });
  };
}
