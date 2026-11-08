// TradeZoro — Book · DOM · Trades panel: crypto exchange streams, straight from the browser (public endpoints, no keys).
// Each source: openSource(id, pair, { book(book), trades(list), status(state, note) }) -> stop().
//   book  = { bids: Map(price -> size), asks: Map(price -> size) }  (live object, read it, don't keep it)
//   trade = { t, p, s, side: 1 buyer-aggressor | -1 seller-aggressor, ex }
//   status: 'loading' | 'live' | 'reconnecting' | 'unlisted' | 'error'
// Wording: no "real-time" claims; the panel shows "updated Xs ago" only. Education only. Not financial advice.
import { OkxBook, OKX_WS_PUBLIC, numRows, tradeOf, fetchInst } from './okx-core.js?v=913';
export const SOURCES = [
  { id: 'binance', name: 'Binance', perp: true },
  { id: 'binanceus', name: 'Binance US', perp: false },
  { id: 'coinbase', name: 'Coinbase', perp: false },
  { id: 'hyperliquid', name: 'Hyperliquid', perp: true },
  { id: 'bybit', name: 'Bybit', perp: true },
  { id: 'okx', name: 'OKX', perp: true },
  { id: 'bitget', name: 'Bitget', perp: true },
  { id: 'kraken', name: 'Kraken', perp: true }
];
export const sourceName = (id) => (SOURCES.find((s) => s.id === id) || { name: id }).name;
const MAX_LEVELS = 1500;

function trim(m, isBid) {
  if (m.size <= MAX_LEVELS * 2) return;
  const keep = [...m.keys()].sort((a, b) => (isBid ? b - a : a - b)).slice(MAX_LEVELS);
  keep.forEach((p) => m.delete(p));
}
function applyRows(m, rows, isBid) {
  for (const r of rows || []) {
    const p = +r[0], q = +r[1];
    if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
    if (q <= 0) m.delete(p); else m.set(p, q);
  }
  trim(m, isBid);
}

// small reconnecting socket: backoff, 25 s silence watchdog, no reconnect while stopped; a hidden tab is left alone (the browser throttles it)
function socket(url, { onOpen, onMsg, onState }) {
  let ws = null, stopped = false, retry = 0, tm = 0, dog = 0;
  const arm = () => { clearTimeout(dog); dog = setTimeout(() => { try { ws && ws.close(); } catch (e) {} }, 25000); };
  const open = () => {
    if (stopped) return;
    try { ws = new WebSocket(url); } catch (e) { onState('error'); return; }
    const me = ws;
    me.onopen = () => { retry = 0; arm(); onOpen && onOpen(me); };
    me.onmessage = (e) => { arm(); let d; try { d = JSON.parse(e.data); } catch (x) { return; } onMsg(d, me); };
    me.onclose = () => { clearTimeout(dog); if (stopped || ws !== me) return; onState('reconnecting'); tm = setTimeout(open, Math.min(15000, 1000 * Math.pow(2, retry++))); };
    me.onerror = () => { try { me.close(); } catch (e) {} };
  };
  open();
  return () => { stopped = true; clearTimeout(tm); clearTimeout(dog); try { ws && ws.close(); } catch (e) {} };
}
const getJson = async (url, init) => { const r = await fetch(url, init); if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } return r.json(); };

