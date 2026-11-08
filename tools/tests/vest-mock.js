// Test stand-in for Vest: /api/vest/* answers with REAL captured responses (tools/tests/fixtures/vest), and the public
// WebSocket replays the real captured order-book messages and trades (the clock of each replayed trade is today's; test only).
const fs = require('fs');
const fx = (n) => JSON.parse(fs.readFileSync(__dirname + '/fixtures/vest/' + n, 'utf8'));
async function install(ctx) {
  const info = fx('exchangeInfo.json'), kBtc = fx('k_btc.json'), kAmd = fx('k_amd.json'), trades = fx('trades_btc.json'), tAmd = fx('trades_amd.json'), depth = fx('ws_depth.json'), dAmd = fx('ws_depth_amd.json');
  const cors = { 'access-control-allow-origin': '*' };
  await ctx.route(/\/api\/vest\//, (r) => {
    const u = new URL(r.request().url()), p = u.pathname.replace('/api/vest/', ''), sym = u.searchParams.get('symbol');
    const body = p === 'exchangeInfo' ? info : p === 'klines' ? (sym === 'AMD-USD-PERP' ? kAmd : kBtc) : p === 'trades' ? (sym === 'AMD-USD-PERP' ? tAmd : trades) : { data: [] };
    r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  });
  await ctx.routeWebSocket(/ws-beta-prod\.hz\.vestmarkets\.com/, (ws) => {
    const subs = new Set(); let n = 0;
    ws.onMessage((m) => { try { const d = JSON.parse(m); if (d.method === 'SUBSCRIBE') { d.params.forEach((c) => subs.add(c)); ws.send(JSON.stringify({ result: null, id: d.id })); } else if (d.method === 'PING') ws.send(JSON.stringify({ data: 'pong' })); } catch (e) {} });
    const iv = setInterval(() => {
      n++;
      try {
        for (const c of subs) {
          const amd = /^AMD/.test(c), T = amd ? tAmd : trades;
          if (/@trades$/.test(c)) { const t = T[n % T.length]; ws.send(JSON.stringify({ channel: c, data: { id: 'w' + n, price: t.price, qty: t.qty, quoteQty: t.quoteQty, time: Date.now() } })); }
          else if (/@depth/.test(c)) { const k = c.replace(/^[^@]*@/, (amd ? 'AMD-USD-PERP' : 'BTC-PERP') + '@'), D = amd ? dAmd : depth; if (D[k]) ws.send(JSON.stringify(Object.assign({}, D[k], { channel: c }))); if (false) ws.send(JSON.stringify(Object.assign({}, depth[k], { channel: c }))); }
        }
      } catch (e) { clearInterval(iv); }
    }, 300);
    ws.onClose(() => clearInterval(iv));
  });
}
module.exports = { install };
