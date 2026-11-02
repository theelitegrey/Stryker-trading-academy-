// TradeZoro — Screener page (scanner.html). Classic script. Depends on: assets/screener-core.js (filters, columns, symbols),
// assets/mkt-viz.js (bottom sheet), assets/scanner-l2.js (futures book columns, admin gate).
// Data: the book-recorder Worker GET /scan?part=stock|etf|crypto|fut (gzip JSON tables, edge cached, filled by the feeder on our
// server). Filtering, sorting and column sets run here on that cached copy. A row opens ZoroCharts (charts?symbol=) when we
// chart the symbol, else an info sheet. Status wording: "Updated X min ago".
(function () {
  'use strict';
  var C = window.stkScreener, V = window.stkViz;
  var root = document.getElementById('scn-root');
  if (!root || !C || !V) return;
  var API = 'https://book-recorder.theelitegrey.workers.dev/scan?part=';
  var REFRESH_MS = 3 * 60 * 1000, ROW_H = 56, HEAD_H = 44, SYM_W = 148;
  var MK = C.MARKETS;
  var COLW = { px: 96, pct: 100, big: 92, x: 92, n1: 92, n2: 96, int: 72, txt: 140, date: 84 };

  var st = { m: 'stock', q: 'gainers', flt: [], setId: 'overview', cols: null, sortK: null, sortD: -1, search: '', tables: {}, l2: false, pro: true, free: false, rows: [], view: [], eSort: ['chg', -1] };
  try {
    var sv = JSON.parse(localStorage.getItem('stryker_screener') || 'null');
    if (sv && C.ALL.indexOf(sv.m) !== -1) { st.m = sv.m; st.q = sv.q || ''; st.flt = Array.isArray(sv.flt) ? sv.flt.slice(0, C.MAXF) : []; st.setId = sv.setId || 'overview'; st.cols = Array.isArray(sv.cols) ? sv.cols : null; st.sortK = sv.sortK || null; st.sortD = sv.sortD === 1 ? 1 : -1; }
  } catch (e) {}
  function persist() { try { localStorage.setItem('stryker_screener', JSON.stringify({ m: st.m, q: st.q, flt: st.flt, setId: st.setId, cols: st.cols, sortK: st.sortK, sortD: st.sortD })); } catch (e) {} }
  var esc = V.esc;
  var ctx = function () { return { l2: st.l2, pro: st.pro }; };
  var mName = function () { return MK.filter(function (m) { return m[0] === st.m; })[0][1]; };

  // ---- data ---------------------------------------------------------------------------------------------------------
  function load(part) {
    return fetch(API + part, { headers: { accept: 'application/octet-stream' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (r.headers.get('x-scan-gzip') === '1' && typeof DecompressionStream === 'function') return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();
      return r.json();
    });
  }
  function table(m) {
    var e = st.tables[m];
    if (e && (e.p || (e.rows && Date.now() - e.at < REFRESH_MS) || (e.err && Date.now() - e.at < 30000))) return e.p || Promise.resolve(e);
    var p = load(m).then(function (d) { st.tables[m] = { rows: C.rowsOfTable(d, m, d.t), t: d.t, at: Date.now() }; return st.tables[m]; },
      function () { st.tables[m] = { rows: null, t: 0, at: Date.now(), err: true }; return st.tables[m]; });
    st.tables[m] = { p: p, rows: e && e.rows, t: e && e.t, at: 0 };
    return p;
  }

  // ---- state helpers ------------------------------------------------------------------------------------------------------
  function preset() { return st.q ? C.presetById(st.q) : null; }
  function colKeys() {
    var k = st.cols && st.cols.length ? st.cols : C.setKeys(st.setId, st.m, ctx());
    k = C.gateCols(k, st.m, ctx());
    return k.length ? k : C.setKeys('overview', st.m, ctx());
  }
  function compute() {
    var tb = st.tables[st.m];
    st.rows = tb && tb.rows || [];
    var p = preset(), flt = C.buildFilter(p ? p.flt : st.flt, st.m, ctx()), q = st.search.trim().toLowerCase();
    var v = st.rows.filter(flt.test);
    if (q) v = v.filter(function (r) { return String(r.s || '').toLowerCase().indexOf(q) !== -1 || String(r.n || '').toLowerCase().indexOf(q) !== -1; });
    var sk = st.sortK, sd = st.sortD;
    if (!sk && p && p.sort) { sk = p.sort[0]; sd = p.sort[1]; }
    if (!sk) { sd = -1; sk = st.m === 'etf' ? 'av' : st.m === 'fut' ? 'chg' : 'cap'; }
    st.eSort = [sk, sd];
    if (st.m === 'fut' && st.l2) mergeL2(st.rows);
    if (st.pro && GX && GX.cache) mergeGex(st.rows);
    st.view = C.sortRows(v, sk, sd);
  }

  // ---- render ---------------------------------------------------------------------------------------------------------------
  var vp = null, body = null, drawRaf = 0;
  function chipsHtml() {
    var p = preset(), list = p ? p.flt.filter(function (x) { return x.f !== 'dv' && !(x.f === 'c' && x.v === 1); }) : st.flt;
    var h = '<div class="scn-chips" role="group" aria-label="Filters">';
    list.forEach(function (x, i) {
      var c = C.clean(x, st.m, ctx());
      if (!c) return;
      h += p ? '<span class="scn-fchip is-fixed">' + esc(C.describe(c)) + '</span>'
        : '<span class="scn-fchip"><button type="button" class="scn-fedit" data-fedit="' + i + '">' + esc(C.describe(c)) + '</button><button type="button" class="scn-fx" data-fdel="' + i + '" aria-label="Remove filter">×</button></span>';
    });
    return h + '<button type="button" class="scn-addf" data-fadd>+ Filter</button></div>';
  }
  function quickHtml() {
    return '<div class="scn-row scroll-x" role="group" aria-label="Quick screens"><span class="scn-lab">Quick screens</span>' + C.presetsFor(st.m).map(function (p) {
      return '<button type="button" class="mv-chip" data-q="' + p.id + '" aria-pressed="' + (st.q === p.id) + '">' + esc(p.t) + '</button>';
    }).join('') + '</div>';
  }
  // Column sets. GEX levels (ETFs, futures) and the Order flow set (futures) are Pro: a Free member sees them with a PRO tag and
  // gets the plan modal on tap (no prices on this page). Pro members get the columns; Order flow also needs the L2 gate.
  function setsHtml() {
    var ids = C.setsFor(st.m), h = '';
    ids.forEach(function (id) {
      var lock = '';
      if (id === 'gexs') lock = st.pro ? '' : 'gex';
      else if (id === 'flow') lock = st.l2 ? '' : (st.free ? 'of' : 'hide');
      if (lock === 'hide') return;
      h += lock ? '<button type="button" class="mv-chip" data-lock="' + lock + '">' + C.SETS[id].l + ' <span class="stk-protag">PRO</span></button>'
        : '<button type="button" class="mv-chip" data-set="' + id + '" aria-pressed="' + (!st.cols && st.setId === id) + '">' + C.SETS[id].l + '</button>';
    });
    return '<div class="scn-row scroll-x" role="group" aria-label="Column sets"><span class="scn-lab">Columns</span>' + h + '<button type="button" class="mv-chip scn-pick" data-pick>Customise</button></div>';
  }
  function shell(msg) {
    var h = '<div class="scn-seg" role="tablist" aria-label="Market">' + MK.map(function (m) {
      return '<button type="button" role="tab" data-m="' + m[0] + '" aria-selected="' + (st.m === m[0]) + '">' + m[1] + '</button>';
    }).join('') + '</div>';
    h += quickHtml() + chipsHtml() + '<div class="scn-bar"><label class="scn-search"><span class="scn-sr">Search symbol or name</span><input type="search" data-search placeholder="Search symbol or name" value="' + esc(st.search) + '" autocomplete="off" autocapitalize="off" spellcheck="false"></label><div class="scn-count" id="scn-count" aria-live="polite"></div></div>' + setsHtml() + '<div class="scn-row" role="group" aria-label="Screens"><span class="scn-lab">Screens</span><button type="button" class="mv-chip" data-share>Share link</button><button type="button" class="mv-chip" data-save>Save screen</button><button type="button" class="mv-chip" data-saved>My screens</button></div>';
    h += msg ? '<p class="scn-empty">' + esc(msg) + '</p>' : '<div class="scn-vp" id="scn-vp" tabindex="0" aria-label="Results"></div>';
    root.innerHTML = h;
    wire();
  }
  function render() {
    var tb = st.tables[st.m], ago = document.getElementById('scn-ago');
    if (ago) ago.textContent = C.agoText(tb && tb.t);
    vp = body = null;
    if (!tb || (tb.p && !tb.rows)) { shell('Loading ' + mName().toLowerCase() + '…'); return; }
    if (tb.err || !tb.rows) { shell(st.m === 'fut' ? 'Futures data is not available yet. Try again in a few minutes.' : 'Scanner data is temporarily unavailable. Try again in a minute.'); return; }
    compute();
    shell('');
    var cnt = document.getElementById('scn-count'); if (cnt) cnt.textContent = st.view.length.toLocaleString('en-US') + ' of ' + st.rows.length.toLocaleString('en-US');
    vp = document.getElementById('scn-vp');
    if (!st.view.length) { vp.outerHTML = '<p class="scn-empty">Nothing matches right now. Try removing a filter.</p>'; vp = null; return; }
    buildGrid();
  }
  // header text: the phone column is 88-100px wide, so long names are shortened ("Change 1D %" -> "1D %"); the full name is the tooltip
  var SHORT = { chg: '1D %', perfW: '5D %', perfM: '1M %', perfQ: '3M %', perfYtd: 'YTD %', perfY: '1Y %', rvol: 'Rel vol', av: 'Avg vol', adv: 'Avg value', off52h: 'From 52w high', off52l: 'From 52w low', r52: '52w range', w52: '52w width' };
  function shortLabel(d) { return SHORT[d.k] || d.l; }
  function colDef(k) { return C.BY[k] || { k: k, l: k, f: 'n2' }; }
  function buildGrid() {
    var defs = colKeys().map(colDef), w = SYM_W + defs.reduce(function (s, d) { return s + (COLW[d.f] || 88); }, 0);
    var sk = st.eSort[0], sd = st.eSort[1];
    var h = '<div class="scn-grid" style="width:' + w + 'px"><div class="scn-hd" role="row" style="height:' + HEAD_H + 'px"><button type="button" class="scn-c scn-sym" data-sort="s" aria-sort="' + (sk === 's' ? (sd > 0 ? 'ascending' : 'descending') : 'none') + '">Symbol' + (sk === 's' ? (sd > 0 ? ' ▲' : ' ▼') : '') + '</button>';
    defs.forEach(function (d) {
      h += '<button type="button" class="scn-c scn-h' + (sk === d.k ? ' on' : '') + '" style="width:' + (COLW[d.f] || 88) + 'px" data-sort="' + d.k + '" aria-sort="' + (sk === d.k ? (sd > 0 ? 'ascending' : 'descending') : 'none') + '" title="' + esc(d.l) + '"><span>' + esc(shortLabel(d)) + '</span>' + (sk === d.k ? '<i>' + (sd > 0 ? '▲' : '▼') + '</i>' : '') + '</button>';
    });
    h += '</div><div class="scn-bd" id="scn-bd" style="height:' + (st.view.length * ROW_H) + 'px"></div></div>';
    vp.innerHTML = h;
    body = document.getElementById('scn-bd');
    vp._defs = defs;
    vp.addEventListener('scroll', schedule, { passive: true });
    body.addEventListener('click', onRow);
    body.addEventListener('keydown', function (e) { if (e.key === 'Enter') onRow(e); });
    vp.querySelector('.scn-hd').addEventListener('click', function (e) { var b = e.target.closest('[data-sort]'); if (b) sortBy(b.getAttribute('data-sort')); });
    draw();
  }
  function schedule() { if (!drawRaf) drawRaf = requestAnimationFrame(function () { drawRaf = 0; draw(); }); }
  function draw() {
    if (!vp || !body) return;
    var w = C.windowOf(st.view.length, ROW_H, Math.max(0, vp.scrollTop - HEAD_H), vp.clientHeight, 6), defs = vp._defs, h = '';
    for (var i = w.first; i < w.last; i++) {
      var r = st.view[i], t = C.symParts(r.s).t.replace(/1!$/, '');
      h += '<div class="scn-r" role="row" tabindex="0" data-i="' + i + '" style="top:' + (i * ROW_H) + 'px;height:' + ROW_H + 'px"><div class="scn-c scn-sym"><b>' + esc(t) + '</b><small>' + esc(r.n || '') + '</small></div>';
      for (var j = 0; j < defs.length; j++) {
        var d = defs[j], v = r[d.k], cls = d.f === 'pct' && C.isNum(v) ? (v > 0 ? ' up' : v < 0 ? ' dn' : '') : '';
        h += '<div class="scn-c' + (d.f === 'txt' ? ' scn-t' : '') + cls + '" style="width:' + (COLW[d.f] || 88) + 'px">' + esc(C.fmt(v, d.f)) + '</div>';
      }
      h += '</div>';
    }
    body.innerHTML = h;
  }
  function sortBy(k) {
    if (st.eSort[0] === k) st.sortD = -st.eSort[1]; else st.sortD = k === 's' ? 1 : -1;
    st.sortK = k; persist(); render();
  }

  // ---- row tap: ZoroCharts for symbols we chart, else an info sheet --------------------------------------------------------------
  function onRow(e) {
    var el = e.target.closest('.scn-r'); if (!el) return;
    var r = st.view[Number(el.getAttribute('data-i'))]; if (!r) return;
    var sym = C.chartSymbol(r, st.m);
    if (sym) { location.href = 'charts?symbol=' + encodeURIComponent(sym); return; }
    var p = C.symParts(r.s), ks = ['c', 'chg', 'gap', 'vol', 'rvol', 'rsi', 'hi52', 'lo52', 'cap', 'pe', 'dy', 'beta', 'perfW', 'perfM', 'perfYtd', 'sec', 'ind', 'earn'];
    var dl = ks.filter(function (k) { return C.BY[k] && C.BY[k].m.indexOf(st.m) !== -1 && r[k] != null; }).map(function (k) { return '<div><dt>' + esc(C.BY[k].l) + '</dt><dd>' + esc(C.fmt(r[k], C.BY[k].f)) + '</dd></div>'; }).join('');
    V.openSheet(p.t, (r.n || '') + (p.ex ? ' · ' + p.ex : ''), '<dl class="scn-dl">' + dl + '</dl><p class="mv-sh-note">ZoroCharts covers futures, indexes, index ETFs and crypto. Single stocks open here instead. Education only. Not financial advice.</p>');
  }

  // ---- sheets: add / edit a filter, customise columns -----------------------------------------------------------------------------
  function openFilter(idx) {
    var cur = idx != null ? st.flt[idx] : null, fs = C.filterFieldsFor(st.m, ctx()), g = {};
    fs.forEach(function (d) { (g[d.g] = g[d.g] || []).push(d); });
    var f0 = cur ? cur.f : fs[0].k;
    var h = '<form class="scn-form" id="scn-fform" novalidate><label>Filter<select name="f">' + Object.keys(g).map(function (k) {
      return '<optgroup label="' + esc(k) + '">' + g[k].map(function (d) { return '<option value="' + d.k + '"' + (d.k === f0 ? ' selected' : '') + '>' + esc(d.l) + '</option>'; }).join('') + '</optgroup>';
    }).join('') + '</select></label><div id="scn-fop"></div><p class="scn-err" id="scn-ferr" role="alert" hidden></p><div class="scn-act"><button type="submit" class="btn btn-primary">' + (cur ? 'Save filter' : 'Add filter') + '</button></div></form>';
    var sh = V.openSheet(cur ? 'Edit filter' : 'Add a filter', st.rows.length.toLocaleString('en-US') + ' ' + mName().toLowerCase(), h);
    var form = sh.querySelector('#scn-fform'), box = sh.querySelector('#scn-fop');
    function vis() { var op = form.op.value; box.querySelector('[data-v1]').hidden = op === 'cu' || op === 'cd'; box.querySelector('[data-v2]').hidden = op !== 'bt'; }
    function ops() {
      var d = C.BY[form.f.value], use = cur && cur.f === d.k ? cur : {}, os = C.opsFor(d), op = use.op || os[0][0], html = '', lid = '';
      html += '<label>Condition<select name="op">' + os.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === op ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
      if (d.t === 'cat') {
        var seen = {}; st.rows.forEach(function (r) { if (r[d.k]) seen[r[d.k]] = 1; });
        lid = ' list="scn-dl-v"'; html += '<datalist id="scn-dl-v">' + Object.keys(seen).sort().slice(0, 200).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>';
      }
      html += '<div class="scn-vals"><label data-v1>Value<input name="v" type="text" inputmode="' + (d.t === 'cat' ? 'text' : 'decimal') + '"' + lid + ' value="' + esc(use.v == null ? '' : use.v) + '" autocomplete="off"></label><label data-v2>and<input name="v2" type="text" inputmode="decimal" value="' + esc(use.v2 == null ? '' : use.v2) + '" autocomplete="off"></label></div>';
      box.innerHTML = html; vis(); form.op.addEventListener('change', vis);
    }
    ops(); form.f.addEventListener('change', function () { cur = null; ops(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var c = C.clean({ f: form.f.value, op: form.op.value, v: form.v.value, v2: form.v2.value }, st.m, ctx());
      if (!c) { var er = sh.querySelector('#scn-ferr'); er.hidden = false; er.textContent = 'Enter a value for this filter.'; return; }
      var was = st.flt.slice(); if (idx != null) was[idx] = c; else if (was.length < C.MAXF) was.push(c);
      st.flt = was; st.q = ''; persist(); V.closeSheet(); render();
    });
  }
  function openCols() {
    var ks = colKeys(), g = {};
    C.fieldsFor(st.m, ctx()).forEach(function (d) { (g[d.g] = g[d.g] || []).push(d); });
    var h = '<div class="scn-pk"><p class="mv-sub">Up to 12 columns. The sets on the page are quick starts.</p>' + Object.keys(g).map(function (k) {
      return '<fieldset><legend>' + esc(k) + '</legend>' + g[k].map(function (d) {
        return '<label class="scn-chk"><input type="checkbox" value="' + d.k + '"' + (ks.indexOf(d.k) !== -1 ? ' checked' : '') + '><span>' + esc(d.l) + '</span></label>';
      }).join('') + '</fieldset>';
    }).join('') + '<div class="scn-act"><button type="button" class="btn btn-primary" data-apply>Show these columns</button></div></div>';
    var sh = V.openSheet('Columns', 'Choose what the table shows', h);
    sh.querySelector('[data-apply]').addEventListener('click', function () {
      var on = Array.prototype.map.call(sh.querySelectorAll('input:checked'), function (i) { return i.value; }).slice(0, 12);
      if (on.length) { st.cols = on; persist(); }
      V.closeSheet(); render(); l2Sync(); gexSync();
    });
  }

  // ---- GEX level columns (Pro) -------------------------------------------------------------------------------------------------
  var GX = window.StkScanGex ? { cache: null } : null;
  function mergeGex(rows) {
    rows.forEach(function (r) { var x = GX.cache[C.symParts(r.s).t.replace(/1!$/, '')]; if (x) { r.cw = x.cw; r.zg = x.zg; r.pw = x.pw; } });
  }
  function gexSync() {
    if (!GX || !st.pro || (st.m !== 'etf' && st.m !== 'fut')) return;
    if (!colKeys().some(function (k) { return C.BY[k] && C.BY[k].gate === 'gex'; })) return;
    window.StkScanGex.load().then(function (c) { GX.cache = c; if (vp) { mergeGex(st.rows); draw(); } });
  }

  // ---- futures book columns (same gate as the L2 indicators: admin now) ----------------------------------------------------------
  var L2 = window.StkScanL2, l2Tm = 0;
  function mergeL2(rows) {
    var rs = L2 ? L2.rows() : {};
    rows.forEach(function (r) { var x = rs[C.symParts(r.s).t.replace(/1!$/, '')]; if (x) { r.imb = x.imb; r.bw = x.bw; r.bwS = x.bwS; r.aw = x.aw; r.awS = x.awS; r.delta = x.delta; r.bigN = x.bigN; } });
  }
  function l2Sync() {
    if (!L2) return;
    var want = st.m === 'fut' && st.l2 && colKeys().some(function (k) { return C.BY[k] && C.BY[k].gate === 'l2'; });
    if (want) L2.start(L2.ROOTS, function () { if (!l2Tm) l2Tm = setTimeout(function () { l2Tm = 0; if (vp) { mergeL2(st.rows); draw(); } }, 400); }); else L2.stop();
  }


  // ---- saved + shared screens --------------------------------------------------------------------------------------------------
  // The share link carries the whole screen in ?s= (no login, nothing stored). Saved screens live in Firestore
  // students/{uid}/screens (name, spec = same encoded string, market). Every screen is re-sanitised on the way in.
  function curScreen() {
    var p = preset();
    return { m: st.m, flt: p ? p.flt : st.flt, sort: st.eSort || null, cols: st.cols, set: st.setId };
  }
  function applyScreen(sc) {
    st.m = sc.m; st.q = ''; st.flt = sc.flt.slice(); st.cols = sc.cols; st.setId = sc.set || 'overview';
    st.sortK = sc.sort ? sc.sort[0] : null; st.sortD = sc.sort ? sc.sort[1] : -1; st.search = '';
    persist(); show();
  }
  function say(t) { if (window.showToast) window.showToast('info', t); }
  function shareLink() {
    var url = location.origin + location.pathname + '?s=' + C.encodeScreen(curScreen());
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) { navigator.share({ title: 'Screener', url: url }).catch(function () {}); return; }
    var done = function () { say('Link copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link', url); });
    else window.prompt('Copy this link', url);
  }
  function fbUser() { try { return window.firebase && firebase.apps.length && firebase.auth().currentUser; } catch (e) { return null; } }
  function sCol() { return firebase.firestore().collection('students').doc(fbUser().uid).collection('screens'); }
  var MAX_SAVED = 30;
  function needLogin() { V.openSheet('Sign in to save', '', '<p class="mv-sub">Saving needs an account. Share link works without one.</p>'); }
  function openSave() {
    if (!fbUser()) return needLogin();
    var sh = V.openSheet('Save this screen', 'Filters, columns and sort', '<form class="scn-form" novalidate><label>Name<input name="n" maxlength="60" placeholder="e.g. Gap up, liquid" autocomplete="off"></label><p class="scn-err" role="alert" hidden></p><div class="scn-act"><button type="submit" class="btn btn-primary">Save</button></div></form>');
    var f = sh.querySelector('form'), er = sh.querySelector('.scn-err');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = f.n.value.trim();
      if (!name) { er.hidden = false; er.textContent = 'Give the screen a name.'; return; }
      sCol().get().then(function (q) {
        if (q.size >= MAX_SAVED) { er.hidden = false; er.textContent = 'You can keep ' + MAX_SAVED + ' screens. Delete one first.'; return; }
        return sCol().add({ name: name.slice(0, 60), spec: C.encodeScreen(curScreen()), m: st.m, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).then(function () { V.closeSheet(); say('Screen saved'); });
      }).catch(function () { er.hidden = false; er.textContent = 'Could not save. Try again.'; });
    });
  }
  function openSaved() {
    if (!fbUser()) return needLogin();
    var sh = V.openSheet('My screens', '', '<p class="mv-sub">Loading…</p>'), body = sh.querySelector('.mv-sh-body');
    function list() {
      sCol().orderBy('updatedAt', 'desc').limit(MAX_SAVED).get().then(function (q) {
        if (!q.size) { body.innerHTML = '<p class="mv-sub">Nothing saved yet. Set filters, then tap Save screen.</p>'; return; }
        body.innerHTML = '<ul class="scn-sv">' + q.docs.map(function (d) {
          var x = d.data(); return '<li data-id="' + esc(d.id) + '"><button type="button" class="scn-sv-open" data-open>' + esc(x.name) + '<small>' + esc((MK.filter(function (m) { return m[0] === x.m; })[0] || [0, ''])[1]) + '</small></button><button type="button" class="scn-sv-b" data-ren>Rename</button><button type="button" class="scn-sv-b" data-del aria-label="Delete ' + esc(x.name) + '">Delete</button></li>';
        }).join('') + '</ul>';
        var byId = {}; q.docs.forEach(function (d) { byId[d.id] = d.data(); });
        body.querySelectorAll('li').forEach(function (li) {
          var id = li.getAttribute('data-id');
          li.querySelector('[data-open]').addEventListener('click', function () { var sc = C.decodeScreen(byId[id].spec); if (!sc) return say('This screen could not be opened'); V.closeSheet(); applyScreen(sc); });
          li.querySelector('[data-del]').addEventListener('click', function (e) {
            var b = e.currentTarget; if (b.getAttribute('data-sure') !== '1') { b.setAttribute('data-sure', '1'); b.textContent = 'Tap to confirm'; return; }
            sCol().doc(id).delete().then(list);
          });
          li.querySelector('[data-ren]').addEventListener('click', function () {
            var n = window.prompt('New name', byId[id].name); n = n && n.trim().slice(0, 60);
            if (n) sCol().doc(id).update({ name: n, spec: byId[id].spec, m: byId[id].m, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).then(list);
          });
        });
      }).catch(function () { body.innerHTML = '<p class="mv-sub">Could not load your screens. Try again.</p>'; });
    }
    list();
  }

  // ---- wiring ---------------------------------------------------------------------------------------------------------------------------
  function wire() {
    root.querySelectorAll('[data-m]').forEach(function (b) { b.addEventListener('click', function () { setMarket(b.getAttribute('data-m')); }); });
    root.querySelectorAll('[data-q]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-q'), p = C.presetById(id);
        st.q = st.q === id ? '' : id; st.sortK = null; if (st.q && p && p.set && !st.cols) st.setId = p.set; persist(); render();
      });
    });
    root.querySelectorAll('[data-set]').forEach(function (b) { b.addEventListener('click', function () { st.setId = b.getAttribute('data-set'); st.cols = null; persist(); render(); l2Sync(); gexSync(); }); });
    root.querySelectorAll('[data-fedit]').forEach(function (b) { b.addEventListener('click', function () { openFilter(Number(b.getAttribute('data-fedit'))); }); });
    root.querySelectorAll('[data-fdel]').forEach(function (b) { b.addEventListener('click', function () { st.flt.splice(Number(b.getAttribute('data-fdel')), 1); persist(); render(); }); });
    var add = root.querySelector('[data-fadd]');
    if (add) add.addEventListener('click', function () {
      if (st.q) { var p = preset(); st.flt = p ? p.flt.filter(function (x) { return x.f !== 'dv' && !(x.f === 'c' && x.v === 1); }) : []; st.q = ''; }
      openFilter(null);
    });
    root.querySelectorAll('[data-lock]').forEach(function (b) {
      b.addEventListener('click', function () {
        var why = b.getAttribute('data-lock') === 'gex' ? 'GEX levels in the screener are part of Pro.' : 'Order flow columns are part of Pro.';
        if (typeof window.openPlanUpgradeModal === 'function') window.openPlanUpgradeModal(why);
      });
    });
    var b1 = root.querySelector('[data-share]'); if (b1) b1.addEventListener('click', shareLink);
    var b2 = root.querySelector('[data-save]'); if (b2) b2.addEventListener('click', openSave);
    var b3 = root.querySelector('[data-saved]'); if (b3) b3.addEventListener('click', openSaved);
    var pk = root.querySelector('[data-pick]'); if (pk) pk.addEventListener('click', openCols);
    var se = root.querySelector('[data-search]');
    if (se) se.addEventListener('input', function () {
      clearTimeout(se._t);
      se._t = setTimeout(function () { st.search = se.value; var pos = se.selectionStart; render(); var n = root.querySelector('[data-search]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }, 250);
    });
  }
  function setMarket(m) {
    if (m === st.m) return;
    var ps = C.presetsFor(m);
    st.m = m; st.q = ps[0] ? ps[0].id : ''; st.flt = []; st.cols = null; st.setId = 'overview'; st.sortK = null; st.search = '';
    persist(); show();
  }
  function show() { render(); table(st.m).then(function () { render(); l2Sync(); gexSync(); }); }

  // ---- start ---------------------------------------------------------------------------------------------------------------------------------
  try {
    var sp = new URLSearchParams(location.search).get('s'), shared = sp && C.decodeScreen(sp);
    if (shared) { st.m = shared.m; st.q = ''; st.flt = shared.flt; st.cols = shared.cols; st.setId = shared.set || 'overview'; st.sortK = shared.sort ? shared.sort[0] : null; st.sortD = shared.sort ? shared.sort[1] : -1; }
  } catch (e) {}
  if (st.q && (!C.presetById(st.q) || C.presetById(st.q).m !== st.m)) st.q = '';
  if (L2) {
    L2.gate().then(function (ok) { if (ok !== st.l2) { st.l2 = ok; if (st.tables[st.m] && st.tables[st.m].rows) render(); l2Sync(); } });
    L2.onGate(function (ok) { if (ok !== st.l2) { st.l2 = ok; render(); l2Sync(); } });
  }
  if (typeof window.strykerPlanTier === 'function') {
    var pt = setTimeout(function () {}, 0);
    window.strykerPlanTier().then(function (r) {
      var free = !!(r && r.free && !r.admin);
      if (free !== st.free || free === st.pro) { st.free = free; st.pro = !free; if (st.tables[st.m] && st.tables[st.m].rows) render(); gexSync(); }
    }, function () {});
  }
  show();
  setInterval(function () {
    if (document.visibilityState === 'hidden') return;
    table(st.m).then(function () {
      var ae = document.activeElement;
      if ((ae && ae.closest && ae.closest('.scn-bar')) || document.querySelector('.mv-sheet-wrap')) return;
      var top = vp ? vp.scrollTop : 0; render(); if (vp) { vp.scrollTop = top; draw(); }
    });
  }, REFRESH_MS);
  setInterval(function () { var a = document.getElementById('scn-ago'), tb = st.tables[st.m]; if (a && tb) a.textContent = C.agoText(tb.t); }, 60000);
  window.__stkScn = st;
})();
