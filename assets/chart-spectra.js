// TradeZoro — Charts: the Spectra panel (ES module). Owner order 2026-11-17 (roadmap card "spectra").
// A right-bar panel beside the chart (the GEX Ladder / Book panel system: the chart narrows, nothing covers it; opening another
// right-bar panel closes this one). Phones: a full sheet opened from the chart toolbar button.
// The board itself is assets/spectra-board.js. A futures chart opens on its market (NQ/MNQ -> QQQ, ES/MES -> SPX, GC/MGC -> GLD);
// clicking a strike draws the converted futures price on the chart (flashLevel, as the GEX Ladder does). Price alerts from the
// cell menu go through the chart's own alert list (chart-alerts.js addAlert), so they show as lines and fire on the server.
// Education only. Not financial advice.
import { createSpectra, iconImg } from './spectra-board.js?v=1115';
import { tickerFor, fmtK } from './spectra-core.js?v=1115';
import { flashLevel } from './chart-gex-levels.js?v=1115';
import * as ProGate from './chart-pro-gate.js?v=1115';

const PHONE_MAX = 700;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const svg = (d, s) => '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const IC_CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';
function el(tag, attrs, html) { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); } if (html) n.innerHTML = html; return n; }
const OTHERS = '.stkw-railbtn:not(.stksp-railbtn), .stkw-phonebtn, .stknw-phonebtn, .stkin-phonebtn, .stkgl-phonebtn';
const isFutSym = (s) => /(^|:)(M?NQ|M?ES|M?GC)([FGHJKMNQUVXZ]\d{1,2}|1!)?$/i.test(String(s || '').trim());

