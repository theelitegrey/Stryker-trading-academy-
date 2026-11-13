// TradeZoro — Charts: ORDER FLOW from InsightSentry tick trades (futures). Owner-approved 2026-10-14.
// Depends on: assets/chart-footprint-data.js (decode + maths), Vela's plugin SDK passed in as `Core`
// (registerChartType, registerRendererLayer, registerNativeIndicator), window.__stkReplay
// (assets/chart-bar-replay.js) and window.strykerPlanTier (assets/plan-limits.js).
//
// Data: GET <recorder>/orderflow?sym=NQ&day=YYYY-MM-DD (1-minute footprint bars built on our server
// from every trade with its aggressor side: workers/book-recorder/of-feeder). Re-aggregated here to
// the chart's timeframe and to coarser price rows by zoom.
//
// What it adds:
//   - Chart type "Footprint" (stk_fp, next to Candles): per bar sell x buy (bid x ask) volume at each
//     price, the POC, diagonal imbalances (300% default), stacked imbalances, unfinished-auction
//     marks, delta + volume under each bar. Modes: bid x ask, delta, volume. Zoomed out it falls
//     back to candles coloured by the bar's delta.
//   - Indicators, group "Order Flow": Delta (trades), Cumulative Delta (trades, candles or line,
//     session reset), Big Trades (bubbles), Volume Profile (trades) and VWAP (trades, +-1/2 SD).
// No lookahead: in bar replay every tool uses only the 1-minute bars complete at the replay clock.
// Gating: order flow is Pro (assets/chart-pro-gate.js); Pro and admins get all six roots and the full history.
// Simulation / education only: nothing here places or suggests an order.
// Education only. Not financial advice.

import { decodeOrderflow, gunzipBody, aggregate, clipTo, rows, poc, imbalances, stacked, unfinished, cvdCandles, profile, vwapSeries } from './chart-footprint-data.js?v=975';

import { liveOfOn, liveFlow, onLiveFlow, overlayLive, setLiveThr, compareMinutes, liveDeliveries } from './chart-live-of.js?v=975';
import { bigPrints, bigThreshold, swingSegments, pocRevisits } from './chart-of-pro-data.js?v=975';
import { installOfPro, PRO_TYPES } from './chart-of-pro.js?v=975';
import { installFpPatterns, FPAT_TYPES } from './chart-fp-patterns.js?v=975';
import { installChartTypes } from './chart-types.js?v=975';
import { rtHeadersReady } from './rt-access.js?v=975';
import { isCrypto, cryptoFeed, cryptoFeeds } from './chart-footprint-crypto.js?v=975';
import { installDeltaSuite, DS_TYPES } from './chart-delta-suite.js?v=975';
import * as BT from './chart-bigtrades.js?v=975';
import { installTsTrades, TS_TYPES } from './chart-ts-trades.js?v=975';
const RECORDER = 'https://book-recorder.theelitegrey.workers.dev';
const ROOTS = { NQ: 'NQ', MNQ: 'NQ', ES: 'ES', MES: 'ES', YM: 'YM', MYM: 'YM', GC: 'GC', MGC: 'GC', SI: 'SI', SIL: 'SI', CL: 'CL', MCL: 'CL' };
const FREE_ROOT = 'NQ';
const FREE_LOOKBACK_MS = 24 * 3600 * 1000;
const MAX_DAYS = 14;                 // UTC days fetched for one chart at most
const TODAY_REFRESH_MS = 300000;   // the whole day, now and then; the live tail is polled every TAIL_MS
const TAIL_MS = 5000;              // the last minutes of every root in use: forming + just-closed bars
const MAX_TF_MIN = 240;
export const FP_TYPE = 'stk_fp';
export const OF_GROUP = 'Order Flow';
const UP = '#03c988', UP2 = '#4fe3ac', DN = '#f23645', CYAN = '#00adb5';
// Order-flow drawing palette (Owner 2026-10-24: drawn like the desktop order-flow platforms): buyers
// green, sellers PURPLE, yellow POC box, magenta profile POC, orange value area.
const SELL = '#9d4dff', SELL2 = '#c9a2ff', POCY = '#f5d90a', MAG = '#e040fb', VA_OR = '#c8602a', VA_OUT = '#b8a84a', VA_LN = '#8fd8dc';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const DISCLAIMER = 'Order flow from exchange trades. Education only. Not financial advice.';

// ---------------------------------------------------------------- small helpers
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
function alpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
function tfMin(tf) {
  tf = String(tf || '');
  if (/^\d+$/.test(tf)) return +tf;
  const m = /^(\d+)([SDWM])$/i.exec(tf) || /^([DWM])$/i.exec(tf);
  if (!m) return null;
  const n = m.length === 3 ? +m[1] : 1, u = (m.length === 3 ? m[2] : m[1]).toUpperCase();
  return u === 'S' ? n / 60 : u === 'D' ? n * 1440 : u === 'W' ? n * 10080 : n * 43200;
}
function light() { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } }
function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return Math.round(v / 1e3) + 'K';
  if (Number.isInteger(v) || a >= 100) return String(Math.round(v));
  // crypto volumes are fractional (BTC, ETH...): keep ~3 significant digits
  return v === 0 ? '0' : a < 0.01 ? '<.01' : String(+v.toFixed(a >= 10 ? 1 : 2));
}
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '-' : '') + fmt(Math.abs(v));
// The CME session (18:00 New York -> 17:00) a time belongs to, keyed by the NY date it ends on.
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
const sessCache = new Map();
export function sessionOf(ms) {
  const h = Math.floor(ms / 3600000);
  let k = sessCache.get(h);
  if (k === undefined) {
    const p = {};
    nyFmt.formatToParts(new Date(h * 3600000 + 6 * 3600000)).forEach((x) => { p[x.type] = x.value; });
    k = p.year + '-' + p.month + '-' + p.day;
    if (sessCache.size > 20000) sessCache.clear();
    sessCache.set(h, k);
  }
  return k;
}
// The replay clock (ms) while bar replay is on, else null.
const replayE = () => (window.__stkReplay && window.__stkReplay.on ? window.__stkReplay.E : null);

// The chart's futures root mapped to our recorded mini (MNQ -> NQ), or null.
export function rootOf(ctx) {
  let provider = '', ticker = String(ctx.symbol || '');
  try { const r = ctx.data.resolve(ctx.symbol); if (r) { provider = r.provider; ticker = r.ticker; } } catch (e) {}
  if (!provider) { const m = /^([a-z]+):(.+)$/i.exec(ticker); if (m) { provider = m[1].toLowerCase(); ticker = m[2]; } }
  if (provider === 'binance') return 'binance:' + ticker.toUpperCase();   // crypto: Binance aggTrades (chart-footprint-crypto.js)
  if (isCrypto(provider + ':' + ticker)) return provider + ':' + ticker.toUpperCase();   // other venues: their adapter (orderflow-venues.js)
  if (provider !== 'futures') return null;
  const root = ticker.toUpperCase().replace(/[0-9]*!$/, '').replace(/[FGHJKMNQUVXZ]\d{2,4}$/, '');
  return ROOTS[root] || null;
}

// ---------------------------------------------------------------- plan tier
let tierP = null;
function tier() {
  if (tierP) return tierP;
  tierP = new Promise((resolve) => {
    const t = setTimeout(() => resolve({ free: false, unknown: true }), 6000);
    try {
      if (typeof window.strykerPlanTier !== 'function') { clearTimeout(t); resolve({ free: false, unknown: true }); return; }
      window.strykerPlanTier().then((r) => { clearTimeout(t); resolve(r || { free: false }); }, () => { clearTimeout(t); resolve({ free: false }); });
    } catch (e) { clearTimeout(t); resolve({ free: false }); }
  });
  return tierP;
}
let tierNow = null;
tier().then((r) => { tierNow = r; listeners.forEach((fn) => { try { fn(); } catch (e) {} }); });
// Local test override only (127.0.0.1 / localhost): the browser suite checks the free plan. The
// recorder's data is public; this gate is the product's taste/upgrade line, not access control.
function testTier() {
  try { if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) && window.__stkOfTestTier) return window.__stkOfTestTier; } catch (e) {}
  return null;
}

