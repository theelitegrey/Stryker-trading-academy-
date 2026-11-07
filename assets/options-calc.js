// TradeZoro: Options P&L calculator (options-calculator.html). Free; works signed out (SPX, one flat volatility) and signed in (every symbol we hold, volatility by strike and expiry).
// Maths: assets/options-calc-core.js (Black-Scholes, r 4.5 %, q 0; tested in tools/tests/options-calc-core.test.mjs). Data + canvas helpers: assets/options-tools.js.
// Prices are MODEL prices from the latest implied-volatility snapshot, not quotes; any price can be typed over. Probability of profit is an Estimate.
// Education only. Not financial advice.
(function () {
  'use strict';
  var C = window.OptCalc, T = window.OptTools;
  if (!C || !T) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = T.esc, fin = T.fin;
  var SYMS = ['SPX', 'SPY', 'QQQ', 'IWM', 'GLD', 'USO'];
  var FLAT_DAYS = [7, 14, 30, 60, 90];
  var st = { u: 'SPX', d: null, exps: [], ivFn: null, legs: [], t: 0, ivAdj: 0, hoverS: null, seq: 0, preset: '', uid: 0, plan: null };

  // ---------- data ----------
  function buildExps(d) {
    var base = d.day || new Date(d.built * 1000).toISOString().slice(0, 10), out = [];
    if (d.surf) d.surf.days.forEach(function (n, j) { if (n <= 400) out.push({ days: n, date: d.surf.x ? d.surf.x[j] : new Date(Date.parse(base + 'T12:00:00Z') + n * T.DAY).toISOString().slice(0, 10) }); });
    if (!out.length) FLAT_DAYS.forEach(function (n) { out.push({ days: n, date: new Date(Date.parse(base + 'T12:00:00Z') + n * T.DAY).toISOString().slice(0, 10) }); });
    return out;
  }
  function setData(d) {
    st.d = d; st.exps = buildExps(d);
    if (d.surf) { var f = C.surfaceIV(d.surf); st.ivFn = function (K, S, days) { return Math.max(0.01, f(K, S, days)); }; }
    else { var flat = (d.iv30 || 20) / 100; st.ivFn = function () { return flat; }; }
  }
  function load(u, keep) {
    var seq = ++st.seq; st.u = u; setMsg('Loading ' + u + '…');
    T.load(u).then(function (d) {
      if (seq !== st.seq) return;
      if (d.error || !fin(d.spot)) {
        setMsg(d.error === 'locked' ? 'Sign in (free) to use ' + u + '. SPX works without an account.' : 'No data for ' + u + ' yet.', true);
        if (!st.d) return;
        st.u = st.d.u; paintBar(); return;
      }
      setData(d); setMsg('');
      if (!keep || !st.legs.length) applyPreset(st.preset || 'long-call', true); else paintAll();
      paintBar();
    });
  }
  function setMsg(s, err) { var m = $('oc-msg'); m.textContent = s; m.hidden = !s; m.classList.toggle('is-err', !!err); }

  // ---------- legs ----------
  function expIndex(e) { var best = 0; st.exps.forEach(function (x, i) { if (Math.abs(x.days - e.days) < Math.abs(st.exps[best].days - e.days)) best = i; }); return best; }
  function applyPreset(id, silent) {
    st.preset = id;
    var S = st.d.spot, L = C.presetLegs(id, S, st.exps);
    st.legs = L.map(function (l) { return { id: ++st.uid, side: l.side, type: l.type, K: l.type === 'S' ? 0 : l.K, expI: expIndex(l.exp), qty: l.qty, px: null }; });
    st.t = 0; st.ivAdj = 0;
    paintAll();
  }
  function derived() {
    var S = st.d.spot;
    return st.legs.map(function (l) {
      var e = st.exps[Math.min(l.expI, st.exps.length - 1)], days = l.type === 'S' ? (st.legs.length > 1 ? maxDays() : 30) : e.days;
      var iv = l.type === 'S' ? 0 : st.ivFn(l.K, S, days);
      var auto = C.entryPrice(l.type, S, l.K, days, iv);
      return { side: l.side, type: l.type, K: l.K, days: days, qty: Math.max(1, l.qty || 1), iv: iv, px: l.px != null ? l.px : Math.round(auto * 100) / 100, auto: Math.round(auto * 100) / 100, date: e.date, id: l.id };
    });
  }
  function maxDays() { var m = 0; st.legs.forEach(function (l) { if (l.type !== 'S') m = Math.max(m, st.exps[Math.min(l.expI, st.exps.length - 1)].days); }); return m || 30; }

  // ---------- painting ----------
  function paintAll() { paintPresets(); paintLegs(); paintResults(); }
  function paintBar() {
    var d = st.d; if (!d) return;
    qa('#oc-syms button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.u === st.u ? 'true' : 'false'); });
    $('oc-spot').textContent = T.strikeFmt(Math.round(d.spot * 100) / 100);
    $('oc-iv').textContent = fin(d.iv30) ? 'IV ' + d.iv30.toFixed(1) + '%' : '';
    $('oc-upd').textContent = (d.sample ? 'Sample data · ' : '') + T.ago(d.built);
    $('oc-note-iv').hidden = !!d.surf;
  }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function paintPresets() {
    var h = $('oc-presets');
    if (!h.children.length) h.innerHTML = C.PRESETS.map(function (p) { return '<button type="button" class="oc-chip" data-p="' + p[0] + '">' + esc(p[1]) + '</button>'; }).join('');
    qa('#oc-presets button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.p === st.preset ? 'true' : 'false'); });
  }
  function seg(name, id, opts, val) {
    return '<div class="oc-seg" role="group" aria-label="' + name + '">' + opts.map(function (o) {
      return '<button type="button" data-f="' + id + '" data-v="' + o[0] + '" aria-pressed="' + (String(val) === String(o[0])) + '">' + o[1] + '</button>'; }).join('') + '</div>';
  }
  function paintLegs() {
    var D = derived(), step = C.strikeStep(st.d.spot);
    var html = D.map(function (d, i) {
      var l = st.legs[i], stock = l.type === 'S';
      var exp = '<select class="oc-in" data-f="exp" aria-label="Expiry">' + st.exps.map(function (e, j) { return '<option value="' + j + '"' + (j === l.expI ? ' selected' : '') + '>' + T.shortDate(e.date) + ' · ' + e.days + 'd</option>'; }).join('') + '</select>';
      return '<div class="oc-leg" data-i="' + i + '">' +
        '<div class="oc-leg-h">' + seg('Buy or sell', 'side', [[1, 'Buy'], [-1, 'Sell']], l.side) + seg('Type', 'type', [['C', 'Call'], ['P', 'Put'], ['S', 'Stock']], l.type) +
        '<button type="button" class="oc-x" data-f="del" aria-label="Remove leg ' + (i + 1) + '"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
        '<div class="oc-leg-g">' +
        (stock ? '<div class="oc-field oc-span"><span class="oc-lbl">Shares</span><div class="oc-static">' + (l.qty * 100) + ' shares (' + l.qty + ' lot' + (l.qty > 1 ? 's' : '') + ' of 100)</div></div>'
          : '<label class="oc-field"><span class="oc-lbl">Strike</span><input class="oc-in" data-f="K" type="number" inputmode="decimal" step="' + step + '" value="' + l.K + '"></label><label class="oc-field"><span class="oc-lbl">Expiry</span>' + exp + '</label>') +
        '<label class="oc-field"><span class="oc-lbl">' + (stock ? 'Lots' : 'Contracts') + '</span><input class="oc-in" data-f="qty" type="number" inputmode="numeric" min="1" max="1000" step="1" value="' + l.qty + '"></label>' +
        '<label class="oc-field"><span class="oc-lbl">Price per share' + (l.px == null ? ' <i>(model)</i>' : '') + '</span><input class="oc-in" data-f="px" type="number" inputmode="decimal" min="0" step="0.01" value="' + d.px.toFixed(2) + '"></label>' +
        '</div></div>';
    }).join('');
    $('oc-legs').innerHTML = html || '<p class="oc-empty">No legs yet. Pick a preset above or add a leg.</p>';
  }

  var resultCache = null;
  function paintResults() {
    var D = derived(), S = st.d.spot, mult = 1 + st.ivAdj / 100;
    if (!D.length) { $('oc-stats').innerHTML = ''; drawEmpty(); $('oc-greeks').innerHTML = ''; return; }
    var A = C.analyse(D, S, mult), tE = C.firstDays(D), t = Math.min(st.t, tE);
    resultCache = { D: D, A: A, tE: tE, S: S, mult: mult };
    // slider
    var sl = $('oc-date'); sl.max = String(Math.max(0, Math.round(tE))); sl.disabled = tE <= 0; sl.value = String(Math.round(t));
    var when = T.dateAdd(st.d.built, Math.round(t) + dayOffset());
    $('oc-date-v').textContent = Math.round(t) === 0 ? 'Today' : Math.round(t) >= tE && tE > 0 ? 'At expiry · ' + T.shortDate(when) : T.shortDate(when) + ' · +' + Math.round(t) + 'd';
    $('oc-iv-v').textContent = (st.ivAdj >= 0 ? '+' : '') + st.ivAdj + '%' + (A.iv ? ' · ' + (A.iv * 100).toFixed(1) + '% avg' : '');
    $('oc-ivs').value = String(st.ivAdj);
    var tile = function (k, v, cls, sub) { return '<div class="oc-stat"><span>' + k + '</span><b class="' + (cls || '') + '">' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
    var cost = A.cost;
    $('oc-stats').innerHTML =
      tile(cost >= 0 ? 'Net cost (debit)' : 'Net credit', T.money(Math.abs(cost), 0)) +
      tile('Max profit', T.money(A.maxProfit), A.maxProfit > 0 ? 'pos' : '') +
      tile('Max loss', A.maxLoss === -Infinity ? 'Unlimited' : T.money(A.maxLoss), 'neg') +
      tile('Break-even' + (A.breakEvens.length > 1 ? 's' : ''), A.breakEvens.length ? A.breakEvens.map(function (b) { return T.strikeFmt(Math.round(b * 100) / 100); }).join(' · ') : 'None') +
      tile('Chance of profit', A.pop == null ? '–' : Math.round(A.pop * 100) + '%', '', '<em class="oc-tag">Estimate</em>') +
      tile('First expiry', tE <= 0 ? 'Today' : tE + ' days');
    drawChart();
    paintGreeks(D, t, mult);
  }
  function dayOffset() { return 0; } // snapshot day = day 0 of every expiry's day count
  function paintGreeks(D, t, mult) {
    var G = C.posGreeks(D, st.d.spot, t, mult), f = function (v, d) { return fin(v) ? T.signed(v, d) : '–'; };
    var rows = D.map(function (d, i) {
      var g = G.legs[i], nm = (d.side > 0 ? 'Buy ' : 'Sell ') + d.qty + ' ' + (d.type === 'S' ? 'stock' : (d.type === 'C' ? 'call ' : 'put ') + T.strikeFmt(d.K) + ' · ' + T.shortDate(d.date));
      return '<tr><th scope="row">' + esc(nm) + '</th><td>' + f(g.delta, 1) + '</td><td>' + f(g.gamma, 2) + '</td><td>' + f(g.theta, 2) + '</td><td>' + f(g.vega, 2) + '</td></tr>';
    }).join('');
    var n = G.net;
    $('oc-greeks').innerHTML = '<table class="oc-tbl"><thead><tr><th scope="col">Leg</th><th scope="col">Delta</th><th scope="col">Gamma</th><th scope="col">Theta/day</th><th scope="col">Vega/pt</th></tr></thead><tbody>' + rows +
      '<tr class="is-net"><th scope="row">Position</th><td>' + f(n.delta, 1) + '</td><td>' + f(n.gamma, 2) + '</td><td>' + f(n.theta, 2) + '</td><td>' + f(n.vega, 2) + '</td></tr></tbody></table>';
  }

  // ---------- chart ----------
  var view = null;
  function drawEmpty() { var c = $('oc-chart'), g = T.setup(c); T.text(g.x, 'Add a leg to see the payoff.', g.w / 2, g.h / 2, g.P.ink3, 'center'); }
  function drawChart() {
    var R = resultCache; if (!R) return;
    var c = $('oc-chart'), g = T.setup(c), x = g.x, w = g.w, h = g.h, P = g.P, S = R.S;
    var rng = C.viewRange(R.D, S, R.mult), lo = rng[0], hi = rng[1], N = Math.max(60, Math.min(200, Math.round(w / 3)));
    var tSel = Math.min(st.t, R.tE), showSel = tSel < R.tE - 0.01;
    var exp = C.curve(R.D, S, lo, hi, N, R.tE, R.mult), sel = showSel ? C.curve(R.D, S, lo, hi, N, tSel, R.mult) : null;
    var ys = exp.map(function (p) { return p[1]; }).concat(sel ? sel.map(function (p) { return p[1]; }) : [0]);
    var ymin = Math.min.apply(null, ys.concat([0])), ymax = Math.max.apply(null, ys.concat([0])), padY = (ymax - ymin) * 0.12 || 1; ymin -= padY; ymax += padY;
    var padL = 48, padR = 12, padT = 12, padB = 26;
    var X = function (v) { return padL + (v - lo) / (hi - lo) * (w - padL - padR); }, Y = function (v) { return padT + (1 - (v - ymin) / (ymax - ymin)) * (h - padT - padB); };
    view = { lo: lo, hi: hi, X: X, Y: Y, padL: padL, padR: padR, w: w, exp: exp, sel: sel };
    // grid + y labels
    T.niceTicks(ymin, ymax, 4).forEach(function (v) { x.strokeStyle = v === 0 ? P.axis : P.grid; x.lineWidth = 1; x.beginPath(); x.moveTo(padL, Math.round(Y(v)) + .5); x.lineTo(w - padR, Math.round(Y(v)) + .5); x.stroke(); T.text(x, T.compact(v), padL - 6, Y(v), P.ink3, 'right'); });
    T.niceTicks(lo, hi, Math.max(3, Math.floor(w / 90))).forEach(function (v) { T.text(x, T.strikeFmt(Math.round(v)), X(v), h - 10, P.ink3, 'center'); });
    // fills (green above zero, red below), clipped to the plot
    var z = Y(0);
    var area = function (col, above) {
      x.save(); x.beginPath(); x.rect(padL, above ? padT : z, w - padL - padR, above ? z - padT : h - padB - z); x.clip();
      x.beginPath(); x.moveTo(X(exp[0][0]), z); exp.forEach(function (p) { x.lineTo(X(p[0]), Y(p[1])); }); x.lineTo(X(exp[exp.length - 1][0]), z); x.closePath(); x.fillStyle = col; x.globalAlpha = .16; x.fill(); x.restore();
    };
    area(P.pos, true); area(P.neg, false);
    var line = function (pts, col, lw, dash) { x.save(); x.beginPath(); x.rect(padL, padT, w - padL - padR, h - padT - padB); x.clip(); x.strokeStyle = col; x.lineWidth = lw; x.lineJoin = 'round'; x.setLineDash(dash || []); x.beginPath(); pts.forEach(function (p, i) { if (i) x.lineTo(X(p[0]), Y(p[1])); else x.moveTo(X(p[0]), Y(p[1])); }); x.stroke(); x.restore(); };
    line(exp, P.ink, 2);
    if (sel) line(sel, P.teal, 2);
    // spot line
    x.strokeStyle = P.amber; x.lineWidth = 1; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(Math.round(X(S)) + .5, padT); x.lineTo(Math.round(X(S)) + .5, h - padB); x.stroke(); x.setLineDash([]);
    T.text(x, 'Now ' + T.strikeFmt(Math.round(S * 100) / 100), Math.min(w - padR - 4, Math.max(padL + 4, X(S) + 4)), padT + 6, P.amber, X(S) > w - 90 ? 'right' : 'left');
    // break-evens
    R.A.breakEvens.forEach(function (b) { if (b < lo || b > hi) return; x.fillStyle = P.ink; x.beginPath(); x.arc(X(b), z, 4, 0, 7); x.fill(); x.strokeStyle = P.pos; x.lineWidth = 0; });
    // hover
    if (st.hoverS != null) {
      var hs = Math.max(lo, Math.min(hi, st.hoverS)); x.strokeStyle = P.ink2; x.lineWidth = 1; x.beginPath(); x.moveTo(Math.round(X(hs)) + .5, padT); x.lineTo(Math.round(X(hs)) + .5, h - padB); x.stroke();
      x.fillStyle = P.ink; x.beginPath(); x.arc(X(hs), Y(C.pnl(R.D, hs, R.tE, R.mult)), 4, 0, 7); x.fill();
      if (sel) { x.fillStyle = P.teal; x.beginPath(); x.arc(X(hs), Y(C.pnl(R.D, hs, tSel, R.mult)), 4, 0, 7); x.fill(); }
    }
    readout(st.hoverS != null ? st.hoverS : S, tSel, showSel);
    $('oc-key-sel').hidden = !showSel;
    c.setAttribute('aria-label', 'Payoff chart. Max profit ' + T.money(R.A.maxProfit) + ', max loss ' + (R.A.maxLoss === -Infinity ? 'unlimited' : T.money(R.A.maxLoss)) + '.');
  }
  function readout(s, tSel, showSel) {
    var R = resultCache, pe = C.pnl(R.D, s, R.tE, R.mult), ps = C.pnl(R.D, s, tSel, R.mult);
    var cls = function (v) { return v >= 0 ? 'pos' : 'neg'; };
    $('oc-read').innerHTML = '<span>At <b>' + T.strikeFmt(Math.round(s * 100) / 100) + '</b></span>' + (showSel ? '<span>Selected date <b class="' + cls(ps) + '">' + T.money(ps) + '</b></span>' : '') + '<span>At expiry <b class="' + cls(pe) + '">' + T.money(pe) + '</b></span>';
  }
  function hover(ev) {
    if (!view) return; var b = $('oc-chart').getBoundingClientRect(), px = ev.clientX - b.left;
    st.hoverS = view.lo + (px - view.padL) / (view.w - view.padL - view.padR) * (view.hi - view.lo);
    if (st.hoverS < view.lo || st.hoverS > view.hi) st.hoverS = null;
    drawChart();
  }

  // ---------- events ----------
  function legOf(el) { var r = el.closest('.oc-leg'); return r ? st.legs[+r.dataset.i] : null; }
  function wire() {
    $('oc-syms').addEventListener('click', function (e) { var b = e.target.closest('button[data-u]'); if (b) load(b.dataset.u, true); });
    $('oc-symform').addEventListener('submit', function (e) { e.preventDefault(); var v = $('oc-symin').value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10); if (v) { load(v, true); $('oc-symin').value = ''; } });
    $('oc-presets').addEventListener('click', function (e) { var b = e.target.closest('button[data-p]'); if (b && st.d) applyPreset(b.dataset.p); });
    $('oc-add').addEventListener('click', function () {
      if (!st.d) return; var S = st.d.spot, e = C.pickExpiry(st.exps, 30, 0);
      st.legs.push({ id: ++st.uid, side: 1, type: 'C', K: C.roundK(S, C.strikeStep(S)), expI: expIndex(e), qty: 1, px: null }); st.preset = ''; paintAll();
    });
    $('oc-legs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-f]'); if (!b) return; var l = legOf(b); if (!l) return;
      var f = b.dataset.f;
      if (f === 'del') st.legs.splice(st.legs.indexOf(l), 1);
      else if (f === 'side') l.side = +b.dataset.v;
      else if (f === 'type') { l.type = b.dataset.v; l.px = null; if (l.type === 'S') l.K = 0; else if (!l.K) l.K = C.roundK(st.d.spot, C.strikeStep(st.d.spot)); }
      st.preset = ''; paintAll();
    });
    $('oc-legs').addEventListener('change', function (e) {
      var el = e.target, l = legOf(el); if (!l) return; var f = el.dataset.f;
      if (f === 'K') { var k = parseFloat(el.value); if (k > 0) { l.K = k; l.px = null; } }
      else if (f === 'qty') l.qty = Math.max(1, Math.min(1000, Math.round(+el.value) || 1));
      else if (f === 'exp') { l.expI = +el.value; l.px = null; }
      else if (f === 'px') { var p = parseFloat(el.value); l.px = el.value === '' || !(p >= 0) ? null : p; }
      st.preset = ''; setTimeout(paintAll, 0);   // after blur: re-rendering inside the change event throws NotFoundError
    });
    $('oc-date').addEventListener('input', function (e) { st.t = +e.target.value; paintResults(); });
    $('oc-ivs').addEventListener('input', function (e) { st.ivAdj = +e.target.value; paintResults(); });
    var c = $('oc-chart'); c.addEventListener('pointermove', hover); c.addEventListener('pointerdown', hover);
    c.addEventListener('pointerleave', function () { st.hoverS = null; if (resultCache) drawChart(); });
    var rz; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (resultCache) drawChart(); }, 120); });
    document.addEventListener('click', function (e) { if (e.target.closest('[data-theme-toggle], .theme-toggle')) setTimeout(function () { if (resultCache) drawChart(); }, 60); });
    new MutationObserver(function () { if (resultCache) drawChart(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  function init() {
    $('oc-syms').innerHTML = SYMS.map(function (u) { return '<button type="button" data-u="' + u + '" aria-pressed="false">' + u + '</button>'; }).join('');
    wire();
    var u = (T.Q.get('u') || 'SPX').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10) || 'SPX';
    // let the sign-in state settle before the first read so a signed-in member gets the full chain on the first paint
    var go = function () { load(u, false); };
    if (window.strykerGexHeaders && !T.FIXTURE) setTimeout(go, 400); else go();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
