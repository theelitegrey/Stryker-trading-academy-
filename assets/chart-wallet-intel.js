// TradeZoro — "Wallet Intel" chart indicator for Hyperliquid charts (free for everyone, signed-out included). ES module.
// Owner order 2026-11-07: who traded a candle, where tracked wallets' liquidation prices and stop orders cluster, and which tracked
// wallets have orders at a book level. Data: the book-recorder Worker's /hl-candle /hl-clusters /hl-level /hl-wallet (src/hl.js,
// fed by workers/book-recorder/hl-feeder; contract v1: stryker-notes/reports/workers/hl-intel/contract.md). Public on-chain data only.
//   1. Tap / click a candle -> panel (desktop: beside the chart; phone: bottom sheet): totals, top wallets, tap a wallet -> profile.
//   2. Liquidation clusters: bubbles at liquidation-price buckets (long red / short green), size = notional; tap -> wallets.
//   3. Stop clusters: bars from the price axis at trigger-price buckets; tap -> wallets.
//   4. Book panel (chart-book-panel.js): tapping a level on a Hyperliquid chart calls window.__stkWalletIntel.openLevel().
// HONESTY: candle wallets cover every fill (each public trade names its buyer and seller). Liquidation / stop clusters and book
// levels cover TRACKED wallets only; the footer says so with the coverage share the server measured. Never "real-time": the
// clusters are polled, so the copy says "updated X min ago". No vendor names. Education only. Not financial advice.
// Depends on: Vela plugin SDK via the legend-row Core (registerNativeIndicator, registerRendererLayer, registerStatePersistence),
// chart-watchlist.js (.stkchart-panel.stkw-host, --stkw-rail / --stkw-w), style.css tokens (--ink-*, --line-soft, --bg-*).

export const WI_TYPE = 'stk_hlintel';
export const SIZES = ['$10K', '$100K', '$1M'];
const SCHEMA = [
  { key: 'liq', title: 'Liquidation clusters', type: 'bool', defval: true },
  { key: 'stops', title: 'Stop clusters', type: 'bool', defval: true },
  { key: 'minSize', title: 'Minimum cluster size', type: 'string', defval: '$100K', options: SIZES },
  { key: 'labels', title: 'Show wallet labels', type: 'bool', defval: true },
  { key: 'longColor', title: 'Long liquidations colour', type: 'color', defval: '#f23645' },
  { key: 'shortColor', title: 'Short liquidations colour', type: 'color', defval: '#03c988' },
  { key: 'stopColor', title: 'Stop orders colour', type: 'color', defval: '#00adb5' }
];
const RECORDER = () => (typeof window !== 'undefined' && window.__STK_BOOK_RECORDER) || 'https://book-recorder.theelitegrey.workers.dev';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (v == null || v === '' ? NaN : +v);
export const EXPLORER = (a) => 'https://app.hyperliquid.xyz/explorer/address/' + a;
export const KEEP_MS = 7 * 86400e3;   // the server keeps 7 days of candle wallets

// ---- pure (tools/tests/chart-wallet-intel.test.mjs) ---------------------------------------------------------------
// chart symbol -> Hyperliquid perp coin, case kept ('hyperliquid:BTC' -> 'BTC', 'hyperliquid:kPEPE' -> 'kPEPE'), else ''.
// Spot pairs ('hyperliquid:PURR/USDC') -> '' too: the tool covers perps (positions, liquidations and stops are perp-only).
export function coinOf(symbol) {
  const m = /^hyperliquid:(.+)$/i.exec(String(symbol || '').trim());
  const c = m ? m[1].replace(/\.P$/i, '') : '';
  return /^[A-Za-z0-9]{1,16}(:[A-Za-z0-9]{1,16})?$/.test(c) ? c : '';
}
export const NOT_HL = 'Wallet Intel works on Hyperliquid perps. Open a Hyperliquid perp chart to use it.';
export const sizeUsd = (label) => { const m = /^\$(\d+)([KM])$/.exec(String(label || '')); return m ? +m[1] * (m[2] === 'M' ? 1e6 : 1e3) : 1e5; };
export function usd(v) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return s + '$' + (a >= 1e7 ? Math.round(a / 1e6) : (a / 1e6).toFixed(1).replace(/\.0$/, '')) + 'M';
  if (a >= 1e3) return s + '$' + (a >= 1e4 ? Math.round(a / 1e3) : (a / 1e3).toFixed(1).replace(/\.0$/, '')) + 'K';
  return s + '$' + Math.round(a);
}
export function fmtPx(p) {
  if (!isNum(p)) return '—';
  const a = Math.abs(p), d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 3 : a >= 0.01 ? 5 : 7;
  return p.toLocaleString('en-US', { minimumFractionDigits: a >= 1000 ? 0 : Math.min(d, 2), maximumFractionDigits: d });
}
export function fmtSz(s) {
  if (!isNum(s)) return '—';
  const a = Math.abs(s);
  return s.toLocaleString('en-US', { maximumFractionDigits: a >= 1000 ? 0 : a >= 1 ? 2 : 5 });
}
export const shortAddr = (a) => (/^0x[0-9a-f]{40}$/i.test(String(a || '')) ? a.slice(0, 6) + '…' + a.slice(-4) : String(a || ''));
// label shown for a wallet: the server's `l` (public name, or its short id) when labels are on, else our short address
export const labelOf = (w, labels) => (labels !== false && w && w.label ? String(w.label) : shortAddr(w && w.a));
// display text for the server's three tags (contract: whale / top100vol / vault); anything else is dropped
export const TAG_TEXT = { whale: 'Whale', top100vol: 'Top 100 volume', vault: 'Vault' };
export function agoText(tMs, nowMs) {
  if (!isNum(tMs) || tMs <= 0) return '';
  const m = Math.max(0, Math.floor(((nowMs || Date.now()) - tMs) / 60000));
  if (m < 1) return 'updated just now';
  if (m < 60) return 'updated ' + m + ' min ago';
  if (m < 48 * 60) return 'updated ' + Math.floor(m / 60) + ' h ago';
  return 'updated ' + Math.floor(m / 1440) + ' days ago';
}
const tagsOf = (x) => (Array.isArray(x && x.tags) ? x.tags.filter((t) => TAG_TEXT[t]) : []);
const addrOf = (x) => String((x && x.a) || '').toLowerCase();
const wal = (w) => ({ a: addrOf(w), label: typeof w.l === 'string' ? w.l : '', tags: tagsOf(w) });
// coverage line (contract: clusters.coverage { oiPct 0..100, wallets }): "tracking N of the biggest wallets ≈ X% of open interest"
export function coverageText(cov) {
  if (!cov || !isNum(cov.oiPct)) return '';
  return 'tracking ' + (isNum(cov.wallets) ? cov.wallets.toLocaleString('en-US') + ' of the biggest wallets' : 'the biggest wallets') + ' ≈ ' + (cov.oiPct < 10 ? cov.oiPct.toFixed(1).replace(/\.0$/, '') : Math.round(cov.oiPct)) + '% of open interest';
}

