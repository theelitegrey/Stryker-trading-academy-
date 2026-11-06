// Offline stand-in for Bybit v5 public REST + WebSocket (api.bybit.com is geo-blocked on CI / this server).
const MID0 = 68000;
const mid = (t) => MID0 + 300 * Math.sin(t / 5400000) + 40 * Math.sin(t / 240000);
const f = (x) => (Math.round(x * 10) / 10).toFixed(1);
const row = (m) => [String(m), f(mid(m)), f(Math.max(mid(m), mid(m + 6e4)) + 10), f(Math.min(mid(m), mid(m + 6e4)) - 10), f(mid(m + 6e4)), '12.5', '850000'];
async function install(ctx) {
  await ctx.route(/^https:\/\/api\.bybit\.com\//, (r) => {
    const u = new URL(r.request().url()), cors = { 'access-control-allow-origin': '*' }, ok = (result) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ retCode: 0, retMsg: 'OK', result }) });
    if (/\/kline$/.test(u.pathname)) {
      const iv = { 1: 1, 3: 3, 5: 5, 15: 15, 30: 30, 60: 60, 240: 240, D: 1440 }[u.searchParams.get('interval')] || 1, ms = iv * 6e4;
      const lim = Math.min(+u.searchParams.get('limit') || 200, 1000), end = Math.min(+u.searchParams.get('end') || Date.now(), Date.now());
      const list = []; for (let m = Math.floor(end / ms) * ms; list.length < lim; m -= ms) list.push(row(m));
      return ok({ category: u.searchParams.get('category'), symbol: u.searchParams.get('symbol'), list });
    }
    if (/instruments-info$/.test(u.pathname)) {
      const sym = u.searchParams.get('symbol');
      const all = [['BTC', 'USDT'], ['ETH', 'USDT'], ['SOL', 'USDT']].map(([b, q]) => ({ symbol: b + q, contractType: 'LinearPerpetual', status: 'Trading', baseCoin: b, quoteCoin: q, priceFilter: { tickSize: '0.10' } }));
      return ok({ category: u.searchParams.get('category'), list: sym ? all.filter((x) => x.symbol === sym) : all, nextPageCursor: '' });
    }
    return ok({});
  });
  await ctx.routeWebSocket(/stream\.bybit\.com/, (ws) => {
    const subs = new Set(); let n = 0;
    ws.onMessage((m) => { try { const d = JSON.parse(m); if (d.op === 'subscribe') { d.args.forEach((a) => subs.add(a)); ws.send(JSON.stringify({ success: true, op: 'subscribe' })); } } catch (e) {} });
    const iv = setInterval(() => {
      n++; const now = Date.now(), px = mid(now);
      try {
        for (const t of subs) {
          if (t.startsWith('kline.')) { const i = t.split('.')[1], ms = ({ D: 864e5 }[i] || +i * 6e4), s = Math.floor(now / ms) * ms; ws.send(JSON.stringify({ topic: t, type: 'snapshot', ts: now, data: [{ start: s, end: s + ms - 1, interval: i, open: f(px - 5), close: f(px), high: f(px + 8), low: f(px - 9), volume: '9.5', turnover: '1', confirm: false, timestamp: now }] })); }
          else if (t.startsWith('orderbook.')) { const b = [], a = []; for (let j = 0; j < 30; j++) { b.push([f(px - 0.1 - j * 0.5), String(1 + (j % 5))]); a.push([f(px + 0.1 + j * 0.5), String(1 + (j % 4))]); } ws.send(JSON.stringify({ topic: t, type: n === 1 || n % 50 === 0 ? 'snapshot' : 'delta', ts: now, data: { s: t.split('.')[2], b, a, u: n, seq: n } })); }
          else if (t.startsWith('publicTrade.')) ws.send(JSON.stringify({ topic: t, type: 'snapshot', ts: now, data: [{ T: now, s: t.split('.')[1], S: n % 3 ? 'Buy' : 'Sell', v: '0.05', p: f(px), i: 'x' + n }] }));
        }
      } catch (e) { clearInterval(iv); }
    }, 200);
    ws.onClose(() => clearInterval(iv));
  });
}
module.exports = { install, mid };
