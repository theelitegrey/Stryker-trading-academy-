// TradeZoro — Charts: endless scroll-back (TradingView-style history paging). ES module.
// Owner order 2026-10-22 ("tv feel gap", row 1): scrolling back on any timeframe stopped at the
// 500 bars of the first load. Now, when the left edge of the view comes within PREFETCH_VIEWS
// screen-widths of the oldest loaded bar, the next older chunk is fetched in the background and
// prepended with the view kept on the same candles (Vela's own backfill path, preserveView).
//
// How: Vela's orchestrator already has the backward loop it uses for deep first loads,
// backfillHistory(gen, requested): loadRange({ to: oldest bar, limit }) -> prepend, preserveView.
// We drive that loop with a bigger `requested`, on demand, after re-arming the per-load history
// tracking so the sessions get 'complete' again (Pine scripts and built-in studies recompute once
// over the longer history; per-chunk pokes are 'backfill', which they ignore). Same names and
// same code in Vela 0.6.17 and 0.9.0.
//
// Data budget: no polling. A request is only made when the member scrolls (or zooms out) toward
// the oldest bar; one chunk at a time per chart; a source that returned nothing older (Yahoo depth
// limit, Rithmic front-month start) is not asked again for EXHAUSTED_MS. Older pages are closed
// history, so the 10-minute member delay (the current page only) is untouched, and the futures
// provider / Rithmic provider memo every page they fetch.
// Not used during Bar Replay (it keeps its own buffers) or on offline/data-only charts.

import { deepOn, DEEP_DEPTH_DAYS } from './chart-futures-provider.js?v=929';

const PREFETCH_VIEWS = 1.5;     // start loading when fewer than 1.5 screens of bars remain on the left
const MIN_LEAD_BARS = 150;
const CHUNK_MIN = 1500;          // bars per request (15m: ~16 trading days)
const CHUNK_VIEWS = 4;           // or 4 screens of bars when zoomed far out
const CHUNK_MAX = 5000;
const MAX_BARS = 30000;          // memory ceiling per chart
const MAX_BARS_DEEP = 400000;    // DEEP HISTORY on (chart-futures-provider.js deepOn): a year of 1m bars (~350k) on one chart
const mktRoot = (m) => String(m && m.symbol || '').replace(/^[a-z_]+:/i, '').replace(/1!$/, '').toUpperCase();
const deepMkt = (m) => !!m && /^futures:/i.test(m.symbol || '') && deepOn(mktRoot(m), m.timeframe);
const maxBars = (m) => (deepMkt(m) ? MAX_BARS_DEEP : MAX_BARS);
const EXHAUSTED_MS = 120000;     // nothing older: do not ask that source again for 2 min
const SOON_MS = 20000;           // 'genesis' while the source should still have older data (see DEPTH_DAYS): ask again after 20 s, not 2 min
const SETTLE_MS = 600;           // let a fresh load paint first
// Pine scripts need history behind the view, like TradingView loads it: session levels (Asia /
// London / NY highs and lows), PDH/PDL and other "previous period" drawings only appear once a
// script has seen those periods. A 1m chart opened with 500 bars (about 8 hours) cut the
// Liquidity Master sessions to the last few hours (Owner 2026-10-22: "the sessions are not being
// plotted properly"). With a Pine script on the chart we load at least PINE_SPAN_S worth of
// bars (counted in bars, so weekends don't eat it; capped at PINE_MAX_BARS), once per load.
// Two trading days covers the previous day's sessions and PDH/PDL; more only slows the
// first full run (Liquidity Master: ~5 ms per 1m bar in the worker, every bar is script work).
const PINE_SPAN_S = 2 * 86400;
const PINE_MAX_BARS = 5000;
const TF_S = { '1': 60, '3': 180, '5': 300, '15': 900, '30': 1800, '45': 2700, '60': 3600, '120': 7200, '180': 10800, '240': 14400 };
export function pineDepthBars(tf){
  const s = TF_S[String(tf)];
  return s ? Math.min(PINE_MAX_BARS, Math.ceil(PINE_SPAN_S / s)) : 0;
}
// Source depth (mirrors DEPTH_SECS in chart-futures-provider.js). Older than this is a real end; newer is a gap or an upstream hiccup.
const DEPTH_DAYS = { '1': 29, '3': 29, '5': 59, '15': 59, '30': 59 };
const depthDays = (tf, m) => (deepMkt(m) ? DEEP_DEPTH_DAYS : DEPTH_DAYS[String(tf)] || 700);
const hasPine = (chart) => { try { return chart.indicators().some((h) => typeof h.source === 'string' && !h.nativeType); } catch (e) { return false; } };