export function mountSpectraPanel(ws, opts) {
  opts = opts || {};
  if (!ws || document.getElementById('stksp')) return null;
  const host = document.querySelector('.stkchart-panel.stkw-host') || document.querySelector('.stkchart-panel');
  if (!host) return null;
  const isPhone = () => window.innerWidth <= PHONE_MAX;
  const toast = (m) => { if (opts.toast) opts.toast(m); };
  let open = false;
  const railBtn = el('button', { type: 'button', class: 'stkw-railbtn stksp-railbtn', title: 'Spectra', 'aria-label': 'Spectra', 'aria-pressed': 'false' }, iconImg(20));
  const closeBtn = el('button', { type: 'button', class: 'stkw-ib stksp-close', title: 'Close', 'aria-label': 'Close Spectra' }, svg(IC_CLOSE));
  const panel = el('aside', { class: 'stksp', id: 'stksp', 'aria-label': 'Spectra', hidden: true });
  const hd = el('div', { class: 'stksp-hd' }, iconImg(20) + '<span class="stksp-title">Spectra</span><span class="stksp-map" aria-live="polite"></span><span class="stksp-sp"></span>');
  hd.appendChild(closeBtn);
  const body = el('div', { class: 'stksp-body' });
  panel.appendChild(hd); panel.appendChild(body); host.appendChild(panel);
  const phoneBtn = el('button', { type: 'button', class: 'stkc-btn stksp-phonebtn', title: 'Spectra', 'aria-label': 'Spectra' }, iconImg(16) + '<span class="stkc-btn-l">Spectra</span>');
  const barR = document.querySelector('#stkc-bar .stkc-bar-r');
  if (barR) { const nb = barR.querySelector('.stkgl-phonebtn') || barR.querySelector('.stknw-phonebtn'); if (nb && nb.parentNode) nb.parentNode.insertBefore(phoneBtn, nb.nextSibling); else barR.insertBefore(phoneBtn, barR.firstChild); }

  const activeSym = () => { try { return ws.active.symbol; } catch (e) { return ''; } };
  const mapEl = hd.querySelector('.stksp-map');
  const board = createSpectra(body, {
    compact: true, store: 'spx-chart', toast,
    chartSymbol: activeSym,
    addPriceAlert: async (doc) => {
      try { const m = await import('./chart-alerts.js?v=1115'); return await m.addAlert(doc); }
      catch (e) { if (e && (e.full || /not ready/.test(e.message))) { if (!e.full) toast('Alerts are still loading. Try again in a moment.'); throw Object.assign(e, { full: true }); } throw e; }
    },
    onPick(u, strike, data) {
      const sym = activeSym(), mapped = tickerFor(sym);
      if (mapped !== u) { toast('Open a ' + (u === 'QQQ' ? 'NQ, MNQ or QQQ' : u === 'SPX' ? 'ES, MES or SPX' : u === 'GLD' ? 'GC, MGC or GLD' : 'SPY') + ' chart to draw this ' + u + ' strike.'); return; }
      let price = strike;
      if (isFutSym(sym)) {
        const f = data && data.fut;
        if (!f || !isNum(f.ratio)) { toast('No futures conversion for ' + u + ' right now.'); return; }
        price = Math.round(strike * f.ratio * 100) / 100;
      }
      flashLevel(ws, price, u + ' ' + fmtK(strike) + ' \u00b7 ' + price.toLocaleString('en-US', { maximumFractionDigits: 2 }), '#4fe3ac');
    }
  });
  // the chart's market decides the board (once per symbol change, so a manual pick is kept until the chart changes)
  let lastSym = null;
  function follow() {
    const sym = activeSym();
    if (sym === lastSym) return;
    lastSym = sym;
    const u = tickerFor(sym);
    mapEl.textContent = u && u !== String(sym).replace(/^[A-Za-z_]+:/, '').toUpperCase() ? String(sym).replace(/^[A-Za-z_]+:/, '').replace(/1!$/, '') + ' \u2192 ' + u : '';
    if (u && !(ProGate.isFree() && u !== 'SPX')) board.setTicker(u);
  }
  function closeOthers() {
    if (host.classList.contains('stkw-open')) { const b = document.querySelector('.stkw .stkw-close'); if (b) b.click(); }
    try { if (window.__stkNews && window.__stkNews.isOpen) window.__stkNews.close(); } catch (e) {}
    try { if (window.__stkSymInfo && window.__stkSymInfo.isOpen) window.__stkSymInfo.close(); } catch (e) {}
    try { if (window.__stkGexLadder && window.__stkGexLadder.isOpen) window.__stkGexLadder.close(); } catch (e) {}
    try { const b = window.__stkBookPanel; if (b && b.isOpen) b.close(); } catch (e) {}
  }
  function setOpen(v) {
    open = !!v;
    if (open) { closeOthers(); follow(); }
    panel.hidden = !open;
    host.classList.toggle('stksp-open', open);
    document.documentElement.classList.toggle('stksp-sheet', open && isPhone());
    railBtn.setAttribute('aria-pressed', String(open)); railBtn.classList.toggle('on', open); phoneBtn.classList.toggle('on', open);
    if (open) board.open(); else board.close();
    requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }
  function placeRail() {
    const rail = document.querySelector('.stkw-rail'); if (!rail) return false;
    if (railBtn.parentNode !== rail) { const after = rail.querySelector('.stkgl-railbtn') || rail.querySelector('.stkw-railbtn'); rail.insertBefore(railBtn, after ? after.nextSibling : rail.firstChild); }
    return true;
  }
  if (!placeRail()) { const mo = new MutationObserver(() => { if (placeRail()) mo.disconnect(); }); mo.observe(host, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 30000); }
  railBtn.addEventListener('click', () => setOpen(!open));
  phoneBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  closeBtn.addEventListener('click', () => setOpen(false));
  document.addEventListener('click', (e) => { if (open && e.target.closest && e.target.closest(OTHERS)) setTimeout(() => setOpen(false), 0); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && isPhone() && !e.defaultPrevented) setOpen(false); });
  window.addEventListener('resize', () => { document.documentElement.classList.toggle('stksp-sheet', open && isPhone()); }, { passive: true });
  try { ws.on('state:changed', () => { if (open) follow(); }); } catch (e) {}
  const api = { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return open; }, board };
  window.__stkSpectra = api;
  return api;
}
