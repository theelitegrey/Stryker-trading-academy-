// TradeZoro — Market Stats page (market-stats.html). Classic script.
// Data: the book-recorder Worker GET /scan?part=ms_nq|ms_es|ms_spx (gzip JSON, one row per RTH session, filled once a day by
// workers/book-recorder/ms-feeder/ms_feeder.py; InsightSentry is never called from here). The numbers are computed in the
// browser by assets/market-stats-core.js (Statistics engine based on LuxAlgo Edge Stats (MIT)).
// Free for every plan. Wording: "Historical frequencies with sample sizes. Not predictions."
// Depends on: assets/market-stats-core.js (window.StkMS).
(function () {
  'use strict';
  var S = window.StkMS, root = document.getElementById('ms-root');
  if (!S || !root) return;
  var API = 'https://book-recorder.theelitegrey.workers.dev/scan?part=';
  var SYMS = [['NQ', 'ms_nq', 'NQ', 'Nasdaq-100 E-mini'], ['ES', 'ms_es', 'ES', 'S&P 500 E-mini'], ['SPX', 'ms_spx', 'ES', 'S&P 500 index']];
  var RANGES = [['3m', 'Last 3 months', 92], ['6m', 'Last 6 months', 183], ['1y', 'Last year', 365], ['3y', 'All (3 years)', 0]];
  var st = { sym: 'NQ', rep: 'gap', range: '1y', dow: -1, bucket: 'any', data: {}, err: '', loading: false, sheet: null };
  try { var sv = JSON.parse(localStorage.getItem('stryker_ms') || 'null'); if (sv) { ['sym', 'rep', 'range'].forEach(function (k) { if (sv[k]) st[k] = sv[k]; }); } } catch (e) {}
  if (!S.REPORTS[st.rep]) st.rep = 'gap';
  if (!SYMS.some(function (s) { return s[0] === st.sym; })) st.sym = 'NQ';
  function persist() { try { localStorage.setItem('stryker_ms', JSON.stringify({ sym: st.sym, rep: st.rep, range: st.range })); } catch (e) {} }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function symInfo() { return SYMS.filter(function (s) { return s[0] === st.sym; })[0]; }

  // ---- data ----------------------------------------------------------------------------------------------------------
  function gunzipJson(buf) {
    var ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
    return ds.text().then(JSON.parse);
  }
  function load(sym) {
    if (st.data[sym]) return Promise.resolve();
    var info = SYMS.filter(function (s) { return s[0] === sym; })[0];
    st.loading = true; st.err = '';
    return fetch(API + info[1], { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? 'wait' : 'http');
      return r.arrayBuffer().then(function (b) { return r.headers.get('x-scan-gzip') === '1' ? gunzipJson(b) : JSON.parse(new TextDecoder().decode(b)); });
    }).then(function (part) {
      st.data[sym] = { rows: S.toRows(part), t: part.t };
    }).catch(function (e) {
      st.err = e && e.message === 'wait' ? 'The first nightly update has not arrived yet. Check back soon.' : 'Could not load the data. Try again in a minute.';
    }).then(function () { st.loading = false; });
  }

  // ---- filters -------------------------------------------------------------------------------------------------------
  function filters(rows) {
    var last = rows.length ? rows[rows.length - 1].date : '';
    var days = RANGES.filter(function (r) { return r[0] === st.range; })[0][2];
    var from = '';
    if (days && last) { var d = new Date(last + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - days); from = d.toISOString().slice(0, 10); }
    return { from: from, dow: st.dow, bucket: st.bucket };
  }

  // ---- render --------------------------------------------------------------------------------------------------------
  function chips(name, list, cur) {
    return '<div class="ms-chips" role="group" aria-label="' + name + '">' + list.map(function (x) {
      return '<button type="button" class="ms-chip' + (x[0] === cur ? ' on' : '') + '" data-' + name + '="' + esc(x[0]) + '" aria-pressed="' + (x[0] === cur) + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
  }
  function selectBox(id, label, opts, cur) {
    return '<label class="ms-sel"><span>' + label + '</span><select id="' + id + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select></label>';
  }
  function controls() {
    var reps = Object.keys(S.REPORTS).map(function (k) { return [k, S.REPORTS[k].title.replace(' (first hour)', '')]; });
    var dows = [[-1, 'Any day']].concat(S.DOW.map(function (d, i) { return [i, d]; }));
    var bks = [['any', 'Any gap size']].concat(S.BUCKETS.map(function (b) { return [b[0], b[1] + ': ' + S.BUCKET_TEXT[b[0]]]; }));
    return '<div class="ms-ctl">' +
      '<div class="ms-row">' + chips('sym', SYMS.map(function (s) { return [s[0], s[0]]; }), st.sym) + '</div>' +
      '<div class="ms-row ms-reps" role="tablist" aria-label="Report">' + reps.map(function (r) {
        return '<button type="button" role="tab" class="ms-tab' + (r[0] === st.rep ? ' on' : '') + '" data-rep="' + r[0] + '" aria-selected="' + (r[0] === st.rep) + '">' + esc(r[1]) + '</button>';
      }).join('') + '</div>' +
      '<div class="ms-row ms-sels">' + selectBox('ms-range', 'Dates', RANGES, st.range) + selectBox('ms-dow', 'Day', dows, st.dow) + selectBox('ms-bucket', 'Gap size', bks, st.bucket) + '</div>' +
      '</div>';
  }
  function yearsText(s) {
    return Object.keys(s.years).sort().map(function (y) { return '<span title="' + y + ': ' + s.years[y].k + ' of ' + s.years[y].n + '"><b>' + y + '</b> ' + s.years[y].n + '</span>'; }).join('');
  }
  function bar(s) {
    if (s.guard === 'withheld') return '<div class="ms-bar ms-bar-off"></div>';
    var lo = s.lo * 100, hi = s.hi * 100, p = s.p * 100;
    return '<div class="ms-bar" aria-hidden="true"><i class="ms-fill" style="width:' + p.toFixed(1) + '%"></i><i class="ms-ci" style="left:' + lo.toFixed(1) + '%;width:' + Math.max(0.8, hi - lo).toFixed(1) + '%"></i></div>';
  }
  function stabText(s) {
    if (!s.stability) return '<span class="ms-stab off">Stability: not enough sessions</span>';
    var a = s.stability.first, b = s.stability.second;
    return '<span class="ms-stab ' + (s.stability.agree ? 'ok' : 'warn') + '">' + (s.stability.agree ? 'Halves agree' : 'Halves differ') + ' · ' + S.pct(a.p) + ' then ' + S.pct(b.p) + '</span>';
  }
  function card(c, idx) {
    var s = c.s, off = s.guard === 'withheld';
    var h = '<button type="button" class="ms-card' + (c.main ? ' main' : '') + (off ? ' off' : '') + '" data-card="' + idx + '" aria-label="' + esc(c.title + ': ' + (off ? 'sample too small' : S.pct(s.p))) + ', ' + s.n + ' sessions. Open the sessions behind this number.">';
    h += '<span class="ms-ct">' + esc(c.title) + '</span><span class="ms-cs">' + esc(c.sub) + '</span>';
    if (off) h += '<span class="ms-big off">—</span><span class="ms-ci-t">Too few sessions to estimate (N = ' + s.n + ')</span>';
    else h += '<span class="ms-big">' + S.pct(s.p) + '</span><span class="ms-ci-t">95% interval ' + S.pct(s.lo) + ' to ' + S.pct(s.hi) + '</span>';
    h += bar(s);
    h += '<span class="ms-n"><b>N = ' + s.n + '</b> · ' + s.k + ' yes' + (s.guard === 'low' ? ' <em class="ms-low">Low sample</em>' : '') + '</span>';
    if (!off) {
      h += stabText(s);
      if (s.tmed && s.tn >= 5) h += '<span class="ms-time">Typical time: ' + S.fmtMin(s.tmed.med) + ' <small>(' + S.fmtMin(s.tmed.lo) + ' to ' + S.fmtMin(s.tmed.hi) + ')</small></span>';
    }
    h += '<span class="ms-years">' + yearsText(s) + '</span>';
    h += '<span class="ms-open">Sessions behind this number <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></span></button>';
    return h;
  }
  var cur = null;       // the report result on screen
  function results() {
    var d = st.data[st.sym];
    var rep = S.REPORTS[st.rep];
    cur = S.run(st.rep, d.rows, filters(d.rows));
    var h = '<div class="ms-sum"><b>' + cur.sessions + '</b> sessions' + (d.rows.length ? ' · ' + esc(d.rows[0].date) + ' to ' + esc(d.rows[d.rows.length - 1].date) + ' available' : '') + ' · <span id="ms-ago"></span></div>';
    h += '<p class="ms-blurb">' + esc(rep.blurb) + '</p>';
    if (st.sym === 'SPX') h += '<p class="ms-note">SPX is the cash index: sessions run 09:30 to 16:00 New York. On the chart its levels are drawn on ES.</p>';
    if (cur.sessions < S.WARN_N) h += '<p class="ms-warn">Only ' + cur.sessions + ' sessions match these filters. Treat every number below as a rough guide.</p>';
    var group = null;
    h += '<div class="ms-grid">';
    cur.cards.forEach(function (c, i) {
      if (c.group !== group) { group = c.group; if (group) h += '</div><h3 class="ms-grp">' + esc(group) + '</h3><div class="ms-grid">'; }
      h += card(c, i);
    });
    h += '</div>';
    if (cur.extra) {
      h += '<h3 class="ms-grp">Session range, % of the open</h3><div class="ms-tw"><table class="ms-table"><thead><tr><th>Day</th><th>N</th><th>Median</th><th>95% interval</th></tr></thead><tbody>';
      cur.extra.forEach(function (r) {
        h += '<tr><th>' + esc(r.label) + '</th><td>' + r.n + (r.guard === 'low' ? ' <em class="ms-low">Low</em>' : '') + '</td><td>' + (r.guard === 'withheld' ? '—' : r.med.toFixed(2) + '%') + '</td><td>' + (r.guard === 'withheld' ? '—' : r.lo.toFixed(2) + '% to ' + r.hi.toFixed(2) + '%') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    return h;
  }
  function ago(t) {
    if (!t) return '';
    var m = Math.max(0, Math.floor((Date.now() / 1000 - t) / 60));
    if (m < 60) return 'updated ' + (m < 1 ? 'just now' : m + ' min ago');
    var hh = Math.floor(m / 60);
    return 'updated ' + (hh < 48 ? hh + ' h ago' : Math.floor(hh / 24) + ' days ago');
  }
  function render() {
    var h = controls();
    if (st.loading && !st.data[st.sym]) h += '<p class="ms-empty">Loading…</p>';
    else if (st.err && !st.data[st.sym]) h += '<p class="ms-empty">' + esc(st.err) + ' <button type="button" class="ms-retry" id="ms-retry">Try again</button></p>';
    else if (st.data[st.sym]) h += results();
    var keep = window.scrollY;
    root.innerHTML = h;
    var a = document.getElementById('ms-ago');
    if (a && st.data[st.sym]) a.textContent = ago(st.data[st.sym].t);
    if (keep) window.scrollTo(0, keep);
  }

  // ---- sessions behind a number --------------------------------------------------------------------------------------
  function chartLink(c, it) {
    var r = it.r, info = symInfo(), q = [];
    q.push('symbol=' + info[2], 'date=' + r.date, 'tf=5', 'vela=0.9');
    q.push('o=' + r.o, 'pdh=' + r.pdh, 'pdl=' + r.pdl, 'pdc=' + r.pdc);
    if (st.rep === 'or15' || st.rep === 'or30') { var w = st.rep === 'or15' ? 15 : 30; q.push('orw=' + w, 'orh=' + r['o' + w + 'h'], 'orl=' + r['o' + w + 'l']); }
    if (st.rep === 'ib') q.push('ibh=' + r.ibh, 'ibl=' + r.ibl);
    if (it.hit && it.t != null && it.t >= 0 && c.timed) q.push('t=' + it.t, 'lbl=' + encodeURIComponent(c.title.slice(0, 28)));
    q.push('title=' + encodeURIComponent(c.title.slice(0, 50)));
    if (st.sym === 'SPX') q.push('sx=1');
    return 'charts?' + q.join('&');
  }
  var sheetState = { f: 'all', n: 60 };
  function openSheet(i) {
    st.sheet = i; sheetState = { f: 'all', n: 60 };
    drawSheet();
  }
  function closeSheet() {
    var w = document.getElementById('ms-sheet'); if (w) w.remove();
    st.sheet = null; document.documentElement.classList.remove('ms-noscroll');
    if (st.lastBtn) { try { st.lastBtn.focus(); } catch (e) {} }
  }
  function drawSheet() {
    var c = cur.cards[st.sheet], s = c.s;
    var list = c.items.slice().reverse().filter(function (it) { return sheetState.f === 'all' || (sheetState.f === 'yes') === it.hit; });
    var shown = list.slice(0, sheetState.n);
    var w = document.getElementById('ms-sheet');
    if (!w) { w = document.createElement('div'); w.id = 'ms-sheet'; w.className = 'ms-sheet-wrap'; document.body.appendChild(w); document.documentElement.classList.add('ms-noscroll'); }
    var h = '<div class="ms-scrim" data-close="1"></div><div class="ms-sheet" role="dialog" aria-modal="true" aria-label="Sessions behind ' + esc(c.title) + '">';
    h += '<div class="ms-sh-head"><div><b>' + esc(c.title) + '</b><small>' + esc(symInfo()[0]) + ' · ' + esc(S.REPORTS[st.rep].title) + '</small></div><button type="button" class="ms-x" data-close="1" aria-label="Close">×</button></div>';
    h += '<div class="ms-sh-sum">' + (s.guard === 'withheld' ? '—' : '<b>' + S.pct(s.p) + '</b> <span>(' + S.pct(s.lo) + ' to ' + S.pct(s.hi) + ')</span>') + ' <span>N = ' + s.n + ', ' + s.k + ' yes</span></div>';
    h += '<div class="ms-years ms-years-sh">' + yearsText(s) + '</div>';
    h += '<div class="ms-chips ms-fil">' + [['all', 'All ' + s.n], ['yes', 'Yes ' + s.k], ['no', 'No ' + (s.n - s.k)]].map(function (x) {
      return '<button type="button" class="ms-chip' + (sheetState.f === x[0] ? ' on' : '') + '" data-sf="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>';
    h += '<div class="ms-sh-list" id="ms-sh-list"><table class="ms-table ms-sess"><thead><tr><th>Date</th><th>Gap</th><th>Result</th><th></th></tr></thead><tbody>';
    shown.forEach(function (it) {
      var r = it.r;
      h += '<tr><th>' + esc(r.date) + ' <small>' + S.DOW[r.dow] + '</small></th><td>' + (r.o === r.pdc ? '0.00%' : (r.gapPct > 0 ? '+' : '') + r.gapPct.toFixed(2) + '%') + '</td><td class="' + (it.hit ? 'y' : 'n') + '">' + (it.hit ? 'Yes' : 'No') + (it.hit && it.t != null && it.t >= 0 && c.timed ? ' <small>' + S.fmtMin(it.t) + '</small>' : '') + '</td><td><a class="ms-go" href="' + esc(chartLink(c, it)) + '">Chart</a></td></tr>';
    });
    h += '</tbody></table>';
    if (list.length > shown.length) h += '<button type="button" class="ms-more" data-more="1">Show more (' + (list.length - shown.length) + ' left)</button>';
    if (!list.length) h += '<p class="ms-empty">No sessions.</p>';
    h += '</div></div>';
    var scroll = w.querySelector('#ms-sh-list');
    var keep = scroll ? scroll.scrollTop : 0;
    w.innerHTML = h;
    var ns = w.querySelector('#ms-sh-list'); if (ns && keep) ns.scrollTop = keep;
    if (!scroll) { var x = w.querySelector('.ms-x'); if (x) x.focus(); }
  }

  // ---- events --------------------------------------------------------------------------------------------------------
  function update() { persist(); load(st.sym).then(render); render(); }
  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-sym],[data-rep],[data-card],#ms-retry');
    if (!t) return;
    if (t.id === 'ms-retry') { update(); return; }
    if (t.dataset.sym) { st.sym = t.dataset.sym; update(); return; }
    if (t.dataset.rep) { st.rep = t.dataset.rep; update(); return; }
    if (t.dataset.card != null) { st.lastBtn = t; openSheet(Number(t.dataset.card)); }
  });
  root.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'ms-range') st.range = e.target.value;
    else if (id === 'ms-dow') st.dow = Number(e.target.value);
    else if (id === 'ms-bucket') st.bucket = e.target.value;
    else return;
    update();
  });
  document.addEventListener('click', function (e) {
    var w = document.getElementById('ms-sheet');
    if (!w || !w.contains(e.target)) return;
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    var f = e.target.closest('[data-sf]'); if (f) { sheetState.f = f.dataset.sf; sheetState.n = 60; drawSheet(); return; }
    if (e.target.closest('[data-more]')) { sheetState.n += 120; drawSheet(); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.sheet != null) closeSheet(); });

  window.__stkMS = { state: st, run: function () { return cur; } };
  load(st.sym).then(render);
  render();
})();
