// TradeZoro — Charts symbol search: pure helpers (ES module, no DOM). Used by assets/chart-search.js,
// tested in tools/tests/chart-search.test.mjs.
//   classify(d)            -> 'futures' | 'crypto' | 'forex' | 'indices' | 'stocks' | 'other'
//   venueOf(d)             -> venue key ('cme', 'nasdaq', 'binance', 'fx' ...)
//   pairOf(d)              -> { base, quote, perp } for a crypto row, or null
//   scoreRow(d, q)         -> { score, hit:[indices in ticker] } or null (no match). Fuzzy + one-typo tolerant.
//   search(pool, q, limit) -> best rows first.
//   symOf(d)               -> the string the chart opens (venue prefix + ticker, exactly as Vela's own picker built it)

export const CRYPTO_VENUES = ['binance', 'coinbase', 'hyperliquid', 'bybit', 'okx', 'bitget', 'kraken', 'vest'];
export const VENUE_LABEL = {
  cme: 'CME', cbot: 'CBOT', comex: 'COMEX', nymex: 'NYMEX', nasdaq: 'NASDAQ', nyse: 'NYSE', amex: 'AMEX', arca: 'NYSE Arca',
  index: 'Index', fx: 'Forex', binance: 'Binance', coinbase: 'Coinbase', hyperliquid: 'Hyperliquid', bybit: 'Bybit', okx: 'OKX',
  bitget: 'Bitget', kraken: 'Kraken', vest: 'Vest'
};
export const VENUE_ORDER = ['cme', 'cbot', 'comex', 'nymex', 'nyse', 'nasdaq', 'amex', 'arca', 'index', 'fx', 'binance', 'coinbase', 'bybit', 'okx', 'hyperliquid', 'kraken', 'bitget', 'vest'];

const low = (s) => String(s == null ? '' : s).toLowerCase();
export const symOf = (d) => { const v = d.prefix ?? d.provider; return v ? v + ':' + d.ticker : d.ticker; };
export const keyOf = (sym) => { const s = String(sym || ''); const i = s.indexOf(':'); return i < 0 ? s.toUpperCase() : low(s.slice(0, i)) + ':' + s.slice(i + 1).toUpperCase(); };

// Per-row derived fields, computed once per descriptor (the pool is re-scanned on every keystroke).
const META = new WeakMap();
export function metaOf(d) {
  let m = META.get(d);
  if (m) return m;
  const T = String(d.ticker || '').toUpperCase(), root = T.replace(/1!$/, ''), c = classify(d), pr = c === 'crypto' ? pairOf(d) : null;
  m = { T, root, base: pr ? pr.base : root, pr, c, v: venueOf(d), D: String(d.description || '').toUpperCase() };
  META.set(d, m);
  return m;
}

export function classify(d) {
  const p = low(d.provider), t = low(d.type);
  if (p === 'futures') return 'futures';
  if (CRYPTO_VENUES.includes(p)) return 'crypto';
  if (p === 'fx' || t === 'forex') return 'forex';
  if (p === 'idx') return t === 'index' ? 'indices' : 'stocks';
  if (t === 'index') return 'indices';
  if (t === 'stock' || t === 'etf' || p === 'stocks') return 'stocks';
  if (t === 'crypto') return 'crypto';
  if (t === 'futures') return 'futures';
  return 'other';
}

export function venueOf(d) {
  const p = low(d.provider);
  if (p === 'futures') return low(d.prefix || d.exchange || 'cme');
  if (p === 'fx') return 'fx';
  if (p === 'idx' || p === 'stocks') { const e = low(d.exchange).replace(/^nyse ?arca$/, 'arca'); return e || 'index'; }
  return p || low(d.prefix);
}

// "BTC / USDT", "BTC / USDT Perpetual", "BTC / USD Perpetual" -> { base, quote, perp }. Bare tickers fall back to a suffix read.
export function pairOf(d) {
  const m = /^\s*([A-Za-z0-9.$]+)\s*\/\s*([A-Za-z0-9.$]+)(\s+Perp)?/i.exec(d.description || '');
  const perp = low(d.type) === 'futures' || /\.P$|-SWAP$|PERP/i.test(d.ticker || '');
  if (m) return { base: m[1].toUpperCase(), quote: m[2].toUpperCase(), perp };
  const t = String(d.ticker || '').toUpperCase().replace(/\.P$|-SWAP$|[-_]?PERP$/, '');
  const q = /(USDT|USDC|FDUSD|USD|EUR|BTC|ETH)$/.exec(t.replace(/[-/]/g, ''));
  return q && t.length > q[1].length ? { base: t.replace(/[-/]/g, '').slice(0, -q[1].length), quote: q[1], perp } : null;
}

