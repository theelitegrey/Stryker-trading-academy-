// TradeZoro: "Chart type" sheet (grid, 3 columns on phone) + favourites in the top bar.
// Replaces the plain dropdown of the chart-style button. Long-press (touch) or right-click / star (mouse) a type = favourite;
// favourites sit as small icon buttons next to the style button. Pro types (Volume footprint, TPO, Session volume
// profile) show a PRO tag and open the plan modal for Free members (assets/chart-pro-gate.js).
import * as Gate from './chart-pro-gate.js?v=1108';
import { CT_ICONS, CT_LABELS } from './chart-types.js?v=1108';

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
const GROUPS = [['BARS & CANDLES', ['bars', 'candles', 'stk_hollow', 'stk_volcandle', 'stk_columns', 'stk_highlow']], ['LINES', ['line', 'stk_linemark', 'stk_step']],
  ['AREAS', ['area', 'stk_hlcarea', 'baseline']], ['ORDER FLOW', ['stk_fp', 'stk_tpoc', 'stk_svp']], ['ADVANCED', ['heikinashi', 'stk_renko', 'stk_linebreak', 'stk_kagi', 'stk_pnf', 'stk_range']]];
// Alt + 1..9 (real hook below: keydown on document, matched by physical key so Mac Option works)
const KEYS = ['bars', 'candles', 'stk_hollow', 'line', 'area', 'baseline', 'heikinashi', 'stk_renko', 'stk_kagi'];
const PRO = ['stk_fp', 'stk_tpoc', 'stk_svp'];
const icon = (id) => (CT_ICONS[id] ? CT_ICONS[id] : svg(ICON[id] || ''));
const label = (id) => CT_LABELS[id] || LABEL[id] || id;