// ---- Binance and Binance US (same API shape) --------------------------------------------------------------------------
function binanceLike(cfg) {
  return (pair, cb) => {
    const sym = pair.base + pair.quote, perp = pair.perp;
    if (perp && !cfg.perp) { cb.status('unlisted', 'No perpetuals here'); return () => {}; }
    const rest = perp ? 'https://fapi.binance.com/fapi/v1' : cfg.rest, wsb = perp ? 'wss://fstream.binance.com/stream?streams=' : cfg.ws;
    const book = { bids: new Map(), asks: new Map() };
    let stopped = false, ready = false, lastId = 0, buf = [], stopWs = () => {}, tm = 0, listedFail = false;
    const lower = sym.toLowerCase();
    const applyEv = (d) => { applyRows(book.bids, d.b, true); applyRows(book.asks, d.a, false); };
    const snap = async () => {
      try {
        const d = await getJson(rest + '/depth?symbol=' + sym + '&limit=1000');
        if (stopped) return;
        book.bids.clear(); book.asks.clear();
        applyRows(book.bids, d.bids, true); applyRows(book.asks, d.asks, false);
        lastId = d.lastUpdateId; ready = true;
        for (const e of buf) if (e.u > lastId) applyEv(e);
        buf = []; cb.book(book); cb.status('live');
      } catch (e) {
        if (stopped) return;
        if (e.status === 400 || e.status === 404) { listedFail = true; cb.status('unlisted', 'Not listed on ' + cfg.name); return; }
        if (e.status === 451 || e.status === 403) { listedFail = true; cb.status('unlisted', cfg.name + ' is not available from here'); return; }
        cb.status(ready ? 'live' : 'error', 'Could not load the ' + cfg.name + ' book'); tm = setTimeout(snap, 5000);
      }
    };
    const url = perp ? wsb + lower + '@depth@100ms/' + lower + '@aggTrade' : cfg.ws + lower + '@depth@100ms/' + lower + '@aggTrade';
    cb.status('loading');
    stopWs = socket(url, {
      onOpen: () => { buf = []; ready = false; snap(); },
      onMsg: (m) => {
        const d = m.data || m;
        if (d.e === 'depthUpdate') { if (!ready) { buf.push(d); if (buf.length > 3000) buf.shift(); } else if (d.u > lastId) { applyEv(d); lastId = d.u; cb.book(book); } }
        else if (d.e === 'aggTrade') cb.trades([{ t: d.T, p: +d.p, s: +d.q, side: d.m ? -1 : 1, ex: cfg.id }], false);
      },
      onState: (s) => { if (!listedFail) cb.status(s); }
    });
    // recent trades for the Trades tab (the stream only carries what happens after it opens)
    getJson(rest + '/aggTrades?symbol=' + sym + '&limit=500').then((a) => { if (!stopped) cb.trades(a.map((d) => ({ t: d.T, p: +d.p, s: +d.q, side: d.m ? -1 : 1, ex: cfg.id })), true); }).catch(() => {});
    const refresh = setInterval(() => { if (!stopped && !document.hidden && ready) snap(); }, 120000);
    return () => { stopped = true; clearTimeout(tm); clearInterval(refresh); stopWs(); };
  };
}
const binance = binanceLike({ id: 'binance', name: 'Binance', perp: true, rest: 'https://api.binance.com/api/v3', ws: 'wss://stream.binance.com:9443/stream?streams=' });
const binanceus = binanceLike({ id: 'binanceus', name: 'Binance US', perp: false, rest: 'https://api.binance.us/api/v3', ws: 'wss://stream.binance.us:9443/stream?streams=' });

// ---- Coinbase (spot, the product with the same quote, else USD) ---------------------------------------------------------
function coinbase(pair, cb) {
  if (pair.perp) { cb.status('unlisted', 'No perpetuals here'); return () => {}; }
  const quotes = [...new Set([pair.quote === 'USDT' || pair.quote === 'USDC' ? pair.quote : '', 'USD', 'USDT'].filter(Boolean))];
  const book = { bids: new Map(), asks: new Map() };
  let stopped = false, stopWs = () => {};
  cb.status('loading');
  (async () => {
    let id = '';
    for (const q of quotes) { try { const r = await fetch('https://api.exchange.coinbase.com/products/' + pair.base + '-' + q); if (r.ok) { id = pair.base + '-' + q; break; } } catch (e) {} }
    if (stopped) return;
    if (!id) { cb.status('unlisted', 'Not listed on Coinbase'); return; }
    stopWs = socket('wss://ws-feed.exchange.coinbase.com', {
      onOpen: (ws) => ws.send(JSON.stringify({ type: 'subscribe', product_ids: [id], channels: ['level2_batch', 'matches'] })),
      onMsg: (d) => {
        if (d.type === 'snapshot') { book.bids.clear(); book.asks.clear(); applyRows(book.bids, d.bids, true); applyRows(book.asks, d.asks, false); cb.book(book); cb.status('live'); }
        else if (d.type === 'l2update') { for (const c of d.changes || []) applyRows(c[0] === 'buy' ? book.bids : book.asks, [[c[1], c[2]]], c[0] === 'buy'); cb.book(book); }
        else if (d.type === 'match' || d.type === 'last_match') cb.trades([{ t: Date.parse(d.time) || Date.now(), p: +d.price, s: +d.size, side: d.side === 'sell' ? 1 : -1, ex: 'coinbase' }], false);   // side = the resting (maker) side
      },
      onState: (s) => cb.status(s)
    });
  })();
  return () => { stopped = true; stopWs(); };
}