// ---------------------------------------------------------------- data store (per root, per UTC day)
// days: 'YYYY-MM-DD' -> { bars: [], at, loading, err }. One fetch per day; today refreshes.
const stores = new Map();
const listeners = new Set();
let version = 0;
const bump = () => { version++; listeners.forEach((fn) => { try { fn(); } catch (e) {} }); };
function store(root) {
  let s = stores.get(root);
  if (!s) { s = { root, days: new Map(), tick: 0, thr: 0, merged: null, mergedV: -1, v: 0 }; stores.set(root, s); }
  return s;
}
async function fetchDay(s, day) {
  let e = s.days.get(day);
  const today = day === utcDay(Date.now());
  if (e && (e.loading || (!today && e.bars && !(e.err && Date.now() - e.at > 60000)) || (today && e.at && Date.now() - e.at < TODAY_REFRESH_MS - 1000))) return;
  if (!e) { e = { bars: null, at: 0, loading: false, err: '' }; s.days.set(day, e); }
  e.loading = true;
  try {
    const r = await fetch(RECORDER + '/orderflow?sym=' + s.root + '&day=' + day, { headers: await rtHeadersReady() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let u8 = new Uint8Array(await r.arrayBuffer());
    if (r.headers.get('x-of-gzip') === '1') u8 = await gunzipBody(u8);
    const p = decodeOrderflow(u8);
    e.bars = p.bars; e.err = '';
    if (p.header) { s.tick = p.header.tick || s.tick; if (p.header.thr) s.thr = p.header.thr; }
  } catch (x) {
    e.err = 'Footprint data unavailable right now, retrying';
    if (!e.bars) e.bars = [];
  }
  e.at = Date.now(); e.loading = false; s.v++;
  bump();
}
// The 1-minute bars of a root over [fromMs, toMs], fetching missing days (async; returns what is here).
function minuteBars(root, fromMs, toMs, free) {
  const s = store(root);
  const now = Date.now();
  if (free) fromMs = Math.max(fromMs, now - FREE_LOOKBACK_MS);
  toMs = Math.min(toMs, now);
  if (!(toMs >= fromMs)) return { bars: [], s, loading: false };
  const d0 = Math.max(Math.floor(fromMs / 86400000), Math.floor(toMs / 86400000) - MAX_DAYS + 1), d1 = Math.floor(toMs / 86400000);
  let loading = false, err = '';
  const out = [];
  for (let d = d0; d <= d1; d++) {
    const day = utcDay(d * 86400000);
    void fetchDay(s, day);
    const e = s.days.get(day);
    if (!e || !e.bars) { loading = true; continue; }
    if (e.err) err = e.err;
    for (const b of e.bars) if (b.t >= fromMs - 60000 && b.t <= toMs) out.push(b);
  }
  // LIVE ORDER FLOW (admins, flag; assets/chart-live-of.js): minutes built in the browser from the stream's
  // prints replace the recorder's copy when they hold more prints (the forming + just-closed minutes).
  const lf = liveOfOn() && liveFlow(root);
  let bars = out;
  if (lf) { if (s.thr) setLiveThr(root, s.thr); bars = overlayLive(out, lf.list(), fromMs, toMs); }
  return { bars: free ? bars.filter((b) => b.t >= now - FREE_LOOKBACK_MS) : bars, s, loading, err };
}
// a live print batch: new version for that root's views, one bump
onLiveFlow(() => { if (!liveOfOn()) return; for (const s of stores.values()) if (liveFlow(s.root)) s.v++; bump(); });
// Sunday check (CME open): live minutes vs the recorder's, per closed minute. In the console: tzLiveOfStats('NQ')
if (typeof window !== 'undefined') window.tzLiveOfStats = (root = 'NQ') => {
  const s = stores.get(root), recs = [];
  if (s) s.days.forEach((e) => { if (e.bars) for (const b of e.bars) recs.push(b); });
  const lf = liveFlow(root);
  return Object.assign(compareMinutes(root, recs), { prints: lf ? lf.prints : 0, lastPrintAgoMs: lf && lf.lastT ? Date.now() - lf.lastT * 1000 : null, deliveries: liveDeliveries() });
};
// Live tail: the newest ~hour (the Worker rounds `from` down to the hour) is small, so it is polled
// every few seconds and merged into the day stores. The forming bar's cells grow as trades print and a
// just-closed bar gets its final cells within seconds.
let tailBusy = false;
async function fetchTail(s) {
  const now = Date.now();
  const r = await fetch(RECORDER + '/orderflow?sym=' + s.root + '&from=' + Math.floor(now / 1000 - 1200) + '&to=' + Math.ceil(now / 1000), { headers: await rtHeadersReady() });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  let u8 = new Uint8Array(await r.arrayBuffer());
  if (r.headers.get('x-of-gzip') === '1') u8 = await gunzipBody(u8);
  const p = decodeOrderflow(u8);
  if (!p.bars.length) return;
  const byDay = new Map();
  for (const b of p.bars) { const d = utcDay(b.t); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(b); }
  byDay.forEach((nb, d) => {
    let e = s.days.get(d);
    if (!e) { e = { bars: [], at: Date.now(), loading: false, err: '' }; s.days.set(d, e); }
    if (!e.bars) return;       // the day is still loading: its own fetch covers it
    const lo = nb[0].t, keep = e.bars.filter((b) => b.t < lo), seen = new Set(nb.map((b) => b.t));
    e.bars = keep.concat(nb, e.bars.filter((b) => b.t >= lo && !seen.has(b.t) && b.t > nb[nb.length - 1].t));
    e.err = '';
  });
  if (p.header && p.header.tick) s.tick = p.header.tick;
  s.v++;
}
async function pollTails() {
  if (tailBusy) return;
  tailBusy = true;
  try {
    let any = false;
    for (const s of stores.values()) {
      if (!s.days.has(utcDay(Date.now()))) continue;
      try { await fetchTail(s); any = true; } catch (x) {}
    }
    if (any) bump();
  } finally { tailBusy = false; }
}
// Today's day refreshes on a timer while any chart uses order flow (not during replay).
let refreshTm = 0, tailTm = 0, users = 0;
function startRefresh() {
  if (refreshTm) return;
  refreshTm = setInterval(() => {
    if (replayE() != null || document.visibilityState === 'hidden') return;
    const day = utcDay(Date.now());
    stores.forEach((s) => { if (s.days.has(day)) void fetchDay(s, day); });
  }, TODAY_REFRESH_MS);
  tailTm = setInterval(() => { if (replayE() == null && document.visibilityState !== 'hidden') void pollTails(); }, TAIL_MS);
}
function stopRefresh() { if (users <= 0 && refreshTm) { clearInterval(refreshTm); refreshTm = 0; clearInterval(tailTm); tailTm = 0; } }

// The order-flow bars matching a chart's bars (same timeframe, replay-clipped), keyed by time.
// Returns { map: Map(time -> bar), tick, thr, note, list } or { note } when the chart cannot show it.
const viewCache = new WeakMap();
export function flowFor(ctxLike) {
  const root = ctxLike.root;
  if (!root) return { note: 'Order flow from trades: crypto, and NQ, ES, YM, GC, SI and CL futures.' };
  const tf = tfMin(ctxLike.timeframe);
  if (tf == null || tf < 1 || tf > MAX_TF_MIN) return { note: 'Order flow works on 1-minute to 4-hour charts.' };
  if (isCrypto(root)) return cryptoFlow(ctxLike, root, tf);
  const t = testTier() || tierNow;
  // Order flow is a Pro tool (Owner 2026-10-29); the picker and chart-pro-gate.js keep Free out. Whoever gets here sees everything (no root or history cap).
  const free = false;
  const cb = ctxLike.bars;
  if (!cb.length) return { note: '' };
  const E = replayE();
  const toMs = Math.min(cb[cb.length - 1].time + tf * 60000, E == null ? Infinity : E);
  const got = minuteBars(root, cb[0].time, toMs, free);
  const key = root + '|' + tf + '|' + got.s.v + '|' + (E == null ? '' : Math.floor(E / 60000)) + '|' + cb[0].time + '|' + got.bars.length;
  const memo = viewCache.get(ctxLike.owner);
  if (memo && memo.key === key) return memo.out;
  const clipped = clipTo(got.bars, E);
  const agg = aggregate(clipped, tf * 60000);
  const map = new Map();
  for (const b of agg) map.set(b.t, b);
  const note = got.loading && !agg.length ? 'Loading order flow…' : got.err && !agg.length ? got.err : !agg.length ? (free ? 'No order flow in the last 24 h yet (free plan: NQ, last 24 h).' : 'No order flow for these bars yet. History starts ' + '6 days before 2026-10-14 and grows from there.') : '';
  const out = { map, list: agg, mins: clipped, tick: got.s.tick || 0.25, thr: got.s.thr || 0, note, free, loading: got.loading };
  viewCache.set(ctxLike.owner, { key, out });
  return out;
}

// Crypto: the 1-minute bars come from Binance trades (chart-footprint-crypto.js) instead of the recorder.
// Same aggregation and the same drawing; free and Pro see the same (the feed is public, 3 h deep).
function cryptoFlow(ctxLike, root, tf) {
  const cb = ctxLike.bars;
  const feed = cryptoFeed(root, bump);
  if (!cb.length) return { note: '' };
  const E = replayE();
  const key = root + '|' + tf + '|' + feed.v + '|' + feed.bigThr + '|' + (E == null ? '' : Math.floor(E / 60000)) + '|' + cb[0].time + '|' + cb.length;
  const memo = viewCache.get(ctxLike.owner);
  if (memo && memo.key === key) return memo.out;
  const clipped = clipTo(feed.bars().filter((b) => b.t >= feed.coverFrom), E);
  const agg = aggregate(clipped, tf * 60000).filter((b) => b.t >= feed.coverFrom);
  const map = new Map();
  for (const b of agg) map.set(b.t, b);
  const loading = feed.status === 'loading' && !agg.length;
  const note = loading ? 'Loading recent trades…'
    : feed.status === 'error' && !agg.length ? feed.err
    : feed.status === 'error' ? 'Crypto trades temporarily unavailable. Showing what loaded.'
    : feed.status === 'reconnecting' ? 'Trade stream reconnecting…'
    : !agg.length ? 'Waiting for trades…' : '';
  const out = { map, list: agg, mins: clipped, tick: feed.tick || 1, thr: feed.bigThr || 0, note, free: false, loading, crypto: true, partial: feed.status === 'loading' };
  viewCache.set(ctxLike.owner, { key, out });
  return out;
}

// ---------------------------------------------------------------- footprint chart type
const FP_DEF = { fpSrc: 'l2', fpStyle: 'classic', fpMode: 'bidask', fpBoxProfile: true, fpDbProfile: true, fpDbBadge: true, fpTable: false, fpScale: 'range', fpLadShow: 'volume', fpLadPoc: false, fpLadUnf: false, fpImb: 300, fpStack: 3, fpRows: 0, fpStats: true, fpPoc: true, fpUnfinished: true, fpBuyColor: '#03c988', fpSellColor: '#f23645', fpTextSize: 'normal', fpTablePos: 'br', fpStatsPos: 'bl', fpAutoText: false, fpAutoMin: 8, fpAutoMax: 14, fpTblVol: true, fpTblDelta: true, fpTblDpct: true, fpTblBuy: true, fpTblSell: true, fpTblTrd: true };
const TBL_KEY = { vol: 'Vol', delta: 'Delta', dpct: 'Dpct', buy: 'Buy', sell: 'Sell', trd: 'Trd' };
// Auto text size: the font for a row that traded `vol` when the busiest visible row traded `vmax` (square root so mid rows stay readable)
export function autoFont(cfg, vol, vmax) {
  const lo = Math.min(cfg.autoMin, cfg.autoMax), hi = Math.max(cfg.autoMin, cfg.autoMax);
  return Math.round(lo + (hi - lo) * Math.sqrt(Math.min(1, Math.max(0, vol) / (vmax || 1))));
}
const TEXT_ADJ = { small: -1, normal: 0, large: 2, xlarge: 4 };
const HEX6 = /^#[0-9a-f]{6}$/i;
// Buy / sell colours: left at the default (or empty) the look is unchanged (the styles each keep their own red / purple);
// picked, the one colour is used everywhere the footprint draws buyers or sellers.
function pal(cfg, day) {
  const u = cfg.buyC, s = cfg.sellC;
  return { UP: u || UP, UP2: u || UP2, DN: s || DN, SELL: s || SELL, SELL2: s || SELL2, TEAL: u || TEAL, ORNG: s || ORNG, PINK: s || PINK, buyC: u, sellC: s,
    gT: u || (day ? '#047857' : UP2), rT: s || (day ? '#b91c1c' : '#ff6b78'), sT: s || (day ? '#6d28d9' : SELL2), ladDN: s || DN };
}
const POS_OPTS = [['bl', 'Bottom left'], ['br', 'Bottom right'], ['tl', 'Top left'], ['tr', 'Top right']];
const STYLES = ['classic', 'delta', 'volume', 'ladder', 'boxes', 'dbars'];
const fpSettings = new Map();      // chart engine -> settings
function fpConfig(v) {
  v = v || {};
  // Style (Owner 10 Nov) is the one look switch; charts saved before it only have fpMode, which maps straight in.
  const style = STYLES.includes(v.fpStyle) ? v.fpStyle : ['delta', 'volume', 'ladder'].includes(v.fpMode) ? v.fpMode : 'classic';
  const mode = style === 'classic' ? 'bidask' : style;
  return {
    style, boxProfile: v.fpBoxProfile !== false, dbProfile: v.fpDbProfile !== false, dbBadge: v.fpDbBadge !== false, table: v.fpTable === true,
    src: v.fpSrc === 'l1' ? 'l1' : 'l2',   // futures data: L2 (order book feed's trades, default) or L1 (trades; the classic recorder data). Crypto ignores it.
    mode,
    scale: v.fpScale === 'bar' ? 'bar' : 'range',
    // build 689 saved fpMode 'ladder' with no fpLadShow: that chart showed delta, keep it so
    ladShow: v.fpLadShow === 'delta' || v.fpLadShow === 'volume' ? v.fpLadShow : (v.fpMode === 'ladder' && !v.fpStyle ? 'delta' : 'volume'),
    imb: clamp(num(v.fpImb, 300), 110, 2000) / 100,
    stack: clamp(Math.round(num(v.fpStack, 3)), 2, 10),
    rows: clamp(Math.round(num(v.fpRows, 0)), 0, 400),
    stats: v.fpStats !== false,
    buyC: HEX6.test(v.fpBuyColor) && v.fpBuyColor.toLowerCase() !== FP_DEF.fpBuyColor ? v.fpBuyColor : null,
    sellC: HEX6.test(v.fpSellColor) && v.fpSellColor.toLowerCase() !== FP_DEF.fpSellColor ? v.fpSellColor : null,
    adj: TEXT_ADJ[v.fpTextSize] || 0,
    // Auto text size (off = today's look): each row's number scales with its volume between a smallest and a biggest size
    auto: v.fpAutoText === true, autoMin: clamp(Math.round(num(v.fpAutoMin, 8)), 7, 16), autoMax: clamp(Math.round(num(v.fpAutoMax, 14)), 8, 20),
    tblHide: TABLE_ROWS.filter((r) => v['fpTbl' + TBL_KEY[r[0]]] === false).map((r) => r[0]),   // stats-table rows the member switched off
    tblPos: ['tl', 'tr', 'bl', 'br'].includes(v.fpTablePos) ? v.fpTablePos : 'br',     // t / b = top / bottom, l / r = left / right
    statsPos: ['tl', 'tr', 'bl', 'br'].includes(v.fpStatsPos) ? v.fpStatsPos : 'bl',
    // Ladder has its own POC / unfinished-auction toggles, off by default; other modes keep theirs (on)
    poc: mode === 'ladder' ? v.fpLadPoc === true : v.fpPoc !== false,
    unf: mode === 'ladder' ? v.fpLadUnf === true : v.fpUnfinished !== false
  };
}
class FootprintEngine {
  constructor() { this.cfg = fpConfig(FP_DEF); this.on = false; this.onAny = () => this.push(); this.l2own = {}; this.l2m = undefined; this.l2v = -1; this.l2tm = 0; this.onL2 = () => this.l2Tick(); }
  start(ctx) { this.ctx = ctx; this.on = true; this.fitted = false; users++; startRefresh(); listeners.add(this.onAny); this.push(); }
  // L2 data: chart-l2-flow.js loads once; its hub fires on every book frame, the footprint only needs the trade minutes (<= 5 redraws a second)
  loadL2() { if (this.l2m !== undefined || this.l2p) return; this.l2p = import('./chart-l2-flow.js?v=975').then((m) => { this.l2m = m; this.push(); }, () => { this.l2m = false; this.push(); }); }
  l2Tick() {
    if (this.l2tm || !this.on) return;
    this.l2tm = setTimeout(() => { this.l2tm = 0; const v = this.l2m ? this.l2m.fpVersion(this.l2own) : 0; if (v !== this.l2v) this.push(); }, 200);
  }
  // the flow for the layer: null = use the trades feed (L1 setting, crypto, or the module is missing)
  l2Flow(bars, tfm) {
    if (this.cfg.src === 'l1') { this.dropL2(); return null; }
    if (this.l2m === undefined) { this.loadL2(); return { map: new Map(), note: 'Loading order flow…' }; }
    if (!this.l2m) return null;
    const r = this.l2m.fpFlow(this.l2own, this.ctx, bars, tfm * 60000, replayE(), this.onL2);
    this.l2v = this.l2m.fpVersion(this.l2own);
    return r;
  }
  dropL2() { if (this.l2m) this.l2m.fpDrop(this.l2own); this.l2v = -1; }
  onSettings(v) {
    this.raw = v || {}; this.cfg = fpConfig(v); this.push();
    // an old chart (fpMode, no fpStyle): write the Style once so the settings panel shows the look the chart really has
    if (v && !STYLES.includes(v.fpStyle) && this.cfg.style !== 'classic' && !this.migrating) {
      this.migrating = true;
      setTimeout(() => { this.migrating = false; try { const ws = window.STRYKER_VELA, r = ws && ws.chart && ws.chart.renderer, rr = r && (r.applyConfig ? r : r.renderer); if (rr && rr.applyConfig) rr.applyConfig({ chartTypes: { stk_fp: { fpStyle: this.cfg.style, fpLadShow: this.cfg.ladShow } } }); } catch (e) {} }, 0);
    }
  }
  onViewport() { this.push(); }
  // Delta bars profile at the right edge: if the newest bar's cells would run under it, scroll the view left by exactly the
  // overlap (rightOffset, in bars). Runs from the layer; converges in one step, so no loop.
  room(over, bw) {
    if (!(over > 1) || this.roomTm) return;
    this.roomTm = setTimeout(() => {
      this.roomTm = 0;
      try {
        const ws = window.STRYKER_VELA, rr = ws && ws.chart && ws.chart.renderer, ctl = rr && (rr.applyViewport ? rr : rr.renderer), v = this.lastCo && this.lastCo.getViewport();
        if (ctl && ctl.applyViewport && v) ctl.applyViewport({ barSpacing: v.barSpacing, rightOffset: v.rightOffset + Math.ceil(over / bw) });
      } catch (e) {}
    }, 0);
  }
  // Bar stats table ON: keep its height free at the bottom of the price pane (Vela's bottom margin, % of the pane), so no bar or
  // volume bar is drawn under it. The member's own margin is saved in fpMarginPrev and put back when the table goes off.
  reserve(H, ph, T) {
    if (this.resTm) return;
    const ws = window.STRYKER_VELA, r0 = ws && ws.chart && ws.chart.renderer, R = r0 && (r0.applyConfig ? r0 : r0.renderer);
    if (!R || !R.applyConfig || !R.getConfig) return;
    let cm; try { cm = R.getConfig().margins; } catch (e) { return; }
    const patch = { margins: {}, chartTypes: { stk_fp: {} } };
    // one edge each: bottom (H) and top (T); the member's own margin is saved (fpMarginPrev / fpMarginPrevT) and put back
    for (const [edge, h, pk] of [['bottom', H, 'fpMarginPrev'], ['top', T || 0, 'fpMarginPrevT']]) {
      const cur = cm[edge], need = h > 0 && ph > 0 ? Math.min(40, Math.ceil((h + 18) / ph * 100)) : 0;
      const prev = this.raw && typeof this.raw[pk] === 'number' ? this.raw[pk] : null;
      if (need > 0 && (cur < need - 0.5 || (prev != null && Math.abs(cur - need) > 1 && cur > need))) { patch.margins[edge] = need; if (prev == null) patch.chartTypes.stk_fp[pk] = cur; }
      else if (need === 0 && prev != null) { patch.margins[edge] = prev; patch.chartTypes.stk_fp[pk] = null; }
    }
    if (!Object.keys(patch.margins).length) return;
    this.resTm = setTimeout(() => { this.resTm = 0; try { R.applyConfig(patch); } catch (e) {} }, 0);
  }
  suspend() { if (!this.on) return; this.on = false; clearTimeout(this.resTm); this.resTm = 0; clearTimeout(this.roomTm); this.roomTm = 0; this.dropL2(); clearTimeout(this.l2tm); this.l2tm = 0; users--; stopRefresh(); listeners.delete(this.onAny); }
  resume() { if (this.on) return; this.on = true; users++; startRefresh(); listeners.add(this.onAny); this.push(); }
  stop() { this.suspend(); }
  push() {
    if (!this.on || !this.ctx) return;
    this.ctx.pushData({ eng: this, root: rootOf(this.ctx), timeframe: this.ctx.timeframe, cfg: this.cfg, v: version });
  }
}

// Rows of `m` ticks per bar, cached per (bar object, m).
const rowCache = new WeakMap();
function rowsOf(bar, m) {
  let c = rowCache.get(bar);
  if (!c || c.m !== m) { const rs = rows(bar, m); let dm = 1; for (const r of rs) { const q = Math.abs(r.buy - r.sell); if (q > dm) dm = q; } c = { m, rs, poc: poc(rs), dm }; rowCache.set(bar, c); }
  return c;
}
const ROW_STEPS = [1, 2, 4, 5, 8, 10, 16, 20, 25, 40, 50, 80, 100, 200, 400];

// ---------------------------------------------------------------- Delta boxes + Bar stats table (Owner 10 Nov)
// short number: 340, 2.1K, 15K, 1.5M (crypto volumes keep their decimals via fmt)
function fmtD(v) {
  const a = Math.abs(v), s = v < 0 ? '\u2212' : '';
  if (a < 0.005) return '0';   // never "<.01"
  if (a >= 1e7) return s + Math.round(a / 1e6) + 'M';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return s + Math.round(a / 1e3) + 'K';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K';
  return s + fmt(a);
}
const NEUTRAL = '#8a90a0';
// busiest row (buy + sell) among the visible bars; the reference for Auto text size
function visMaxVol(X) {
  const { a, f, m, i0, i1 } = X; let q = 1;
  for (let i = i0; i <= i1; i++) { const fb = f.map.get(a.bars[i].time); if (!fb) continue; for (const r of rowsOf(fb, m).rs) { const v = r.buy + r.sell; if (v > q) q = v; } }
  return q;
}
// One box per price row from the bar's low to its high: its delta, green / red by sign, intensity by |delta|
// against the strongest row on screen. `X` carries the frame's numbers from footprintLayer.render.
function drawBoxes(X) {
  const { g, co, a, f, cfg, i0, i1, m, tick, bw, rowPx, compact, bot, day, plotR } = X;
  const P = pal(cfg, day), { UP, DN } = P;
  let dmax = 1;
  for (let i = i0; i <= i1; i++) { const fb = f.map.get(a.bars[i].time); if (fb) { const q = rowsOf(fb, m).dm; if (q > dmax) dmax = q; } }
  const boxW = Math.max(3, bw * (compact ? 0.88 : 0.92) - 10);
  const fs0 = clamp(Math.floor(rowPx - 3), 8, 12), fsMax = Math.max(8, Math.floor(rowPx - 1));
  let fs = clamp(fs0 + cfg.adj, 7, cfg.adj > 0 ? Math.max(12, Math.min(16, fsMax)) : 12);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  const vmaxV = cfg.auto ? visMaxVol(X) : 1;
  let anyText = false;
  const dbg = window.__stkFpDebug ? (window.__stkFpDebug.boxes = []) : null;   // browser suite only
  for (let i = i0; i <= i1; i++) {
    const bar = a.bars[i], fb = f.map.get(bar.time);
    if (!fb) continue;
    const { rs, poc: pk } = rowsOf(fb, m);
    if (!rs.length) continue;
    const x = co.logicalToX(i), x0 = x + 6;
    // thin candle at the left of the slot (real OHLC), like Ladder
    const cc = bar.close >= bar.open ? UP : DN;
    const yH = co.priceToY(bar.high, a.scale, a.bounds), yL = co.priceToY(bar.low, a.scale, a.bounds);
    const yO = co.priceToY(bar.open, a.scale, a.bounds), yC = co.priceToY(bar.close, a.scale, a.bounds), cw = bw >= 30 ? 5 : 3;
    g.fillStyle = cc; g.fillRect(Math.round(x), Math.min(yH, yL), 1, Math.max(1, Math.abs(yL - yH)));
    g.fillRect(Math.round(x - cw / 2 + 0.5), Math.min(yO, yC), cw, Math.max(1.5, Math.abs(yC - yO)));
    let ch = 1;
    if (rowPx >= 10) for (const r of rs) { const n = fmtD(r.buy - r.sell).length; if (n > ch) ch = n; }
    // a bigger text size shrinks back to the widest number that fits the box, never below the normal size
    const fsB = cfg.adj > 0 ? Math.max(fs0, Math.min(fs, Math.floor((boxW - 4) / (0.6 * ch)))) : fs;
    const text = cfg.auto ? rowPx >= 10 && 7 * 0.6 * ch <= boxW - 4 : rowPx >= 10 && fsB * 0.6 * ch <= boxW - 4;
    if (text) { anyText = true; g.font = fsB + 'px ' + MONO; }
    for (let k = 0; k < rs.length; k++) {
      const r = rs[k], d = r.buy - r.sell;
      const yT = co.priceToY((r.p + m) * tick, a.scale, a.bounds), yB = co.priceToY(r.p * tick, a.scale, a.bounds);
      const y = Math.min(yT, yB), h = Math.abs(yB - yT);
      if (y > bot || y + h < X.top) continue;
      const t = Math.sqrt(Math.abs(d) / dmax), neutral = Math.abs(d) < 0.04 * dmax;
      const isPoc = cfg.poc && k === pk;
      const base = neutral ? NEUTRAL : d > 0 ? UP : DN;
      const al = neutral ? (day ? 0.3 : 0.4) : 0.22 + 0.7 * t + (isPoc ? 0.08 : 0);
      const bh = Math.max(1, h - 1), rad = Math.min(3, bh / 3);
      if (dbg) dbg.push({ x: x0, y: y + 0.5, w: boxW, h: bh, d, poc: isPoc, i });
      g.fillStyle = alpha(base, Math.min(1, al));
      g.beginPath(); if (g.roundRect) g.roundRect(x0, y + 0.5, boxW, bh, rad); else g.rect(x0, y + 0.5, boxW, bh); g.fill();
      if (isPoc) { g.strokeStyle = day ? '#a16207' : POCY; g.lineWidth = 1.5; g.beginPath(); if (g.roundRect) g.roundRect(x0 + 0.5, y + 1, boxW - 1, Math.max(1, bh - 1), rad); else g.rect(x0 + 0.5, y + 1, boxW - 1, Math.max(1, bh - 1)); g.stroke(); }
      if (!text) continue;
      const strong = !neutral && al > 0.62;
      g.fillStyle = strong ? (d > 0 ? '#04140d' : '#ffffff') : (day ? '#1f2937' : '#e5e7eb');
      if (cfg.auto) g.font = Math.max(7, Math.min(autoFont(cfg, r.buy + r.sell, vmaxV), Math.floor(rowPx - 1), Math.floor((boxW - 4) / (0.6 * fmtD(d).length)))) + 'px ' + MONO;
      g.fillText(fmtD(d), x0 + boxW / 2, y + h / 2 + 0.5);
    }
  }
  // the newest bar's volume profile to the right of it: grey bars, POC in the accent colour
  // the newest bar that has trades (one of the last 3), only while the chart shows the right edge
  let li = a.bars.length - 1;
  while (li >= 0 && li > a.bars.length - 4 && !f.map.get(a.bars[li].time)) li--;
  if (cfg.boxProfile && li >= 0 && i1 >= a.bars.length - 1 && f.map.get(a.bars[li].time)) {
    const fb = f.map.get(a.bars[li].time);
    if (fb) {
      const { rs, poc: pk } = rowsOf(fb, m);
      const left = co.logicalToX(li) + 6 + boxW + 10, maxW = Math.min(110, (plotR - 8) * 0.18);
      const px0 = Math.max(left, plotR - 8 - maxW), pw = plotR - 8 - px0;
      let vmax = 1; for (const r of rs) { const v = r.buy + r.sell; if (v > vmax) vmax = v; }
      if (pw >= 24) {
        g.textAlign = 'left';
        for (let k = 0; k < rs.length; k++) {
          const r = rs[k], v = r.buy + r.sell;
          const yT = co.priceToY((r.p + m) * tick, a.scale, a.bounds), yB = co.priceToY(r.p * tick, a.scale, a.bounds);
          const y = Math.min(yT, yB), h = Math.abs(yB - yT), bh = Math.max(1, h - 1), w = Math.max(2, pw * v / vmax);
          g.fillStyle = k === pk ? alpha(CYAN, 0.9) : (day ? 'rgba(100,116,139,0.55)' : 'rgba(138,144,160,0.5)');
          g.beginPath(); if (g.roundRect) g.roundRect(px0, y + 0.5, w, bh, Math.min(2, bh / 3)); else g.rect(px0, y + 0.5, w, bh); g.fill();
          if (rowPx >= 10 && w > fs * 0.6 * fmtD(v).length + 6) { g.font = fs + 'px ' + MONO; g.fillStyle = k === pk ? '#04140d' : (day ? '#1f2937' : '#e5e7eb'); g.fillText(fmtD(v), px0 + 3, y + h / 2 + 0.5); }
        }
      }
    }
  }
  return anyText;
}
// ---------------------------------------------------------------- Delta bars (Owner 10 Nov, second look)
const TEAL = '#1fb5b0', ORNG = '#f0883a', PINK = '#ff5c7a';
function drawDbars(X) {
  const { g, co, a, f, cfg, i0, i1, m, tick, bw, rowPx, compact, top, bot, day, plotR } = X;
  const P = pal(cfg, day), { UP, UP2, DN, SELL, SELL2, TEAL, ORNG, PINK } = P;
  const dpr = co.dpr || 1, base = () => g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // the profile's width is fixed up front so the bars can stop short of it (clip) and the view leaves room for it
  const Wp = compact ? 40 : clamp(plotR * 0.12, 52, 128), xr = plotR - 2, pL = cfg.dbProfile ? xr - Wp - 6 : plotR;
  if (X.eng) {
    X.eng.lastCo = co;
    let li = a.bars.length - 1;
    while (li > a.bars.length - 4 && li > 0 && !f.map.get(a.bars[li].time)) li--;   // the newest bar that has trades
    const xe = co.logicalToX(li) + 5 + Math.max(8, bw * (compact ? 0.88 : 0.92) - 8);
    if (cfg.dbProfile && li <= i1 && f.map.get(a.bars[li].time)) X.eng.room(xe - pL + 4, bw);
  }
  const D = window.__stkFpDebug ? (window.__stkFpDebug.dbars = { cells: [], pills: [], profile: null, badge: null }) : null;
  // one gradient per kind, defined on x 0..1 and stretched to each cell's length with a transform (no gradient per cell)
  const grad = (c, a1) => { const q = g.createLinearGradient(0, 0, 1, 0); q.addColorStop(0, alpha(c, 0.03)); q.addColorStop(1, alpha(c, a1)); return q; };
  const GR = { pos: grad(TEAL, 0.5), neg: grad(ORNG, 0.55), posI: grad(TEAL, 0.72), negI: grad(ORNG, 0.75) };
  const cw = Math.max(8, bw * (compact ? 0.88 : 0.92) - 8);
  const fs0 = clamp(Math.floor(rowPx - 3), 8, 12), fs = clamp(fs0 + cfg.adj, 7, cfg.adj > 0 ? Math.max(12, Math.floor(rowPx - 1)) : 12), pillH = (compact ? 14 : 18) + Math.max(0, cfg.adj);
  const vr = co.visibleLogicalRange(), v0 = Math.max(0, Math.ceil(vr.from)), v1 = Math.min(a.bars.length - 1, Math.floor(vr.to));
  let badge = 0, anyText = false;
  const prof = new Map();
  g.textBaseline = 'middle';
  g.save(); g.beginPath(); g.rect(0, top, pL, bot - top); g.clip();
  for (let i = i0; i <= i1; i++) {
    const bar = a.bars[i], fb = f.map.get(bar.time);
    if (!fb) continue;
    const { rs, poc: pk, dm } = rowsOf(fb, m);
    if (!rs.length) continue;
    const inVis = i >= v0 && i <= v1;
    if (inVis) { badge += fb.delta; if (cfg.dbProfile) for (const r of rs) { let e = prof.get(r.p); if (!e) { e = { p: r.p, buy: 0, sell: 0 }; prof.set(r.p, e); } e.buy += r.buy; e.sell += r.sell; } }
    const x = co.logicalToX(i), x0 = x + 5;
    const yH = co.priceToY(bar.high, a.scale, a.bounds), yL = co.priceToY(bar.low, a.scale, a.bounds);
    const yO = co.priceToY(bar.open, a.scale, a.bounds), yC = co.priceToY(bar.close, a.scale, a.bounds);
    const cc = bar.close >= bar.open ? TEAL : ORNG, bwid = bw >= 30 ? 3 : 2;
    g.fillStyle = cc; g.fillRect(Math.round(x), Math.min(yH, yL), 1, Math.max(1, Math.abs(yL - yH)));
    g.fillRect(Math.round(x - bwid / 2 + 0.5), Math.min(yO, yC), bwid, Math.max(1.5, Math.abs(yC - yO)));
    g.fillStyle = ORNG; g.fillRect(Math.round(x - 3), Math.round(yH), 7, 1.5); g.fillRect(Math.round(x - 3), Math.round(yL) - 1, 7, 1.5);   // high / low ticks
    const imb = imbalances(rs, cfg.imb), st = stacked(imb, cfg.stack), inStack = new Uint8Array(rs.length);
    for (const sx of st) for (let k = sx.k0; k <= sx.k1; k++) inStack[k] = 1;
    let ch = 1;
    if (rowPx >= 10) for (const r of rs) { const n = fmtD(r.buy - r.sell).length; if (n > ch) ch = n; }
    const fsD = cfg.adj > 0 ? Math.max(fs0, Math.min(fs, Math.floor((cw - 4) / (0.6 * ch)))) : fs;
    const text = rowPx >= 10 && fsD * 0.6 * ch <= cw - 4;
    if (text) { anyText = true; g.font = fsD + 'px ' + MONO; g.textAlign = 'left'; }
    let lowY = 0;
    for (let k = 0; k < rs.length; k++) {
      const r = rs[k], d = r.buy - r.sell;
      const yT = co.priceToY((r.p + m) * tick, a.scale, a.bounds), yB = co.priceToY(r.p * tick, a.scale, a.bounds);
      const y = Math.min(yT, yB), h = Math.abs(yB - yT), bh = Math.max(1, h - 1);
      if (y + h > lowY) lowY = y + h;
      if (y > bot || y + h < top) continue;
      const ib = imb.buy[k] ? 1 : 0, is = imb.sell[k] ? 1 : 0, len = d === 0 ? 0 : Math.max(2, cw * Math.abs(d) / dm);
      if (len > 0) {
        g.setTransform(dpr * len, 0, 0, dpr, dpr * x0, 0);
        g.fillStyle = d > 0 ? (ib ? GR.posI : GR.pos) : (is ? GR.negI : GR.neg);
        g.fillRect(0, y + 0.5, 1, bh); base();
      }
      const isPoc = cfg.poc && k === pk;
      if (isPoc) { g.fillStyle = day ? 'rgba(15,23,42,0.07)' : 'rgba(255,255,255,0.07)'; g.fillRect(x0, y + 0.5, cw, bh); }
      if ((ib || is) && h >= 4) {
        const pick = ib && is ? (d >= 0 ? 1 : 0) : ib;
        g.strokeStyle = pick ? UP : PINK; g.lineWidth = inStack[k] ? 1.6 : 1;
        g.beginPath(); if (g.roundRect) g.roundRect(x0 + 0.5, y + 1, cw - 1, Math.max(1, bh - 1), 2); else g.rect(x0 + 0.5, y + 1, cw - 1, Math.max(1, bh - 1)); g.stroke();
      } else if (isPoc && h >= 4) {
        g.strokeStyle = day ? 'rgba(15,23,42,0.45)' : 'rgba(255,255,255,0.45)'; g.lineWidth = 1;
        g.strokeRect(x0 + 0.5, y + 1, cw - 1, Math.max(1, bh - 1));
      }
      if (D && x0 < pL) D.cells.push({ i, x: x0, y, w: Math.min(cw, pL - x0), cw, h: bh, d, len, max: dm, imb: ib ? 1 : is ? 2 : 0, poc: !!isPoc });
      if (text) { g.fillStyle = day ? '#1f2937' : '#eceef2'; g.fillText(fmtD(d), x0 + 3, y + h / 2 + 0.5); }
    }
    // pill with the bar's total delta, under the bar
    const txt = fmtD(fb.delta), pf = (compact ? 9 : 11) + cfg.adj;
    g.font = '600 ' + pf + 'px ' + MONO;
    const pw = Math.min(Math.round(g.measureText(txt).width + 12), Math.max(10, Math.round(bw - 2)));
    let py = Math.round(lowY + 5); if (py + pillH > bot - 1) py = Math.round(bot - pillH - 1);
    const pxl = Math.round(x0 + cw / 2 - pw / 2);
    g.fillStyle = day ? '#ffffff' : '#101114'; g.strokeStyle = day ? 'rgba(15,23,42,0.14)' : 'rgba(255,255,255,0.1)'; g.lineWidth = 1;
    g.beginPath(); if (g.roundRect) g.roundRect(pxl + .5, py + .5, pw, pillH, pillH / 2); else g.rect(pxl + .5, py + .5, pw, pillH); g.fill(); g.stroke();
    if (g.measureText(txt).width + 6 <= pw) { g.textAlign = 'center'; g.fillStyle = fb.delta >= 0 ? P.gT : P.rT; g.fillText(txt, pxl + pw / 2 + .5, py + pillH / 2 + 1); }
    else { g.fillStyle = fb.delta >= 0 ? UP : DN; g.fillRect(pxl + pw / 2 - 2, py + pillH / 2 - 1, 4, 2); }
    if (D) D.pills.push({ i, d: fb.delta, vis: inVis, rowSum: rs.reduce((z, r) => z + r.buy - r.sell, 0), positive: fb.delta >= 0 });
  }
  g.restore();
  // volume profile of the visible range at the right edge: bar length = volume, colour = that price's net delta
  if (cfg.dbProfile && prof.size) {
    const list = [...prof.values()].sort((p, q) => p.p - q.p);
    let vmax = 1, pk = 0; list.forEach((e, k) => { const v = e.buy + e.sell; if (v > vmax) { vmax = v; pk = k; } });
    g.font = Math.min((compact ? 9 : 10) + cfg.adj, Math.max(9, Math.floor(rowPx - 1))) + 'px ' + MONO; g.textAlign = 'right';
    const out = [];
    list.forEach((e, k) => {
      const v = e.buy + e.sell, d = e.buy - e.sell;
      const yT = co.priceToY((e.p + m) * tick, a.scale, a.bounds), yB = co.priceToY(e.p * tick, a.scale, a.bounds);
      const y = Math.min(yT, yB), h = Math.abs(yB - yT), bh = Math.max(1, h - 1);
      if (y > bot || y + h < top) return;
      const w = Math.max(2, Wp * v / vmax), c = d >= 0 ? TEAL : ORNG;
      g.fillStyle = alpha(c, 0.25 + 0.55 * Math.min(1, Math.abs(d) / Math.max(1, v) * 2.2)); g.fillRect(xr - w, y + 0.5, w, bh);
      if (k === pk) { g.strokeStyle = day ? '#a16207' : POCY; g.lineWidth = 1.3; g.strokeRect(xr - w + 0.5, y + 1, w - 1, Math.max(1, bh - 1)); }
      if (rowPx >= 10) { g.fillStyle = day ? '#1f2937' : '#eceef2'; g.fillText(fmtD(d), xr - 3, y + h / 2 + 0.5); }
      out.push({ p: e.p, vol: v, d, poc: k === pk });
    });
    if (D) D.profile = { rows: out, x0: xr - Wp, x1: xr };
  }
  // net delta of the visible bars
  if (cfg.dbBadge) {
    const txt = 'Delta ' + fmtD(badge);
    g.font = '600 ' + (11 + Math.max(0, cfg.adj)) + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const tw = g.measureText('Delta ').width, vw = g.measureText(fmtD(badge)).width, bwid = Math.round(tw + vw + 20), bx = Math.round(plotR - bwid - 8), by = X.topUsed ? top + 6 : top + (compact ? 64 : 34);   // below the Fit price / Latest buttons
    g.fillStyle = day ? 'rgba(255,255,255,0.94)' : 'rgba(19,19,22,0.92)'; g.strokeStyle = day ? 'rgba(15,23,42,0.14)' : 'rgba(255,255,255,0.1)'; g.lineWidth = 1;
    g.beginPath(); if (g.roundRect) g.roundRect(bx + .5, by + .5, bwid, 22 + Math.max(0, cfg.adj), 8); else g.rect(bx + .5, by + .5, bwid, 22 + Math.max(0, cfg.adj)); g.fill(); g.stroke();
    g.textAlign = 'left'; g.fillStyle = day ? '#475569' : '#a3a9b6'; g.fillText('Delta ', bx + 10, by + 11.5);
    g.fillStyle = badge >= 0 ? P.gT : P.rT; g.fillText(fmtD(badge), bx + 10 + tw, by + 11.5);
    if (D) D.badge = { sum: badge, text: txt, bars: v1 - v0 + 1 };
  }
  return anyText;
}

const TOP_OFF = 54, TOP_OFF_PHONE = 92;   // a top-placed table or strip starts below the chart's own price / volume legend
const TABLE_ROWS = [['vol', 'Total volume'], ['delta', 'Delta'], ['dpct', 'Delta %'], ['buy', 'Buy volume'], ['sell', 'Sell volume'], ['trd', 'Trades']];
// rows this chart can really show: from the footprint's own volume, delta and (when the feed has them) trade counts
export function tableRowsFor(fbs, phone, hide = []) {
  const keys = ['vol', 'delta', 'buy', 'sell'];
  if (!phone) { keys.splice(2, 0, 'dpct'); if (fbs.some((b) => b && b.trades > 0)) keys.push('trd'); }
  return TABLE_ROWS.filter((r) => keys.includes(r[0]) && !hide.includes(r[0]));
}
function tableVal(fb, k) {
  switch (k) {
    case 'vol': return fb.vol;
    case 'delta': return fb.delta;
    case 'dpct': return fb.vol ? fb.delta / fb.vol : 0;
    case 'buy': return (fb.vol + fb.delta) / 2;
    case 'sell': return (fb.vol - fb.delta) / 2;
    default: return fb.trades || 0;
  }
}
// Bar stats table: one column per bar (aligned to the bar slots), row labels at the right, heat-map cells.
function drawTable(X) {
  const { g, co, a, f, cfg, i0, i1, bw, bot, day, plotR } = X;
  const phone = co.width < 520, rh = phone ? 14 : 16 + Math.max(0, cfg.adj > 0 ? 2 : 0), tf = 10 + cfg.adj, lf = 11 + Math.min(cfg.adj, 3);
  const atTop = cfg.tblPos[0] === 't', labL = cfg.tblPos[1] === 'l';
  const vis = [];
  for (let i = i0; i <= i1; i++) vis.push(f.map.get(a.bars[i].time));
  const rows = tableRowsFor(vis, phone, cfg.tblHide), H = rows.length * rh, y0 = X.tblY != null ? X.tblY : bot - H, labW = (phone ? 62 : 82) + Math.max(0, cfg.adj) * 4, cellL = labL ? labW : 0, cellR = labL ? plotR : plotR - labW;
  const mx = {};
  for (const [k] of rows) { let q = 1e-9; for (const fb of vis) if (fb) { const v = Math.abs(tableVal(fb, k)); if (v > q) q = v; } mx[k] = q; }
  if (window.__stkFpDebug) window.__stkFpDebug.table = { y0, rh, rows: rows.map((r) => r[0]), cols: [], plotR, H };
  g.save();
  g.fillStyle = day ? '#ffffff' : '#050506'; g.fillRect(0, y0, plotR, H);
  g.beginPath(); g.rect(cellL, y0, cellR - cellL, H); g.clip();
  g.font = tf + 'px ' + MONO; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = i0; i <= i1; i++) {
    const fb = f.map.get(a.bars[i].time);
    if (!fb) continue;
    const xl = co.logicalToX(i) - bw / 2 + 0.5, w = bw - 1;
    if (xl < cellL) continue;   // a bar cut by the left edge (or the label column) gets no half column; on the other side the clip is clean
    if (window.__stkFpDebug) window.__stkFpDebug.table.cols.push({ i, xc: co.logicalToX(i), xl, w });
    rows.forEach(([k], ri) => {
      const v = tableVal(fb, k), t = Math.abs(v) / mx[k], y = y0 + ri * rh;
      const base = k === 'delta' || k === 'dpct' ? (v >= 0 ? X.UP : X.DN) : k === 'buy' ? X.UP : k === 'sell' ? X.DN : CYAN;
      g.fillStyle = alpha(base, 0.14 + 0.72 * Math.sqrt(t));
      g.fillRect(xl, y + 0.5, w, rh - 1);
      const txt = k === 'dpct' ? (v < 0 ? '\u2212' : '') + Math.round(Math.abs(v) * 100) + '%' : k === 'delta' ? fmtD(v) : fmtD(Math.abs(v));
      if (txt.length * 0.6 * tf + 4 <= w && xl + w <= cellR) { g.fillStyle = t > 0.6 ? (k === 'sell' || (k !== 'buy' && v < 0) ? '#ffffff' : '#04140d') : (day ? '#1f2937' : '#e5e7eb'); g.fillText(txt, xl + w / 2, y + rh / 2 + 0.5); }
    });
  }
  g.restore();
  g.font = '500 ' + lf + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; g.textAlign = labL ? 'left' : 'right'; g.textBaseline = 'middle';
  g.fillStyle = day ? '#475569' : '#a3a9b6';
  rows.forEach(([, name], ri) => g.fillText(phone ? name.replace('Total volume', 'Volume').replace(' volume', '').replace('Delta %', 'Δ %') : name, labL ? 6 : plotR - 6, y0 + ri * rh + rh / 2 + 0.5));
  g.strokeStyle = day ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  const ly = atTop ? y0 + H - 0.5 : y0 + 0.5; g.beginPath(); g.moveTo(0, ly); g.lineTo(plotR, ly); g.stroke();
  return H;
}

function footprintLayer() {
  let canvas = null, on = false, lastMs = 0, tcv = null, stats = false;
  // The bar stats table lives on its own canvas above every other layer (just under the user's drawings), so candles, cells,
  // big-trade markers and indicators the member stacked above this layer can never cover it (bug GK 13 Nov). Sized from our layer canvas.
  const tableCanvas = () => {
    if (!canvas || !canvas.parentNode) return null;
    if (!tcv) { tcv = document.createElement('canvas'); tcv.className = 'stk-fp-table'; Object.assign(tcv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' }); }
    const par = canvas.parentNode;
    // above the layer canvases, chrome and drawings, below Vela's right shade and crosshair; re-checked each frame in case the layer order moved
    if (tcv.parentNode !== par || tcv.nextElementSibling !== par.querySelector(':scope > .vela-shade-right')) par.insertBefore(tcv, par.querySelector(':scope > .vela-shade-right'));
    if (tcv.width !== canvas.width) tcv.width = canvas.width;
    if (tcv.height !== canvas.height) tcv.height = canvas.height;
    tcv.style.width = canvas.style.width || '100%'; tcv.style.height = canvas.style.height || '100%';
    return tcv;
  };
  // The flag that moves the Fit price / Latest pills to the top lives on THIS pane's cell and is written once per frame,
  // only when it changes (it used to be removed + re-added on <body> every frame, so the pills jumped between panes / frames).
  // Only this layer's own ON is ever undone by it, so a second layer in the same cell cannot flip the pills back.
  let owns = false;
  const applyStats = () => { const h = canvas && canvas.closest && canvas.closest('.vela-cell'); if (!h) return; if (stats && !owns) { h.classList.add('stk-fp-stats'); owns = true; } else if (!stats && owns) { h.classList.remove('stk-fp-stats'); owns = false; } };
  return {
    mount(c) { canvas = c; },
    render(a) { stats = false; try { return this.paint(a); } finally { applyStats(); } },
    paint(a) {
      const t0 = performance.now();
      const g = canvas && canvas.getContext('2d');
      on = false;
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (tcv && tcv.width) tcv.getContext('2d').clearRect(0, 0, tcv.width, tcv.height);
      if (a.priceStyle !== FP_TYPE || !a.data || !a.bars.length) return;
      const co = a.coords, dpr = co.dpr || 1;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const d = a.data, cfg = d.cfg;
      const tfm = tfMin(d.timeframe), f = (d.eng && tfm >= 1 && tfm <= MAX_TF_MIN && d.eng.l2Flow(a.bars, tfm)) || flowFor({ root: d.root, timeframe: d.timeframe, bars: a.bars, owner: d.eng });
      let top = a.bounds.top; const day = light(); let bot = top + a.bounds.height;
      const P = pal(cfg, day), { UP, UP2, DN, SELL, SELL2, TEAL, ORNG, PINK } = P;
      const ink = day ? '#1f2937' : '#d7dbe2', dim = day ? '#64748b' : '#8a90a0';
      g.save(); g.beginPath(); g.rect(0, top, co.width, a.bounds.height); g.clip();
      if (f.note) {
        // a small pill like the GEX chip: one short line, sans font, never wider than the plot
        g.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        const maxW = Math.max(60, co.width - 16);
        let txt = String(f.note);
        while (txt.length > 8 && g.measureText(txt).width + 20 > maxW) txt = txt.slice(0, -2).replace(/\s+$/, '') + '…';
        const w = Math.round(g.measureText(txt).width + 20), h = 22, x = Math.round((co.width - 56 - w) / 2), y = Math.round(bot - 66);
        g.fillStyle = day ? 'rgba(255,255,255,0.94)' : 'rgba(15,15,15,0.88)';
        g.strokeStyle = day ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.1)'; g.lineWidth = 1;
        g.beginPath(); if (g.roundRect) g.roundRect(x + .5, y + .5, w, h, 11); else g.rect(x + .5, y + .5, w, h);
        g.fill(); g.stroke();
        g.fillStyle = f.locked ? CYAN : (day ? '#334155' : '#cbd5e1'); g.fillText(txt, x + w / 2, y + h / 2 + .5);
      }
      if (!f.map || !f.map.size) { g.restore(); return; }
      const tick = f.tick;
      let bw = co.pxPerBar();
      // First paint of this footprint: open the chart with bars wide enough for the numbers (phone ~64 px,
      // desktop ~84 px per bar). Once per engine start; later zoom is the member's own.
      if (d.eng && !d.eng.fitted && a.bars.length > 5) {
        d.eng.fitted = true;
        const want = co.width < 520 ? 64 : 84;
        if (bw < want) {
          try {
            const vp = co.getViewport();
            const ws = window.STRYKER_VELA, rr = ws && ws.chart && ws.chart.renderer;
            const ctl = rr && (rr.applyViewport ? rr : rr.renderer);
            if (ctl && ctl.applyViewport) { ctl.applyViewport({ barSpacing: vp.barSpacing * want / bw, rightOffset: Math.max(vp.rightOffset, 4) }); bw = want; }
          } catch (e) {}
        }
      }
      const vr = co.visibleLogicalRange();
      const i0 = Math.max(0, Math.floor(vr.from) - 1), i1 = Math.min(a.bars.length - 1, Math.ceil(vr.to) + 1);
      const tickPx = Math.abs(co.priceToY(a.scale.min + tick, a.scale, a.bounds) - co.priceToY(a.scale.min, a.scale, a.bounds));
      let m = cfg.rows || 1;
      const compact = bw < 30;   // phone zoom: coloured cells per price level, no numbers
      if (!cfg.rows) for (const s of ROW_STEPS) { m = s; if (tickPx * s >= (compact ? 7 : 13)) break; }
      const rowPx = tickPx * m;
      const cells = bw >= 6 && rowPx >= (compact ? 3.5 : 9);
      const plotR = co.width - 56, X = { UP: P.UP, DN: P.DN, eng: d.eng, g, co, a, f, cfg, i0, i1, m, tick, bw, rowPx, compact, top, bot, day, plotR };
      // Bar stats table and the delta + volume strip each sit at a corner the member picks (top / bottom edge). On the same edge the
      // strip stacks next to the table, so the two never overlap, and the cells + the volume histogram keep clear of both.
      const tblTop = cfg.tblPos[0] === 't', stTop = cfg.statsPos[0] === 't';
      const statsH = cfg.stats && cells && !compact && cfg.mode !== 'boxes' && cfg.mode !== 'dbars' ? 30 : 0;
      const bot0 = bot;
      let tblH = 0;
      if (cfg.table && i1 >= i0) { X.tblY = tblTop ? top + (compact || co.width < 520 ? TOP_OFF_PHONE : TOP_OFF) : null; const tc = tableCanvas(), tg = tc && tc.getContext('2d'); if (tg) { tg.setTransform(dpr, 0, 0, dpr, 0, 0); X.g = tg; } tblH = drawTable(X); X.g = g; }
      let topUsed = 0, botUsed = 0;
      const tOff = co.width < 520 ? TOP_OFF_PHONE : TOP_OFF;
      if (tblH) { if (tblTop) topUsed = tOff + tblH; else botUsed = tblH; }
      let stY = 0;
      if (statsH) { if (stTop) { stY = top + (topUsed || tOff); topUsed = (topUsed || tOff) + statsH; } else { botUsed += statsH; stY = bot0 - botUsed; } }
      if (window.__stkFpDebug) window.__stkFpDebug.strip = statsH ? { y0: stY, h: statsH } : null;
      if (d.eng && d.eng.reserve) d.eng.reserve(Math.max(botUsed, cfg.mode === 'boxes' || cfg.mode === 'dbars' ? a.bounds.height * 0.17 : 0), a.bounds.height, topUsed);   // the volume histogram stays below the cells   // drawn first: the bars and stats sit above it
      bot -= botUsed; X.bot = bot; top += topUsed; X.top = top; X.topUsed = topUsed;
      stats = tblH > 0 || statsH > 0;
      const pill = (txt) => {
        g.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        const pw = Math.round(g.measureText(txt).width + 20), px = Math.round((co.width - 56 - pw) / 2), py = Math.round(bot - 66);
        g.fillStyle = day ? 'rgba(255,255,255,0.94)' : 'rgba(15,15,15,0.88)'; g.strokeStyle = alpha(CYAN, 0.6); g.lineWidth = 1;
        g.beginPath(); if (g.roundRect) g.roundRect(px + .5, py + .5, pw, 22, 11); else g.rect(px + .5, py + .5, pw, 22); g.fill(); g.stroke();
        g.fillStyle = day ? '#0e7490' : '#7fe3e8'; g.fillText(txt, px + pw / 2, py + 11.5);
      };
      if (!cells) {
        // zoomed out: candles coloured by the bar's delta (strength = |delta| / volume)
        for (let i = i0; i <= i1; i++) {
          const bar = a.bars[i], fb = f.map.get(bar.time);
          if (!fb || !fb.vol) continue;
          const x = co.logicalToX(i), w = Math.max(1, Math.floor(bw * 0.7));
          const yO = co.priceToY(bar.open, a.scale, a.bounds), yC = co.priceToY(bar.close, a.scale, a.bounds);
          const r = fb.delta / fb.vol;
          g.fillStyle = alpha(fb.delta >= 0 ? UP : SELL, 0.35 + 0.65 * Math.min(1, Math.abs(r) * 2.5));
          g.fillRect(Math.round(x - w / 2), Math.min(yO, yC), w, Math.max(1, Math.abs(yC - yO)));
        }
        pill('Zoom in to see footprint');
        g.restore(); lastMs = performance.now() - t0; if (window.__stkFpStats) window.__stkFpStats.push(lastMs); return;
      }
      on = true;
      stats = true;
      if (cfg.mode === 'dbars') {
        const txt = drawDbars(X);
        if (!txt && !f.note) pill('Zoom in to see the numbers');
        g.restore(); lastMs = performance.now() - t0; if (window.__stkFpStats) window.__stkFpStats.push(lastMs); return;
      }
      if (cfg.mode === 'boxes') {
        const txt = drawBoxes(X);
        if (!txt && !f.note) pill('Zoom in to see the numbers');
        g.restore(); lastMs = performance.now() - t0; if (window.__stkFpStats) window.__stkFpStats.push(lastMs); return;
      }
      let anyText = false;
      let fs = clamp(Math.floor(Math.min(rowPx - 2, bw / 6.5)), 8, 13);
      let font = fs + 'px ' + MONO, bold = '600 ' + fs + 'px ' + MONO;
      g.textBaseline = 'middle';
      const ladW = Math.max(0, bw * (compact ? 0.88 : 0.92) - 12);   // room right of the candle inside this bar's slot
      const lv = (r) => (cfg.ladShow === 'delta' ? Math.abs(r.buy - r.sell) : r.buy + r.sell);
      const vmaxV = cfg.auto ? visMaxVol(X) : 1;
      let gmax = 1;
      if (cfg.mode === 'ladder' && cfg.scale !== 'bar') {
        for (let i = i0; i <= i1; i++) {
          const fb = f.map.get(a.bars[i].time); if (!fb) continue;
          for (const r of rowsOf(fb, m).rs) { const q = lv(r); if (q > gmax) gmax = q; }
        }
      }
      for (let i = i0; i <= i1; i++) {
        const bar = a.bars[i], fb = f.map.get(bar.time);
        if (!fb) continue;
        const { rs, poc: pk } = rowsOf(fb, m);
        if (!rs.length) continue;
        const x = co.logicalToX(i), w = Math.max(5, bw * (compact ? 0.88 : 0.92)), xl = x - w / 2;
        let max = 1;
        for (const r of rs) { const v = r.buy + r.sell; if (v > max) max = v; }
        const imb = imbalances(rs, cfg.imb);
        const st = stacked(imb, cfg.stack);
        const lad = cfg.mode === 'ladder', cx = x;   // the base candle's own wick sits on x, so ours lines up with it
        // numbers show whenever they fit: the font shrinks (down to 8 px) to the widest number in this bar
        let showText;
        if (lad) showText = rowPx >= 10 && ladW >= 8 * 1.3;
        else {
          let ch = 1;
          for (const r of rs) {
            const n = cfg.mode === 'bidask' ? Math.max(fmt(r.sell).length, fmt(r.buy).length) : cfg.mode === 'delta' ? sgn(r.buy - r.sell).length : fmt(r.buy + r.sell).length;
            if (n > ch) ch = n;
          }
          const avail = (cfg.mode === 'bidask' ? w / 2 - 2 : w - 2);
          const f1 = Math.min(clamp(Math.floor(rowPx - 2) + cfg.adj, 7, cfg.adj > 0 ? Math.max(13, Math.floor(rowPx - 1)) : 13), Math.floor(avail / (0.6 * ch)));
          showText = rowPx >= 9 && f1 >= 7;
          if (showText) { fs = Math.min(f1, cfg.adj > 0 ? 16 : 13); font = fs + 'px ' + MONO; bold = '600 ' + fs + 'px ' + MONO; }
        }
        if (showText) anyText = true;
        let dmax = lad ? gmax : 1;
        if (lad && cfg.scale === 'bar') { dmax = 1; for (const r of rs) { const q = lv(r); if (q > dmax) dmax = q; } }
        if (lad) {
          // thin candle on the left (real OHLC), ladder of per-level deltas on its right
          const up = bar.close >= bar.open, cc = up ? UP : P.ladDN;
          const yH = co.priceToY(bar.high, a.scale, a.bounds), yL = co.priceToY(bar.low, a.scale, a.bounds);
          const yO = co.priceToY(bar.open, a.scale, a.bounds), yC = co.priceToY(bar.close, a.scale, a.bounds);
          const cw = bw >= 30 ? 5 : 3;
          g.fillStyle = cc; g.fillRect(Math.round(cx), Math.min(yH, yL), 1, Math.max(1, Math.abs(yL - yH)));
          g.fillRect(Math.round(cx - cw / 2 + 0.5), Math.min(yO, yC), cw, Math.max(1.5, Math.abs(yC - yO)));
        }
        for (let k = 0; k < rs.length; k++) {
          const r = rs[k];
          const yT = co.priceToY((r.p + m) * tick, a.scale, a.bounds), yB = co.priceToY(r.p * tick, a.scale, a.bounds);
          const y = Math.min(yT, yB), h = Math.abs(yB - yT);
          if (y > bot || y + h < top) continue;
          const v = r.buy + r.sell, dl = r.buy - r.sell;
          let fontR = font, boldR = bold;
          if (cfg.auto && showText) { const fa = Math.max(7, Math.min(autoFont(cfg, v, vmaxV), Math.floor(rowPx - 1), 16)); fontR = fa + 'px ' + MONO; boldR = '600 ' + fa + 'px ' + MONO; }
          if (lad) {
            if (cfg.poc && k === pk) { g.strokeStyle = day ? '#a16207' : POCY; g.lineWidth = 1.2; g.strokeRect(cx + 5.5, y + 0.5, ladW, Math.max(1, h - 1)); }
            if (h < 3) continue;
            const q = lv(r), vol = cfg.ladShow !== 'delta';
            if (q >= 0.25 * dmax && q > 0) {
              const c = vol ? (dl > 0 ? UP : dl < 0 ? DN : '#8a90a0') : (dl >= 0 ? UP : DN);
              const bw2 = Math.max(2, Math.min(ladW, ladW * q / dmax));
              g.fillStyle = alpha(c, 0.78);
              g.fillRect(cx + 6, y + 0.5, bw2, Math.max(1, h - 1));
              g.fillStyle = day ? alpha(c, 1) : alpha(vol ? (dl > 0 ? UP2 : dl < 0 ? (P.sellC || '#ff7a85') : '#c4c8d2') : (dl >= 0 ? UP2 : (P.sellC || '#ff7a85')), 1);
              g.fillRect(cx + 6, y + 0.5, 1, Math.max(1, h - 1));
            }
            if (!showText) continue;
            const txt = vol ? fmt(q) : (dl < 0 ? '-' : '') + fmt(q);
            if (txt.length * parseFloat(fontR) * 0.62 > ladW - 2) continue;
            g.textAlign = 'left'; g.font = fontR;
            if (!day) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(txt, cx + 9, y + h / 2 + 1); }
            g.fillStyle = day ? '#0b1220' : '#ffffff';
            g.fillText(txt, cx + 8, y + h / 2);
            continue;
          }
          if (cfg.mode === 'bidask') {
            // plain numbers on the chart background (left = sells hit the bid, right = buys lifted the
            // ask); only a faint tint behind the side that dominated the row. Zoomed out (no numbers):
            // the tint is the cell, so it stays stronger.
            const sd = r.sell > r.buy, bd = r.buy > r.sell;
            const bare = !showText;   // no numbers at this zoom: the tint is the cell
            const base = bare ? 0.2 : 0.03, span = bare ? 0.7 : 0.16;
            g.fillStyle = alpha(SELL, base + span * (r.sell / max) * (sd || bare ? 1 : 0.3) + (imb.sell[k] ? 0.12 : 0));
            g.fillRect(xl, y + 0.5, w / 2 - 0.5, Math.max(1, h - 1));
            g.fillStyle = alpha(UP, base + span * (r.buy / max) * (bd || bare ? 1 : 0.3) + (imb.buy[k] ? 0.12 : 0));
            g.fillRect(x + 0.5, y + 0.5, w / 2 - 0.5, Math.max(1, h - 1));
          } else {
            g.fillStyle = cfg.mode === 'delta' ? alpha(dl >= 0 ? UP : SELL, 0.06 + 0.45 * Math.abs(dl) / max) : alpha(CYAN, 0.06 + 0.4 * v / max);
            g.fillRect(xl, y + 0.5, w, Math.max(1, h - 1));
          }
          if (cfg.poc && k === pk) { g.strokeStyle = day ? '#a16207' : POCY; g.lineWidth = 1.3; g.strokeRect(xl + 0.5, y + 0.5, w - 1, Math.max(1, h - 1)); }
          if (!showText) continue;
          const yc = y + h / 2;
          if (cfg.mode === 'bidask') {
            // the side that dominated the row is coloured (sellers purple, buyers green), the other grey;
            // an imbalance is bold and bright
            const sC = imb.sell[k] ? P.sT : r.sell > r.buy ? (P.sellC || (day ? '#7c3aed' : '#b48cf0')) : (day ? ink : dim);
            const bC = imb.buy[k] ? P.gT : r.buy > r.sell ? (P.buyC || (day ? '#059669' : '#3fcf98')) : (day ? ink : dim);
            g.textAlign = 'right'; g.font = imb.sell[k] ? boldR : fontR; g.fillStyle = sC;
            g.fillText(fmt(r.sell), x - 2, yc);
            g.textAlign = 'left'; g.font = imb.buy[k] ? boldR : fontR; g.fillStyle = bC;
            g.fillText(fmt(r.buy), x + 2, yc);
          } else {
            g.textAlign = 'center'; g.font = fontR;
            g.fillStyle = cfg.mode === 'delta' ? (dl >= 0 ? P.gT : P.sT) : ink;
            g.fillText(cfg.mode === 'delta' ? sgn(dl) : fmt(v), x, yc);
          }
        }
        // stacked imbalances: a bar on the buy (right) or sell (left) edge spanning the run
        for (const sx of st) {
          const yA = co.priceToY((rs[sx.k1].p + m) * tick, a.scale, a.bounds), yZ = co.priceToY(rs[sx.k0].p * tick, a.scale, a.bounds);
          g.fillStyle = sx.side ? UP : (cfg.mode === 'ladder' ? DN : SELL);
          if (cfg.mode === 'ladder') { g.fillRect(cx + 3, Math.min(yA, yZ), 2, Math.abs(yZ - yA)); continue; }
          g.fillRect(sx.side ? xl + w + 1 : xl - 4, Math.min(yA, yZ), 3, Math.abs(yZ - yA));
        }
        // unfinished auction: both sides traded at the extreme row -> amber tick past the edge
        if (cfg.unf) {
          const u = unfinished(rs);
          g.strokeStyle = '#f5b301'; g.lineWidth = 2;
          if (u.high) { const y = co.priceToY((rs[rs.length - 1].p + m) * tick, a.scale, a.bounds); g.beginPath(); g.moveTo(xl, y - 2); g.lineTo(xl + w, y - 2); g.stroke(); }
          if (u.low) { const y = co.priceToY(rs[0].p * tick, a.scale, a.bounds); g.beginPath(); g.moveTo(xl, y + 2); g.lineTo(xl + w, y + 2); g.stroke(); }
        }
        if (statsH) {
          const y0 = stY;
          g.fillStyle = day ? 'rgba(255,255,255,0.9)' : 'rgba(11,11,13,0.88)';
          g.fillRect(xl - 1, y0, w + 2, statsH);
          g.textAlign = 'center'; g.font = bold;
          g.fillStyle = fb.delta >= 0 ? P.gT : P.sT;
          g.fillText(sgn(fb.delta), x, y0 + 8);
          g.font = font; g.fillStyle = dim;
          g.fillText(fmt(fb.vol), x, y0 + 22);
        }
      }
      if (statsH) {
        const sl = cfg.statsPos[1] === 'l';
        g.font = (10 + Math.min(cfg.adj, 2)) + 'px ' + MONO; g.textAlign = sl ? 'left' : 'right'; g.fillStyle = dim;
        const lx = sl ? 4 : plotR - 4;
        g.fillStyle = day ? 'rgba(255,255,255,0.9)' : 'rgba(11,11,13,0.88)'; g.fillRect(sl ? 0 : plotR - 30, stY, 30, statsH); g.fillStyle = dim;
        g.fillText('Δ', lx, stY + 8); g.fillText('Vol', lx, stY + 22);
      }
      if (!anyText && !f.note) pill('Zoom in to see the numbers');
      g.restore();
      lastMs = performance.now() - t0;
      if (window.__stkFpStats) window.__stkFpStats.push(lastMs);
    },
    modulateBase(a) { return on && a && a.priceStyle === FP_TYPE ? (a.data && a.data.cfg && (a.data.cfg.mode === 'ladder' || a.data.cfg.mode === 'boxes' || a.data.cfg.mode === 'dbars') ? { candleBodyScale: 0.1, candleBodyAlpha: 0 } : { candleBodyScale: 0.1, candleBodyAlpha: 0.7 }) : null; },
    destroy() { if (tcv && tcv.parentNode) tcv.parentNode.removeChild(tcv); tcv = null; canvas = null; }
  };
}

const FP_ICON = '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="6" y="5" width="16" height="18" rx="1.5"/><path d="M14 5v18M6 11h16M6 17h16"/></svg>';

// ---------------------------------------------------------------- indicators (group "Order Flow")
const IND = {
  stk_of_delta: { title: 'Delta (trades)', short: 'Delta', pane: 'new', overlay: false, schema: [
    { key: 'upColor', title: 'Positive', type: 'color', defval: UP }, { key: 'downColor', title: 'Negative', type: 'color', defval: DN }] },
  stk_of_cvd: { title: 'Cumulative Delta (trades)', short: 'CVD', pane: 'new', overlay: false, schema: [
    { key: 'style', title: 'Show as', type: 'string', defval: 'candles', options: ['candles', 'line'] },
    { key: 'reset', title: 'Reset', type: 'string', defval: 'session', options: ['session', 'day', 'none'], tooltip: 'session = the CME day (18:00 New York).' },
    { key: 'upColor', title: 'Up', type: 'color', defval: UP }, { key: 'downColor', title: 'Down', type: 'color', defval: DN }] },
  stk_of_big: { title: 'Big Trades', short: 'Big Trades', pane: 'price', overlay: true, schema: BT.schema({ buy: UP, sell: DN }) },
  stk_of_vp: { title: 'Volume Profile (trades: session / swing + naked POC)', short: 'VP (trades)', pane: 'price', overlay: true, schema: [
    { key: 'range', title: 'Range', type: 'string', defval: 'session', options: ['session', 'swing', 'visible'], tooltip: 'session = the CME day (18:00 New York). swing = from one swing high / low to the next.' },
    { key: 'swingLen', title: 'Swing strength (bars each side)', type: 'int', defval: 10, min: 2, max: 100, step: 1, when: { key: 'range', anyOf: ['swing'] } },
    { key: 'rowTicks', title: 'Row size (ticks, 0 = auto)', type: 'int', defval: 0, min: 0, max: 400, step: 1 },
    { key: 'va', title: 'Value area %', type: 'int', defval: 70, min: 10, max: 100, step: 1 },
    { key: 'widthPct', title: 'Width %', type: 'int', defval: 30, min: 5, max: 100, step: 1 },
    { key: 'colorMode', title: 'Colour', type: 'string', defval: 'value area', options: ['value area', 'buy / sell'], tooltip: 'value area = one colour per row, orange inside the value area and khaki outside. buy / sell = each row split into sellers and buyers.' },
    { key: 'vaColor', title: 'Value area', type: 'color', defval: VA_OR, when: { key: 'colorMode', anyOf: ['value area'] } },
    { key: 'outColor', title: 'Outside value area', type: 'color', defval: VA_OUT, when: { key: 'colorMode', anyOf: ['value area'] } },
    { key: 'pocColor', title: 'POC', type: 'color', defval: MAG },
    { key: 'vaLineColor', title: 'VAH / VAL lines', type: 'color', defval: VA_LN },
    { key: 'naked', title: 'Naked POC lines (until revisited)', type: 'bool', defval: true, when: { key: 'range', anyOf: ['session', 'swing'] } }] },
  stk_of_vwap: { title: 'VWAP (trades, ±1/2 SD)', short: 'VWAP (trades)', pane: 'price', overlay: true, schema: [
    { key: 'reset', title: 'Reset', type: 'string', defval: 'session', options: ['session', 'day'] },
    { key: 'bands', title: 'SD bands', type: 'string', defval: '1 and 2', options: ['none', '1', '1 and 2'] },
    { key: 'color', title: 'VWAP colour', type: 'color', defval: CYAN }] }
};
export const OF_TYPES = Object.keys(IND);
const defaults = (schema) => Object.fromEntries(schema.map((i) => [i.key, i.defval]));

function msgTable(id, text, locked) {
  const day = light();
  return { id, paneId: '', position: 'bottom_center', columns: 1, rows: 1, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)', frameWidth: 0, borderWidth: 0,
    cells: [[{ text, textColor: locked ? CYAN : (day ? '#334155' : '#a3a9b6'), hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'monospace', bold: false, italic: false }]], merges: [] };
}

