// TradeZoro — Charts: crypto order-flow venue adapters (ES module, no deps).
// One adapter per exchange, keyed by the chart's symbol prefix (binance, hyperliquid, ...):
//   registerVenue(id, {
//     bookStream(pair, { snapshot(bids, asks), diff(bids, asks), status(st, err) }) -> stop,
//     tradeStream(pair, { trade({ t, p, s, side }), status(st, err) }) -> stop,
//     tick(pair, price) -> footprint row size,
//   })
// bids / asks = [[price, size], ...] (numbers; size 0 in a diff = level gone). side = 'buy' | 'sell'
// (the aggressor). status: 'loading' | 'live' | 'reconnecting' | 'error'. A tradeStream sends its
// short backfill of recent trades first (oldest first), then 'live', then each new trade.
// Binance registers here too (assets/chart-orderflow.js) with its own native book + trade code, so
// its behaviour is unchanged; the other venues go through the generic helpers below.
// Adapters: assets/orderflow-venue-<venue>.js, imported by assets/chart-footprint-crypto.js.
// Education only. Not financial advice.

const venues = new Map();
// Adapters written to the short form (side 1 / -1, tick = the exchange price step) are brought to this
// interface here: side -> 'buy' | 'sell', and the footprint row is never finer than the shared autoTick rule.
export function registerVenue(id, v) {
  const k = String(id).toLowerCase();
  if (k === 'binance' || k === 'hyperliquid') { venues.set(k, v); return; }
  venues.set(k, Object.assign({}, v, {
    tradeStream: (pair, cb) => v.tradeStream(pair, Object.assign({}, cb, {
      trade: (x) => cb.trade(typeof x.side === 'number' ? Object.assign({}, x, { side: x.side < 0 ? 'sell' : 'buy' }) : x),
    })),
    tick: (pair, price) => { const t = v.tick ? Number(v.tick(pair, price)) || 0 : 0; return price > 0 ? Math.max(t, autoTick(price)) : t; },
  }));
}
export function getVenue(id) { return venues.get(String(id || '').toLowerCase()) || null; }
export const venueIds = () => [...venues.keys()];

const BOOK_MAX_LEVELS = 6000;   // per side, like the Binance book (chart-orderflow.js)

// A venue's bookStream -> the book object the DOM heatmap reads ({ bids, asks: Map(price -> size), bestBid, bestAsk, ts }).
export function venueBookSource(v, ticker, onBook, onStatus) {
  const bids = new Map(), asks = new Map();
  let bestBid = null, bestAsk = null, ready = false;
  const best = () => {
    bestBid = null; bestAsk = null;
    bids.forEach((q, p) => { if (q > 0 && (bestBid == null || p > bestBid)) bestBid = p; });
    asks.forEach((q, p) => { if (q > 0 && (bestAsk == null || p < bestAsk)) bestAsk = p; });
  };
  const set = (m, rows) => {
    for (const r of rows || []) {
      const p = Number(r[0]), q = Number(r[1]);
      if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
      if (q > 0) m.set(p, q); else m.delete(p);
    }
  };
  const trim = (m, side) => {
    if (m.size <= BOOK_MAX_LEVELS * 1.2) return;
    [...m.keys()].sort((a, b) => (side === 'b' ? b - a : a - b)).slice(BOOK_MAX_LEVELS).forEach((p) => m.delete(p));
  };
  const emit = () => { trim(bids, 'b'); trim(asks, 'a'); best(); onBook({ bids, asks, bestBid, bestAsk, ts: Date.now() }); };
  return v.bookStream(ticker, {
    snapshot(b, a) { bids.clear(); asks.clear(); set(bids, b); set(asks, a); if (!ready) { ready = true; onStatus('live'); } emit(); },
    diff(b, a) { if (!ready) return; set(bids, b); set(asks, a); emit(); },
    status(st, err) { onStatus(st, err); },
  });
}

// A venue's tradeStream -> the trade-source shape of chart-orderflow.js ((ticker, onTrade(list, backfill), onStatus) -> stop).
export function venueTradeSource(v) {
  return (ticker, onTrade, onStatus) => {
    let live = false, n = 0;
    const buf = [];
    return v.tradeStream(ticker, {
      trade(x) {
        const t = { time: x.t, price: x.p, size: x.s, side: x.side, id: ++n, n: 1 };
        if (live) onTrade([t], false); else buf.push(t);
      },
      status(st, err) {
        if (st === 'live' && !live) { live = true; onTrade(buf.splice(0), true); }
        onStatus(st, err);
      },
    });
  };
}

// The shared footprint row rule (BTC ~ 81k -> $1 rows; zoom merges them).
export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
export const autoTick = (price) => niceStep(price * 1.2e-5);
