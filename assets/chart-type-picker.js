// TradeZoro: "Chart type" sheet (grid, 3 columns on phone) + favourites in the top bar.
// Replaces the plain dropdown of the chart-style button. Long-press (touch) or right-click / star (mouse) a type = favourite;
// favourites sit as small icon buttons next to the style button. Pro types (Volume footprint, TPO, Session volume
// profile) show a PRO tag and open the plan modal for Free members (assets/chart-pro-gate.js).
import * as Gate from './chart-pro-gate.js?v=906';
import { CT_ICONS, CT_LABELS } from './chart-types.js?v=906';

const LS = 'stryker_ctype_favs';
const ICON = {   // our own line icons for the built-in types (28 px grid)
  candles: '<path d="M9 5v3M9 19v4M19 7v3M19 17v5"/><rect x="6.5" y="8" width="5" height="11" rx="1"/><rect x="16.5" y="10" width="5" height="7" rx="1" fill="currentColor" stroke="none"/>',
  bars: '<path d="M8 5v18M8 10h-3M8 18h3M19 4v17M19 8h-3M19 16h3"/>',
  line: '<path d="M4 20l6-8 5 4 9-11"/>',
  area: '<path d="M4 20l6-8 5 4 9-11v15H4z" fill="currentColor" fill-opacity=".2"/><path d="M4 20l6-8 5 4 9-11"/>',
  baseline: '<path d="M4 14h20" stroke-dasharray="2 2" stroke-width="1"/><path d="M4 18l5-6 5 3 4-6 6 2"/>',
  heikinashi: '<path d="M8 4v4M8 20v4M19 6v3M19 19v3"/><rect x="5.5" y="8" width="5" height="12" rx="1" fill="currentColor" fill-opacity=".25"/><rect x="16.5" y="9" width="5" height="10" rx="1" fill="currentColor" stroke="none"/>',
  stk_fp: '<rect x="6" y="5" width="16" height="18" rx="1.5"/><path d="M14 5v18M6 11h16M6 17h16"/>'
};
const svg = (inner) => '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
const LABEL = { candles: 'Candles', bars: 'Bars', line: 'Line', area: 'Area', baseline: 'Baseline', heikinashi: 'Heikin Ashi', stk_fp: 'Volume footprint' };
// Group order = the owner's list.
const ORDER = ['bars', 'candles', 'stk_hollow', 'stk_volcandle', 'line', 'stk_linemark', 'stk_step', 'area', 'stk_hlcarea', 'baseline', 'stk_columns', 'stk_highlow',
  'stk_fp', 'stk_tpoc', 'stk_svp', 'heikinashi', 'stk_renko', 'stk_linebreak', 'stk_kagi', 'stk_pnf', 'stk_range'];
const PRO = ['stk_fp', 'stk_tpoc', 'stk_svp'];
const icon = (id) => (CT_ICONS[id] ? CT_ICONS[id] : svg(ICON[id] || ''));
const label = (id) => CT_LABELS[id] || LABEL[id] || id;