class OfNative {
  constructor(type) { this.type = type; this.inputs = {}; this.tm = 0; this.onAny = () => this.later(); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(defaults(IND[this.type].schema), this.type === 'stk_of_big' ? BT.migrate(inputs) : inputs); users++; startRefresh(); listeners.add(this.onAny); this.render(); }
  later() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 250); }
  onBars() { this.later(); }
  onViewport() { if (this.type === 'stk_of_vp' || this.type === 'stk_of_big') this.render(); }
  setInputs(i) { this.inputs = Object.assign(defaults(IND[this.type].schema), this.type === 'stk_of_big' ? BT.migrate(i) : i); this.render(); }
  suspend() { listeners.delete(this.onAny); }
  resume() { listeners.add(this.onAny); this.render(); }
  // the layer canvas outlives the indicator on some engines: push an empty frame so it clears
  stop() { listeners.delete(this.onAny); clearTimeout(this.tm); users--; stopRefresh(); this.off = true; try { if (this.ctx) this.ctx.pushData({ owner: this, off: true }); } catch (e) {} }
  render() {
    if (!this.ctx || this.off) return;
    const bars = this.ctx.bars();
    const f = flowFor({ root: rootOf(this.ctx), timeframe: this.ctx.timeframe, bars, owner: this });
    const tables = f.note ? [msgTable(this.type + '-msg', f.note, f.locked)] : [];
    this.ctx.setStatus(f.loading ? 'loading' : 'idle');
    const I = this.inputs, map = f.map || new Map();
    const t = this.type;
    if (t === 'stk_of_delta') {
      const pts = bars.map((b) => { const x = map.get(b.time); return x ? { time: b.time, value: x.delta, color: x.delta >= 0 ? I.upColor : I.downColor } : { time: b.time, value: null }; });
      this.ctx.emit({ series: [{ id: 'of-delta', title: 'Delta', paneId: '', kind: 'histogram', points: pts, style: { color: I.upColor, width: 1, lineStyle: 'solid', base: 0 } }], tables });
      return;
    }
    if (t === 'stk_of_cvd') {
      const list = f.list || [];
      const cc = cvdCandles(list, f.crypto && I.reset === 'session' ? 'day' : I.reset, sessionOf);   // crypto has no CME session: UTC day
      const byT = new Map(); cc.forEach((c) => byT.set(c.t, c));
      // crypto: always a line (Vela's candle series did not draw for a feed that backfills after the pane exists)
      if (I.style === 'line' || f.crypto) {
        const pts = bars.map((b) => { const c = byT.get(b.time); return c ? { time: b.time, value: c.c } : { time: b.time, value: null }; });
        this.ctx.emit({ series: [{ id: 'of-cvd', title: 'CVD', paneId: '', kind: 'line', points: pts, style: { color: I.upColor, width: 2, lineStyle: 'solid' } }], tables });
      } else {
        const cb = bars.map((b) => { const c = byT.get(b.time); return c ? { time: b.time, open: c.o, high: c.h, low: c.l, close: c.c } : null; }).filter(Boolean); // null entries made Vela's modelToValuePatch throw on every render for bars without trades
        if (!cb.length || f.partial) { this.ctx.emit({ tables }); return; }   // an empty candle series first left the pane blank for good once trades arrived (crypto)
        this.ctx.emit({ series: [{ id: 'of-cvd', title: 'CVD', paneId: '', kind: 'candle', bars: cb, style: { up: I.upColor, down: I.downColor } }], tables });
      }
      return;
    }
    if (t === 'stk_of_vwap') {
      const vw = vwapSeries(f.list || [], f.tick || 0.25, I.reset, sessionOf);
      const byT = new Map(); vw.forEach((v) => byT.set(v.t, v));
      const mk = (id, title, k, color, width, style) => ({ id, title, paneId: '', kind: 'line',
        points: bars.map((b) => { const v = byT.get(b.time); return v && v.vwap != null ? { time: b.time, value: v.vwap + k * v.sd } : { time: b.time, value: null }; }),
        style: { color, width, lineStyle: style } });
      const series = [mk('of-vwap', 'VWAP', 0, I.color, 2, 'solid')];
      if (I.bands !== 'none') { series.push(mk('of-u1', '+1 SD', 1, alpha(I.color, 0.7), 1, 'dashed'), mk('of-l1', '-1 SD', -1, alpha(I.color, 0.7), 1, 'dashed')); }
      if (I.bands === '1 and 2') { series.push(mk('of-u2', '+2 SD', 2, alpha(I.color, 0.45), 1, 'dotted'), mk('of-l2', '-2 SD', -2, alpha(I.color, 0.45), 1, 'dotted')); }
      this.ctx.emit({ series, tables });
      return;
    }
    // layer-drawn tools: push the inputs + a version; the layer reads flowFor itself
    this.ctx.emit({ tables });
    this.ctx.pushData({ owner: this, root: rootOf(this.ctx), timeframe: this.ctx.timeframe, inputs: I, v: version, vr: this.ctx.bars().length });
  }
}

