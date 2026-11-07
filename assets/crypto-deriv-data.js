// TradeZoro — crypto derivatives data: pure helpers (no DOM, no network). Used by assets/chart-crypto-deriv.js.
// Unit-tested in tools/tests/crypto-deriv.test.mjs.
// Exchanges (public, no keys, called straight from the member's browser as the other crypto tools do):
//   Binance USDT-M perps (fapi / fstream), Bybit linear perps (v5), OKX USDT swaps (v5), Hyperliquid perps (info API).
// Everything is keyed by the BASE coin (BTC, ETH, SOL...) against the exchange's USDT perpetual (Hyperliquid: USDC perp).
// Education only. Not financial advice.

export const EXCHANGES = ['binance', 'bybit', 'okx', 'hyperliquid'];
export const EX_NAME = { binance: 'Binance', bybit: 'Bybit', okx: 'OKX', hyperliquid: 'Hyperliquid' };
const CRYPTO_PROV = ['binance', 'binanceus', 'coinbase', 'hyperliquid', 'bybit', 'okx', 'bitget', 'kraken', 'crypto'];
const ALIAS = { XBT: 'BTC', XDG: 'DOGE' };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

// chart symbol ('binance:BTCUSDT', 'binance:BTCUSDT.P', 'okx:BTC-USDT-SWAP', 'bybit:ETHUSDT.P', 'hyperliquid:SOL', 'kraken:XBTUSD')
// + resolved provider -> base coin, or '' when the chart is not a crypto market
export function baseOf(symbol, provider) {
  const s = String(symbol || '');
  const m = /^([a-z0-9_]+):(.+)$/i.exec(s);
  const prov = String(provider || (m ? m[1] : '')).toLowerCase();
  if (!CRYPTO_PROV.includes(prov)) return '';
  let t = (m ? m[2] : s).toUpperCase().replace(/^[A-Z_]+:/, '').replace(/\.P$/, '').replace(/-(SWAP|PERP)$/, '');
  let b = '';
  const d = /^([A-Z0-9]+)[-/_]([A-Z]+)$/.exec(t);
  if (d) b = d[1];
  else { const q = /^(.+?)(USDT|USDC|BUSD|FDUSD|USD|EUR)$/.exec(t); b = q && q[1] ? q[1] : t; }
  b = ALIAS[b] || b;
  return /^[A-Z0-9]{1,15}$/.test(b) ? b : '';
}
// base coin -> the exchange's perpetual symbol
export function exSymbol(ex, base) {
  if (!base) return '';
  if (ex === 'binance' || ex === 'bybit') return base + 'USDT';
  if (ex === 'okx') return base + '-USDT-SWAP';
  if (ex === 'hyperliquid') return base;
  return '';
}

// ---- bars ---------------------------------------------------------------------------------------------------
// bar length in ms from the bars themselves (smallest gap among the first 60)
export function barMs(bars) {
  let ms = Infinity;
  for (let i = 1; i < Math.min(bars.length, 60); i++) { const d = bars[i].time - bars[i - 1].time; if (d > 0 && d < ms) ms = d; }
  return Number.isFinite(ms) ? ms : 0;
}
// index of the bar holding time t, or -1
export function barIndex(bars, t, ms) {
  let lo = 0, hi = bars.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= t) { i = m; lo = m + 1; } else hi = m - 1; }
  return i >= 0 && t < bars[i].time + ms ? i : -1;
}

