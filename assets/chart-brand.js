// TradeZoro chart corner mark (Owner order 2026-11-09): the square TZ mark, bottom-left of the MAIN price pane
// of every chart (Charts page cells, backtest chart, Replay, GEX price chart, GEX heatmap). Always on: no
// setting, no menu, no key. chip-only pointer area (hover pill, mouse only), never a link. Plain script (also import()ed by vela-chart.js);
// exposes window.TzBrand. One small cached image; DOM overlay (or one drawImage on canvas charts), no per-frame work.
// Chart screenshots: Vela's own export rasterises any [data-vela-screenshot] element in the plot, so the mark
// rides along in exports, layout shots and thumbnails. Art: tradezoro-tzmark-1014 (TZ mark only).
(function (root) {
  'use strict';
  if (root.TzBrand) return;
  var SRC = '/assets/images/tradezoro-tzmark-1014-144.webp';
  var WM = '/assets/images/tradezoro-wordmark-1014-192.webp';   // official wordmark, same file as the app top bar
  var OPACITY = 0.4;
  var phone = function () { return root.matchMedia && root.matchMedia('(max-width: 640px)').matches; };
  var size = function () { return phone() ? 32 : 40; };   // CSS px tall (resting chip)
  var img = null;
  function image(cb) {
    if (!img) { img = new Image(); img.decoding = 'async'; img.src = SRC; }
    if (cb && !img.complete) img.addEventListener('load', cb, { once: true });
    return img;
  }
  var css = false;
  function style() {
    if (css || !root.document) return; css = true;
    var s = document.createElement('style');
    // Chip: round dark glass at rest; .is-open (mouse hover) widens it to a pill and slides the name out. Only the chip takes the pointer.
    // Sizes (8pt grid): chip 40 / mark 28 / pad 5+1 border (phone 32 / 22 / 4+1); open = chip + 8 gap + wordmark (art 820x192, CSS height) + 0 .
    s.textContent = '.tz-brand{--c:40px;--m:28px;--wh:20px;--ww:85.42px;position:absolute;left:12px;z-index:5;box-sizing:border-box;height:var(--c);width:var(--c);border-radius:calc(var(--c)/2);padding:0 5px;display:flex;align-items:center;overflow:hidden;white-space:nowrap;' +
      'background:rgba(12,12,14,.6);border:1px solid rgba(255,255,255,.12);pointer-events:auto;cursor:default;user-select:none;-webkit-user-select:none;opacity:.6;' +
      'transition:width .22s ease-out,padding .22s ease-out,opacity .22s ease-out}' +
      '.tz-brand.is-open{width:calc(var(--ww) + 26px);padding:0 12px;opacity:.95}' +
      '.tz-brand.is-open img:first-child{width:0;opacity:0}' +
      '.tz-brand img{flex:none;display:block;height:var(--m);width:var(--m);pointer-events:none;-webkit-user-drag:none;transition:width .22s ease-out,opacity .22s ease-out}' +
      '.tz-brand img.tz-brand-w{height:var(--wh);width:var(--ww);margin-left:0;visibility:hidden;opacity:0;transform:translateX(-8px);' +
      'transition:opacity .22s ease-out,transform .22s ease-out,visibility 0s .22s}' +
      '.tz-brand.is-open img.tz-brand-w{visibility:visible;opacity:1;transform:none;transition-delay:0s}' +
      ':root[data-theme="light"] .tz-brand{background:rgba(255,255,255,.7);border-color:rgba(0,0,0,.14)}' +
      ':root[data-theme="light"] .tz-brand img.tz-brand-w{filter:saturate(1.25) contrast(1.12) brightness(.82)}' +
      '@media (max-width:640px){.tz-brand{--c:32px;--m:22px;--wh:16px;--ww:68.33px;padding:0 4px}}' +
      '@media (hover:none){.tz-brand{pointer-events:none}}' +
      '@media (prefers-reduced-motion:reduce){.tz-brand{transition:none!important}.tz-brand img.tz-brand-w,.tz-brand img{transition:opacity .22s linear!important;transform:none!important}}';
    document.head.appendChild(s);
  }
  // host: positioned element. bottomPx(): distance from host bottom edge to the bottom edge of the main pane.
  function mount(host, bottomPx, opts) {
    if (!host || host.__tzBrand) return host && host.__tzBrand;
    style();
    var el = document.createElement('div');
    el.className = 'tz-brand'; el.setAttribute('aria-hidden', 'true');
    if (opts && opts.shot) el.setAttribute('data-vela-screenshot', '1');
    var im = document.createElement('img'); im.alt = ''; im.src = SRC; im.draggable = false;
    var wm = document.createElement('img'); wm.className = 'tz-brand-w'; wm.alt = ''; wm.src = WM; wm.draggable = false;
    el.appendChild(im); el.appendChild(wm); host.appendChild(el);
    // Hover (mouse only): widen to a pill and slide the wordmark in. Not a link; nothing happens on tap.
    el.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') el.classList.add('is-open'); });
    el.addEventListener('pointerleave', function () { el.classList.remove('is-open'); });
    var last = null;
    var api = host.__tzBrand = { el: el, update: function () {
      var b = null; try { b = bottomPx(); } catch (e) {}
      if (b == null || !isFinite(b)) { if (last !== 'h') { el.style.display = 'none'; last = 'h'; } return; }
      var v = Math.round(b + 12) + 'px';
      if (last === v) return; last = v; el.style.display = ''; el.style.bottom = v;
    } };
    if (root.ResizeObserver) new ResizeObserver(function () { api.update(); }).observe(host);
    api.update();
    return api;
  }
  // Canvas charts: draw the mark at (x, y) top-left (device px when k scales), once per paint.
  function draw(ctx, x, y, repaint, k) {
    var im = image(repaint); if (!im.complete || !im.naturalWidth) return;
    // Canvas twin of the resting chip: glass disc + mark. (x, y) = top-left of the chip.
    var c = size() * (k || 1), m = c * 0.7, o = (c - m) / 2;
    ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = 'rgba(12,12,14,.6)'; ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = k || 1;
    ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c / 2 - (k || 1) / 2, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.drawImage(im, x + o, y + o, m, m); ctx.restore();
  }
  // Vela workspace: one mark per cell, inside the cell's plot, at the bottom-left of the price pane.
  function installVela(ws) {
    var sweep = function () {
      var cells = []; try { cells = ws.context().cells || []; } catch (e) { return; }
      cells.forEach(function (c) {
        var R = null; try { R = ws.cell(c.id).chart.renderer.renderer; } catch (e) {}
        if (!R || !R.plot || !R.scene || R.plot.__tzBrand) return;
        var bottom = function () {
          var p = R.scene.panes.get('price'), mx = R.maximizedPaneId;
          if (!p || p.collapsed || (mx && mx !== 'price') || !p.bounds || p.bounds.height < size() + 24) return null;
          return R.plot.clientHeight - (p.bounds.top + p.bounds.height);
        };
        var m = mount(R.plot, bottom, { shot: true });
        // Vela re-lays panes out through positionAttribution(); ride the same call.
        var pa = R.positionAttribution;
        if (m && typeof pa === 'function') R.positionAttribution = function () { var r = pa.apply(this, arguments); m.update(); return r; };
        m.update();
      });
    };
    sweep();
    try { ws.on('layout:changed', function () { setTimeout(sweep, 0); }); } catch (e) {}
    try { ws.on('state:changed', function () { setTimeout(sweep, 0); }); } catch (e) {}
    root.__tzBrandSweep = sweep;
  }
  image();
  root.TzBrand = { src: SRC, opacity: OPACITY, size: size, mount: mount, draw: draw, installVela: installVela };
})(typeof window !== 'undefined' ? window : this);