function frame(canvas, a) {
  const g = canvas && canvas.getContext('2d');
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!a.data || a.data.off || !a.bars.length) return null;
  const dpr = a.coords.dpr || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}
function idxOf(bars, t) {   // last chart bar with time <= t
  let lo = 0, hi = bars.length - 1, r = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].time <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
}

function bigLayer() {
  let canvas = null, memo = null;
  return {
    mount(c) { canvas = c; BT.installTip(c); },
    render(a) {
      if (!frame(canvas, a)) return;
      const d = a.data, I = d.inputs;
      const f = flowFor({ root: d.root, timeframe: d.timeframe, bars: a.bars, owner: d.owner });
      if (!f.mins || !f.mins.length) return;
      const last = f.mins[f.mins.length - 1], tf = (tfMin(d.timeframe) || 1) * 60000, lb = a.bars[a.bars.length - 1];
      const key = f.mins.length + '|' + f.mins[0].t + '|' + last.t + '|' + last.bigs.length + '|' + JSON.stringify(I) + '|' + a.bars.length + '|' + (lb && lb.close);
      if (!memo || memo.key !== key) {
        const prints = []; for (const b of f.mins) for (const x of b.bigs || []) prints.push(x);
        memo = { key, sel: BT.select(prints, I, { floor: 0, bars: a.bars, tfMs: tf, tick: f.tick }) };
      }
      BT.draw(canvas, a, memo.sel, I, f.tick, { frame, idxOf, alpha, light, replayE, MONO });
    },
    destroy() { canvas = null; }
  };
}