// ---- liquidations -----------------------------------------------------------------------------------------
// One liquidation print: { t ms, p price, usd, side: 'long' (a long was closed: forced sell) | 'short' (forced buy), ex, qty base }
// Binance <sym>@forceOrder: o.S 'SELL' = a long position was liquidated. Filled qty o.z at average price o.ap.
export function parseBinanceLiq(m) {
  const o = m && (m.o || (m.data && m.data.o));
  if (!o) return [];
  const p = num(o.ap) || num(o.p), q = num(o.z) || num(o.q), t = num(o.T);
  if (!p || !q || !t) return [];
  return [{ t, p, qty: q, usd: p * q, side: o.S === 'SELL' ? 'long' : 'short', ex: 'binance' }];
}
// Bybit allLiquidation.<sym>: data[] { T, s, S, v, p }. S 'Buy' = a long position was liquidated (Bybit v5 docs).
export function parseBybitLiq(m) {
  const arr = m && Array.isArray(m.data) ? m.data : m && m.data ? [m.data] : [];
  const out = [];
  for (const x of arr) { const p = num(x.p), q = num(x.v), t = num(x.T); if (p && q && t) out.push({ t, p, qty: q, usd: p * q, side: x.S === 'Buy' ? 'long' : 'short', ex: 'bybit' }); }
  return out;
}
// OKX liquidation-orders (socket push and the REST /public/liquidation-orders reply share the shape):
// data[] { instId, details[] { posSide 'long'|'short', side, sz (contracts), bkPx, ts } }. ctVal = base per contract.
export function parseOkxLiq(m, instId, ctVal) {
  const out = [];
  for (const d of (m && Array.isArray(m.data) ? m.data : [])) {
    if (instId && d.instId && d.instId !== instId) continue;
    for (const x of d.details || []) {
      const p = num(x.bkPx), c = num(x.sz), t = num(x.ts || x.time);
      if (!p || !c || !t || !(ctVal > 0)) continue;
      const side = x.posSide === 'long' || x.posSide === 'short' ? x.posSide : (x.side === 'sell' ? 'long' : 'short');
      out.push({ t, p, qty: c * ctVal, usd: p * c * ctVal, side, ex: 'okx' });
    }
  }
  return out;
}
// prints -> per-bar USD totals { long: [], short: [], n: [] } (null before `since`, the moment collection started)
export function liqPerBar(list, bars, ms, since) {
  const L = new Array(bars.length).fill(0), S = new Array(bars.length).fill(0), N = new Array(bars.length).fill(0);
  for (const x of list) {
    const i = barIndex(bars, x.t, ms);
    if (i < 0) continue;
    if (x.side === 'long') L[i] += x.usd; else S[i] += x.usd;
    N[i]++;
  }
  // bars that ended before every picked exchange was being collected have no honest total: left empty
  if (isNum(since)) for (let i = 0; i < bars.length; i++) if (bars[i].time + ms <= since) { L[i] = null; S[i] = null; }
  return { long: L, short: S, n: N };
}
// bubble radius against the biggest print in view
export const radius = (usd, max, rMax = 14) => 3 + (rMax - 3) * Math.sqrt(Math.max(0, usd) / Math.max(1, max));
// keep one entry per exchange + time + side + price + size (the OKX REST backfill and the socket overlap)
export function dedupe(list) {
  const seen = new Set(), out = [];
  for (const x of list) { const k = x.ex + '|' + x.t + '|' + x.side + '|' + x.p + '|' + x.qty; if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out.sort((a, b) => a.t - b.t);
}

// ---- open interest ----------------------------------------------------------------------------------------
// The finest history step each exchange offers that is not longer than the bar (5 minutes at the least).
const OI_STEPS = {
  binance: [[5, '5m'], [15, '15m'], [30, '30m'], [60, '1h'], [120, '2h'], [240, '4h'], [360, '6h'], [720, '12h'], [1440, '1d']],
  bybit: [[5, '5min'], [15, '15min'], [30, '30min'], [60, '1h'], [240, '4h'], [1440, '1d']],
  okx: [[5, '5m'], [15, '15m'], [30, '30m'], [60, '1H'], [120, '2H'], [240, '4H'], [360, '6H'], [720, '12H'], [1440, '1D']]
};
export function oiPeriod(ex, barMin) {
  const st = OI_STEPS[ex];
  if (!st) return null;
  let best = st[0];
  for (const s of st) if (s[0] <= Math.max(5, barMin)) best = s;
  return { min: best[0], code: best[1] };
}
export function oiUrl(ex, base, barMin, limit) {
  const p = oiPeriod(ex, barMin), s = exSymbol(ex, base);
  if (!p || !s) return '';
  if (ex === 'binance') return 'https://fapi.binance.com/futures/data/openInterestHist?symbol=' + s + '&period=' + p.code + '&limit=' + Math.min(500, limit || 500);
  if (ex === 'bybit') return 'https://api.bybit.com/v5/market/open-interest?category=linear&symbol=' + s + '&intervalTime=' + p.code + '&limit=' + Math.min(200, limit || 200);
  // OKX's statistics routes send no CORS header: read through the site's same-origin pass-through (functions/api/chart/okx-stat.js)
  if (ex === 'okx') return '/api/chart/okx-stat?kind=oi&base=' + base + '&period=' + p.code;
  return '';
}
// reply -> samples [{ t, usd?, base? }] oldest first. Bybit gives coins only: usd is filled in from the bar close later.
export function parseOI(ex, j) {
  let out = [];
  if (ex === 'binance' && Array.isArray(j)) out = j.map((x) => ({ t: num(x.timestamp), usd: num(x.sumOpenInterestValue), base: num(x.sumOpenInterest) }));
  else if (ex === 'bybit' && j && j.result && Array.isArray(j.result.list)) out = j.result.list.map((x) => ({ t: num(x.timestamp), base: num(x.openInterest) }));
  else if (ex === 'okx' && j && Array.isArray(j.data)) out = j.data.map((r) => ({ t: num(r[0]), base: num(r[2]), usd: num(r[3]) }));
  return out.filter((x) => isNum(x.t) && (isNum(x.usd) || isNum(x.base))).sort((a, b) => a.t - b.t);
}
// samples -> one USD value per bar: the last sample taken at or before the bar's close (null if none yet, or the
// newest sample is older than 2 sample steps, so a gap is shown as a gap)
export function oiPerBar(samples, bars, ms, stepMs) {
  const out = new Array(bars.length).fill(null);
  let k = -1;
  for (let i = 0; i < bars.length; i++) {
    const end = bars[i].time + ms;
    while (k + 1 < samples.length && samples[k + 1].t <= end) k++;
    if (k < 0) continue;
    const s = samples[k];
    if (end - s.t > Math.max(ms, stepMs) * 2) continue;
    out[i] = isNum(s.usd) ? s.usd : isNum(s.base) && isNum(bars[i].close) ? s.base * bars[i].close : null;
  }
  return out;
}
// per-exchange per-bar series -> their sum; a bar where any picked exchange has no value is left empty (a sum with
// a missing venue would show a fake drop)
export function sumSeries(list, n) {
  const out = new Array(n).fill(null);
  if (!list.length) return out;
  for (let i = 0; i < n; i++) {
    let s = 0, ok = true;
    for (const a of list) { if (!isNum(a[i])) { ok = false; break; } s += a[i]; }
    if (ok) out[i] = s;
  }
  return out;
}
export const diffs = (v) => v.map((x, i) => (i > 0 && isNum(x) && isNum(v[i - 1]) ? x - v[i - 1] : null));
// OI change vs price change of the same bar -> one of four states (colour key in the indicator)
export function oiState(dOi, dPx) {
  if (!isNum(dOi) || !isNum(dPx) || dOi === 0) return 'flat';
  if (dOi > 0) return dPx >= 0 ? 'upUp' : 'upDown';   // OI up with price up / OI up with price down
  return dPx >= 0 ? 'downUp' : 'downDown';            // OI down with price up / OI down with price down
}

// ---- funding --------------------------------------------------------------------------------------------
// current-rate request per exchange (Hyperliquid: one call for every coin, POST body)
export function fundingNowReq(ex, base) {
  const s = exSymbol(ex, base);
  if (ex === 'binance') return { url: 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + s };
  if (ex === 'bybit') return { url: 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=' + s };
  if (ex === 'okx') return { url: 'https://www.okx.com/api/v5/public/funding-rate?instId=' + s };
  if (ex === 'hyperliquid') return { url: 'https://api.hyperliquid.xyz/info', body: { type: 'metaAndAssetCtxs' } };
  return null;
}
export function fundingHistReq(ex, base, startMs) {
  const s = exSymbol(ex, base);
  if (ex === 'binance') return { url: 'https://fapi.binance.com/fapi/v1/fundingRate?symbol=' + s + '&limit=1000' };
  if (ex === 'bybit') return { url: 'https://api.bybit.com/v5/market/funding/history?category=linear&symbol=' + s + '&limit=200' };
  if (ex === 'okx') return { url: 'https://www.okx.com/api/v5/public/funding-rate-history?instId=' + s + '&limit=100' };
  if (ex === 'hyperliquid') return { url: 'https://api.hyperliquid.xyz/info', body: { type: 'fundingHistory', coin: s, startTime: Math.round(startMs || Date.now() - 7 * 86400000) } };
  return null;
}
// -> { rate (fraction per interval), next (ms) | null, predicted | null, intervalH } or null when the exchange has no such perp
export function parseFundingNow(ex, j, base) {
  if (ex === 'binance' && j && j.symbol) {
    const r = num(j.lastFundingRate);
    return r == null ? null : { rate: r, next: num(j.nextFundingTime) || null, predicted: null, intervalH: null };
  }
  if (ex === 'bybit' && j && j.result && Array.isArray(j.result.list) && j.result.list[0]) {
    const x = j.result.list[0], r = num(x.fundingRate);
    return r == null ? null : { rate: r, next: num(x.nextFundingTime) || null, predicted: null, intervalH: num(x.fundingIntervalHour) };
  }
  if (ex === 'okx' && j && Array.isArray(j.data) && j.data[0]) {
    const x = j.data[0], r = num(x.fundingRate), ft = num(x.fundingTime), nt = num(x.nextFundingTime);
    return r == null ? null : { rate: r, next: ft || null, predicted: num(x.nextFundingRate), intervalH: ft && nt ? Math.round((nt - ft) / 3600000) : null };
  }
  if (ex === 'hyperliquid' && Array.isArray(j) && j[0] && Array.isArray(j[0].universe)) {
    const i = j[0].universe.findIndex((u) => u.name === base);
    if (i < 0 || !j[1] || !j[1][i]) return null;
    const r = num(j[1][i].funding), now = Date.now();
    return r == null ? null : { rate: r, next: Math.ceil((now + 1) / 3600000) * 3600000, predicted: null, intervalH: 1 };
  }
  return null;
}
// -> [{ t, rate }] oldest first
export function parseFundingHist(ex, j) {
  let out = [];
  if (ex === 'binance' && Array.isArray(j)) out = j.map((x) => ({ t: num(x.fundingTime), rate: num(x.fundingRate) }));
  else if (ex === 'bybit' && j && j.result && Array.isArray(j.result.list)) out = j.result.list.map((x) => ({ t: num(x.fundingRateTimestamp), rate: num(x.fundingRate) }));
  else if (ex === 'okx' && j && Array.isArray(j.data)) out = j.data.map((x) => ({ t: num(x.fundingTime), rate: num(x.realizedRate) != null ? num(x.realizedRate) : num(x.fundingRate) }));
  else if (ex === 'hyperliquid' && Array.isArray(j)) out = j.map((x) => ({ t: num(x.time), rate: num(x.fundingRate) }));
  return out.filter((x) => isNum(x.t) && isNum(x.rate)).sort((a, b) => a.t - b.t);
}
// interval in hours from the history itself (median gap), for exchanges whose reply does not say it
export function intervalFromHist(h) {
  const g = [];
  for (let i = 1; i < h.length; i++) g.push(h[i].t - h[i - 1].t);
  if (!g.length) return null;
  g.sort((a, b) => a - b);
  return Math.max(1, Math.round(g[g.length >> 1] / 3600000));
}
// settled rates -> per-bar value in basis points (0.01%): each bar gets the rate of the funding period it falls in, i.e. the first
// settlement at or after the bar's open (a rate settled at T covers the period up to T). Bars after the last settlement get the
// exchange's current rate for the open period (cur = { rate, next }) when given, else stay empty.
export function fundingPerBar(hist, bars, ms, cur) {
  const out = new Array(bars.length).fill(null);
  const bp = (r) => Math.round(r * 1e8) / 1e4;
  let k = 0;
  for (let i = 0; i < bars.length; i++) {
    const t = bars[i].time;
    while (k < hist.length && hist[k].t <= t) k++;
    if (k < hist.length) { if (k > 0) out[i] = bp(hist[k].rate); }   // before the first settlement we know: no period start known
    else if (cur && isNum(cur.rate) && hist.length && t >= hist[hist.length - 1].t && (!isNum(cur.next) || t < cur.next)) out[i] = bp(cur.rate);
  }
  return out;
}
export const pct = (r, d = 4) => (isNum(r) ? (r >= 0 ? '+' : '') + (r * 100).toFixed(d) + '%' : '—');
// ms left -> "2h 05m" / "4m 10s"
export function countdown(ms) {
  if (!isNum(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm ' + String(x).padStart(2, '0') + 's';
}

// ---- long / short ratio ------------------------------------------------------------------------------------
export const LSR_SOURCES = {
  'Binance: all accounts': { ex: 'binance', path: 'globalLongShortAccountRatio' },
  'Binance: top traders (accounts)': { ex: 'binance', path: 'topLongShortAccountRatio' },
  'Binance: top traders (positions)': { ex: 'binance', path: 'topLongShortPositionRatio' },
  'Bybit: all accounts': { ex: 'bybit', path: 'account-ratio' },
  'OKX: all accounts': { ex: 'okx', path: 'lsr' }
};
export function lsrUrl(source, base, barMin) {
  const S = LSR_SOURCES[source]; if (!S) return '';
  const p = oiPeriod(S.ex, barMin), s = exSymbol(S.ex, base);
  if (S.ex === 'binance') return 'https://fapi.binance.com/futures/data/' + S.path + '?symbol=' + s + '&period=' + p.code + '&limit=500';
  if (S.ex === 'okx') return '/api/chart/okx-stat?kind=lsr&base=' + base + '&period=' + p.code;
  return 'https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=' + s + '&period=' + p.code + '&limit=500';
}
// -> [{ t, ratio, long (share 0..1) }] oldest first
export function parseLsr(source, j) {
  const S = LSR_SOURCES[source]; let out = [];
  if (S && S.ex === 'binance' && Array.isArray(j)) out = j.map((x) => ({ t: num(x.timestamp), ratio: num(x.longShortRatio), long: num(x.longAccount) }));
  else if (S && S.ex === 'okx' && j && Array.isArray(j.data)) out = j.data.map((x) => { const v = num(x[1]); return { t: num(x[0]), ratio: v, long: v != null ? v / (1 + v) : null }; });
  else if (S && S.ex === 'bybit' && j && j.result && Array.isArray(j.result.list)) out = j.result.list.map((x) => { const b = num(x.buyRatio), s = num(x.sellRatio); return { t: num(x.timestamp), ratio: b != null && s ? b / s : null, long: b }; });
  return out.filter((x) => isNum(x.t) && isNum(x.ratio)).sort((a, b) => a.t - b.t);
}

// compact USD for labels: $1.2K / $3.4M / $1.1B
export function usd(v) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
  return s + '$' + Math.round(a);
}
