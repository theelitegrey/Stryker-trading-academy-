// TradeZoro: IV skew + term structure page (iv-skew.html). Reads the same data as ZoroOptions (no new server pieces):
//   GET /api/zo/summary (term rows: expiry, days, ATM IV, 25-delta put IV, 25-delta call IV; IV rank) and GET /api/zo/surface?kind=iv (IV by moneyness x expiry).
// Signed-in members only for the strike-level data (the same free sign-in as ZoroOptions); signed-out visitors get a sign-in prompt.
// Risk reversal = 25-delta call IV minus 25-delta put IV. Times read "Updated X min ago". Education only. Not financial advice.
(function () {
  'use strict';
  var C = window.OptCalc, T = window.OptTools; if (!C || !T) return;
  var $ = function (id) { return document.getElementById(id); }, fin = T.fin, esc = T.esc;
  var SYMS = ['SPX', 'SPY', 'QQQ', 'IWM', 'GLD', 'USO'];
  var st = { u: 'SPX', d: null, rows: [], a: 0, b: -1, seq: 0 };

  function msg(s, err) { var m = $('oc-msg'); m.textContent = s; m.hidden = !s; m.classList.toggle('is-err', !!err); }
  function load(u) {
    var seq = ++st.seq; st.u = u; msg('Loading ' + u + '…');
    T.load(u).then(function (d) {
      if (seq !== st.seq) return;
      if (d.error || !fin(d.spot)) { msg(d.error === 'locked' ? 'Sign in (free) to see ' + u + '.' : 'No data for ' + u + ' yet.', true); if (st.d) { st.u = st.d.u; bar(); } return; }
      msg(''); st.d = d; bar();
      if (!d.surf) { $('sk-body').hidden = true; lock(); return; }
      $('sk-lock').hidden = true; $('sk-body').hidden = false;
      // rows: one per expiry that has a full smile
      var terms = {}; C.termRows(d.term).forEach(function (r) { terms[r.exp] = r; });
      st.rows = d.surf.z.map(function (z, j) {
        var sm = C.smile(d.surf, j), t = terms[d.surf.x[j]] || {};
        return { exp: d.surf.x[j], days: d.surf.days[j], m: sm.m, iv: sm.iv, atm: t.atm, p25: t.p25, c25: t.c25, rr: t.rr };
      }).filter(function (r) { return r.iv.every(fin); });
      if (!st.rows.length) { msg('No strike-level volatility for ' + u + ' right now.', true); $('sk-body').hidden = true; return; }
      var near = function (n) { var b = 0; st.rows.forEach(function (r, i) { if (Math.abs(r.days - n) < Math.abs(st.rows[b].days - n)) b = i; }); return b; };
      st.a = near(30); st.b = -1; fillSel(); paint();
    });
  }
  function lock() {
    var h = $('sk-lock'); h.hidden = false;
    h.innerHTML = '<section class="oc-card"><h2>Sign in to see strike-level volatility</h2><p class="oc-dek" style="margin-bottom:16px">The skew and term structure use the full option chain. It is free with an account.</p><a class="oc-btn is-primary" style="display:inline-flex;align-items:center;text-decoration:none" href="login">Log in</a> <a class="oc-btn" style="display:inline-flex;align-items:center;text-decoration:none" href="signup">Create account</a></section>';
  }
  function bar() {
    var d = st.d; if (!d) return;
    Array.prototype.forEach.call(document.querySelectorAll('#oc-syms button'), function (b) { b.setAttribute('aria-pressed', b.dataset.u === st.u ? 'true' : 'false'); });
    $('oc-spot').textContent = T.strikeFmt(Math.round(d.spot * 100) / 100);
    $('oc-iv').textContent = fin(d.iv30) ? '30-day IV ' + d.iv30.toFixed(1) + '%' : '';
    $('oc-upd').textContent = (d.sample ? 'Sample data · ' : '') + T.ago(d.built);
  }
  function label(r) { return T.shortDate(r.exp) + ' · ' + r.days + 'd'; }
  function fillSel() {
    var o = st.rows.map(function (r, i) { return '<option value="' + i + '">' + label(r) + '</option>'; }).join('');
    $('sk-a').innerHTML = o; $('sk-b').innerHTML = '<option value="-1">None</option>' + o; $('sk-a').value = st.a; $('sk-b').value = st.b;
  }

  var view = null, hoverX = null;
  function paint() { skew(); term(); rank(); rr(); }
  function skew() {
    var A = st.rows[st.a], B = st.b >= 0 ? st.rows[st.b] : null, c = $('sk-skew'), g = T.setup(c), x = g.x, w = g.w, h = g.h, P = g.P;
    var m = A.m, all = A.iv.concat(B ? B.iv : []);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = (hi - lo) * .12 || 1; lo -= pad; hi += pad;
    var padL = 44, padR = 12, padT = 12, padB = 26, x0 = m[0], x1 = m[m.length - 1];
    var X = function (v) { return padL + (v - x0) / (x1 - x0) * (w - padL - padR); }, Y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB); };
    view = { X: X, Y: Y, padL: padL, padR: padR, w: w, x0: x0, x1: x1 };
    T.niceTicks(lo, hi, 4).forEach(function (v) { x.strokeStyle = P.grid; x.lineWidth = 1; x.beginPath(); x.moveTo(padL, Math.round(Y(v)) + .5); x.lineTo(w - padR, Math.round(Y(v)) + .5); x.stroke(); T.text(x, v.toFixed(v % 1 ? 1 : 0) + '%', padL - 6, Y(v), P.ink3, 'right'); });
    [x0, x0 / 2, 0, x1 / 2, x1].forEach(function (v, i) { T.text(x, (v > 0 ? '+' : '') + (Math.round(v * 10) / 10) + '%', X(v), h - 10, P.ink3, i === 0 ? 'left' : i === 4 ? 'right' : 'center'); });
    x.strokeStyle = P.amber; x.lineWidth = 1; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(Math.round(X(0)) + .5, padT); x.lineTo(Math.round(X(0)) + .5, h - padB); x.stroke(); x.setLineDash([]);
    var line = function (R, col, area) {
      x.strokeStyle = col; x.lineWidth = 2; x.lineJoin = 'round'; x.beginPath(); R.iv.forEach(function (v, i) { if (i) x.lineTo(X(R.m[i]), Y(v)); else x.moveTo(X(R.m[i]), Y(v)); }); x.stroke();
      if (area) { x.lineTo(X(R.m[R.m.length - 1]), h - padB); x.lineTo(X(R.m[0]), h - padB); x.closePath(); x.fillStyle = col; x.globalAlpha = .1; x.fill(); x.globalAlpha = 1; }
      x.fillStyle = col; R.iv.forEach(function (v, i) { x.beginPath(); x.arc(X(R.m[i]), Y(v), 3, 0, 7); x.fill(); });
    };
    if (B) line(B, P.amber, false); line(A, P.teal, true);
    if (hoverX != null) { var i = nearestIdx(A.m, hoverX); x.strokeStyle = P.ink2; x.beginPath(); x.moveTo(Math.round(X(A.m[i])) + .5, padT); x.lineTo(Math.round(X(A.m[i])) + .5, h - padB); x.stroke(); }
    $('sk-ka').textContent = label(A); $('sk-kb').textContent = B ? label(B) : ''; $('sk-kb-w').hidden = !B;
    var i2 = hoverX != null ? nearestIdx(A.m, hoverX) : A.m.indexOf(0) >= 0 ? A.m.indexOf(0) : Math.floor(A.m.length / 2);
    var strikeAt = st.d.spot * (1 + A.m[i2] / 100);
    $('sk-read').innerHTML = '<span>Strike <b>' + T.strikeFmt(Math.round(strikeAt)) + '</b> (' + (A.m[i2] > 0 ? '+' : '') + A.m[i2] + '%)</span><span>' + esc(label(A)) + ' <b>' + A.iv[i2].toFixed(1) + '%</b></span>' + (B ? '<span>' + esc(label(B)) + ' <b>' + B.iv[i2].toFixed(1) + '%</b></span>' : '');
    c.setAttribute('aria-label', 'Implied volatility by strike for ' + label(A) + (B ? ' and ' + label(B) : '') + '.');
  }
  function nearestIdx(arr, v) { var b = 0; arr.forEach(function (a, i) { if (Math.abs(a - v) < Math.abs(arr[b] - v)) b = i; }); return b; }
  function term() {
    var rows = st.rows.filter(function (r) { return fin(r.atm); }), c = $('sk-term'), g = T.setup(c), x = g.x, w = g.w, h = g.h, P = g.P;
    if (rows.length < 2) { T.text(x, 'Not enough expiries.', w / 2, h / 2, P.ink3, 'center'); return; }
    var ys = rows.map(function (r) { return r.atm; }), lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), pad = (hi - lo) * .15 || 1; lo -= pad; hi += pad;
    var d0 = rows[0].days, d1 = rows[rows.length - 1].days, padL = 44, padR = 12, padT = 12, padB = 26;
    var X = function (v) { return padL + (v - d0) / ((d1 - d0) || 1) * (w - padL - padR); }, Y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB); };
    T.niceTicks(lo, hi, 3).forEach(function (v) { x.strokeStyle = P.grid; x.lineWidth = 1; x.beginPath(); x.moveTo(padL, Math.round(Y(v)) + .5); x.lineTo(w - padR, Math.round(Y(v)) + .5); x.stroke(); T.text(x, v.toFixed(v % 1 ? 1 : 0) + '%', padL - 6, Y(v), P.ink3, 'right'); });
    T.niceTicks(d0, d1, 4).forEach(function (v, i, a) { T.text(x, Math.round(v) + 'd', X(v), h - 10, P.ink3, i === 0 ? 'left' : 'center'); });
    x.strokeStyle = P.teal; x.lineWidth = 2; x.lineJoin = 'round'; x.beginPath(); rows.forEach(function (r, i) { if (i) x.lineTo(X(r.days), Y(r.atm)); else x.moveTo(X(r.days), Y(r.atm)); }); x.stroke();
    x.fillStyle = P.teal; rows.forEach(function (r) { x.beginPath(); x.arc(X(r.days), Y(r.atm), 2.5, 0, 7); x.fill(); });
    var t5 = (st.d.term5 || []).filter(function (r) { return fin(r[2]) && r[1] >= d0 && r[1] <= d1; }); $('sk-k5').hidden = t5.length < 2;
    if (t5.length > 1) { x.save(); x.strokeStyle = P.ink3; x.lineWidth = 1.5; x.setLineDash([4, 4]); x.beginPath(); t5.forEach(function (r, i) { if (i) x.lineTo(X(r[1]), Y(r[2] * 100)); else x.moveTo(X(r[1]), Y(r[2] * 100)); }); x.stroke(); x.restore(); }
    var A = st.rows[st.a]; if (fin(A.atm)) { x.fillStyle = P.amber; x.beginPath(); x.arc(X(A.days), Y(A.atm), 5, 0, 7); x.fill(); }
    var first = rows[0], last = rows[rows.length - 1];
    $('sk-term-note').textContent = 'At-the-money implied volatility by expiry. ' + (last.atm > first.atm ? 'Longer dates cost more than shorter ones (upward slope).' : last.atm < first.atm ? 'Shorter dates cost more than longer ones (downward slope).' : '') + ' The amber dot is the expiry picked above.';
  }
  function rank() {
    var d = st.d, t = function (k, v, s) { return '<div class="oc-stat"><span>' + k + '</span><b>' + v + '</b>' + (s ? '<small>' + s + '</small>' : '') + '</div>'; };
    $('sk-rank').innerHTML = t('30-day IV', fin(d.iv30) ? d.iv30.toFixed(1) + '%' : '–', fin(d.chg) ? T.signed(d.chg, 1) + ' pts today' : '') + t('IV rank', fin(d.rank) ? Math.round(d.rank) : '–', 'where today sits between the 1-year low (0) and high (100)') + t('IV percentile', fin(d.pct) ? Math.round(d.pct) + '%' : '–', 'share of the past year that was lower');
    $('sk-rank-note').textContent = d.rankSrc && d.rankSrc !== d.u ? 'Rank is measured on ' + d.rankSrc + '.' : '';
  }
  function rr() {
    var rows = st.rows.filter(function (r) { return fin(r.rr); });
    if (!rows.length) { $('sk-rr').innerHTML = '<p class="oc-empty">25-delta values are not available for this symbol.</p>'; return; }
    var f = function (v) { return fin(v) ? v.toFixed(1) + '%' : '–'; };
    $('sk-rr').innerHTML = '<table class="oc-tbl"><thead><tr><th scope="col">Expiry</th><th scope="col">Days</th><th scope="col">ATM IV</th><th scope="col">25Δ put IV</th><th scope="col">25Δ call IV</th><th scope="col">Risk reversal</th></tr></thead><tbody>' +
      rows.slice(0, 14).map(function (r) { return '<tr' + (r === st.rows[st.a] ? ' class="is-sel"' : '') + '><th scope="row">' + T.shortDate(r.exp) + '</th><td>' + r.days + '</td><td>' + f(r.atm) + '</td><td>' + f(r.p25) + '</td><td>' + f(r.c25) + '</td><td class="' + (r.rr < 0 ? 'neg' : 'pos') + '">' + T.signed(r.rr, 1) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  function init() {
    $('oc-syms').innerHTML = SYMS.map(function (u) { return '<button type="button" data-u="' + u + '" aria-pressed="false">' + u + '</button>'; }).join('');
    $('oc-syms').addEventListener('click', function (e) { var b = e.target.closest('button[data-u]'); if (b) load(b.dataset.u); });
    $('oc-symform').addEventListener('submit', function (e) { e.preventDefault(); var v = $('oc-symin').value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10); if (v) { load(v); $('oc-symin').value = ''; } });
    $('sk-a').addEventListener('change', function (e) { st.a = +e.target.value; paint(); });
    $('sk-b').addEventListener('change', function (e) { st.b = +e.target.value; paint(); });
    var c = $('sk-skew'), mv = function (ev) { if (!view) return; var b = c.getBoundingClientRect(); hoverX = view.x0 + (ev.clientX - b.left - view.padL) / (view.w - view.padL - view.padR) * (view.x1 - view.x0); skew(); };
    c.addEventListener('pointermove', mv); c.addEventListener('pointerdown', mv); c.addEventListener('pointerleave', function () { hoverX = null; if (st.rows.length) skew(); });
    var rz; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (st.rows.length) paint(); }, 120); });
    new MutationObserver(function () { if (st.rows.length) paint(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    var u = (T.Q.get('u') || 'SPX').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10) || 'SPX';
    if (window.strykerGexHeaders && !T.FIXTURE) setTimeout(function () { load(u); }, 400); else load(u);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