// Segments of the order-flow bars (chart timeframe) for the profile: per CME session, or per swing
// (pivot to pivot, the last one still developing). Cached per data version + settings.
function vpSegments(f, I) {
  const L = f.list;
  if (I.range === 'swing') {
    const len = clamp(Math.round(num(I.swingLen, 10)), 2, 100);
    return swingSegments(L.map((b) => b.hi), L.map((b) => b.lo), len).map((s) => ({ i0: s.i0, i1: s.i1, open: !!s.open }));
  }
  const out = [];
  let cur = null;
  L.forEach((b, i) => {
    const k = f.crypto ? Math.floor(b.t / 86400000) : sessionOf(b.t);
    if (!cur || cur.k !== k) { if (cur) out.push(cur); cur = { k, i0: i, i1: i }; } else cur.i1 = i;
  });
  if (cur) { cur.open = true; out.push(cur); }
  return out;
}
function vpLayer() {
  let canvas = null, memo = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a);
      if (!g) return;
      const d = a.data, co = a.coords, I = d.inputs;
      const f = flowFor({ root: d.root, timeframe: d.timeframe, bars: a.bars, owner: d.owner });
      if (!f.list || !f.list.length) return;
      const tick = f.tick, vr = co.visibleLogicalRange(), ppb = co.pxPerBar();
      const i0 = Math.max(0, Math.floor(vr.from)), i1 = Math.min(a.bars.length - 1, Math.ceil(vr.to));
      const tickPx = Math.abs(co.priceToY(a.scale.min + tick, a.scale, a.bounds) - co.priceToY(a.scale.min, a.scale, a.bounds));
      let m = I.rowTicks || 1;
      if (!I.rowTicks) for (const s of ROW_STEPS) { m = s; if (tickPx * s >= 3) break; }
      const top = a.bounds.top;
      const xOf = (t, end) => { const i = idxOf(a.bars, t); return i < 0 ? null : co.logicalToX(i) + (end ? ppb / 2 : -ppb / 2); };
      const groups = [];
      let naked = [];
      if (I.range === 'visible') {
        const t0 = a.bars[i0].time, t1 = a.bars[i1].time;
        groups.push({ bars: f.list.filter((b) => b.t >= t0 && b.t <= t1), x0: co.logicalToX(i0), x1: co.width - 60, right: true });
      } else {
        // naked POCs use a fixed row (the input, else 4 ticks) so they do not move with the zoom
        const L = f.list, last = L[L.length - 1], mN = I.rowTicks || 4;
        const key = I.range + '|' + I.swingLen + '|' + mN + '|' + L.length + '|' + L[0].t + '|' + last.t + '|' + last.vol;
        if (!memo || memo.key !== key) {
          const segs = vpSegments(f, I);
          const done = segs.filter((s) => !s.open).map((s) => { const p = profile(L.slice(s.i0, s.i1 + 1), mN, 70); return { i1: s.i1, t: L[s.i1].t, poc: p ? p.poc : null }; }).filter((s) => s.poc != null);
          const hit = pocRevisits(done, L, mN);
          memo = { key, segs, naked: done.map((s, k) => ({ t: s.t, price: (s.poc + 0.5) * mN * tick, hit: hit[k] < 0 ? null : L[hit[k]].t })) };
        }
        const tA = a.bars[i0].time, tB = a.bars[i1].time;
        for (const s of memo.segs) {
          const L0 = f.list[s.i0].t, L1 = f.list[s.i1].t;
          if (L1 < tA || L0 > tB) continue;
          const x0 = xOf(L0, false), x1 = xOf(L1, true);
          if (x0 == null || x1 == null) continue;
          groups.push({ bars: f.list.slice(s.i0, s.i1 + 1), x0, x1, open: !!s.open });
        }
        if (I.naked !== false) naked = memo.naked;
      }
      const split = I.colorMode === 'buy / sell';
      const vaC = I.vaColor || VA_OR, outC = I.outColor || VA_OUT, pocC = I.pocColor || MAG, vaL = I.vaLineColor || VA_LN;
      g.save(); g.beginPath(); g.rect(0, top, co.width, a.bounds.height); g.clip();
      for (const gr of groups) {
        const p = profile(gr.bars, m, I.va);
        if (!p) continue;
        let max = 1;
        for (let k = 0; k < p.n; k++) max = Math.max(max, p.buy[k] + p.sell[k]);
        const span = Math.max(20, gr.x1 - gr.x0) * I.widthPct / 100;
        for (let k = 0; k < p.n; k++) {
          const v = p.buy[k] + p.sell[k];
          if (!v) continue;
          const r = p.r0 + k;
          const yT = co.priceToY((r + 1) * m * tick, a.scale, a.bounds), yB = co.priceToY(r * m * tick, a.scale, a.bounds);
          const y = Math.min(yT, yB), h = Math.max(1, Math.abs(yB - yT) - (tickPx * m > 3 ? 1 : 0));
          const inVa = r >= p.val && r <= p.vah;
          const ws = span * p.sell[k] / max, wb = span * p.buy[k] / max;
          const xs = gr.right ? gr.x1 - ws - wb : gr.x0;
          if (split) {
            g.fillStyle = alpha(SELL, inVa ? 0.55 : 0.28); g.fillRect(xs, y, ws, h);
            g.fillStyle = alpha(UP, inVa ? 0.55 : 0.28); g.fillRect(xs + ws, y, wb, h);
          } else {
            // one colour per row: orange in the value area, khaki outside, a lighter tip on the edge
            const c = inVa ? vaC : outC;
            g.fillStyle = alpha(c, r === p.poc ? 0.95 : 0.78); g.fillRect(xs, y, ws + wb, h);
            if (ws + wb > 3) { g.fillStyle = alpha(c, 1); g.fillRect(gr.right ? xs : xs + ws + wb - 1, y, 1, h); }
          }
        }
        // POC + VAH/VAL: the developing (last) profile's lines run to the right edge
        const xEnd = gr.open ? co.width : gr.x1;
        const line = (r, color, w, dash) => { const y = co.priceToY((r + 0.5) * m * tick, a.scale, a.bounds); g.setLineDash(dash); g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(gr.x0, y); g.lineTo(xEnd, y); g.stroke(); };
        line(p.poc, alpha(pocC, 0.95), 1.5, []);
        line(p.vah, alpha(vaL, 0.75), 1, [4, 3]);
        line(p.val, alpha(vaL, 0.75), 1, [4, 3]);
        g.setLineDash([]);
      }
      // naked POCs: from the end of their segment to the bar that traded back through them (or the
      // right edge while still naked, with a tag)
      const phone = co.width < 520;
      g.font = '600 ' + (phone ? 9 : 10) + 'px ' + MONO; g.textBaseline = 'middle'; g.textAlign = 'right';
      for (const n of naked) {
        if (n.hit != null) continue;
        const xa = xOf(n.t, true);
        if (xa == null || xa > co.width) continue;
        const y = co.priceToY(n.price, a.scale, a.bounds);
        if (y < top || y > top + a.bounds.height) continue;
        g.setLineDash([2, 3]); g.strokeStyle = alpha(pocC, 0.85); g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(Math.max(0, xa), y); g.lineTo(co.width, y); g.stroke(); g.setLineDash([]);
        const txt = 'nPOC';
        const w = g.measureText(txt).width + 6;
        g.fillStyle = light() ? 'rgba(255,255,255,0.9)' : 'rgba(11,11,13,0.85)'; g.fillRect(co.width - w - 4, y - 7, w, 14);
        g.fillStyle = pocC; g.fillText(txt, co.width - 7, y);
      }
      g.restore();
    },
    destroy() { canvas = null; }
  };
}

