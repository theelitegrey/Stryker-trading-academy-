// TradeZoro — tiny SVG chart kit for the admin analytics charts (no library)
// Used by assets/admin-analytics.js. Pure series builders at the top are
// unit-tested in node (tools/tests/admin-analytics/charts-unit.js); the DOM
// part below only runs in the browser.
//
// Rules carried from the analytics section: a chart never invents a point.
// A missing day is null (a gap in the line, no bar), and a trend line needs
// at least 2 real points, otherwise the card shows its empty state.
(function (root) {
  var IST_MS = 330 * 60000;
  var DAY = 86400000;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---- pure helpers ---------------------------------------------------------
  function istDayKey(ms) { return new Date(ms + IST_MS).toISOString().slice(0, 10); }
  function istMidnightMs(ms) { return Date.parse(istDayKey(ms) + 'T00:00:00+05:30'); }
  function utcDayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function shortDay(key) { var p = key.split('-'); return Number(p[2]) + ' ' + MON[Number(p[1]) - 1]; }
  function fmtIST(ms) {
    var d = new Date(ms + IST_MS);
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' +
      String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' IST';
  }
  function fmtTimeIST(ms) {
    var d = new Date(ms + IST_MS);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }

  // Consecutive day keys ending at endKey (inclusive), oldest first.
  function dayKeys(endKey, n) {
    var end = Date.parse(endKey + 'T00:00:00Z'), out = [];
    for (var i = n - 1; i >= 0; i--) out.push(utcDayKey(end - i * DAY));
    return out;
  }

  // Day keys for a chart range. 'all' starts at seriesStart (capped at 400 days).
  function rangeKeys(range, todayKey, seriesStart) {
    var n = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 400;
    var keys = dayKeys(todayKey, n);
    if (seriesStart) keys = keys.filter(function (k) { return k >= seriesStart; });
    return keys;
  }

  // One value per key from the daily snapshot docs; null where the doc or field is missing.
  function dailySeries(docs, keys, pick) {
    return keys.map(function (k) {
      var d = docs[k];
      if (!d) return null;
      var v = pick(d);
      return (typeof v === 'number' && isFinite(v)) ? v : null;
    });
  }

  function realCount(values) { return values.filter(function (v) { return v !== null && v !== undefined; }).length; }

  // Orders (already fetched, last N IST days) bucketed per IST day.
  // payment: a non-trial order with money collected and a good status.
  // converted: a trial whose member has a later payment in the same window.
  var BAD_STATUS = ['failed', 'cancelled', 'canceled', 'refunded', 'created'];
  var FREE_GW = ['coupon', 'free', 'manual', 'admin'];
  function isPayment(o) {
    if (String(o.kind || '') === 'trial') return false;
    if (BAD_STATUS.indexOf(String(o.status || '').toLowerCase()) !== -1) return false;
    if (FREE_GW.indexOf(String(o.gateway || '').toLowerCase()) !== -1) return false;
    return Number(o.finalAmount) > 0;
  }
  function orderUsd(o) {
    if (Number(o.amountUsd) > 0) return Number(o.amountUsd);
    if (String(o.currency || '').toUpperCase() === 'USD') return Number(o.finalAmount) || 0;
    return null;   // foreign currency, no amountUsd: never guessed
  }
  function bucketOrders(orders, nowMs, days) {
    var keys = [];
    for (var i = days - 1; i >= 0; i--) keys.push(istDayKey(nowMs - i * DAY));
    var by = {};
    keys.forEach(function (k) { by[k] = { payments: 0, usd: 0, unconverted: 0, trials: 0, converted: 0 }; });
    var paidAt = {};
    orders.forEach(function (o) {
      if (o.uid && isPayment(o) && o.ms) (paidAt[o.uid] = paidAt[o.uid] || []).push(o.ms);
    });
    orders.forEach(function (o) {
      if (!o.ms) return;
      var b = by[istDayKey(o.ms)];
      if (!b) return;
      if (String(o.kind || '') === 'trial') {
        b.trials += 1;
        if ((paidAt[o.uid] || []).some(function (t) { return t > o.ms; })) b.converted += 1;
        return;
      }
      if (!isPayment(o)) return;
      b.payments += 1;
      var usd = orderUsd(o);
      if (usd === null) b.unconverted += 1; else b.usd = Math.round((b.usd + usd) * 100) / 100;
    });
    return { keys: keys, by: by };
  }

  function csv(header, rows) {
    var q = function (v) { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [header].concat(rows).map(function (r) { return r.map(q).join(','); }).join('\n') + '\n';
  }

  // Rounded axis maximum: 1, 2, 2.5, 5 x 10^n at or above v.
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    var n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return n * p;
  }

  var pure = { istDayKey: istDayKey, istMidnightMs: istMidnightMs, utcDayKey: utcDayKey, shortDay: shortDay, fmtIST: fmtIST,
    fmtTimeIST: fmtTimeIST, dayKeys: dayKeys, rangeKeys: rangeKeys, dailySeries: dailySeries, realCount: realCount,
    bucketOrders: bucketOrders, isPayment: isPayment, orderUsd: orderUsd, csv: csv, niceMax: niceMax };

  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }

  // ---- DOM ------------------------------------------------------------------
  var NS = 'http://www.w3.org/2000/svg';
  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(v) { return (typeof v === 'number') ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '\u2014'; }

  function downloadCsv(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = 'tradezoro-' + name + '-' + istDayKey(Date.now()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // Card shell: title, optional headline value, CSV button, body, a11y table.
  function shell(card, spec) {
    card.classList.add('aac-card');
    card.setAttribute('role', 'figure');
    card.setAttribute('aria-label', spec.title);
    card.innerHTML =
      '<div class="aac-head"><div><h3 class="aac-title">' + esc(spec.title) + '</h3>' +
      (spec.value !== undefined && spec.value !== null ? '<div class="aac-value">' + esc(spec.value) + '</div>' : '') +
      (spec.sub ? '<div class="aac-sub">' + esc(spec.sub) + '</div>' : '') + '</div>' +
      (spec.csv ? '<button type="button" class="aac-csv" aria-label="Download ' + esc(spec.title) + ' as CSV">CSV</button>' : '') +
      '</div><div class="aac-body"></div>';
    if (spec.csv) card.querySelector('.aac-csv').addEventListener('click', function () { downloadCsv(spec.csv.name, csv(spec.csv.header, spec.csv.rows)); });
    if (spec.csv && spec.csv.rows.length) {
      // The wrapper carries sr-only: a <table> ignores width:1px and widened the page.
      var t = '<div class="sr-only"><table class="aac-table"><caption>' + esc(spec.title) + '</caption><thead><tr>' +
        spec.csv.header.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        spec.csv.rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></div>';
      card.insertAdjacentHTML('beforeend', t);
    }
    return card.querySelector('.aac-body');
  }

  function state(card, title, text) {
    card.classList.add('aac-card');
    card.setAttribute('role', 'figure');
    card.setAttribute('aria-label', title + ': ' + text);
    card.innerHTML = '<div class="aac-head"><div><h3 class="aac-title">' + esc(title) + '</h3></div></div>' +
      '<div class="aac-body"><p class="aac-empty">' + esc(text) + '</p></div>';
  }

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  // XY chart: kind 'line' | 'area' (stacked) | 'bar' (grouped).
  // spec: { title, kind, labels:[key], tips:[full label], series:[{name, cls, values}], fmt, height }
  function xy(card, spec) {
    var body = shell(card, spec);
    var H = spec.height || 168, padL = 40, padR = 8, padT = 8, padB = 22;
    var wrap = document.createElement('div');
    wrap.className = 'aac-plot';
    wrap.tabIndex = 0;
    wrap.setAttribute('aria-label', spec.title + ' chart. Use left and right arrow keys to read values.');
    body.appendChild(wrap);
    var tip = document.createElement('div');
    tip.className = 'aac-tip'; tip.hidden = true; tip.setAttribute('aria-live', 'polite');
    body.appendChild(tip);
    if (spec.series.length > 1) {
      body.insertAdjacentHTML('beforeend', '<div class="aac-legend">' + spec.series.map(function (s) {
        return '<span><i class="aac-sw ' + s.cls + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>');
    }
    var fmt = spec.fmt || num;
    var n = spec.labels.length;
    var stacked = spec.kind === 'area';
    var tops = [];
    for (var i = 0; i < n; i++) {
      var t = 0, mx = 0;
      spec.series.forEach(function (s) { var v = s.values[i] || 0; t += v; mx = Math.max(mx, v); });
      tops.push(stacked ? t : mx);
    }
    var max = niceMax(Math.max.apply(null, tops.concat([0])));
    var idx = -1, geo = null;

    function draw() {
      var W = Math.max(240, wrap.clientWidth || 300);
      wrap.innerHTML = '';
      var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', focusable: 'false' }, wrap);
      var iw = W - padL - padR, ih = H - padT - padB;
      var step = spec.kind === 'bar' ? iw / Math.max(1, n) : iw / Math.max(1, n - 1);
      var X = function (j) { return padL + (spec.kind === 'bar' ? step * (j + 0.5) : (n === 1 ? iw / 2 : step * j)); };
      var Y = function (v) { return padT + ih - (v / max) * ih; };
      geo = { X: X, step: step, padL: padL, iw: iw };
      [0, 0.5, 1].forEach(function (f) {
        var y = Y(max * f);
        el('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'aac-gl' }, svg);
        var tx = el('text', { x: padL - 6, y: y + 4, class: 'aac-axis', 'text-anchor': 'end' }, svg);
        tx.textContent = (spec.axisFmt || fmt)(max * f);
      });
      var lab = n <= 1 ? [0] : n <= 8 ? spec.labels.map(function (_, j) { return j; }) : [0, Math.floor((n - 1) / 2), n - 1];
      lab.forEach(function (j) {
        var tx = el('text', { x: X(j), y: H - 6, class: 'aac-axis', 'text-anchor': j === 0 && n > 1 ? 'start' : j === n - 1 && n > 1 ? 'end' : 'middle' }, svg);
        tx.textContent = spec.short ? spec.short(spec.labels[j]) : spec.labels[j];
      });
      if (spec.kind === 'bar') {
        var k = spec.series.length, bw = Math.max(2, Math.min(28, step * 0.72 / k));
        spec.series.forEach(function (s, si) {
          s.values.forEach(function (v, j) {
            if (v === null || v === undefined) return;
            var x = X(j) - (bw * k) / 2 + si * bw, y = Y(v);
            el('rect', { x: x, y: y, width: Math.max(1, bw - (k > 1 ? 1 : 0)), height: Math.max(v > 0 ? 1 : 0, padT + ih - y), rx: Math.min(3, bw / 3), class: 'aac-bar ' + s.cls }, svg);
          });
        });
      } else {
        var base = new Array(n).fill(0);
        spec.series.forEach(function (s) {
          var segs = [], cur = [];
          s.values.forEach(function (v, j) {
            if (v === null || v === undefined) { if (cur.length) segs.push(cur); cur = []; return; }
            var lo = stacked ? base[j] : 0, hi = lo + v;
            cur.push([X(j), Y(hi), Y(lo)]);
            if (stacked) base[j] = hi;
          });
          if (cur.length) segs.push(cur);
          segs.forEach(function (sg) {
            var top = sg.map(function (p, q) { return (q ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
            if (stacked && sg.length > 1) {
              var bot = sg.slice().reverse().map(function (p) { return 'L' + p[0].toFixed(1) + ' ' + p[2].toFixed(1); }).join('');
              el('path', { d: top + bot + 'Z', class: 'aac-fill ' + s.cls }, svg);
            }
            if (sg.length > 1) el('path', { d: top, class: 'aac-line ' + s.cls }, svg);
            else el('circle', { cx: sg[0][0], cy: sg[0][1], r: 2.5, class: 'aac-dot ' + s.cls }, svg);
          });
        });
      }
      geo.cursor = el('line', { x1: 0, x2: 0, y1: padT, y2: padT + ih, class: 'aac-cursor', visibility: 'hidden' }, svg);
      if (idx >= 0) show(idx);
    }

    function show(j) {
      if (!geo || j < 0 || j >= n) return;
      idx = j;
      var x = geo.X(j);
      geo.cursor.setAttribute('x1', x); geo.cursor.setAttribute('x2', x); geo.cursor.setAttribute('visibility', 'visible');
      var rows = spec.series.map(function (s) {
        var v = s.values[j];
        return '<div><i class="aac-sw ' + s.cls + '"></i>' + esc(s.name) + ' <b>' + (v === null || v === undefined ? 'No snapshot' : esc(fmt(v))) + '</b></div>';
      }).join('');
      tip.innerHTML = '<div class="aac-tip-d">' + esc(spec.tips[j]) + '</div>' + rows;
      tip.hidden = false;
      var w = tip.offsetWidth, cw = wrap.clientWidth;
      tip.style.left = Math.max(0, Math.min(cw - w, x - w / 2)) + 'px';
    }
    function hide() { idx = -1; tip.hidden = true; if (geo) geo.cursor.setAttribute('visibility', 'hidden'); }
    function at(evt) {
      var r = wrap.getBoundingClientRect(), x = evt.clientX - r.left - geo.padL;
      var j = spec.kind === 'bar' ? Math.floor(x / geo.step) : Math.round(x / geo.step);
      show(Math.max(0, Math.min(n - 1, j)));
    }
    wrap.addEventListener('pointermove', at);
    wrap.addEventListener('pointerdown', at);
    wrap.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    wrap.addEventListener('blur', hide);
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        show(idx < 0 ? n - 1 : Math.max(0, Math.min(n - 1, idx + (e.key === 'ArrowRight' ? 1 : -1))));
      } else if (e.key === 'Escape') hide();
    });
    draw();
    if (typeof ResizeObserver === 'function') {
      var lastW = wrap.clientWidth, t = null;
      new ResizeObserver(function () {
        if (Math.abs(wrap.clientWidth - lastW) < 2) return;
        lastW = wrap.clientWidth; clearTimeout(t); t = setTimeout(draw, 80);
      }).observe(wrap);
    }
  }

  // Donut with a legend. items: [{ name, value }]
  function donut(card, spec) {
    var body = shell(card, spec);
    var total = spec.items.reduce(function (a, it) { return a + it.value; }, 0);
    var R = 46, C = 2 * Math.PI * R, off = 0;
    var svg = '<svg class="aac-donut" width="120" height="120" viewBox="0 0 120 120" aria-hidden="true" focusable="false">' +
      '<circle cx="60" cy="60" r="' + R + '" class="aac-ring"/>';
    spec.items.forEach(function (it, i) {
      var len = total ? (it.value / total) * C : 0;
      svg += '<circle cx="60" cy="60" r="' + R + '" class="aac-seg aac-s' + (i % 6 + 1) + '" stroke-dasharray="' +
        len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 60 60)"/>';
      off += len;
    });
    svg += '<text x="60" y="58" text-anchor="middle" class="aac-donut-n">' + esc(total.toLocaleString()) + '</text>' +
      '<text x="60" y="74" text-anchor="middle" class="aac-axis">' + esc(spec.centerLabel || 'total') + '</text></svg>';
    var leg = '<ul class="aac-dlegend">' + spec.items.map(function (it, i) {
      return '<li><i class="aac-sw aac-s' + (i % 6 + 1) + '"></i><span>' + esc(it.name) + '</span><b>' + esc(it.value.toLocaleString()) +
        '</b><em>' + (total ? Math.round((it.value / total) * 100) : 0) + '%</em></li>';
    }).join('') + '</ul>';
    body.innerHTML = '<div class="aac-donut-wrap">' + svg + leg + '</div>';
  }

  // Horizontal bars (HTML, no SVG). items: [{ name, value, tip }]
  function hbars(card, spec) {
    var body = shell(card, spec);
    var max = Math.max.apply(null, spec.items.map(function (it) { return it.value; }).concat([1]));
    body.innerHTML = '<div class="aac-hbars' + (spec.scroll ? ' aac-hbars-scroll' : '') + '">' + spec.items.map(function (it) {
      return '<div class="aac-hrow" title="' + esc(it.tip || it.name) + '"><span class="aac-hl">' + esc(it.name) + '</span>' +
        '<span class="aac-htrack"><span class="aac-hfill ' + (spec.cls || 'aac-c1') + '" style="width:' + ((it.value / max) * 100).toFixed(1) + '%"></span></span>' +
        '<b class="aac-hv">' + esc(it.value.toLocaleString()) + '</b></div>';
    }).join('') + '</div>';
  }

  // Inline sparkline (no axes) for the live panel. values: numbers, oldest first.
  function sparkline(host, values, label) {
    host.innerHTML = '';
    var W = Math.max(120, host.clientWidth || 200), H = 40;
    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': label }, host);
    if (values.length < 2) return;
    var mx = Math.max.apply(null, values.concat([1]));
    var step = (W - 4) / (values.length - 1);
    var d = values.map(function (v, i) { return (i ? 'L' : 'M') + (2 + i * step).toFixed(1) + ' ' + (H - 3 - (v / mx) * (H - 8)).toFixed(1); }).join('');
    el('path', { d: d + 'L' + (W - 2) + ' ' + H + 'L2 ' + H + 'Z', class: 'aac-fill aac-c1' }, svg);
    el('path', { d: d, class: 'aac-line aac-c1' }, svg);
  }

  root.AAC = Object.assign({ xy: xy, donut: donut, hbars: hbars, sparkline: sparkline, state: state, num: num }, pure);
})(typeof window !== 'undefined' ? window : this);
