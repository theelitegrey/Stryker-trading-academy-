// TradeZoro — Charts: the ONE plan rule for the chart (ES module)
// Depends on: window.strykerPlanTier (assets/plan-limits.js), window.openPlanUpgradeModal (assets/plan-modal.js).
// Optional: the Vela workspace (window.STRYKER_VELA) for the sweep below.
//
// ALL TOOLS FREE (Owner order 2026-11-13): "Pro tools will be made free from tonight onwards, that means everything will be free.
// Only paid will be data feed, on which we have no control as rules are set by exchanges."
// Nothing on the chart is Pro any more: isFree() is always false, so locked() is false, no PRO tag is drawn, the sweep never removes a
// tool and the chart-type menu never stops Footprint. The only paid part is the LIVE futures order book (L2), decided by the server
// (/ts-live book tier, /api/chart/rt l2): without it the order-book tools read the recorded book 10 min delayed (chart-futures-l2.js).
// The module and its API stay so the callers need no change (kindOf / OF_TYPES / GEX_TYPES / L1_TO_L2 are still used for lists).
// The old rule (2026-10-29 .. 2026-11-13): order flow tools, the Footprint chart type, the DOM panels and GEX on charts were Pro.
// Education only. Not financial advice.

export const OF_TYPES = ['stk_footprint', 'stk_fp', 'stk_of_delta', 'stk_of_cvd', 'stk_dsuite', 'stk_dpane', 'stk_of_big', 'stk_of_abs', 'stk_of_imb',
  'stk_of_vp', 'stk_of_vwap', 'stk_of_tpo', 'stk_of_evr', 'stk_of_sweep', 'stk_estcvd', 'stk_vbubble', 'stk_lth', 'stk_crypto_dom', 'stk_liqmap', 'stk_delta', 'stk_cvd', 'stk_ts_big', 'stk_ts_delta', 'stk_ts_cvd', 'stk_ts_dsuite', 'stk_ts_dpane',
  'stk_fut_dom', 'stk_depth_heat', 'stk_fut_walls', 'stk_fut_imb', 'stk_bk_speed', 'stk_bk_bal', 'stk_bk_refill', 'stk_bk_regime', 'stk_bk_large', 'stk_bk_track', 'stk_bk_walls',
  'stk_l2f_delta', 'stk_l2f_cvd', 'stk_l2f_fp', 'stk_l2f_big', 'stk_l2f_stop', 'stk_l2f_vp', 'stk_l2f_lad', 'stk_l2f_dp', 'stk_l2f_sw', 'stk_fpat', 'stk_fpat_l2', 'stk_barstats',
  'stk_liq', 'stk_liq_bars', 'stk_oi', 'stk_funding', 'stk_lsr'];   // crypto derivatives (assets/chart-crypto-deriv.js): Pro like crypto footprint / delta
export const GEX_TYPES = ['stk_gex', 'stk_gexheat', 'stk_em', 'stk_optflow', 'stk_zrange', 'stk_zzone', 'stk_ivrank', 'stk_zvol', 'stk_dex', 'stk_vex', 'stk_cex'];   // ZoroTide (stk_tide) is free since 2026-11-01
export const REASON = { of: '', gex: '' };   // nothing on the chart is Pro any more (2026-11-13)

// Futures order flow is the L2 tools only (Owner 2026-11-06). Each L1 / old trades-only tool with an L2 twin -> that twin.
// chart-orderflow.js hides these on futures and swaps saved ones; chart-indicator-window.js maps an old favourite to the twin.
export const L1_TO_L2 = {
  stk_ts_big: 'stk_l2f_big', stk_of_big: 'stk_l2f_big',
  stk_ts_delta: 'stk_l2f_delta', stk_of_delta: 'stk_l2f_delta', stk_delta: 'stk_l2f_delta', stk_ts_dpane: 'stk_l2f_delta', stk_dpane: 'stk_l2f_delta',
  stk_ts_cvd: 'stk_l2f_cvd', stk_of_cvd: 'stk_l2f_cvd', stk_cvd: 'stk_l2f_cvd',
  stk_ts_dsuite: 'stk_l2f_delta', stk_dsuite: 'stk_l2f_delta',   // "Delta (L1)" / "Delta" overlay styles -> Delta (L2) (it adds the Delta Ladder (L2) on the price axis)
  stk_fpat: 'stk_fpat_l2', stk_footprint: 'stk_l2f_fp', stk_of_vp: 'stk_l2f_vp', stk_of_sweep: 'stk_l2f_stop'
};
export const PRO_STYLES = ['stk_fp', 'stk_tpoc', 'stk_svp'];   // Pro chart types (Volume footprint, TPO, Session volume profile)

// 'of' | 'gex' | null for a native indicator type (or the 'stk_fp' chart style).
const legendMut = (ms) => ms.every((m) => { const t = m.target, e = t.nodeType === 1 ? t : t.parentElement; return !e || [].every.call(m.addedNodes, (n) => n.nodeType === 3) && [].every.call(m.removedNodes, (n) => n.nodeType === 3) || !!e.closest('title,.vela-statusline,.vela-widget-bottombar,.stklat-chip'); });   // SMOOTH: the legend / bottom-bar readouts change on every pointer move while panning; they never hold a dialog or menu
export function kindOf(type) {
  if (OF_TYPES.indexOf(type) >= 0) return 'of';
  if (GEX_TYPES.indexOf(type) >= 0) return 'gex';
  return null;
}

