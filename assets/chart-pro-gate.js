// TradeZoro — Charts: the ONE plan rule for the chart (ES module)
// Depends on: window.strykerPlanTier (assets/plan-limits.js), window.openPlanUpgradeModal (assets/plan-modal.js).
// Optional: the Vela workspace (window.STRYKER_VELA) for the sweep below.
//
// Owner order 2026-10-29: the chart is free for every plan, with no limits. Only THREE things are Pro:
//   1. (real-time futures data is decided by the server: Rithmic, the signed market data agreement (free L1, 2026-11-04), early Pro members or approval; nothing to do here),
//   2. order flow tools: everything in the Order Flow group, the Footprint chart type, the DOM panels,
//   3. GEX on charts: GEX levels / gamma profile, GEX heatmap, GEX ladder, Expected Move (same options chain).
// Free members see those listed with a small "PRO" tag; a click opens the upgrade modal.
// Admins, Pro and an unresolved plan get everything (fail open, same as plan-limits.js).
//
// GEX data (levels, ladder, flow, history, options analytics; SPX 0DTE too) is refused by the server for non-Pro members since
// 2026-11-01 (functions/api/gex/_pro.js, recorder isGexProToken). Order flow data is served as before. This module is the UI side; it shapes the product, it is not a security
// boundary. Besides the click guards, a light sweep removes a Pro tool that arrives by another road for a
// Free member (saved chart, layout, template, community script that loads one).
// Education only. Not financial advice.

export const OF_TYPES = ['stk_footprint', 'stk_fp', 'stk_of_delta', 'stk_of_cvd', 'stk_dsuite', 'stk_dpane', 'stk_of_big', 'stk_of_abs', 'stk_of_imb',
  'stk_of_vp', 'stk_of_vwap', 'stk_of_tpo', 'stk_of_evr', 'stk_of_sweep', 'stk_estcvd', 'stk_vbubble', 'stk_lth', 'stk_crypto_dom', 'stk_liqmap', 'stk_delta', 'stk_cvd', 'stk_ts_big', 'stk_ts_delta', 'stk_ts_cvd', 'stk_ts_dsuite', 'stk_ts_dpane',
  'stk_fut_dom', 'stk_depth_heat', 'stk_fut_walls', 'stk_fut_imb', 'stk_bk_speed', 'stk_bk_bal', 'stk_bk_refill', 'stk_bk_regime', 'stk_bk_large', 'stk_bk_track', 'stk_bk_walls',
  'stk_l2f_delta', 'stk_l2f_cvd', 'stk_l2f_fp', 'stk_l2f_big', 'stk_l2f_stop', 'stk_l2f_vp', 'stk_l2f_lad',
  'stk_liq', 'stk_liq_bars', 'stk_oi', 'stk_funding', 'stk_lsr'];   // crypto derivatives (assets/chart-crypto-deriv.js): Pro like crypto footprint / delta
export const GEX_TYPES = ['stk_gex', 'stk_gexheat', 'stk_em', 'stk_optflow', 'stk_zrange', 'stk_zzone', 'stk_ivrank', 'stk_zvol'];   // ZoroTide (stk_tide) is free since 2026-11-01
export const REASON = { of: 'Order flow tools are part of Pro.', gex: 'GEX and options flow on charts are part of Pro.' };

// Futures order flow is the L2 tools only (Owner 2026-11-06). Each L1 / old trades-only tool with an L2 twin -> that twin.
// chart-orderflow.js hides these on futures and swaps saved ones; chart-indicator-window.js maps an old favourite to the twin.
export const L1_TO_L2 = {
  stk_ts_big: 'stk_l2f_big', stk_of_big: 'stk_l2f_big',
  stk_ts_delta: 'stk_l2f_delta', stk_of_delta: 'stk_l2f_delta', stk_delta: 'stk_l2f_delta', stk_ts_dpane: 'stk_l2f_delta', stk_dpane: 'stk_l2f_delta',
  stk_ts_cvd: 'stk_l2f_cvd', stk_of_cvd: 'stk_l2f_cvd', stk_cvd: 'stk_l2f_cvd',
  stk_ts_dsuite: 'stk_l2f_delta', stk_dsuite: 'stk_l2f_delta',   // "Delta (L1)" / "Delta" overlay styles -> Delta (L2) (it adds the Delta Ladder (L2) on the price axis)
  stk_footprint: 'stk_l2f_fp', stk_of_vp: 'stk_l2f_vp', stk_of_sweep: 'stk_l2f_stop'
};
export const PRO_STYLES = ['stk_fp', 'stk_tpoc', 'stk_svp'];   // Pro chart types (Volume footprint, TPO, Session volume profile)

// 'of' | 'gex' | null for a native indicator type (or the 'stk_fp' chart style).
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
    free = !!(r && r.free && !r.admin); known = !(r && r.unknown);
    if (typeof window !== 'undefined') window.__stkChartFree = free;
    subs.forEach((f) => { try { f(free); } catch (e) {} });
    return r;
  });
  return tierP;
}
tier();   // start asking as soon as the module loads
// Sync: is the signed-in member confirmed Free? (false while unknown: fail open)
export const isFree = () => {
  try { const o = window.__stkChartTestFree; if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) && typeof o === 'boolean') return o; } catch (e) {}
  return free;
};
export const tierKnown = () => known;
export function onTier(fn) { subs.add(fn); return () => subs.delete(fn); }

// Is this tool locked for the current member? kind = 'of' | 'gex' | null
export const locked = (kind) => !!kind && isFree();

export function upgrade(kind) {
  const why = REASON[kind] || 'This tool is part of Pro.';
  if (typeof window.openPlanUpgradeModal === 'function') window.openPlanUpgradeModal(why);
}

// A small "PRO" tag node (also styled in assets/style.css: .stk-protag).
export function proTag() {
  const s = document.createElement('span');
  s.className = 'stk-protag'; s.textContent = 'PRO'; s.setAttribute('title', 'Part of Pro');
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
    if (toast && now - lastToast > 4000) { lastToast = now; toast((kind === 'gex' ? 'GEX and options flow on charts' : 'Order flow tools') + ' are part of Pro. Removed from this chart.', 'info'); }
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
  new MutationObserver(tag).observe(document.body, { childList: true, subtree: true });
}
