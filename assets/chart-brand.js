// TradeZoro chart corner mark (Owner order 2026-11-09): the square TZ mark, bottom-left of the MAIN price pane
// of every chart (Charts page cells, backtest chart, Replay, GEX price chart, GEX heatmap). Always on: no
// setting, no menu, no key. pointer-events:none, never a link. Plain script (also import()ed by vela-chart.js);
// exposes window.TzBrand. One small cached image; DOM overlay (or one drawImage on canvas charts), no per-frame work.
// Chart screenshots: Vela's own export rasterises any [data-vela-screenshot] element in the plot, so the mark
// rides along in exports, layout shots and thumbnails. Art: tradezoro-tzmark-1014 (TZ mark only).
(function (root) {
  'use strict';
  if (root.TzBrand) return;
  var SRC = '/assets/images/tradezoro-tzmark-1014-144.webp';
  var OPACITY = 0.4;
  var phone = function () { return root.matchMedia && root.matchMedia('(max-width: 640px)').matches; };
  var size = function () { return phone() ? 19 : 24; };   // CSS px tall (the art is square)
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
    s.textContent = '.tz-brand{position:absolute;left:10px;z-index:5;pointer-events:none;user-select:none;-webkit-user-select:none;opacity:' + OPACITY + ';line-height:0}' +
      '.tz-brand img{display:block;height:24px;width:24px;pointer-events:none;-webkit-user-drag:none}' +
      '@media (max-width:640px){.tz-brand img{height:19px;width:19px}}';
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
    el.appendChild(im); host.appendChild(el);
    var last = null;
    var api = host.__tzBrand = { el: el, update: function () {
      var b = null; try { b = bottomPx(); } catch (e) {}
      if (b == null || !isFinite(b)) { if (last !== 'h') { el.style.display = 'none'; last = 'h'; } return; }
      var v = Math.round(b + 10) + 'px';
      if (last === v) return; last = v; el.style.display = ''; el.style.bottom = v;
    } };
    if (root.ResizeObserver) new ResizeObserver(function () { api.update(); }).observe(host);
    api.update();
    return api;
  }
  // Canvas charts: draw the mark at (x, y) top-left (device px when k scales), once per paint.
  function draw(ctx, x, y, repaint, k) {
    var im = image(repaint); if (!im.complete || !im.naturalWidth) return;
    var h = size() * (k || 1); ctx.save(); ctx.globalAlpha = OPACITY; ctx.drawImage(im, x, y, h, h); ctx.restore();
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
