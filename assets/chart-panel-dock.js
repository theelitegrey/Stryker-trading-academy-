// TradeZoro — Charts: one window manager for every panel the right icon rail opens (Owner 19 Nov: "dock to right is not there
// in most of these ... by default you can use the mouse to drag them anywhere, but when dock to right is clicked, they should do it").
//   Floating: a card over the chart. Drag it by its header (kept inside the chart area), resize from the edges / bottom-right
//             corner, a click brings it to the front. Position and size are remembered per panel.
//   Docked:   a full-height column right of the chart (the chart gets narrower, nothing overlaps), resizable left edge.
//             Several docked panels stack in that column as a vertical split with draggable dividers.
//   [Dock to right] / [Undock] sits in each header next to the X; dragging a docked header pulls the panel out.
// The panel files still own open / close and content: this file only places their element (inline left/top/width/height) and
// adds the button + handles. Phones / small tablets (< 768 px) keep today's bottom sheets: the helper switches itself off.
// Defaults: Watchlist + News open docked (list panels), every other panel opens floating. State: localStorage 'stkpd.v1'.
// Vela's own Data window / Object tree get the same treatment (they leave Vela's built-in side column).
(function () {
  'use strict';
  if (window.StkPanelDock) return;
  var LS = 'stkpd.v1', MINW = 260, MINH = 160, DWMIN = 260, DWMAX = 640, PAD = 8, NARROW = 768;
  // key, panel selector, header selector, close button selector, default mode, vela (Vela-owned panel inside .vela-ws-main)
  var REG = [
    ['watchlist', '#stkw', '.stkw-hd', '.stkw-close', 'dock'],
    ['news', '#stknw', '.stknw-hd', '.stknw-close', 'dock'],
    ['symbol-info', '#stkin', '.stkin-hd', '.stkin-close', 'float'],
    ['gex-ladder', '#stkgl', '.stkgl-hd', '.stkgl-close', 'float'],
    ['book', '#stkbp', '.stkbp-hd', '.stkbp-x', 'float'],
    ['spectra', '#stksp', '.stksp-hd', '.stksp-close', 'float'],
    ['phantom', '#stkph', '.stkph-hd', '.stkph-close', 'float'],
    ['darkpool', '#stkdkp', '.stkdkp-hd', '.stkdkp-x', 'float'],
    ['data-window', '.vela-panel.vela-dw', '.vela-panel-header', '.vela-panel-close', 'float', 1],
    ['object-tree', '.vela-panel.vela-ot', '.vela-panel-header', '.vela-panel-close', 'float', 1]
  ];
  var svg = function (d) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  // same icons as the Book panel had: filled right strip = dock, filled left strip = undock
  var DOCK_IC = svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><rect x="14.5" y="4.5" width="6" height="15" fill="currentColor"/>');
  var UNDOCK_IC = svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><rect x="3.5" y="4.5" width="6" height="15" fill="currentColor"/>');
  var INTERACTIVE = 'button,a,input,select,textarea,label,summary,[role=switch],[role=button],[role=tab],[contenteditable]';
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var S = (function () { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } })();
  var save = function () { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} };
  var items = [], zTop = 40, lastCw = -1, host = null, raf = 0;

  // one-time migration: the Book panel's own dock flag (stkbp.v1 .dock) becomes its starting mode here
  if (!S.book) { try { var bp = JSON.parse(localStorage.getItem('stkbp.v1')); if (bp && bp.dock === true) S.book = { m: 'dock', dw: bp.w }; } catch (e) {} }

  function st(it) { var s = S[it.key]; if (!s) { s = S[it.key] = { m: it.def }; } return s; }
  var on = function () { return !!host && innerWidth >= NARROW; };
  function hostEl() { return document.querySelector('.stkchart-panel.stkw-host'); }
  function railW() { var r = host && host.querySelector('.stkw-rail'); return r ? r.offsetWidth : 0; }
  // a panel counts while it is open and sits in its home (the Book panel can be embedded in the order panel)
  function isOpen(it) { var p = it.el; return !!p && p.isConnected && !p.hidden && (it.vela ? !!p.closest('.vela-ws-main') : p.parentElement === host); }
  function docked(it) { return st(it).m === 'dock'; }

  function css() {
    if (document.getElementById('stkpd-css')) return;
    var s = document.createElement('style'); s.id = 'stkpd-css';
    s.textContent =
      '.stkpd-dk,.stkpd-h{display:none}' +
      '@media (min-width:' + NARROW + 'px){' +
      // the chart gives up exactly the dock column (the panels' own "-open" widths no longer apply while the helper runs)
      '.stkchart-panel.stkw-host.stkpd-on:not(.stkwi-open):not(.stkhll-open) #vela-chart{right:calc(var(--stkw-rail,44px) + var(--stkpd-cw,0px)) !important}' +
      '.stkpd-p{right:auto !important;bottom:auto !important;max-width:none !important;min-width:0 !important}' +
      '.stkpd-p.stkpd-float{border:1px solid var(--line-soft) !important;border-radius:12px !important;box-shadow:0 8px 24px rgba(0,0,0,.35);overflow:hidden}' +
      '.stkpd-p.stkpd-dock{border-radius:0 !important;box-shadow:none}' +
      '.stkpd-p.stkpd-dock.stkpd-nth{border-top:1px solid var(--line-soft) !important}' +
      '.stkpd-p .stkw-grip,.stkpd-p .stkbp-grip,.stkpd-p .stkbp-grab{display:none !important}' +
      '.stkpd-hd{cursor:grab;touch-action:none}.stkpd-hd img{pointer-events:none;-webkit-user-drag:none}.stkpd-moving,.stkpd-moving *{cursor:grabbing !important;user-select:none !important;-webkit-user-select:none !important}' +
      '.stkpd-sizing,.stkpd-sizing *{user-select:none !important;-webkit-user-select:none !important}' +
      // header buttons: [title] ... [Dock to right] [X], 28 px, one centre line
      '.stkpd-hd .stkpd-dk,.stkpd-hd .stkw-ib,.stkpd-hd .stkbp-x,.stkpd-hd .vela-panel-close{width:28px !important;height:28px !important;min-width:28px;padding:0 !important;flex:none;border-radius:6px !important;display:inline-flex;align-items:center;justify-content:center}' +
      '.stkpd-hd .stkgl-pk{height:28px !important}' +   // GEX Ladder market chips = button height
      '.stkpd-dk{border:0;background:transparent;color:var(--ink-2);cursor:pointer;margin:0}' +
      '.stkpd-dk:hover{background:var(--bg-3,var(--bg-2));color:var(--ink-0)}' +
      '.stkpd-dk:focus-visible{outline:2px solid var(--teal,#00adb5);outline-offset:-2px}' +
      '.stkpd-dk svg{width:18px;height:18px;display:block}' +
      '.stkpd-hd .stkpd-dk + *{margin-left:4px !important}' +
      // handles: floating = left / right / bottom edges + bottom-right corner; docked = left edge (column width) + top divider
      '.stkpd-h{position:absolute;z-index:6;touch-action:none}' +
      '.stkpd-float>.stkpd-h-w,.stkpd-dock>.stkpd-h-w{display:block;left:0;top:0;bottom:0;width:6px;cursor:ew-resize}' +
      '.stkpd-float>.stkpd-h-e{display:block;right:0;top:0;bottom:0;width:6px;cursor:ew-resize}' +
      '.stkpd-float>.stkpd-h-s{display:block;left:0;right:0;bottom:0;height:6px;cursor:ns-resize}' +
      '.stkpd-float>.stkpd-h-se{display:block;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:7}' +
      '.stkpd-float>.stkpd-h-se::after{content:"";position:absolute;right:4px;bottom:4px;width:7px;height:7px;border-right:2px solid var(--ink-3);border-bottom:2px solid var(--ink-3);border-bottom-right-radius:2px;opacity:.7}' +
      '.stkpd-dock.stkpd-nth>.stkpd-h-n{display:block;left:0;right:0;top:-3px;height:7px;cursor:ns-resize}' +
      '.stkpd-h-w::after,.stkpd-h-n::after{content:"";position:absolute;border-radius:1px;background:var(--ink-3);opacity:0;transition:opacity .15s cubic-bezier(.2,0,0,1)}' +
      '.stkpd-h-w::after{left:2px;top:50%;width:2px;height:32px;margin-top:-16px}.stkpd-h-n::after{top:3px;left:50%;height:2px;width:32px;margin-left:-16px}' +
      '.stkpd-h-w:hover::after,.stkpd-h-n:hover::after,.stkpd-sizing .stkpd-h::after{opacity:.7}' +
      '}';
    document.head.appendChild(s);
  }

  function setBtn(it) {
    var b = it.btn, d = docked(it), t = d ? 'Undock' : 'Dock to right';
    if (b.dataset.m === (d ? 'dock' : 'float')) return;
    b.dataset.m = d ? 'dock' : 'float'; b.innerHTML = d ? UNDOCK_IC : DOCK_IC; b.title = t; b.setAttribute('aria-label', t);
    b.setAttribute('aria-pressed', String(d));
  }
  // the button + handles live inside the panel; a panel re-rendered by its owner (Vela) gets them back on the next layout
  function ensureParts(it) {
    var p = it.el, hd = p.querySelector(it.hsel), x = hd && hd.querySelector(it.xsel);
    if (hd) hd.classList.add('stkpd-hd');
    if (!it.btn) {
      it.btn = document.createElement('button'); it.btn.type = 'button'; it.btn.className = 'stkpd-dk';
      it.btn.addEventListener('click', function (e) { e.stopPropagation(); setMode(it, docked(it) ? 'float' : 'dock'); });
    }
    if (hd && x && it.btn.parentNode !== x.parentNode) x.parentNode.insertBefore(it.btn, x);
    else if (hd && !x && it.btn.parentNode !== hd) hd.appendChild(it.btn);
    setBtn(it);
    ['w', 'e', 's', 'se', 'n'].forEach(function (k) {
      var h = it.hs[k];
      if (!h) { h = it.hs[k] = document.createElement('div'); h.className = 'stkpd-h stkpd-h-' + k; h.setAttribute('aria-hidden', 'true'); bindHandle(it, h, k); }
      if (h.parentNode !== p) p.appendChild(h);
    });
  }

  function clear(it) {
    var p = it.el; if (!p) return;
    p.classList.remove('stkpd-p', 'stkpd-float', 'stkpd-dock', 'stkpd-nth');
    ['left', 'top', 'width', 'height', 'z-index', 'position'].forEach(function (k) { p.style.removeProperty(k); });
  }
  function put(p, x, y, w, h) {
    p.style.left = Math.round(x) + 'px'; p.style.top = Math.round(y) + 'px'; p.style.width = Math.round(w) + 'px'; p.style.height = Math.round(h) + 'px';
  }
  // floating windows stay over the chart itself: left of the dock column, the docked order panel (its margin) and the rail
  function chartRight(W) {
    var vc = document.getElementById('vela-chart'), hr = host.getBoundingClientRect();
    var r = vc && vc.getBoundingClientRect(); return r && r.width ? Math.round(r.right - hr.left) : W - railW() - Math.max(0, lastCw);
  }
  // floating box in host coordinates, clamped inside the chart area (host minus the icon rail)
  function fbox(it, W, H) {
    var s = st(it), aw = chartRight(W), n = REG.findIndex(function (r) { return r[0] === it.key; }) % 5;
    var w = s.w || clamp(it.natW || 360, MINW, 560), h = s.h || H - 2 * PAD;   // default: full chart height (like the old floating Book card)
    w = clamp(w, MINW, Math.max(MINW, aw - 2 * PAD)); h = clamp(h, MINH, Math.max(MINH, H - 2 * PAD));
    var x = s.x != null ? s.x : aw - w - PAD - 12 - n * 24, y = s.y != null ? s.y : PAD + n * 24;
    return { x: clamp(x, 0, Math.max(0, aw - w)), y: clamp(y, 0, Math.max(0, H - h)), w: w, h: h };
  }

  function layout() {
    raf = 0;
    host = host && host.isConnected ? host : hostEl();
    if (!host) return;
    scan();
    if (!on()) {
      items.forEach(clear); host.classList.remove('stkpd-on'); host.style.removeProperty('--stkpd-cw');
      if (lastCw > 0) { lastCw = 0; fireResize(); }
      return;
    }
    host.classList.add('stkpd-on');
    var W = host.clientWidth, H = host.clientHeight, rw = railW();
    var open = items.filter(isOpen), col = open.filter(docked)
      .sort(function (a, b) { return (st(a).t || 0) - (st(b).t || 0); });
    var cw = col.length ? clamp(Math.max.apply(null, col.map(function (it) { return st(it).dw || it.natW || 340; })), DWMIN, Math.min(DWMAX, Math.round((W - rw) * 0.6))) : 0;
    host.style.setProperty('--stkpd-cw', cw + 'px'); var cw0 = lastCw; lastCw = cw;
    // docked column: a vertical split, each panel's share = its weight (wt)
    var tot = col.reduce(function (a, it) { return a + (st(it).wt || 1); }, 0), y = 0;
    col.forEach(function (it, i) {
      var p = it.el; if (!it.natW) it.natW = p.offsetWidth; ensureParts(it);
      var h = i === col.length - 1 ? H - y : Math.max(MINH / 2, Math.round(H * (st(it).wt || 1) / tot)), o = offs(it);
      p.classList.add('stkpd-p', 'stkpd-dock'); p.classList.remove('stkpd-float'); p.classList.toggle('stkpd-nth', i > 0);
      p.style.removeProperty('z-index'); put(p, W - rw - cw - o[0], y - o[1], cw, h); y += h;
    });
    open.forEach(function (it) {
      var p = it.el; if (col.indexOf(it) >= 0) return;
      if (!it.natW) it.natW = p.offsetWidth;
      ensureParts(it);
      var b = fbox(it, W, H), o = offs(it), ox = o[0], oy = o[1];
      p.classList.add('stkpd-p', 'stkpd-float'); p.classList.remove('stkpd-dock', 'stkpd-nth');
      if (!it.z) it.z = ++zTop;
      p.style.zIndex = String(it.z);
      put(p, b.x - ox, b.y - oy, b.w, b.h);
    });
    items.forEach(function (it) { if (!isOpen(it) && it.el && it.el.classList.contains('stkpd-p')) clear(it); });
    if (cw !== cw0) fireResize();
  }
  // Vela's Data window / Object tree sit inside .vela-ws-main (which starts where the host does): taken out of Vela's flex
  // column (position:absolute) and placed in host coordinates like the others
  function offs(it) {
    if (!it.vela) return [0, 0];
    it.el.style.position = 'absolute';
    var m = it.el.parentElement.getBoundingClientRect(), hr = host.getBoundingClientRect(); return [m.left - hr.left, m.top - hr.top];
  }
  function fireResize() { requestAnimationFrame(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }); }
  function schedule() { if (!raf) raf = requestAnimationFrame(layout); }

  function setMode(it, m, keep) {
    var s = st(it); if (s.m === m && !keep) return;
    s.m = m; if (m === 'dock') { s.t = Date.now(); s.wt = 1; }
    save(); setBtn(it); layout(); fireResize();
  }
  function raise(it) { if (!docked(it)) { it.z = ++zTop; if (it.el) it.el.style.zIndex = String(it.z); } }

  // header drag: floating = move; docked = pulled out after 6 px, then moves
  function bindHeader(it) {
    it.el.addEventListener('pointerdown', function (e) {
      if (!on() || (e.button > 0 && e.pointerType === 'mouse')) return;
      raise(it);
      var hd = e.target.closest && e.target.closest(it.hsel);
      if (!hd || !it.el.contains(hd) || e.target.closest(INTERACTIVE)) return;
      var hr = host.getBoundingClientRect(), r = it.el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY, go = false;
      var gx = x0 - r.left, gy = y0 - r.top, b0 = null, id = e.pointerId;
      function mv(ev) {
        if (ev.pointerId !== id) return;
        if (!go) {
          if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
          go = true; document.documentElement.classList.add('stkpd-moving');
          if (docked(it)) {   // pull out: the card keeps the grab point under the pointer
            var s = st(it), fb = fbox(it, host.clientWidth, host.clientHeight);
            s.m = 'float'; gx = Math.min(gx, fb.w - 40); s.x = ev.clientX - hr.left - gx; s.y = ev.clientY - hr.top - gy; setBtn(it); layout(); fireResize();
          }
          b0 = fbox(it, host.clientWidth, host.clientHeight);
        }
        var s2 = st(it); s2.x = ev.clientX - hr.left - gx; s2.y = ev.clientY - hr.top - gy;
        var b = fbox(it, host.clientWidth, host.clientHeight); s2.x = b.x; s2.y = b.y; s2.w = b.w; s2.h = b.h;
        layout(); ev.preventDefault();
      }
      function up(ev) {
        if (ev.pointerId !== id) return;
        removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        document.documentElement.classList.remove('stkpd-moving');
        if (go) { save(); var sup = function (ce) { ce.stopPropagation(); ce.preventDefault(); }; addEventListener('click', sup, true); setTimeout(function () { removeEventListener('click', sup, true); }, 0); }
      }
      addEventListener('pointermove', mv, { passive: false }); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    }, true);
    // double-click on the header of a floating panel: back to its default spot and size
    it.el.addEventListener('dblclick', function (e) {
      if (!on() || docked(it) || !e.target.closest(it.hsel) || e.target.closest(INTERACTIVE)) return;
      var s = st(it); delete s.x; delete s.y; delete s.w; delete s.h; save(); layout();
    });
  }

  function bindHandle(it, h, k) {
    h.addEventListener('pointerdown', function (e) {
      if (!on() || e.button > 0) return;
      e.preventDefault(); e.stopPropagation();
      try { h.setPointerCapture(e.pointerId); } catch (x) {}
      var s = st(it), x0 = e.clientX, y0 = e.clientY, W = host.clientWidth, H = host.clientHeight, aw = docked(it) ? W - railW() : chartRight(W);
      var b0 = fbox(it, W, H), dw0 = lastCw || s.dw || 340;
      var col = items.filter(function (o) { return isOpen(o) && docked(o); }).sort(function (a, b) { return (st(a).t || 0) - (st(b).t || 0); });
      var prev = col[col.indexOf(it) - 1], wa = st(it).wt || 1, wb = prev ? (st(prev).wt || 1) : 1, ha = it.el.offsetHeight, hb = prev ? prev.el.offsetHeight : 0;
      document.documentElement.classList.add('stkpd-sizing');
      function mv(ev) {
        var dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (docked(it)) {
          if (k === 'w') { var dw = clamp(dw0 - dx, DWMIN, Math.min(DWMAX, Math.round(aw * 0.6))); col.forEach(function (o) { st(o).dw = dw; }); }
          else if (k === 'n' && prev) {   // divider: move height between this panel and the one above
            var nh = clamp(ha - dy, MINH / 2, ha + hb - MINH / 2), sum = wa + wb;
            st(it).wt = sum * nh / (ha + hb); st(prev).wt = sum - st(it).wt;
          }
        } else {
          if (k === 'e' || k === 'se') s.w = clamp(b0.w + dx, MINW, aw - b0.x);
          if (k === 's' || k === 'se') s.h = clamp(b0.h + dy, MINH, H - b0.y);
          if (k === 'w') { var nw = clamp(b0.w - dx, MINW, b0.x + b0.w); s.x = b0.x + b0.w - nw; s.w = nw; }
          if (s.x == null) { s.x = b0.x; s.y = b0.y; }
        }
        layout();
      }
      function up() {
        h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
        document.documentElement.classList.remove('stkpd-sizing'); save(); fireResize();
      }
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
  }

  // attach to panels as their modules create them; re-layout whenever one opens / closes
  var seen = new WeakSet(), attrMO = new MutationObserver(schedule);
  function scan() {
    REG.forEach(function (r) {
      var p = document.querySelector(r[1]);
      var it = items.find(function (o) { return o.key === r[0]; });
      if (!it) { it = { key: r[0], sel: r[1], hsel: r[2], xsel: r[3], def: r[4], vela: !!r[5], el: null, hs: {}, btn: null }; items.push(it); }
      if (!p || seen.has(p)) return;
      seen.add(p); it.el = p; it.natW = 0;
      attrMO.observe(p, { attributes: true, attributeFilter: ['hidden'] });
      bindHeader(it);
    });
  }
  function boot() {
    host = hostEl(); css();
    if (!host) return false;
    scan(); layout();
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        for (var j = 0; j < ms[i].addedNodes.length; j++) {
          var n = ms[i].addedNodes[j]; if (n.nodeType === 1 && (n.matches('aside,.vela-panel,.vela-workspace,.vela-ws-main') || n.querySelector && n.querySelector('.vela-panel'))) { schedule(); return; }
        }
        // a panel moved out (the Book panel embedded in the order panel): drop our placement
        for (var k = 0; k < ms[i].removedNodes.length; k++) if (ms[i].removedNodes[k].nodeType === 1 && ms[i].removedNodes[k].matches('aside')) { schedule(); return; }
      }
    }).observe(host, { childList: true, subtree: true });
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(host);
    addEventListener('resize', schedule, { passive: true });
    return true;
  }
  if (!boot()) {
    var mo = new MutationObserver(function () { if (boot()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.StkPanelDock = {
    // true = rail panels can be open side by side (desktop / tablet); the panel files skip their "close the others" rule then
    on: function () { return on(); },
    isDocked: function (key) { var it = items.find(function (o) { return o.key === key; }); return !!it && docked(it); },
    dock: function (key, v) { var it = items.find(function (o) { return o.key === key; }); if (it) setMode(it, v === false ? 'float' : 'dock'); },
    layout: layout, _state: function () { return S; }
  };
})();
