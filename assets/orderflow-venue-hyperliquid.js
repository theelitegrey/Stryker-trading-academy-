// TradeZoro — Charts: Hyperliquid order-flow adapter (ES module) for assets/orderflow-venues.js.
// Public WebSocket wss://api.hyperliquid.xyz/ws, no key. ONE socket per page for every book and
// trade subscription here; it resubscribes after a reconnect (backoff 1 s -> 15 s).
//   - trades: { type: 'trades', coin }. The first message is the venue's recent trades (about 30),
//     then each new trade. side 'B' = the taker bought, 'A' = the taker sold. Hyperliquid has no
//     public trade history, so footprint / delta start from when the chart opened (plus that batch).
//   - book: { type: 'l2Book', coin } sends the WHOLE top 20 levels a side on each change. Twenty
//     levels at full precision is only ~$20 on BTC, so three precisions are subscribed (full,
//     nSigFigs 4 and 3: ~$1 / $10 / $100 rows on BTC) and merged, finest wins near the price:
//     every message is a full snapshot (no diffs to lose), so a reconnect cannot leave a stale book.
// Education only. Not financial advice.
import { registerVenue, autoTick } from './orderflow-venues.js?v=922';

const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const SIGS = [0, 4, 3];   // 0 = full precision

// --- pure parsers (tests/fixtures/hyperliquid-*.json, tools/tests/orderflow-venue-hyperliquid.test.mjs)
export function parseTrades(data) {
  const out = [];
  for (const x of Array.isArray(data) ? data : []) {
    const p = Number(x.px), s = Number(x.sz), t = Number(x.time);
    if (!(p > 0) || !(s > 0) || !Number.isFinite(t)) continue;
    out.push({ t, p, s, side: x.side === 'B' ? 'buy' : 'sell' });
  }
  return out;
}
const rows = (lv) => (Array.isArray(lv) ? lv : []).map((l) => [Number(l.px), Number(l.sz)]).filter((r) => r[0] > 0 && r[1] >= 0);
export function parseBook(data) {
  const lv = (data && data.levels) || [];
  return { bids: rows(lv[0]), asks: rows(lv[1]), ts: Number(data && data.time) || 0 };
}
// layers[k] = parseBook() of precision SIGS[k] (finest first). A coarser layer only adds rows that
// lie wholly beyond the span the finer layers cover (the straddling row is dropped), so no size is
// counted twice.
const spacing = (r) => (r.length > 1 ? Math.abs(r[0][0] - r[1][0]) : 0);
export function mergeBooks(layers) {
  const bids = [], asks = [];
  let bLo = Infinity, aHi = -Infinity;
  for (const L of layers) {
    if (!L) continue;
    const sb = bLo === Infinity ? 0 : spacing(L.bids), sa = aHi === -Infinity ? 0 : spacing(L.asks);
    let lo = bLo, hi = aHi;
    for (const r of L.bids) if (r[0] + sb < bLo || (sb === 0 && bLo === Infinity)) { bids.push(r); lo = Math.min(lo, r[0]); }
    for (const r of L.asks) if (r[0] - sa > aHi || (sa === 0 && aHi === -Infinity)) { asks.push(r); hi = Math.max(hi, r[0]); }
    bLo = lo; aHi = hi;
  }
  return { bids, asks };
}

