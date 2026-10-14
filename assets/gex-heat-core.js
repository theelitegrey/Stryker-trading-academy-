// TradeZoro — GEX heat core (shared by the GEX page "Heatmap" tab and the Charts "GEX Heatmap"
// indicator). Owner-approved 2026-10-14.
//
// Depends on: nothing (plain browser JS). Exposes window.StrykerGexHeat.
// Data: the book-recorder Worker's GEX history (workers/book-recorder/src/gex-history.js):
//   GET <REC>/gex-history?u=SPX&dte=0&from=&to=  -> packed columns (unpack() below)
//   GET <REC>/gex-sessions?u=SPX&dte=0           -> [{ day, n, t0, t1 }] newest first
// One snapshot per 2-min feeder run: t (Cboe chain time, epoch s), s spot, cw/pw call/put wall,
// zg zero gamma, em [center, sigma], k strikes (+-5% of spot), g net GEX per strike ($M per 1%).
//
// Rendering: build() turns a day of snapshots into ONE small offscreen canvas, one pixel per
// 2-min slot x one price row (the finest strike step). Drawing is then a single drawImage (or one
// per column for a non-linear time axis) with smoothing off, so a redraw costs well under 1 ms.
// The base image is rebuilt only when new snapshots arrive.
//
// No lookahead: at(rows, ts) returns the latest snapshot with t <= ts, or null before the history
// begins. build(rows, { until }) leaves every slot after `until` empty.
(function () {
  'use strict';
  var REC = 'https://book-recorder.theelitegrey.workers.dev';
  var SLOT = 120;              // seconds per column (the feeder's cadence)
  var MAX_FILL = 3;            // a snapshot fills at most 3 slots (6 min) when the next one is missing
  var cache = new Map();       // url -> { at, p: Promise }
  var CACHE_MS = 60000;

  function getJson(url) {
    var hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
    var p = fetch(url, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('GEX history HTTP ' + r.status);
      return r.json();
    });
    p.catch(function () { cache.delete(url); });
    if (cache.size > 40) cache.clear();
    cache.set(url, { at: Date.now(), p: p });
    return p;
  }

  function unpack(p) {
    if (!p || !p.t) return [];
    return p.t.map(function (t, i) {
      var row = p.g[i] || [0], i0 = row[0], k = [], g = [];
      for (var j = 1; j < row.length; j++) if (row[j] !== null) { k.push(p.k[i0 + j - 1]); g.push(row[j]); }
      return { t: t, fa: p.fa ? p.fa[i] : null, day: p.day[i], x: p.x[i], s: p.s[i], cw: p.cw[i], pw: p.pw[i], zg: p.zg[i], n: p.n[i], em: p.em[i], k: k, g: g };
    });
  }

  // rows of one underlying + mode, oldest first
  function history(u, dte, from, to) {
    var q = 'u=' + encodeURIComponent(u) + '&dte=' + (dte ? 1 : 0) + '&from=' + Math.floor(from) + (to ? '&to=' + Math.ceil(to) : '');
    return getJson(REC + '/gex-history?' + q).then(unpack);
  }
  function sessions(u, dte) {
    return getJson(REC + '/gex-sessions?u=' + encodeURIComponent(u) + '&dte=' + (dte ? 1 : 0));
  }

  // latest snapshot with t <= ts (binary search); null before the first, or older than maxAge s
  function at(rows, ts, maxAge) {
    var lo = 0, hi = rows.length - 1, best = -1;
    while (lo <= hi) { var m = (lo + hi) >> 1; if (rows[m].t <= ts) { best = m; lo = m + 1; } else hi = m - 1; }
    if (best < 0) return null;
    if (maxAge != null && ts - rows[best].t > maxAge) return null;
    return rows[best];
  }

  // New York wall time on a YYYY-MM-DD day -> epoch seconds
  var nyParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  function nyWall(sec) {
    var o = {}; nyParts.formatToParts(new Date(sec * 1000)).forEach(function (p) { o[p.type] = p.value; });
    return Date.UTC(+o.year, +o.month - 1, +o.day, (+o.hour) % 24, +o.minute, +o.second) / 1000;
  }
  function etEpoch(day, hh, mm) {
    var d = String(day).split('-');
    var wall = Date.UTC(+d[0], +d[1] - 1, +d[2], hh, mm || 0) / 1000, ts = wall + 4 * 3600;
    for (var i = 0; i < 2; i++) ts += wall - nyWall(ts);
    return ts;
  }
  function etDay(sec) {
    var o = {}; nyParts.formatToParts(new Date(sec * 1000)).forEach(function (p) { o[p.type] = p.value; });
    return o.year + '-' + o.month + '-' + o.day;
  }
  function etClock(sec) {
    return new Date(sec * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  }
  // the cash session window used for a day's columns: 09:30 - 16:15 ET (Cboe prints until 16:15)
  function sessionWindow(day) { return { x0: etEpoch(day, 9, 30), x1: etEpoch(day, 16, 16) }; }

  // ---- colour ramps (own palette: mint/teal for positive, red/magenta for negative) ----
  var POS = [[0, 12, 15, 18], [0.3, 6, 74, 70], [0.62, 3, 175, 125], [0.85, 3, 214, 150], [1, 178, 255, 224]];
  var NEG = [[0, 12, 15, 18], [0.3, 92, 18, 44], [0.62, 206, 52, 74], [0.85, 238, 66, 118], [1, 255, 120, 205]];
  function ramp(stops, a) {
    for (var i = 1; i < stops.length; i++) {
      if (a <= stops[i][0]) {
        var s0 = stops[i - 1], s1 = stops[i], f = (a - s0[0]) / (s1[0] - s0[0]);
        return [s0[1] + (s1[1] - s0[1]) * f, s0[2] + (s1[2] - s0[2]) * f, s0[3] + (s1[3] - s0[3]) * f];
      }
    }
    var l = stops[stops.length - 1]; return [l[1], l[2], l[3]];
  }
  // value -> [r, g, b, alpha 0..255]; overlay=true makes near-zero transparent (for the chart)
  function color(v, vmax, overlay) {
    // a power of 0.75 keeps small values visible without washing the whole map into one colour
    var a = Math.min(1, Math.abs(v) / (vmax || 1)), s = Math.pow(a, 0.75);
    var c = ramp(v >= 0 ? POS : NEG, s);
    return [c[0] | 0, c[1] | 0, c[2] | 0, overlay ? Math.round(255 * Math.min(1, s * 1.5)) : 255];
  }

  function percentileAbs(rows, p) {
    var all = [];
    rows.forEach(function (r) { r.g.forEach(function (v) { if (v != null && isFinite(v)) all.push(Math.abs(v)); }); });
    if (!all.length) return 1;
    all.sort(function (a, b) { return a - b; });
    return all[Math.min(all.length - 1, Math.floor(all.length * p))] || all[all.length - 1] || 1;
  }

  // Build the base image for a set of snapshots (normally one session).
  // opts: { x0, x1 } column window (epoch s), until (no column after it), overlay (bool),
  //       vmax (colour scale; default the 99.5th percentile of |GEX| in these rows)
  function build(rows, opts) {
    opts = opts || {};
    rows = (rows || []).filter(function (r) { return r.k && r.k.length; });
    if (!rows.length) return null;
    var x0 = opts.x0 != null ? opts.x0 : Math.floor(rows[0].t / SLOT) * SLOT;
    var x1 = opts.x1 != null ? opts.x1 : rows[rows.length - 1].t + SLOT;
    var until = opts.until != null ? opts.until : Infinity;
    var cols = Math.max(1, Math.ceil((x1 - x0) / SLOT));
    var kMin = Infinity, kMax = -Infinity, step = Infinity;
    rows.forEach(function (r) {
      kMin = Math.min(kMin, r.k[0]); kMax = Math.max(kMax, r.k[r.k.length - 1]);
      for (var j = 1; j < r.k.length; j++) { var dk = r.k[j] - r.k[j - 1]; if (dk > 1e-9 && dk < step) step = dk; }
    });
    if (!isFinite(step)) step = Math.max(0.5, kMin * 0.001);
    var H = Math.min(2000, Math.round((kMax - kMin) / step) + 1);
    var vmax = opts.vmax || percentileAbs(rows, 0.995);
    var cv = document.createElement('canvas');
    cv.width = cols; cv.height = H;
    var cx = cv.getContext('2d');
    var img = cx.createImageData(cols, H), px = img.data;
    var kTop = kMin + (H - 1) * step;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.t > until) break;
      var c0 = Math.floor((r.t - x0) / SLOT);
      var next = i + 1 < rows.length ? rows[i + 1].t : r.t + SLOT;
      var c1 = Math.min(Math.floor((Math.min(next, until + SLOT) - x0) / SLOT), c0 + MAX_FILL, cols);
      if (c1 <= c0) c1 = c0 + 1;
      if (c0 >= cols || c1 <= 0) continue;
      c0 = Math.max(0, c0); c1 = Math.min(cols, c1);
      // each strike paints the price rows halfway to its neighbours
      for (var j = 0; j < r.k.length; j++) {
        var v = r.g[j]; if (v == null || !isFinite(v)) continue;
        var lo = j ? (r.k[j - 1] + r.k[j]) / 2 : r.k[j] - step / 2;
        var hi = j + 1 < r.k.length ? (r.k[j] + r.k[j + 1]) / 2 : r.k[j] + step / 2;
        var rowA = Math.max(0, Math.ceil((kTop - hi) / step - 1e-9)), rowB = Math.min(H - 1, Math.floor((kTop - lo) / step - 1e-9));
        if (rowB < rowA) rowA = rowB = Math.round((kTop - r.k[j]) / step);
        var col = color(v, vmax, !!opts.overlay);
        for (var y = rowA; y <= rowB; y++) {
          var base = (y * cols + c0) * 4;
          for (var c = c0; c < c1; c++, base += 4) { px[base] = col[0]; px[base + 1] = col[1]; px[base + 2] = col[2]; px[base + 3] = col[3]; }
        }
      }
    }
    cx.putImageData(img, 0, 0);
    return { canvas: cv, x0: x0, slot: SLOT, cols: cols, rowsN: H, kMin: kMin, kTop: kTop, step: step, vmax: vmax, rows: rows, until: until };
  }

  // Draw a built image. xOf(t) / yOf(price) map to canvas pixels. linearX=true: one drawImage;
  // otherwise one per column (for a chart whose time axis is not linear, e.g. bar-indexed).
  function draw(ctx, heat, xOf, yOf, opts) {
    if (!heat) return;
    opts = opts || {};
    var yTop = yOf(heat.kTop + heat.step / 2), yBot = yOf(heat.kMin - heat.step / 2);
    if (!isFinite(yTop) || !isFinite(yBot)) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    if (opts.linearX !== false) {
      var xa = xOf(heat.x0), xb = xOf(heat.x0 + heat.cols * heat.slot);
      if (isFinite(xa) && isFinite(xb)) ctx.drawImage(heat.canvas, 0, 0, heat.cols, heat.rowsN, xa, yTop, xb - xa, yBot - yTop);
    } else {
      for (var c = 0; c < heat.cols; c++) {
        var t = heat.x0 + c * heat.slot;
        var a = xOf(t), b = xOf(t + heat.slot);
        if (a == null || b == null || !isFinite(a) || !isFinite(b) || b <= a) continue;
        ctx.drawImage(heat.canvas, c, 0, 1, heat.rowsN, a, yTop, Math.max(1, b - a), yBot - yTop);
      }
    }
    ctx.restore();
  }

  // the cell under (t, price): { snap, strike, value } or null
  function cellAt(heat, t, price) {
    if (!heat) return null;
    var s = at(heat.rows, Math.min(t, heat.until));
    if (!s || t - s.t > MAX_FILL * SLOT || t < heat.x0) return null;
    var best = -1, bd = Infinity;
    for (var j = 0; j < s.k.length; j++) { var d = Math.abs(s.k[j] - price); if (d < bd) { bd = d; best = j; } }
    if (best < 0) return null;
    var half = Math.max(heat.step, (best + 1 < s.k.length ? s.k[best + 1] - s.k[best] : heat.step)) / 2 + 1e-9;
    if (bd > half) return null;
    return { snap: s, strike: s.k[best], value: s.g[best] };
  }

  // "$1.23B" / "-$450M" from $M
  function money(m) {
    if (m == null || !isFinite(m)) return '—';
    var a = Math.abs(m), sgn = m < 0 ? '-' : '+';
    return sgn + '$' + (a >= 1000 ? (a / 1000).toFixed(2) + 'B' : a.toFixed(a >= 100 ? 0 : 1) + 'M');
  }

  window.StrykerGexHeat = {
    REC: REC, SLOT: SLOT, history: history, sessions: sessions, unpack: unpack, at: at, build: build, draw: draw,
    cellAt: cellAt, color: color, money: money, etEpoch: etEpoch, etDay: etDay, etClock: etClock, sessionWindow: sessionWindow,
    _cache: cache
  };
})();
