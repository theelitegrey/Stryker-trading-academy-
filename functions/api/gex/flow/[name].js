// GET /api/gex/flow/:name  (SPX | QQQ | SPY) — options VOLUME by strike, calls vs puts, for the chain's session.
// Reads the compact Cboe chain our own server already posts to the book-recorder Worker every 2 min in market
// hours (GET <Worker>/gex-chain?sym=&part=near, server-to-server; the same read /api/gex/levels makes). NO new
// upstream: no InsightSentry, no Cboe call from here. Maths: functions/api/gex/_flow.js (pure, unit-tested).
// Edge-cached 60 s, so every viewer shares one Worker read a minute. Read-only, public market data.
// Education only. Not financial advice.
import { json } from '../_engine.js';
import { flowFromChain } from '../_flow.js';

const ALLOWED = ['SPX', 'QQQ', 'SPY'];
const CHAIN = 'https://book-recorder.theelitegrey.workers.dev/gex-chain';

async function readChain(sym, env) {
  const base = (env && env.GEX_CHAIN_URL) || CHAIN;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), 4000);
  try {
    const res = await fetch(base + '?sym=' + encodeURIComponent(sym) + '&part=near', { signal: ctrl.signal, headers: { 'user-agent': 'TradeZoroGEX/1.0' } });
    if (!res.ok) throw new Error('chain ' + res.status);
    const text = await new Response(new Blob([await res.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

export async function onRequestGet({ request, params, env }) {
  const name = String(params.name || '').toUpperCase();
  if (!ALLOWED.includes(name)) return json({ error: 'unknown market' }, { status: 404, cache: 'no-store' });
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const u = new URL(request.url);
  const key = new Request(u.origin + '/api/gex/flow/' + name + '?v=1&b=' + Math.floor(Date.now() / 60000));
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  try {
    const out = flowFromChain(await readChain(name, env));
    if (!out) throw new Error('empty chain');
    out.u = name;
    const res = json(out, { cache: 'public, max-age=60, s-maxage=60' });
    if (cache) await cache.put(key, res.clone());
    return res;
  } catch (e) {
    return json({ error: 'options volume unavailable', u: name }, { status: 503, cache: 'no-store' });
  }
}
