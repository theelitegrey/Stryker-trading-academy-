// TradeZoro — OKX order-flow venue adapter (spot + USDT/USDC linear swaps). Public streams, no keys.
// Registers 'okx' with assets/orderflow-venues.js. Interface (fixed for all venues):
//   bookStream(pair, { snapshot(bids, asks), diff(bids, asks), status(state, note) }) -> stop
//   tradeStream(pair, { trade({ t, p, s, side }), status(state, note) }) -> stop
//   tick(pair) -> price tick (number)
// bids / asks = [[price, size in base coin], ...]; size 0 in a diff removes the level. side: 1 buyer-aggressor, -1 seller-aggressor.
// pair = { base, quote, perp } or a chart ticker ("BTC-USDT", "BTC-USDT-SWAP"). Swap sizes are converted from contracts to base coin.
import { OKX_REST, OKX_WS_PUBLIC, OkxBook, numRows, tradeOf, fetchInst } from './okx-core.js?v=906';
import { registerVenue } from './orderflow-venues.js?v=906';

const ticks = new Map();
const pairKey = (p) => p.base + '-' + p.quote + (p.perp ? '-SWAP' : '');
export function toPair(p) {
  if (p && typeof p === 'object') return p;
  let t = String(p || '').toUpperCase().replace(/^[A-Z_]+:/, ''), perp = false;
  if (/-SWAP$/.test(t)) { perp = true; t = t.slice(0, -5); } else if (/\.P$/.test(t)) { perp = true; t = t.slice(0, -2); }
  const m = /^([A-Z0-9]+)[-/_]([A-Z]+)$/.exec(t) || /^(.+?)(USDT|USDC|USD)$/.exec(t);
  return m ? { base: m[1], quote: m[2], perp } : { base: t, quote: 'USDT', perp };
}

// One socket per stream call, reconnect with backoff, re-subscribe on every open.
function open(subArgs, onMsg, onState, onOpen) {
  let ws = null, stopped = false, retry = 0, tm = 0, ping = 0, dog = 0;
  const arm = () => { clearTimeout(dog); dog = setTimeout(() => { try { ws && ws.close(); } catch (e) {} }, 30000); };
  const go = () => {
    if (stopped) return;
    try { ws = new WebSocket(OKX_WS_PUBLIC); } catch (e) { onState('error'); return; }
    const me = ws;
    me.onopen = () => { retry = 0; arm(); onOpen && onOpen(); me.send(JSON.stringify({ op: 'subscribe', args: subArgs })); ping = setInterval(() => { try { me.send('ping'); } catch (e) {} }, 20000); };
    me.onmessage = (e) => { arm(); if (e.data === 'pong') return; let d; try { d = JSON.parse(e.data); } catch (x) { return; } onMsg(d, me); };
    me.onclose = () => { clearInterval(ping); clearTimeout(dog); if (stopped || ws !== me) return; onState('reconnecting'); tm = setTimeout(go, Math.min(15000, 1000 * Math.pow(2, retry++))); };
    me.onerror = () => { try { me.close(); } catch (e) {} };
  };
  go();
  return { resub: () => { try { ws.send(JSON.stringify({ op: 'unsubscribe', args: subArgs })); ws.send(JSON.stringify({ op: 'subscribe', args: subArgs })); } catch (e) {} },
    stop: () => { stopped = true; clearTimeout(tm); clearTimeout(dog); clearInterval(ping); try { ws && ws.close(); } catch (e) {} } };
}

function bookStream(p, cb) {
  const pair = toPair(p);
  let stopped = false, conn = null;
  cb.status('loading');
  (async () => {
    const inst = await fetchInst(pair);
    if (stopped) return;
    if (!inst) { cb.status('unlisted', 'Not listed on OKX'); return; }
    ticks.set(pairKey(pair), inst.tick);
    const book = new OkxBook();
    conn = open([{ channel: 'books', instId: inst.instId }], (d) => {
      if (!d.arg || d.arg.channel !== 'books' || d.arg.instId !== inst.instId) return;
      const r = book.handle(d);
      if (!r) return;
      if (!r.ok) { book.clear(); conn.resub(); return; }   // checksum mismatch: take a fresh snapshot
      if (r.snapshot) { cb.snapshot(numRows([...book.bids.entries()], inst.ct), numRows([...book.asks.entries()], inst.ct)); cb.status('live'); }
      else cb.diff(numRows(r.bids, inst.ct), numRows(r.asks, inst.ct));
    }, (s) => cb.status(s));
  })();
  return () => { stopped = true; conn && conn.stop(); };
}

function tradeStream(p, cb) {
  const pair = toPair(p);
  let stopped = false, conn = null;
  cb.status('loading');
  (async () => {
    const inst = await fetchInst(pair);
    if (stopped) return;
    if (!inst) { cb.status('unlisted', 'Not listed on OKX'); return; }
    ticks.set(pairKey(pair), inst.tick);
    // recent prints (oldest first) so the first bars are not empty; then the stream, skipping ids already seen
    let lastId = 0;
    try {
      const r = await fetch(OKX_REST + '/market/trades?instId=' + inst.instId + '&limit=500');
      const j = r.ok ? await r.json() : null;
      if (!stopped && j && j.code === '0') for (const x of j.data.slice().reverse()) { cb.trade(tradeOf(x, inst.ct)); lastId = Math.max(lastId, +x.tradeId || 0); }
    } catch (e) { /* stream only */ }
    if (stopped) return;
    conn = open([{ channel: 'trades', instId: inst.instId }], (d) => {
      if (!d.arg || d.arg.channel !== 'trades' || d.arg.instId !== inst.instId || !Array.isArray(d.data)) return;
      cb.status('live');
      for (const r of d.data) { if (lastId && +r.tradeId <= lastId) continue; cb.trade(tradeOf(r, inst.ct)); }
    }, (s) => cb.status(s));
  })();
  return () => { stopped = true; conn && conn.stop(); };
}

const tick = (p) => ticks.get(pairKey(toPair(p))) || 0.01;
registerVenue('okx', { bookStream, tradeStream, tick });
