// TradeZoro — Screener: live futures book columns (book imbalance, nearest bid / ask wall, delta, big trades).
// Classic script. window.StkScanL2 = { gate(): Promise<bool>, start(roots, onRow), stop(), wallOf, deltaOf, ROOTS }.
// GATE: exactly the L2 indicators' gate (assets/chart-futures-l2.js l2Visible: admin now, Pro when TS_ACCESS flips and
// L2_MEMBERS is set), imported from that file so the two can never disagree. The Worker refuses everyone else too.
// Data: the same book-recorder /ts-live hub the chart uses (one socket per root, 8 roots, opened only while the Order flow
// column set is on screen) plus /ts-aux for the last 6 h of footprint (delta). Nothing here is sent to a server.
// Wording: "updated Xs ago" only. Education only. Not financial advice.
(function (root) {
  'use strict';
  var ROOTS = ['NQ', 'ES', 'MNQ', 'MES', 'YM', 'RTY', 'CL', 'GC'];
  var BASE = 'https://book-recorder.theelitegrey.workers.dev';
  var LEVELS = 20;
  var WALL_X = 2.5;                                                   // a wall = a level at least 2.5x the median size of the 20 shown
  var BIG = { NQ: 20, ES: 40, MNQ: 50, MES: 100, YM: 25, RTY: 30, CL: 20, GC: 20 };   // one print of at least this many contracts is "big"
  var isNum = function (v) { return typeof v === 'number' && isFinite(v); };

  // nearest level from the touch outward whose size is at least WALL_X x the median of the shown levels -> {px, sz} | null. Pure.
  function wallOf(levels) {
    var ls = (levels || []).filter(function (l) { return l && l[0] > 0 && l[1] > 0; }).slice(0, LEVELS);
    if (ls.length < 5) return null;
    var s = ls.map(function (l) { return l[1]; }).sort(function (a, b) { return a - b; }), med = s[s.length >> 1];
    for (var i = 0; i < ls.length; i++) if (ls[i][1] >= WALL_X * med) return { px: ls[i][0], sz: ls[i][1] };
    return null;
  }
  // footprint minutes [{lv:[[px, buy, sell]..]}] -> buy - sell contracts. Pure.
  function deltaOf(fp) {
    var d = 0;
    (fp || []).forEach(function (m) { (m.lv || []).forEach(function (l) { d += (l[1] || 0) - (l[2] || 0); }); });
    return d;
  }
  var isLocal = function () { try { return /^(127\.0\.0\.1|localhost)$/.test(location.hostname); } catch (e) { return false; } };
  var testOn = function () { return isLocal() && root.__stkL2Test; };
  var modP = null;
  function mods() {
    if (!modP) modP = Promise.all([import('./chart-futures-l2.js?v=871'), import('./rt-access.js?v=871')]).then(function (m) { return { l2: m[0], rt: m[1] }; });
    return modP;
  }
  // true when this visitor may see the live book columns. Never throws.
  function gate() {
    if (testOn()) return Promise.resolve(true);
    return mods().then(function (m) { return m.rt.rtReady().then(function () { return m.l2.l2Probe(); }).then(function (ok) { return !!ok; }); }, function () { return false; });
  }
  function onGate(fn) { return mods().then(function (m) { m.rt.rtOnChange(function () { gate().then(fn); }); }, function () {}); }

  var socks = {}, rows = {}, timers = [], cb = null, stopped = true;
  function rowOf(r) { return rows[r] || (rows[r] = { imb: null, bw: null, bwS: null, aw: null, awS: null, delta: null, bigN: 0, at: 0, _d0: 0, _live: 0 }); }
  function emit(r) { if (cb) try { cb(r, rows[r]); } catch (e) {} }
  function frame(r, m) {
    var x = rowOf(r);
    if (m.type === 'snap') {
      var bw = wallOf(m.bids), aw = wallOf(m.asks);
      x.imb = isNum(m.imb10) ? m.imb10 : (isNum(m.imb) ? m.imb : null);
      x.bw = bw ? bw.px : null; x.bwS = bw ? bw.sz : null; x.aw = aw ? aw.px : null; x.awS = aw ? aw.sz : null;
      x.at = Date.now(); emit(r);
    } else if (m.type === 'ticks') {
      (m.t || []).forEach(function (t) { var sz = t[1], sd = t[2]; if (sz > 0) { x._live += sd > 0 ? sz : -sz; if (sz >= (BIG[r] || 25)) x.bigN++; } });
      if (isNum(x._d0)) x.delta = x._d0 + x._live;
      emit(r);
    }
  }
  function token() { return testOn() ? Promise.resolve('') : mods().then(function (m) { return m.rt.rtEnsureFresh(120).catch(function () {}).then(function () { return m.rt.rtToken() || ''; }); }); }
  function base() { return (testOn() && root.__stkL2Test.base) || BASE; }
  function open(r) {
    if (stopped || socks[r]) return;
    token().then(function (tk) {
      if (stopped || socks[r] || (!tk && !testOn())) return;
      var ws;
      try { ws = new WebSocket(base().replace(/^http/i, 'ws') + '/ts-live?symbol=' + r + '&levels=' + LEVELS, tk ? ['tz-auth', tk] : undefined); } catch (e) { return; }
      socks[r] = ws;
      ws.onopen = function () { try { ws.send(JSON.stringify({ op: 'sub', symbol: r, levels: LEVELS })); } catch (e) {} };
      ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } frame(r, m); };
      ws.onclose = function () { if (socks[r] === ws) delete socks[r]; if (!stopped && !document.hidden) timers.push(setTimeout(function () { open(r); }, 4000 + Math.random() * 4000)); };
      ws.onerror = function () { try { ws.close(); } catch (e) {} };
    });
  }
  function seedDelta(r) {
    token().then(function (tk) {
      var to = Date.now(), from = to - 6 * 3600000;
      return fetch(base() + '/ts-aux?symbol=' + r + '&from=' + from + '&to=' + to, { headers: tk ? { authorization: 'Bearer ' + tk } : {}, credentials: 'omit' });
    }).then(function (x) { return x.ok ? x.json() : null; }).then(function (j) {
      if (!j || stopped) return;
      var x = rowOf(r); x._d0 = deltaOf(j.fp); x._live = 0; x.delta = x._d0; emit(r);
    }).catch(function () {});
  }
  function start(list, onRow) {
    stop(); stopped = false; cb = onRow;
    (list || ROOTS).forEach(function (r) { if (ROOTS.indexOf(r) !== -1) { open(r); seedDelta(r); } });
    timers.push(setInterval(function () { if (!document.hidden) (list || ROOTS).forEach(seedDelta); }, 5 * 60000));
  }
  function stop() {
    stopped = true; cb = null;
    timers.forEach(function (t) { clearTimeout(t); clearInterval(t); }); timers = [];
    Object.keys(socks).forEach(function (r) { try { socks[r].close(1000); } catch (e) {} delete socks[r]; });
  }
  var api = { ROOTS: ROOTS, BIG: BIG, wallOf: wallOf, deltaOf: deltaOf, gate: gate, onGate: onGate, start: start, stop: stop, rows: function () { return rows; }, _frame: frame };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.StkScanL2 = api;
})(typeof window !== 'undefined' ? window : globalThis);