const CSS = `
.stk-ct-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.stk-ct{width:min(560px,100%);max-height:min(640px,calc(100dvh - 32px));display:flex;flex-direction:column;background:#1e222d;color:#d1d4dc;border:1px solid #363a45;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.5);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.stk-ct-h{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 8px 20px}
.stk-ct-h b{font-size:17px;font-weight:600;color:#fff}
.stk-ct-x{all:unset;cursor:pointer;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:22px;color:#9598a1;font-size:22px}
.stk-ct-x:hover{background:rgba(255,255,255,.08)}
.stk-ct-hint{padding:0 20px 8px;font-size:12px;color:#9598a1}
.stk-ct-g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px 16px 16px;overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
.stk-ct-g::-webkit-scrollbar{width:4px}.stk-ct-g::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:4px}.stk-ct-g::-webkit-scrollbar-button{display:none}
@media (max-width:520px){.stk-ct-g{grid-template-columns:repeat(3,1fr)}.stk-ct-ov{align-items:flex-end;padding:0}.stk-ct{width:100%;border-radius:20px 20px 0 0;max-height:85dvh}}
.stk-ct-b{all:unset;box-sizing:border-box;position:relative;cursor:pointer;min-height:84px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:10px 4px;border-radius:12px;border:1px solid transparent;background:rgba(255,255,255,.04);color:#d1d4dc;text-align:center;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.stk-ct-b:hover{background:rgba(255,255,255,.09)}
.stk-ct-b:focus-visible{outline:2px solid #2962ff;outline-offset:2px}
.stk-ct-b.on{border-color:#2962ff;background:rgba(41,98,255,.16);color:#fff}
.stk-ct-b svg{flex:none}.stk-ct-n{font-size:12px;line-height:1.2;max-width:100%}
.stk-ct-s{position:absolute;top:4px;right:4px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:14px;color:#6a6e78;font-size:15px}
.stk-ct-s:hover{background:rgba(255,255,255,.1);color:#f5b301}.stk-ct-b.fav .stk-ct-s{color:#f5b301}
.stk-ct-p{position:absolute;top:6px;left:6px;font-size:9px;font-weight:700;letter-spacing:.04em;color:#0b0b0d;background:#f5b301;border-radius:4px;padding:1px 4px}
.vela-widget-tool.stk-ct-fav{all:unset;box-sizing:border-box;cursor:pointer;width:32px;height:30px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;color:var(--vela-fg-muted,#9598a1)}
.stk-ct-fav:hover{background:var(--vela-hover,rgba(255,255,255,.08));color:var(--vela-fg-bright,#fff)}
.stk-ct-fav.on{color:#2962ff}.stk-ct-fav svg{width:20px;height:20px}
:root[data-theme="light"] .stk-ct{background:#fff;color:#131722;border-color:#e0e3eb}
:root[data-theme="light"] .stk-ct-h b{color:#131722}
:root[data-theme="light"] .stk-ct-b{background:#f4f5f8;color:#131722}
:root[data-theme="light"] .stk-ct-b:hover{background:#eceef3}
:root[data-theme="light"] .stk-ct-b.on{background:rgba(41,98,255,.1);color:#131722}
:root[data-theme="light"] .stk-ct-x:hover{background:rgba(0,0,0,.06)}
:root[data-theme="light"] .stk-ct-g{scrollbar-color:rgba(0,0,0,.25) transparent}:root[data-theme="light"] .stk-ct-g::-webkit-scrollbar-thumb{background:rgba(0,0,0,.25)}
`;
const favs = () => { try { const a = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(a) ? a.filter((x) => ORDER.includes(x)) : []; } catch (e) { return []; } };
const saveFavs = (a) => { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) {} };