// Server JSON (contract v1, stryker-notes/reports/workers/hl-intel/contract.md) -> what the UI reads. Missing -> NaN / [] (never invented).
// /hl-candle
export function normCandle(j) {
  if (!j || typeof j !== 'object' || !j.tot) return null;
  const ws = (Array.isArray(j.wallets) ? j.wallets : []).map((w) => {
    const buySz = num(w.buySz) || 0, sellSz = num(w.sellSz) || 0, buyNtl = num(w.buyNtl) || 0, sellNtl = num(w.sellNtl) || 0;
    return Object.assign(wal(w), { buySz, sellSz, buyNtl, sellNtl, ntl: buyNtl + sellNtl, buyPx: num(w.buyAvgPx), sellPx: num(w.sellAvgPx), fills: num(w.fills) || 0, pct: num(w.pct), side: num(w.netSz) > 0 || (!(num(w.netSz) < 0) && buyNtl >= sellNtl) ? 1 : -1 });
  }).filter((w) => w.a);
  const T = j.tot, o = j.others;
  return { coin: j.coin || '', from: num(j.from), to: num(j.to), updated: num(j.updated), held: num(j.held), partial: !!j.partial,
    ntl: num(T.ntl), sz: num(T.sz), trades: num(T.trades), takerBuyNtl: num(T.takerBuyNtl), takerSellNtl: num(T.takerSellNtl), wallets: num(T.wallets), truncated: !!T.truncated,
    others: o ? { ntl: (num(o.buyNtl) || 0) + (num(o.sellNtl) || 0) } : null, list: ws };
}
// /hl-clusters: one bucket per price band [px, px + step) holds both sides -> one cluster per side present
export function normClusters(j) {
  if (!j || typeof j !== 'object' || !isNum(num(j.step))) return null;
  const step = num(j.step);
  const split = (b, kind, sides) => sides.filter(([k]) => Array.isArray(b[k]) && b[k][0] > 0).map(([k, side]) => {
    const wallets = (Array.isArray(b.w) ? b.w : []).filter((w) => w.side === k).map((w) => Object.assign(wal(w), { side, ntl: num(w.ntl), sz: num(w.sz), px: num(kind === 'liq' ? w.liqPx : w.px), entryPx: num(w.entryPx), lev: num(w.lev), kind: w.kind === 'tp' ? 'Take profit' : w.kind === 'sl' ? 'Stop loss' : '' })).filter((w) => w.a).sort((p, q) => (q.ntl || 0) - (p.ntl || 0));
    return { kind, side, lo: num(b.px), hi: num(b.px) + step, px: num(b.px) + step / 2, ntl: num(b[k][0]), n: num(b[k][1]) || wallets.length, wallets, cut: (num(b.nw) || 0) > (Array.isArray(b.w) ? b.w.length : 0) };
  });
  const ok = (c) => isNum(c.lo) && c.lo > 0 && isNum(c.ntl) && c.ntl > 0;
  const cov = j.coverage || {};
  return {
    t: num(j.t), coin: j.coin || '', mid: num(j.mid), step,
    coverage: { oiPct: num(cov.oiPct), wallets: num(cov.wallets), positions: num(cov.positions), bookPct: num(cov.bookPct) },
    liq: (Array.isArray(j.liq) ? j.liq : []).flatMap((b) => split(b, 'liq', [['long', 1], ['short', -1]])).filter(ok),
    stops: (Array.isArray(j.stops) ? j.stops : []).flatMap((b) => split(b, 'stop', [['buy', 1], ['sell', -1]])).filter(ok)
  };
}
// /hl-level answered for [px - step, px + step]: keep what sits in the book row at px. The book buckets bids down and asks up
// (book-panel-core.js bucketSide), so the row at px holds bids in [px, px + step) and asks in (px - step, px].
export function levelBand(px, step) { const s = step > 0 ? step : 0; return { lo: +(px - s).toFixed(10), hi: +(px + s).toFixed(10) }; }
export function normLevel(j, px, step) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.levels)) return null;
  const e = step > 0 ? step * 1e-9 : 1e-12;
  const inRow = (l) => (!(step > 0) ? Math.abs(l.px - px) <= e : l.side === 'bid' ? l.px >= px - e && l.px < px + step - e : l.px > px - step + e && l.px <= px + e);
  const orders = j.levels.filter((l) => isNum(num(l.px)) && (l.side === 'bid' || l.side === 'ask') && inRow(l))
    .flatMap((l) => (Array.isArray(l.w) ? l.w : []).map((w) => Object.assign(wal(w), { px: num(l.px), side: l.side === 'bid' ? 1 : -1, sz: num(w.sz), ntl: num(w.ntl) })))
    .filter((w) => w.a).sort((p, q) => (q.ntl || 0) - (p.ntl || 0));
  const cov = j.coverage || {};
  return { t: num(j.t), coin: j.coin || '', px, orders, trackedSz: orders.reduce((s, o) => s + (o.sz || 0), 0), bookPct: num(cov.bookPct), wallets: num(cov.wallets) };
}
// /hl-wallet
export function normWallet(j) {
  if (!j || typeof j !== 'object' || !/^0x[0-9a-f]{40}$/.test(addrOf(j))) return null;
  const pos = (Array.isArray(j.pos) ? j.pos : []).map((p) => ({ coin: String(p.coin || ''), side: p.side === 'short' ? -1 : 1, sz: num(p.sz), ntl: num(p.ntl), entryPx: num(p.entryPx), liqPx: num(p.liqPx), lev: num(p.lev), mode: p.mode === 'isolated' ? 'isolated' : p.mode === 'cross' ? 'cross' : '' }))
    .filter((p) => p.coin && isNum(p.sz) && p.sz > 0).sort((a, b) => (b.ntl || 0) - (a.ntl || 0));
  // fills: [t ms, coin, side B|A, size, notional, avg px], newest last -> newest first
  const fills = (Array.isArray(j.fills) ? j.fills : []).filter((f) => Array.isArray(f) && f.length >= 6 && isNum(num(f[0])))
    .map((f) => ({ t: num(f[0]), coin: String(f[1] || ''), side: f[2] === 'B' ? 1 : -1, sz: num(f[3]), ntl: num(f[4]), px: num(f[5]) })).sort((a, b) => b.t - a.t);
  return Object.assign(wal(j), { tracked: !!j.tracked, t: num(j.t), av: num(j.av), vol30: num(j.vol30), positions: pos, trig: Array.isArray(j.trig) ? j.trig.length : 0, nLim: num(j.nLim) || 0, fills });
}
// the clusters to draw: on side and above the size filter
export function visibleClusters(cl, I) {
  if (!cl) return [];
  const min = sizeUsd(I && I.minSize);
  return [...(I && I.liq === false ? [] : cl.liq), ...(I && I.stops === false ? [] : cl.stops)].filter((c) => c.ntl >= min);
}
// bar index whose [time, time + ms) holds t (bars sorted), else -1
export function barAt(bars, t, ms) {
  let lo = 0, hi = bars.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= t) { i = m; lo = m + 1; } else hi = m - 1; }
  return i >= 0 && t < bars[i].time + ms ? i : -1;
}
export function barMs(bars) {
  let ms = Infinity;
  for (let i = 1; i < Math.min(bars.length, 60); i++) { const d = bars[i].time - bars[i - 1].time; if (d > 0 && d < ms) ms = d; }
  return Number.isFinite(ms) ? ms : 60000;
}
// a click at chart x / y -> the candle under it (nearest bar centre within half a bar, and y inside its high-low +- tol px), else -1
export function candleHit(bars, xs, ys, x, y, tol) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < xs.length; i++) { const d = Math.abs(xs[i] - x); if (d < bd) { bd = d; best = i; } }
  if (best < 0) return -1;
  const half = xs.length > 1 ? Math.abs(xs[Math.min(best + 1, xs.length - 1)] - xs[Math.max(best - 1, 0)]) / (best > 0 && best < xs.length - 1 ? 4 : 2) : 12;
  if (bd > Math.max(half, 4)) return -1;
  const [yh, yl] = ys[best];
  return y >= Math.min(yh, yl) - tol && y <= Math.max(yh, yl) + tol ? best : -1;
}
export const radius = (v, max, rMax) => 4 + (rMax - 4) * Math.sqrt(Math.max(0, v) / Math.max(1, max));