let free = false;           // true only once a signed-in FREE member is confirmed
let known = false;          // the plan answer is in (free or not)
let tierP = null;
const subs = new Set();
export function tier() {
  if (tierP) return tierP;
  tierP = new Promise((resolve) => {
    const t = setTimeout(() => resolve({ free: false, unknown: true }), 10000);
    try {
      if (typeof window.strykerPlanTier !== 'function') { clearTimeout(t); resolve({ free: false, unknown: true }); return; }
      window.strykerPlanTier().then((r) => { clearTimeout(t); resolve(r || { free: false }); }, () => { clearTimeout(t); resolve({ free: false }); });
    } catch (e) { clearTimeout(t); resolve({ free: false }); }
  }).then((r) => {
    free = false; known = !(r && r.unknown);   // all tools free (2026-11-13): never a Free lock
    if (typeof window !== 'undefined') window.__stkChartFree = free;
    subs.forEach((f) => { try { f(free); } catch (e) {} });
    return r;
  });
  return tierP;
}
tier();   // start asking as soon as the module loads
// Sync: is the signed-in member confirmed Free? (false while unknown: fail open)
export const isFree = () => false;   // all tools free (Owner 2026-11-13); window.__stkChartTestFree no longer changes anything
export const tierKnown = () => known;
export function onTier(fn) { subs.add(fn); return () => subs.delete(fn); }

// Is this tool locked for the current member? kind = 'of' | 'gex' | null
export const locked = (kind) => !!kind && isFree();

// No tool is sold any more. A stray caller (an old saved script, a template note) gets the live-data paywall, never a tool paywall.
export function upgrade() {
  try { if (typeof window.strykerLiveDataPaywall === 'function') { window.strykerLiveDataPaywall(); return; } } catch (e) {}
  if (typeof window.openPlanUpgradeModal === 'function') window.openPlanUpgradeModal(LIVE_DATA_REASON);
}
export const LIVE_DATA_REASON = "Live futures order book data is a paid data feed. Exchange rules set it, so we can't give it free. Tools are free; this is the data.";

// A small "PRO" tag node (also styled in assets/style.css: .stk-protag).
export function proTag() {
  const s = document.createElement('span');
  s.className = 'stk-protag'; s.textContent = 'PRO'; s.setAttribute('title', 'Part of Pro');   // unused since 2026-11-13 (nothing calls it while isFree() is false)
  return s;
}

// ---- sweep ---------------------------------------------------------------------------------------
function cellsOf(ws) { try { return (ws.context().cells || []).map((c) => ws.cell(c.id)).filter(Boolean); } catch (e) { return []; } }
let lastToast = 0;
export function sweep(ws, toast) {
  if (!isFree() || !ws) return 0;
  let n = 0, kind = null;
  cellsOf(ws).forEach((cell) => {
    try {
      if (PRO_STYLES.indexOf(cell.priceStyle) >= 0) { cell.setPriceStyle('candles'); n++; kind = 'of'; }
    } catch (e) {}
    try {
      (cell.chart.indicators() || []).forEach((h) => {
        const k = kindOf(h.nativeType);
        if (k) { try { h.remove(); n++; kind = kind || k; } catch (e) {} }
      });
    } catch (e) {}
  });
  if (n) {
    try { ws.context().stateChanged(); } catch (e) {}
    const now = Date.now();
    if (toast && now - lastToast > 4000) { lastToast = now; /* never runs: isFree() is false (all tools free 2026-11-13) */ }
  }
  return n;
}

// Keeps Free members' charts clean and tags the Footprint item of the chart-type menu.
export function mountProGate(ws, opts) {
  const toast = (opts && opts.toast) || null;
  const run = () => { try { sweep(ws, toast); } catch (e) {} };
  tier().then(() => {
    if (!isFree()) return;
    run();
    setInterval(run, 1500);
    window.addEventListener('stk:heavy-ready', run);
    try { ws.on('state:changed', () => setTimeout(run, 50)); } catch (e) {}
  });
  // Chart-type menu: "Footprint" is Pro for Free members (tag + modal instead of switching).
  const item = (t) => (t && t.closest ? t.closest('[role="menuitem"], [role="menuitemradio"], [role="option"], li, button') : null);
  document.addEventListener('click', (e) => {
    if (!isFree()) return;
    const it = item(e.target);
    if (!it || !it.closest('[data-stk-style-menu], .vela-menu, [role="menu"], [role="listbox"]')) return;
    if (it.closest('.stkiw-ov')) return;   // the indicators window has its own guard
    if (/^\s*(Volume footprint|Footprint|Time price opportunity|Session volume profile)\b/i.test(it.textContent || '') && it.textContent.length < 40) {
      e.stopImmediatePropagation(); e.preventDefault(); upgrade('of');
    }
  }, true);
  const tag = () => {
    if (!isFree()) return;
    document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]').forEach((it) => {
      if (it.querySelector('.stk-protag') || it.closest('.stkiw-ov')) return;
      const t = (it.textContent || '').trim();
      if (/^(Volume footprint|Footprint|Time price opportunity|Session volume profile)\b/i.test(t) && t.length < 40) it.appendChild(proTag());
    });
  };
  new MutationObserver((ms) => { if (!legendMut(ms)) tag(); }).observe(document.body, { childList: true, subtree: true });
}
