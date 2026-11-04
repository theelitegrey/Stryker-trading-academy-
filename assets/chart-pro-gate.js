// TradeZoro — Charts: the ONE plan rule for the chart (ES module)
// Depends on: window.strykerPlanTier (assets/plan-limits.js), window.openPlanUpgradeModal (assets/plan-modal.js).
// Optional: the Vela workspace (window.STRYKER_VELA) for the sweep below.
//
// ALL TOOLS ARE FREE (Owner 2026-11-04, data plans): "Make all indicators in pro free as well. But they need data so user have to
// subscribe to data anyway." Nothing on the chart is Pro any more: isFree() is always false, so locked() is false, no PRO tag is
// drawn and the sweep never removes a tool. The LIVE data lock (L1 / L2 Data) lives in chart-feeds.js / chart-futures-l2.js and
// the server. The module and its API stay so the callers need no change (kindOf / OF_TYPES / GEX_TYPES are still used for lists).
// Education only. Not financial advice.

export const OF_TYPES = ['stk_footprint', 'stk_fp', 'stk_of_delta', 'stk_of_cvd', 'stk_dsuite', 'stk_dpane', 'stk_of_big', 'stk_of_abs', 'stk_of_imb',
  'stk_of_vp', 'stk_of_vwap', 'stk_of_tpo', 'stk_of_evr', 'stk_of_sweep', 'stk_estcvd', 'stk_vbubble', 'stk_lth', 'stk_crypto_dom', 'stk_liqmap', 'stk_delta', 'stk_cvd', 'stk_ts_big', 'stk_ts_delta', 'stk_ts_cvd', 'stk_ts_dsuite', 'stk_ts_dpane',
  'stk_fut_dom', 'stk_fut_walls', 'stk_fut_imb', 'stk_bk_speed', 'stk_bk_bal', 'stk_bk_refill', 'stk_bk_regime', 'stk_bk_large', 'stk_bk_track', 'stk_bk_walls',
  'stk_l2f_delta', 'stk_l2f_cvd', 'stk_l2f_fp', 'stk_l2f_big', 'stk_l2f_stop', 'stk_l2f_vp'];
export const GEX_TYPES = ['stk_gex', 'stk_gexheat', 'stk_em', 'stk_optflow'];   // ZoroTide (stk_tide) is free since 2026-11-01
export const REASON = { of: '', gex: '' };   // nothing is Pro any more (2026-11-04)

export const PRO_STYLES = ['stk_fp', 'stk_tpoc', 'stk_svp'];   // Pro chart types (Volume footprint, TPO, Session volume profile)

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
    free = false;   // all tools free (2026-11-04)
    if (typeof window !== 'undefined') window.__stkChartFree = free;
    subs.forEach((f) => { try { f(free); } catch (e) {} });
    return r;
  });
  return tierP;
}
tier();   // start asking as soon as the module loads
// Sync: is the signed-in member confirmed Free? (false while unknown: fail open)
export const isFree = () => false;   // all tools free (Owner 2026-11-04)
export function onTier(fn) { subs.add(fn); return () => subs.delete(fn); }

// Is this tool locked for the current member? kind = 'of' | 'gex' | null
export const locked = (kind) => !!kind && isFree();

// No tool is sold any more; a stray caller lands on the data checkout (live data is the paid part).
export function upgrade() { try { location.href = 'checkout.html?plan=LiveDataL2'; } catch (e) {} }

// A small "PRO" tag node (also styled in assets/style.css: .stk-protag).
export function proTag() {
  const s = document.createElement('span');
  s.className = 'stk-protag'; s.textContent = 'PRO'; s.setAttribute('title', 'Part of Pro');
  return s;
}

// ---- sweep ---------------------------------------------------------------------------------------
function cellsOf(ws) { try { return (ws.context().cells || []).map((c) => ws.cell(c.id)).filter(Boolean); } catch (e) { return []; } }
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
  if (n) { try { ws.context().stateChanged(); } catch (e) {} }
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