// ---- data ---------------------------------------------------------------------------------------------------------
const cache = new Map();   // url -> { at, j, err, p }
const subs = new Set();
const TTL = 60000;
// 404 {"error":"no_data"} -> null (no tracked data yet); 400 / 429 / 5xx -> an error code the panel words plainly
async function getJson(path) {
  const r = await fetch(RECORDER() + path, { credentials: 'omit' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(r.status === 429 ? 'busy' : r.status === 400 ? 'bad' : 'down');
  return r.json();
}
// cached GET; ttl 0 = keep (a closed candle never changes). Calls back subscribers when it lands.
export function load(path, ttl = TTL) {
  const e = cache.get(path);
  if (e && (e.p || (e.j !== undefined && (ttl === 0 || Date.now() - e.at < ttl)) || (e.err && Date.now() - e.at < 15000))) return e.p || Promise.resolve(e.j);
  const n = { at: Date.now(), j: e ? e.j : undefined, err: '', p: null };
  n.p = getJson(path).then((j) => { n.j = j; n.err = ''; n.at = Date.now(); return j; }, (x) => { n.err = (x && /^(busy|bad)$/.test(x.message) && x.message) || 'down'; n.at = Date.now(); return n.j; })
    .then((j) => { n.p = null; subs.forEach((f) => { try { f(path); } catch (x) {} }); return j; });
  if (cache.size > 300) cache.clear();
  cache.set(path, n);
  return n.p;
}
export const cached = (path) => cache.get(path) || null;
export const redraw = () => natives.forEach((n) => { n.sig = ''; n.refresh(); });   // ladders: row size or bands changed
const LH = () => (typeof window !== 'undefined' && window.__stkLadders) || null;   // chart-hl-ladders.js: panel + bands hook
export const _set = (path, j) => { cache.set(path, { at: Date.now() + 1e12, j, err: '', p: null }); subs.forEach((f) => { try { f(path); } catch (x) {} }); };   // test hook
const onData = (f) => { subs.add(f); return () => subs.delete(f); };
const enc = encodeURIComponent;
export const P = {
  candle: (coin, from, to) => '/hl-candle?coin=' + enc(coin) + '&from=' + from + '&to=' + to + '&n=50',
  clusters: (coin) => '/hl-clusters?coin=' + enc(coin),
  level: (coin, lo, hi) => '/hl-level?coin=' + enc(coin) + '&lo=' + lo + '&hi=' + hi,
  wallet: (a) => '/hl-wallet?a=' + enc(a)
};

// ---- native + layer -------------------------------------------------------------------------------------------------
const replayOn = () => !!(window.__stkReplay && window.__stkReplay.on);
const light = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
const hits = new WeakMap();   // canvas -> { boxes, geo }
let sel = null;               // { coin, t } selected candle (outlined on the chart)
let inputsNow = Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval]));
const natives = new Set();

class WiNative {
  constructor() { this.ctx = null; this.inputs = {}; this.sig = ''; this.timer = 0; this.off = null; }
  defaults() { return Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])); }
  start(ctx, inputs) {
    this.ctx = ctx; this.inputs = Object.assign(this.defaults(), inputs); inputsNow = this.inputs; natives.add(this);
    this.off = onData(() => this.refresh());
    this.load();
    this.timer = setInterval(() => { if (!document.hidden) this.load(); }, TTL);
  }
  coin() { return this.ctx ? coinOf(this.ctx.symbol) : ''; }
  load() { const c = this.coin(); if (c && !replayOn() && (this.inputs.liq !== false || this.inputs.stops !== false)) load(P.clusters(c)); this.refresh(); }
  onBars() { const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.load(); } else this.refresh(); }
  onViewport() {}
  setInputs(i) { this.inputs = Object.assign(this.defaults(), i); inputsNow = this.inputs; this.sig = ''; this.load(); if (window.__stkWalletIntel) window.__stkWalletIntel.rerender(); }
  suspend() {}
  resume() { this.sig = ''; this.load(); }
  stop() { clearInterval(this.timer); natives.delete(this); if (this.off) this.off(); try { this.ctx.pushData(null); } catch (e) {} }
  push(p) {
    const sig = JSON.stringify(p && p.cl ? { t: p.cl.t, n: p.list.length, I: p.I, s: p.sel, c: p.coin } : p);
    if (sig === this.sig) return; this.sig = sig;
    try { this.ctx.pushData(p); } catch (e) {}
  }
  refresh() {
    if (!this.ctx) return;
    const coin = this.coin();
    if (!coin) return this.push({ note: NOT_HL });
    if (replayOn()) return this.push({ note: 'Wallet Intel: hidden in replay' });
    const s = sel && sel.coin === coin ? sel.t : 0;
    if (this.inputs.liq === false && this.inputs.stops === false) return this.push({ coin, list: [], cl: { t: 0 }, I: this.inputs, sel: s });
    const e = cached(P.clusters(coin));
    if (!e || (e.j === undefined && !e.err)) return this.push({ coin, list: [], cl: null, I: this.inputs, sel: s, chip: 'Loading wallet data…' });
    const cl = normClusters(e.j);
    if (!cl) return this.push({ coin, list: [], cl: null, I: this.inputs, sel: s, chip: e.err ? 'Wallet Intel: wallet data is not available right now' : 'Wallet Intel: no tracked wallets hold ' + coin + ' yet · tap a candle to see its wallets' });
    const list = visibleClusters(cl, this.inputs);
    try { window.__stkHlIntel = { coin, liq: cl.liq.length, stops: cl.stops.length, drawn: list.length, cov: cl.coverage.oiPct }; } catch (x) {}
    this.push({ coin, list, cl, I: this.inputs, sel: s });
  }
}

function layer() {
  let canvas = null, chip = null, chipKey = '';
  function setChip(text, parent) {
    if (text === chipKey) return;
    chipKey = text;
    if (!text) { if (chip) chip.hidden = true; return; }
    if (!chip) { chip = document.createElement('div'); chip.className = 'stk-wi-chip'; parent.appendChild(chip); }
    chip.hidden = false; chip.textContent = text;
  }
  return {
    mount(c) { canvas = c; c.dataset.stkWi = '1'; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d'), co = a.coords, dpr = co.dpr || 1, d = a.data;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const boxes = []; hits.set(canvas, { boxes, a, coin: d && d.coin });
      if (!d) { if (LH()) LH().sync(null); return setChip('', canvas.parentElement); }
      if (d.note) { if (LH()) LH().sync(null); return setChip(d.note, canvas.parentElement); }
      const W = co.width, top = a.bounds.top, H = a.bounds.height, bot = top + H, day = light(), I = d.I;
      const cov = d.cl && d.cl.coverage && isNum(d.cl.coverage.oiPct) ? ' · tracked ≈ ' + Math.round(d.cl.coverage.oiPct) + '% of OI' : '';
      g.save(); g.beginPath(); g.rect(0, top, W, H); g.clip();
      if (LH()) LH().sync(canvas.parentElement, a, d, g);
      // selected candle: an outline around its high-low
      if (d.sel && a.bars && a.bars.length) {
        const i = barAt(a.bars, d.sel, barMs(a.bars));
        if (i >= 0) {
          const b = a.bars[i], x = co.timeToX(b.time), yh = co.priceToY(b.high, a.scale, a.bounds), yl = co.priceToY(b.low, a.scale, a.bounds);
          const bw = Math.max(6, (co.barSpacing || 8) * 0.9);
          g.lineWidth = 1.5; g.strokeStyle = day ? '#1d1d1f' : '#ffffff'; g.globalAlpha = 0.9; g.beginPath();
          if (g.roundRect) g.roundRect(x - bw / 2 - 3, yh - 4, bw + 6, yl - yh + 8, 4); else g.rect(x - bw / 2 - 3, yh - 4, bw + 6, yl - yh + 8);
          g.stroke(); g.globalAlpha = 1;
        }
      }
      const font = (w, s) => w + ' ' + s + 'px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif';
      // stop clusters: bars from the price axis, length = notional against the biggest
      // sizes scale against the clusters IN VIEW (one $100M bucket far away would otherwise shrink every bubble to a dot)
      const inY = (c) => { const y = co.priceToY(c.px, a.scale, a.bounds); return isNum(y) && y >= top - 4 && y <= bot + 4; };
      const stops = d.list.filter((c) => c.kind === 'stop' && inY(c)), liq = d.list.filter((c) => c.kind === 'liq' && inY(c));
      const sMax = stops.reduce((m, c) => Math.max(m, c.ntl), 1), barMax = Math.min(140, W * 0.16);
      for (const c of stops) {
        const y = co.priceToY(c.px, a.scale, a.bounds); if (!isNum(y) || y < top - 4 || y > bot + 4) continue;
        const len = Math.max(6, barMax * Math.sqrt(c.ntl / sMax)), h = 4;
        g.globalAlpha = 0.85; g.fillStyle = I.stopColor; g.beginPath();
        if (g.roundRect) g.roundRect(W - len, y - h / 2, len, h, 2); else g.rect(W - len, y - h / 2, len, h);
        g.fill(); g.globalAlpha = 1;
        // a small diamond marks the trigger price
        g.beginPath(); g.moveTo(W - len - 5, y); g.lineTo(W - len, y - 4); g.lineTo(W - len + 5, y); g.lineTo(W - len, y + 4); g.closePath(); g.fill();
        boxes.push({ x0: W - len - 8, x1: W, y0: y - 10, y1: y + 10, c });
      }
      // liquidation clusters: bubbles in a column left of the stop bars, size = notional
      const lMax = liq.reduce((m, c) => Math.max(m, c.ntl), 1), rMax = W < 520 ? 14 : 20, cx = W - barMax - rMax - 16;
      const placed = [];
      for (const c of liq.slice().sort((p, q) => p.ntl - q.ntl)) {
        const y = co.priceToY(c.px, a.scale, a.bounds); if (!isNum(y) || y < top - rMax || y > bot + rMax) continue;
        const r = radius(c.ntl, lMax, rMax), col = c.side > 0 ? I.longColor : I.shortColor;
        g.beginPath(); g.arc(cx, y, r, 0, Math.PI * 2); g.globalAlpha = 0.35; g.fillStyle = col; g.fill();
        g.globalAlpha = 0.95; g.lineWidth = 1.5; g.strokeStyle = col; g.stroke(); g.globalAlpha = 1;
        boxes.push({ x0: cx - Math.max(r, 12), x1: cx + Math.max(r, 12), y0: y - Math.max(r, 12), y1: y + Math.max(r, 12), c, r, cx, cy: y });
        placed.push({ y, r, c });
      }
      // $ labels on the biggest bubbles that fit
      g.font = font(600, 11); g.textBaseline = 'middle'; const taken = [];
      for (const pl of placed.sort((p, q) => q.c.ntl - p.c.ntl)) {
        const txt = usd(pl.c.ntl), w = g.measureText(txt).width + 8, lx = cx - pl.r - 6 - w, ly = pl.y - 8;
        if (lx < 4 || taken.some((b) => ly < b + 16 && ly + 16 > b) || taken.length >= (W < 520 ? 4 : 10)) continue;
        taken.push(ly);
        g.globalAlpha = 0.92; g.fillStyle = day ? '#ffffff' : '#131316'; g.beginPath(); if (g.roundRect) g.roundRect(lx, ly, w, 16, 4); else g.rect(lx, ly, w, 16); g.fill(); g.globalAlpha = 1;
        g.fillStyle = day ? '#1d1d1f' : 'rgba(255,255,255,.92)'; g.fillText(txt, lx + 4, pl.y + 0.5);
      }
      g.restore();
      // chip: clusters in view vs all (the price axis follows the candles, so far clusters only show when zoomed out)
      const inView = boxes.length, all = d.list.length;
      setChip(d.chip || ((all ? 'Wallet Intel: ' + (inView === all ? all + ' cluster' + (all === 1 ? '' : 's') : inView + ' of ' + all + ' clusters in view') : 'Wallet Intel: tap a candle to see its wallets') + cov + (d.cl && d.cl.t ? ' · ' + agoText(d.cl.t) : '')), canvas.parentElement);
    },
    destroy() { if (chip) chip.remove(); chip = null; canvas = null; }
  };
}

