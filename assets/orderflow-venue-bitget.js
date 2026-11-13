// TradeZoro — order-flow venue adapter: Bitget (spot + USDT perpetuals). Public v2 WebSocket, no key.
// pair = chart ticker ("BTCUSDT", "BTCUSDT.P") or { base, quote, perp }. Education only. Not financial advice.
import { registerVenue } from './orderflow-venues.js?v=966';

const WS = 'wss://ws.bitget.com/v2/ws/public';
const rows = (a) => (a || []).map((r) => [+r[0], +r[1]]).filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]));
export function pairInfo(pair) {
  if (pair && typeof pair === 'object') return { sym: pair.base + (pair.quote === 'USD' ? 'USDT' : pair.quote), perp: !!pair.perp };
  const t = String(pair || '').toUpperCase().replace(/^[A-Z_]+:/, '');
  return { sym: t.replace(/\.P$/, ''), perp: /\.P$/.test(t) };
}
// one books message -> { snapshot: bool, bids, asks } | null
export function parseBooks(msg) {
  if (!msg || !msg.arg || msg.arg.channel !== 'books' || !Array.isArray(msg.data) || !msg.data[0]) return null;
  return { snapshot: msg.action === 'snapshot', bids: rows(msg.data[0].bids), asks: rows(msg.data[0].asks) };
}
// one trade message -> [{ t, p, s, side }]; Bitget's side is the taker's (the aggressor)
export function parseTrades(msg) {
  if (!msg || !msg.arg || msg.arg.channel !== 'trade' || !Array.isArray(msg.data)) return [];
  return msg.data.map((x) => ({ t: +x.ts, p: +x.price, s: +x.size, side: x.side === 'sell' ? -1 : 1 }));
}
function open(channel, pair, onMsg, status) {
  const { sym, perp } = pairInfo(pair), inst = perp ? 'USDT-FUTURES' : 'SPOT';
  let ws = null, stopped = false, retry = 0, tm = 0, ping = 0;
  const go = () => {
    if (stopped) return;
    status && status('loading');
    ws = new WebSocket(WS);
    const me = ws;
    me.onopen = () => { retry = 0; me.send(JSON.stringify({ op: 'subscribe', args: [{ instType: inst, channel, instId: sym }] })); ping = setInterval(() => { try { me.send('ping'); } catch (e) {} }, 25000); };
    me.onmessage = (e) => { if (e.data === 'pong') return; let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.event === 'error') { status && status('unlisted', 'Not listed on Bitget'); return; } onMsg(m); };
    me.onclose = () => { clearInterval(ping); if (stopped || ws !== me) return; status && status('reconnecting'); tm = setTimeout(go, Math.min(15000, 1000 * Math.pow(2, retry++))); };
    me.onerror = () => { try { me.close(); } catch (e) {} };
  };
  go();
  return () => { stopped = true; clearTimeout(tm); clearInterval(ping); try { ws && ws.close(); } catch (e) {} };
}
const ticks = new Map();   // "perp|SYM" -> tick (filled from the instrument lists)
let listing = null;
function loadTicks() {
  if (listing) return listing;
  const get = (u) => fetch(u).then((r) => r.json()).then((j) => j.data || []).catch(() => []);
  listing = Promise.all([get('https://api.bitget.com/api/v2/spot/public/symbols'), get('https://api.bitget.com/api/v2/mix/market/contracts?productType=USDT-FUTURES')]).then(([s, f]) => {
    s.forEach((x) => ticks.set('0|' + x.symbol, Math.pow(10, -Number(x.pricePrecision || 2))));
    f.forEach((x) => ticks.set('1|' + x.symbol, Number(x.priceEndStep || 1) * Math.pow(10, -Number(x.pricePlace || 1))));
  });
  return listing;
}

registerVenue('bitget', {
  bookStream(pair, cb) {
    return open('books', pair, (m) => { const b = parseBooks(m); if (!b) return; if (b.snapshot) cb.snapshot(b.bids, b.asks); else cb.diff(b.bids, b.asks); cb.status && cb.status('live'); }, cb.status);
  },
  tradeStream(pair, cb) {
    return open('trade', pair, (m) => { const l = parseTrades(m); l.forEach((x) => cb.trade(x)); if (l.length) cb.status && cb.status('live'); }, cb.status);
  },
  tick(pair) { const { sym, perp } = pairInfo(pair); loadTicks(); return ticks.get((perp ? '1|' : '0|') + sym) || 0; }
});