// ---- Hyperliquid (perpetuals; coin = base) ------------------------------------------------------------------------------
let hlUniverse = null;
function hyperliquid(pair, cb) {
  const coin = pair.base.replace(/^1000/, 'k');
  const book = { bids: new Map(), asks: new Map() };
  let stopped = false, stopWs = () => {};
  cb.status('loading');
  (async () => {
    try {
      if (!hlUniverse) hlUniverse = getJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'meta' }) }).then((j) => j.universe.map((u) => u.name));
      const names = await hlUniverse;
      if (stopped) return;
      if (!names.includes(coin)) { cb.status('unlisted', 'Not listed on Hyperliquid'); return; }
    } catch (e) { hlUniverse = null; }   // can't check: try the stream anyway
    if (stopped) return;
    stopWs = socket('wss://api.hyperliquid.xyz/ws', {
      onOpen: (ws) => { ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin } })); ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin } })); },
      onMsg: (d) => {
        if (d.channel === 'l2Book' && d.data && d.data.coin === coin) {
          book.bids.clear(); book.asks.clear();
          const [b, a] = d.data.levels || [[], []];
          for (const x of b) book.bids.set(+x.px, +x.sz);
          for (const x of a) book.asks.set(+x.px, +x.sz);
          cb.book(book); cb.status('live');
        } else if (d.channel === 'trades' && Array.isArray(d.data)) {
          cb.trades(d.data.filter((x) => x.coin === coin).map((x) => ({ t: x.time, p: +x.px, s: +x.sz, side: x.side === 'B' ? 1 : -1, ex: 'hyperliquid' })), false);
        }
      },
      onState: (s) => cb.status(s)
    });
  })();
  return () => { stopped = true; stopWs(); };
}

// ---- Bybit v5 (spot + USDT linear perps): orderbook.200 snapshot/delta + publicTrade (S = taker side) ------------------
export function bybitBook(book, m) {   // snapshot replaces the book, delta patches it (size 0 deletes a level)
  const d = m.data; if (!d) return false;
  if (m.type === 'snapshot') { book.bids.clear(); book.asks.clear(); }
  applyRows(book.bids, d.b, true); applyRows(book.asks, d.a, false);
  return true;
}
export const bybitTrade = (x) => ({ t: +x.T, p: +x.p, s: +x.v, side: x.S === 'Buy' ? 1 : -1, ex: 'bybit' });
function bybit(pair, cb) {
  const sym = pair.base + pair.quote, book = { bids: new Map(), asks: new Map() };
  const stopWs = socket('wss://stream.bybit.com/v5/public/' + (pair.perp ? 'linear' : 'spot'), {
    onOpen: (ws) => { ws.send(JSON.stringify({ op: 'subscribe', args: ['orderbook.200.' + sym, 'publicTrade.' + sym] })); },
    onMsg: (d, ws) => {
      if (d.op === 'subscribe' && d.success === false) { cb.status('unlisted', 'Not listed on Bybit'); return; }
      if (d.topic === 'orderbook.200.' + sym) { if (bybitBook(book, d)) { cb.book(book); cb.status('live'); } }
      else if (d.topic === 'publicTrade.' + sym && Array.isArray(d.data)) cb.trades(d.data.map(bybitTrade), false);
    },
    onState: (s) => cb.status(s)
  });
  cb.status('loading');
  return () => stopWs();
}

