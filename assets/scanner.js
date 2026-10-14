// TradeZoro — Market scanner page (scanner.html). Classic script, no dependencies.
// Owner-approved 2026-10-14 (InsightSentry market scanner; design approved by the CoS).
// Data: the book-recorder Worker GET /scan?part=presets|stock|etf|crypto, filled every 3 min by
// workers/book-recorder/scan-feeder/scan_feeder.py (4 InsightSentry screener calls per run, never one
// per visitor). Bodies are gzip JSON (x-scan-gzip: 1), un-gzipped here with DecompressionStream.
// Free: every preset. Pro: custom filters (field / operator / value) run in this page on the cached
// market table (assets/plan-lock.js card 'scanner' for Free). Sortable columns. A crypto row opens
// /charts?symbol=BINANCE:XXXUSDT; a stock / ETF row (our charts have no stock feed) opens an info
// sheet with the row's numbers. Status wording: "updated X min ago" only.
// Depends on: assets/plan-limits.js (window.strykerPlanTier, optional), assets/plan-lock.js (optional).
(function () {
  'use strict';
  var API = 'https://book-recorder.theelitegrey.workers.dev/scan?part=';
  var REFRESH_MS = 3 * 60 * 1000;
  var root = document.getElementById('scn-root');
  if (!root) return;

  // Column definitions: key, label, kind of number, which markets show it.
  var COLS = [
    { k: 'c', l: 'Price', f: 'px' },
    { k: 'chg', l: 'Chg %', f: 'pct' },
    { k: 'vol', l: 'Volume', f: 'big' },
    { k: 'rvol', l: 'Rel vol', f: 'x', m: ['stock', 'etf'] },
    { k: 'gap', l: 'Gap %', f: 'pct' },
    { k: 'rsi', l: 'RSI 14', f: 'n1' },
    { k: 'cap', l: 'Mkt cap', f: 'big', m: ['stock', 'crypto'] },
    { k: 'pe', l: 'P/E', f: 'n1', m: ['stock'] },
    { k: 'perfYtd', l: 'YTD %', f: 'pct' }
  ];
  var FILTER_FIELDS = [
    ['chg', 'Change %'], ['gap', 'Gap %'], ['c', 'Price'], ['vol', 'Volume'], ['rvol', 'Relative volume'],
    ['rsi', 'RSI 14'], ['cap', 'Market cap'], ['pe', 'P/E'], ['perfW', 'Week %'], ['perfYtd', 'YTD %'], ['off52h', '% below 52-week high'],
    ['off52l', '% above 52-week low']
  ];
  var OPS = [['gt', '>'], ['lt', '<'], ['ge', '≥'], ['le', '≤']];
  var GROUPS = [
    ['Stocks', ['gainers', 'losers', 'unusual', 'high52', 'low52', 'gapup', 'gapdown', 'rsihigh', 'rsilow']],
    ['ETFs', ['etfup', 'etfdown']],
    ['Crypto', ['cryptoup', 'cryptodown']]
  ];

  var st = { presets: null, cols: null, t: 0, tab: 'gainers', sortK: null, sortD: 1, tier: null, custom: false,
    cmarket: 'stock', filters: [{ f: 'chg', op: 'gt', v: '3' }], tables: {}, err: '' };
  try { var saved = JSON.parse(localStorage.getItem('stryker_scanner') || 'null'); if (saved) { if (saved.tab) st.tab = saved.tab; if (Array.isArray(saved.filters)) st.filters = saved.filters.slice(0, 8); if (saved.cmarket) st.cmarket = saved.cmarket; } } catch (e) {}
  function persist() { try { localStorage.setItem('stryker_scanner', JSON.stringify({ tab: st.tab, filters: st.filters, cmarket: st.cmarket })); } catch (e) {} }

  // ---- pure helpers (exported for tests on window.__stkScan) --------------------------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, f) {
    if (!isNum(v)) return '—';
    if (f === 'pct') return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
    if (f === 'x') return v.toFixed(2) + '×';
    if (f === 'n1') return v.toFixed(1);
    if (f === 'big') {
      var a = Math.abs(v);
      if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
      if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
      if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
      return String(Math.round(v));
    }
    if (f === 'px') return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v >= 1 ? v.toFixed(2) : v.toPrecision(4);
    return String(v);
  }
  function agoText(t, now) {
    if (!isNum(t) || !t) return '';
    var m = Math.max(0, Math.floor(((now || Date.now()) / 1000 - t) / 60));
    if (m < 1) return 'Updated just now';
    if (m < 60) return 'Updated ' + m + ' min ago';
    var h = Math.floor(m / 60);
    return h < 24 ? 'Updated ' + h + ' h ago' : 'Updated ' + Math.floor(h / 24) + ' days ago';
  }
  // derived fields for filters
  function val(r, k) {
    if (k === 'off52h') return isNum(r.c) && isNum(r.hi52) && r.hi52 > 0 ? (1 - r.c / r.hi52) * 100 : null;
    if (k === 'off52l') return isNum(r.c) && isNum(r.lo52) && r.lo52 > 0 ? (r.c / r.lo52 - 1) * 100 : null;
    return r[k];
  }
  // Custom filter list -> a predicate (rows with a missing value never match). Pure.
  function buildFilter(filters) {
    var fs = (filters || []).filter(function (x) { return x && FILTER_FIELDS.some(function (f) { return f[0] === x.f; }) && OPS.some(function (o) { return o[0] === x.op; }) && x.v !== '' && isFinite(Number(x.v)); })
      .map(function (x) { return { f: x.f, op: x.op, v: Number(x.v) }; });
    return {
      n: fs.length,
      test: function (r) {
        for (var i = 0; i < fs.length; i++) {
          var a = val(r, fs[i].f), b = fs[i].v;
          if (!isNum(a)) return false;
          if (fs[i].op === 'gt' && !(a > b)) return false;
          if (fs[i].op === 'lt' && !(a < b)) return false;
          if (fs[i].op === 'ge' && !(a >= b)) return false;
          if (fs[i].op === 'le' && !(a <= b)) return false;
        }
        return true;
      }
    };
  }
  function sortRows(rows, k, d) {
    if (!k) return rows;
    return rows.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (!isNum(x) && !isNum(y)) return 0;
      if (!isNum(x)) return 1;
      if (!isNum(y)) return -1;
      return (x - y) * d;
    });
  }
  function rowsOfPreset(p, cols) {
    return p.rows.map(function (a) { var o = {}; cols.forEach(function (c, i) { o[c] = a[i]; }); return o; });
  }
  function rowsOfTable(t) {
    var out = [], n = t.n, d = t.d;
    for (var i = 0; i < n; i++) { var o = {}; t.cols.forEach(function (c) { o[c] = d[c][i]; }); out.push(o); }
    return out;
  }
  window.__stkScan = { fmt: fmt, agoText: agoText, buildFilter: buildFilter, sortRows: sortRows, val: val };

  // ---- data -----------------------------------------------------------------------------------
  function load(part) {
    return fetch(API + part, { headers: { accept: 'application/octet-stream' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (r.headers.get('x-scan-gzip') === '1' && typeof DecompressionStream === 'function') {
        return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();
      }
      return r.json();
    });
  }
  function loadPresets() {
    return load('presets').then(function (d) {
      st.presets = d.presets; st.cols = d.cols; st.t = d.t; st.err = '';
    }, function () { if (!st.presets) st.err = 'The scanner could not load. Try again in a minute.'; });
  }
  function loadTable(m) {
    var e = st.tables[m];
    if (e && (e.p || Date.now() - e.at < REFRESH_MS)) return e.p || Promise.resolve(e);
    var p = load(m).then(function (d) { st.tables[m] = { rows: rowsOfTable(d), t: d.t, at: Date.now() }; return st.tables[m]; },
      function () { st.tables[m] = { rows: [], t: 0, at: 0, err: true }; return st.tables[m]; });
    st.tables[m] = { p: p, rows: (e && e.rows) || [], at: 0 };
    return p;
  }

  // ---- render -----------------------------------------------------------------------------------
  function marketOf() { return st.custom ? st.cmarket : (st.presets && st.presets[st.tab] ? st.presets[st.tab].kind : 'stock'); }
  function colsFor(m) { return COLS.filter(function (c) { return !c.m || c.m.indexOf(m) !== -1; }); }
  function tabsHtml() {
    var h = '<div class="scn-tabs" role="tablist" aria-label="Scans">';
    GROUPS.forEach(function (g) {
      h += '<span class="scn-tgrp">' + g[0] + '</span>';
      g[1].forEach(function (k) {
        var p = st.presets && st.presets[k];
        if (!p) return;
        var on = !st.custom && st.tab === k;
        h += '<button type="button" role="tab" class="scn-tab' + (on ? ' on' : '') + '" aria-selected="' + on + '" data-tab="' + k + '">' + esc(p.title) + '</button>';
      });
    });
    var pro = st.tier && !st.tier.free;
    h += '<span class="scn-tgrp">Custom</span><button type="button" role="tab" class="scn-tab scn-tab-custom' + (st.custom ? ' on' : '') + '" aria-selected="' + st.custom + '" data-tab="__custom">Custom filters' + (pro ? '' : ' <span class="scn-pro">PRO</span>') + '</button>';
    return h + '</div>';
  }
  function filtersHtml() {
    var h = '<div class="scn-filters"><div class="scn-frow scn-fmarket"><label>Market <select data-cm>';
    [['stock', 'US stocks'], ['etf', 'US ETFs'], ['crypto', 'Crypto']].forEach(function (m) { h += '<option value="' + m[0] + '"' + (st.cmarket === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; });
    h += '</select></label></div>';
    st.filters.forEach(function (x, i) {
      h += '<div class="scn-frow" data-i="' + i + '"><select data-ff aria-label="Field">';
      FILTER_FIELDS.forEach(function (f) { h += '<option value="' + f[0] + '"' + (x.f === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; });
      h += '</select><select data-fo aria-label="Operator">';
      OPS.forEach(function (o) { h += '<option value="' + o[0] + '"' + (x.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
      h += '</select><input data-fv type="text" inputmode="decimal" aria-label="Value" value="' + esc(x.v) + '"><button type="button" class="scn-x" data-fx aria-label="Remove filter">×</button></div>';
    });
    h += '<div class="scn-frow"><button type="button" class="scn-add" data-fadd' + (st.filters.length >= 8 ? ' disabled' : '') + '>+ Add filter</button></div></div>';
    return h;
  }
  function tableHtml(rows, m, total) {
    var cols = colsFor(m);
    var h = '<div class="scn-count">' + (total != null ? total + ' match' + (total === 1 ? '' : 'es') + (total > rows.length ? ', first ' + rows.length + ' shown' : '') : rows.length + ' symbols') + '</div>';
    if (!rows.length) return h + '<p class="scn-empty">Nothing matches right now.</p>';
    h += '<div class="scn-tw"><table class="scn-table"><thead><tr><th scope="col" class="scn-sym">Symbol</th>';
    cols.forEach(function (c) {
      var on = st.sortK === c.k;
      h += '<th scope="col" aria-sort="' + (on ? (st.sortD > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-sort="' + c.k + '">' + c.l + (on ? (st.sortD > 0 ? ' ▲' : ' ▼') : '') + '</button></th>';
    });
    h += '</tr></thead><tbody>';
    rows.forEach(function (r, i) {
      var t = String(r.s || '').split(':');
      h += '<tr tabindex="0" data-row="' + i + '"><th scope="row" class="scn-sym"><b>' + esc(t[1] || t[0]) + '</b><small>' + esc(r.n || '') + '</small></th>';
      cols.forEach(function (c) {
        var v = r[c.k], cls = c.f === 'pct' && isNum(v) ? (v > 0 ? ' class="up"' : v < 0 ? ' class="dn"' : '') : '';
        h += '<td' + cls + '>' + fmt(v, c.f) + '</td>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  var shown = [];
  function render() {
    var ago = document.getElementById('scn-ago');
    if (ago) ago.textContent = agoText(st.custom && st.tables[st.cmarket] && st.tables[st.cmarket].t ? st.tables[st.cmarket].t : st.t);
    if (!st.presets) { root.innerHTML = '<p class="scn-empty">' + esc(st.err || 'Loading scans…') + '</p>'; return; }
    var h = tabsHtml(), m = marketOf();
    if (st.custom) {
      if (!st.tier) { root.innerHTML = h + '<p class="scn-empty">Loading…</p>'; return; }
      if (st.tier.free) {
        root.innerHTML = h + '<div class="scn-lock"></div>';
        var slot = root.querySelector('.scn-lock');
        if (window.strykerPlanLock) slot.appendChild(window.strykerPlanLock.card('scanner', 'scanner-custom'));
        else slot.innerHTML = '<p class="scn-empty">Custom filters are part of Pro. <a href="/#pricing">See plans</a></p>';
        wire(); return;
      }
      h += filtersHtml();
      var tb = st.tables[st.cmarket];
      if (!tb || (!tb.rows.length && !tb.err && tb.p)) { root.innerHTML = h + '<p class="scn-empty">Loading the ' + st.cmarket + ' table…</p>'; wire(); loadTable(st.cmarket).then(render); return; }
      if (tb.err) { root.innerHTML = h + '<p class="scn-empty">This table could not load. Try again in a minute.</p>'; wire(); return; }
      var flt = buildFilter(st.filters);
      var all = tb.rows.filter(flt.test);
      shown = sortRows(all, st.sortK || 'chg', st.sortK ? st.sortD : -1).slice(0, 200);
      root.innerHTML = h + tableHtml(shown, m, all.length);
    } else {
      var p = st.presets[st.tab] || st.presets[Object.keys(st.presets)[0]];
      shown = sortRows(rowsOfPreset(p, st.cols), st.sortK, st.sortD);
      root.innerHTML = h + tableHtml(shown, p.kind);
    }
    wire();
  }

  // ---- symbol info sheet (stocks / ETFs: our charts have no stock feed) ---------------------------
  function openInfo(r) {
    var m = marketOf();
    if (m === 'crypto') {
      var t = String(r.s || '').split(':').pop();
      location.href = 'charts?symbol=' + encodeURIComponent('binance:' + t);
      return;
    }
    closeInfo();
    var t2 = String(r.s || '').split(':');
    var rows = [['Price', fmt(r.c, 'px')], ['Change today', fmt(r.chg, 'pct')], ['Gap at the open', fmt(r.gap, 'pct')], ['Volume', fmt(r.vol, 'big')],
      ['Relative volume', fmt(r.rvol, 'x')], ['RSI 14 (daily)', fmt(r.rsi, 'n1')], ['52-week high', fmt(r.hi52, 'px')], ['52-week low', fmt(r.lo52, 'px')],
      ['Market cap', fmt(r.cap, 'big')], ['P/E (TTM)', fmt(r.pe, 'n1')], ['Week', fmt(r.perfW, 'pct')], ['Year to date', fmt(r.perfYtd, 'pct')]];
    if (r.sec) rows.push(['Sector', esc(r.sec)]);
    var d = document.createElement('div');
    d.className = 'scn-sheet-wrap';
    d.innerHTML = '<div class="scn-scrim" data-close></div><div class="scn-sheet" role="dialog" aria-modal="true" aria-label="' + esc(t2[1] || r.s) + '">' +
      '<div class="scn-sh-head"><div><b>' + esc(t2[1] || t2[0]) + '</b><small>' + esc(r.n || '') + ' · ' + esc(t2[0]) + '</small></div><button type="button" class="scn-x" data-close aria-label="Close">×</button></div>' +
      '<dl class="scn-dl">' + rows.map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; }).join('') + '</dl>' +
      '<p class="scn-note">Our charts cover futures, forex and crypto, not single stocks, so this symbol opens here. Education only. Not financial advice.</p></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeInfo(); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeInfo(); });
    var b = d.querySelector('.scn-sh-head .scn-x'); if (b) b.focus();
  }
  function closeInfo() { var w = document.querySelector('.scn-sheet-wrap'); if (w) w.remove(); }

  function wire() {
    root.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-tab');
        st.sortK = null; st.sortD = 1;
        if (k === '__custom') st.custom = true; else { st.custom = false; st.tab = k; }
        persist(); render();
      });
    });
    root.querySelectorAll('[data-sort]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-sort');
        if (st.sortK === k) st.sortD = -st.sortD; else { st.sortK = k; st.sortD = -1; }
        render();
      });
    });
    root.querySelectorAll('tr[data-row]').forEach(function (tr) {
      var go = function () { var r = shown[Number(tr.getAttribute('data-row'))]; if (r) openInfo(r); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    });
    var cm = root.querySelector('[data-cm]');
    if (cm) cm.addEventListener('change', function () { st.cmarket = cm.value; st.sortK = null; persist(); render(); });
    var timer = 0;
    var upd = function () { clearTimeout(timer); timer = setTimeout(function () { persist(); renderKeepFocus(); }, 350); };
    root.querySelectorAll('.scn-frow[data-i]').forEach(function (row) {
      var i = Number(row.getAttribute('data-i'));
      row.querySelector('[data-ff]').addEventListener('change', function (e) { st.filters[i].f = e.target.value; persist(); render(); });
      row.querySelector('[data-fo]').addEventListener('change', function (e) { st.filters[i].op = e.target.value; persist(); render(); });
      row.querySelector('[data-fv]').addEventListener('input', function (e) { st.filters[i].v = e.target.value.trim(); upd(); });
      row.querySelector('[data-fx]').addEventListener('click', function () { st.filters.splice(i, 1); persist(); render(); });
    });
    var add = root.querySelector('[data-fadd]');
    if (add) add.addEventListener('click', function () { if (st.filters.length < 8) st.filters.push({ f: 'rvol', op: 'gt', v: '2' }); persist(); render(); });
  }
  function renderKeepFocus() {
    var a = document.activeElement, row = a && a.closest && a.closest('.scn-frow[data-i]');
    var i = row ? row.getAttribute('data-i') : null, pos = a && a.selectionStart;
    render();
    if (i != null) { var inp = root.querySelector('.scn-frow[data-i="' + i + '"] [data-fv]'); if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (e) {} } }
  }

  // ---- start ---------------------------------------------------------------------------------------
  var t0 = setTimeout(function () { if (!st.tier) { st.tier = { free: true, unknown: true }; render(); } }, 8000);
  if (typeof window.strykerPlanTier === 'function') {
    window.strykerPlanTier().then(function (t) { clearTimeout(t0); st.tier = t || { free: true }; render(); }, function () { clearTimeout(t0); st.tier = { free: true }; render(); });
  } else { clearTimeout(t0); st.tier = { free: true, unknown: true }; }
  loadPresets().then(render);
  setInterval(function () {
    if (document.visibilityState === 'hidden') return;
    loadPresets().then(function () {
      if (st.custom && st.tables[st.cmarket]) st.tables[st.cmarket].at = 0;
      if (!document.querySelector('.scn-filters :focus')) render(); else { var a = document.getElementById('scn-ago'); if (a) a.textContent = agoText(st.t); }
    });
  }, REFRESH_MS);
  setInterval(function () { var a = document.getElementById('scn-ago'); if (a) a.textContent = agoText(st.t); }, 60000);
})();