// ---------------------------------------------------------------- install
let installed = false;
export function installFootprint(Core, flowMod) {
  if (installed) { linkFlow(flowMod); return; }
  installed = true;
  try { installChartTypes(Core); } catch (e) { console.warn('TradeZoro: chart types', e); }   // assets/chart-types.js
  Core.registerRendererLayer({ id: FP_TYPE, placement: 'above-data', create: footprintLayer });
  Core.registerChartType({
    id: FP_TYPE, label: 'Volume footprint', icon: FP_ICON,
    dataEngine: () => new FootprintEngine(),
    settings: {
      title: 'Volume footprint',
      rows: [
        { kind: 'select', key: 'fpStyle', label: 'Style', defval: FP_DEF.fpStyle, options: [['classic', 'Classic (Bid x Ask)'], ['delta', 'Delta'], ['volume', 'Volume'], ['ladder', 'Ladder (candle + level bars)'], ['boxes', 'Delta boxes'], ['dbars', 'Delta bars']] },
        { kind: 'select', key: 'fpSrc', label: 'Data source (futures)', defval: FP_DEF.fpSrc, options: [['l2', 'L2 (order book feed)'], ['l1', 'L1 (trades)']] },
        { kind: 'select', key: 'fpScale', label: 'Ladder bar scale', defval: FP_DEF.fpScale, options: [['range', 'Visible range'], ['bar', 'Per bar']], when: { key: 'fpStyle', anyOf: ['ladder'] } },
        { kind: 'select', key: 'fpLadShow', label: 'Ladder shows', defval: FP_DEF.fpLadShow, options: [['volume', 'Volume'], ['delta', 'Delta']], when: { key: 'fpStyle', anyOf: ['ladder'] } },
        { kind: 'toggle', key: 'fpBoxProfile', label: 'Delta boxes: volume profile of the latest bar', defval: true, when: { key: 'fpStyle', anyOf: ['boxes'] } },
        { kind: 'toggle', key: 'fpDbProfile', label: 'Delta bars: volume profile at the right edge', defval: true, when: { key: 'fpStyle', anyOf: ['dbars'] } },
        { kind: 'toggle', key: 'fpDbBadge', label: 'Delta bars: net Delta badge', defval: true, when: { key: 'fpStyle', anyOf: ['dbars'] } },
        { kind: 'toggle', key: 'fpTable', label: 'Bar stats table', defval: false },
        { kind: 'select', key: 'fpTablePos', label: 'Bar stats table position', defval: FP_DEF.fpTablePos, options: POS_OPTS, when: { key: 'fpTable', equals: true } },
        ...TABLE_ROWS.map(([k, name]) => ({ kind: 'toggle', key: 'fpTbl' + TBL_KEY[k], label: 'Stats table row: ' + name, defval: true, when: { key: 'fpTable', equals: true } })),
        { kind: 'toggle', key: 'fpAutoText', label: 'Auto text size (bigger numbers where more traded)', defval: false },
        { kind: 'number', key: 'fpAutoMin', label: 'Auto text: smallest size (px)', defval: FP_DEF.fpAutoMin, min: 7, max: 16, step: 1, when: { key: 'fpAutoText', equals: true } },
        { kind: 'number', key: 'fpAutoMax', label: 'Auto text: biggest size (px)', defval: FP_DEF.fpAutoMax, min: 8, max: 20, step: 1, when: { key: 'fpAutoText', equals: true } },
        { kind: 'select', key: 'fpTextSize', label: 'Text size', defval: FP_DEF.fpTextSize, options: [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Extra large']] },
        { kind: 'color', key: 'fpBuyColor', label: 'Buy colour', defval: FP_DEF.fpBuyColor },
        { kind: 'color', key: 'fpSellColor', label: 'Sell colour', defval: FP_DEF.fpSellColor },
        { kind: 'number', key: 'fpImb', label: 'Imbalance ratio %', defval: FP_DEF.fpImb, min: 110, max: 2000, step: 10, when: { key: 'fpStyle', anyOf: ['classic', 'delta', 'volume', 'ladder', 'dbars'] } },
        { kind: 'number', key: 'fpStack', label: 'Stacked imbalance rows', defval: FP_DEF.fpStack, min: 2, max: 10, step: 1, when: { key: 'fpStyle', anyOf: ['classic', 'delta', 'volume', 'ladder', 'dbars'] } },
        { kind: 'number', key: 'fpRows', label: 'Row size in ticks (0 = auto by zoom)', defval: FP_DEF.fpRows, min: 0, max: 400, step: 1 },
        { kind: 'toggle', key: 'fpStats', label: 'Delta + volume under each bar', defval: true, when: { key: 'fpStyle', anyOf: ['classic', 'delta', 'volume'] } },
        { kind: 'select', key: 'fpStatsPos', label: 'Delta + volume strip position', defval: FP_DEF.fpStatsPos, options: POS_OPTS, when: { key: 'fpStyle', anyOf: ['classic', 'delta', 'volume'] } },
        { kind: 'toggle', key: 'fpPoc', label: 'Highlight the POC', defval: true, when: { key: 'fpStyle', anyOf: ['classic', 'delta', 'volume', 'boxes', 'dbars'] } },
        { kind: 'toggle', key: 'fpUnfinished', label: 'Unfinished-auction marks', defval: true, when: { key: 'fpStyle', anyOf: ['classic', 'delta', 'volume'] } },
        { kind: 'toggle', key: 'fpLadPoc', label: 'Ladder: highlight the POC', defval: false, when: { key: 'fpStyle', anyOf: ['ladder'] } },
        { kind: 'toggle', key: 'fpLadUnf', label: 'Ladder: unfinished-auction marks', defval: false, when: { key: 'fpStyle', anyOf: ['ladder'] } }
      ]
    }
  });
  Core.registerRendererLayer({ id: 'stk_of_big', placement: 'above-data', create: bigLayer });
  Core.registerRendererLayer({ id: 'stk_of_vp', placement: 'below-data', create: vpLayer });
  for (const type of OF_TYPES) {
    const d = IND[type];
    Core.registerNativeIndicator({ type, title: d.title, shortTitle: d.short, paneHint: d.pane, overlay: d.overlay,
      reactsToViewport: type === 'stk_of_vp' || type === 'stk_of_big', inputsSchema: () => d.schema, defaultInputs: () => defaults(d.schema), create: () => new OfNative(type) });
  }
  // The Delta suite (assets/chart-delta-suite.js): same data, same timers, same plan rules.
  installDeltaSuite(Core, {
    flowFor, rootOf, sessionOf, tfMin, replayE, version: () => version,
    subscribe: (fn) => listeners.add(fn), unsubscribe: (fn) => listeners.delete(fn),
    use: () => { users++; startRefresh(); }, unuse: () => { users--; stopRefresh(); }
  });
  // Order flow pro tools (assets/chart-of-pro.js): Absorption, Imbalance zones, TPO, Effort vs Result.
  installOfPro(Core, {
    flowFor, rootOf, sessionOf, version: () => version,
    subscribe: (fn) => listeners.add(fn), unsubscribe: (fn) => listeners.delete(fn),
    use: () => { users++; startRefresh(); }, unuse: () => { users--; stopRefresh(); }
  });
  // Footprint Patterns (assets/chart-fp-patterns.js): six patterns marked on any chart style, from the same flow
  installFpPatterns(Core, { flowFor, rootOf, tfMin, replayE, version: () => version,
    subscribe: (fn) => listeners.add(fn), unsubscribe: (fn) => listeners.delete(fn),
    use: () => { users++; startRefresh(); }, unuse: () => { users--; stopRefresh(); } });
  // Tick-stream twins of Big Trades / Delta / CVD (assets/chart-ts-trades.js): admin only, for the feed comparison
  installTsTrades(Core, { flowFor, rootOf, sessionOf, tfMin, frame, idxOf, alpha, fmt, sgn, light, replayE, clamp, num, MONO,
    use: () => { users++; startRefresh(); }, unuse: () => { users--; stopRefresh(); },
    subscribe: (fn) => listeners.add(fn), unsubscribe: (fn) => listeners.delete(fn) });
  linkFlow(flowMod);
}
// the picker group + the "stryker" badge + settings persistence (assets/chart-orderflow.js); that module
// loads lazily, so this is called again once it is here.
function linkFlow(flowMod) {
  if (!flowMod || !Array.isArray(flowMod.OUR_TYPES)) return;
  for (const type of OF_TYPES.concat(DS_TYPES, PRO_TYPES, TS_TYPES, FPAT_TYPES)) if (!flowMod.OUR_TYPES.includes(type)) flowMod.OUR_TYPES.push(type);
}
export const FP_DISCLAIMER = DISCLAIMER;
// Read-only handle for the browser suite (tools/tests/chart-footprint-browser.js) and debugging.
if (typeof window !== 'undefined') {
  window.__stkOrderflow = {
    minuteBars: (root, from, to) => minuteBars(root, from, to, false).bars,
    loaded: (root) => { const s = stores.get(root); return s ? [...s.days.entries()].map(([d, e]) => ({ d, n: e.bars ? e.bars.length : -1, err: e.err })) : []; },
    crypto: () => { const f = [...cryptoFeeds().values()][0]; if (!f) return null; const b = f.bars(), l = b[b.length - 1]; return { status: f.status, err: f.err, minutes: b.filter((x) => x.t >= f.coverFrom).length, lastT: l ? l.t : 0, lastVol: l ? l.vol : 0, tick: f.tick, coverFrom: f.coverFrom, vols: b.map((x) => [x.t, x.vol, x.delta, x.trades]) }; },
    aggregate, rows, poc, tier: () => testTier() || tierNow, sessionOf, get version() { return version; }
  };
}
