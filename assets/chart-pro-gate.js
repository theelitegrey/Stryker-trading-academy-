// TradeZoro — Charts: the ONE plan rule for the chart (ES module)
// Depends on: window.strykerPlanTier (assets/plan-limits.js), window.openPlanUpgradeModal (assets/plan-modal.js).
// Optional: the Vela workspace (window.STRYKER_VELA) for the sweep below.
//
// Owner order 2026-10-29: the chart is free for every plan, with no limits. Only THREE things are Pro:
//   1. real-time data (the server decides; Free keeps the 10-minute delay, nothing to do here),
//   2. order flow tools: everything in the Order Flow group, the Footprint chart type, the DOM panels,
//   3. GEX on charts: GEX levels / gamma profile, GEX heatmap, GEX ladder, Expected Move (same options chain).
// Free members see those listed with a small "PRO" tag; a click opens the upgrade modal.
// Admins, Pro and an unresolved plan get everything (fail open, same as plan-limits.js).
//
// ENFORCEMENT IS CLIENT-SIDE (the data feeds are public); it shapes the product, it is not a security
// boundary. Besides the click guards, a light sweep removes a Pro tool that arrives by another road for a
// Free member (saved chart, layout, template, community script that loads one).
// Education only. Not financial advice.

export const OF_TYPES = ['stk_footprint', 'stk_fp', 'stk_of_delta', 'stk_of_cvd', 'stk_dsuite', 'stk_dpane', 'stk_of_big', 'stk_of_abs', 'stk_of_imb',
  'stk_of_vp', 'stk_of_vwap', 'stk_of_tpo', 'stk_of_evr', 'stk_of_sweep', 'stk_estcvd', 'stk_vbubble', 'stk_lth', 'stk_crypto_dom', 'stk_liqmap', 'stk_delta', 'stk_cvd'];
export const GEX_TYPES = ['stk_gex', 'stk_gexheat', 'stk_em', 'stk_tide'];   // stk_tide = ZoroTide (options money flow)
export const REASON = { of: 'Order flow tools are part of Pro.', gex: 'GEX and options flow on charts are part of Pro.' };

// 'of' | 'gex' | null for a native indicator type (or the 'stk_fp' chart style).
export function kindOf(type) {
  if (OF_TYPES.indexOf(type) >= 0) return 'of';
  if (GEX_TYPES.indexOf(type) >= 0) return 'gex';
  return null;
}

let free = false;           // true only once a signed-in FREE member is confirmed
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
    free = !!(r && r.free && !r.admin);
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
      if (cell.priceStyle === 'stk_fp') { cell.setPriceStyle('candles'); n++; kind = 'of'; }
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
    if (/^\s*Footprint\b/i.test(it.textContent || '') && it.textContent.length < 40) {
      e.stopImmediatePropagation(); e.preventDefault(); upgrade('of');
    }
  }, true);
  const tag = () => {
    if (!isFree()) return;
    document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]').forEach((it) => {
      if (it.querySelector('.stk-protag') || it.closest('.stkiw-ov')) return;
      const t = (it.textContent || '').trim();
      if (/^Footprint\b/i.test(t) && t.length < 30) it.appendChild(proTag());
    });
  };
  new MutationObserver(tag).observe(document.body, { childList: true, subtree: true });
}
