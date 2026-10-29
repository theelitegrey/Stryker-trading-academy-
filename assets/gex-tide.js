// TradeZoro — GEX+ page "ZoroTide" tab: options money flow, calls vs puts (classic script, no imports).
// Owner order 2026-10-29. Depends on: the book-recorder Worker GET /tide?u=SPX|SPY|QQQ&days=N (workers/book-recorder/
// src/tide.js; samples built by gex-feeder/tide.py from the Cboe chains we already pull); assets/gex.js
// (window.strykerGexState() + the 'stryker:gex-selection' event: the market picked on the page and the Free limit);
// assets/gex-heatmap.js (creates #gex-view-tabs, which this file adds a third tab to); assets/plan-lock.js (optional).
//
// WHAT IT SHOWS: the running (since 9:30 ET) net call premium (green) and net put premium (red) for the picked day,
// the underlying price (thin line, right axis), today's totals and the call/put ratio. Tap or hover for the values at a time.
// METHOD (also in the help text below): every sample, new volume = volume now - volume at the previous sample per
// contract; premium = new volume x price x 100 (last trade, else mid); side: last trade in the top 25 % of the
// bid-ask spread = bought, bottom 25 % = sold, in between = split half and half. Net = bought - sold.
// PLAN: same split as the rest of GEX+: SPX free, SPY and QQQ Pro (client-side, like the heatmap).
// WORDING: "Estimated from options volume and quotes. Updated X min ago." Never live / real-time / delayed.
// Education only. Not financial advice.
(function () {
  'use strict';
  var API = 'https://book-recorder.theelitegrey.workers.dev/tide?days=6&u=';
  var MKTS = ['SPX', 'SPY', 'QQQ'];
  var COL = { call: '#22c55e', put: '#ef4444', px: '#c9d1d9', grid: 'rgba(255,255,255,.07)', axis: '#8b949e', bg: '#07090b' };
  var AX_L = 54, AX_R = 54, AX_B = 22, AX_T = 8;
  var OPEN_MIN = 9 * 60 + 30, CLOSE_MIN = 16 * 60;
  var st = { u: null, day: null, data: null, active: false, timer: 0, ago: 0, seq: 0, hover: null, cache: {} };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fin(x) { return typeof x === 'number' && isFinite(x); }

  // ---------- pure maths (mirrored in assets/zorotide-core.js, parity-tested) ----------
  function cumulate(d) {
    var n = d.t.length, cn = new Array(n), pn = new Array(n), cp = new Array(n), pp = new Array(n), a = 0, b = 0, c = 0, e = 0;
    for (var i = 0; i < n; i++) { a += d.cn[i]; b += d.pn[i]; c += d.cp[i]; e += d.pp[i]; cn[i] = a; pn[i] = b; cp[i] = c; pp[i] = e; }
    return { t: d.t, s: d.s, cn: cn, pn: pn, cp: cp, pp: pp };
  }
  function money(v, signed) {
    if (!fin(v)) return '–';
    var a = Math.abs(v), s = v < 0 ? '−' : (signed ? '+' : '');
    var x = a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(0);
    return s + '$' + x;
  }
  function ratio(c, p) { return fin(c) && fin(p) && p > 0 ? c / p : null; }
  function etParts(sec) {
    var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(sec * 1000)), o = {};
    f.forEach(function (p) { o[p.type] = p.value; });
    return { day: o.year + '-' + o.month + '-' + o.day, min: (+o.hour % 24) * 60 + (+o.minute) };
  }
  function hhmm(min) { var h = Math.floor(min / 60), m = min % 60; return h + ':' + (m < 10 ? '0' : '') + m; }
  function agoText(tsSec) {
    if (!fin(tsSec)) return '';
    var m = Math.max(0, Math.floor((Date.now() / 1000 - tsSec) / 60));
    if (m < 1) return 'Updated just now.';
    if (m < 60) return 'Updated ' + m + ' min ago.';
    var h = Math.floor(m / 60);
    return h < 24 ? 'Updated ' + h + ' h ago.' : 'Updated ' + Math.floor(h / 24) + ' days ago.';
  }
  function state() { return typeof window.strykerGexState === 'function' ? window.strykerGexState() : { u: 'SPX', limit: null }; }
  function allowed(s) { return !s.limit || s.limit.markets.indexOf(s.u) >= 0; }

  // ---------- DOM ----------
  function mount() {
    var tabs = $('gex-view-tabs'), chartCard = document.querySelector('.gex-chart-card');
    if (!tabs || !chartCard || $('gex-tide-card')) return !!$('gex-tide-card');
    var btn = document.createElement('button');
    btn.type = 'button'; btn.setAttribute('role', 'tab'); btn.className = 'gex-vtab'; btn.setAttribute('data-view', 'tide'); btn.setAttribute('aria-selected', 'false'); btn.textContent = 'ZoroTide';
    tabs.appendChild(btn);
    var card = document.createElement('section');
    card.id = 'gex-tide-card'; card.className = 'gex-card gex-tide-card'; card.hidden = true;
    card.innerHTML =
      '<div class="gex-chart-head gex-tide-head"><div><h2 id="gex-tide-title">ZoroTide</h2><p class="gex-tide-sub">Options money flow: calls vs puts</p></div>' +
        '<label class="gex-heat-day"><span>Day</span><select id="gex-tide-day" aria-label="Session day"></select></label></div>' +
      '<div class="gex-tide-totals" id="gex-tide-totals" aria-live="polite"></div>' +
      '<div class="gex-heat-status" id="gex-tide-status" role="status">Loading ZoroTide…</div>' +
      '<div class="gex-tide-wrap" id="gex-tide-wrap"><canvas id="gex-tide-canvas" aria-label="ZoroTide: cumulative net call and put premium since the open"></canvas>' +
        '<div class="gex-heat-tip gex-tide-tip" id="gex-tide-tip" hidden></div><div class="gex-heat-empty" id="gex-tide-empty" hidden></div></div>' +
      '<div class="gex-heat-legend"><span><i style="background:' + COL.call + '"></i>Net call premium</span><span><i style="background:' + COL.put + '"></i>Net put premium</span><span><i style="background:' + COL.px + '"></i>Price (right axis)</span></div>' +
      '<details class="gex-tide-help"><summary>How ZoroTide is estimated</summary>' +
        '<p>Every sample (about once a minute, from the Cboe options chain), for each option contract: <b>new volume</b> = volume now − volume at the previous sample (the count starts fresh at the 9:30 ET open; a drop is ignored).</p>' +
        '<p><b>Premium</b> = new volume × price × 100, using the contract’s last trade price (the mid of bid and ask if there was none).</p>' +
        '<p><b>Side:</b> a last trade in the top 25% of the bid-ask spread counts as <b>bought</b>, in the bottom 25% as <b>sold</b>, anything in between is split half and half. Calls bought add to the call line, calls sold subtract; the put line works the same way. <b>Net call premium</b> = calls bought − calls sold. <b>Net put premium</b> = puts bought − puts sold. The lines add the samples up since 9:30 ET.</p>' +
        '<p><b>Call/put ratio</b> = all call premium traded ÷ all put premium traded since the open. Rising green with a flat red means more money is going into calls; it is a read of the options crowd’s mood, not a forecast.</p>' +
        '<p>The tape does not say who the buyer or seller was, so this is an estimate. The options chain is not tick-by-tick: the numbers can differ from other tools.</p></details>' +
      '<p class="gex-edu">Estimated from options volume and quotes. Education only. Not financial advice.</p>';
    chartCard.parentNode.insertBefore(card, chartCard.nextSibling);
    tabs.addEventListener('click', function (e) { var b = e.target.closest('[data-view]'); if (b) show(b.getAttribute('data-view') === 'tide'); });
    $('gex-tide-day').addEventListener('change', function () { st.day = this.value; st.hover = null; render(); });
    window.addEventListener('resize', function () { if (st.active) paint(); }, { passive: true });
    window.addEventListener('stryker:gex-selection', function () { if (st.active) select(); });
    wire($('gex-tide-wrap'));
    return true;
  }

  function show(on) {
    st.active = on;
    var heatCard = $('gex-heat-card'), chartCard = document.querySelector('.gex-chart-card'), card = $('gex-tide-card');
    // gex-heatmap.js handles Chart / Heatmap first (it treats data-view="tide" as "not heat"); this takes over from there
    document.querySelectorAll('.gex-vtab').forEach(function (b) { var is = on && b.getAttribute('data-view') === 'tide'; if (on) { b.classList.toggle('is-on', is); b.setAttribute('aria-selected', is ? 'true' : 'false'); } });
    if (on) {
      if (chartCard) chartCard.hidden = true;
      if (heatCard) heatCard.hidden = true;
      card.hidden = false;
      try { history.replaceState(null, '', '#zorotide'); } catch (e) {}
      select();
      startTimer();
    } else { card.hidden = true; stopTimer(); }
  }

  function setStatus(html) { $('gex-tide-status').innerHTML = html; }
  function setEmpty(msg) { var e = $('gex-tide-empty'); if (msg) { e.hidden = false; e.innerHTML = msg; } else { e.hidden = true; e.innerHTML = ''; } }

  // ---------- data ----------
  function select() {
    var s = state(), lock = $('gex-tide-lock');
    if (lock) lock.remove();
    st.hover = null;
    if (MKTS.indexOf(s.u) < 0) {
      st.u = s.u; st.data = null; paint(); totals(null); setStatus('');
      setEmpty('ZoroTide covers SPX, SPY and QQQ. Pick one of them above.');
      $('gex-tide-title').textContent = 'ZoroTide';
      return;
    }
    $('gex-tide-title').textContent = s.u + ' · ZoroTide';
    if (!allowed(s)) {
      st.u = s.u; st.data = null; paint(); totals(null);
      setStatus(''); setEmpty('');
      var div = document.createElement('div'); div.id = 'gex-tide-lock';
      if (window.strykerPlanLock) div.appendChild(window.strykerPlanLock.card('gex', 'gex-zorotide'));
      else div.innerHTML = '<p class="gex-empty">Pro unlocks ZoroTide for SPY and QQQ. The Free plan covers SPX.</p>';
      $('gex-tide-status').appendChild(div);
      return;
    }
    if (st.u !== s.u) { st.u = s.u; st.day = null; st.data = null; }
    load();
  }

  function load() {
    var seq = ++st.seq, u = st.u;
    setEmpty(''); if (!st.data) setStatus('Loading ZoroTide…');
    fetch(API + u, { headers: { accept: 'application/json' } }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      if (seq !== st.seq || !st.active) return;
      st.data = j; setDays(); render();
    }).catch(function () {
      if (seq !== st.seq) return;
      if (!st.data) { totals(null); paint(); setStatus(''); setEmpty('ZoroTide could not be loaded. Try again in a minute.'); }
    });
  }

  function setDays() {
    var days = (st.data && st.data.days) || [], sel = $('gex-tide-day'), today = etParts(Date.now() / 1000).day;
    sel.innerHTML = days.map(function (d) {
      var lbl = new Date(d.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      return '<option value="' + esc(d.day) + '">' + esc(lbl + (d.day === today ? ' (today)' : '')) + '</option>';
    }).join('');
    if (!st.day || !days.some(function (d) { return d.day === st.day; })) st.day = days.length ? days[0].day : null;
    sel.value = st.day || '';
  }

  function current() {
    var days = (st.data && st.data.days) || [];
    for (var i = 0; i < days.length; i++) if (days[i].day === st.day) return days[i];
    return null;
  }

  function render() {
    var d = current();
    if (!d || !d.t.length) {
      totals(null); st.cum = null; paint();
      setStatus('');
      setEmpty('No ZoroTide samples recorded yet for ' + esc(st.u) + '. They are recorded about once a minute during the US cash session, starting with the 9:30 ET open.');
      return;
    }
    setEmpty('');
    st.cum = cumulate(d);
    var n = d.t.length, last = d.t[n - 1];
    totals({ cn: st.cum.cn[n - 1], pn: st.cum.pn[n - 1], cp: st.cum.cp[n - 1], pp: st.cum.pp[n - 1] });
    stamp(last);
    paint();
  }
  function stamp(last) {
    var isToday = st.day === etParts(Date.now() / 1000).day;
    setStatus('Estimated from options volume and quotes. ' + (isToday ? agoText(last) : 'Session of ' + esc(st.day) + '.'));
    st.last = last;
  }

  function totals(t) {
    var el = $('gex-tide-totals');
    if (!t) { el.innerHTML = ''; return; }
    var r = ratio(t.cp, t.pp);
    el.innerHTML =
      '<div class="gex-tide-stat call"><em>Net call premium</em><b>' + money(t.cn, true) + '</b><small>' + money(t.cp) + ' traded</small></div>' +
      '<div class="gex-tide-stat put"><em>Net put premium</em><b>' + money(t.pn, true) + '</b><small>' + money(t.pp) + ' traded</small></div>' +
      '<div class="gex-tide-stat"><em>Call/put ratio</em><b>' + (r == null ? '–' : r.toFixed(2)) + '</b><small>call ÷ put premium</small></div>';
  }

  // ---------- chart ----------
  function geom(cv) {
    var W = cv.clientWidth, H = cv.clientHeight;
    return { W: W, H: H, x0: AX_L, x1: W - AX_R, y0: AX_T, y1: H - AX_B };
  }
  function xOfMin(g, m) { return g.x0 + (m - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN) * (g.x1 - g.x0); }
  function paint() {
    var cv = $('gex-tide-canvas'); if (!cv) return;
    var wrap = $('gex-tide-wrap'), dpr = window.devicePixelRatio || 1, W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
    var G = geom(cv), c = st.cum, d = current();
    g.font = '600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace'; g.textBaseline = 'middle';
    // time grid every hour
    g.strokeStyle = COL.grid; g.fillStyle = COL.axis; g.lineWidth = 1; g.textAlign = 'center';
    [10, 11, 12, 13, 14, 15, 16].forEach(function (h) {
      var x = Math.round(xOfMin(G, h * 60)) + 0.5;
      g.beginPath(); g.moveTo(x, G.y0); g.lineTo(x, G.y1); g.stroke();
      if (W > 420 || h % 2 === 0) g.fillText(h + ':00', x, G.y1 + 11);
    });
    st.geom = null;
    if (!c || !d) return;
    var mins = d.t.map(function (t) { return etParts(t).min; });
    var lo = 0, hi = 0;
    c.cn.concat(c.pn).forEach(function (v) { if (v < lo) lo = v; if (v > hi) hi = v; });
    if (hi === lo) hi = lo + 1;
    var pad = (hi - lo) * 0.08; lo -= lo < 0 ? pad : 0; hi += hi > 0 ? pad : 0;
    var pl = Math.min.apply(null, d.s), ph = Math.max.apply(null, d.s), pp = (ph - pl) * 0.1 || 1; pl -= pp; ph += pp;
    var yV = function (v) { return G.y1 - (v - lo) / (hi - lo) * (G.y1 - G.y0); };
    var yP = function (v) { return G.y1 - (v - pl) / (ph - pl) * (G.y1 - G.y0); };
    // left axis (premium)
    g.textAlign = 'right';
    var step = niceStep((hi - lo) / 4);
    for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      var y = Math.round(yV(v)) + 0.5;
      g.strokeStyle = COL.grid; g.beginPath(); g.moveTo(G.x0, y); g.lineTo(G.x1, y); g.stroke();
      g.fillStyle = COL.axis; g.fillText(money(v), G.x0 - 5, y);
    }
    // zero line
    var y0 = Math.round(yV(0)) + 0.5;
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(G.x0, y0); g.lineTo(G.x1, y0); g.stroke(); g.setLineDash([]);
    // right axis (price)
    g.textAlign = 'left'; g.fillStyle = COL.axis;
    var ps = niceStep((ph - pl) / 4);
    for (var q = Math.ceil(pl / ps) * ps; q <= ph; q += ps) g.fillText(q.toLocaleString('en-US', { maximumFractionDigits: ps < 1 ? 2 : 0 }), G.x1 + 5, yP(q));
    var line = function (arr, yf, col, w) {
      g.strokeStyle = col; g.lineWidth = w; g.lineJoin = 'round'; g.beginPath();
      arr.forEach(function (val, i) { var x = xOfMin(G, Math.min(CLOSE_MIN, Math.max(OPEN_MIN, mins[i]))), y = yf(val); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    };
    g.save(); g.beginPath(); g.rect(G.x0, G.y0 - 2, G.x1 - G.x0, G.y1 - G.y0 + 4); g.clip();
    line(d.s, yP, 'rgba(201,209,217,.55)', 1);
    line(c.pn, yV, COL.put, 2.2);
    line(c.cn, yV, COL.call, 2.2);
    g.restore();
    st.geom = { G: G, mins: mins, yV: yV, yP: yP };
    if (st.hover != null) hoverMark(g, G, mins, yV, yP);
  }
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  function hoverMark(g, G, mins, yV, yP) {
    var i = st.hover, c = st.cum; if (i == null || !c) return;
    var x = xOfMin(G, Math.min(CLOSE_MIN, Math.max(OPEN_MIN, mins[i])));
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, G.y0); g.lineTo(Math.round(x) + 0.5, G.y1); g.stroke();
    [[c.cn[i], COL.call, yV], [c.pn[i], COL.put, yV], [c.s[i], COL.px, yP]].forEach(function (p) { g.fillStyle = p[1]; g.beginPath(); g.arc(x, p[2](p[0]), 3.5, 0, 6.3); g.fill(); });
  }

  function tipAt(px) {
    var s = st.geom, c = st.cum, tip = $('gex-tide-tip');
    if (!s || !c) return;
    var best = 0, bd = 1e9;
    s.mins.forEach(function (m, i) { var dx = Math.abs(xOfMin(s.G, Math.min(CLOSE_MIN, Math.max(OPEN_MIN, m))) - px); if (dx < bd) { bd = dx; best = i; } });
    st.hover = best; paint();
    var d = current(), p = etParts(d.t[best]);
    var r = ratio(c.cp[best], c.pp[best]);
    tip.hidden = false;
    tip.innerHTML = '<b>' + hhmm(p.min) + ' ET</b><br><span class="pos">Net calls ' + money(c.cn[best], true) + '</span><br><span class="neg">Net puts ' + money(c.pn[best], true) + '</span><br><span>Price ' + Number(c.s[best]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</span>' +
      '<small>This minute: calls ' + money(d.cn[best], true) + ', puts ' + money(d.pn[best], true) + (r == null ? '' : ' · ratio ' + r.toFixed(2)) + '</small>';
    var wrap = $('gex-tide-wrap'), w = wrap.clientWidth, tw = tip.offsetWidth || 170, x = xOfMin(s.G, Math.min(CLOSE_MIN, Math.max(OPEN_MIN, s.mins[best])));
    tip.style.left = Math.max(4, Math.min(w - tw - 4, x + 12 > w - tw ? x - tw - 12 : x + 12)) + 'px';
    tip.style.top = '8px';
  }
  function clearTip() { st.hover = null; var tip = $('gex-tide-tip'); if (tip) tip.hidden = true; paint(); }

  function wire(wrap) {
    var cv = $('gex-tide-canvas');
    var lx = function (e) { return e.clientX - cv.getBoundingClientRect().left; };
    // the mouse events a phone makes after a tap would clear the tip again: ignore them for a moment after any touch
    var lastTouch = 0, fromTouch = function () { return Date.now() - lastTouch < 900; };
    wrap.addEventListener('mousemove', function (e) { if (!fromTouch()) tipAt(lx(e)); });
    wrap.addEventListener('mouseleave', function () { if (!fromTouch()) clearTip(); });
    // touch: a tap or a horizontal scrub shows the values; vertical movement keeps scrolling the page
    var start = null;
    wrap.addEventListener('touchstart', function (e) { lastTouch = Date.now(); var t = e.touches[0]; start = { x: t.clientX, y: t.clientY, mode: null }; }, { passive: true });
    wrap.addEventListener('touchmove', function (e) {
      if (!start) return;
      var t = e.touches[0], dx = t.clientX - start.x, dy = t.clientY - start.y;
      if (!start.mode && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) start.mode = Math.abs(dx) > Math.abs(dy) ? 'scrub' : 'scroll';
      if (start.mode === 'scrub') { if (e.cancelable) e.preventDefault(); tipAt(lx(t)); }
    }, { passive: false });
    wrap.addEventListener('touchend', function (e) {
      lastTouch = Date.now();
      if (start && !start.mode && e.changedTouches.length) tipAt(lx(e.changedTouches[0]));
      start = null;
    }, { passive: true });
  }

  // refresh every minute while the tab is open and the page visible; the "Updated X min ago" text every 30 s
  function startTimer() {
    if (st.timer) return;
    st.timer = setInterval(function () {
      if (document.visibilityState === 'hidden' || !st.active) return;
      if (allowed(state()) && MKTS.indexOf(state().u) >= 0) load();
    }, 60000);
    st.ago = setInterval(function () { if (st.active && st.last && !$('gex-tide-card').hidden) { var d = current(); if (d && d.t.length) stamp(d.t[d.t.length - 1]); } }, 30000);
  }
  function stopTimer() { clearInterval(st.timer); clearInterval(st.ago); st.timer = 0; st.ago = 0; }

  window.strykerGexTide = { show: show, state: st, cumulate: cumulate, money: money, ratio: ratio, paint: paint };

  function boot() {
    // gex-heatmap.js builds the tab bar on DOMContentLoaded; wait for it
    var tries = 0;
    (function wait() {
      if (mount()) { if (/zorotide/i.test(location.hash)) show(true); return; }
      if (++tries < 60) setTimeout(wait, 100);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