// Camarilla Pivots needs the previous period complete plus the shown days: that many sessions of bars (23 h a day), capped.
const CAM_PERIOD_DAYS = { Daily: 1, Weekly: 7, Monthly: 31 };
export function camDepthBars(chart, tf){
  const m = TF_S[String(tf)];
  if (!m) return 0;
  let need = 0;
  try {
    chart.indicators().forEach((h) => {
      if (h.nativeType !== 'stk_camarilla') return;
      const v = h.inputValues(), per = CAM_PERIOD_DAYS[v.period] || 1;
      const days = per === 1 ? Math.max(1, Math.min(30, +v.days || 5)) + 2 : Math.round(per * 5 / 7) * 2 + 1;
      need = Math.max(need, Math.ceil(days * 23 * 3600 / m));
    });
  } catch (e) {}
  return Math.min(MAX_BARS, need);
}
const orchOf = (cell) => { try { return cell.chart.orchestrator; } catch (e) { return null; } };
const replayOn = () => { try { return !!(window.__stkReplay && window.__stkReplay.on); } catch (e) { return false; } };

// First index with bars[i].time >= t.
function lowerBound(bars, t) {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].time < t) lo = m + 1; else hi = m; }
  return lo;
}

const stats = { requests: 0, loaded: 0, genesis: 0, last: null };

