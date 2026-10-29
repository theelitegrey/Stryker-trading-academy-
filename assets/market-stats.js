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
  var SYMS = [['NQ', 'ms_nq', 'NQ', 'Nasdaq-100 E-mini'], ['ES', 'ms_es', 'ES', 'S&P 500 E-mini'], ['SPX', 'ms_spx', 'ES', 'S&P 500 index'], ['YM', 'ms_ym', 'YM', 'Dow E-mini'], ['RTY', 'ms_rty', 'RTY', 'Russell 2000 E-mini'], ['GC', 'ms_gc', 'GC', 'Gold'], ['CL', 'ms_cl', 'CL', 'Crude oil']];
  var RANGES = [['3m', 'Last 3 months', 92], ['6m', 'Last 6 months', 183], ['1y', 'Last year', 365], ['3y', 'All (3 years)', 0]];
  var st = { sym: 'NQ', rep: 'gap', range: '1y', view: 'cards', bc: 0, picker: false, pq: '', dow: -1, bucket: 'any', session: 'ny', data: {}, err: '', loading: false, sheet: null };
  try { var sv = JSON.parse(localStorage.getItem('stryker_ms') || 'null'); if (sv) { ['sym', 'rep', 'range'].forEach(function (k) { if (sv[k]) st[k] = sv[k]; }); } } catch (e) {}
  if (!S.REPORTS[st.rep]) st.rep = 'gap';
  if (!SYMS.some(function (s) { return s[0] === st.sym; })) st.sym = 'NQ';
  function persist() { try { localStorage.setItem('stryker_ms', JSON.stringify({ sym: st.sym, rep: st.rep, range: st.range })); } catch (e) {} }

  var STARTERS = ['gap', 'ib', 'oc', 'pdr'];
  var stars = STARTERS.slice();
  try { var ss = JSON.parse(localStorage.getItem('stryker_ms_stars') || 'null'); if (Array.isArray(ss)) stars = ss.filter(function (k) { return S.REPORTS[k]; }); } catch (e) {}
  function saveStars() { try { localStorage.setItem('stryker_ms_stars', JSON.stringify(stars)); } catch (e) {} }
  var GROUPS = ['Open', 'Gaps', 'Ranges', 'Candles', 'ICT'];

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
    return { from: from, dow: st.dow, bucket: st.bucket, session: st.session };
  }


  // ---- Today ("what is in play") ---------------------------------------------------------------------------------------
  // The chosen symbol's current session set against the history, one card per report. Bars come from our own
  // /api/chart/bars (same rule as the charts: the server decides how fresh the newest bars are for this member, a Pro
  // member's token is sent along). No extra data cost: three edge-cached 2-day pages, re-read once a minute.
  var BARS_SYM = { NQ: 'NQ', ES: 'ES', SPX: 'ES', YM: 'YM', RTY: 'RTY', GC: 'GC', CL: 'CL' };
  var PAGE_S = 2 * 86400;
  var today = { sym: '', bars: null, err: '', html: '', at: 0, busy: false };
  var rtMod = null;
  function authHeaders() {
    if (!rtMod) rtMod = import('./rt-access.js?v=722').catch(function () { return null; });
    return rtMod.then(function (m) { return m && m.rtHeadersReady ? m.rtHeadersReady(3000) : {}; }).catch(function () { return {}; });
  }
  function fetchBars(root) {
    return authHeaders().then(function (hd) {
      var cur = Math.floor(Date.now() / 1000 / PAGE_S), jobs = [];
      for (var i = 0; i < 3; i++) jobs.push(fetch('/api/chart/bars/' + root + '?tf=5&page=' + (cur - i), { headers: Object.assign({ accept: 'application/json' }, hd), cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : { bars: [] }; }).catch(function () { return { bars: [] }; }));
      return Promise.all(jobs).then(function (res) {
        var m = {};
        res.forEach(function (d) { (d.bars || []).forEach(function (b) { m[b[0]] = b; }); });
        return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a[0] - b[0]; });
      });
    });
  }
  function dataSym() { return st.sym === 'SPX' ? 'ES' : st.sym; }
  function refreshToday(force) {
    var sym = dataSym();
    if (today.busy || (!force && today.sym === sym && Date.now() - today.at < 55000)) return;
    today.busy = true;
    Promise.all([load(sym), fetchBars(BARS_SYM[sym] || sym)]).then(function (r) {
      today.sym = sym; today.bars = r[1]; today.at = Date.now(); today.err = r[1].length ? '' : 'No bars came back just now.';
    }).catch(function () { today.err = 'Could not read today\u2019s bars.'; }).then(function () {
      today.busy = false; paintToday();
    });
  }
  function f1(x) { return x == null ? '\u2014' : (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)); }
  function clockAt(T, minsFromOpen) { return S.nyClock(S.sessionOpenEpoch(T.date) + minsFromOpen * 60); }
  function hl(s) { return '<b>' + S.freq(s) + '</b>'; }
  function tcard(id, title, status, tone, body, rep) {
    return '<article class="ms-tc" data-tc="' + id + '"><header><h3>' + esc(title) + '</h3><span class="ms-pill ' + tone + '">' + esc(status) + '</span></header>' + body +
      (rep ? '<button type="button" class="ms-tc-go" data-rep="' + rep + '">Open full report</button>' : '') + '</article>';
  }
  function line(label, html) { return '<p class="ms-tl"><span>' + esc(label) + '</span>' + html + '</p>'; }
  function todayHtml() {
    var d = st.data[dataSym()];
    if (!d) return '';
    var bars = today.bars || [];
    var h = '<section class="ms-today" id="ms-today" aria-label="Today against history"><div class="ms-today-head"><h2>Today</h2>';
    if (!bars.length) return h + '</div><p class="ms-empty">' + esc(today.err || 'Reading today\u2019s bars\u2026') + '</p></section>';
    var lastT = bars[bars.length - 1][0], date = S.nyDate(lastT);
    var sb = S.sessionBars(bars, date);
    var prior = S.priorFromBars(bars, date);
    if (!prior) { var pr = d.rows.filter(function (r) { return r.date < date; }).pop(); if (pr) prior = { date: pr.date, h: pr.h, l: pr.l, c: pr.c }; }
    var T = S.todayState(sb, prior, date);
    if (!T) return h + '</div><p class="ms-empty">No regular session bars yet for ' + esc(date) + '.</p></section>';
    var isToday = date === S.nyDate(Date.now() / 1000);
    var ageMin = Math.max(0, Math.floor((Date.now() / 1000 - T.endEpoch) / 60));
    h += '<span class="ms-today-sub">' + (isToday ? '' : 'Last session: ') + esc(date) + ' \u00b7 ' + esc(st.sym) + (st.sym === 'SPX' ? ' (ES bars)' : '') + ' \u00b7 bars through ' + esc(S.nyClock(T.endEpoch)) + ' ET \u00b7 ' +
      (T.complete ? 'session closed' : ageMin < 1 ? 'updated just now' : 'updated ' + ageMin + ' min ago') + '</span></div>';
    var H = S.todayHistory(d.rows, T);
    h += '<p class="ms-today-note">Each card sets today against the ' + H.n + ' earlier sessions on file (about 3 years). Historical frequencies with sample sizes. Not predictions.</p>';
    h += '<div class="ms-tgrid">';
    // gap
    var g = T.gap, gb;
    if (!g.has) gb = tcard('gap', 'Gap', 'No gap', 'flat', '<p class="ms-tl">Opened at the prior close (' + f1(T.prior.c) + ').</p>', 'gap');
    else {
      var gs = g.filled ? 'Filled' : 'Not filled yet';
      var b = '<p class="ms-big2">' + (g.dir > 0 ? 'Gap up ' : 'Gap down ') + (g.pct > 0 ? '+' : '') + g.pct.toFixed(2) + '%</p>';
      b += '<p class="ms-tl">' + f1(Math.abs(g.pts)) + ' pts, size ' + S.BUCKETS.filter(function (x) { return x[0] === g.bucket; })[0][1] + ' (' + S.BUCKET_TEXT[g.bucket] + '). Prior close ' + f1(T.prior.c) + '.</p>';
      b += '<p class="ms-tl">' + (g.filled ? 'Filled at ' + esc(clockAt(T, g.fillMin)) + ' ET, ' + S.fmtMin(g.fillMin) + ' after the open.' : 'Still open ' + S.fmtMin(T.elapsed) + ' after the open.') + '</p>';
      if (H.gap) {
        b += line('History, this size', 'Gap filled ' + hl(H.gap.bucket));
        b += line('Same size, ' + S.DOW[T.dow], 'Gap filled ' + hl(H.gap.bucketDow));
        if (H.gap.later) b += line('Not filled by now', 'Of the same-size gaps still open after ' + S.fmtMin(T.elapsed) + ', filled later: ' + hl(H.gap.later));
      }
      gb = tcard('gap', 'Gap', gs, g.filled ? 'done' : 'open', b, 'gap');
    }
    h += gb;
    // opening ranges
    [15, 30].forEach(function (w) {
      var r = T.or[w], HH = H.or[w], body = '', status, tone;
      if (!r.done) { status = 'Forming'; tone = 'flat'; body = '<p class="ms-tl">The ' + w + '-minute range closes at ' + esc(clockAt(T, w)) + ' ET.</p>'; }
      else {
        var broke = r.dir === 1 ? 'Broke up' : r.dir === -1 ? 'Broke down' : r.dir === 2 ? 'Broke both ways' : 'Inside';
        status = broke; tone = r.dir === 0 ? 'flat' : 'open';
        body = '<p class="ms-tl">Range ' + f1(r.lo) + ' to ' + f1(r.hi) + ' (' + f1(r.hi - r.lo) + ' pts).</p>';
        if (r.dir === 0) body += '<p class="ms-tl">Price has stayed inside so far; last ' + f1(T.last) + '.</p>';
        else if (r.dir === 2) body += '<p class="ms-tl">One bar left both sides at ' + esc(clockAt(T, r.t)) + ' ET.</p>';
        else body += '<p class="ms-tl">First break at ' + esc(clockAt(T, r.t)) + ' ET. Extension so far ' + f1(r.ext) + ' pts (' + (r.hi > r.lo ? (r.ext / (r.hi - r.lo)).toFixed(2) : '0') + 'x the range).</p>';
        body += line('History', 'First break up ' + hl(HH.up));
        body += line('', 'First break down ' + hl(HH.down));
        body += line('', 'No break ' + hl(HH.none));
        if (r.dir === 1) { body += line('After an up break', 'Reached 1x the range: ' + hl(HH.upX1)); body += line('', 'Closed above the range high: ' + hl(HH.upC)); }
        if (r.dir === -1) { body += line('After a down break', 'Reached 1x the range: ' + hl(HH.dnX1)); body += line('', 'Closed below the range low: ' + hl(HH.dnC)); }
      }
      h += tcard('or' + w, 'Opening range ' + w + ' min', status, tone, body, 'or' + w);
    });
    // initial balance
    var ib = T.ib, ibb = '', ibs, ibt;
    if (!ib.done) { ibs = 'Forming'; ibt = 'flat'; ibb = '<p class="ms-tl">The first hour closes at 10:30 ET.</p>'; }
    else {
      ibs = ib.up && ib.dn ? 'Broke both sides' : ib.up ? 'Broke the high' : ib.dn ? 'Broke the low' : 'Inside'; ibt = ib.up || ib.dn ? 'open' : 'flat';
      ibb = '<p class="ms-tl">IB ' + f1(ib.lo) + ' to ' + f1(ib.hi) + ' (' + f1(ib.range) + ' pts).</p>';
      var mults = [0.5, 1, 1.5, 2];
      function extRow(side, reached, hist) {
        var cells = mults.map(function (m) {
          var got = ib.range > 0 && reached >= m * ib.range;
          return '<li class="' + (got ? 'got' : '') + '"><b>' + m + 'x</b><span>' + (got ? 'reached' : 'not yet') + '</span><i>' + (hist[m].guard === 'withheld' ? '\u2014' : S.pct(hist[m].p)) + '</i><small>N ' + hist[m].n + '</small></li>';
        }).join('');
        return '<p class="ms-tl"><span>' + side + ' extension so far ' + f1(reached) + ' pts (' + (ib.range > 0 ? (reached / ib.range).toFixed(2) : '0') + 'x). History of sessions that broke that side:</span></p><ul class="ms-ext">' + cells + '</ul>';
      }
      if (ib.up) ibb += extRow('High', ib.xu, H.ib.up);
      if (ib.dn) ibb += extRow('Low', ib.xd, H.ib.dn);
      if (!ib.up && !ib.dn) {
        ibb += '<p class="ms-tl">Neither side broken since 10:30 ET; last ' + f1(T.last) + '.</p>';
        ibb += line('History', 'High only ' + hl(H.ib.broke.up)) + line('', 'Low only ' + hl(H.ib.broke.down)) + line('', 'Both ' + hl(H.ib.broke.both)) + line('', 'Neither ' + hl(H.ib.broke.none));
      }
    }
    h += tcard('ib', 'Initial balance', ibs, ibt, ibb, 'ib');
    // prior day range
    var pd = T.pd, pb = '';
    pb += '<p class="ms-tl">Prior day (' + esc(T.prior.date) + '): high ' + f1(T.prior.h) + ', low ' + f1(T.prior.l) + ', close ' + f1(T.prior.c) + '.</p>';
    pb += '<p class="ms-tl">Opened ' + (pd.loc === 'inside' ? 'inside' : pd.loc === 'above' ? 'above' : 'below') + ' the prior range, and ' + pd.vsClose + ' the prior close.</p>';
    pb += '<p class="ms-tl">High ' + (pd.thi != null ? 'touched at ' + esc(clockAt(T, pd.thi)) + ' ET' : 'not touched yet') + '. Low ' + (pd.tlo != null ? 'touched at ' + esc(clockAt(T, pd.tlo)) + ' ET' : 'not touched yet') + '.</p>';
    pb += line('History, opened ' + pd.loc, 'Touched the prior high ' + hl(H.pd.hi));
    pb += line('', 'Touched the prior low ' + hl(H.pd.lo));
    pb += line('', 'Closed above the prior high ' + hl(H.pd.closeAbove));
    pb += line('', 'Closed below the prior low ' + hl(H.pd.closeBelow));
    h += tcard('pd', 'Prior day range', 'Opened ' + pd.loc, pd.loc === 'inside' ? 'flat' : 'open', pb, 'prior');
    h += '</div></section>';
    return h;
  }
  function paintToday() {
    try { today.html = todayHtml(); } catch (e) { console.warn('today', e); today.html = '<section class="ms-today"><p class="ms-empty">Today could not be drawn.</p></section>'; }
    var el = document.getElementById('ms-today-slot');
    if (el) el.innerHTML = today.html;
  }


  // ---- breakdown sub-tabs (weekday, size, time, year) -------------------------------------------------------------------
  var VIEWS = [['cards', 'Summary'], ['dow', 'By weekday'], ['size', 'By size'], ['time', 'By time'], ['year', 'By year']];
  function viewTabs() {
    return '<div class="ms-row ms-views" role="tablist" aria-label="Breakdown">' + VIEWS.map(function (v) {
      return '<button type="button" role="tab" class="ms-view' + (v[0] === st.view ? ' on' : '') + '" data-view="' + v[0] + '" aria-selected="' + (v[0] === st.view) + '">' + v[1] + '</button>';
    }).join('') + '</div>';
  }
  function breakdownHtml() {
    var cards = cur.cards.filter(function (c) { return st.view !== 'time' || c.timed; });
    if (!cards.length) return '<p class="ms-empty">This report has no timed outcome, so there is no time of day to break down.</p>';
    if (st.bc >= cards.length || st.bc < 0) st.bc = 0;
    var c = cards[st.bc], b = S.breakdown(c, st.view);
    var h = '<label class="ms-sel ms-bsel"><span>Outcome</span><select id="ms-bc">' + cards.map(function (x, i) {
      return '<option value="' + i + '"' + (i === st.bc ? ' selected' : '') + '>' + esc((x.group ? x.group + ': ' : '') + x.title) + '</option>';
    }).join('') + '</select></label>';
    h += '<p class="ms-note">' + esc(c.sub) + '. ' + esc(b.note || '') + '</p>';
    h += '<div class="ms-tw"><table class="ms-table ms-bd"><thead><tr><th>' + (st.view === 'time' ? 'Window (ET)' : 'Group') + '</th><th>Happened</th><th>Sessions</th><th>Range</th>' + (b.time ? '<th>Cumulative</th>' : '') + '<th class="ms-bdbar"></th></tr></thead><tbody>';
    b.rows.forEach(function (r) {
      var s = r.s, off = s.guard === 'withheld';
      h += '<tr><th>' + esc(r.label) + '</th><td>' + (off ? '\u2014' : S.pct(s.p)) + '</td><td>' + (b.time ? s.k + ' of ' + s.n : s.k + ' of ' + s.n) + (s.guard === 'low' ? ' <em class="ms-low">Low</em>' : '') + '</td><td>' + (off ? 'too few' : (s.lo * 100).toFixed(0) + '\u2013' + S.pct(s.hi)) + '</td>' + (b.time ? '<td>' + (r.cum == null ? '\u2014' : S.pct(r.cum)) + '</td>' : '') +
        '<td class="ms-bdbar">' + (off ? '' : '<span class="ms-mini"><i style="width:' + (s.p * 100).toFixed(1) + '%"></i></span>') + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  // ---- report picker ----------------------------------------------------------------------------------------------------
  function drawPicker() {
    var w = document.getElementById('ms-picker');
    if (!st.picker) { if (w) w.remove(); document.documentElement.classList.remove('ms-noscroll'); return; }
    if (!w) { w = document.createElement('div'); w.id = 'ms-picker'; w.className = 'ms-sheet-wrap'; document.body.appendChild(w); document.documentElement.classList.add('ms-noscroll'); }
    var q = st.pq.trim().toLowerCase();
    var h = '<div class="ms-scrim" data-pclose="1"></div><div class="ms-sheet" role="dialog" aria-modal="true" aria-label="Choose a report">';
    h += '<div class="ms-sh-head"><div><b>Reports</b><small>Star a report to keep it in your tab row.</small></div><button type="button" class="ms-x" data-pclose="1" aria-label="Close">\u00d7</button></div>';
    h += '<input type="search" id="ms-pq" class="ms-search" placeholder="Search reports" value="' + esc(st.pq) + '" autocomplete="off">';
    h += '<div class="ms-sh-list ms-plist">';
    var any = false;
    GROUPS.forEach(function (g) {
      var keys = Object.keys(S.REPORTS).filter(function (k) {
        var r = S.REPORTS[k];
        return r.group === g && (!q || (r.title + ' ' + r.blurb + ' ' + g).toLowerCase().indexOf(q) >= 0);
      });
      if (!keys.length) return;
      any = true;
      h += '<h4 class="ms-pg">' + esc(g) + '</h4>';
      keys.forEach(function (k) {
        var r = S.REPORTS[k], on = stars.indexOf(k) >= 0;
        h += '<div class="ms-pi' + (k === st.rep ? ' cur' : '') + '"><button type="button" class="ms-pi-main" data-pick="' + k + '"><b>' + esc(r.title) + '</b><small>' + esc(r.blurb) + '</small></button>' +
          '<button type="button" class="ms-star' + (on ? ' on' : '') + '" data-star="' + k + '" aria-pressed="' + on + '" aria-label="' + (on ? 'Remove ' : 'Bookmark ') + esc(r.title) + '">' + (on ? '\u2605' : '\u2606') + '</button></div>';
      });
    });
    if (!any) h += '<p class="ms-empty">No report matches.</p>';
    h += '</div></div>';
    var hadInput = w.querySelector('#ms-pq'), keep = w.querySelector('.ms-plist') ? w.querySelector('.ms-plist').scrollTop : 0;
    w.innerHTML = h;
    var np = w.querySelector('.ms-plist'); if (np && keep) np.scrollTop = keep;
    var inp = w.querySelector('#ms-pq');
    if (inp && hadInput) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
  function closePicker() { st.picker = false; drawPicker(); var b = document.getElementById('ms-pick'); if (b) b.focus(); }

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
    var tabKeys = stars.slice(); if (tabKeys.indexOf(st.rep) < 0) tabKeys.push(st.rep);
    var dows = [[-1, 'Any day']].concat(S.DOW.map(function (d, i) { return [i, d]; }));
    var bks = [['any', 'Any gap size']].concat(S.BUCKETS.map(function (b) { return [b[0], b[1] + ': ' + S.BUCKET_TEXT[b[0]]]; }));
    return '<div class="ms-ctl">' +
      '<div class="ms-row">' + chips('sym', SYMS.map(function (s) { return [s[0], s[0]]; }), st.sym) + '</div>' +
      '<div class="ms-row ms-reps" role="tablist" aria-label="Report">' + tabKeys.map(function (k) {
        return '<button type="button" role="tab" class="ms-tab' + (k === st.rep ? ' on' : '') + '" data-rep="' + k + '" aria-selected="' + (k === st.rep) + '">' + esc(S.REPORTS[k].title.replace(' (first hour)', '')) + '</button>';
      }).join('') + '<button type="button" class="ms-tab ms-pick" id="ms-pick" aria-haspopup="dialog">All reports (' + Object.keys(S.REPORTS).length + ') \u25BE</button></div>' +
      '<div class="ms-row ms-sels">' + selectBox('ms-range', 'Dates', RANGES, st.range) + selectBox('ms-dow', 'Day', dows, st.dow) + selectBox('ms-bucket', 'Gap size', bks, st.bucket) + (S.REPORTS[st.rep].sessions ? selectBox('ms-session', 'Session', [['ny', 'New York'], ['lon', 'London'], ['asia', 'Asia']], st.session) : '') + '</div>' +
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
    if (rep.futuresOnly && st.sym === 'SPX') h += '<p class="ms-warn">This report needs overnight bars, which the SPX cash index does not have. Pick a futures symbol.</p>';
    if (rep.sessions) h += '<p class="ms-note">Session: ' + esc(S.SESS_TEXT[st.session]) + '. Times are New York.</p>';
    if (cur.sessions < S.WARN_N) h += '<p class="ms-warn">Only ' + cur.sessions + ' sessions match these filters. Treat every number below as a rough guide.</p>';
    h += viewTabs();
    if (st.view !== 'cards') return h + breakdownHtml();
    var group = '';
    h += '<div class="ms-grid">';
    cur.cards.forEach(function (c, i) {
      if (c.group !== group) {
        group = c.group;
        if (group) {
          var emptyGrid = h.slice(-21) === '<div class="ms-grid">';
          if (emptyGrid) h = h.slice(0, -21); else h += '</div>';
          h += '<h3 class="ms-grp">' + esc(group) + '</h3><div class="ms-grid">';
        }
      }
      h += card(c, i);
    });
    h += '</div>';
    if (cur.extra) {
      h += '<h3 class="ms-grp">' + esc(cur.extra.title) + '</h3><div class="ms-tw"><table class="ms-table"><thead><tr><th>' + (st.rep === 'adr' ? 'Time' : 'Day') + '</th><th>N</th><th>Median</th><th>95% interval</th></tr></thead><tbody>';
      cur.extra.rows.forEach(function (r) {
        h += '<tr><th>' + esc(r.label) + '</th><td>' + r.n + (r.guard === 'low' ? ' <em class="ms-low">Low</em>' : '') + '</td><td>' + (r.guard === 'withheld' ? '\u2014' : r.med.toFixed(st.rep === 'adr' ? 0 : 2) + '%') + '</td><td>' + (r.guard === 'withheld' ? '\u2014' : r.lo.toFixed(st.rep === 'adr' ? 0 : 2) + '% to ' + r.hi.toFixed(st.rep === 'adr' ? 0 : 2) + '%') + '</td></tr>';
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
    var h = controls() + '<div id="ms-today-slot">' + (today.sym === dataSym() ? today.html : '') + '</div>';
    if (st.loading && !st.data[st.sym]) h += '<p class="ms-empty">Loading…</p>';
    else if (st.err && !st.data[st.sym]) h += '<p class="ms-empty">' + esc(st.err) + ' <button type="button" class="ms-retry" id="ms-retry">Try again</button></p>';
    else if (st.data[st.sym]) h += results();
    var keep = window.scrollY;
    root.innerHTML = h;
    var a = document.getElementById('ms-ago');
    if (a && st.data[st.sym]) a.textContent = ago(st.data[st.sym].t);
    if (keep) window.scrollTo(0, keep);
    refreshToday();
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
    var t = e.target.closest('[data-sym],[data-rep],[data-card],[data-view],#ms-pick,#ms-retry');
    if (!t) return;
    if (t.id === 'ms-retry') { update(); return; }
    if (t.id === 'ms-pick') { st.picker = true; st.pq = ''; drawPicker(); var pi = document.getElementById('ms-pq'); if (pi) pi.focus(); return; }
    if (t.dataset.view) { st.view = t.dataset.view; st.bc = 0; update(); return; }
    if (t.dataset.sym) { st.sym = t.dataset.sym; update(); return; }
    if (t.dataset.rep) { st.rep = t.dataset.rep; st.view = 'cards'; st.bc = 0; update(); if (t.classList.contains('ms-tc-go')) { var tab = root.querySelector('.ms-reps'); if (tab) window.scrollTo(0, Math.max(0, tab.getBoundingClientRect().top + window.scrollY - 70)); } return; }
    if (t.dataset.card != null) { st.lastBtn = t; openSheet(Number(t.dataset.card)); }
  });
  root.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'ms-range') st.range = e.target.value;
    else if (id === 'ms-dow') st.dow = Number(e.target.value);
    else if (id === 'ms-bucket') st.bucket = e.target.value;
    else if (id === 'ms-bc') { st.bc = Number(e.target.value); persist(); render(); return; }
    else if (id === 'ms-session') st.session = e.target.value;
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
  document.addEventListener('click', function (e) {
    var w = document.getElementById('ms-picker');
    if (!w || !w.contains(e.target)) return;
    if (e.target.closest('[data-pclose]')) { closePicker(); return; }
    var sb = e.target.closest('[data-star]');
    if (sb) { var k = sb.dataset.star, i = stars.indexOf(k); if (i >= 0) stars.splice(i, 1); else stars.push(k); saveStars(); drawPicker(); render(); return; }
    var pk = e.target.closest('[data-pick]');
    if (pk) { st.rep = pk.dataset.pick; st.view = 'cards'; st.bc = 0; st.picker = false; drawPicker(); update(); }
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'ms-pq') { st.pq = e.target.value; drawPicker(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (st.picker) closePicker(); else if (st.sheet != null) closeSheet(); } });

  setInterval(function () { if (!document.hidden) refreshToday(true); }, 60000);
  window.__stkMS = { state: st, today: today, run: function () { return cur; } };
  load(st.sym).then(render);
  render();
})();
