// Offline stand-in for Binance's public REST + WebSocket (klines, order book, aggTrades, exchangeInfo), so browser suites
// that chart BTCUSDT run in CI (GitHub's US runners get HTTP 451 from Binance) and on the server with no network.
// Deterministic fixture: one BTC price curve, a 5,000-level book around it, a book diff every 100 ms, a trade every 150 ms.
// Use:  const bm = require('./binance-mock.js'); await bm.install(ctx);   bm.snapshot() = the /depth JSON (for node-side code).
const MID0 = 77000, TICK = 0.01;
const mid = (t) => MID0 + 400 * Math.sin(t / 5400000) + 60 * Math.sin(t / 240000);
const rnd = (i) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
const f2 = (x) => (Math.round(x / TICK) * TICK).toFixed(2);
function kline(m, now) {   // minute m (ms): [openTime, o, h, l, c, vol, closeTime, ...]
  const o = mid(m), c = mid(Math.min(m + 60000, now)), h = Math.max(o, c) + 8 + 20 * rnd(m), l = Math.min(o, c) - 8 - 20 * rnd(m + 1);
  return [m, f2(o), f2(h), f2(l), f2(c), (5 + 30 * rnd(m + 2)).toFixed(3), m + 59999, '0', 100, '0', '0', '0'];
}
function snapshot(now = Date.now()) {
  const m = mid(now), bids = [], asks = [];
  for (let i = 0; i < 5000; i++) {   // spacing grows with depth: ~+-1.3% over 5,000 levels, like the real spot book
    const off = TICK * Math.pow(i + 1, 1.35), q = (0.05 + 3 * rnd(i) * rnd(i + 7) + (i % 97 === 0 ? 12 : 0)) * (1 + i / 800);
    bids.push([f2(m - off), q.toFixed(5)]); asks.push([f2(m + off), (q * (0.8 + 0.4 * rnd(i + 3))).toFixed(5)]);
  }
  return { lastUpdateId: now, bids, asks };
}
async function install(ctx) {
  await ctx.route(/^https?:\/\/(api\.binance\.com|data-api\.binance\.vision|fapi\.binance\.com)\//, (r) => {
    const u = new URL(r.request().url()), now = Date.now(), cors = { 'access-control-allow-origin': '*' };
    const ok = (body) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (/\/klines$/.test(u.pathname)) {
      const iv = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 }[u.searchParams.get('interval')] || 1;
      const lim = Math.min(Number(u.searchParams.get('limit')) || 500, 1500), end = Math.min(Number(u.searchParams.get('endTime')) || now, now);
      const out = [];
      for (let m = Math.floor(end / 60000) * 60000; out.length < lim; m -= 60000) { out.push(kline(m, now)); if (m < now - 40 * 86400000) break; }
      out.reverse();
      return ok(iv === 1 ? out : out.filter((_, i) => i % iv === 0));
    }
    if (/\/depth$/.test(u.pathname)) return ok(snapshot(now));
    if (/\/aggTrades$/.test(u.pathname)) return ok(Array.from({ length: 200 }, (_, i) => ({ a: now - i, p: f2(mid(now)), q: '0.01', f: now - i, l: now - i, T: now - (200 - i) * 150, m: i % 2 === 0 })).reverse());
    if (/\/exchangeInfo$/.test(u.pathname)) return ok({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01000000' }] }] });
    return ok({});
  });
  await ctx.routeWebSocket(/binance\.(com|vision|us)/, (ws) => {
    const url = ws.url(); let n = 0, tid = 0;
    const iv = setInterval(() => {
      n++; const now = Date.now(), m = Math.floor(now / 60000) * 60000, px = mid(now);
      try {
        if (/@kline_/.test(url)) { if (n % 5 === 0) { const k = kline(m, now); ws.send(JSON.stringify({ e: 'kline', E: now, s: 'BTCUSDT', k: { t: m, T: m + 59999, s: 'BTCUSDT', i: (/@kline_(\w+)/.exec(url) || [])[1], o: k[1], c: f2(px), h: k[2], l: k[3], v: k[5], x: false } })); } }
        else if (/@depth/.test(url)) ws.send(JSON.stringify({ e: 'depthUpdate', E: now, s: 'BTCUSDT', b: [[f2(px - 0.5 - (n % 40) * 0.1), (0.2 + rnd(n)).toFixed(5)]], a: [[f2(px + 0.5 + (n % 40) * 0.1), (0.2 + rnd(n + 1)).toFixed(5)]] }));
        else if (/@aggTrade/.test(url) && n % 2 === 0) ws.send(JSON.stringify({ e: 'aggTrade', E: now, s: 'BTCUSDT', a: ++tid, p: f2(px), q: (0.001 + rnd(n) * 0.2).toFixed(5), f: tid, l: tid, T: now, m: n % 4 === 0 }));
      } catch (e) { clearInterval(iv); }
    }, 100);
    ws.onClose(() => clearInterval(iv));
  });
}
module.exports = { install, snapshot, mid };
