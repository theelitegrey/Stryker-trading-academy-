// TradeZoro — Charts: Vest order-flow adapter (ES module) for assets/orderflow-venues.js.
// Public WebSocket wss://ws-beta-prod.hz.vestmarkets.com/ws (the one Vest's own web app uses), no key, read straight
// from the browser. ONE socket per page for every book and trade subscription; it resubscribes after a reconnect.
//   - trades: "<SYMBOL>@trades". qty is signed: + = the taker bought, - = the taker sold (that is the aggressor).
//     A short backfill (the newest 1000 trades, REST /trades via our /api/vest pass-through) comes first, oldest first.
//   - book: "<SYMBOL>@depth_<tick>" sends the WHOLE top 20 levels a side on each change (no diffs to lose).
//     20 levels at the finest step cover almost nothing, so three of the market's own price steps are subscribed
//     (finest, middle, coarsest) and merged, finest wins near the price (same merge as the Hyperliquid adapter).
// Education only. Not financial advice.
import { registerVenue } from './orderflow-venues.js?v=976';
import { mergeBooks } from './orderflow-venue-hyperliquid.js?v=976';
import { WS_URL, parseWsTrades, parseTrades, parseDepth, pickTicks, getJson, loadSymbols, symbolFor } from './vest-core.js?v=976';

// --- the shared socket: channel -> Set of { fn, status }
const subs = new Map();
let ws = null, open = false, retry = 0, tm = 0, ping = 0;
const send = (m) => { try { if (ws && open) ws.send(JSON.stringify(m)); } catch (e) {} };
let nid = 0;
const each = (fn) => subs.forEach((set) => set.forEach(fn));
function connect() {
  if (ws || !subs.size || typeof WebSocket !== 'function') return;
  const sock = new WebSocket(WS_URL);
  ws = sock;
  sock.onopen = () => {
    open = true; retry = 0;
    subs.forEach((set, ch) => send({ method: 'SUBSCRIBE', params: [ch], id: ++nid }));
    ping = setInterval(() => send({ method: 'PING', params: [], id: 0 }), 15000);   // an idle socket is dropped by the server
    each((l) => l.status('open'));
  };
  sock.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch (x) { return; }
    const set = m && m.channel && subs.get(m.channel);
    if (set) set.forEach((l) => l.fn(m));
  };
  sock.onclose = () => {
    clearInterval(ping);
    if (ws !== sock) return;
    ws = null; open = false;
    if (!subs.size) return;
    each((l) => l.status('reconnecting'));
    tm = setTimeout(connect, Math.min(15000, 1000 * Math.pow(2, retry++)));
  };
  sock.onerror = () => { try { sock.close(); } catch (e) {} };
}
function listen(ch, l) {
  let set = subs.get(ch);
  if (!set) { subs.set(ch, set = new Set()); send({ method: 'SUBSCRIBE', params: [ch], id: ++nid }); }
  set.add(l);
  connect();
  if (open) l.status('open');
  return () => {
    set.delete(l);
    if (!set.size) { subs.delete(ch); send({ method: 'UNSUBSCRIBE', params: [ch], id: ++nid }); }
    if (!subs.size) { clearTimeout(tm); clearInterval(ping); const s = ws; ws = null; open = false; try { s && s.close(); } catch (e) {} }
  };
}

const ticksOf = (list, sym) => ((list.find((s) => s.ticker === sym) || {}).ticks) || [];

const adapter = {
  bookStream(pair, cb) {
    let stopped = false, offs = [];
    loadSymbols().then((list) => {
      if (stopped) return;
      const sym = symbolFor(list, pair);
      if (!sym) { cb.status && cb.status('unlisted', 'Not listed on Vest'); return; }
      const steps = pickTicks(ticksOf(list, sym));
      const layers = steps.map(() => null);
      cb.status && cb.status('loading');
      (steps.length ? steps : ['']).forEach((step, i) => {
        offs.push(listen(sym + '@depth' + (step ? '_' + step : ''), {
          fn: (m) => { layers[i] = parseDepth(m); const have = layers.filter(Boolean); if (!have.length) return; const b = mergeBooks(have); cb.snapshot(b.bids, b.asks); cb.status && cb.status('live'); },
          status: (st) => { if (st === 'reconnecting') cb.status && cb.status('reconnecting'); },
        }));
      });
    }).catch(() => { if (!stopped) cb.status && cb.status('error', 'Vest data is temporarily unavailable. Retrying…'); });
    return () => { stopped = true; offs.forEach((f) => f()); offs = []; };
  },
  tradeStream(pair, cb) {
    let stopped = false, off = null, done = false;
    const seen = new Set(), buf = [];
    const emit = (x) => { if (seen.has(x.id)) return; seen.add(x.id); cb.trade({ t: x.t, p: x.p, s: x.s, side: x.side }); };
    loadSymbols().then((list) => {
      if (stopped) return;
      const sym = symbolFor(list, pair);
      if (!sym) { cb.status && cb.status('unlisted', 'Not listed on Vest'); return; }
      cb.status && cb.status('loading');
      off = listen(sym + '@trades', {
        fn: (m) => { const l = parseWsTrades(m); if (done) l.forEach(emit); else buf.push(...l); },
        status: (st) => { if (st === 'reconnecting' && done) cb.status && cb.status('reconnecting'); },
      });
      getJson('trades?symbol=' + encodeURIComponent(sym) + '&limit=1000').then(parseTrades).catch(() => []).then((hist) => {
        if (stopped) return;
        hist.forEach(emit); buf.splice(0).forEach(emit); done = true;
        cb.status && cb.status('live');
      });
    }).catch(() => { if (!stopped) cb.status && cb.status('error', 'Vest data is temporarily unavailable. Retrying…'); });
    return () => { stopped = true; if (off) off(); };
  },
  // the market's own finest price step; registerVenue never lets a footprint row be finer than the shared rule
  tick(pair) {
    if (!loaded) return 0;
    const s = loaded.find((x) => x.ticker === symbolFor(loaded, pair));
    return s ? s.mintick : 0;
  },
};
let loaded = null;
loadSymbols().then((l) => { loaded = l; }).catch(() => {});
registerVenue('vest', adapter);

// Book · DOM · Trades panel source (assets/book-panel-sources.js): same streams, panel shapes.
export function openPanelSource(pair, cb) {
  const v = { book: { bids: new Map(), asks: new Map() } };
  const stopBook = adapter.bookStream(pair, {
    snapshot(b, a) { v.book.bids.clear(); v.book.asks.clear(); b.forEach((r) => v.book.bids.set(r[0], r[1])); a.forEach((r) => v.book.asks.set(r[0], r[1])); cb.book(v.book); },
    status: (st, note) => cb.status(st, note),
  });
  let backfilled = false;
  const stopTrades = adapter.tradeStream(pair, {
    trade: (x) => cb.trades([{ t: x.t, p: x.p, s: x.s, side: x.side, ex: 'vest' }], !backfilled),
    status: (st) => { if (st === 'live') backfilled = true; },
  });
  return () => { stopBook(); stopTrades(); };
}