// ---- pointer: hover card on clusters (mouse), tap a cluster -> its wallets, tap a candle -> its wallets ----------------
let tip = null;
// test hook: (time, price) -> page coords on the first Wallet Intel canvas (tools/tests/chart-wallet-intel-browser.js)
export function _xy(t, price) {
  const cv = document.querySelector('canvas[data-stk-wi]'), h = cv && hits.get(cv); if (!h || !h.a) return null;
  const r = cv.getBoundingClientRect(), co = h.a.coords;
  return { x: r.left + co.timeToX(t), y: r.top + co.priceToY(price, h.a.scale, h.a.bounds), boxes: h.boxes.map((b) => ({ x: r.left + (b.x0 + b.x1) / 2, y: r.top + (b.y0 + b.y1) / 2, kind: b.c.kind, px: b.c.px, ntl: b.c.ntl })) };
}
function hitAt(e) {
  for (const cv of document.querySelectorAll('canvas[data-stk-wi]')) {
    const h = hits.get(cv); if (!h || !h.a) continue;
    if (e.target && e.target.closest && e.target.closest('.stkhll-fab')) return null;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) continue;
    let best = null;
    for (const b of h.boxes) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && (!best || b.c.ntl > best.c.ntl)) best = b;
    return { cv, h, x, y, r, box: best };
  }
  return null;
}
function clusterTitle(c) {
  if (c.title) return c.title + ' ' + fmtPx(c.lo) + '–' + fmtPx(c.hi);   // ladder rows (chart-hl-ladders.js)
  return (c.kind === 'liq' ? (c.side > 0 ? 'Long liquidations ' : 'Short liquidations ') : (c.side > 0 ? 'Buy triggers ' : 'Sell triggers ')) + fmtPx(c.lo) + '–' + fmtPx(c.hi);
}
function showTip(hit) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'stk-wi-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
  const c = hit.box.c;
  tip.textContent = '';
  const h = document.createElement('b'); h.textContent = clusterTitle(c); tip.appendChild(h);
  const s = document.createElement('span'); s.textContent = usd(c.ntl) + ' · ' + c.n + (c.kind === 'liq' ? ' tracked position' : ' tracked order') + (c.n === 1 ? '' : 's') + ' · click for wallets'; tip.appendChild(s);
  tip.hidden = false;
  const left = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, hit.r.left + hit.x - tip.offsetWidth - 16));
  tip.style.left = left + 'px'; tip.style.top = Math.max(8, hit.r.top + hit.y - tip.offsetHeight / 2) + 'px';
}
const hideTip = () => { if (tip) tip.hidden = true; };
let down = null;
function onMove(e) {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
  if (e.pointerType === 'touch') return;
  const h = hitAt(e); if (!h || !h.box) return hideTip();
  showTip(h);
}
function onDown(e) {
  if (e.button > 0) { down = null; return; }
  const h = hitAt(e); down = h ? { x: e.clientX, y: e.clientY, t: Date.now(), moved: false } : null;
}
// the browser's click lands on the sheet that just opened under the finger (ghost tap): swallow that one click
function eatClick() {
  const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); off(); }, off = () => document.removeEventListener('click', eat, true);
  document.addEventListener('click', eat, true); setTimeout(off, 500);
}
function onUp(e) {
  const d = down; down = null;
  if (!d || d.moved || Date.now() - d.t > 600 || !window.__stkWalletIntel) return;
  const h = hitAt(e); if (!h || !h.h.coin) return;
  if (h.box) { eatClick(); hideTip(); window.__stkWalletIntel.openCluster(h.h.coin, h.box.c); return; }
  const a = h.h.a, co = a.coords, bars = a.bars || [];
  let v0 = 0, v1 = bars.length - 1;
  try { const vr = co.visibleLogicalRange(); v0 = Math.max(0, Math.floor(vr.from)); v1 = Math.min(bars.length - 1, Math.ceil(vr.to)); } catch (x) {}
  if (v1 < v0) return;
  const xs = [], ys = [];
  for (let i = v0; i <= v1; i++) { xs.push(co.timeToX(bars[i].time)); ys.push([co.priceToY(bars[i].high, a.scale, a.bounds), co.priceToY(bars[i].low, a.scale, a.bounds)]); }
  const k = candleHit(bars, xs, ys, h.x, h.y, e.pointerType === 'touch' ? 14 : 6);
  if (k < 0) return;
  const b = bars[v0 + k];
  eatClick();
  window.__stkWalletIntel.openCandle(h.h.coin, b.time, b.time + barMs(bars), b);
}

// ---- panel (beside the chart; phones: bottom sheet) ------------------------------------------------------------------
const svg = (d, s) => '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const IC_X = svg('<path d="M6 6l12 12M18 6L6 18"/>'), IC_BACK = svg('<path d="M15 18l-6-6 6-6"/>'), IC_COPY = svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 18), IC_EXT = svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 18), IC_CHEV = svg('<path d="M9 6l6 6-6 6"/>', 16);
const fmtTime = (t) => { try { return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t)); } catch (e) { return new Date(t).toISOString().slice(11, 16); } };
const fmtDay = (t) => { try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(t)); } catch (e) { return ''; } };
const tfText = (ms) => (ms >= 86400e3 ? Math.round(ms / 86400e3) + 'D' : ms >= 3600e3 ? Math.round(ms / 3600e3) + 'h' : Math.round(ms / 60000) + 'm');