const CSS = `
.stk-ct-ov{position:fixed;inset:0;z-index:2147483000}
.stk-ct-ov.sheet{background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}
.stk-ct{position:fixed;width:320px;max-height:min(640px,calc(100dvh - 24px));display:flex;flex-direction:column;box-sizing:border-box;background:#131316;color:rgba(255,255,255,.92);border:1px solid rgba(255,255,255,.08);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.5);font:14px/20px -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;opacity:0;transform:translateY(-4px);transition:opacity .12s ease,transform .12s ease}
.stk-ct.in{opacity:1;transform:none}
.sheet .stk-ct{position:static;width:100%;max-height:85dvh;border-radius:16px 16px 0 0;transform:translateY(16px)}.sheet .stk-ct.in{transform:none}
.stk-ct-h{display:none;align-items:center;justify-content:space-between;padding:8px 8px 4px 16px}.sheet .stk-ct-h{display:flex}
.stk-ct-h b{font-size:17px;font-weight:600}
.stk-ct-x{all:unset;cursor:pointer;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:22px;color:rgba(255,255,255,.64);font-size:22px}
.stk-ct-x:hover{background:rgba(255,255,255,.08)}
.stk-ct-g{overflow:auto;padding:4px 0 8px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}
.stk-ct-g::-webkit-scrollbar{width:4px}.stk-ct-g::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:4px}.stk-ct-g::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.45)}.stk-ct-g::-webkit-scrollbar-button{display:none}
.stk-ct-sec{padding:12px 12px 4px;font-size:11px;line-height:16px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.44)}
.stk-ct-sec:not(:first-child){margin-top:4px;border-top:1px solid rgba(255,255,255,.08)}
.stk-ct-b{all:unset;box-sizing:border-box;position:relative;cursor:pointer;height:36px;width:100%;display:flex;align-items:center;gap:12px;padding:0 12px;color:rgba(255,255,255,.92);-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.stk-ct-b:hover,.stk-ct-b:focus-visible{background:rgba(255,255,255,.06)}
.stk-ct-b:focus-visible{outline:2px solid #03c988;outline-offset:-2px}
.stk-ct-i{flex:none;width:18px;height:18px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.64)}
.stk-ct-i svg{width:18px;height:18px;display:block}
.stk-ct-i svg *{stroke-width:2}.stk-ct-i svg [fill=\"currentColor\"]{fill:none}.stk-ct-i svg [stroke=\"none\"]{stroke:currentColor}
.stk-ct-n{flex:1;min-width:0;font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stk-ct-p{flex:none;font-size:10px;line-height:14px;font-weight:700;letter-spacing:.04em;color:#0b0b0d;background:#f5b301;border-radius:4px;padding:0 4px}
.stk-ct-k{flex:none;min-width:44px;text-align:right;font-size:12px;line-height:16px;color:rgba(255,255,255,.44);white-space:nowrap}
.stk-ct-c{flex:none;width:16px;height:16px;color:#03c988;display:none}.stk-ct-c svg{width:16px;height:16px;display:block}
.stk-ct-b.on .stk-ct-c{display:block}.stk-ct-b.on .stk-ct-i,.stk-ct-b.on .stk-ct-n{color:#03c988}
.stk-ct-s{flex:none;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:12px;color:rgba(255,255,255,.44);font-size:14px;opacity:0}
.stk-ct-b:hover .stk-ct-s,.stk-ct-b:focus-visible .stk-ct-s,.stk-ct-b.fav .stk-ct-s{opacity:1}
.stk-ct-s:hover{background:rgba(255,255,255,.1);color:#f5b301}.stk-ct-b.fav .stk-ct-s{color:#f5b301}
@media (hover:none){.stk-ct-s{opacity:1}}
.sheet .stk-ct-b{height:48px}
@media (prefers-reduced-motion:reduce){.stk-ct{transition:none}}
.vela-widget-tool.stk-ct-fav{all:unset;box-sizing:border-box;cursor:pointer;width:32px;height:30px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;color:var(--vela-fg-muted,#9598a1)}
.stk-ct-fav:hover{background:var(--vela-hover,rgba(255,255,255,.08));color:var(--vela-fg-bright,#fff)}
.stk-ct-fav.on{color:#2962ff}.stk-ct-fav svg{width:20px;height:20px}
:root[data-theme="light"] .stk-ct{background:#fff;color:#1d1d1f;border-color:rgba(0,0,0,.1);box-shadow:0 12px 32px rgba(0,0,0,.16)}
:root[data-theme="light"] .stk-ct-sec:not(:first-child){border-color:rgba(0,0,0,.08)}
:root[data-theme="light"] .stk-ct-sec,:root[data-theme="light"] .stk-ct-k,:root[data-theme="light"] .stk-ct-s{color:rgba(0,0,0,.5)}
:root[data-theme="light"] .stk-ct-b{color:#1d1d1f}
:root[data-theme="light"] .stk-ct-i,:root[data-theme="light"] .stk-ct-x{color:rgba(0,0,0,.6)}
:root[data-theme="light"] .stk-ct-b:hover,:root[data-theme="light"] .stk-ct-b:focus-visible{background:rgba(0,0,0,.05)}
:root[data-theme="light"] .stk-ct-b.on .stk-ct-i,:root[data-theme="light"] .stk-ct-b.on .stk-ct-n,:root[data-theme="light"] .stk-ct-c{color:#02875f}
:root[data-theme="light"] .stk-ct-x:hover,:root[data-theme="light"] .stk-ct-s:hover{background:rgba(0,0,0,.06)}
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
  const anchorEl = () => (innerWidth > 520 ? document.querySelector('.vela-widget-style') : null);
  const pinned = false;
  function open() {
    // phone toolbar "More" list (chart-onebar.js) holds the Chart type button: close it so it can't sit over the sheet
    const mb = document.querySelector('.stkc-ob-more-btn[aria-expanded="true"]');
    if (mb) mb.click();
    const dr = document.querySelector('.vela-drawer[data-state="open"]');
    if (dr) {
      dr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      const bd = document.querySelector('.vela-drawer-backdrop');
      setTimeout(() => { if (document.querySelector('.vela-drawer[data-state="open"]') && bd) bd.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }, 60);
      setTimeout(() => open2(null), 260); return;
    }
    open2(anchorEl());
  }
  const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
  let closeFn = null;
  function open2(anchor) {
    if (document.querySelector('.stk-ct-ov')) return;
    const sheet = innerWidth <= 520 || !anchor;
    const ov = document.createElement('div'); ov.className = 'stk-ct-ov' + (sheet ? ' sheet' : '');
    ov.innerHTML = '<div class="stk-ct" role="menu" aria-label="Chart type"><div class="stk-ct-h"><b>Chart type</b><button class="stk-ct-x" aria-label="Close">&times;</button></div><div class="stk-ct-g"></div></div>';
    const box = ov.firstChild, grid = ov.querySelector('.stk-ct-g'), cur = current();
    const render = () => {
      grid.replaceChildren();
      const f = favs();
      GROUPS.forEach(([name, ids]) => {
        const h = document.createElement('div'); h.className = 'stk-ct-sec'; h.textContent = name; grid.appendChild(h);
        ids.forEach((id) => {
          const k = KEYS.indexOf(id);
          const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', id === cur ? 'true' : 'false');
          b.className = 'stk-ct-b' + (id === cur ? ' on' : '') + (f.includes(id) ? ' fav' : ''); b.dataset.type = id;
          b.setAttribute('aria-label', label(id)); if (id === cur) b.setAttribute('aria-current', 'true');
          b.innerHTML = '<span class="stk-ct-i">' + icon(id) + '</span><span class="stk-ct-n">' + label(id) + '</span>' + (PRO.includes(id) ? '<span class="stk-ct-p">PRO</span>' : '') +
            '<span class="stk-ct-c">' + CHECK + '</span><span class="stk-ct-s" data-star aria-label="' + (f.includes(id) ? 'Remove from' : 'Add to') + ' favourites" role="button">' + (f.includes(id) ? '\u2605' : '\u2606') + '</span>' +
            (sheet ? '' : '<span class="stk-ct-k">' + (k >= 0 ? 'Alt + ' + (k + 1) : '') + '</span>');
          grid.appendChild(b);
        });
      });
    };
    render();
    const close = () => { clearTimeout(hideT); ov.remove(); closeFn = null; document.removeEventListener('keydown', onKey, true); };
    closeFn = close;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); const bs = [...grid.querySelectorAll('.stk-ct-b')]; const i = bs.indexOf(document.activeElement);
        bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.stk-ct-x')) close(); });
    // desktop popover: under the style button, clamped to the viewport; closes shortly after the pointer leaves both
    let hideT = 0;
    if (!sheet) {
      const r = anchor.getBoundingClientRect(), bw = 320;
      box.style.left = Math.max(8, Math.min(r.left, innerWidth - bw - 8)) + 'px'; box.style.top = Math.round(r.bottom + 4) + 'px';
      box.style.maxHeight = Math.max(200, innerHeight - r.bottom - 16) + 'px';
      ov.style.pointerEvents = 'none'; box.style.pointerEvents = 'auto';
      document.addEventListener('pointerdown', function away(e) { if (!document.body.contains(ov)) { document.removeEventListener('pointerdown', away, true); return; } if (!box.contains(e.target) && !anchor.contains(e.target)) { close(); document.removeEventListener('pointerdown', away, true); } }, true);
      const leave = () => { clearTimeout(hideT); hideT = setTimeout(() => { if (!pinned) close(); }, 220); };
      const enter = () => clearTimeout(hideT);
      box.addEventListener('pointerenter', enter); box.addEventListener('pointerleave', leave); anchor.addEventListener('pointerenter', enter); anchor.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') leave(); });
    }
    const toggle = (id) => { const f = favs(); const i = f.indexOf(id); if (i >= 0) f.splice(i, 1); else f.push(id); saveFavs(f); const y = grid.scrollTop; render(); grid.scrollTop = y; bar(); };
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
    requestAnimationFrame(() => box.classList.add('in'));
    const first = sheet && (grid.querySelector('.on') || grid.querySelector('.stk-ct-b')); if (first && first.focus) first.focus({ preventScroll: false });
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
    e.stopImmediatePropagation(); e.preventDefault();
    if (!document.querySelector('.stk-ct-ov')) open();   // hover already opened it: a click keeps it open
  }, true);
  // hover opens the menu (mouse only; touch keeps tap)
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || innerWidth <= 520) return;
    if (e.target.closest && e.target.closest('.vela-widget-style') && !document.querySelector('.stk-ct-ov')) open();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !/^Digit[1-9]$/.test(e.code)) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const id = KEYS[+e.code.slice(5) - 1]; if (!id) return;
    e.preventDefault(); if (choose(id)) setTimeout(bar, 60);
  });
  window.STK_CT_OPEN = open;
  setInterval(bar, 1000);   // cheap: rebuilds only the few favourite buttons; also follows a style change made elsewhere
  bar();
}
