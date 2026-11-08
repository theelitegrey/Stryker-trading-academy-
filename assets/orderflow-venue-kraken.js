// TradeZoro — order-flow venue adapter: Kraken (spot via WebSocket v2, perpetuals PF_*USD via futures.kraken.com).
// pair = chart ticker ("XBTUSD", "XBTUSD.P", "ETHUSD") or { base, quote, perp }. Education only. Not financial advice.
import { registerVenue } from './orderflow-venues.js?v=924';

const rows = (a) => (a || []).map((r) => [+r.price, +r.qty]).filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]));
const BASE = (b) => (b === 'BTC' ? 'XBT' : b);
export function pairInfo(pair) {
  let base, quote, perp;
  if (pair && typeof pair === 'object') ({ base, quote, perp } = pair);
  else {
    let t = String(pair || '').toUpperCase().replace(/^[A-Z_]+:/, '');
    perp = /\.P$/.test(t); t = t.replace(/\.P$/, '');
    const m = /^(.+?)[-/_]?(USDT|USDC|USD|EUR|GBP|CAD|AUD|CHF|JPY)$/.exec(t) || [t, t, 'USD'];
    base = m[1]; quote = m[2];
  }
  base = base === 'XBT' ? 'BTC' : base;
  return { base, quote: quote || 'USD', perp: !!perp, ws: base + '/' + (quote || 'USD'), fut: 'PF_' + BASE(base) + 'USD' };
}
// WebSocket v2 book message (snapshot or update) -> { snapshot, bids, asks } | null (qty 0 removes a level)
export function parseSpotBook(msg) {
  if (!msg || msg.channel !== 'book' || !Array.isArray(msg.data) || !msg.data[0]) return null;
  return { snapshot: msg.type === 'snapshot', bids: rows(msg.data[0].bids), asks: rows(msg.data[0].asks) };
}
export function parseSpotTrades(msg) {
  if (!msg || msg.channel !== 'trade' || !Array.isArray(msg.data)) return [];
  return msg.data.map((x) => ({ t: Date.parse(x.timestamp), p: +x.price, s: +x.qty, side: x.side === 'sell' ? -1 : 1 }));
}
// futures feeds: book_snapshot (all levels), book (one level), trade_snapshot / trade
export function parseFutBook(msg) {
  if (!msg) return null;
  if (msg.feed === 'book_snapshot') return { snapshot: true, bids: rows(msg.bids), asks: rows(msg.asks) };
  if (msg.feed === 'book') { const r = [[+msg.price, +msg.qty]]; return msg.side === 'buy' ? { snapshot: false, bids: r, asks: [] } : { snapshot: false, bids: [], asks: r }; }
  return null;
}
export function parseFutTrades(msg) {
  if (!msg) return [];
  const one = (x) => ({ t: +x.time, p: +x.price, s: +x.qty, side: x.side === 'sell' ? -1 : 1 });
  if (msg.feed === 'trade_snapshot') return (msg.trades || []).map(one);
  return msg.feed === 'trade' ? [one(msg)] : [];
}
function open(url, subs, onMsg, status) {
  let ws = null, stopped = false, retry = 0, tm = 0, ping = 0;
  const go = () => {
    if (stopped) return;
    status && status('loading');
    ws = new WebSocket(url);
    const me = ws;
    me.onopen = () => { retry = 0; subs.forEach((s) => me.send(JSON.stringify(s))); ping = setInterval(() => { try { me.send(JSON.stringify(url.includes('futures') ? { event: 'ping' } : { method: 'ping' })); } catch (e) {} }, 25000); };
    me.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.error || m.event === 'error') { status && status('unlisted', 'Not listed on Kraken'); return; } onMsg(m); };
    me.onclose = () => { clearInterval(ping); if (stopped || ws !== me) return; status && status('reconnecting'); tm = setTimeout(go, Math.min(15000, 1000 * Math.pow(2, retry++))); };
    me.onerror = () => { try { me.close(); } catch (e) {} };
  };
  go();
  return () => { stopped = true; clearTimeout(tm); clearInterval(ping); try { ws && ws.close(); } catch (e) {} };
}
const ticks = new Map();
let listing = null;
function loadTicks() {
  if (listing) return listing;
  listing = fetch('https://api.kraken.com/0/public/AssetPairs').then((r) => r.json()).then((j) => { Object.values(j.result || {}).forEach((p) => { if (p.wsname) ticks.set(p.wsname.replace(/^XBT\//, 'BTC/'), Number(p.tick_size) || Math.pow(10, -(p.pair_decimals ?? 2))); }); }).catch(() => {});
  return listing;
}

registerVenue('kraken', {
  bookStream(pair, cb) {
    const p = pairInfo(pair), fire = (b) => { if (!b) return; if (b.snapshot) cb.snapshot(b.bids, b.asks); else cb.diff(b.bids, b.asks); cb.status && cb.status('live'); };
    return p.perp
      ? open('wss://futures.kraken.com/ws/v1', [{ event: 'subscribe', feed: 'book', product_ids: [p.fut] }], (m) => { if (!m.product_id || m.product_id === p.fut) fire(parseFutBook(m)); }, cb.status)
      : open('wss://ws.kraken.com/v2', [{ method: 'subscribe', params: { channel: 'book', symbol: [p.ws], depth: 500 } }], (m) => fire(parseSpotBook(m)), cb.status);
  },
  tradeStream(pair, cb) {
    const p = pairInfo(pair), fire = (l) => { l.forEach((x) => cb.trade(x)); if (l.length) cb.status && cb.status('live'); };
    return p.perp
      ? open('wss://futures.kraken.com/ws/v1', [{ event: 'subscribe', feed: 'trade', product_ids: [p.fut] }], (m) => { if (!m.product_id || m.product_id === p.fut) fire(parseFutTrades(m)); }, cb.status)
      : open('wss://ws.kraken.com/v2', [{ method: 'subscribe', params: { channel: 'trade', symbol: [p.ws] } }], (m) => fire(parseSpotTrades(m)), cb.status);
  },
  tick(pair) { const p = pairInfo(pair); loadTicks(); return p.perp ? 0 : ticks.get(p.ws) || 0; }   // perp: 0 = caller picks a step (futures.kraken.com REST has no CORS)
});