export function mountWalletIntel(ws) {
  if (!ws || document.getElementById('stkwi')) return null;
  const host = document.querySelector('.stkchart-panel.stkw-host') || document.querySelector('.stkchart-panel');
  if (!host) return null;
  const isPhone = () => window.innerWidth <= 700;
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const panel = el('aside', 'stkwi'); panel.id = 'stkwi'; panel.hidden = true; panel.setAttribute('aria-label', 'Wallet Intel');
  panel.innerHTML = '<div class="stkwi-grab" aria-hidden="true"></div><div class="stkwi-hd"><button type="button" class="stkwi-ib stkwi-back" aria-label="Back" hidden>' + IC_BACK + '</button><div class="stkwi-ttl"><span class="stkwi-title">Wallet Intel</span><span class="stkwi-sub"></span></div><button type="button" class="stkwi-ib stkwi-x" aria-label="Close Wallet Intel">' + IC_X + '</button></div>' +
    '<div class="stkwi-body" aria-live="polite"></div><p class="stkwi-foot"><span class="stkwi-cov"></span> Education only. Not financial advice.</p>';
  host.appendChild(panel);
  const $ = (s) => panel.querySelector(s), body = $('.stkwi-body'), back = $('.stkwi-back');
  let open = false, view = null, stack = [], filter = 'all';
  const labels = () => inputsNow.labels !== false;
  const note = (text) => { const p = el('p', 'stkwi-note', text); body.appendChild(p); return p; };
  function head(title, sub) { $('.stkwi-title').textContent = title; $('.stkwi-sub').textContent = sub || ''; back.hidden = !stack.length; }
  function footCov(coin) {
    const e = coin && cached(P.clusters(coin)), cl = e && normClusters(e.j), ct = cl && coverageText(cl.coverage);
    const cov = ct ? 'Liquidations, stops and book orders: ' + ct + (cl.t ? ', ' + agoText(cl.t) : '') + '. Candle wallets cover every trade.' : 'Liquidations, stops and book orders cover tracked wallets only. Candle wallets cover every trade.';
    $('.stkwi-cov').textContent = cov;
  }
  const chips = (w) => { const f = document.createDocumentFragment(); if (labels()) w.tags.forEach((t) => f.appendChild(el('span', 'stkwi-tag', TAG_TEXT[t]))); return f; };
  function walletRow(w, line2, right1, right2, sideCls) {
    const b = el('button', 'stkwi-row'); b.type = 'button'; b.setAttribute('role', 'listitem');
    const l = el('span', 'stkwi-l'), n = el('span', 'stkwi-name'); n.appendChild(el('span', 'stkwi-nm', labelOf(w, labels()))); n.appendChild(chips(w)); l.appendChild(n);
    const s2 = el('span', 'stkwi-l2' + (sideCls ? ' ' + sideCls : ''), line2); l.appendChild(s2);
    const r = el('span', 'stkwi-r'); r.appendChild(el('span', 'stkwi-r1', right1)); r.appendChild(el('span', 'stkwi-l2', right2));
    b.append(l, r); b.insertAdjacentHTML('beforeend', '<span class="stkwi-chev">' + IC_CHEV + '</span>');
    b.setAttribute('aria-label', labelOf(w, labels()) + ', ' + line2 + ', ' + right1 + ' ' + right2 + '. Open wallet');
    b.addEventListener('click', () => go({ kind: 'wallet', a: w.a, coin: view && view.coin }));
    return b;
  }
  function stat(k, v, cls) { const d = el('div', 'stkwi-stat'); d.appendChild(el('span', '', k)); d.appendChild(el('b', cls || '', v)); return d; }
  function load2(path, ttl) { const e = cached(path); if (!e || (e.j === undefined && !e.err)) { load(path, ttl); return { loading: true }; } if (e.j === undefined || (e.err && e.j == null)) { load(path, ttl); return { err: e.err }; } load(path, ttl); return { j: e.j }; }
  const errText = (c) => (c === 'busy' ? 'Too many requests from this network. Try again in a minute.' : c === 'bad' ? 'This range cannot be looked up.' : 'Wallet data is not available right now. Try again in a minute.');

  function renderCandle(v) {
    const ms = v.to - v.from;
    head(v.coin + ' · ' + tfText(ms) + ' candle', fmtDay(v.from) + ', ' + fmtTime(v.from) + '–' + fmtTime(v.to));
    if (Date.now() - v.to > KEEP_MS) return note('Wallet data is kept for 7 days. Pick a more recent candle.');
    const closed = v.to < Date.now() - 120000, r = load2(P.candle(v.coin, v.from, v.to), closed ? 0 : 30000);
    if (r.loading) return note('Loading…');
    if (r.err) return note(errText(r.err));
    const c = normCandle(r.j);
    if (!c) return note('Wallet data is not available right now. Try again in a minute.');
    // the server holds data from when its collector started (held) to the last whole minute (updated)
    if (!c.list.length) return note(c.partial && (!c.held || v.to <= c.held) ? 'No wallet data for this candle: wallet data starts ' + (c.held ? fmtDay(c.held) + ', ' + fmtTime(c.held) : 'when collection starts') + '.' : 'No trades recorded for this candle.');
    if (c.partial) note('Part of this candle is outside the data we hold' + (c.held ? ' (from ' + fmtDay(c.held) + ', ' + fmtTime(c.held) + ')' : '') + ', so the totals cover part of it.').classList.add('is-warn');
    const g = el('div', 'stkwi-grid');
    g.append(stat('Volume', usd(c.ntl)), stat('Trades', isNum(c.trades) ? c.trades.toLocaleString('en-US') : '—'), stat('Wallets', isNum(c.wallets) ? c.wallets.toLocaleString('en-US') + (c.truncated ? '+' : '') : '—'), stat('Avg price', fmtPx(c.sz > 0 ? c.ntl / c.sz : NaN)));
    body.appendChild(g);
    // taker split: the side that crossed the spread (every fill has a taker)
    const bN = c.takerBuyNtl || 0, sN = c.takerSellNtl || 0, tot = bN + sN, pb = tot > 0 ? bN / tot : 0.5;
    const split = el('div', 'stkwi-split'); split.setAttribute('aria-label', 'Market buys ' + Math.round(pb * 100) + '%, market sells ' + Math.round((1 - pb) * 100) + '%');
    split.innerHTML = '<div class="stkwi-splitl"><span class="up"></span><span class="dn"></span></div><div class="stkwi-bar"><i style="width:' + (pb * 100).toFixed(1) + '%"></i></div>';
    split.querySelector('.up').textContent = 'Market buys ' + usd(bN) + ' · ' + Math.round(pb * 100) + '%';
    split.querySelector('.dn').textContent = Math.round((1 - pb) * 100) + '% · ' + usd(sN) + ' market sells';
    body.appendChild(split);
    const seg = el('div', 'stkwi-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Show wallets');
    [['all', 'All'], ['buy', 'Net buyers'], ['sell', 'Net sellers']].forEach(([k, t]) => { const b = el('button', '', t); b.type = 'button'; b.setAttribute('aria-pressed', String(filter === k)); b.addEventListener('click', () => { filter = k; render(); }); seg.appendChild(b); });
    body.appendChild(seg);
    const list = el('div', 'stkwi-list'); list.setAttribute('role', 'list');
    const ws2 = c.list.filter((w) => filter === 'all' || (filter === 'buy' ? w.side > 0 : w.side < 0)).slice(0, 50);
    for (const w of ws2) {
      const parts = []; if (w.buySz) parts.push('Bought ' + fmtSz(w.buySz) + ' at ' + fmtPx(w.buyPx)); if (w.sellSz) parts.push('Sold ' + fmtSz(w.sellSz) + ' at ' + fmtPx(w.sellPx));
      list.appendChild(walletRow(w, parts.join(' · '), usd(w.ntl), isNum(w.pct) ? (w.pct < 10 ? w.pct.toFixed(1) : Math.round(w.pct)) + '% of volume' : '', w.side > 0 ? 'up' : 'dn'));
    }
    if (!ws2.length) list.appendChild(el('p', 'stkwi-note', 'No wallets on this side.'));
    body.appendChild(list);
    if (c.others && c.others.ntl > 0 && filter === 'all') body.appendChild(el('p', 'stkwi-sum', 'Smaller wallets together: ' + usd(c.others.ntl) + '.'));
    const k = el('p', 'stkwi-key', 'Every trade names its buyer and seller, so this covers every wallet in the candle. % of volume = the wallet\'s buys plus sells against the candle volume; each trade has two sides, so the shares add up to 200%.' + (c.updated ? ' Wallet data ' + agoText(c.updated) + '.' : ''));
    body.appendChild(k);
  }
  function renderCluster(v) {
    const c = v.c;
    head(clusterTitle(c), usd(c.ntl) + ' · ' + c.n + (c.kind === 'liq' ? ' tracked position' : ' tracked order') + (c.n === 1 ? '' : 's'));
    if (!c.wallets.length) return note('No wallet detail for this cluster.');
    const list = el('div', 'stkwi-list'); list.setAttribute('role', 'list');
    for (const w of c.wallets.slice(0, 50)) {
      const l2 = c.kind === 'liq' ? (w.side > 0 ? 'Long' : 'Short') + (isNum(w.lev) ? ' ' + w.lev + 'x' : '') + ' · liq ' + fmtPx(w.px)
        : (w.side > 0 ? 'Buy ' : 'Sell ') + fmtSz(w.sz) + ' at ' + fmtPx(w.px) + (w.kind ? ' · ' + w.kind : '');
      list.appendChild(walletRow(w, l2, usd(w.ntl), c.ntl > 0 && isNum(w.ntl) ? Math.round(w.ntl / c.ntl * 100) + '% of cluster' : '', w.side > 0 ? 'up' : 'dn'));
    }
    body.appendChild(list);
    if (c.cut) body.appendChild(el('p', 'stkwi-sum', 'Showing the ' + Math.min(50, c.wallets.length) + ' biggest of ' + c.n + '.'));
    body.appendChild(el('p', 'stkwi-key', c.kind === 'liq' ? 'Liquidation prices of tracked wallets\' open positions, grouped by price. They move as prices, margin and positions change.' : 'Stop-loss and take-profit trigger orders of tracked wallets, grouped by price. A trigger turns into an order when the price reaches it.'));
  }
  function renderLevel(v) {
    head(v.coin + ' orders at ' + fmtPx(v.px), v.bookSz ? 'Book size ' + fmtSz(v.bookSz) + ' ' + v.coin : 'Tracked wallets');
    const b = levelBand(v.px, v.step), r = load2(P.level(v.coin, b.lo, b.hi), 30000);
    if (r.loading) return note('Loading…');
    if (r.err) return note(errText(r.err));
    if (r.j === null) return note('No tracked wallet data for ' + v.coin + ' yet.');
    const L = normLevel(r.j, v.px, v.step);
    if (!L) return note('Wallet data is not available right now. Try again in a minute.');
    if (L.t) $('.stkwi-sub').textContent += ' · orders ' + agoText(L.t);
    if (!L.orders.length) return note('No tracked wallet has an order at this price. The book also holds orders of wallets we do not track' + (isNum(L.bookPct) ? ' (tracked wallets hold about ' + Math.round(L.bookPct) + '% of the ' + v.coin + ' book)' : '') + '.');
    if (v.bookSz > 0) body.appendChild(el('p', 'stkwi-sum', 'Tracked wallets: ' + fmtSz(L.trackedSz) + ' ' + v.coin + ' of ' + fmtSz(v.bookSz) + ' at this level (' + Math.min(100, Math.round(L.trackedSz / v.bookSz * 100)) + '%).'));
    const list = el('div', 'stkwi-list'); list.setAttribute('role', 'list');
    for (const w of L.orders.slice(0, 50)) list.appendChild(walletRow(w, (w.side > 0 ? 'Bid ' : 'Ask ') + fmtSz(w.sz) + ' at ' + fmtPx(w.px), usd(w.ntl), '', w.side > 0 ? 'up' : 'dn'));
    body.appendChild(list);
    body.appendChild(el('p', 'stkwi-key', 'Resting limit orders of tracked wallets, read every few minutes, so an order may have moved since.'));
  }
  function renderWallet(v) {
    const r = load2(P.wallet(v.a), 60000);
    head(shortAddr(v.a), 'Wallet');
    if (r.loading) return note('Loading…');
    if (r.err) return note(errText(r.err));
    const w = normWallet(r.j);
    if (!w) return note('No data for this wallet.');
    head(labels() && w.label ? w.label : shortAddr(w.a), agoText(w.t) ? 'Wallet · ' + agoText(w.t) : 'Wallet');
    const card = el('div', 'stkwi-wal');
    const tg = el('div', 'stkwi-tags'); w.tags.forEach((t) => tg.appendChild(el('span', 'stkwi-tag', TAG_TEXT[t]))); if (labels() && w.tags.length) card.appendChild(tg);
    const ad = el('div', 'stkwi-addr'); ad.appendChild(el('code', '', w.a));
    const cp = el('button', 'stkwi-ib stkwi-copy'); cp.type = 'button'; cp.innerHTML = IC_COPY; cp.setAttribute('aria-label', 'Copy address');
    cp.addEventListener('click', async () => { let ok = false; try { await navigator.clipboard.writeText(w.a); ok = true; } catch (e) {} if (window.showToast) window.showToast(ok ? 'Address copied' : 'Could not copy', ok ? 'success' : 'error'); cp.setAttribute('aria-label', ok ? 'Address copied' : 'Copy address'); });
    const ex = el('a', 'stkwi-ib stkwi-ext'); ex.href = EXPLORER(w.a); ex.target = '_blank'; ex.rel = 'noopener noreferrer'; ex.innerHTML = IC_EXT; ex.setAttribute('aria-label', 'Open in the public explorer'); ex.title = 'Open in the public explorer';
    ad.append(cp, ex); card.appendChild(ad);
    const g = el('div', 'stkwi-grid'); g.append(stat('Account value', usd(w.av)), stat('30-day volume', usd(w.vol30)));
    if (w.tracked) g.append(stat('Open positions', String(w.positions.length)), stat('Resting orders', (w.nLim + w.trig).toLocaleString('en-US')));
    card.appendChild(g); body.appendChild(card);
    body.appendChild(el('h3', 'stkwi-h', 'Open positions'));
    if (!w.tracked) note('We do not track this wallet, so its positions are not known here. The explorer link shows them.');
    else if (!w.positions.length) note('No open positions.');
    else {
      const list = el('div', 'stkwi-list stkwi-pos'); list.setAttribute('role', 'list');
      for (const p of w.positions.slice(0, 30)) {
        const row = el('div', 'stkwi-row is-static'); row.setAttribute('role', 'listitem');
        const l = el('span', 'stkwi-l'); const n = el('span', 'stkwi-name'); n.appendChild(el('span', 'stkwi-nm', p.coin)); n.appendChild(el('span', 'stkwi-side ' + (p.side > 0 ? 'up' : 'dn'), (p.side > 0 ? 'Long' : 'Short') + (isNum(p.lev) ? ' ' + p.lev + 'x' : ''))); l.appendChild(n);
        l.appendChild(el('span', 'stkwi-l2', fmtSz(p.sz) + ' ' + p.coin + ' · entry ' + fmtPx(p.entryPx) + ' · liq ' + (isNum(p.liqPx) ? fmtPx(p.liqPx) : 'none')));
        const rr = el('span', 'stkwi-r'); rr.appendChild(el('span', 'stkwi-r1', usd(p.ntl))); rr.appendChild(el('span', 'stkwi-l2', p.mode === 'isolated' ? 'Isolated' : p.mode === 'cross' ? 'Cross' : ''));
        row.append(l, rr); list.appendChild(row);
      }
      body.appendChild(list);
    }
    body.appendChild(el('h3', 'stkwi-h', 'Large fills, last 24 h'));
    if (!w.fills.length) note('No fills of $100K or more seen in the last 24 hours.');
    else {
      const list = el('div', 'stkwi-list'); list.setAttribute('role', 'list');
      for (const f of w.fills.slice(0, 20)) {
        const row = el('div', 'stkwi-row is-static'); row.setAttribute('role', 'listitem');
        const l = el('span', 'stkwi-l'); const n = el('span', 'stkwi-name'); n.appendChild(el('span', 'stkwi-nm', f.coin)); n.appendChild(el('span', 'stkwi-side ' + (f.side > 0 ? 'up' : 'dn'), f.side > 0 ? 'Bought' : 'Sold')); l.appendChild(n);
        l.appendChild(el('span', 'stkwi-l2', fmtDay(f.t) + ', ' + fmtTime(f.t) + ' · ' + fmtSz(f.sz) + ' at ' + fmtPx(f.px)));
        const rr = el('span', 'stkwi-r'); rr.appendChild(el('span', 'stkwi-r1', usd(f.ntl))); row.append(l, rr); list.appendChild(row);
      }
      body.appendChild(list);
    }
  }
  function render() {
    if (!open || !view) return;
    const st = body.scrollTop; body.textContent = '';
    if (view.kind === 'candle') renderCandle(view); else if (view.kind === 'cluster') renderCluster(view); else if (view.kind === 'level') renderLevel(view); else renderWallet(view);
    footCov(view.coin || coinOf(activeSym()));
    body.scrollTop = st;
  }
  const activeSym = () => { try { return ws.active.symbol; } catch (e) { return ''; } };
  function closeOthers() {
    if (host.classList.contains('stkw-open')) { const b = document.querySelector('.stkw .stkw-close'); if (b) b.click(); }
    if (host.classList.contains('stknw-open') && window.__stkNews) window.__stkNews.close();
    if (window.__stkDarkPool && window.__stkDarkPool.isOpen) window.__stkDarkPool.close();
    if (window.__stkSymInfo && window.__stkSymInfo.isOpen) window.__stkSymInfo.close();
  }
  function setOpen(v) {
    const was = open; open = !!v;
    if (open && !was && !document.getElementById('stkbp')?.offsetParent) closeOthers();
    panel.hidden = !open;
    host.classList.toggle('stkwi-open', open && !bookOpen());
    document.documentElement.classList.toggle('stkwi-sheet', open && isPhone());
    if (!open) { stack = []; view = null; if (sel) { sel = null; natives.forEach((n) => n.refresh()); } }
    if (open !== was) requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }
  // the book panel sits where this panel sits: when the book is open we float over it instead of pushing the chart again
  const bookOpen = () => { const b = document.getElementById('stkbp'), l = document.getElementById('stkhll'); return !!((b && !b.hidden || l && !l.hidden) && !isPhone()); };
  function go(v, replace) {
    if (view && !replace) stack.push(view);
    if (replace) stack = [];
    view = v; filter = v.kind === 'candle' ? filter : filter;
    setOpen(true); body.scrollTop = 0; render();
    const L = document.getElementById('stkhll'), b2 = document.getElementById('stkbp');
    panel.classList.toggle('over-hll', !!(L && !L.hidden && !isPhone()));
    panel.classList.toggle('over-book', !!(b2 && !b2.hidden && !isPhone()) && !panel.classList.contains('over-hll'));
  }
  back.addEventListener('click', () => { if (!stack.length) return; view = stack.pop(); body.scrollTop = 0; render(); });
  $('.stkwi-x').addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setOpen(false); });
  window.addEventListener('resize', () => document.documentElement.classList.toggle('stkwi-sheet', open && isPhone()), { passive: true });
  onData((path) => { if (open && view && path.startsWith('/hl-')) render(); });
  try { ws.on('state:changed', () => { if (open && view && view.coin && view.coin !== coinOf(activeSym()) && view.kind !== 'wallet') setOpen(false); }); } catch (e) {}
  const api = {
    openCandle(coin, from, to) { sel = { coin, t: from }; natives.forEach((n) => n.refresh()); filter = 'all'; go({ kind: 'candle', coin, from, to }, true); },
    openCluster(coin, c) { go({ kind: 'cluster', coin, c }, true); },
    // from the book panel: price level (+ grouping step and the book size there, when known)
    openLevel(coin, px, step, bookSz) {
      if (!coin) { if (window.showToast) window.showToast(NOT_HL, 'info'); return; }
      go({ kind: 'level', coin, px, step: step || 0, bookSz: bookSz || 0 }, true);
    },
    openWallet(a, coin) { go({ kind: 'wallet', a: String(a).toLowerCase(), coin }, true); },
    close: () => setOpen(false), rerender: () => render(),
    get isOpen() { return open; }, get view() { return view; }, _xy
  };
  window.__stkWalletIntel = api;
  import('./chart-hl-ladders.js?v=950').then((m) => m.mountLadders(ws, host)).catch((e) => console.warn('TradeZoro: ladders', e));
  return api;
}

