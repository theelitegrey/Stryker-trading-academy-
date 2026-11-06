// TradeZoro — Book · DOM · Trades panel: crypto exchange streams, straight from the browser (public endpoints, no keys).
// Each source: openSource(id, pair, { book(book), trades(list), status(state, note) }) -> stop().
//   book  = { bids: Map(price -> size), asks: Map(price -> size) }  (live object, read it, don't keep it)
//   trade = { t, p, s, side: 1 buyer-aggressor | -1 seller-aggressor, ex }
//   status: 'loading' | 'live' | 'reconnecting' | 'unlisted' | 'error'
// Wording: no "real-time" claims; the panel shows "updated Xs ago" only. Education only. Not financial advice.
export const SOURCES = [
  { id: 'binance', name: 'Binance', perp: true },
  { id: 'binanceus', name: 'Binance US', perp: false },
  { id: 'coinbase', name: 'Coinbase', perp: false },
  { id: 'hyperliquid', name: 'Hyperliquid', perp: true },
  { id: 'bybit', name: 'Bybit', perp: true }
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

const OPEN = { binance, binanceus, coinbase, hyperliquid, bybit };
export function openSource(id, pair, cb) { const f = OPEN[id]; return f ? f(pair, cb) : (cb.status('error', 'Unknown source'), () => {}); }
