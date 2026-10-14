// TradeZoro — GEX page "Heatmap" tab: net GEX at every strike (y) through the session (x, one
// column per 2-min snapshot), with the spot price, call wall, put wall and zero-gamma traces.
// Owner-approved 2026-10-14 (inspired by dealer-positioning heatmaps; own design and palette).
//
// Depends on: assets/gex-heat-core.js (window.StrykerGexHeat: data, colour ramps, base image),
//             assets/gex.js (window.strykerGexState() + the 'stryker:gex-selection' event: the
//             market/expiry picked on the page, and the Free-plan limit), assets/plan-lock.js.
// Gating: the same as the rest of the GEX page. Free = SPX 0DTE; any other market/expiry is
// already refused by gex.js before it becomes the selection, and is re-checked here.
// History exists for 0DTE and 1DTE only (the feeder records those two).
// GEX replay: a time slider + play step through the day's snapshots; the map, traces, profile and
// the levels readout stop at the chosen snapshot (no lookahead).
// Wording: "updated X min ago" only (no "live"/"real-time"/"delayed"). Education only.
(function () {
  'use strict';
  var H = window.StrykerGexHeat;
  if (!H) return;
  var COL = { spot: '#f4f6fa', cw: '#ef4444', pw: '#22c55e', zg: '#f59e0b', grid: 'rgba(255,255,255,.06)', axis: '#8b949e', bg: '#07090b' };
  var AX_R = 58, AX_B = 22;    // right price axis / bottom time axis (CSS px)
  var st = { u: null, dte: null, day: null, days: [], rows: [], heat: null, pLo: 0, pHi: 0, hover: null, loadSeq: 0, active: false, timer: 0, until: null };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtK(k) { return k == null || !isFinite(k) ? '—' : Number(k).toLocaleString('en-US', { maximumFractionDigits: k > 2000 ? 0 : 1 }); }
  function fmtP(p) { return p == null || !isFinite(p) ? '—' : Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function state() { return typeof window.strykerGexState === 'function' ? window.strykerGexState() : { u: 'SPX', dte: 0, limit: null }; }
  function allowed(s) { return !s.limit || (s.limit.markets.indexOf(s.u) >= 0 && s.limit.dtes.indexOf(s.dte) >= 0); }

  // ---------- DOM ----------
  function mount() {
    var chartCard = document.querySelector('.gex-chart-card');
    if (!chartCard || $('gex-view-tabs')) return false;
    var tabs = document.createElement('div');
    tabs.id = 'gex-view-tabs'; tabs.className = 'gex-view-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'GEX view');
    tabs.innerHTML = '<button type="button" role="tab" class="gex-vtab is-on" data-view="chart" aria-selected="true">Chart</button>' +
      '<button type="button" role="tab" class="gex-vtab" data-view="heat" aria-selected="false">Heatmap</button>';
    chartCard.parentNode.insertBefore(tabs, chartCard);
    var card = document.createElement('section');
    card.id = 'gex-heat-card'; card.className = 'gex-card gex-heat-card'; card.hidden = true;
    card.innerHTML =
      '<div class="gex-chart-head gex-heat-head">' +
        '<h2 id="gex-heat-title">GEX heatmap</h2>' +
        '<div class="gex-heat-ctl">' +
          '<label class="gex-heat-day"><span>Day</span><select id="gex-heat-day" aria-label="Session day"></select></label>' +
          '<button type="button" class="gex-iv gex-zoom" id="gex-heat-in" aria-label="Zoom in">+</button>' +
          '<button type="button" class="gex-iv gex-zoom" id="gex-heat-out" aria-label="Zoom out">−</button>' +
          '<button type="button" class="gex-iv gex-zoom" id="gex-heat-reset">Reset</button>' +
        '</div>' +
      '</div>' +
      '<div class="gex-heat-status" id="gex-heat-status" role="status">Loading GEX history…</div>' +
      '<div class="gex-heat-wrap" id="gex-heat-wrap"><canvas id="gex-heat-canvas" aria-label="GEX heatmap: strikes by time"></canvas>' +
        '<div class="gex-heat-tip" id="gex-heat-tip" hidden></div><div class="gex-heat-empty" id="gex-heat-empty" hidden></div></div>' +
      '<div class="gex-heat-replay" id="gex-heat-replay">' +
        '<button type="button" class="gex-iv gex-heat-play" id="gex-heat-play" aria-label="Play the session">▶</button>' +
        '<input type="range" id="gex-heat-slider" min="0" max="0" value="0" step="1" aria-label="Snapshot time">' +
        '<span class="gex-heat-time" id="gex-heat-time">—</span>' +
      '</div>' +
      '<div class="gex-heat-read" id="gex-heat-read" aria-live="polite"></div>' +
      '<div class="gex-heat-legend">' +
        '<span class="gex-heat-scale"><i class="neg"></i><em>Negative GEX</em><i class="pos"></i><em>Positive GEX</em></span>' +
        '<span><i style="background:' + COL.spot + '"></i>Spot</span><span><i style="background:' + COL.cw + '"></i>Call wall</span>' +
        '<span><i style="background:' + COL.pw + '"></i>Put wall</span><span><i style="background:' + COL.zg + '"></i>Zero gamma</span>' +
      '</div>' +
      '<p class="gex-edu">Net GEX per strike from the options chain, one column per 2-minute snapshot (Cboe chain time, ET). Model estimate. Education only. Not financial advice.</p>';
    chartCard.parentNode.insertBefore(card, chartCard.nextSibling);
    tabs.addEventListener('click', function (e) { var b = e.target.closest('[data-view]'); if (b) show(b.getAttribute('data-view')); });
    $('gex-heat-day').addEventListener('change', function () { st.day = this.value; loadDay(true); });
    $('gex-heat-in').onclick = function () { zoom(0.7); };
    $('gex-heat-out').onclick = function () { zoom(1.4); };
    $('gex-heat-reset').onclick = function () { fitView(); paint(); };
    wireGestures($('gex-heat-wrap'));
    $('gex-heat-slider').addEventListener('input', function () { var v = +this.value; pause(); seek(v); });
    $('gex-heat-play').onclick = function () { if (st.playing) pause(); else play(); };
    window.addEventListener('resize', function () { if (st.active) paint(); }, { passive: true });
    window.addEventListener('stryker:gex-selection', function () { if (st.active) select(); });
    return true;
  }

  function show(view) {
    var heat = view === 'heat';
    st.active = heat;
    document.querySelectorAll('.gex-vtab').forEach(function (b) { var on = b.getAttribute('data-view') === view; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    var chartCard = document.querySelector('.gex-chart-card');
    if (chartCard) chartCard.hidden = heat;
    $('gex-heat-card').hidden = !heat;
    try { history.replaceState(null, '', heat ? '#heatmap' : location.pathname + location.search); } catch (e) {}
    if (heat) select(); else { stopTimer(); pause(); }
  }

  function setStatus(html) { $('gex-heat-status').innerHTML = html; }
  function setEmpty(msg) { var e = $('gex-heat-empty'); if (msg) { e.hidden = false; e.innerHTML = msg; } else { e.hidden = true; e.innerHTML = ''; } }

  // ---------- data ----------
  function select() {
    var s = state();
    var lockHost = $('gex-heat-lock');
    if (lockHost) lockHost.remove();
    if (!allowed(s)) {
      st.rows = []; st.heat = null; paint();
      setStatus('');
      var div = document.createElement('div'); div.id = 'gex-heat-lock';
      if (window.strykerPlanLock) div.appendChild(window.strykerPlanLock.card('gex', 'gex-heatmap'));
      else div.innerHTML = '<p class="gex-empty">Pro unlocks the GEX heatmap for every market and expiry. The Free plan covers SPX, 0DTE.</p>';
      $('gex-heat-status').appendChild(div);
      return;
    }
    $('gex-heat-title').textContent = s.u + ' · ' + (s.dte ? '1DTE' : '0DTE') + ' · GEX HEATMAP';
    if (s.dte !== 0 && s.dte !== 1) {
      st.u = s.u; st.dte = s.dte; st.rows = []; st.heat = null; paint();
      setStatus('');
      setEmpty('GEX history is recorded for the 0DTE and 1DTE views. Pick 0DTE or 1DTE above to see the heatmap.');
      return;
    }
    if (st.u === s.u && st.dte === s.dte && st.days.length) { loadDay(false); return; }
    st.u = s.u; st.dte = s.dte; st.day = null; st.days = []; pause(); st.until = null;
    loadSessions();
  }

  function loadSessions() {
    var seq = ++st.loadSeq;
    setStatus('Loading recorded sessions…'); setEmpty('');
    H.sessions(st.u, st.dte).then(function (days) {
      if (seq !== st.loadSeq) return;
      st.days = days || [];
      var sel = $('gex-heat-day');
      var today = H.etDay(Date.now() / 1000);
      sel.innerHTML = st.days.map(function (d) {
        var lbl = new Date(d.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
        return '<option value="' + esc(d.day) + '">' + esc(lbl + (d.day === today ? ' (today)' : '')) + '</option>';
      }).join('');
      if (!st.days.length) {
        st.rows = []; st.heat = null; paint(); setStatus('');
        setEmpty('No GEX history recorded yet for ' + esc(st.u) + ' ' + (st.dte ? '1DTE' : '0DTE') + '. Snapshots are recorded every 2 minutes during the US cash session.');
        return;
      }
      if (!st.day || !st.days.some(function (d) { return d.day === st.day; })) st.day = st.days[0].day;
      sel.value = st.day;
      loadDay(true);
    }).catch(function (e) { if (seq === st.loadSeq) { setStatus(''); setEmpty('GEX history could not be loaded (' + esc(e.message) + ').'); } });
  }

  function loadDay(refit) {
    var seq = ++st.loadSeq, day = st.day;
    var w = H.sessionWindow(day);
    if (refit) setStatus('Loading ' + esc(day) + '…');
    H.history(st.u, st.dte, w.x0 - 3600, w.x1).then(function (rows) {
      if (seq !== st.loadSeq) return;
      rows = rows.filter(function (r) { return r.day === day; });
      st.rows = rows;
      st.heat = rows.length ? H.build(rows, { x0: w.x0, x1: w.x1, until: st.until == null ? undefined : st.until }) : null;
      if (st.heat && st.until != null) { var full = H.build(rows, { x0: w.x0, x1: w.x1 }); st.heat = H.build(rows, { x0: w.x0, x1: w.x1, until: st.until, vmax: full.vmax }); }
      if (refit || !(st.pHi > st.pLo)) fitView();
      setEmpty(rows.length ? '' : 'No snapshots for this day.');
      if (refit) { pause(); st.until = null; st.heat = rows.length ? H.build(rows, { x0: w.x0, x1: w.x1 }) : null; }
      st.vmax = st.heat ? st.heat.vmax : null;
      statusLine();
      paint();
      replayUi();
      armTimer();
      window.dispatchEvent(new CustomEvent('stryker:gex-heat-loaded', { detail: { u: st.u, dte: st.dte, day: day, n: rows.length } }));
    }).catch(function (e) { if (seq === st.loadSeq) { setStatus(''); setEmpty('GEX history could not be loaded (' + esc(e.message) + ').'); } });
  }

  function statusLine() {
    var r = st.rows, last = r[r.length - 1];
    if (!last) { setStatus(''); return; }
    var mins = Math.max(0, Math.round((Date.now() / 1000 - (last.fa || last.t)) / 60));
    var today = st.day === H.etDay(Date.now() / 1000);
    setStatus('<b>' + r.length + ' snapshots</b> · ' + esc(H.etClock(r[0].t)) + ' – ' + esc(H.etClock(last.t)) + ' ET · expiry ' + esc(last.x) +
      (today ? ' · updated ' + mins + ' min ago' : ''));
  }

  // today's session refreshes every 2 min while the tab is open
  function armTimer() {
    stopTimer();
    if (!st.active || st.day !== H.etDay(Date.now() / 1000) || st.playing) return;
    st.timer = setTimeout(function () { H._cache.clear(); loadDay(false); }, 120000);
  }
  function stopTimer() { if (st.timer) { clearTimeout(st.timer); st.timer = 0; } }

  // ---------- view ----------
  function fitView() {
    var r = st.rows;
    if (!r.length) { st.pLo = st.pHi = 0; return; }
    // the day's spot range plus the walls, padded, inside the recorded strikes
    var lo = Infinity, hi = -Infinity;
    r.forEach(function (x) { [x.s, x.cw, x.pw].forEach(function (v) { if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    var pad = Math.max((hi - lo) * 0.35, r[r.length - 1].s * 0.004);
    st.pLo = Math.max(st.heat ? st.heat.kMin : lo - pad, lo - pad);
    st.pHi = Math.min(st.heat ? st.heat.kTop : hi + pad, hi + pad);
  }
  function zoom(f, centerP) {
    if (!(st.pHi > st.pLo)) return;
    var c = centerP != null ? centerP : (st.pLo + st.pHi) / 2, span = (st.pHi - st.pLo) * f;
    var minSpan = st.heat ? st.heat.step * 6 : 1, maxSpan = st.heat ? (st.heat.kTop - st.heat.kMin) * 1.1 : span;
    span = Math.max(minSpan, Math.min(maxSpan, span));
    var t = (c - st.pLo) / (st.pHi - st.pLo);
    st.pLo = c - span * t; st.pHi = st.pLo + span;
    paint();
  }
  function pan(dp) { st.pLo += dp; st.pHi += dp; paint(); }

  function geom() {
    var cv = $('gex-heat-canvas'), wrap = $('gex-heat-wrap');
    var w = wrap.clientWidth, h = wrap.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
    var w0 = H.sessionWindow(st.day || H.etDay(Date.now() / 1000));
    var pw = Math.max(10, w - AX_R), ph = Math.max(10, h - AX_B);
    return {
      cv: cv, dpr: dpr, w: w, h: h, pw: pw, ph: ph, x0: w0.x0, x1: w0.x1,
      xOf: function (t) { return (t - w0.x0) / (w0.x1 - w0.x0) * pw; },
      tOf: function (x) { return w0.x0 + x / pw * (w0.x1 - w0.x0); },
      yOf: function (p) { return (st.pHi - p) / (st.pHi - st.pLo) * ph; },
      pOf: function (y) { return st.pHi - y / ph * (st.pHi - st.pLo); }
    };
  }

  function niceStep(span, n) {
    var raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }

  function paint() {
    var cv = $('gex-heat-canvas');
    if (!cv || $('gex-heat-card').hidden) return;
    var g = geom(), ctx = cv.getContext('2d');
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, g.w, g.h);
    if (!st.heat || !(st.pHi > st.pLo)) { cv.dataset.cells = '0'; return; }
    var t0 = performance.now();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, g.pw, g.ph); ctx.clip();
    H.draw(ctx, st.heat, g.xOf, g.yOf, { linearX: true });
    // grid
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    var ps = niceStep(st.pHi - st.pLo, Math.max(3, Math.round(g.ph / 48)));
    ctx.beginPath();
    for (var p = Math.ceil(st.pLo / ps) * ps; p <= st.pHi; p += ps) { var y = Math.round(g.yOf(p)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(g.pw, y); }
    var hours = [];
    for (var hh = 10; hh <= 16; hh++) { var tx = H.etEpoch(st.day, hh, 0); hours.push(tx); var x = Math.round(g.xOf(tx)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, g.ph); }
    ctx.stroke();
    profile(ctx, g);
    // traces (a dark under-stroke keeps them readable over bright cells)
    trace(ctx, g, 'zg', COL.zg, [5, 4]);
    trace(ctx, g, 'pw', COL.pw, null, true);
    trace(ctx, g, 'cw', COL.cw, null, true);
    trace(ctx, g, 's', COL.spot, null);
    if (st.hover) {
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(st.hover.x + 0.5, 0); ctx.lineTo(st.hover.x + 0.5, g.ph); ctx.moveTo(0, st.hover.y + 0.5); ctx.lineTo(g.pw, st.hover.y + 0.5); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    // axes
    ctx.fillStyle = COL.bg; ctx.fillRect(g.pw, 0, AX_R, g.h); ctx.fillRect(0, g.ph, g.w, AX_B);
    ctx.fillStyle = COL.axis; ctx.font = '10px ui-monospace,SFMono-Regular,Menlo,monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (p = Math.ceil(st.pLo / ps) * ps; p <= st.pHi; p += ps) { var yy = g.yOf(p); if (yy > 6 && yy < g.ph - 6) ctx.fillText(fmtK(p), g.pw + 6, yy); }
    var last = st.rows.filter(function (r) { return st.until == null || r.t <= st.until; }).pop();
    if (last) {
      var ly = g.yOf(last.s);
      if (ly > 0 && ly < g.ph) { ctx.fillStyle = COL.spot; ctx.fillRect(g.pw + 1, ly - 8, AX_R - 2, 16); ctx.fillStyle = '#050608'; ctx.fillText(fmtP(last.s), g.pw + 4, ly); }
    }
    ctx.fillStyle = COL.axis; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var every = g.pw < 420 ? 2 : 1;
    hours.forEach(function (tx, i) { if (i % every) return; var x = g.xOf(tx); if (x > 14 && x < g.pw - 14) ctx.fillText(H.etClock(tx).replace(':00', '').replace(' ', ''), x, g.ph + 5); });
    cv.dataset.ms = (performance.now() - t0).toFixed(2);
    cv.dataset.cells = String(st.heat.cols * st.heat.rowsN);
  }

  // the snapshot shown: the one at the slider, else the newest
  function current() {
    var r = st.rows;
    if (!r.length) return null;
    return st.until == null ? r[r.length - 1] : H.at(r, st.until);
  }
  // GEX profile of the current snapshot: horizontal bars at the right edge of the plot (net GEX
  // per strike, the same colour ramp), so each moment shows its levels AND its profile.
  function profile(ctx, g) {
    var c = current();
    if (!c || !st.heat) return;
    var W = Math.min(110, Math.max(54, g.pw * 0.16)), x0 = g.pw - W - 4;
    var mx = 0;
    c.k.forEach(function (k, j) { if (k >= st.pLo && k <= st.pHi) mx = Math.max(mx, Math.abs(c.g[j])); });
    if (!(mx > 0)) return;
    ctx.fillStyle = 'rgba(5,6,8,.72)'; ctx.fillRect(x0 - 4, 0, W + 8, g.ph);
    var mid = x0 + W / 2;
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(mid) + 0.5, 0); ctx.lineTo(Math.round(mid) + 0.5, g.ph); ctx.stroke();
    var rowH = Math.max(1, Math.abs(g.yOf(0) - g.yOf(st.heat.step)) - 1);
    c.k.forEach(function (k, j) {
      if (k < st.pLo || k > st.pHi) return;
      var v = c.g[j], len = Math.abs(v) / mx * (W / 2), y = g.yOf(k);
      var col = H.color(v, st.heat.vmax, false);
      ctx.fillStyle = 'rgb(' + Math.max(col[0], 40) + ',' + Math.max(col[1], 40) + ',' + Math.max(col[2], 40) + ')';
      if (v >= 0) ctx.fillRect(mid, y - rowH / 2, len, rowH); else ctx.fillRect(mid - len, y - rowH / 2, len, rowH);
    });
    ctx.fillStyle = 'rgba(201,209,217,.75)'; ctx.font = '9px ui-monospace,SFMono-Regular,Menlo,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('PROFILE', mid, 4);
  }

  // ---------- GEX replay: time slider + play (no lookahead: the map stops at the slider) ----------
  st.playing = false; st.playTm = 0;
  function replayUi() {
    var r = st.rows, sl = $('gex-heat-slider'), bar = $('gex-heat-replay');
    if (!sl) return;
    bar.hidden = !r.length;
    var n = Math.max(0, r.length - 1);
    sl.max = String(n);
    var i = st.until == null ? n : Math.max(0, r.indexOf(H.at(r, st.until)));
    sl.value = String(i);
    sl.style.setProperty('--fill', (n ? i / n * 100 : 100) + '%');
    var c = current();
    $('gex-heat-time').textContent = c ? H.etClock(c.t) + ' ET' + (st.until == null ? ' · latest' : ' · ' + (i + 1) + '/' + r.length) : '—';
    $('gex-heat-play').textContent = st.playing ? '❚❚' : '▶';
    $('gex-heat-play').setAttribute('aria-label', st.playing ? 'Pause' : 'Play the session');
    var rd = $('gex-heat-read');
    if (!c) { rd.innerHTML = ''; return; }
    var em = Array.isArray(c.em) && c.em[1] != null ? c.em : null;
    var item = function (lbl, val, cls) { return '<span' + (cls ? ' class="' + cls + '"' : '') + '><em>' + lbl + '</em>' + esc(val) + '</span>'; };
    rd.innerHTML = item('Spot', fmtP(c.s)) + item('Call wall', fmtK(c.cw), 'cw') + item('Put wall', fmtK(c.pw), 'pw') + item('Zero gamma', fmtK(c.zg), 'zg') +
      item('Net GEX', H.money(c.n), c.n >= 0 ? 'pos' : 'neg') + (em ? item('Range 68%', fmtK(em[0] - em[1]) + ' – ' + fmtK(em[0] + em[1])) : '');
  }
  function seek(i) {
    var r = st.rows;
    if (!r.length) return;
    i = Math.max(0, Math.min(r.length - 1, i | 0));
    setUntil(i >= r.length - 1 && !st.playing ? null : r[i].t);
  }
  function play() {
    var r = st.rows;
    if (!r.length) return;
    st.playing = true; stopTimer();
    var i = st.until == null ? 0 : r.indexOf(H.at(r, st.until));
    if (i >= r.length - 1) i = 0;
    seek(i);
    var step = function () {
      if (!st.playing) return;
      var j = r.indexOf(H.at(r, st.until)) + 1;
      if (j >= r.length) { pause(); setUntil(null); armTimer(); return; }
      seek(j);
      st.playTm = setTimeout(step, 220);
    };
    st.playTm = setTimeout(step, 220);
    replayUi();
  }
  function pause() { st.playing = false; if (st.playTm) { clearTimeout(st.playTm); st.playTm = 0; } if ($('gex-heat-play')) replayUi(); }

  function trace(ctx, g, key, color, dash, stepped) {
    var pts = [];
    st.rows.forEach(function (r) { if (st.until != null && r.t > st.until) return; var v = r[key]; if (v != null && isFinite(v)) pts.push([g.xOf(r.t), g.yOf(v)]); else pts.push(null); });
    if (!pts.length) return;
    var slotW = g.xOf(g.x0 + H.SLOT) - g.xOf(g.x0);
    function path() {
      ctx.beginPath(); var pen = false, prev = null;
      pts.forEach(function (pt) {
        if (!pt) { pen = false; return; }
        if (!pen) { ctx.moveTo(pt[0], pt[1]); pen = true; }
        else if (stepped) { ctx.lineTo(pt[0], prev[1]); ctx.lineTo(pt[0], pt[1]); }
        else ctx.lineTo(pt[0], pt[1]);
        prev = pt;
      });
      if (prev) ctx.lineTo(prev[0] + slotW, prev[1]);
    }
    ctx.setLineDash(dash || []);
    ctx.lineJoin = 'round';
    path(); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = key === 's' ? 4 : 3.5; ctx.stroke();
    path(); ctx.strokeStyle = color; ctx.lineWidth = key === 's' ? 2 : 1.6; ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---------- hover / tap tooltip ----------
  function tipAt(x, y) {
    var g = geom(), tip = $('gex-heat-tip');
    if (!st.heat || x < 0 || y < 0 || x > g.pw || y > g.ph) { st.hover = null; tip.hidden = true; paint(); return; }
    var t = g.tOf(x), p = g.pOf(y);
    var c = H.cellAt(st.heat, t, p);
    st.hover = { x: x, y: y };
    paint();
    if (!c) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.innerHTML = '<b>' + esc(fmtK(c.strike)) + '</b> <span>' + esc(H.etClock(c.snap.t)) + ' ET</span>' +
      '<div class="' + (c.value >= 0 ? 'pos' : 'neg') + '">Net GEX ' + esc(H.money(c.value)) + '</div>' +
      '<small>Spot ' + esc(fmtP(c.snap.s)) + ' · CW ' + esc(fmtK(c.snap.cw)) + ' · PW ' + esc(fmtK(c.snap.pw)) + ' · ZG ' + esc(fmtK(c.snap.zg)) + '</small>';
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var lx = x + 14 + tw > g.pw ? x - 14 - tw : x + 14, ly = y + 14 + th > g.ph ? y - 14 - th : y + 14;
    tip.style.left = Math.max(2, lx) + 'px'; tip.style.top = Math.max(2, ly) + 'px';
  }

  function wireGestures(wrap) {
    var drag = null, pinch = null, moved = false;
    function local(e) { var r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    wrap.addEventListener('mousemove', function (e) {
      var p = local(e);
      if (drag) { var g = geom(); pan((p[1] - drag) / g.ph * (st.pHi - st.pLo)); drag = p[1]; return; }
      tipAt(p[0], p[1]);
    });
    wrap.addEventListener('mouseleave', function () { drag = null; st.hover = null; $('gex-heat-tip').hidden = true; paint(); });
    wrap.addEventListener('mousedown', function (e) { drag = local(e)[1]; e.preventDefault(); });
    window.addEventListener('mouseup', function () { drag = null; });
    wrap.addEventListener('wheel', function (e) { if (!st.heat) return; e.preventDefault(); var g = geom(); zoom(e.deltaY > 0 ? 1.15 : 0.87, g.pOf(local(e)[1])); }, { passive: false });
    // touch: one finger drags the price axis (vertical) or the tooltip (tap / horizontal scrub);
    // two fingers pinch-zoom the price axis. Page scroll keeps working outside the chart.
    var start = null;
    wrap.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) { var a = e.touches[0], b = e.touches[1]; pinch = { d: Math.abs(a.clientY - b.clientY) || 1, c: (a.clientY + b.clientY) / 2 }; start = null; e.preventDefault(); return; }
      var t = e.touches[0]; start = { x: t.clientX, y: t.clientY, mode: null }; moved = false;
    }, { passive: false });
    wrap.addEventListener('touchmove', function (e) {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        var a = e.touches[0], b = e.touches[1], d = Math.abs(a.clientY - b.clientY) || 1;
        var r = wrap.getBoundingClientRect(), g = geom();
        zoom(pinch.d / d, g.pOf(pinch.c - r.top)); pinch.d = d; return;
      }
      if (!start) return;
      var t = e.touches[0], dx = t.clientX - start.x, dy = t.clientY - start.y;
      if (!start.mode && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) start.mode = Math.abs(dx) > Math.abs(dy) ? 'scrub' : 'pan';
      if (start.mode) { e.preventDefault(); moved = true; }
      var p = local(t);
      if (start.mode === 'scrub') tipAt(p[0], p[1]);
      else if (start.mode === 'pan') { var g2 = geom(); pan(dy / g2.ph * (st.pHi - st.pLo)); start.y = t.clientY; start.x = t.clientX; }
    }, { passive: false });
    wrap.addEventListener('touchend', function (e) {
      if (start && !moved && e.changedTouches.length) { var p = local(e.changedTouches[0]); tipAt(p[0], p[1]); }
      start = null; if (e.touches.length < 2) pinch = null;
    }, { passive: true });
  }

  // replay hook (GEX replay step): show the session only up to `ts` (no lookahead), null = all
  function setUntil(ts) {
    st.until = ts == null ? null : ts;
    if (st.rows.length) { var w = H.sessionWindow(st.day); st.heat = H.build(st.rows, { x0: w.x0, x1: w.x1, until: st.until == null ? undefined : st.until, vmax: st.vmax }); }
    paint();
    replayUi();
  }

  window.strykerGexHeatmap = { show: show, state: st, setUntil: setUntil, paint: paint, seek: seek, play: play, pause: pause, current: current };

  function boot() { if (mount() && /heatmap/.test(location.hash)) show('heat'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