// ---- OKX (spot + USDT swaps; swap sizes converted from contracts to the base coin) ------------------------------------
function okx(pair, cb) {
  const book = new OkxBook();
  let stopped = false, stopWs = () => {}, resub = () => {};
  cb.status('loading');
  (async () => {
    const inst = await fetchInst(pair);
    if (stopped) return;
    if (!inst) { cb.status('unlisted', 'Not listed on OKX'); return; }
    const side = (rows) => numRows(rows, inst.ct);
    stopWs = socket(OKX_WS_PUBLIC, {
      onOpen: (ws) => { resub = () => { ws.send(JSON.stringify({ op: 'unsubscribe', args: [{ channel: 'books', instId: inst.instId }] })); ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'books', instId: inst.instId }] })); }; ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'books', instId: inst.instId }, { channel: 'trades', instId: inst.instId }] })); },
      onMsg: (d) => {
        if (!d.arg || d.arg.instId !== inst.instId || !d.data) return;
        if (d.arg.channel === 'books') {
          const r = book.handle(d);
          if (!r) return;
          if (!r.ok) { book.clear(); resub(); return; }
          const out = { bids: new Map(side([...book.bids.entries()])), asks: new Map(side([...book.asks.entries()])) };
          cb.book(out); if (r.snapshot) cb.status('live');
        } else if (d.arg.channel === 'trades') cb.trades(d.data.map((x) => ({ ...tradeOf(x, inst.ct), ex: 'okx' })), false);
      },
      onState: (s) => cb.status(s)
    });
  })();
  return () => { stopped = true; stopWs(); };
}

// ---- Bitget (spot + USDT perpetuals; public v2 WebSocket; "books" = snapshot then incremental, size 0 deletes) ----------------
const bgTradeRow = (x) => ({ t: +x.ts, p: +x.price, s: +x.size, side: x.side === 'sell' ? -1 : 1, ex: 'bitget' });   // side = the taker (aggressor)
function bitget(pair, cb) {
  const sym = pair.base + (pair.quote === 'USD' || pair.quote === 'USDC' ? 'USDT' : pair.quote), perp = pair.perp, inst = perp ? 'USDT-FUTURES' : 'SPOT';
  const book = { bids: new Map(), asks: new Map() };
  let stopped = false, stopWs = () => {}, listedFail = false;
  cb.status('loading');
  const rest = 'https://api.bitget.com/api/v2/' + (perp ? 'mix' : 'spot') + '/market/fills?symbol=' + sym + (perp ? '&productType=USDT-FUTURES' : '') + '&limit=100';
  getJson(rest).then((j) => { if (!stopped && j.data) cb.trades(j.data.map(bgTradeRow), true); }).catch(() => {});
  stopWs = socket('wss://ws.bitget.com/v2/ws/public', {
    onOpen: (ws) => {
      ws.send(JSON.stringify({ op: 'subscribe', args: [{ instType: inst, channel: 'books', instId: sym }, { instType: inst, channel: 'trade', instId: sym }] }));
      const iv = setInterval(() => { try { ws.send('ping'); } catch (e) {} }, 25000);
      ws.addEventListener('close', () => clearInterval(iv));
    },
    onMsg: (d) => {
      if (d.event === 'error') { listedFail = true; cb.status('unlisted', 'Not listed on Bitget'); return; }
      const ch = d.arg && d.arg.channel;
      if (ch === 'books' && Array.isArray(d.data) && d.data[0]) {
        if (d.action === 'snapshot') { book.bids.clear(); book.asks.clear(); }
        applyRows(book.bids, d.data[0].bids, true); applyRows(book.asks, d.data[0].asks, false);
        cb.book(book); cb.status('live');
      } else if (ch === 'trade' && Array.isArray(d.data)) cb.trades(d.data.map(bgTradeRow), d.action === 'snapshot');
    },
    onState: (s) => { if (!listedFail) cb.status(s); }
  });
  return () => { stopped = true; stopWs(); };
}

