// TradeZoro: ZoroOptions page (zoro-options.html). Options gamma, greeks, volatility, volume and the daily note.
// Spec: stryker-notes/reports/workers/zoro-options-spec.md (sections S1-S5); design variant B "trading terminal".
// Depends on: the ZoroOptions API GET /api/zo/{summary,profile,surface,history,activity,screen,cme,note} (stream 2;
//   Pro gate server side, same token as GEX: assets/gex-auth.js window.strykerGexHeaders), assets/plan-limits.js
//   (window.strykerPlanTier), assets/plan-lock.js (card), assets/plan-modal.js (openPlanUpgradeModal),
//   assets/app-nav.js (window.strykerZoLive: launch flag), three.js 0.180 vendored at assets/vendor/three-0.180.0/
//   (loaded only when a 3D surface is on screen; never from a CDN).
// Dev / tests: ?fixture=1 reads tools/tests/fixtures/zoro/*.json (served locally only; tools/ is not deployed) and
//   labels everything "Sample". ?shot freezes looping motion for screenshots.
// COPY RULES: the words live / real-time / delayed / behind never appear here; times read "Updated X min ago".
// No bought / sold / bullish / bearish: Cboe volume has no buyer or seller side. No plan prices on this page.
// Education only. Not financial advice.
(function () {
  'use strict';
  var Q = new URLSearchParams(location.search);
  var FIXTURE = Q.has('fixture');
  var SHOT = Q.has('shot');
  var RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function still() { return RM.matches || SHOT; }
  var MONO = "'JetBrains Mono', ui-monospace, monospace";
  var C = { pos: '#03c988', neg: '#e5484d', flip: '#f5c542', spot: '#eeeeee', teal: '#00adb5', grid: 'rgba(255,255,255,.08)', zero: 'rgba(255,255,255,.22)', ink: 'rgba(255,255,255,.72)', ink3: 'rgba(255,255,255,.56)' };
  var IDX = ['SPX', 'SPY', 'QQQ', 'IWM', 'GLD', 'USO', 'ES', 'NQ', 'RTY', 'GC', 'CL'];
  var FUT_FROM = { ES: 'SPX', NQ: 'QQQ', RTY: 'IWM', GC: 'GLD', CL: 'USO' };
  var BASIS_KEY = 'stryker_gex_basis';   // shared with GEX+ (build 891 daily-close option)
  var $ = function (id) { return document.getElementById(id); };
  var qa = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fin(v) { return typeof v === 'number' && isFinite(v); }
  var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  // ---------- formatting ----------
  function num(v, d) { return fin(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) : '–'; }
  function strike(v) { return fin(v) ? num(v, Math.abs(v) < 1000 && v % 1 ? 2 : 0) : '–'; }
  function compact(v, sign) {
    if (!fin(v)) return '–';
    var a = Math.abs(v), s = v < 0 ? '−' : (sign ? '+' : '');
    return s + (a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K' : a.toFixed(0));
  }
  function money(v) { return fin(v) ? '$' + compact(v) : '–'; }
  function pct(v, d) { return fin(v) ? v.toFixed(d == null ? 2 : d) + '%' : '–'; }
  function etTime(sec) { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(sec * 1000)); }
  function shortDate(iso) { var d = new Date(iso + 'T12:00:00Z'); return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' }); }
  function nowS() { return FIXTURE ? (st.sum && st.sum.built ? st.sum.built + 120 : Date.now() / 1000) : Date.now() / 1000; }
  function ago(built) {
    if (!fin(built)) return '';
    var m = Math.max(0, Math.floor((nowS() - built) / 60));
    if (m < 1) return 'Updated just now';
    if (m < 120) return 'Updated ' + m + ' min ago';
    if (m < 48 * 60) return 'Updated ' + Math.round(m / 60) + ' h ago';
    return 'Updated ' + new Date(built * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ---------- state ----------
  var st = { u: 'SPX', x: '0', basis: '', free: false, sample: FIXTURE, sum: null, prof: null, hist: null, cache: {},
    t: null, playing: false, raf: 0, greek: 'dex', skewI: 0, sortKey: 'ivr', screen: null, first: true, seq: 0, timers: [] };
  try { st.basis = localStorage.getItem(BASIS_KEY) === 'close' ? 'close' : ''; } catch (e) {}

  // ---------- data ----------
  function fixName(route, q) {
    if (route === 'summary') return 'summary-' + q.u;
    if (route === 'profile') return 'profile-' + q.u + '-' + q.x;
    if (route === 'surface') return 'surface-' + q.u + '-' + q.kind;
    if (route === 'history') return 'history-' + q.u;
    if (route === 'activity') return 'activity-' + (q.u && q.u !== 'all' ? q.u + '-' : '') + q.kind;
    if (route === 'cme') return 'cme-' + q.root;
    return route;
  }
  function apiUrl(route, q) {
    // ?fixture=s1 reads the feeder's own sample (stream 1, tools/fixtures/zoro, SPX only)
    if (FIXTURE && Q.get('fixture') === 's1') return '/tools/fixtures/zoro/' + route + (route === 'profile' && q.x === 'all' ? '-all' : route === 'surface' && q.kind === 'iv' ? '-iv' : route === 'activity' && q.kind !== 'burst' ? '-' + q.kind : route === 'summary' && q.u === 'AAPL' ? '-AAPL' : '') + '.json';
    if (FIXTURE) return '/tools/tests/fixtures/zoro/' + fixName(route, q) + '.json';
    var p = new URLSearchParams(); Object.keys(q || {}).forEach(function (k) { if (k !== 'as' && q[k] != null && q[k] !== '') p.set(k, q[k]); });
    return '/api/zo/' + route + (p.toString() ? '?' + p : '');
  }

  // ---------- norm(route, q, d): one shape for the page ----------
  // Accepts the feeder contract (stream 1, tools/fixtures/zoro: levels[mode].cw/pw/zg, $M units, row arrays) and the page
  // shape (levels.ceiling/floor/flip, $ units). Missing parts stay missing; panels then say "Not available".
  function cols(d) { var o = {}; (d.cols || []).forEach(function (c, i) { o[c] = d.rows.map(function (r) { return r[i]; }); }); return o; }
  var M6 = function (v) { return fin(v) ? v * 1e6 : v; };
  function dteOf(day, exp) { var a = Date.parse(day + 'T12:00:00Z'), b = Date.parse(exp + 'T12:00:00Z'); return isNaN(a) || isNaN(b) ? null : Math.max(0, Math.round((b - a) / 864e5)); }
  function fillNull(z) { return z.map(function (r) { var last = null; var o = r.map(function (v) { if (fin(v)) last = v; return fin(v) ? v : last; }); var nx = null; for (var i = o.length - 1; i >= 0; i--) { if (fin(o[i])) nx = o[i]; else o[i] = nx; } return o; }); }
  function norm(route, q, d) {
    if (!d || d.locked || typeof d !== 'object') return d;
    if (d.t && !d.built) d.built = d.t;
    if (route === 'summary' && d.levels && 'call_ceiling' in d.levels) {
      // feeder contract: levels.{call_ceiling,put_floor,flip_line,pin,net $M}, nodes [{k,g $M,share 0-1}], ranges {key:[lo,hi]}
      if (q.as) q = { u: q.as };
      var L = d.levels, day = d.day || '', F = FUT_FROM[q.u] && d.fut && d.u !== q.u ? d.fut : null, sp = d.spot;
      var lv = F || L;
      d.netGex = M6(L.net); d.chgPct = d.chg_pct;
      d.levels = { ceiling: lv.call_ceiling, floor: lv.put_floor, flip: lv.flip_line, pin: lv.pin,
        nodes: (d.nodes || []).map(function (n) { return { k: n.k, gex: M6(n.g), share: n.share * 100 }; }) };
      var R = {}, RI = d.range_info || {}, RS = (F && F.ranges) || d.ranges || {};
      if (RS['0dte'] && !RS['0']) RS = { '0': RS['0dte'], w: RS.weekly };   // teaser key names
      Object.keys(RS).forEach(function (k) { var r = RS[k]; if (Array.isArray(r)) R[k] = { lo: r[0], hi: r[1], pct: (RI[k] || {}).pct }; });
      d.range = R;
      var iv = d.iv || {};
      d.iv = { iv30: iv.iv30, chg: iv.iv30_chg, rank: iv.rank, pctl: iv.pct, rankSrc: iv.rank_src, rv20: iv.rv20, year: iv.v || (iv.spark || []).map(function (r) { return Array.isArray(r) ? r[1] : r; }) };
      if (Array.isArray(d.term)) {
        d.term0 = d.term;
        d.term = { dte: d.term.map(function (r) { return Math.round(r[1]); }), atm: d.term.map(function (r) { return r[2] * 100; }),
          atm5: Array.isArray(d.term5) && d.term5.length === d.term0.length ? d.term5.map(function (r) { return r[2] * 100; }) : null };
      }
      if (d.pc) d.pc = { vol: d.pc.volume, oi: d.pc.oi, vol0: d.pc.volume_0, oi0: d.pc.oi_0, hist: (d.pc.hist || []).map(function (r) { return r[1]; }) };
      if (Array.isArray(d.pin)) d.pins = d.pin.map(function (r) { return { exp: r[0], k: F ? r[1] * F.ratio : r[1], dte: dteOf(day, r[0]) }; });
      if (F) { d.mapped = { root: F.root, from: F.from || d.u, ratio: F.ratio }; d.spot = F.price || sp * F.ratio; d.u = q.u; }
    }
    if (route === 'profile' && d.rows && d.cols) {
      var c = cols(d), oc = {};
      (d.oi_chg || []).forEach(function (r) { oc[r[0]] = r; });
      Object.assign(d, { x: d.x || d.mode, k: c.k, gex: c.gex.map(M6), dex: c.dex.map(M6), vanna: c.vanna.map(M6), charm: c.charm.map(M6), cv: c.cvol, pv: c.pvol, coi: c.coi, poi: c.poi,
        dcoi: d.oi_chg ? c.k.map(function (k) { return oc[k] ? oc[k][1] : 0; }) : null, dpoi: d.oi_chg ? c.k.map(function (k) { return oc[k] ? oc[k][2] : 0; }) : null });
      d.tot = {}; ['gex', 'dex', 'vanna', 'charm'].forEach(function (g) { d.tot[g] = d[g].reduce(function (a, v) { return a + (v || 0); }, 0); });
    }
    if (route === 'profile' && d.teaser && !d.rows && d.k && d.gex) {
      // Free teaser slice (S2 zoTeaser): k, gex $M, vol (total). No split by side: volume panel shows it as calls only.
      d.gex = d.gex.map(M6); d.cv = d.vol || d.k.map(function () { return 0; }); d.pv = d.k.map(function () { return 0; });
    }
    if (route === 'history' && d.snaps && !d.frames) {
      var K = (d.snaps[0] || {}).k || [];
      d.k = K; d.step = d.step_s || 120;
      d.frames = d.snaps.map(function (f) { var m = {}; (f.k || []).forEach(function (k, i) { m[k] = f.g[i]; }); return { t: f.t, spot: f.s, ceiling: f.cw, floor: f.pw, flip: f.zg, gex: K.map(function (k) { return M6(m[k] || 0); }) }; });
    }
    if (route === 'surface') {
      if (d.gamma || d.iv) { var one = d[q.kind]; if (!one) return null; one.built = d.built; one.u = d.u; d = one; }
      if (d.kind === 'gamma' && d.k) d = { kind: 'gamma', built: d.built, x: d.k, y: d.x.map(function (e) { return dteOf(d.x[0], e); }), z: fillNull(d.z) };
      else if (d.kind === 'iv' && d.m) d = { kind: 'iv', built: d.built, x: d.m.map(function (m) { return Math.round((m - 1) * 1000) / 10; }), y: d.days, exp: d.x, z: fillNull(d.z).map(function (r) { return r.map(function (v) { return fin(v) ? v * 100 : v; }); }) };
    }
    if (route === 'activity' && (!d.rows || (d.rows[0] && !('cp' in d.rows[0])))) {
      var raw = d.rows || d[q.kind] || [];
      d.rows = raw.map(function (r) { return { u: r.u || d.u, cp: r.cp || r.side, k: r.k, exp: r.exp || r.x, vol: r.vol != null ? r.vol : r.opt_vol, oi: r.oi, add: r.add != null ? r.add : r.dv, prem: r.prem,
        t0: fin(r.t0) ? etTime(r.t0) : r.t0, t1: fin(r.t1) ? etTime(r.t1) : r.t1, pc: r.pc != null ? r.pc : r.pc_vol, fresh: r.fresh != null ? r.fresh : r.fresh_n }; });
    }
    if (route === 'screen' && d.rows) d.rows = d.rows.map(function (r) { return { u: r.u, ivr: r.ivr, iv30: r.iv30, ivChg: r.ivChg != null ? r.ivChg : r.iv30_chg, rangePct: r.rangePct != null ? r.rangePct : r.range_w_pct, vol: r.vol != null ? r.vol : r.opt_vol, pc: r.pc != null ? r.pc : r.pc_vol, fresh: r.fresh != null ? r.fresh : r.fresh_n }; });
    if (route === 'cme' && !d.cme && d.levels) {
      if (d.ok === false) return null;
      var mp = d.mapped || {};
      d = { root: d.root, built: d.t, cme: { ceiling: d.levels.call_ceiling, floor: d.levels.put_floor, flip: d.levels.flip_line, built: d.t },
        mapped: { ceiling: mp.call_ceiling, floor: mp.put_floor, flip: mp.flip_line, built: mp.t, from: mp.from } };
    }
    if (route === 'note' && !d.sections) {
      d.sections = d.items || (d.teaser ? [{ u: 'SPX', lines: d.teaser }] : null);
    }
    if (route === 'note' && d.sections) {
      d.sections = d.sections.map(function (s) { return { u: s.u || s.sym || s.title, lines: s.lines || [] }; });
      if (d.stocks && d.stocks.lines) d.sections.push({ u: d.stocks.title || 'Stocks', lines: d.stocks.lines });
    }
    return d;
  }
  // get(route, q) -> data | {locked:true} | null (failed). Fixture mode falls back to the SPX / NVDA sample file.
  function get(route, q) {
    var key = route + JSON.stringify(q || {});
    if (st.cache[key] && Date.now() - st.cache[key].at < 60000) return Promise.resolve(st.cache[key].d);
    var hp = window.strykerGexHeaders && !FIXTURE ? window.strykerGexHeaders() : Promise.resolve({});
    return hp.then(function (hd) { return fetch(apiUrl(route, q), { headers: hd, cache: 'no-store' }); }).then(function (r) {
      if (r.status === 401 || r.status === 403) return { locked: true };
      if (r.status === 404 && FIXTURE && q && q.u && q.u !== 'SPX' && q.u !== 'all') {
        var alt = Object.assign({}, q, { u: IDX.indexOf(q.u) >= 0 ? 'SPX' : 'NVDA' });
        return get(route, alt).then(function (d) { if (d && !d.locked) { d = JSON.parse(JSON.stringify(d)); d.u = q.u; } return d; });
      }
      if (!r.ok) return null;
      return r.json().then(function (d) { return norm(route, q, d); });
    }).then(function (d) { if (d && !d.locked) st.cache[key] = { at: Date.now(), d: d }; return d; }).catch(function () { return null; });
  }

  // ---------- canvas helpers ----------
  function cv(c) {
    var r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    var x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    x.font = '11px ' + MONO; x.textBaseline = 'middle';
    return { x: x, w: w, h: h };
  }
  function txt(x, s, px, py, col, align, font) { x.fillStyle = col || C.ink3; x.textAlign = align || 'left'; if (font) x.font = font; x.fillText(s, px, py); }
  function hline(x, x0, x1, y, col, dash, lw) { x.save(); x.strokeStyle = col; x.lineWidth = lw || 1; if (dash) x.setLineDash(dash); x.beginPath(); x.moveTo(x0, Math.round(y) + .5); x.lineTo(x1, Math.round(y) + .5); x.stroke(); x.restore(); }
  function vline(x, px, y0, y1, col, dash, lw) { x.save(); x.strokeStyle = col; x.lineWidth = lw || 1; if (dash) x.setLineDash(dash); x.beginPath(); x.moveTo(Math.round(px) + .5, y0); x.lineTo(Math.round(px) + .5, y1); x.stroke(); x.restore(); }
  function rrect(x, px, py, w, h, r) { x.beginPath(); if (x.roundRect) x.roundRect(px, py, w, h, r); else x.rect(px, py, w, h); }
  function pill(x, label, cx, cy, col) {
    x.font = '500 11px ' + MONO; var tw = x.measureText(label).width + 12;
    x.fillStyle = '#000'; rrect(x, cx - tw, cy - 8, tw, 16, 8); x.fill(); x.strokeStyle = col; x.globalAlpha = .7; x.stroke(); x.globalAlpha = 1;
    txt(x, label, cx - tw / 2, cy + .5, col, 'center');
  }
  // tween(ms, fn(e), done): instant under reduced motion / screenshot mode.
  function tween(ms, fn, done) {
    if (still()) { fn(1); if (done) done(); return; }
    var t0 = performance.now();
    (function step(now) { var t = Math.min(1, (now - t0) / ms); fn(ease(t)); if (t < 1) requestAnimationFrame(step); else if (done) done(); })(t0);
  }

  // ---------- 2.1 gamma profile (horizontal bars, strikes on the left axis) ----------
  var prof = { from: null, shown: null, grow: 1, xMax: 0, rows: null };
  function profFrame() {
    var p = st.prof; if (!p || !p.k) return null;
    var s = st.sum || {}, L = s.levels || {}, R = (s.range || {})[st.x === 'all' ? 'm' : st.x === 'w' ? 'w' : st.x === 'm' ? 'm' : st.x] || (s.range || {})['0'];
    return { k: p.k, gex: p.gex, spot: p.spot || s.spot, ceiling: L.ceiling, floor: L.floor, flip: L.flip, lo: R && R.lo, hi: R && R.hi, time: null, path: null };
  }
  function histFrame(t) {
    var H = st.hist, F = H.frames, N = F.length - 1, i = Math.max(0, Math.min(N - 1, Math.floor(t))), f = Math.max(0, Math.min(1, t - i)), a = F[i], b = F[i + 1] || a;
    var s = st.sum || {}, R = (s.range || {})['0'] || {};
    var path = []; for (var j = 0; j <= i; j++) path.push(F[j].spot); path.push(lerp(a.spot, b.spot, f));
    var sp = lerp(a.spot, b.spot, f), half = fin(R.hi) && fin(R.lo) ? (R.hi - R.lo) / 2 : null;
    return { k: H.k, gex: a.gex.map(function (v, n) { return lerp(v, b.gex[n], f); }), spot: sp, ceiling: lerp(a.ceiling, b.ceiling, f), floor: lerp(a.floor, b.floor, f),
      flip: lerp(a.flip, b.flip, f), lo: half != null ? sp - half : null, hi: half != null ? sp + half : null, time: (f < .5 ? a : b).t, path: path, pathN: F.length };
  }
  function drawProfile(fr) {
    var c = $('zo-prof'); if (!c || !fr) return;
    var g = cv(c), x = g.x, w = g.w, h = g.h, spot = fr.spot;
    var sideW = fr.path ? Math.max(64, Math.round(w * .18)) : 0;
    var padL = 52, padR = 8 + sideW, padT = 10, padB = 22, pw = w - padL - padR, ph = h - padT - padB;
    var rows = []; fr.k.forEach(function (k, i) { if (Math.abs(k - spot) <= spot * .06) rows.push(i); });
    if (!rows.length) return;
    var kmax = fr.k[rows[0]], kmin = fr.k[rows[0]];
    rows.forEach(function (i) { kmax = Math.max(kmax, fr.k[i]); kmin = Math.min(kmin, fr.k[i]); });
    var step = (kmax - kmin) / Math.max(1, rows.length - 1) || 1;
    var Y = function (k) { return padT + (kmax + step / 2 - k) / (kmax - kmin + step) * ph; };
    var xm = prof.xMax || 1, X0 = padL + pw / 2, XS = (pw / 2 - 4) / xm;
    // grid + x axis
    [-1, -.5, 0, .5, 1].forEach(function (f) { var px = X0 + f * xm * XS; vline(x, px, padT, padT + ph, f === 0 ? C.zero : C.grid); txt(x, f === 0 ? '0' : compact(f * xm, true), px, h - 10, C.ink3, f === -1 ? 'left' : f === 1 ? 'right' : 'center'); });
    // Zoro Range band
    if (fin(fr.lo) && fin(fr.hi)) { x.fillStyle = 'rgba(0,173,181,.12)'; x.fillRect(padL, Y(fr.hi), pw, Y(fr.lo) - Y(fr.hi)); }
    // bars
    var rowH = ph / (rows.length || 1), bh = Math.max(1, Math.min(14, rowH * .72)), gr = prof.grow;
    rows.forEach(function (i) {
      var v = fr.gex[i] * gr, y = Y(fr.k[i]) - bh / 2, len = v * XS;
      x.fillStyle = v >= 0 ? C.pos : C.neg; x.globalAlpha = .92;
      rrect(x, v >= 0 ? X0 : X0 + len, y, Math.max(.5, Math.abs(len)), bh, Math.min(2, bh / 3)); x.fill();
    });
    x.globalAlpha = 1;
    // strike labels: keep >= 16 px apart
    var every = Math.max(1, Math.ceil(16 / rowH)), unit = fr.k.length > 1 ? Math.abs(fr.k[1] - fr.k[0]) * every : 1;
    var nice = [1, 2, 5, 10, 25, 50, 100, 250, 500].find(function (n) { return n >= unit; }) || unit;
    rows.forEach(function (i) { var k = fr.k[i]; if (Math.abs(k / nice - Math.round(k / nice)) < 1e-6) txt(x, strike(k), padL - 6, Y(k), C.ink3, 'right', '11px ' + MONO); });
    // levels + spot, tags stacked so they never overlap
    var L = [
      { k: fr.ceiling, c: C.pos, n: 'Call Ceiling' }, { k: fr.floor, c: '#ff6b70', n: 'Put Floor' },
      { k: fr.flip, c: C.flip, n: 'Flip Line' }, { k: spot, c: C.spot, n: 'Spot', d: [3, 3] }
    ].filter(function (l) { return fin(l.k) && l.k >= kmin - step && l.k <= kmax + step; }).sort(function (a, b) { return Y(a.k) - Y(b.k); });
    var lastY = -1e9;
    L.forEach(function (l) {
      var y = Y(l.k); hline(x, padL, padL + pw, y, l.c, l.d, 1.5);
      var ty = Math.max(lastY + 18, Math.max(padT + 8, Math.min(padT + ph - 8, y))); lastY = ty;
      pill(x, (w < 520 && l.n !== 'Spot' ? l.n.split(' ')[1] || l.n : l.n) + ' ' + strike(Math.round(l.k)), padL + pw - 4, ty, l.c);
    });
    // price path on the side (replay): x = time of day, y = the same strike scale
    if (fr.path && sideW) {
      var sx0 = w - sideW + 4, sx1 = w - 8;
      vline(x, sx0 - 4, padT, padT + ph, C.grid);
      txt(x, 'Price', sx0, padT + 6, C.ink3, 'left', '11px ' + MONO);
      x.save(); x.strokeStyle = C.spot; x.lineWidth = 1.5; x.beginPath();
      fr.path.forEach(function (p, j) { var px = sx0 + (j / Math.max(1, fr.pathN - 1)) * (sx1 - sx0), py = Math.max(padT, Math.min(padT + ph, Y(p))); if (j) x.lineTo(px, py); else x.moveTo(px, py); });
      x.stroke(); x.restore();
    }
    if (fr.time) txt(x, etTime(fr.time) + ' ET', padL + 8, padT + 10, C.ink, 'left', '500 12px ' + MONO);
    prof.rows = { rows: rows, Y: Y, k: fr.k, gex: fr.gex, padL: padL, pw: pw, rowH: rowH };
  }
  function paintProfile(animate) {
    var fr = replaying() ? histFrame(st.t) : profFrame();
    if (!fr) { emptyCanvas('zo-prof', 'No gamma data for this symbol yet.'); return; }
    if (!replaying()) {
      var mx = 0; fr.k.forEach(function (k, i) { if (Math.abs(k - fr.spot) <= fr.spot * .06) mx = Math.max(mx, Math.abs(fr.gex[i])); });
      if (st.hist && st.x === '0') st.hist.frames.forEach(function (f) { f.gex.forEach(function (v) { mx = Math.max(mx, Math.abs(v)); }); });
      prof.xMax = mx * 1.05;
    }
    if (animate === 'grow') { tween(250, function (e) { prof.grow = e; drawProfile(fr); }); return; }
    if (animate && prof.shown && prof.shown.k.join() === fr.k.join()) {
      var a = prof.shown.gex.slice();
      tween(200, function (e) { drawProfile(Object.assign({}, fr, { gex: fr.gex.map(function (v, i) { return lerp(a[i], v, e); }) })); });
    } else drawProfile(fr);
    prof.shown = fr;
  }
  function emptyCanvas(id, msg) { var c = $(id); if (!c) return; var g = cv(c); txt(g.x, msg, g.w / 2, g.h / 2, C.ink3, 'center', '12px ' + MONO); }
  function wireProfileTip() {
    var c = $('zo-prof'), tip = $('zo-prof-tip');
    function show(ev) {
      var R = prof.rows; if (!R) return;
      var b = c.getBoundingClientRect(), py = ev.clientY - b.top, best = null, bd = 1e9;
      R.rows.forEach(function (i) { var d = Math.abs(R.Y(R.k[i]) - py); if (d < bd) { bd = d; best = i; } });
      if (best == null || bd > Math.max(10, R.rowH)) { tip.hidden = true; return; }
      tip.textContent = strike(R.k[best]) + ' · net GEX ' + compact(R.gex[best], true);
      tip.hidden = false;
      tip.style.left = Math.min(b.width - tip.offsetWidth - 8, R.padL + 8) + 'px';
      tip.style.top = Math.max(4, Math.min(b.height - 28, R.Y(R.k[best]) - 30)) + 'px';
    }
    c.addEventListener('pointermove', show); c.addEventListener('pointerdown', show);
    c.addEventListener('pointerleave', function () { tip.hidden = true; });
  }

  // ---------- 2.2 replay the day ----------
  function replaying() { return !!(st.hist && st.t != null && st.t < st.hist.frames.length - 1 && st.x === '0'); }
  function setScrub() {
    var s = $('zo-scrub'), N = st.hist ? st.hist.frames.length - 1 : 1, t = st.t == null ? N : st.t;
    s.max = N; s.value = t; s.style.setProperty('--p', (t / N * 100) + '%');
    var F = st.hist && st.hist.frames;
    $('zo-clock').textContent = F ? etTime(F[Math.min(N, Math.round(t))].t) + ' ET' : '16:00 ET';
  }
  function scrubTo(t) {
    if (!st.hist) return;
    var N = st.hist.frames.length - 1; st.t = Math.max(0, Math.min(N, t));
    if (st.x !== '0') pickExp('0', true);
    setScrub(); paintProfile(false); paintLevels(false);
  }
  function playLabel() {
    $('zo-play').innerHTML = st.playing
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg><span>Pause</span>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span>Replay day</span>';
    $('zo-play').setAttribute('aria-label', st.playing ? 'Pause the replay' : 'Replay the day');
  }
  function stopPlay() { st.playing = false; cancelAnimationFrame(st.raf); clearInterval(st.jump); playLabel(); }
  function play() {
    if (!st.hist) return;
    var N = st.hist.frames.length - 1, fps = 600 / (st.hist.step || 120);   // 1 s = 10 min
    if (st.t == null || st.t >= N) st.t = 0;
    st.playing = true; playLabel();
    if (still()) {   // reduced motion: the scrubber jumps a frame at a time, nothing glides
      st.jump = setInterval(function () { if (st.t >= N) { stopPlay(); return; } scrubTo(Math.floor(st.t) + 1); }, 1000 / fps);
      return;
    }
    var last = performance.now();
    var step = function (now) {
      if (!st.playing) return;
      var t = Math.min(N, st.t + (now - last) / 1000 * fps); last = now;
      scrubTo(t);
      if (t < N) st.raf = requestAnimationFrame(step); else stopPlay();
    };
    st.raf = requestAnimationFrame(step);
  }

  // ---------- greeks, OI, volume ----------
  function nearIdx(p, w) { var out = []; p.k.forEach(function (k, i) { if (Math.abs(k - p.spot) <= p.spot * w) out.push(i); }); return out; }
  function drawBars(c, p, key, grow) {
    var g = cv(c), x = g.x, w = g.w, h = g.h, idx = nearIdx(p, .03), vals = idx.map(function (i) { return p[key][i]; });
    if (!idx.length) return;
    var m = Math.max.apply(null, vals.map(Math.abs)) || 1, padB = 18, mid = (h - padB) / 2, bw = (w - 12) / idx.length;
    hline(x, 6, w - 6, mid, C.zero);
    vals.forEach(function (v, j) { var hh = Math.abs(v) / m * (mid - 6) * grow; x.fillStyle = v >= 0 ? C.pos : C.neg; x.globalAlpha = .9; rrect(x, 6 + j * bw + bw * .16, v >= 0 ? mid - hh : mid, Math.max(1, bw * .68), Math.max(.5, hh), 1.5); x.fill(); });
    x.globalAlpha = 1;
    var sj = idx.findIndex(function (i) { return p.k[i] >= p.spot; }); if (sj >= 0) vline(x, 6 + sj * bw, 4, h - padB, C.spot, [3, 3]);
    txt(x, strike(p.k[idx[0]]), 6, h - 8, C.ink3, 'left'); txt(x, strike(p.k[idx[idx.length - 1]]), w - 6, h - 8, C.ink3, 'right');
  }
  function drawOI(c, p) {
    var g = cv(c), x = g.x, w = g.w, h = g.h, idx = nearIdx(p, .03);
    if (!idx.length || !p.dcoi) return;
    var m = 1; idx.forEach(function (i) { m = Math.max(m, Math.abs(p.dcoi[i]), Math.abs(p.dpoi[i])); });
    var padB = 18, mid = (h - padB) / 2, bw = (w - 12) / idx.length;
    hline(x, 6, w - 6, mid, C.zero);
    idx.forEach(function (i, j) {
      [[p.dcoi[i], C.pos, 0], [p.dpoi[i], C.neg, 1]].forEach(function (a) {
        var hh = Math.abs(a[0]) / m * (mid - 6); x.fillStyle = a[1]; x.globalAlpha = .9;
        rrect(x, 6 + j * bw + bw * (.1 + a[2] * .42), a[0] >= 0 ? mid - hh : mid, Math.max(1, bw * .36), Math.max(.5, hh), 1); x.fill();
      });
    });
    x.globalAlpha = 1;
    var sj = idx.findIndex(function (i) { return p.k[i] >= p.spot; }); if (sj >= 0) vline(x, 6 + sj * bw, 4, h - padB, C.spot, [3, 3]);
    [0, Math.floor(idx.length / 2), idx.length - 1].forEach(function (j, n) { txt(x, strike(p.k[idx[j]]), 6 + j * bw + bw / 2, h - 8, C.ink3, n === 0 ? 'left' : n === 2 ? 'right' : 'center'); });
  }
  function drawVolK(c, p, grow) {
    var g = cv(c), x = g.x, w = g.w, h = g.h;
    // the busiest strikes around spot, at most one row per 10 px
    var idx = nearIdx(p, .03), maxRows = Math.floor((h - 12) / 10);
    if (idx.length > maxRows) { var keep = idx.slice().sort(function (a, b) { return (p.cv[b] + p.pv[b]) - (p.cv[a] + p.pv[a]); }).slice(0, maxRows); idx = idx.filter(function (i) { return keep.indexOf(i) >= 0; }); }
    if (!idx.length) return;
    idx.sort(function (a, b) { return p.k[b] - p.k[a]; });
    var lab = 52, cx = w / 2, half = (w - lab) / 2 - 8, rowH = (h - 12) / idx.length, bh = Math.max(2, Math.min(12, rowH * .7));
    var m = 1; idx.forEach(function (i) { m = Math.max(m, p.cv[i], p.pv[i]); });
    idx.forEach(function (i, j) {
      var y = 6 + j * rowH + rowH / 2, cl = p.cv[i] / m * half * grow, pl = p.pv[i] / m * half * grow;
      x.fillStyle = C.neg; rrect(x, cx - lab / 2 - pl, y - bh / 2, Math.max(.5, pl), bh, 1.5); x.fill();
      x.fillStyle = C.pos; rrect(x, cx + lab / 2, y - bh / 2, Math.max(.5, cl), bh, 1.5); x.fill();
      var near = j < idx.length - 1 && p.k[i] >= p.spot && p.k[idx[j + 1]] < p.spot;
      if (rowH >= 12 || j % Math.ceil(12 / rowH) === 0) txt(x, strike(p.k[i]), cx, y, near ? C.spot : C.ink3, 'center', (near ? '600 ' : '') + '11px ' + MONO);
      if (near) hline(x, 6, w - 6, y + rowH / 2, C.spot, [3, 3]);
    });
  }

  // ---------- small charts ----------
  function gauge(c, v, o) {
    var g = cv(c), x = g.x, w = g.w, h = g.h, min = o.min || 0, max = o.max == null ? 100 : o.max;
    var r = Math.min(w / 2 - 14, h - 36), cx = w / 2, cy = r + 12, sw = o.sw || 10;
    x.lineCap = 'round'; x.lineWidth = sw;
    x.strokeStyle = 'rgba(255,255,255,.1)'; x.beginPath(); x.arc(cx, cy, r, Math.PI, 2 * Math.PI); x.stroke();
    var f = Math.max(.001, Math.min(1, (v - min) / (max - min)) * (o.grow == null ? 1 : o.grow));
    x.strokeStyle = o.color; x.beginPath(); x.arc(cx, cy, r, Math.PI, Math.PI + Math.PI * f); x.stroke();
    txt(x, o.fmt(min + (v - min) * (o.grow == null ? 1 : o.grow)), cx, cy - 6, '#eeeeee', 'center', '700 ' + (o.size || 22) + 'px ' + MONO);
    txt(x, o.lo, cx - r, cy + 14, C.ink3, 'center', '11px ' + MONO); txt(x, o.hi, cx + r, cy + 14, C.ink3, 'center');
  }
  // lines: [{ys, color, dash, area}], xs shared. opts: xfmt, ticks, zeroX, fill (between line 0 and 1), grow
  function lines(c, xs, L, o) {
    o = o || {}; var g = cv(c), x = g.x, w = g.w, h = g.h, padL = o.padL == null ? 34 : o.padL, padR = 10, padT = 10, padB = o.padB == null ? 20 : o.padB;
    var all = []; L.forEach(function (l) { all = all.concat(l.ys.filter(fin)); });
    if (!all.length) return;
    var ymin = Math.min.apply(null, all), ymax = Math.max.apply(null, all), pad = (ymax - ymin) * .1 || 1; ymin -= pad; ymax += pad;
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    var X = function (v) { return padL + (v - xmin) / ((xmax - xmin) || 1) * (w - padL - padR); }, Y = function (v) { return padT + (1 - (v - ymin) / (ymax - ymin)) * (h - padT - padB); };
    if (padL) [ymin + pad, (ymin + ymax) / 2, ymax - pad].forEach(function (v) { hline(x, padL, w - padR, Y(v), C.grid); txt(x, v.toFixed(Math.abs(ymax - ymin) < 6 ? 1 : 0), padL - 6, Y(v), C.ink3, 'right'); });
    if (padB) xs.forEach(function (v, i) { if (o.ticks ? o.ticks.indexOf(v) >= 0 : (i === 0 || i === xs.length - 1 || i === Math.floor(xs.length / 2))) txt(x, (o.xfmt || String)(v), X(v), h - 8, C.ink3, i === 0 ? 'left' : i === xs.length - 1 ? 'right' : 'center'); });
    if (o.zeroX != null) vline(x, X(o.zeroX), padT, h - padB, 'rgba(238,238,238,.5)', [3, 3]);
    x.save(); x.beginPath(); x.rect(0, 0, padL + (w - padL - padR) * (o.grow == null ? 1 : o.grow) + 2, h); x.clip();
    if (o.fill && L.length > 1) {
      for (var i = 0; i < xs.length - 1; i++) {
        var a0 = L[0].ys[i], a1 = L[0].ys[i + 1], b0 = L[1].ys[i], b1 = L[1].ys[i + 1];
        x.fillStyle = (a0 + a1) >= (b0 + b1) ? 'rgba(0,173,181,.18)' : 'rgba(245,197,66,.18)';
        x.beginPath(); x.moveTo(X(xs[i]), Y(a0)); x.lineTo(X(xs[i + 1]), Y(a1)); x.lineTo(X(xs[i + 1]), Y(b1)); x.lineTo(X(xs[i]), Y(b0)); x.closePath(); x.fill();
      }
    }
    L.forEach(function (l) {
      x.strokeStyle = l.color; x.lineWidth = l.width || 2; x.lineJoin = 'round'; x.setLineDash(l.dash || []);
      x.beginPath(); l.ys.forEach(function (v, i) { if (i) x.lineTo(X(xs[i]), Y(v)); else x.moveTo(X(xs[i]), Y(v)); }); x.stroke();
      if (l.area) { x.lineTo(X(xs[xs.length - 1]), h - padB); x.lineTo(X(xs[0]), h - padB); x.closePath(); x.fillStyle = l.color; x.globalAlpha = .12; x.fill(); x.globalAlpha = 1; }
      if (l.dots) { x.fillStyle = l.color; l.ys.forEach(function (v, i) { x.beginPath(); x.arc(X(xs[i]), Y(v), 2.5, 0, 7); x.fill(); }); }
    });
    x.restore();
  }
  function spark(c, ys, color, grow) { lines(c, ys.map(function (_, i) { return i; }), [{ ys: ys, color: color, width: 1.5, area: true }], { padL: 0, padB: 0, grow: grow }); }
  function ruler(c, lo, hi, marks) {
    var g = cv(c), x = g.x, w = g.w, h = g.h, X = function (k) { return 16 + (k - lo) / ((hi - lo) || 1) * (w - 32); }, y = h / 2;
    x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 2; x.beginPath(); x.moveTo(16, y); x.lineTo(w - 16, y); x.stroke();
    marks.forEach(function (m) { x.fillStyle = m.c; x.beginPath(); x.arc(X(m.k), y, 5, 0, 7); x.fill(); txt(x, m.n + ' ' + strike(m.k), Math.max(40, Math.min(w - 40, X(m.k))), y + m.dy, m.c, 'center', '500 11px ' + MONO); });
  }

  // ---------- 2.7 / 3.5 surfaces (three.js, drag or tap to rotate; 2D heat fallback) ----------
  var THREE_URL = '/assets/vendor/three-0.180.0/three.module.min.js';
  var threeP = null;
  function webgl() { try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  function heatColor(kind, v, m) {
    if (kind === 'iv') { var t = Math.max(0, Math.min(1, v)); return 'rgb(' + Math.round(lerp(0, 245, t)) + ',' + Math.round(lerp(173, 197, t)) + ',' + Math.round(lerp(181, 66, t)) + ')'; }
    var a = Math.min(1, Math.abs(v) / (m || 1)); return v >= 0 ? 'rgba(3,201,136,' + (.08 + a * .92) + ')' : 'rgba(229,72,77,' + (.08 + a * .92) + ')';
  }
  function surfMeta(d) {
    var flat = []; d.z.forEach(function (r) { r.forEach(function (v) { if (fin(v)) flat.push(v); }); });
    return { min: Math.min.apply(null, flat), max: Math.max.apply(null, flat), abs: Math.max.apply(null, flat.map(Math.abs)) || 1 };
  }
  function axisText(d) {
    return d.kind === 'iv' ? 'x moneyness ' + d.x[0] + '% to +' + d.x[d.x.length - 1] + '% · y ' + d.y[0] + '–' + d.y[d.y.length - 1] + ' days'
      : 'x strike ' + strike(d.x[0]) + '–' + strike(d.x[d.x.length - 1]) + ' · y ' + d.y[0] + '–' + d.y[d.y.length - 1] + ' days';
  }
  function drawHeat(host, d) {
    var c = host.querySelector('canvas.zo-heat'); if (!c) { c = document.createElement('canvas'); c.className = 'zo-heat'; c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Heat map'); host.appendChild(c); }
    var g = cv(c), x = g.x, w = g.w, h = g.h, M = surfMeta(d), padL = 36, padB = 34, padT = 8, padR = 8;
    var cw = (w - padL - padR) / d.x.length, ch = (h - padT - padB) / d.y.length;
    d.z.forEach(function (row, j) { row.forEach(function (v, i) { x.fillStyle = heatColor(d.kind, d.kind === 'iv' ? (v - M.min) / ((M.max - M.min) || 1) : v, M.abs); x.fillRect(padL + i * cw, padT + j * ch, Math.ceil(cw) + .5, Math.ceil(ch) + .5); }); });
    d.y.forEach(function (v, j) { if (j % Math.ceil(14 / ch) === 0) txt(x, v + 'd', padL - 6, padT + j * ch + ch / 2, C.ink3, 'right'); });
    [0, Math.floor(d.x.length / 2), d.x.length - 1].forEach(function (i, n) { txt(x, d.kind === 'iv' ? d.x[i] + '%' : strike(d.x[i]), padL + i * cw + cw / 2, h - padB + 10, C.ink3, n === 0 ? 'left' : n === 2 ? 'right' : 'center'); });
  }
  function surface(host, d) {
    if (!host || !d || !d.z) return;
    host._d = d;
    var ax = host.querySelector('.zo-axis'); if (ax) ax.textContent = axisText(d) + (host.classList.contains('is-heat') ? '' : (matchMedia('(hover:hover)').matches ? ' · drag to rotate' : ' · tap to rotate'));
    if (host.classList.contains('is-heat') || !webgl()) { host.classList.add('is-heat'); if (host._gl) host._gl.renderer.domElement.hidden = true; drawHeat(host, d); return; }
    var hc = host.querySelector('canvas.zo-heat'); if (hc) hc.remove();
    threeP = threeP || import(THREE_URL);
    threeP.then(function (THREE) { build3d(THREE, host, d); }).catch(function () { host.classList.add('is-heat'); drawHeat(host, d); });
  }
  function build3d(THREE, host, d) {
    var S = host._gl;
    if (!S) {
      var renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: SHOT });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setClearColor(0x000000, 1);
      renderer.domElement.setAttribute('role', 'img'); renderer.domElement.setAttribute('aria-label', d.kind === 'iv' ? 'IV surface' : 'Gamma surface');
      host.appendChild(renderer.domElement);
      var scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(38, 1, .1, 100);
      scene.add(new THREE.AmbientLight(0xffffff, .6));
      var dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(4, 10, 6); scene.add(dl);
      var grid = new THREE.GridHelper(12, 12, 0x2c2c32, 0x19191d); grid.position.y = -1.7; scene.add(grid);
      S = host._gl = { THREE: THREE, renderer: renderer, scene: scene, cam: cam, az: .78, el: .62, r: 14, group: null };
      S.render = function () {
        var b = host.getBoundingClientRect(); if (!b.width) return;
        renderer.setSize(b.width, b.height, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
        cam.aspect = b.width / b.height; cam.updateProjectionMatrix();
        cam.position.set(S.r * Math.cos(S.el) * Math.sin(S.az), S.r * Math.sin(S.el), S.r * Math.cos(S.el) * Math.cos(S.az)); cam.lookAt(0, -.3, 0);
        renderer.render(scene, cam);
      };
      wireRotate(host, S);
      new ResizeObserver(function () { S.render(); }).observe(host);
    }
    S.renderer.domElement.hidden = false;
    if (S.group) { S.scene.remove(S.group); S.group.children.forEach(function (m) { m.geometry.dispose(); m.material.dispose(); }); }
    var M = surfMeta(d), nx = d.x.length, ny = d.y.length, geo = new THREE.PlaneGeometry(10, 6, nx - 1, ny - 1), pos = geo.attributes.position, cols = [];
    var pc = new THREE.Color(C.pos), nc = new THREE.Color(C.neg), base = new THREE.Color('#0f1a17'), lo = new THREE.Color(C.teal), hi = new THREE.Color(C.flip);
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var v = d.z[j][i], idx = j * nx + i, col;
      if (d.kind === 'iv') { var t = (v - M.min) / ((M.max - M.min) || 1); pos.setZ(idx, t * 2.6 - 1); col = lo.clone().lerp(hi, t); }
      else { pos.setZ(idx, v / M.abs * 2.2); col = base.clone().lerp(v >= 0 ? pc : nc, Math.min(1, Math.abs(v) / M.abs * 1.3 + .1)); }
      cols.push(col.r, col.g, col.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); geo.computeVertexNormals();
    var mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .55, metalness: .1 }));
    var wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .07 }));
    var gp = new THREE.Group(); gp.add(mesh, wire); gp.rotation.x = -Math.PI / 2; S.scene.add(gp); S.group = gp;
    S.render(); host.dataset.ready = '1';
  }
  // Mouse: drag rotates. Touch: a tap turns the surface 45° (animated); a sideways drag rotates; vertical drags scroll the page.
  function wireRotate(host, S) {
    var down = null;
    host.addEventListener('pointerdown', function (e) { if (host.classList.contains('is-heat')) return; down = { x: e.clientX, y: e.clientY, az: S.az, el: S.el, t: performance.now(), moved: false, id: e.pointerId, touch: e.pointerType !== 'mouse' }; });
    host.addEventListener('pointermove', function (e) {
      if (!down || e.pointerId !== down.id) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.abs(dx) + Math.abs(dy) > 6) { down.moved = true; if (!down.touch || Math.abs(dx) > Math.abs(dy)) try { host.setPointerCapture(e.pointerId); } catch (er) {} else { down = null; return; } }
      if (!down.moved) return;
      S.az = down.az - dx * .01; if (!down.touch) S.el = Math.max(.15, Math.min(1.35, down.el + dy * .008));
      requestAnimationFrame(S.render);
    });
    var up = function () {
      if (down && !down.moved && down.touch && performance.now() - down.t < 400) { var a0 = S.az; tween(250, function (e) { S.az = a0 + Math.PI / 4 * e; S.render(); }); }
      down = null;
    };
    host.addEventListener('pointerup', up); host.addEventListener('pointercancel', function () { down = null; });
  }
  function wireSurfToggle(panel, host, load) {
    qa('[data-v]', panel).forEach(function (b) {
      b.addEventListener('click', function () {
        qa('[data-v]', panel).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        host.classList.toggle('is-heat', b.dataset.v === 'heat');
        if (host._d) surface(host, host._d); else load();
      });
    });
  }

  // ---------- Pro locks ----------
  var LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  function upgrade(why) { if (typeof window.openPlanUpgradeModal === 'function') window.openPlanUpgradeModal(why); }
  function lockPanel(p, msg) {
    if (p.querySelector('.zo-lock')) return;
    p.classList.add('is-locked');
    var d = document.createElement('div'); d.className = 'zo-lock';
    d.innerHTML = LOCK_SVG + '<b>Part of Pro</b><span></span><button type="button" class="zo-btn" data-open-plan-modal>See Pro</button>';
    d.querySelector('span').textContent = msg || 'Pro unlocks this panel for every symbol.';
    d.querySelector('button').setAttribute('data-upgrade-reason', 'ZoroOptions Pro unlocks every panel and symbol.');
    p.appendChild(d);
  }
  function applyFree() {
    qa('[data-pro]').forEach(function (p) { lockPanel(p); });
    var r = $('zo-replay'); r.innerHTML = '<span class="zo-hint">Replay the day is part of Pro.</span><button type="button" class="zo-btn" data-open-plan-modal data-upgrade-reason="Pro adds the day replay.">See Pro</button>';
    $('zo-replay-note').hidden = true;
    if (window.strykerPlanLock && !document.querySelector('.zo-lockcard')) {
      var w = document.createElement('div'); w.className = 'zo-lockcard'; w.appendChild(window.strykerPlanLock.card('options', 'zoro-options'));
      $('zo-s-flow').parentNode.insertBefore(w, $('zo-s-gamma'));
    }
  }

  // ---------- header: symbols, levels, zone, updated ----------
  function paintSyms() {
    $('zo-syms').innerHTML = IDX.map(function (s) { return '<button type="button" data-u="' + s + '" aria-pressed="' + (s === st.u) + '"' + (st.free && s !== 'SPX' ? ' class="is-locked"' : '') + '>' + s + '</button>'; }).join('') +
      (IDX.indexOf(st.u) < 0 ? '<button type="button" data-u="' + esc(st.u) + '" aria-pressed="true">' + esc(st.u) + '</button>' : '');
  }
  function pickSym(u) {
    u = String(u || '').toUpperCase().trim(); if (!u || u === st.u) return;
    if (st.free && u !== 'SPX') { upgrade('Pro unlocks ZoroOptions for every symbol. The Free plan covers SPX.'); return; }
    stopPlay(); st.u = u; st.t = null; st.hist = null; prof.shown = null; st.first = true;
    paintSyms(); load();
  }
  function ratio() { var m = st.sum && st.sum.mapped; return m && fin(m.ratio) ? m.ratio : null; }
  function paintLevels(first) {
    var s = st.sum; if (!s) return;
    var L = s.levels || {}, R0 = (s.range || {})['0'] || {}, fr = replaying() ? histFrame(st.t) : null, rt = ratio(), from = s.mapped && s.mapped.from;
    var tiles = [
      ['c', 'Call Ceiling', fr ? fr.ceiling : L.ceiling], ['f', 'Put Floor', fr ? fr.floor : L.floor], ['x', 'Flip Line', fr ? fr.flip : L.flip],
      ['r', 'Zoro Range 0DTE', null, fin(R0.lo) ? strike(Math.round(R0.lo)) + '–' + strike(Math.round(R0.hi)) : '–'], ['n', 'Pin Strike', L.pin]
    ];
    var host = $('zo-lvls');
    if (!host.children.length || first) host.innerHTML = tiles.map(function (t) { return '<div class="zo-lv ' + t[0] + (t[0] !== 'n' && t[0] !== 'r' ? ' pulse' : '') + '"><div class="zo-lv-h"><span>' + t[1] + '</span></div><b></b><small></small></div>'; }).join('');
    tiles.forEach(function (t, i) {
      var el = host.children[i], b = el.querySelector('b'), sm = el.querySelector('small');
      var v = t[3] || strike(fin(t[2]) ? Math.round(t[2]) : t[2]);
      if (b.textContent && b.textContent !== v && !still() && !replaying()) { b.classList.add('is-tick'); requestAnimationFrame(function () { requestAnimationFrame(function () { b.classList.remove('is-tick'); }); }); }
      b.textContent = v;
      // futures picked: the index level, mapped (spec: "mapped from SPX" in small text)
      sm.innerHTML = rt && from ? (t[0] === 'r' ? 'mapped from ' + esc(from) : 'mapped from ' + esc(from) + ' <em>' + esc(strike(Math.round(t[2] / rt))) + '</em>') : (t[0] === 'r' ? esc(pct(R0.pct)) + ' of spot' : t[0] === 'x' ? 'spot ' + (s.spot >= L.flip ? 'above' : 'below') : '');
    });
    var z = $('zo-zone'), zone = s.zone === 'cushion' ? 'cushion' : s.zone === 'swing' ? 'swing' : '';
    z.className = 'zo-zone ' + zone; z.textContent = zone ? 'Gamma Zone: ' + (zone === 'cushion' ? 'Cushion' : 'Swing') : '';
  }
  function paintUpd() {
    var s = st.sum, u = $('zo-upd'); if (!u) return;
    u.textContent = s ? ago(s.built) : 'Not available';
    u.parentNode.classList.toggle('is-old', !!(s && nowS() - s.built > 30 * 60));
    qa('[data-sample]').forEach(function (e) { e.hidden = !st.sample; });
  }

  // ---------- panels ----------
  function paintRanges() {
    var s = st.sum, R = (s && s.range) || {}, rt = ratio(), M = R.m || R.w || R['0'];
    var tiles = [['0', '0DTE'], ['1', '1DTE'], ['w', 'Weekly'], ['m', 'Monthly']];
    $('zo-ranges').innerHTML = tiles.map(function (t) {
      var r = R[t[0]];
      if (st.free && (t[0] === '1' || t[0] === 'm')) return '<div class="zo-rg is-locked">' + t[1] + '<br>Part of Pro</div>';
      if (!r) return '<div class="zo-rg is-locked">' + t[1] + '<br>Not available</div>';
      var l = M ? (r.lo - M.lo) / ((M.hi - M.lo) || 1) * 100 : 0, wd = M ? (r.hi - r.lo) / ((M.hi - M.lo) || 1) * 100 : 100, sp = M ? (s.spot - M.lo) / ((M.hi - M.lo) || 1) * 100 : 50;
      return '<div class="zo-rg"><div class="zo-rg-h"><span>' + t[1] + '</span><span>± ' + pct(r.pct) + '</span></div>' +
        '<div class="zo-rg-v">' + strike(Math.round(r.lo)) + '–' + strike(Math.round(r.hi)) + '</div>' +
        (rt ? '<div class="zo-rg-f">' + esc(s.mapped.from) + ' ' + strike(Math.round(r.lo / rt)) + '–' + strike(Math.round(r.hi / rt)) + '</div>' : '') +
        '<div class="zo-rg-bar"><i style="left:' + l.toFixed(1) + '%;width:' + wd.toFixed(1) + '%"></i><u style="left:' + Math.max(0, Math.min(100, sp)).toFixed(1) + '%"></u></div></div>';
    }).join('');
    $('zo-earn').textContent = s && s.earningsWeek ? 'Earnings week' : '';
  }
  function paintIV(first) {
    var iv = st.sum && st.sum.iv; if (!iv) return;
    $('zo-iv30').textContent = '30-day IV ' + num(iv.iv30, 1) + (iv.rankSrc && iv.rankSrc !== st.u ? ' · rank from ' + iv.rankSrc : '');
    if (!fin(iv.rank)) { emptyCanvas('zo-ivr', 'Rank after 60 days of history'); $('zo-pctl').textContent = '–'; if (iv.year && iv.year.length) spark($('zo-ivspark'), iv.year, C.teal, 1); return paintIVRV(iv); }
    tween(first ? 250 : 0, function (e) {
      gauge($('zo-ivr'), iv.rank, { color: C.teal, fmt: function (v) { return Math.round(v); }, lo: 'Low', hi: 'High', grow: e });
      $('zo-pctl').textContent = Math.round(iv.pctl * e);
      if (iv.year) spark($('zo-ivspark'), iv.year, C.teal, e);
    });
    paintIVRV(iv);
  }
  function paintIVRV(iv) {
    if (!st.free && fin(iv.rv20) && fin(iv.iv30)) { var c = $('zo-ivrv'), g = cv(c), d = iv.iv30 - iv.rv20; txt(g.x, 'IV ' + num(iv.iv30, 1) + '  vs  realised ' + num(iv.rv20, 1) + ' (20 days)', g.w / 2, g.h / 2 - 10, C.ink, 'center', '13px ' + MONO); txt(g.x, 'gap ' + (d > 0 ? '+' : '') + num(d, 1) + ' points', g.w / 2, g.h / 2 + 12, d > 0 ? C.flip : C.teal, 'center', '12px ' + MONO); return; }
    if (!st.free && iv.iv30h && iv.rv20) lines($('zo-ivrv'), iv.iv30h.map(function (_, i) { return i - iv.iv30h.length + 1; }), [{ ys: iv.iv30h, color: C.teal }, { ys: iv.rv20, color: C.flip }], { fill: true, xfmt: function (v) { return v === 0 ? 'today' : v + 'd'; } });
  }
  var skewShown = null;
  function paintSkew(animate) {
    var sk = st.sum && st.sum.skew; if (!sk || !sk.length || st.free) return;
    var sel = $('zo-skew-exp');
    if (sel.options.length !== sk.length || sel.dataset.u !== st.u) { sel.innerHTML = sk.map(function (e, i) { return '<option value="' + i + '">' + esc(shortDate(e.exp)) + ' · ' + e.dte + 'd</option>'; }).join(''); sel.dataset.u = st.u; st.skewI = sk.reduce(function (b, e, i) { return Math.abs(e.dte - 30) < Math.abs(sk[b].dte - 30) ? i : b; }, 0); sel.value = st.skewI; }
    var e = sk[st.skewI], to = e.smile.iv, from = animate && skewShown && skewShown.length === to.length ? skewShown : to;
    tween(animate ? 200 : 0, function (t) { lines($('zo-skew'), e.smile.m, [{ ys: to.map(function (v, i) { return lerp(from[i], v, t); }), color: C.teal, area: true, dots: true }], { zeroX: 0, xfmt: function (v) { return (v > 0 ? '+' : '') + v + '%'; } }); });
    skewShown = to;
    $('zo-rr').textContent = fin(e.pc25) ? '25-delta put minus call IV: ' + (e.pc25 >= 0 ? '+' : '') + num(e.pc25, 1) + ' points (' + shortDate(e.exp) + ').' : '';
  }
  function paintTerm() {
    var t = st.sum && st.sum.term; if (!t || st.free) return;
    lines($('zo-term'), t.dte, [{ ys: t.atm, color: C.teal, dots: true }].concat(t.atm5 ? [{ ys: t.atm5, color: 'rgba(238,238,238,.55)', dash: [4, 4], width: 1.5 }] : []), { ticks: [0, 30, 60, 90, 120], xfmt: function (v) { return v + 'd'; } });
  }
  function paintPC(first) {
    var pc = st.sum && st.sum.pc; if (!pc) return;
    tween(first ? 250 : 0, function (e) {
      gauge($('zo-pc'), pc.vol, { min: 0, max: 2, color: C.flip, fmt: function (v) { return v.toFixed(2); }, lo: '0', hi: '2', size: 17, sw: 8, grow: e });
      if (pc.hist) spark($('zo-pcspark'), pc.hist, C.flip, e);
    });
    var kv = [['Volume', pc.vol], ['Open interest', pc.oi], ['0DTE volume', pc.vol0], ['0DTE OI', pc.oi0]];
    $('zo-pc-kv').innerHTML = kv.map(function (k) { return '<div class="zo-stat"><span>' + k[0] + '</span><b>' + num(k[1], 2) + '</b></div>'; }).join('');
  }
  function paintPin() {
    var s = st.sum, pins = (s && s.pins) || []; if (!pins.length) return;
    var p0 = pins[0], d = s.spot - p0.k;
    $('zo-pin').textContent = strike(p0.k);
    $('zo-pin-exp').textContent = shortDate(p0.exp);
    $('zo-pin-d').textContent = 'spot ' + strike(Math.abs(Math.round(d))) + (d >= 0 ? ' above' : ' below');
    var lo = Math.min(p0.k, s.spot), hi = Math.max(p0.k, s.spot), pad = (hi - lo) * .6 + s.spot * .002;
    ruler($('zo-pinr'), lo - pad, hi + pad, [{ k: p0.k, c: C.flip, n: 'Pin', dy: -14 }, { k: Math.round(s.spot), c: C.spot, n: 'Spot', dy: 16 }]);
    $('zo-pins').innerHTML = pins.slice(0, st.free ? 1 : 5).map(function (p) { return '<tr><td>' + esc(shortDate(p.exp)) + '</td><td class="n">' + p.dte + 'd</td><td class="n tk">' + strike(p.k) + '</td></tr>'; }).join('');
  }
  function paintNodes() {
    var N = st.sum && st.sum.levels && st.sum.levels.nodes; if (!N || st.free) return;
    var rt = ratio(), mx = Math.max.apply(null, N.map(function (n) { return n.share; })) || 1;
    qa('.zo-futcol').forEach(function (e) { e.hidden = !rt; });
    $('zo-nodes').innerHTML = N.map(function (n, i) {
      return '<tr><td>' + (i + 1) + '</td><td class="n tk">' + strike(n.k) + '</td>' + (rt ? '<td class="n">' + strike(Math.round(n.k / rt)) + '</td>' : '') +
        '<td class="n ' + (n.gex >= 0 ? 'c' : 'p') + '">' + compact(n.gex, true) + '</td><td class="n">' + num(n.share, 1) + '%<span class="zo-bar-cell" style="width:' + Math.round(n.share / mx * 32) + 'px"></span></td></tr>';
    }).join('');
    // futures column header reads the mapped symbol
    qa('th.zo-futcol').forEach(function (e) { e.textContent = rt ? st.sum.mapped.from : 'Futures'; });
  }
  function paintGreeks(first) {
    var p = st.prof; if (!p || st.free) return;
    tween(first ? 250 : 200, function (e) { qa('[data-bars]').forEach(function (c) { drawBars(c, p, c.dataset.bars, first ? e : 1); }); });
    var T = p.tot || {}; qa('[data-tot]').forEach(function (b) { b.textContent = compact(T[b.dataset.tot], true); });
  }
  function paintFlow(first) {
    var p = st.prof; if (!p) return;
    tween(first ? 250 : 0, function (e) { drawVolK($('zo-volk'), p, e); });
    if (!st.free) drawOI($('zo-oi'), p);
  }
  function contract(r) { return esc(r.u) + ' ' + strike(r.k) + (r.cp === 'C' ? 'C' : 'P') + ' ' + esc(shortDate(r.exp)); }
  function paintTable(id, rows, fn, prevKey) {
    var tb = $(id), old = tb.dataset.keys ? tb.dataset.keys.split('|') : [];
    var keys = rows.map(prevKey);
    tb.innerHTML = rows.map(function (r, i) { return '<tr' + (old.length && old.indexOf(keys[i]) < 0 ? ' class="is-new"' : '') + '>' + fn(r) + '</tr>'; }).join('') || '<tr><td colspan="5" class="zo-empty">Nothing above the size filter yet.</td></tr>';
    tb.dataset.keys = keys.join('|');
  }
  function paintFresh(d) {
    if (!d || !d.rows) return;
    paintTable('zo-fresh', d.rows.slice(0, 40), function (r) {
      return '<td class="tk ' + (r.cp === 'C' ? 'c' : 'p') + '">' + contract(r) + '</td><td class="n">' + num(r.vol) + '</td><td class="n">' + num(r.oi) + '</td><td class="n">' + (r.vol / r.oi).toFixed(1) + '×</td><td class="n zo-hide-s">' + money(r.prem) + '</td>';
    }, function (r) { return r.u + r.k + r.cp + r.exp; });
  }
  function paintBursts(d) {
    if (!d || !d.rows) return;
    paintTable('zo-burst', d.rows.slice(0, 40), function (r) {
      return '<td>' + esc(r.t0) + '–' + esc(r.t1) + '</td><td class="tk ' + (r.cp === 'C' ? 'c' : 'p') + '">' + contract(r) + '</td><td class="n">+' + num(r.add) + '</td><td class="n zo-hide-s">' + money(r.prem) + '</td>';
    }, function (r) { return r.t1 + r.u + r.k + r.cp; });
  }
  function paintTape(d) {
    var tp = $('zo-tape'), tr = $('zo-tape-track');
    if (!d || !d.rows || !d.rows.length) { tp.classList.add('is-empty'); return; }
    tp.classList.remove('is-empty');
    var one = d.rows.slice(0, 16).map(function (r) {
      return '<span><b>' + esc(r.u) + '</b>' + strike(r.k) + (r.cp === 'C' ? ' call' : ' put') + ' ' + esc(shortDate(r.exp)) + ' · <i class="' + (r.cp === 'C' ? 'c' : 'p') + '">+' + num(r.add) + '</i> contracts · ' + esc(r.t0) + '–' + esc(r.t1) + ' ET</span>';
    }).join('');
    tr.innerHTML = one + one;
    tr.style.setProperty('--zo-tape-s', Math.max(30, d.rows.slice(0, 16).length * 5) + 's');
  }
  function paintActive(d) {
    if (!d || !d.rows) return;
    $('zo-active').innerHTML = d.rows.slice(0, 20).map(function (r) { return '<tr tabindex="0" data-u="' + esc(r.u) + '"><td class="tk">' + esc(r.u) + '</td><td class="n">' + compact(r.vol) + '</td><td class="n">' + num(r.pc, 2) + '</td></tr>'; }).join('');
  }
  function paintScreen() {
    var d = st.screen; if (!d || !d.rows) return;
    var k = st.sortKey, rows = d.rows.slice().sort(function (a, b) { return k === 'ivChg' ? Math.abs(b[k]) - Math.abs(a[k]) : b[k] - a[k]; });
    $('zo-screen-n').textContent = d.rows.length + ' symbols';
    $('zo-screen').innerHTML = rows.map(function (r) {
      return '<tr tabindex="0" data-u="' + esc(r.u) + '"><td class="tk">' + esc(r.u) + '</td><td class="n">' + r.ivr + '</td><td class="n">' + num(r.iv30, 1) + '</td><td class="n">' + (r.ivChg > 0 ? '+' : '') + num(r.ivChg, 1) + '</td><td class="n">' + pct(r.rangePct) + '</td><td class="n zo-hide-s">' + num(r.pc, 2) + '</td><td class="n zo-hide-s">' + r.fresh + '</td></tr>';
    }).join('');
    var dl = $('zo-list'); if (dl && !dl.children.length) dl.innerHTML = d.rows.filter(function (r) { return IDX.indexOf(r.u) < 0; }).map(function (r) { return '<option value="' + esc(r.u) + '">'; }).join('');
  }
  function paintCME(d) {
    var p = document.querySelector('[data-panel="cme"]');
    if (!d || !d.cme) { p.hidden = true; return; }
    p.hidden = false;
    $('zo-cme-root').textContent = d.root + ' · mapped from ' + (d.mapped && d.mapped.from || FUT_FROM[d.root]);
    $('zo-cme').innerHTML = [['Call Ceiling', 'ceiling'], ['Put Floor', 'floor'], ['Flip Line', 'flip']].map(function (r) {
      return '<tr><td>' + r[0] + '</td><td class="n tk">' + strike(d.cme[r[1]]) + '</td><td class="n">' + strike(d.mapped && d.mapped[r[1]]) + '</td></tr>';
    }).join('');
    $('zo-cme-foot').textContent = 'CME options: ' + ago(d.cme.built).toLowerCase() + '. Mapped: ' + ago(d.mapped && d.mapped.built).toLowerCase() + '.';
  }
  function paintNote(d) {
    var host = $('zo-note'), card = host.closest('.zo-p'), more = $('zo-note-more');
    if (!d || d.ok === false || !d.sections) { host.innerHTML = '<p class="zo-empty">Note not available today.</p>'; more.hidden = true; return; }
    $('zo-note-t').textContent = d.kind === 'morning' ? 'Zoro Morning Note' : 'Zoro Close Note';
    $('zo-note-day').textContent = shortDate(d.day) + ' · ' + ago(d.built).toLowerCase();
    var secs = st.free ? [{ u: 'SPX', lines: ((d.sections.find(function (s) { return s.u === 'SPX'; }) || d.sections[0]).lines || []).slice(0, 3) }] : d.sections;
    host.innerHTML = secs.map(function (s) { return '<div><h4>' + esc(s.u) + '</h4>' + s.lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div>'; }).join('') +
      '<p class="zo-foot" style="grid-column:1/-1">Built from the numbers on this page by fixed templates. Education only. Not financial advice.</p>';
    more.hidden = false;
    if (st.free) { more.textContent = 'Read the full note with Pro'; more.setAttribute('data-open-plan-modal', ''); more.setAttribute('data-upgrade-reason', 'Pro shows the full Zoro note.'); return; }
    var narrow = matchMedia('(max-width:760px)').matches;
    card.classList.toggle('is-clamped', narrow && more.getAttribute('aria-expanded') !== 'true');
    more.hidden = !narrow;
  }

  // ---------- loading ----------
  function load() {
    var seq = ++st.seq, u = st.u, first = st.first; st.first = false;
    qa('.zo-u').forEach(function (e) { e.textContent = '· ' + u; });
    get('summary', { u: u, basis: st.basis }).then(function (s) { return s || !FUT_FROM[u] ? s : get('summary', { u: FUT_FROM[u], basis: st.basis, as: u }); }).then(function (s) {
      if (seq !== st.seq) return;
      if (!s || s.locked) { st.sum = null; paintUpd(); if (s && s.locked && !st.free) { st.free = true; applyFree(); } emptyCanvas('zo-prof', s && s.locked ? 'Part of Pro' : 'No data for ' + u + ' yet.'); return; }
      st.sum = s; st.sample = st.sample || !!s.sample;
      paintUpd(); paintLevels(first); paintRanges(); paintIV(first); paintPC(first); paintPin();
      if (!st.free) { paintSkew(false); paintTerm(); paintNodes(); }
      if (!st.free && !s.skew) get('surface', { u: u, kind: 'iv' }).then(function (d) {
        if (seq !== st.seq || !d || d.locked || !d.z) return;
        var T = s.term0 || [];
        s.skew = d.z.map(function (row, j) { var e = (d.exp || [])[j], tr = T.filter(function (r) { return r[0] === e; })[0];
          return { exp: e, dte: d.y[j], pc25: tr && fin(tr[3]) && fin(tr[4]) ? (tr[3] - tr[4]) * 100 : null, smile: { m: d.x, iv: row } }; }).filter(function (e) { return e.exp && e.smile.iv.every(fin); }).slice(0, 12);
        paintSkew(false);
      });
      var fut = FUT_FROM[u] ? u : null;
      if (fut && !st.free) get('cme', { root: fut }).then(function (d) { if (seq === st.seq) paintCME(d && !d.locked ? d : null); }); else paintCME(null);
      loadProfile(first);
      if (!st.free && st.basis !== 'close') get('history', { u: u }).then(function (h) {
        if (seq !== st.seq || !h || h.locked || !h.frames || h.frames.length < 2) { $('zo-replay').hidden = true; return; }
        st.hist = h; $('zo-replay').hidden = false; setScrub();
      });
      else if (!st.free) $('zo-replay').hidden = true;
      if (!st.free) {
        lazySurface('zo-gsurf', { u: u, kind: 'gamma' });
        lazySurface('zo-isurf', { u: u, kind: 'iv' });
      }
    });
  }
  function loadProfile(first) {
    var seq = st.seq;
    get('profile', { u: st.u, x: st.x, basis: st.basis }).then(function (p) {
      if (seq !== st.seq) return;
      if (!p || p.locked) { st.prof = null; emptyCanvas('zo-prof', p && p.locked ? 'Part of Pro' : 'No gamma data for this expiry yet.'); return; }
      st.prof = p; paintProfile(first ? 'grow' : true); paintGreeks(first); paintFlow(first);
    });
  }
  function loadActivity() {
    // the tape and the burst / fresh lists follow the market-wide feed; the Most active table is index-view data
    get('note', {}).then(function (d) { paintNote(d && !d.locked ? d : null); });
    get('activity', { u: 'all', kind: 'burst' }).then(function (d) { if (d && !d.locked) { paintTape(d); if (!st.free) paintBursts(d); } else paintTape(null); });
    if (st.free) return;
    get('activity', { u: 'all', kind: 'fresh' }).then(function (d) { if (d && !d.locked) paintFresh(d); });
    get('activity', { u: 'all', kind: 'active' }).then(function (d) { if (d && !d.locked) paintActive(d); });
    get('screen', {}).then(function (d) { if (d && !d.locked) { st.screen = d; paintScreen(); } });
  }
  // 3D surfaces load when they scroll into view (saves the three.js download and the GPU on phones)
  var surfIO = 'IntersectionObserver' in window ? new IntersectionObserver(function (ents) {
    ents.forEach(function (e) { if (e.isIntersecting && e.target._want) { var w = e.target._want; e.target._want = null; fetchSurface(e.target, w); } });
  }, { rootMargin: '200px' }) : null;
  function fetchSurface(host, q) { var seq = st.seq; get('surface', q).then(function (d) { if (seq === st.seq && d && !d.locked) surface(host, d); }); }
  function lazySurface(id, q) { var host = $(id); if (!surfIO || SHOT) return fetchSurface(host, q); host._want = q; surfIO.unobserve(host); surfIO.observe(host); }

  function pickExp(x, quiet) {
    if (st.free && x !== '0') { upgrade('Pro unlocks every expiry. The Free plan covers SPX 0DTE.'); return; }
    st.x = x;
    qa('#zo-exp [data-x]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.x === x)); });
    if (x !== '0') { stopPlay(); st.t = null; setScrub(); }
    if (!quiet) loadProfile(false);
  }

  // ---------- wiring ----------
  function wire() {
    $('zo-syms').addEventListener('click', function (e) { var b = e.target.closest('[data-u]'); if (b) pickSym(b.dataset.u); });
    var f = $('zo-find');
    var go = function () { var v = f.value.toUpperCase().trim(); if (/^[A-Z.]{1,6}$/.test(v)) { pickSym(v); f.value = ''; f.blur(); } };
    f.addEventListener('change', go); f.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    $('zo-basis').addEventListener('click', function (e) {
      var b = e.target.closest('[data-b]'); if (!b || b.dataset.b === st.basis) return;
      st.basis = b.dataset.b; try { localStorage.setItem(BASIS_KEY, st.basis); } catch (er) {}
      paintBasis(); stopPlay(); st.t = null; st.hist = null; load();
    });
    $('zo-exp').addEventListener('click', function (e) { var b = e.target.closest('[data-x]'); if (b && b.dataset.x !== st.x) pickExp(b.dataset.x); });
    $('zo-play').addEventListener('click', function () { if (st.playing) stopPlay(); else play(); });
    $('zo-scrub').addEventListener('input', function (e) { stopPlay(); scrubTo(+e.target.value); });
    $('zo-greek-seg').addEventListener('click', function (e) { var b = e.target.closest('[data-g]'); if (!b) return; qa('#zo-greek-seg [data-g]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); $('zo-gk3').dataset.show = b.dataset.g; paintGreeks(false); });
    $('zo-skew-exp').addEventListener('change', function (e) { st.skewI = +e.target.value; paintSkew(true); });
    $('zo-screen-sort').addEventListener('click', function (e) { var b = e.target.closest('[data-s]'); if (!b) return; st.sortKey = b.dataset.s; qa('#zo-screen-sort [data-s]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); paintScreen(); });
    ['zo-screen', 'zo-active'].forEach(function (id) {
      var tb = $(id), pick = function (e) { var r = e.target.closest('[data-u]'); if (r) { pickSym(r.dataset.u); window.scrollTo({ top: 0, behavior: still() ? 'auto' : 'smooth' }); } };
      tb.addEventListener('click', pick); tb.addEventListener('keydown', function (e) { if (e.key === 'Enter') pick(e); });
    });
    var tp = $('zo-tape'), pz = $('zo-tape-pause');
    pz.addEventListener('click', function () { var on = !tp.classList.contains('is-paused'); tp.classList.toggle('is-paused', on); pz.setAttribute('aria-pressed', String(on)); pz.setAttribute('aria-label', on ? 'Play the tape' : 'Pause the tape'); });
    tp.addEventListener('touchstart', function () { tp.classList.add('is-paused'); pz.setAttribute('aria-pressed', 'true'); }, { passive: true });
    $('zo-note-more').addEventListener('click', function (e) {
      if (st.free) return;
      var b = e.currentTarget, open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open)); b.textContent = open ? 'Show less' : 'Read more';
      b.closest('.zo-p').classList.toggle('is-clamped', !open);
    });
    qa('[data-panel="gsurf"], [data-panel="isurf"]').forEach(function (p) {
      var host = p.querySelector('.zo-surf');
      wireSurfToggle(p, host, function () { lazySurface(host.id, { u: st.u, kind: host.id === 'zo-gsurf' ? 'gamma' : 'iv' }); });
    });
    wireProfileTip();
    wireSecNav();
    // redraw canvases on resize (debounced to one frame)
    var rz = 0; window.addEventListener('resize', function () { cancelAnimationFrame(rz); rz = requestAnimationFrame(redraw); }, { passive: true });
    document.addEventListener('stryker:theme', redraw);
    // refresh while the page is visible: 2 min for index/ETF data, 15 min for stocks
    setInterval(function () { paintUpd(); }, 30000);
    setInterval(function () {
      if (document.hidden || st.playing || replaying()) return;
      var tierB = st.sum && st.sum.tier === 'B';
      if (tierB && (Date.now() / 1000 - (st.sum.built || 0)) < 900) return;
      st.cache = {}; load(); loadActivity();
    }, 120000);
  }
  function paintBasis() { qa('#zo-basis [data-b]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.b === st.basis)); }); }
  function redraw() {
    if (st.sum) { paintIV(false); paintPC(false); paintPin(); paintSkew(false); paintTerm(); }
    if (st.prof) { paintProfile(false); paintGreeks(false); drawVolK($('zo-volk'), st.prof, 1); if (!st.free) drawOI($('zo-oi'), st.prof); }
    qa('.zo-surf').forEach(function (h) { if (h._d && h.classList.contains('is-heat')) drawHeat(h, h._d); });
  }
  function wireSecNav() {
    var nav = $('zo-secnav'), bar = $('zo-bar');
    var setH = function () { document.documentElement.style.setProperty('--zo-bar-h', bar.offsetHeight + 'px'); };
    setH(); if ('ResizeObserver' in window) new ResizeObserver(setH).observe(bar);
    nav.addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]'); if (!b) return;
      var t = $(b.dataset.go), off = parseFloat(getComputedStyle(t).scrollMarginTop) || 0;
      window.scrollTo({ top: window.scrollY + t.getBoundingClientRect().top - off, behavior: still() ? 'auto' : 'smooth' });
    });
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) { if (e.isIntersecting) qa('[data-go]', nav).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.go === e.target.id)); }); });
    }, { rootMargin: '-30% 0px -60% 0px' });
    qa('.zo-sec').forEach(function (s) { io.observe(s); });
  }

  // ---------- start ----------
  function tier() {
    if (window.__zoTestFree != null) return Promise.resolve({ free: !!window.__zoTestFree });
    if (FIXTURE || typeof window.strykerPlanTier !== 'function') return Promise.resolve({ free: false });
    return Promise.race([window.strykerPlanTier(), new Promise(function (r) { setTimeout(function () { r({ free: false }); }, 6000); })]);
  }
  function start() {
    if (SHOT) document.documentElement.classList.add('zo-shot');
    var live = typeof window.strykerZoLive === 'function' ? window.strykerZoLive() : false;
    if (!live) { $('zo-app').hidden = true; $('zo-soon').hidden = false; return; }
    paintBasis(); paintSyms(); wire(); playLabel();
    tier().then(function (t) {
      st.free = !!(t && t.free);
      if (st.free) { st.u = 'SPX'; st.x = '0'; paintSyms(); applyFree(); }
      load(); loadActivity();
    });
  }
  window.strykerZoro = { state: st, scrubTo: scrubTo, play: play, stop: stopPlay, pick: pickSym, histFrame: histFrame };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
