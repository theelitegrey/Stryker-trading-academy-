// TradeZoro — OKX public market data, pure logic (no DOM, no sockets): instrument ids, order-book snapshot/update with the
// OKX CRC32 checksum, trade rows. Shared by assets/book-panel-sources.js (Book·DOM·Trades) and assets/orderflow-venue-okx.js
// (crypto order flow). Unit-tested in tools/tests/okx-core.test.mjs. Education only. Not financial advice.

export const OKX_REST = 'https://www.okx.com/api/v5';
export const OKX_WS_PUBLIC = 'wss://ws.okx.com:8443/ws/v5/public';

// pair = { base, quote, perp } (assets/book-panel-core.js pairOf). Quotes OKX lists in size: USDT, USDC (USD only on spot).
export function instIds(pair) {
  const b = pair.base, q = String(pair.quote || 'USDT').toUpperCase();
  const quotes = [...new Set([q === 'USDT' || q === 'USDC' ? q : '', 'USDT', 'USDC'].filter(Boolean))];
  if (!pair.perp && (q === 'USD' || q === 'USDT')) quotes.push('USD');
  return quotes.map((x) => b + '-' + x + (pair.perp ? '-SWAP' : ''));
}

// instrument row -> units per contract (linear swap: ctVal of the base coin; spot: 1) and price tick
export function instInfo(row) {
  if (!row) return null;
  const isSwap = row.instType === 'SWAP';
  const ct = isSwap ? parseFloat(row.ctVal) * (parseFloat(row.ctMult) || 1) : 1;
  return { instId: row.instId, ct: ct > 0 ? ct : 1, tick: parseFloat(row.tickSz) || 0.01, linear: !isSwap || row.ctType === 'linear' };
}

// ---- CRC32 (OKX books checksum) ------------------------------------------------------------------------------------
let T = null;
export function crc32(str) {
  if (!T) { T = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c; } }
  let c = -1;
  for (let i = 0; i < str.length; i++) c = T[(c ^ str.charCodeAt(i)) & 255] ^ (c >>> 8);   // ASCII only (digits, '.', ':')
  return (c ^ -1) | 0;   // signed 32-bit, like OKX
}

// ---- book ------------------------------------------------------------------------------------------------------------
// OkxBook keeps the raw price / size strings (the checksum is over the strings), sorted best first on demand.
export class OkxBook {
  constructor() { this.bids = new Map(); this.asks = new Map(); this.seq = null; }
  clear() { this.bids.clear(); this.asks.clear(); this.seq = null; }
  // rows = [[px, sz, '0', n], ...]; sz '0' removes the level
  apply(side, rows) {
    const m = side === 'b' ? this.bids : this.asks;
    for (const r of rows || []) { if (+r[1] === 0) m.delete(r[0]); else m.set(r[0], r[1]); }
  }
  top(side, n) {
    const m = side === 'b' ? this.bids : this.asks, s = side === 'b' ? -1 : 1;
    return [...m.entries()].sort((a, b) => s * (a[0] - b[0])).slice(0, n);
  }
  checksum() {
    const b = this.top('b', 25), a = this.top('a', 25), parts = [];
    for (let i = 0; i < Math.max(b.length, a.length); i++) {
      if (b[i]) parts.push(b[i][0], b[i][1]);
      if (a[i]) parts.push(a[i][0], a[i][1]);
    }
    return crc32(parts.join(':'));
  }
  // One websocket "books" message ({ action, data:[{bids,asks,checksum}] }) -> true when it matches the checksum.
  // snapshot: replace; update: merge. Returns { ok, snapshot }.
  handle(msg) {
    const d = msg && msg.data && msg.data[0];
    if (!d) return null;
    const snapshot = msg.action === 'snapshot';
    if (snapshot) this.clear();
    this.apply('b', d.bids); this.apply('a', d.asks);
    // Integrity: the sequence must chain (prevSeqId == last seqId; an empty heartbeat update keeps seqId). OKX currently sends
    // checksum 0 on the public books channel (observed 2026-11), so the CRC is only enforced when a non-zero one arrives.
    let ok = true;
    if (!snapshot && d.prevSeqId !== undefined && this.seq != null && +d.prevSeqId !== this.seq) ok = false;
    if (d.seqId !== undefined) this.seq = +d.seqId;
    if (d.checksum && d.checksum !== this.checksum()) ok = false;
    return { snapshot, ok, bids: d.bids || [], asks: d.asks || [] };
  }
}

// price / size string rows -> numeric [px, size in base units] (ct = units per contract)
export const numRows = (rows, ct) => (rows || []).map((r) => [+r[0], +r[1] * (ct || 1)]);

// trades channel row { px, sz, side: taker 'buy'|'sell', ts } -> { t, p, s, side: 1 buyer-aggressor | -1 seller-aggressor }
export const tradeOf = (r, ct) => ({ t: +r.ts, p: +r.px, s: +r.sz * (ct || 1), side: r.side === 'sell' ? -1 : 1 });

export async function fetchInst(pair, fetchFn) {
  const f = fetchFn || fetch;
  const type = pair.perp ? 'SWAP' : 'SPOT';
  for (const id of instIds(pair)) {
    try {
      const r = await f(OKX_REST + '/public/instruments?instType=' + type + '&instId=' + id);
      if (!r.ok) continue;
      const j = await r.json();
      const row = j && j.code === '0' && j.data && j.data[0];
      if (row && row.state === 'live') return instInfo(row);
    } catch (e) { /* try next quote */ }
  }
  return null;
}