// ---- Kraken (spot: WebSocket v2 book + trade; perpetuals "PF_XBTUSD": futures.kraken.com feeds) -------------------------
let krPairs = null;
const krBase = (b) => (b === 'BTC' ? 'XBT' : b);
function kraken(pair, cb) {
  const book = { bids: new Map(), asks: new Map() };
  let stopped = false, stopWs = () => {};
  cb.status('loading');
  if (pair.perp) {
    const id = 'PF_' + krBase(pair.base) + 'USD';   // BTC and XBT both map to PF_XBTUSD
    let listedFail = false;
    stopWs = socket('wss://futures.kraken.com/ws/v1', {
      onOpen: (ws) => { ws.send(JSON.stringify({ event: 'subscribe', feed: 'book', product_ids: [id] })); ws.send(JSON.stringify({ event: 'subscribe', feed: 'trade', product_ids: [id] })); },
      onMsg: (d) => {
        if (d.event === 'error' || d.event === 'alert') { if (!d.feed) { listedFail = true; cb.status('unlisted', 'Not listed on Kraken'); } return; }
        if (d.product_id && d.product_id !== id) return;
        if (d.feed === 'book_snapshot') { book.bids.clear(); book.asks.clear(); applyRows(book.bids, (d.bids || []).map((x) => [x.price, x.qty]), true); applyRows(book.asks, (d.asks || []).map((x) => [x.price, x.qty]), false); cb.book(book); cb.status('live'); }
        else if (d.feed === 'book') { applyRows(d.side === 'buy' ? book.bids : book.asks, [[d.price, d.qty]], d.side === 'buy'); cb.book(book); }
        else if (d.feed === 'trade_snapshot') cb.trades((d.trades || []).map(krfTrade), true);
        else if (d.feed === 'trade') cb.trades([krfTrade(d)], false);
      },
      onState: (s) => { if (!listedFail) cb.status(s); }
    });
    return () => { stopped = true; stopWs(); };
  }
  (async () => {
    if (!krPairs) krPairs = getJson('https://api.kraken.com/0/public/AssetPairs').then((j) => new Set(Object.values(j.result).map((p) => p.wsname && p.wsname.replace(/^XBT\//, 'BTC/')).filter(Boolean))).catch(() => { krPairs = null; return null; });
    const names = await krPairs;
    if (stopped) return;
    const bs = pair.base === 'XBT' ? 'BTC' : pair.base, cands = [bs + '/' + pair.quote, bs + '/USD', bs + '/USDT'];
    const symbol = names ? cands.find((c) => names.has(c)) : cands[0];
    if (!symbol) { cb.status('unlisted', 'Not listed on Kraken'); return; }
    const rp = krBase(bs) + symbol.split('/')[1];
    getJson('https://api.kraken.com/0/public/Trades?pair=' + rp + '&count=500').then((j) => { const k = Object.keys(j.result).find((x) => x !== 'last'); if (!stopped && k) cb.trades(j.result[k].map((x) => ({ t: Math.round(x[2] * 1000), p: +x[0], s: +x[1], side: x[3] === 'b' ? 1 : -1, ex: 'kraken' })), true); }).catch(() => {});
    stopWs = socket('wss://ws.kraken.com/v2', {
      onOpen: (ws) => { ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'book', symbol: [symbol], depth: 500 } })); ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'trade', symbol: [symbol] } })); },
      onMsg: (d) => {
        if (d.channel === 'book' && Array.isArray(d.data) && d.data[0]) {
          const x = d.data[0];
          if (d.type === 'snapshot') { book.bids.clear(); book.asks.clear(); }
          applyRows(book.bids, (x.bids || []).map((r) => [r.price, r.qty]), true); applyRows(book.asks, (x.asks || []).map((r) => [r.price, r.qty]), false);
          cb.book(book); cb.status('live');
        } else if (d.channel === 'trade' && Array.isArray(d.data)) cb.trades(d.data.map((x) => ({ t: Date.parse(x.timestamp) || Date.now(), p: +x.price, s: +x.qty, side: x.side === 'sell' ? -1 : 1, ex: 'kraken' })), d.type === 'snapshot');
      },
      onState: (s) => cb.status(s)
    });
  })();
  return () => { stopped = true; stopWs(); };
}
const krfTrade = (x) => ({ t: +x.time, p: +x.price, s: +x.qty, side: x.side === 'sell' ? -1 : 1, ex: 'kraken' });   // side = the taker (aggressor)

const OPEN = { binance, binanceus, coinbase, hyperliquid, bybit, okx, bitget, kraken };
export function openSource(id, pair, cb) { const f = OPEN[id]; return f ? f(pair, cb) : (cb.status('error', 'Unknown source'), () => {}); }