const CSS = `
.stk-wi-chip{ position:absolute; bottom:8px; left:50%; transform:translateX(-50%); z-index:6; pointer-events:none; max-width:90%; padding:4px 12px; border-radius:999px;
  font:400 11px/13px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  background:#131316; color:rgba(255,255,255,.64); border:1px solid rgba(255,255,255,.08); }
.stk-wi-chip[hidden], .stk-wi-tip[hidden]{ display:none; }
.stk-wi-tip{ position:fixed; z-index:9050; pointer-events:none; max-width:min(280px, calc(100vw - 16px)); padding:8px 12px; border-radius:12px; background:#131316; color:rgba(255,255,255,.92);
  border:1px solid rgba(255,255,255,.08); font:400 12px/16px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; font-variant-numeric:tabular-nums; box-shadow:0 8px 24px rgba(0,0,0,.4); display:flex; flex-direction:column; gap:2px; }
.stk-wi-tip b{ font-weight:600; font-size:13px; line-height:18px; }
.stk-wi-tip span{ color:rgba(255,255,255,.64); }
:root[data-theme="light"] .stk-wi-tip, :root[data-theme="light"] .stk-wi-chip{ background:#fff; color:#1d1d1f; border-color:rgba(0,0,0,.12); }
:root[data-theme="light"] .stk-wi-tip span, :root[data-theme="light"] .stk-wi-chip{ color:#515154; }
.stkchart-panel.stkw-host.stkwi-open #vela-chart{ right:calc(var(--stkw-rail) + var(--stkw-w)); }
.stkwi{ --wi-up:#03c988; --wi-dn:#f23645; position:absolute; top:0; bottom:0; right:var(--stkw-rail, 44px); width:var(--stkw-w, 340px); z-index:31; display:flex; flex-direction:column; min-width:0; background:var(--bg-0);
  border-left:1px solid var(--line-soft); font:400 13px/18px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; color:var(--ink-0); font-variant-numeric:tabular-nums; }
:root[data-theme="light"] .stkwi{ --wi-up:#047857; --wi-dn:#c81e2e; }
.stkwi[hidden]{ display:none; }
.stkwi.over-book{ right:calc(var(--stkw-rail, 44px) + var(--stkbp-w, 400px)); box-shadow:-8px 0 24px rgba(0,0,0,.35); }
.stkwi.over-hll{ right:calc(var(--stkw-rail, 44px) + var(--stkhll-w, 372px)); box-shadow:-8px 0 24px rgba(0,0,0,.35); }
.stkwi-grab{ display:none; }
.stkwi-hd{ flex:none; display:flex; align-items:center; gap:4px; min-height:56px; padding:4px 4px 4px 12px; border-bottom:1px solid var(--line-soft); }
.stkwi-back:not([hidden]) + .stkwi-ttl{ margin-left:-4px; }
.stkwi-hd .stkwi-back{ margin-left:-8px; }
.stkwi-ttl{ flex:1; min-width:0; display:flex; flex-direction:column; }
.stkwi-title{ font-size:15px; line-height:20px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkwi-sub{ font-size:12px; line-height:16px; color:var(--ink-2); }
.stkwi-sub:empty{ display:none; }
.stkwi-ib{ flex:none; display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; padding:0; border:0; border-radius:50%; background:transparent; color:var(--ink-1, var(--ink-0)); cursor:pointer; text-decoration:none; }
.stkwi-ib[hidden]{ display:none; }
.stkwi-ib:hover{ background:var(--bg-2); color:var(--ink-0); }
.stkwi-ib:focus-visible, .stkwi-row:focus-visible, .stkwi-seg button:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stkwi-body{ flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:12px 0 8px; }
.stkwi-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:0 12px; }
.stkwi-stat{ display:flex; flex-direction:column; gap:2px; padding:8px 12px; border:1px solid var(--line-soft); border-radius:12px; background:var(--bg-1, transparent); min-width:0; }
.stkwi-stat span{ font-size:11px; line-height:13px; color:var(--ink-2); }
.stkwi-stat b{ font-size:15px; line-height:20px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkwi-split{ padding:12px 12px 4px; }
.stkwi-splitl{ display:flex; justify-content:space-between; gap:8px; font-size:12px; line-height:16px; }
.stkwi-splitl .up{ color:var(--wi-up); } .stkwi-splitl .dn{ color:var(--wi-dn); text-align:right; }
.stkwi-bar{ height:6px; margin-top:4px; border-radius:3px; background:var(--wi-dn); overflow:hidden; }
.stkwi-bar i{ display:block; height:100%; background:var(--wi-up); border-right:2px solid var(--bg-0); }
.stkwi-seg{ display:flex; margin:12px 12px 4px; padding:2px; border-radius:8px; background:var(--bg-2); }
.stkwi-seg button{ flex:1; min-width:0; min-height:32px; padding:0 4px; border:0; border-radius:6px; background:none; color:var(--ink-2); font:500 12px/16px inherit; font-family:inherit; cursor:pointer; white-space:nowrap; }
.stkwi-seg button[aria-pressed="true"]{ background:var(--bg-0); color:var(--ink-0); box-shadow:0 0 0 1px var(--line-soft); }
.stkwi-list{ display:flex; flex-direction:column; }
.stkwi-row{ display:flex; align-items:center; gap:8px; width:100%; min-height:52px; padding:8px 4px 8px 12px; border:0; border-bottom:1px solid var(--line-soft); background:none; color:var(--ink-0); font:inherit; text-align:left; cursor:pointer; }
.stkwi-row.is-static{ cursor:default; padding-right:12px; }
.stkwi-row:not(.is-static):hover{ background:var(--bg-2); }
.stkwi-l{ flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.stkwi-name{ display:flex; flex-wrap:wrap; align-items:center; gap:0 4px; min-width:0; overflow:hidden; max-height:20px; }
.stkwi-nm{ flex:none; max-width:100%; font-size:13px; line-height:18px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkwi-l2{ font-size:12px; line-height:16px; color:var(--ink-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkwi-l2.up, .stkwi-side.up{ color:var(--wi-up); } .stkwi-l2.dn, .stkwi-side.dn{ color:var(--wi-dn); }
.stkwi-side{ flex:none; font-size:11px; line-height:13px; font-weight:600; }
.stkwi-r{ flex:none; display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
.stkwi-r1{ font-size:13px; line-height:18px; font-weight:600; }
.stkwi-chev{ flex:none; display:inline-flex; color:var(--ink-3, var(--ink-2)); }
.stkwi-tag{ flex:none; white-space:nowrap; padding:0 6px; border-radius:999px; font-size:11px; line-height:16px; font-weight:500; color:var(--ink-1, var(--ink-0)); background:var(--bg-2); border:1px solid var(--line-soft); }
.stkwi-note{ margin:0; padding:16px 12px; color:var(--ink-2); font-size:13px; line-height:18px; }
.stkwi-note.is-warn{ margin:8px 12px 0; padding:8px 12px; border-radius:8px; background:var(--bg-2); font-size:12px; line-height:16px; }
.stkwi-key, .stkwi-sum{ margin:0; padding:8px 12px; font-size:12px; line-height:16px; color:var(--ink-2); }
.stkwi-sum{ padding-top:0; }
.stkwi-h{ margin:16px 0 0; padding:0 12px 8px; font-size:13px; line-height:18px; font-weight:600; color:var(--ink-0); border-bottom:1px solid var(--line-soft); }
.stkwi-wal{ display:flex; flex-direction:column; gap:8px; }
.stkwi-tags{ display:flex; flex-wrap:wrap; gap:4px; padding:0 12px; }
.stkwi-tags .stkwi-tag{ flex:none; }
.stkwi-addr{ display:flex; align-items:center; gap:4px; margin:0 12px; padding:0 0 0 12px; border:1px solid var(--line-soft); border-radius:12px; }
.stkwi-addr code{ flex:1; min-width:0; font:400 12px/16px ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--ink-1, var(--ink-0)); word-break:break-all; padding:8px 0; }
.stkwi-foot{ flex:none; margin:0; padding:8px 12px; border-top:1px solid var(--line-soft); font-size:11px; line-height:13px; color:var(--ink-2); }
@media (max-width:700px){
  .stkchart-panel.stkw-host.stkwi-open #vela-chart{ right:0; }
  .stkwi{ position:fixed; left:0; right:0; top:auto; bottom:var(--stkc-dock, 0px); width:auto; height:min(70vh, 600px); z-index:8010; border-left:0; border-top:1px solid var(--line-soft); border-radius:20px 20px 0 0; box-shadow:0 -8px 24px rgba(0,0,0,.35); font-size:14px; }
  .stkwi-grab{ display:block; flex:none; width:36px; height:4px; border-radius:2px; margin:8px auto 0; background:var(--line, rgba(255,255,255,.2)); }
  .stkwi-hd{ padding:0 8px 4px 16px; }
  .stkwi-x{ background:var(--bg-2); }
  .stkwi-grid, .stkwi-split, .stkwi-tags{ padding-left:16px; padding-right:16px; }
  .stkwi-seg{ margin-left:16px; margin-right:16px; } .stkwi-seg button{ min-height:36px; font-size:13px; }
  .stkwi-row{ padding-left:16px; } .stkwi-row.is-static{ padding-right:16px; }
  .stkwi-note, .stkwi-key, .stkwi-sum, .stkwi-h, .stkwi-foot{ padding-left:16px; padding-right:16px; }
  .stkwi-addr{ margin:0 16px; }
  .stkwi-foot{ padding-bottom:calc(8px + env(safe-area-inset-bottom)); }
}
`;

