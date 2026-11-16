// TradeZoro — Charts: where a chart's order book (depth) comes from. ES module. Owner order 2026-11-15 ("heatmap should work on any
// charts if it gets data for"). One resolver for the L2 tools: depthSourceFor(market) -> the best source the app has for that symbol,
// or null. No symbol list here: each source says itself whether it carries the symbol.
//   1. member: the member's own connected feed that streams depth (window.__stkBookSources[provider], set by the broker / data
//      connection, e.g. assets/rithmic-ui.js for futures). Signature: (ticker, onEv, onStatus) -> stop; onEv { kind: 'book', bids,
//      asks: [[price, size]], full|clear } or { kind: 'nobook' }. Kept in this browser only. Live.
//   2. hub: the futures L2 hub book (chart-futures-l2.js L2_ROOTS, micros read the mini's book), with its recorded history. Gated by
//      the Pro / live-data rules (l2Badge) at the caller.
//   3. venue: a crypto exchange book (Binance or a registered venue adapter, orderflow-venues.js). Live.
// Where the hub serves the root LIVE for this member, the hub wins (same book plus 48 h of recorded history); a member on the 10-min
// delayed hub book who connected their own depth feed gets their own live feed instead.
// Display only. Education only. Not financial advice.
import { l2Root, l2Source, l2Badge, l2Delayed } from './chart-futures-l2.js?v=1056';
import { getVenue } from './orderflow-venues.js?v=1056';

export const memberSourceFn = (provider) => { const s = typeof window !== 'undefined' && window.__stkBookSources; return (s && provider && typeof s[provider] === 'function') ? s[provider] : null; };

// mk = marketOf(ctx) { provider, ticker, root, futures, tick } -> { kind, provider, ticker, root?, opts? } | null
export function depthSourceFor(mk) {
  if (!mk || !mk.ticker) return null;
  const root = mk.futures ? l2Root(mk.ticker) : null;
  const member = memberSourceFn(mk.provider);
  if (root && (!member || (l2Badge() && !l2Delayed()))) return { kind: 'hub', provider: 'tsl2', ticker: root, root };
  if (member) return { kind: 'member', provider: 'member', ticker: mk.provider + ':' + mk.ticker, fn: member, tick: mk.tick || 0 };
  if (!mk.futures && (mk.provider === 'binance' || getVenue(mk.provider))) return { kind: 'venue', provider: mk.provider, ticker: mk.ticker };
  return null;
}
// "No order book for AAPL yet. …": the plain symbol, without the exchange prefix or the continuous-contract mark
export const noSourceNote = (mk) => 'No order book for ' + (String((mk && mk.ticker) || 'this symbol').replace(/^[A-Z]+:/i, '').replace(/[0-9]?!$/, '') || 'this symbol') + ' yet. Connect a broker that streams depth to see it.';

const nice = (raw) => { if (!(raw > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(raw))); let b = p; for (const m of [1, 2, 2.5, 5, 10]) if (m * p <= raw * 1.0001) b = m * p; return b; };
// BookFeed custom options (chart-orderflow.js BookFeed) for a member source: the book is kept from its events and one whole-book
// column (rows of ~0.01 % of the price, a whole number of ticks, +-2 %) is handed over each second, like the hub's coarse rows.
export function memberOpts(src, bucketBook) {
  const tk = src.tick > 0 ? src.tick : 0;
  const rule = (mid) => { const st = nice(mid * 0.0001); return { step: tk ? Math.max(1, Math.round(st / tk)) * tk : st, range: 0.02 }; };
  return {
    member: true, base: 'size', tick: tk, rule,
    open(onBook, onStatus, onCoarse) {
      const book = { bids: new Map(), asks: new Map(), bestBid: null, bestAsk: null, ts: 0 };
      let live = false;
      const stop = src.fn(src.ticker.replace(/^[a-z0-9_-]+:/i, ''), (ev) => {
        if (!ev) return;
        if (ev.kind === 'nobook') { onStatus('error', 'Your connected account sends no order book for this symbol.'); return; }
        if (ev.kind !== 'book') return;
        if (ev.full || ev.clear) { book.bids.clear(); book.asks.clear(); }
        for (const [p, q] of ev.bids || []) { if (q > 0) book.bids.set(+p, +q); else book.bids.delete(+p); }
        for (const [p, q] of ev.asks || []) { if (q > 0) book.asks.set(+p, +q); else book.asks.delete(+p); }
        let bb = null, ba = null;
        book.bids.forEach((q, p) => { if (bb == null || p > bb) bb = p; });
        book.asks.forEach((q, p) => { if (ba == null || p < ba) ba = p; });
        book.bestBid = bb; book.bestAsk = ba; book.ts = Date.now();
        if (!live && (book.bids.size || book.asks.size)) { live = true; onStatus('live'); }
        onBook(book);
      }, (st, err) => onStatus(st === 'error' ? 'error' : 'loading', err));
      const tm = setInterval(() => {
        if (!live || !(book.bestBid > 0) || !(book.bestAsk > 0)) return;
        const mid = (book.bestBid + book.bestAsk) / 2, r = rule(mid), c = bucketBook(book, r.step, r.range);
        if (c && c.v.length) onCoarse(c);
      }, 1000);
      return () => { clearInterval(tm); try { stop && stop(); } catch (e) {} };
    }
  };
}
// open the BookFeed for a resolved source (H = chart-orderflow helpers: acquireBookFeed, bucketBook, feedTrades)
export function acquireDepth(H, src, fn) {
  if (src.kind === 'hub') return H.acquireBookFeed('tsl2', src.root, fn, l2Source(src.root));
  if (src.kind === 'member') return H.acquireBookFeed('member', src.ticker, fn, memberOpts(src, H.bucketBook));
  const h = H.acquireBookFeed(src.provider, src.ticker, fn);
  h.want({ bucket: 0, range: 0.02 }); H.feedTrades(h.feed);   // starts the trade feed for the bubbles
  return h;
}
