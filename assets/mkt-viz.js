// TradeZoro — shared helpers for the market pages (market-brief, market-map, scanner).
// Pure functions + one bottom-sheet. No libraries. Colour comes from the --mm-* ramp in style.css,
// so both themes work through CSS and nothing here hardcodes a hex.
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var isNum = function (v) { return typeof v === 'number' && isFinite(v); };

  // -3..3 colour step for a % move. edges = [small, mid, big] in %, k scales them per asset class.
  function bucket(v, edges, k) {
    if (!isNum(v)) return null;
    edges = edges || [0.25, 0.75, 1.5]; k = k > 0 ? k : 1;
    var a = Math.abs(v), s = a >= edges[2] * k ? 3 : a >= edges[1] * k ? 2 : a >= edges[0] * k ? 1 : 0;
    return v < 0 ? -s : s;
  }
  function cls(b) { return b === null ? 'mm-na' : b === 0 ? 'mm-b0' : 'mm-b' + (b < 0 ? 'd' : 'u') + Math.abs(b); }

  // Squarified treemap. items: [{a: weight > 0, ...}] -> [{item, x, y, w, h}] inside W x H.
  function treemap(items, W, H) {
    var list = items.filter(function (i) { return i.a > 0; }).sort(function (p, q) { return q.a - p.a; });
    var total = list.reduce(function (s, i) { return s + i.a; }, 0), out = [];
    if (!list.length) return out;
    var k = (W * H) / total, x = 0, y = 0, w = W, h = H, row = [], rest = list.map(function (i) { return { i: i, a: i.a * k }; });
    function worst(r, side) {
      var sum = 0, mx = 0, mn = Infinity;
      r.forEach(function (n) { sum += n.a; mx = Math.max(mx, n.a); mn = Math.min(mn, n.a); });
      return Math.max(side * side * mx / (sum * sum), sum * sum / (side * side * mn));
    }
    function flush() {
      var sum = row.reduce(function (s, n) { return s + n.a; }, 0), off;
      if (w >= h) { var cw = sum / h; off = y; row.forEach(function (n) { var rh = n.a / cw; out.push({ item: n.i, x: x, y: off, w: cw, h: rh }); off += rh; }); x += cw; w -= cw; }
      else { var rh2 = sum / w; off = x; row.forEach(function (n) { var cw2 = n.a / rh2; out.push({ item: n.i, x: off, y: y, w: cw2, h: rh2 }); off += cw2; }); y += rh2; h -= rh2; }
      row = [];
    }
    while (rest.length) {
      var side = Math.min(w, h), nx = rest[0];
      if (!row.length || worst(row.concat(nx), side) <= worst(row, side)) { row.push(nx); rest.shift(); } else flush();
    }
    if (row.length) flush();
    return out;
  }

  // Tiles as absolutely-placed buttons in a fixed-ratio box, so the box never shifts layout.
  // opts: {ratio (w/h), label(item)->{t, v, sub}, cls(item), attr(item)->string}
  function treemapHtml(items, opts) {
    var ratio = opts.ratio || 1.6, W = 100 * ratio, H = 100;
    var px = opts.width || 360, tiles = treemap(items, W, H);
    return '<div class="mv-tm" style="aspect-ratio:' + ratio + '">' + tiles.map(function (t) {
      var pw = t.w / W * px, ph = t.h / H * (px / ratio), l = opts.label(t.item);
      var inner = '';
      if (pw >= 40 && ph >= 26) inner += '<b>' + esc(l.t) + '</b>';
      if (pw >= 52 && ph >= 40) inner += '<span>' + esc(l.v) + '</span>';
      return '<button type="button" class="mv-tile ' + opts.cls(t.item) + '" ' + (opts.attr ? opts.attr(t.item) : '') +
        ' style="left:' + (t.x / W * 100).toFixed(3) + '%;top:' + (t.y / H * 100).toFixed(3) + '%;width:' + (t.w / W * 100).toFixed(3) + '%;height:' + (t.h / H * 100).toFixed(3) + '%"' +
        ' aria-label="' + esc(l.t + ' ' + l.v + (l.sub ? ', ' + l.sub : '')) + '" title="' + esc(l.t + ' ' + l.v) + '">' + inner + '</button>';
    }).join('') + '</div>';
  }

  // One shared bottom sheet (phone) / dialog (desktop). Returns the body element.
  var sheetEl = null, lastFocus = null;
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {} } }
  function openSheet(title, sub, bodyHtml) {
    closeSheet(); lastFocus = document.activeElement;
    var d = document.createElement('div');
    d.className = 'mv-sheet-wrap';
    d.innerHTML = '<div class="mv-scrim" data-close></div><div class="mv-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<span class="mv-grab" aria-hidden="true"></span>' +
      '<div class="mv-sh-head"><div><b>' + esc(title) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div><button type="button" class="mv-x" data-close aria-label="Close">×</button></div>' +
      '<div class="mv-sh-body">' + bodyHtml + '</div></div>';
    document.body.appendChild(d); sheetEl = d;
    d.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeSheet(); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
    var b = d.querySelector('.mv-x'); if (b) b.focus();
    return d;
  }

  // Diverging bar rows: value -> bar from the centre line, width relative to max |v|.
  function divBars(rows, max, fmt, k, edges) {
    return '<ul class="mv-bars">' + rows.map(function (r) {
      var w = max > 0 ? Math.min(50, Math.abs(r.v) / max * 50) : 0, b = bucket(r.v, edges, k);
      return '<li><span class="mv-bl">' + esc(r.label) + '</span><span class="mv-bt"><i class="' + cls(b) + '" style="' + (r.v < 0 ? 'right:50%' : 'left:50%') + ';width:' + w.toFixed(1) + '%"></i></span><span class="mv-bv">' + esc(fmt(r.v)) + '</span></li>';
    }).join('') + '</ul>';
  }


  // Text colour per tile from the tile's own resolved fill: whichever of white / dark ink has the
  // higher contrast. Re-run on DOM or theme change.
  function lum(rgb) { var m = rgb.match(/[\d.]+/g).map(Number); var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); }
  function inkAll() {
    document.querySelectorAll('.mv-tile,.mv-pill,.scn-cardx .gp').forEach(function (t) {
      var bg = getComputedStyle(t).backgroundColor; if (!bg || /rgba\(.*, 0\)$/.test(bg)) return;
      var L = lum(bg), white = 1.05 / (L + 0.05), dark = (L + 0.05) / (0.0085 + 0.05);
      t.style.color = white >= dark ? '#ffffff' : '#0e1621';
    });
  }
  var raf = 0;
  function queueInk() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; inkAll(); }); }
  new MutationObserver(function (m) { for (var i = 0; i < m.length; i++) { if (m[i].type === 'childList' || m[i].attributeName === 'data-theme') { queueInk(); return; } } })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('stryker:theme', queueInk);
  document.addEventListener('DOMContentLoaded', queueInk);

  window.stkViz = { esc: esc, isNum: isNum, bucket: bucket, cls: cls, treemap: treemap, treemapHtml: treemapHtml, openSheet: openSheet, closeSheet: closeSheet, divBars: divBars };
})();