// Damerau-Levenshtein distance capped at 2 (enough for "one typo").
function dist(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const n = a.length, m = b.length, D = [];
  for (let i = 0; i <= n; i++) { D.push([i]); }
  for (let j = 1; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) {
    let rowMin = 9;
    for (let j = 1; j <= m; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, D[i - 2][j - 2] + 1);
      D[i][j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > 1) return 2;
  }
  return D[n][m];
}
const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);
const BIG = ['BTC', 'ETH', 'SOL', 'NQ', 'ES', 'SPY', 'QQQ', 'GC', 'CL', 'YM', 'RTY', 'EURUSD'];

// q: upper-case, trimmed. Higher score = better.
export function scoreRow(d, q) {
  const { T, root, base, pr, D: desc } = metaOf(d);
  let s = 0, hit = [];
  if (T === q || root === q) { s = 1000; hit = range(0, q.length); }
  else if (base === q) { s = 950; const i = T.indexOf(q); hit = i >= 0 ? range(i, q.length) : []; }
  else if (T.startsWith(q)) { s = 800 - (T.length - q.length); hit = range(0, q.length); }
  else if (T.includes(q)) { s = 600 - T.indexOf(q); hit = range(T.indexOf(q), q.length); }
  else {
    const di = desc.indexOf(q);
    if (di >= 0) s = (di === 0 || /[\s(\-/]/.test(desc[di - 1]) ? 450 : 380);
    else if (q.length >= 2) {
      // subsequence in the ticker (letters in order: "BTCU" in "BTCUSDT", "NQM" ...)
      let j = 0; const h = [];
      for (let i = 0; i < T.length && j < q.length; i++) if (T[i] === q[j]) { h.push(i); j++; }
      if (j === q.length && h[h.length - 1] - h[0] < q.length + 3) { s = 260 - (h[h.length - 1] - h[0]); hit = h; }
      else if (q.length >= 3 && dist(q, base) <= 1) s = 200;       // one typo: "BTX" -> BTC, "SPU" -> SPY
      else if (q.length >= 4 && dist(q, root) <= 1) s = 190;
    }
  }
  if (!s) return null;
  // tie-breaks: the big markets first, spot before perps, USDT/USD quotes first, short tickers first
  if (BIG.includes(base) || BIG.includes(root)) s += 30;
  if (pr && !pr.perp) s += 4;
  if (pr && (pr.quote === 'USDT' || pr.quote === 'USD')) s += 6;
  if (low(d.provider) === 'binance') s += 3;
  if (low(d.provider) === 'futures') s += 8;
  return { score: s, hit };
}

// shortcut: a linear scan of the whole pool per keystroke (~10k rows in a few ms); an index if pools grow 10x.
export function search(pool, q, limit = 200) {
  q = String(q || '').trim().toUpperCase();
  let scope = '';
  const m = /^([A-Z_]+):(.*)$/.exec(q);
  if (m && (CRYPTO_VENUES.includes(low(m[1])) || VENUE_LABEL[low(m[1])])) { scope = low(m[1]); q = m[2].trim(); }
  const out = [];
  for (const d of pool) {
    if (scope && metaOf(d).v !== scope && low(d.provider) !== scope) continue;
    if (!q) { out.push({ d, score: 0, hit: [] }); continue; }
    const r = scoreRow(d, q);
    if (r) out.push({ d, score: r.score, hit: r.hit });
  }
  out.sort((a, b) => b.score - a.score || a.d.ticker.length - b.d.ticker.length || a.d.ticker.localeCompare(b.d.ticker));
  return out.slice(0, limit);
}

// Last / change / sparkline numbers from daily bars (oldest first). Never invents: null when there is not enough data.
export function quoteOf(bars) {
  const b = (bars || []).filter((x) => x && Number.isFinite(x.close));
  if (b.length < 2) return null;
  const last = b[b.length - 1].close, prev = b[b.length - 2].close;
  return { last, pct: prev ? (last - prev) / prev * 100 : null, spark: b.slice(-20).map((x) => x.close) };
}
export function decimalsOf(d, price) {
  const t = Number(d && d.mintick);
  if (t > 0 && t < 1) { const f = t.toFixed(10).replace(/0+$/, '').split('.')[1] || ''; return Math.min(8, f.length); }   // 0.25 -> 2, 0.00001 -> 5
  if (t >= 1) return 0;
  const a = Math.abs(price);
  return a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
}