function attach(cell) {
  const chart = cell && cell.chart;
  if (!chart || chart.__stkPager) return;
  const o = orchOf(cell);
  if (!o || typeof o.backfillHistory !== 'function' || typeof o.resetHistoryTracking !== 'function') return;
  const st = { busy: false, gen: -1, loadedAt: 0, exhausted: new Map(), raf: 0, last: null, fails: 0, reason: '' };
  chart.__stkPager = st;

  const keyOf = () => { const m = o.config && o.config.market || {}; return (m.symbol || '') + '|' + (m.timeframe || '') + '|' + (m.session || ''); };

  function check() {
    st.raf = 0;
    if (st.busy || replayOn()) return;
    // No viewport event since the last market change: read the view now, so a first view with an empty left side loads at once (no scroll needed).
    let r = st.last; if (!r) { try { r = chart.getVisibleRange(); } catch (e) {} }
    const m = o.config && o.config.market;
    const bars = o.rawBars;
    if (!m || (m.data && m.data.length) || !bars || bars.length < 2 || bars.length >= maxBars(m)) return;
    if (o.switchingMarket || o.historyState !== 'complete' || !o.historyCompleted) return;
    if (typeof o.feed.loadRange !== 'function') return;
    if (Date.now() - st.loadedAt < SETTLE_MS) { schedule(SETTLE_MS); return; }
    const need = Math.max(hasPine(chart) ? pineDepthBars(m.timeframe) : 0, camDepthBars(chart, m.timeframe));
    if (need > bars.length) {
      const k0 = keyOf() + '|' + bars[0].time;
      const ex0 = st.exhausted.get(k0);
      if (!(ex0 && Date.now() < ex0)) { load(need - bars.length, k0); return; }
    }
    if (!r) return;
    const left = lowerBound(bars, r.from);
    const right = Math.max(left + 1, lowerBound(bars, r.to));
    const vis = right - left;
    if (left > Math.max(MIN_LEAD_BARS, vis * PREFETCH_VIEWS)) return;
    const k = keyOf() + '|' + bars[0].time;
    const ex = st.exhausted.get(k);
    if (ex && Date.now() < ex) return;
    load(Math.min(CHUNK_MAX, Math.max(CHUNK_MIN, vis * CHUNK_VIEWS)), k);
  }

  async function load(chunk, k) {
    st.busy = true;
    const gen = o.generation;
    const before = o.rawBars.length;
    const oldest = o.rawBars[0].time;
    st.reason = '';
    const target = Math.min(maxBars(o.config.market), before + chunk);
    stats.requests++;
    try {
      // Re-arm the per-load tracking: completeHistory() runs once per cycle, so without this the
      // sessions would never hear 'complete' for the longer history.
      o.resetHistoryTracking();
      o.historyState = 'backfill';
      await o.backfillHistory(gen, target);
    } catch (e) {
      console.warn('TradeZoro: history page', e);
    } finally {
      // Never leave the chart in 'backfill' (a superseded load resets it itself).
      if (o.generation === gen && !o.historyCompleted) { try { o.completeHistory('aborted'); } catch (e) {} }
      st.busy = false;
    }
    if (o.generation !== gen) return;
    const got = o.rawBars.length - before;
    stats.loaded += Math.max(0, got);
    stats.last = { key: k, before, after: o.rawBars.length, oldest: o.rawBars[0] && o.rawBars[0].time, at: Date.now() };
    if (!(o.rawBars[0] && o.rawBars[0].time < oldest)) {
      // Nothing older came back. A fetch ERROR ('aborted') is not the end of history: retry with a growing pause (2 s .. 30 s).
      // 'genesis' near the present (source depth not reached) is retried after SOON_MS; at the real depth it stays quiet for EXHAUSTED_MS.
      let wait;
      if (st.reason === 'aborted') { wait = Math.min(30000, 2000 * Math.pow(2, st.fails++)); stats.errors = (stats.errors || 0) + 1; }
      else { wait = (Date.now() - oldest) / 864e5 < depthDays(o.config.market.timeframe, o.config.market) - 3 ? SOON_MS : EXHAUSTED_MS; stats.genesis++; }
      st.exhausted.set(k, Date.now() + wait);
      schedule(wait + 50);
      return;
    }
    st.fails = 0;
    stats.pine = hasPine(chart) ? (stats.pine || 0) + 1 : stats.pine;
    // Still close to the edge (fast drag, far zoom-out): keep going.
    schedule(0);
  }

  function schedule(ms) {
    if (st.raf) return;
    st.raf = ms ? setTimeout(() => { st.raf = 0; check(); }, ms) : requestAnimationFrame(check);
  }

  st.kick = () => schedule(SETTLE_MS);   // chart-pine.js: a Pine script was added
  try {
    chart.on('viewport:changed', (r) => { st.last = r; if (!st.busy) schedule(0); });
    chart.on('load:end', () => { st.loadedAt = Date.now(); schedule(SETTLE_MS + 50); });
    chart.on('market:changed', () => { st.loadedAt = Date.now(); st.last = null; st.fails = 0; });
    chart.on('history:complete', (e) => { st.reason = (e && e.reason) || ''; });
  } catch (e) { console.warn('TradeZoro: history pager hook', e); }
}

export function installHistoryPager(ws) {
  const sweep = () => {
    let cells = [];
    try { cells = ws.cells(); } catch (e) { return; }
    cells.forEach((c) => { try { attach(c); } catch (e) {} });
  };
  sweep();
  try { ws.on('layout:changed', () => setTimeout(sweep, 0)); } catch (e) {}
  try { ws.on('state:changed', () => setTimeout(sweep, 0)); } catch (e) {}
  window.__stkHistoryPager = { stats: () => JSON.parse(JSON.stringify(stats)) };
}
