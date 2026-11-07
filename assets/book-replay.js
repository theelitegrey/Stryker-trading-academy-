// TradeZoro — order book replay: pure helpers (no DOM, no sockets), unit-tested in tools/tests/book-replay.test.mjs.
// While Charts bar replay is on (window.__stkReplay, assets/chart-bar-replay.js) the book panel, the DOM ladder and the
// heatmaps show the RECORDED book at the replay clock instead of the current one. Recorded samples come from the
// book recorder (Worker book-recorder: /book-history for Binance spot, /ts-book-history for futures L2), in the BKR1
// shape decoded by chart-orderflow.js decodeBookHistory: { ts, mid, bb, ba, step, i0, v } (v: + bids / - asks per row).
// Education only. Not financial advice.

// The replay clock (ms) while a replay is on, else 0: Charts bar replay (window.__stkReplay), or a Replay One session
// (replay.html, window.__stkBt.clock() from bt-vela-chart.js: the close of the bar at the session cursor).
export function replayClock() {
  try {
    if (typeof window === 'undefined') return 0;
    const r = window.__stkReplay; if (r && r.on) return r.now();
    const b = window.__stkBt; return b && b.clock ? b.clock() || 0 : 0;
  } catch (e) { return 0; }
}

// Replay One charts one session as provider 'bt' (symbol bt:SESSION). For the book tools that session is the real market it
// was built from (window.__stkBt.spec, the replay-data.js market), so they read that market's recorded book. Same shape as
// chart-orderflow.js marketOf. Any other market passes through unchanged.
export function btBook(mk) {
  if (!mk || mk.provider !== 'bt') return mk;
  try {
    const m = specMarket(window.__stkBt && window.__stkBt.spec);
    if (!m) return mk;
    return Object.assign({}, mk, { provider: m.provider, ticker: m.ticker, root: m.ticker, futures: m.provider === 'futures' });
  } catch (e) { return mk; }
}
// Replay One market spec (replay-data.js SYMBOLS: { id: 'NQ=F' | 'BTCUSDT', src }) -> the chart market the recorders know.
export function specMarket(sp) {
  if (!sp || !sp.id) return null;
  if (sp.src === 'binance') return { provider: 'binance', ticker: String(sp.id).toUpperCase() };
  const m = /^([A-Z0-9]+)=F$/.exec(String(sp.id).toUpperCase());
  return m ? { provider: 'futures', ticker: m[1] } : null;
}

// Newest sample at or before t (list sorted by ts). null when there is none, or when the newest one is older than
// maxAgeMs (a gap: market closed, recorder down) — a stale book is never shown as the book at t.
export function sampleAt(list, t, maxAgeMs) {
  if (!list || !list.length || !(t > 0)) return null;
  let lo = 0, hi = list.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].ts <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0) return null;
  const s = list[k];
  return maxAgeMs > 0 && t - s.ts > maxAgeMs ? null : s;
}

// One recorded sample -> a book { bids: Map(price -> size), asks, bestBid, bestAsk, ts }. A row's size sits at the row
// centre; the rows holding the best bid / ask are keyed at those exact prices (the touch stays exact).
export function sampleBook(s) {
  const b = { bids: new Map(), asks: new Map(), bestBid: null, bestAsk: null, ts: 0 };
  if (!s || !(s.step > 0) || !s.v) return b;
  b.bestBid = s.bb || null; b.bestAsk = s.ba || null; b.ts = s.ts;
  const ib = s.bb > 0 ? Math.floor(s.bb / s.step + 1e-9) : NaN, ia = s.ba > 0 ? Math.floor(s.ba / s.step + 1e-9) : NaN;
  for (let k = 0; k < s.v.length; k++) {
    const x = s.v[k], i = s.i0 + k;
    if (!x) continue;
    const p = Math.round((i + 0.5) * s.step * 1e8) / 1e8;
    if (x > 0) b.bids.set(i === ib ? s.bb : p, x); else b.asks.set(i === ia ? s.ba : p, -x);
  }
  if (b.bestBid == null) b.bids.forEach((q, p) => { if (b.bestBid == null || p > b.bestBid) b.bestBid = p; });
  if (b.bestAsk == null) b.asks.forEach((q, p) => { if (b.bestAsk == null || p < b.bestAsk) b.bestAsk = p; });
  return b;
}

// LAZY CHUNKS: history is read in fixed, aligned windows of `size` ms (cache-friendly: every viewer asks the same
// windows), only the ones that overlap [from, to], newest first, one at a time. `done` = Set of chunk starts already
// read. Returns the start of the next chunk to read, or null when [from, to] is covered.
export function nextChunk(done, from, to, size) {
  if (!(to > from) || !(size > 0)) return null;
  for (let c = Math.floor((to - 1) / size) * size; c + size > from; c -= size) if (!done.has(c)) return c;
  return null;
}

// What the book tools say during a replay when there is no book to draw (null = draw it). f = chart-orderflow.js BookFeed.
export const RECORDED_DAYS = 30;
export function replayGap(f, E, now) {
  if (!f.custom && (f.provider !== 'binance' || /\.P$/i.test(f.ticker))) return 'No recorded order book for this market in replay.';
  if (E < now - RECORDED_DAYS * 86400000 + 60000) return 'The order book is recorded for the last ' + RECORDED_DAYS + ' days only.';
  if (f.remoteState === 'failed' && f.remote.length < 2) return 'Recorded order book unavailable.';
  if (!f.rpCovered) return 'Loading the recorded order book…';
  return null;
}