// ---- registration + persistence ---------------------------------------------------------------------------------------
let installed = false;
export function installWalletIntel(Core) {
  if (installed) return;
  installed = true;
  if (typeof window !== 'undefined') window.__stkRedrawWi = redraw;
  Core.registerRendererLayer({ id: WI_TYPE, placement: 'above-data', create: layer });
  Core.registerNativeIndicator({
    type: WI_TYPE, title: 'Wallet Intel', shortTitle: 'Wallet Intel', paneHint: 'price', overlay: true,
    inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new WiNative(), legendNote: (d) => (!d ? '' : d.note || '')
  });
  Core.registerStatePersistence({
    key: 'stryker.hlintel', scope: 'cell',
    serialize(ctx) {
      const out = [];
      try { ctx.chart.indicators().forEach((h) => { if (h.nativeType === WI_TYPE) out.push(h.inputValues()); }); } catch (e) {}
      return out.length ? out : undefined;
    },
    restore(payload, ctx) {
      if (!Array.isArray(payload)) return;
      let hs = [];
      try { hs = ctx.chart.indicators().filter((h) => h.nativeType === WI_TYPE); } catch (e) { return; }
      payload.slice(0, 2).forEach((vals, i) => {
        if (!hs[i] || !vals || typeof vals !== 'object') return;
        const clean = {};
        SCHEMA.forEach((s) => { const v = vals[s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
        try { hs[i].setInputs(clean); } catch (e) {}
      });
    }
  });
  if (typeof document !== 'undefined') {
    if (!document.getElementById('stk-wi-css')) { const st = document.createElement('style'); st.id = 'stk-wi-css'; st.textContent = CSS; document.head.appendChild(st); }
    document.addEventListener('pointermove', onMove, { passive: true, capture: true });
    document.addEventListener('pointerdown', onDown, { capture: true });
    document.addEventListener('pointerup', onUp, { capture: true });
  }
}
