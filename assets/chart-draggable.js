// TradeZoro — Charts: one shared "drag a floating panel by its title row" helper (Owner 15 Nov: "make sure such stuff can be moved around").
//   window.StkDraggable.make(panelEl, headerSel | headerEl, 'key')   // explicit hook for a panel built elsewhere
// Every floating panel / dialog on charts.html is also picked up AUTOMATICALLY from the REGISTRY below (a MutationObserver
// attaches it the moment the panel is created), so panel files need no edit and merges stay trivial.
// Behaviour: pointer events (mouse, touch, pen), 3px threshold (a click on the title still clicks), buttons / inputs / switches
// inside the header never start a drag, uses the CSS `translate` property (does not fight a panel's own transform), keeps at
// least 48px of the header on screen (also after a window resize), remembers the offset per panel key in localStorage,
// double-click on the title = back to the default spot, a dragged non-modal panel is raised above its neighbours.
// Phones (<768px): a panel that spans the screen width is a bottom sheet / full-screen sheet and is NOT draggable.
(function () {
  'use strict';
  if (window.StkDraggable) return;
  var LS = 'stk_drag_pos.v1', MINV = 48, THRESH = 3;
  // panel selector, header selector, storage key, own = a library dialog with its own (non-persisting) drag that we take over
  // (the right-rail panels: Book, GEX Ladder, Dark pool, ... are moved / docked by chart-panel-dock.js instead)
  var REGISTRY = [
    ['.stkhm', '.stkhm-h', 'heatmap'],
    ['.stkhll', '.stkhll-hd', 'hl-ladders'],
    ['.stkwi', '.stkwi-hd', 'wallet-intel'],
    ['.sed', '.sed-hd', 'script-editor'],
    ['.stk-al-box', '.stk-al-head', 'alerts'],
    ['.stk-snd-box', '.stk-al-head', 'alert-sounds'],
    ['.stkiw-card', '.stkiw-hd', 'indicators'],
    ['.stkl-dlg', '.stkl-hd', 'layout-dialog'],
    ['.lyl-panel', '.lyl-hd', 'chart-library'],
    ['.stkt-dlg', '.stkt-hd', 'templates'],
    ['.stkw-dlg', '.stkw-dhd', 'watchlist-dialog'],
    ['.stkc-dcard', '.stkc-dhead', 'pine-dialog'],
    ['.stkpt-tk-box', '.stkpt-tk-head', 'paper-ticket'],
    ['.stk-ct', '.stk-ct-h', 'chart-type'],
    ['.stkdp-sheet:not(.phone)', '.stkdp-head', 'data-connect']
  ];
  // Vela's own dialogs: indicator settings, chart settings, drawing settings, pickers (one key per kind)
  var VELA = [['.vela-dialog.vela-ind-dialog', 'vela-indicator-settings'], ['.vela-dialog.vela-dialog--settings', 'vela-chart-settings'],
    ['.vela-dialog.vela-dsp', 'vela-drawing-settings'], ['.vela-dialog', 'vela-dialog']];
  var INTERACTIVE = 'button,a,input,select,textarea,label,summary,[role=switch],[role=button],[role=tab],[contenteditable=""],[contenteditable=true]';
  var SEL = REGISTRY.map(function (r) { return r[0]; }).concat(['.vela-dialog']).join(',');
  var states = [], seen = new WeakSet(), zSeq = 0, suppress = false;

  function load() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
  function save(key, off) { try { var all = load(); if (off) all[key] = [Math.round(off[0]), Math.round(off[1])]; else delete all[key]; localStorage.setItem(LS, JSON.stringify(all)); } catch (e) {} }
  function velaKey(p) { for (var i = 0; i < VELA.length; i++) if (p.matches(VELA[i][0])) return VELA[i][1]; return 'vela-dialog'; }

  function css() {
    if (document.getElementById('stk-drag-css')) return;
    var hs = REGISTRY.map(function (r) { return r[0].replace(/:not\([^)]*\)/g, '') + ' ' + r[1]; }).concat(['.vela-dialog .vela-dialog-header']).join(',');
    var s = document.createElement('style'); s.id = 'stk-drag-css';
    s.textContent = hs + '{cursor:grab;touch-action:none}.stk-drag-on,.stk-drag-on *{cursor:grabbing !important;user-select:none !important;-webkit-user-select:none !important}' +
      '.stk-drag-on{will-change:translate}@media (max-width:767px){.stk-drag-sheet{touch-action:auto !important}}';
    document.head.appendChild(s);
  }

  function hdrOf(st, t) { var h = t.closest(st.hsel); return h && st.panel.contains(h) ? h : null; }
  function isSheet(p) { return innerWidth < 768 && p.getBoundingClientRect().width >= innerWidth - 8; }
  function setOff(st, x, y) { st.off = [x, y]; st.panel.style.translate = (x || y) ? x + 'px ' + y + 'px' : ''; }

  // keep >= 48px of the header inside the viewport; returns the clamped offset
  function clamp(st, hdr, x, y) {
    var r = hdr.getBoundingClientRect(); if (r.width < MINV) r = st.panel.getBoundingClientRect();   // a tiny grip: keep the whole bar reachable
    if (!r.width && !r.height) return [x, y];
    var nl = r.left - st.off[0], nr = r.right - st.off[0], nt = r.top - st.off[1];
    var vw = document.documentElement.clientWidth, vh = innerHeight, mw = Math.min(MINV, r.width), mh = Math.min(MINV, r.height);
    var top = parseFloat(document.documentElement.style.getPropertyValue('--stkc-top')) || 0;   // never under the site nav
    return [Math.min(Math.max(x, mw - nr), vw - mw - nl), Math.min(Math.max(y, top - nt), vh - mh - nt)];
  }
  function reclamp(st) {
    if (!st.panel.isConnected || !st.off[0] && !st.off[1]) return;
    var h = st.panel.querySelector(st.hsel); if (!h) return;
    if (isSheet(st.panel)) { setOff(st, 0, 0); return; }
    var c = clamp(st, h, st.off[0], st.off[1]); if (c[0] !== st.off[0] || c[1] !== st.off[1]) setOff(st, c[0], c[1]);
  }
  function raise(st) {
    var p = st.panel; if (p.getAttribute('aria-modal') === 'true' || p.closest('.vela-dialog-positioner')) return;
    if (st.z == null) { var z = parseInt(getComputedStyle(p).zIndex, 10); st.z = isNaN(z) ? -1 : z; }
    if (st.z >= 0) p.style.zIndex = String(st.z + 1 + (++zSeq % 40));
  }

  function make(panel, header, key, own) {
    if (!panel || seen.has(panel)) return;
    seen.add(panel); css();
    var hsel = typeof header === 'string' ? header : null;
    if (!hsel) { header.classList.add('stk-drag-h'); hsel = '.stk-drag-h'; }
    var st = { panel: panel, hsel: hsel, key: key, off: [0, 0], z: null };
    states.push(st);
    var saved = load()[key];
    if (saved && saved.length === 2) { st.off = [saved[0], saved[1]]; if (!isSheet(panel)) panel.style.translate = saved[0] + 'px ' + saved[1] + 'px'; }
    // the panel may be hidden / not laid out yet: re-clamp whenever its box changes (first show, resize)
    if (window.ResizeObserver) new ResizeObserver(function () { reclamp(st); }).observe(panel);
    var drag = null;
    panel.addEventListener('pointerdown', function (e) {
      if (e.button > 0 && e.pointerType === 'mouse') return;
      raise(st);
      var h = hdrOf(st, e.target); if (!h || e.target.closest(INTERACTIVE)) return;
      if (isSheet(panel)) return;
      if (own) e.stopPropagation();   // a library dialog's built-in drag must not also move it
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, ox: st.off[0], oy: st.off[1], h: h, go: false };
    }, true);
    panel.addEventListener('dblclick', function (e) {
      var h = hdrOf(st, e.target); if (!h || e.target.closest(INTERACTIVE)) return;
      setOff(st, 0, 0); save(key, null);
    });
    addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.go) { if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return; drag.go = true; panel.classList.add('stk-drag-on'); document.documentElement.classList.add('stk-drag-on'); }
      var c = clamp(st, drag.h, drag.ox + dx, drag.oy + dy); setOff(st, c[0], c[1]); e.preventDefault();
    }, { passive: false });
    function end(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var was = drag.go; drag = null; panel.classList.remove('stk-drag-on'); document.documentElement.classList.remove('stk-drag-on');
      if (was) {
        save(key, st.off);
        // the release can land on a modal backdrop: swallow the click that follows so the dialog doesn't close
        suppress = true; setTimeout(function () { suppress = false; }, 0);
      }
    }
    addEventListener('pointerup', end); addEventListener('pointercancel', end);
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    var list = root.matches(SEL) ? [root] : []; if (root.firstElementChild) list = list.concat([].slice.call(root.querySelectorAll(SEL)));
    list.forEach(function (p) {
      if (seen.has(p)) return;
      for (var i = 0; i < REGISTRY.length; i++) if (p.matches(REGISTRY[i][0])) return make(p, REGISTRY[i][1], REGISTRY[i][2]);
      if (p.matches('.vela-dialog')) make(p, '.vela-dialog-header', velaKey(p), true);
    });
  }

  addEventListener('click', function (e) { if (suppress) { e.stopPropagation(); e.preventDefault(); } }, true);
  addEventListener('resize', function () { states = states.filter(function (s) { return s.panel.isConnected; }); states.forEach(reclamp); });
  window.StkDraggable = { make: make, reset: function (key) { save(key, null); states.forEach(function (s) { if (s.key === key) setOff(s, 0, 0); }); } };

  var queue = [], raf = 0;
  var quietMut = function (ms) { return ms.every(function (m) { const t = m.target, e = t.nodeType === 1 ? t : t.parentElement; return !e || [].every.call(m.addedNodes, function (n) { return n.nodeType === 3; }) && [].every.call(m.removedNodes, function (n) { return n.nodeType === 3; }) || !!e.closest('title,.vela-cell,.stkchart-credit,.stklat-chip'); }); };   // per-tick text updates are not new dialogs: skip them (idle CPU)
  new MutationObserver(function (ms) {
    if (quietMut(ms)) return;
    ms.forEach(function (m) { for (var i = 0; i < m.addedNodes.length; i++) if (m.addedNodes[i].nodeType === 1) queue.push(m.addedNodes[i]); });
    if (!raf && queue.length) raf = requestAnimationFrame(function () { raf = 0; var q = queue; queue = []; q.forEach(scan); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document.documentElement);
})();
