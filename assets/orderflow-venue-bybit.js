// TradeZoro: Bybit v5 order-flow adapter (public streams, no keys). Registers itself as "bybit".
// orderbook.200 (spot 200 levels / linear 200 levels): first message = snapshot, then deltas; size 0 deletes a level.
// publicTrade: S is the taker side ("Buy" = buyer-aggressor).
import { registerVenue } from './orderflow-venues.js?v=972';

const WS = 'wss://stream.bybit.com/v5/public/';
// pair = chart ticker ("BTCUSDT", "BTCUSDT.P") or { base, quote, perp }
const toPair = (p) => { if (p && typeof p === 'object') return p; const t = String(p || '').toUpperCase().replace(/^[A-Z_]+:/, ''); const m = /^(.+?)(USDT|USDC|USD)?(\.P)?$/.exec(t); return { base: m[1], quote: m[2] || '', perp: !!m[3] }; };
const sym = (pair) => pair.base + pair.quote;
const rows = (a) => (a || []).map((r) => [+r[0], +r[1]]).filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]));
export function parseBook(m) { return m && m.data ? { type: m.type, bids: rows(m.data.b), asks: rows(m.data.a) } : null; }
export function parseTrades(m) { return (m && Array.isArray(m.data) ? m.data : []).map((x) => ({ t: +x.T, p: +x.p, s: +x.v, side: x.S === 'Buy' ? 1 : -1 })); }

// One socket per call, reconnects with backoff (a new socket gets a fresh snapshot, so the book resets itself).
function stream(p, topic, on, status) {
  const pair = toPair(p);
  let ws = null, stopped = false, retry = 0, tm = 0, ping = 0;
  const open = () => {
    if (stopped) return;
    status && status('loading');
    try { ws = new WebSocket(WS + (pair.perp ? 'linear' : 'spot')); } catch (e) { status && status('error'); return; }
    const me = ws;
    me.onopen = () => { retry = 0; me.send(JSON.stringify({ op: 'subscribe', args: [topic] })); ping = setInterval(() => { try { me.send('{"op":"ping"}'); } catch (e) {} }, 20000); };
    me.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch (x) { return; } if (d.topic === topic) { on(d); status && status('live'); } };
    me.onclose = () => { clearInterval(ping); if (stopped || ws !== me) return; status && status('reconnecting'); tm = setTimeout(open, Math.min(15000, 1000 * Math.pow(2, retry++))); };
    me.onerror = () => { try { me.close(); } catch (e) {} };
  };
  open();
  return () => { stopped = true; clearTimeout(tm); clearInterval(ping); try { ws && ws.close(); } catch (e) {} };
}

const tickCache = new Map();
registerVenue('bybit', {
  bookStream: (pair, cb) => stream(pair, 'orderbook.200.' + sym(toPair(pair)), (d) => {
    const b = parseBook(d); if (!b) return;
    (b.type === 'snapshot' ? cb.snapshot : cb.diff)(b.bids, b.asks);
  }, cb.status),
  tradeStream: (pair, cb) => stream(pair, 'publicTrade.' + sym(toPair(pair)), (d) => { for (const t of parseTrades(d)) cb.trade(t); }, cb.status),
  // price tick from instruments-info; 0.01 until it is known
  tick: (p) => {
    const pair = toPair(p);
    const k = sym(pair) + (pair.perp ? '.P' : '');
    if (!tickCache.has(k)) {
      tickCache.set(k, 0.01);
      fetch('https://api.bybit.com/v5/market/instruments-info?category=' + (pair.perp ? 'linear' : 'spot') + '&symbol=' + sym(pair))
        .then((r) => r.json()).then((j) => { const t = parseFloat(j.result && j.result.list[0] && j.result.list[0].priceFilter.tickSize); if (t > 0) tickCache.set(k, t); }).catch(() => {});
    }
    return tickCache.get(k);
  }
});
