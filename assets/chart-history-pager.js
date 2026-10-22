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

const PREFETCH_VIEWS = 1.5;     // start loading when fewer than 1.5 screens of bars remain on the left
const MIN_LEAD_BARS = 150;
const CHUNK_MIN = 1500;          // bars per request (15m: ~16 trading days)
const CHUNK_VIEWS = 4;           // or 4 screens of bars when zoomed far out
const CHUNK_MAX = 5000;
const MAX_BARS = 30000;          // memory ceiling per chart
const EXHAUSTED_MS = 120000;     // nothing older: do not ask that source again for 2 min
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
const hasPine = (chart) => { try { return chart.indicators().some((h) => typeof h.source === 'string' && !h.nativeType); } catch (e) { return false; } };

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
  const st = { busy: false, gen: -1, loadedAt: 0, exhausted: new Map(), raf: 0, last: null };
  chart.__stkPager = st;

  const keyOf = () => { const m = o.config && o.config.market || {}; return (m.symbol || '') + '|' + (m.timeframe || '') + '|' + (m.session || ''); };

  function check() {
    st.raf = 0;
    const r = st.last; if (st.busy || replayOn()) return;
    const m = o.config && o.config.market;
    const bars = o.rawBars;
    if (!m || (m.data && m.data.length) || !bars || bars.length < 2 || bars.length >= MAX_BARS) return;
    if (o.switchingMarket || o.historyState !== 'complete' || !o.historyCompleted) return;
    if (typeof o.feed.loadRange !== 'function') return;
    if (Date.now() - st.loadedAt < SETTLE_MS) { schedule(SETTLE_MS); return; }
    const need = hasPine(chart) ? pineDepthBars(m.timeframe) : 0;
    if (need > bars.length) {
      const k0 = keyOf() + '|' + bars[0].time;
      const ex0 = st.exhausted.get(k0);
      if (!(ex0 && Date.now() - ex0 < EXHAUSTED_MS)) { load(need - bars.length, k0); return; }
    }
    if (!r) return;
    const left = lowerBound(bars, r.from);
    const right = Math.max(left + 1, lowerBound(bars, r.to));
    const vis = right - left;
    if (left > Math.max(MIN_LEAD_BARS, vis * PREFETCH_VIEWS)) return;
    const k = keyOf() + '|' + bars[0].time;
    const ex = st.exhausted.get(k);
    if (ex && Date.now() - ex < EXHAUSTED_MS) return;
    load(Math.min(CHUNK_MAX, Math.max(CHUNK_MIN, vis * CHUNK_VIEWS)), k);
  }

  async function load(chunk, k) {
    st.busy = true;
    const gen = o.generation;
    const before = o.rawBars.length;
    const oldest = o.rawBars[0].time;
    const target = Math.min(MAX_BARS, before + chunk);
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
    if (!(o.rawBars[0] && o.rawBars[0].time < oldest)) { st.exhausted.set(k, Date.now()); stats.genesis++; return; }
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
    chart.on('market:changed', () => { st.loadedAt = Date.now(); st.last = null; });
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