export function mountChartTypePicker(ws, opts) {
  const toast = (opts && opts.toast) || (() => {});
  if (!document.getElementById('stk-ct-css')) { const st = document.createElement('style'); st.id = 'stk-ct-css'; st.textContent = CSS; document.head.appendChild(st); }
  const active = () => { try { return ws.active; } catch (e) { return null; } };
  const current = () => { const c = active(); return c && c.priceStyle; };
  function choose(id) {
    if (PRO.includes(id) && Gate.locked('of')) { Gate.upgrade('of'); return false; }
    const c = active(); if (!c) return false;
    try { c.setPriceStyle(id); try { ws.context().stateChanged(); } catch (e) {} } catch (e) { toast('That chart type is not available here.', 'error'); return false; }
    return true;
  }
  // Opened from inside the phone "More" drawer (a modal sheet that blocks taps outside it): close that sheet first, then open.
  function open() {
    // phone toolbar "More" list (chart-onebar.js) holds the Chart type button: close it so it can't sit over the sheet
    const mb = document.querySelector('.stkc-ob-more-btn[aria-expanded="true"]');
    if (mb) mb.click();
    const dr = document.querySelector('.vela-drawer[data-state="open"]');
    if (dr) {
      dr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      const bd = document.querySelector('.vela-drawer-backdrop');
      setTimeout(() => { if (document.querySelector('.vela-drawer[data-state="open"]') && bd) bd.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }, 60);
      setTimeout(open2, 260); return;
    }
    open2();
  }
  function open2() {
    if (document.querySelector('.stk-ct-ov')) return;
    const ov = document.createElement('div'); ov.className = 'stk-ct-ov';
    ov.innerHTML = '<div class="stk-ct" role="dialog" aria-modal="true" aria-label="Chart type"><div class="stk-ct-h"><b>Chart type</b><button class="stk-ct-x" aria-label="Close">&times;</button></div><div class="stk-ct-hint">Press and hold (or tap the star) to add a type to your top bar.</div><div class="stk-ct-g"></div></div>';
    const grid = ov.querySelector('.stk-ct-g'), cur = current();
    const render = () => {
      grid.replaceChildren();
      const f = favs();
      // phone: no top bar, so favourites come first in the sheet
      const list = innerWidth <= 520 ? f.concat(ORDER.filter((x) => !f.includes(x))) : ORDER;
      list.forEach((id) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'stk-ct-b' + (id === cur ? ' on' : '') + (f.includes(id) ? ' fav' : ''); b.dataset.type = id;
        b.setAttribute('aria-label', label(id)); if (id === cur) b.setAttribute('aria-current', 'true');
        b.innerHTML = icon(id) + '<span class="stk-ct-n">' + label(id) + '</span><span class="stk-ct-s" data-star aria-label="' + (f.includes(id) ? 'Remove from' : 'Add to') + ' favourites" role="button">' + (f.includes(id) ? '\u2605' : '\u2606') + '</span>' + (PRO.includes(id) ? '<span class="stk-ct-p">PRO</span>' : '');
        grid.appendChild(b);
      });
    };
    render();
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.stk-ct-x')) close(); });
    const toggle = (id) => { const f = favs(); const i = f.indexOf(id); if (i >= 0) f.splice(i, 1); else f.push(id); saveFavs(f); render(); bar(); };
    // long press = favourite (touch + mouse); a normal tap/click picks the type
    let timer = 0, longDone = false, startXY = null;
    grid.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.stk-ct-b'); if (!b || e.target.closest('[data-star]')) return;
      longDone = false; startXY = [e.clientX, e.clientY];
      timer = setTimeout(() => { longDone = true; try { navigator.vibrate && navigator.vibrate(12); } catch (x) {} toggle(b.dataset.type); }, 520);
    });
    const cancel = () => clearTimeout(timer);
    grid.addEventListener('pointermove', (e) => { if (startXY && Math.hypot(e.clientX - startXY[0], e.clientY - startXY[1]) > 8) cancel(); });
    grid.addEventListener('pointerup', cancel); grid.addEventListener('pointercancel', cancel); grid.addEventListener('pointerleave', cancel);
    grid.addEventListener('contextmenu', (e) => { e.preventDefault(); const b = e.target.closest('.stk-ct-b'); if (b && !longDone) toggle(b.dataset.type); });
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('.stk-ct-b'); if (!b) return;
      if (e.target.closest('[data-star]')) { toggle(b.dataset.type); return; }
      if (longDone) { longDone = false; return; }
      if (choose(b.dataset.type)) close();
    });
    document.body.appendChild(ov);
    const first = grid.querySelector('.on') || grid.firstChild; if (first && first.focus) first.focus();
  }
  // top bar: favourites next to the chart style button
  function bar() {
    const sb = document.querySelector('.vela-widget-style'); if (!sb) return;
    let host = document.getElementById('stk-ct-favs');
    if (!host) { host = document.createElement('span'); host.id = 'stk-ct-favs'; host.style.cssText = 'display:inline-flex;align-items:center'; sb.insertAdjacentElement('afterend', host); }
    const f = favs(), cur = current();
    host.replaceChildren();
    f.forEach((id) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'stk-ct-fav vela-widget-tool' + (id === cur ? ' on' : ''); b.dataset.type = id; b.title = label(id); b.setAttribute('aria-label', label(id));
      b.innerHTML = icon(id); b.addEventListener('click', () => { choose(id); setTimeout(bar, 60); });
      host.appendChild(b);
    });
  }
  document.addEventListener('click', (e) => {
    const sb = e.target.closest && e.target.closest('.vela-widget-style');
    if (!sb) return;
    e.stopImmediatePropagation(); e.preventDefault(); open();
  }, true);
  window.STK_CT_OPEN = open;
  setInterval(bar, 1000);   // cheap: rebuilds only the few favourite buttons; also follows a style change made elsewhere
  bar();
}
