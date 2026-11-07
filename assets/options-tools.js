// TradeZoro: shared bits for the options tools pages (options-calculator.html, iv-skew.html): data loader, formatting, canvas helpers.
// DATA (nothing new on the server): GET /api/zo/summary?u=<SYM> (spot, built, iv, term rows) and GET /api/zo/surface?u=<SYM>&kind=iv
// (implied volatility by moneyness x expiry; free for signed-in members, 403 when signed out). Signed-out visitors still get the
// SPX summary (spot + 30-day IV), so the calculator works for them with one flat volatility.
// Dev / tests: ?fixture=1 reads tools/fixtures/zoro/*.json (SPX only) and labels the page "Sample".
// COPY RULES: only "Updated X min ago" for times. Education only. Not financial advice.
(function () {
  'use strict';
  var Q = new URLSearchParams(location.search), FIXTURE = Q.has('fixture');
  var fin = function (v) { return typeof v === 'number' && isFinite(v); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function url(route, q) {
    if (FIXTURE) return '/tools/fixtures/zoro/' + route + (route === 'surface' ? '-iv' : '') + '.json';
    return '/api/zo/' + route + '?' + new URLSearchParams(q);
  }
  function getJSON(route, q) {
    var hp = window.strykerGexHeaders && !FIXTURE ? window.strykerGexHeaders() : Promise.resolve({});
    return hp.then(function (hd) { return fetch(url(route, q), { headers: hd, cache: 'no-store' }); }).then(function (r) {
      if (r.status === 401 || r.status === 403) return { locked: true };
      if (!r.ok) return null;
      return r.json();
    }).catch(function () { return null; });
  }
  var DAY = 864e5;
  function dateAdd(baseSec, days) { return new Date(baseSec * 1000 + days * DAY); }
  // load(sym) -> { u, spot, built, iv30, rank, pct, surf|null, term[], signedOut, error }
  function load(u) {
    return Promise.all([getJSON('summary', { u: u }), getJSON('surface', { u: u, kind: 'iv' })]).then(function (r) {
      var s = r[0], f = r[1], out = { u: u, sample: FIXTURE };
      if (!s || s.locked) { out.error = s && s.locked ? 'locked' : 'none'; return out; }
      var iv = s.iv || {};
      out.spot = s.spot; out.built = s.built || s.t; out.day = s.day;
      out.iv30 = fin(iv.iv30) ? iv.iv30 : null; out.rank = iv.rank; out.pct = iv.pct; out.rankSrc = iv.rank_src; out.chg = iv.iv30_chg;
      out.term = Array.isArray(s.term) ? s.term : []; out.term5 = Array.isArray(s.term5) ? s.term5 : [];
      if (f && !f.locked && f.m && f.z && f.days) { out.surf = f; } else { out.surf = null; out.signedOut = !!(f && f.locked); }
      return out;
    });
  }
  function ago(t) {
    if (!fin(t)) return '';
    var m = Math.max(0, Math.floor((Date.now() / 1000 - t) / 60));
    if (m < 1) return 'Updated just now';
    if (m < 120) return 'Updated ' + m + ' min ago';
    var h = Math.floor(m / 60);
    return h < 48 ? 'Updated ' + h + ' h ago' : 'Updated ' + Math.floor(h / 24) + ' days ago';
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDate(d) { if (typeof d === 'string') d = new Date(d + 'T12:00:00Z'); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function money(v, d) {
    if (v === Infinity) return 'Unlimited'; if (v === -Infinity) return 'Unlimited';
    if (!fin(v)) return '–';
    var a = Math.abs(v), s = v < 0 ? '-' : '';
    return s + '$' + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e4 ? Math.round(a).toLocaleString('en-US') : a.toLocaleString('en-US', { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 0 : d }));
  }
  function signed(v, d) { if (!fin(v)) return '–'; return (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v).toFixed(d); }
  function pct(v, d) { return fin(v) ? v.toFixed(d == null ? 1 : d) + '%' : '–'; }
  function strikeFmt(k) { return fin(k) ? (Math.abs(k - Math.round(k)) < 0.005 ? String(Math.round(k)) : k.toFixed(2)) : '–'; }

  // ---- canvas ----
  function css(el, name, fb) { return (getComputedStyle(el).getPropertyValue(name) || '').trim() || fb; }
  function palette(el) {
    return { pos: css(el, '--oc-pos', '#03c988'), neg: css(el, '--oc-neg', '#e5484d'), teal: css(el, '--oc-teal', '#00adb5'), amber: css(el, '--oc-amber', '#f5c542'),
      ink: css(el, '--oc-t1', '#eee'), ink2: css(el, '--oc-t2', '#aaa'), ink3: css(el, '--oc-t3', '#888'), grid: css(el, '--oc-hair', 'rgba(255,255,255,.08)'), axis: css(el, '--oc-hair2', 'rgba(255,255,255,.2)') };
  }
  function setup(c) {
    var r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    var x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    x.font = '11px ' + css(c, '--oc-mono', 'ui-monospace, monospace'); x.textBaseline = 'middle';
    return { x: x, w: w, h: h, P: palette(c) };
  }
  function text(x, s, px, py, col, align) { x.fillStyle = col; x.textAlign = align || 'left'; x.fillText(s, px, py); }
  function niceTicks(lo, hi, n) {
    var span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag, step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag, out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }
  function compact(v) { var a = Math.abs(v), s = v < 0 ? '-' : ''; return s + '$' + (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k' : Math.round(a)); }

  window.OptTools = { Q: Q, FIXTURE: FIXTURE, fin: fin, esc: esc, load: load, ago: ago, shortDate: shortDate, money: money, signed: signed, pct: pct, strikeFmt: strikeFmt,
    setup: setup, text: text, niceTicks: niceTicks, compact: compact, dateAdd: dateAdd, DAY: DAY };
})();