// --- the shared socket: subs key -> { sub, ls: Set of { fn, status, match } } (several tools can watch one coin)
const subs = new Map();
let ws = null, open = false, retry = 0, tm = 0;
const keyOf = (s) => JSON.stringify(s);
function send(m) { try { if (ws && open) ws.send(JSON.stringify(m)); } catch (e) {} }
const each = (fn) => subs.forEach((v) => v.ls.forEach((l) => fn(v, l)));
function connect() {
  if (ws || !subs.size || typeof WebSocket !== 'function') return;
  const sock = new WebSocket(WS_URL);
  ws = sock;
  sock.onopen = () => {
    open = true; retry = 0;
    subs.forEach((v) => send({ method: 'subscribe', subscription: v.sub }));
    each((v, l) => l.status('open'));
  };
  sock.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch (x) { return; }
    if (!m || !m.data) return;
    if (m.channel === 'trades' && Array.isArray(m.data) && m.data[0]) {
      const v = subs.get(keyOf({ type: 'trades', coin: m.data[0].coin }));
      if (v) v.ls.forEach((l) => l.fn(m.data));
    } else if (m.channel === 'l2Book') {
      each((v, l) => { if (v.sub.type === 'l2Book' && v.sub.coin === m.data.coin && l.match(m.data)) l.fn(m.data); });
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null; open = false;
    if (!subs.size) return;
    each((v, l) => l.status('reconnecting'));
    tm = setTimeout(connect, Math.min(15000, 1000 * Math.pow(2, retry++)));
  };
  sock.onerror = () => { try { sock.close(); } catch (x) {} };
}
function subscribe(sub, fn, status, match) {
  const k = keyOf(sub), l = { fn, status, match: match || (() => true) };
  let v = subs.get(k);
  if (!v) { v = { sub, ls: new Set() }; subs.set(k, v); if (ws && open) send({ method: 'subscribe', subscription: sub }); }
  v.ls.add(l);
  if (ws && open) status('open'); else connect();
  return () => {
    v.ls.delete(l);
    if (v.ls.size || subs.get(k) !== v) return;
    subs.delete(k);
    send({ method: 'unsubscribe', subscription: sub });
    if (!subs.size) { clearTimeout(tm); const s = ws; ws = null; open = false; try { if (s) s.close(); } catch (e) {} }
  };
}
// same coin rule as Vela's HyperliquidProvider parseCoin (providers/hyperliquid.js)
const coinOf = (pair) => { const t = String(pair || '').trim(); return t.includes('/') ? t : t.toUpperCase(); };

registerVenue('hyperliquid', {
  tradeStream(pair, cb) {
    const coin = coinOf(pair);
    let first = true;
    const seen = new Set();   // tids: a resubscribe re-sends the recent-trades batch
    cb.status('loading');
    return subscribe({ type: 'trades', coin }, (data) => {
      const fresh = data.filter((x) => !seen.has(x.tid + '|' + x.time));
      fresh.forEach((x) => seen.add(x.tid + '|' + x.time));
      if (seen.size > 5000) { const keep = [...seen].slice(-2000); seen.clear(); keep.forEach((k) => seen.add(k)); }
      const list = parseTrades(fresh).sort((a, b) => a.t - b.t);
      list.forEach((t) => cb.trade(t));
      if (first) { first = false; cb.status('live'); }
    }, (st) => { if (st === 'reconnecting') cb.status('reconnecting'); else if (!first) cb.status('live'); });
  },
  bookStream(pair, cb) {
    const coin = coinOf(pair);
    const layers = SIGS.map(() => null);
    cb.status('loading');
    const stops = SIGS.map((n, k) => {
      const sub = n ? { type: 'l2Book', coin, nSigFigs: n } : { type: 'l2Book', coin, fast: true };   // fast: the near-price layer updates ~2x a second (default ~0.2/s)
      // the server echoes the subscription only in subscriptionResponse: tell the layers apart by their row spacing
      return subscribe(sub, (data) => {
        const b = parseBook(data);
        layers[k] = b;
        const m = mergeBooks(layers);
        if (m.bids.length || m.asks.length) cb.snapshot(m.bids, m.asks);
      }, (st) => { if (st === 'reconnecting') cb.status('reconnecting'); }, (data) => sigOf(data) === n);
    });
    return () => stops.forEach((s) => s());
  },
  tick(pair, price) { return autoTick(price); },
});

// Which precision a book message was sent at (Hyperliquid does not say): 0 = full, else nSigFigs.
// nSigFigs n: every price has at most n significant digits; full precision books have more (BTC 75623).
export function sigOf(data) {
  const lv = (data && data.levels) || [];
  const px = [].concat(lv[0] || [], lv[1] || []).map((l) => String(l.px).replace('.', '').replace(/^0+/, '').replace(/0+$/, ''));
  const most = px.reduce((a, s) => Math.max(a, s.length), 0);
  return most <= 3 ? 3 : most <= 4 ? 4 : 0;
}
