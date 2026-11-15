// GET /api/ping -> { t, colo } (Owner order 15 Nov 2026: chart latency indicator, assets/chart-latency.js).
// t = this server's clock (ms) so the browser can line its clock up with ours and measure how old a streamed
// bar is; colo = the Cloudflare data centre (IATA code) that answered, shown as "<city> edge". Nothing stored,
// nothing logged, never cached (each answer is one round trip). Tiny on purpose: the browser calls it every 5 s
// while the Charts tab is visible.
export function onRequestGet({ request }) {
  const colo = String((request && request.cf && request.cf.colo) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  return new Response(JSON.stringify({ t: Date.now(), colo }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
