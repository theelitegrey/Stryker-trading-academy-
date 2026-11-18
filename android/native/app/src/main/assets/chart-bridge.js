/*
 * TradeZoro app <-> ZoroCharts bridge. Injected by the Android app into https://tradezoro.com/charts
 * at document start. It changes nothing on the site: it hides the site's own chrome (the app draws
 * native chrome around the chart) and drives the chart through the page's existing window APIs:
 *   __stkIntervals.apply(tf)   timeframe (respects plan limits, toasts its own reasons)
 *   __stkSearch.open()/pick()  symbol
 *   __stkPaper                 paper trading only (demo money, simulated fills); never a broker
 *   __stkAlerts.open()         alerts
 * The app reads state by calling TZB.state() through evaluateJavascript once a second while the
 * Charts tab is visible (no JS interface is exposed to the page).
 * Education only. Not financial advice.
 */
(function () {
  'use strict';
  if (window.TZB || !/^\/charts(\.html)?$/.test(location.pathname)) return;
  var dark = '%THEME%' !== 'day';
  try { localStorage.setItem('stryker_theme', dark ? 'night' : 'day'); } catch (e) {}
  window.__tzAcctLocal = ['stryker_theme'];   // the app syncs its theme with the account natively (AccountPrefs.kt); the page must not push the phone's resolved theme

  var css = [
    // the site toolbar stays in the DOM (its buttons open the indicator / drawing sheets) but off screen
    '.stkc-bar{position:absolute!important;top:-400px!important;left:0!important;visibility:hidden!important}',
    '.tzc,.appnav-dock,.mobile-topnav,.stkchart-credit,.stkcps-handle,.skip-link{display:none!important}',
    'body{padding-bottom:0!important}',
    // Owner 17 Nov: no latency / connection-speed readout on the chart in the app
    '.stklat-chip,.stklat-pop,.stklat-scrim{display:none!important}',
    // the site's Templates / Workspaces sheets live in the hidden toolbar: show them (and their scrim) when opened
    '.stkc-bar .stkc-pop:not([hidden]),.stkc-bar .stkc-scrim:not([hidden]){visibility:visible!important}'
  ].join('');
  var style = document.createElement('style');
  style.id = 'tzapp-css'; style.textContent = css;
  // At document start the <html> element may not exist yet: attach as soon as it does.
  var attach = function () {
    var root = document.documentElement; if (!root) return false;
    root.classList.add('tzapp'); (document.head || root).appendChild(style); return true;
  };
  if (!attach()) { var mo = new MutationObserver(function () { if (attach()) mo.disconnect(); }); mo.observe(document, { childList: true, subtree: true }); }

  var P = function () { return window.__stkPaper; };
  var lastToast = 0;

  function state() {
    var p = P(), sym = '', last = null, tf = '';
    try { sym = p ? p.activeSymbol() : ''; last = sym && p ? p.lastPrice(sym) : null; } catch (e) {}
    try { var b = document.querySelector('.vela-mb-tf'); tf = b ? b.textContent.trim() : ''; } catch (e) {}
    var pos = null;
    try { var q = sym && p && p.enabled && p.account ? p.account.position(sym) : null; if (q) pos = { side: q.side, qty: q.qty, avg: q.avg }; } catch (e) {}
    var toasts = [];
    try { var log = (p && p.toasts) || []; for (var i = 0; i < log.length; i++) if (log[i].at > lastToast) toasts.push({ type: log[i].type, msg: log[i].msg }); if (log.length) lastToast = Math.max(lastToast, log[log.length - 1].at); } catch (e) {}
    return {
      t: 'state', ready: !!(window.__stkFirstCandles && p), sym: sym, tf: tf,
      last: typeof last === 'number' && isFinite(last) ? last : null,
      paper: !!(p && p.enabled), pos: pos, signedIn: !!(p && p.uid), uid: window.TZB ? window.TZB.uid() : '', toasts: toasts
    };
  }

  function click(sel) { var b = document.querySelector(sel); if (b) { b.click(); return true; } return false; }

  // ---- symbol search + quotes for the app's watchlist: the site's OWN modules (same pool, ranking and ids) ----
  var JOBS = {};
  var MODS = null;
  function mods() {
    if (MODS) return MODS;
    // same ?v= as the page's own scripts, so these are the page's module instances
    var src = [].map.call(document.scripts, function (s) { return s.src; }).filter(function (s) { return /vela-chart\.js\?v=/.test(s); })[0] || '';
    var v = (/\?v=(\d+)/.exec(src) || [])[1];
    var q = v ? '?v=' + v : '';
    MODS = Promise.all([import('/assets/chart-search-core.js' + q), import('/assets/chart-watchlist.js' + q)]).catch(function (e) { MODS = null; throw e; });
    return MODS;
  }
  function feedReady() {
    return new Promise(function (res, rej) {
      var n = 0; (function wait() { var ws = window.STRYKER_VELA; if (ws && ws.feed && window.__stkFirstCandles) return res(ws); if (++n > 200) return rej(new Error('chart not ready')); setTimeout(wait, 100); })();
    });
  }
  // The site's stock search runs on any typed search box (assets/chart-stocks-provider.js installStockSearch): feed it the query.
  var stockBox = null;
  function askStocks(q) {
    try {
      if (!stockBox) { stockBox = document.createElement('input'); stockBox.className = 'stkss-input'; stockBox.setAttribute('aria-hidden', 'true'); stockBox.tabIndex = -1; stockBox.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0'; document.body.appendChild(stockBox); }
      stockBox.value = q; stockBox.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {}
  }
  var LABEL = { futures: 'Futures', crypto: 'Crypto', forex: 'Forex', indices: 'Index', stocks: 'Stock', other: 'Market' };
  function find(q) {
    return Promise.all([mods(), feedReady()]).then(function (r) {
      var core = r[0][0], wl = r[0][1], ws = r[1], raw = [];
      if (q.trim()) askStocks(q.trim());
      try { raw = ws.feed.symbols() || []; } catch (e) {}
      var pool = raw.filter(function (d) { return d && d.ticker && d.provider !== 'formula'; });
      return core.search(pool, q, 60).map(function (x) {
        var d = x.d, sym = core.symOf(d), m = core.metaOf(d);
        var id = null; try { id = wl.normalizeSymbol(sym, ws.feed); } catch (e) {}
        return { id: id || sym, t: String(d.ticker), n: String(d.description || ''), c: m.c, k: LABEL[m.c] || 'Market', x: core.VENUE_LABEL[m.v] || String(d.exchange || m.v || '').toUpperCase(), tick: Number(d.mintick) || 0 };
      });
    });
  }
  // Last, previous daily close and a 15-minute sparkline, read through the chart's own provider (the site watchlist's quote()).
  function quote(id) {
    return feedReady().then(function (ws) {
      var mm = /^([a-z]+):(.+)$/i.exec(id); if (!mm) throw new Error('id');
      var p = ws.feed.providerInstance(mm[1].toLowerCase()); if (!p || !p.getBars) throw new Error('no provider');
      return Promise.all([p.getBars(mm[2], 'D', { limit: 2 }), p.getBars(mm[2], '15', { limit: 32 }).catch(function () { return []; })]).then(function (r) {
        var d = r[0] || [], i = r[1] || [];
        if (!d.length) throw new Error('no bars');
        var b = function (x) { return [x.time, x.open, x.high, x.low, x.close, x.volume || 0]; };
        return { d: d.map(b), i: i.map(b) };
      });
    });
  }

  window.TZB = {
    state: state,
    setTf: function (tf) { try { return !!window.__stkIntervals.apply(String(tf)); } catch (e) { return false; } },
    // sym is a chart id, e.g. "MNQ1!" (futures) or "binance:BTCUSDT"
    setSymbol: function (sym, ticker) { try { window.__stkSearch.pick({ __sym: sym, ticker: ticker || sym, __formula: true }); return true; } catch (e) { return false; } },
    search: function () { try { window.__stkSearch.open(); return true; } catch (e) { return click('.vela-mb-symbol'); } },
    indicators: function () { return click('.vela-mb-indicators'); },
    drawings: function () { return click('.vela-mb-drawings'); },
    // Saved layouts / indicator templates / workspaces: the site's own sheets, reading and writing the member's account
    // (students/{uid}/chartLayouts, chartTemplates, chartPrefs/workspaces), so they are the same on every device.
    layouts: function () { try { window.STRYKER_LAYOUTS.library.open('mine'); return true; } catch (e) { return false; } },
    templates: function () { return click('#stkc-tpl-btn'); },
    workspaces: function () { return click('#stkws-btn'); },
    // The site's own full chart-settings dialog (gear on its toolbar, assets/chart-settings.js): every site setting, saved by the site to the account.
    settings: function () { return click('#stkc-settings-btn'); },
    alerts: function () { try { window.__stkAlerts.open(); return true; } catch (e) { return false; } },

    // ---- async results: the app starts a job with run(key, ...) and reads take(key) until it is not null ----
    run: function (key, kind, arg) {
      var out = JOBS; out[key] = null;
      var p = kind === 'find' ? find(String(arg || '')) : kind === 'quote' ? quote(String(arg || '')) : Promise.reject(new Error('kind'));
      p.then(function (v) { out[key] = JSON.stringify({ ok: true, v: v }); }, function (e) { out[key] = JSON.stringify({ ok: false, e: String(e && e.message || e).slice(0, 120) }); });
      return true;
    },
    take: function (key) { var v = JOBS[key]; if (v != null) delete JOBS[key]; return v == null ? null : v; },
    paperOn: function () { try { return !!P().setEnabled(true); } catch (e) { return false; } },
    // Paper market order on the active symbol. Rules (market hours, balance, slippage) are the site's paper engine.
    paperOrder: function (side, qty) {
      var p = P(); if (!p || !p.enabled) return false;
      var r = null;
      try { r = p.placeOrder({ symbol: p.activeSymbol(), side: side === 'sell' ? 'sell' : 'buy', type: 'market', qty: Number(qty) }); } catch (e) {}
      return !!r;
    },

    // ---- Trade tab (M3): a read-only snapshot of the site's paper account + the site's own actions ----
    paper: function () {
      var p = P(), a = p && p.account, out = { t: 'paper', ready: !!(window.__stkFirstCandles && a), on: !!(p && p.enabled), signedIn: !!(p && p.uid), sym: '', last: null, spec: null, acct: null, positions: [], orders: [], trades: [] };
      if (!a) return out;
      var lastOf = function (s) { var v = null; try { v = p.lastPrice(s); } catch (e) {} if (!(v > 0)) v = a.last[s]; return typeof v === 'number' && isFinite(v) && v > 0 ? v : null; };
      try {
        out.sym = p.activeSymbol() || '';
        var sp = out.sym ? a.spec(out.sym) : null;
        if (sp && sp.ok) { out.spec = { symbol: sp.symbol, kind: sp.kind, tick: sp.tick, pointValue: sp.pointValue, minQty: sp.minQty, maxQty: sp.maxQty, decimals: sp.decimals }; out.last = lastOf(out.sym) || lastOf(sp.symbol); }
        else if (sp) out.specError = sp.reason;
        var d = new Date(); d.setHours(0, 0, 0, 0);
        var s = a.summary(d.getTime());
        out.acct = { balance: s.balance, equity: s.equity, unrealized: s.unrealized, realized: s.realized, dayPnl: s.dayPnl, start: s.startBalance };
        var st = a.state;
        Object.keys(st.positions).forEach(function (k) {
          var q = st.positions[k], l = lastOf(k);
          out.positions.push({ sym: k, side: q.side, qty: q.qty, avg: q.avg, last: l, pnl: a.openPnl(q, l != null ? l : undefined), sl: q.sl == null ? null : q.sl, tp: q.tp == null ? null : q.tp });
        });
        st.orders.forEach(function (o) { out.orders.push({ id: o.id, sym: o.symbol, side: o.side, type: o.type, qty: o.qty, price: o.price, sl: o.sl == null ? null : o.sl, tp: o.tp == null ? null : o.tp }); });
        st.trades.slice(-20).reverse().forEach(function (t) { out.trades.push({ id: t.id, sym: t.symbol, side: t.side, qty: t.qty, entry: t.entry, exit: t.exit, pnl: t.pnl, exitAt: t.exitAt, reason: t.reason || '' }); });
      } catch (e) {}
      return out;
    },
    // o = {side, type: market|limit|stop, qty, price, sl, tp} on the active chart symbol. The engine validates and toasts.
    order: function (o) {
      var p = P(); if (!p || !p.enabled || !o) return false;
      var r = null;
      try { r = p.placeOrder({ symbol: p.activeSymbol(), side: o.side === 'sell' ? 'sell' : 'buy', type: o.type === 'limit' || o.type === 'stop' ? o.type : 'market', qty: Number(o.qty), price: o.price, sl: o.sl, tp: o.tp }); } catch (e) {}
      return !!r;
    },
    close: function (sym) { try { return !!P().closePos(String(sym)); } catch (e) { return false; } },
    cancel: function (id) { try { return !!P().cancelOrder(Number(id)); } catch (e) { return false; } },
    flatten: function () { try { P().flattenAll(); return true; } catch (e) { return false; } },

    // ---- Native chart (M5): the app draws the chart itself; this page stays the data + indicator engine ----
    // modal: one of the site's own sheets is open (the app then shows the page over the native chart)
    frame: function (full) { var md = false; try { md = window.TZB.modal(); } catch (e) {} try { var f = frame(!!full); f.modal = md; return f; } catch (e) { return { t: 'frame', ready: false, modal: md, err: String(e && e.message || e).slice(0, 120) }; } },
    // Load older history: point the (hidden) chart at its first bars so the site's own history pager fetches more.
    page: function () {
      try { var c = chartOf(), b = c.orchestrator.bars; if (!b || b.length < 2) return false; var span = b[b.length - 1].time - b[0].time; c.setVisibleRange({ from: b[0].time - span * 0.1, to: b[0].time + span * 0.1 }); return true; } catch (e) { return false; }
    },
    live: function () { try { chartOf().scrollToRealTime(); return true; } catch (e) { return false; } },
    // A drawing made on the native chart is stored by the site's own drawings controller (saved with the layout).
    addDrawing: function (type, anchors) {
      try { var c = chartOf(); var d = c.drawings.add(String(type), { anchors: anchors }); try { window.STRYKER_VELA.context().stateChanged(); } catch (e) {} return !!d; } catch (e) { return false; }
    },
    clearDrawings: function () {
      try { var c = chartOf(); c.drawings.all().forEach(function (d) { c.drawings.remove(d.id); }); try { window.STRYKER_VELA.context().stateChanged(); } catch (e) {} return true; } catch (e) { return false; }
    },
    // Sign the chart page in as the app's member (Firebase custom token from the site's own sign-in handoff), so the
    // page asks the server for the member's data access (signed agreement = current futures data) and loads their
    // layouts and paper account. Sign-out follows the app. Fire and forget; the app reads state().signedIn.
    signIn: function (token) {
      try { if (!window.firebase || !firebase.auth) return false; firebase.auth().signInWithCustomToken(String(token)).catch(function () {}); return true; } catch (e) { return false; }
    },
    uid: function () { try { var u = window.firebase && firebase.auth && firebase.auth().currentUser; return u ? u.uid : ''; } catch (e) { return ''; } },
    signOut: function () { try { if (window.firebase && firebase.auth && firebase.auth().currentUser) firebase.auth().signOut(); return true; } catch (e) { return false; } },
    // True while one of the site's own sheets/dialogs is open (the app then shows the page on top of the native chart).
    modal: function () {
      var vis = function (el) { var r = el.getBoundingClientRect(); if (r.width < 40 || r.height < 40) return false; var cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05; };
      var q = document.querySelectorAll('[role=dialog],[aria-modal=true],dialog[open],.stkiw-card,.stkss-box');
      for (var i = 0; i < q.length; i++) if (vis(q[i])) return true;
      return false;
    }
  };

  // ---------------------------------------------------------------------------------------------------
  // frame(): bars + every indicator's computed output, aligned to bar indexes, for the native renderer.
  // Indicator maths stays in the site's engine; this only reads the renderer's scene models.
  // Incremental: when the bar set is unchanged only the last bars and the tail of each series are sent;
  // objects (lines, boxes, labels...) are sent again only when the engine replaced them.
  // ---------------------------------------------------------------------------------------------------
  var FR = { key: '', idx: null, calls: 0, sent: {}, dsig: '' };
  var TAIL = 3;
  function chartOf() { var ws = window.STRYKER_VELA, cell = null; try { cell = ws.cell(ws.active.id); } catch (e) {} return (cell || ws.cells()[0]).chart; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? +v.toPrecision(10) : null; }
  function str(v) { return typeof v === 'string' ? v : (v && typeof v.defaultMessage === 'string' ? v.defaultMessage : ''); }
  function frame(full) {
    var ws = window.STRYKER_VELA;
    if (!ws || !window.__stkFirstCandles) return { t: 'frame', ready: false };
    var c = chartOf(), O = c.orchestrator, R = O.renderer, S = R.scene, bars = O.bars || [], n = bars.length, mk = c.market || {};
    var key = (mk.symbol || '') + '|' + (mk.timeframe || '') + '|' + n + '|' + (n ? bars[0].time : 0);
    FR.calls++;
    var whole = full || key !== FR.key || FR.calls % 240 === 0;   // + a safety resend about once a minute at 4 frames/s
    if (key !== FR.key || !FR.idx) { FR.idx = new Map(); for (var i = 0; i < n; i++) FR.idx.set(bars[i].time, i); }
    if (whole) FR.sent = {};
    FR.key = key;
    var idx = FR.idx, ix = function (t) { var j = idx.get(t); return j == null ? -1 : j; };
    var from = whole ? 0 : Math.max(0, n - TAIL);
    var b = { off: from, t: [], o: [], h: [], l: [], c: [], v: [] };
    for (var k = from; k < n; k++) { var x = bars[k]; b.t.push(x.time); b.o.push(num(x.open)); b.h.push(num(x.high)); b.l.push(num(x.low)); b.c.push(num(x.close)); b.v.push(num(x.volume) || 0); }
    var out = { t: 'frame', ready: true, full: whole, key: key, sym: mk.symbol || '', tf: String(mk.timeframe || ''), tz: S.timezone || '', tick: num(S.priceMintick), n: n, bars: b,
      vol: !!(R.volumeActive && !R.volumeHidden), ids: [], models: [] };
    var ext = {}; (R.extLayers || []).forEach(function (l) { if (l && l.def) { ext[l.def.id] = 1; if (l.def.forType) ext[l.def.forType] = 1; } });
    S.indicators.forEach(function (m) {
      if (!m || (m.native && m.native.type === 'volume')) return;
      out.ids.push(m.id);
      // sig: series ids + two values deep in history, so a recompute (new inputs) forces a whole resend of this model
      var last = FR.sent[m.id], sig = (m.series || []).map(function (s) { var p = s.points || [], q = p.length; return s.id + (q > TAIL + 1 ? ':' + p[q - TAIL - 1].value + ':' + p[q >> 1].value : ''); }).join(',') + '|' + m.paneId;
      var tail = !whole && last && last.sig === sig;
      var o = { id: m.id };
      if (!tail) {
        var nt = m.native && m.native.type;
        o.title = str(m.displayTitle) || str(m.title) || ''; o.pane = m.paneId || 'price';
        if (nt && (ext[nt] || nt === 'vpvr')) o.layer = 1;
      }
      var st = tail ? from : 0;
      o.s = (m.series || []).map(function (s) { return series(s, st, n, ix, tail); });
      var objs = ['fills', 'priceLines', 'backgrounds', 'barColors', 'lines', 'boxes', 'labels', 'polylines', 'linefills', 'tables'];
      var memo = last && tail ? last.objs : {};
      var keep = {};
      objs.forEach(function (name) {
        var arr = m[name]; keep[name] = arr;
        if (tail && memo[name] === arr) return;   // unchanged object list: the app keeps what it has
        o[name] = convert(name, arr || [], m, ix);
      });
      FR.sent[m.id] = { sig: sig, objs: keep };
      out.models.push(o);
    });
    var dr = []; try { dr = c.drawings.all().filter(function (d) { return d.visible !== false; }).map(function (d) { return { id: d.id, type: d.type, pane: d.paneId, a: d.anchors.map(function (p) { return [p.time, num(p.price)]; }), c: d.style && d.style.lineColor, w: d.style && d.style.lineWidth, ls: d.style && d.style.lineStyle, fc: d.style && d.style.fillColor }; }); } catch (e) {}
    var ds = JSON.stringify(dr); if (whole || ds !== FR.dsig) { out.drawings = dr; FR.dsig = ds; }
    return out;
  }
  function series(s, st, n, ix, tail) {
    var o = { id: s.id, k: s.kind };
    if (!tail) {
      var sty = s.style || {};
      o.c = sty.color || null; o.w = sty.width || 1; o.ls = sty.lineStyle || 'solid';
      if (sty.base != null) o.base = num(sty.base);
      if (s.visible === false || (s.display && s.display.pane === false)) o.hide = 1;
      o.title = str(s.displayTitle) || str(s.title) || '';
    }
    o.off = st;
    if (s.kind === 'markers') {
      if (tail) { o.k = 'markers'; o.same = 1; return o; }   // markers are re-sent with full frames only
      o.m = (s.markers || []).map(function (q) { return [ix(q.time), q.position || '', q.shape || '', q.color || '', q.text || '', q.size || '']; }).filter(function (q) { return q[0] >= 0; });
      return o;
    }
    var pts = s.points || [], len = n - st, v = new Array(len).fill(null), pc = null;
    for (var i = pts.length - 1; i >= 0; i--) {
      var p = pts[i], j = ix(p.time); if (j < 0) continue; if (j < st) break;
      v[j - st] = num(p.value);
      if (p.color) { if (!pc) pc = new Array(len).fill(null); pc[j - st] = p.color; }
    }
    o.v = v; if (pc) o.pc = pc;
    return o;
  }
  function xOf(xloc, x, ix) { return xloc === 'bar_time' ? ix(x) : x; }
  function convert(name, arr, m, ix) {
    var ids = (m.series || []).map(function (s) { return s.id; });
    switch (name) {
      case 'fills': return arr.map(function (f) { return { a: ids.indexOf(f.fromSeriesId), b: ids.indexOf(f.toSeriesId), c: f.color || (f.colors && f.colors[0]) || null }; });
      case 'priceLines': return arr.map(function (l) { return { p: num(l.price), c: l.color || null, ls: l.lineStyle || 'dashed', w: l.width || 1, t: str(l.displayTitle) || str(l.title) || '' }; });
      case 'backgrounds': return arr.map(function (g) { return { a: ix(g.from), b: ix(g.to), c: g.color }; }).filter(function (g) { return g.a >= 0; });
      case 'barColors': return arr.map(function (q) { return [ix(q.time), q.color || null]; }).filter(function (q) { return q[0] >= 0 && q[1]; });
      case 'lines': return arr.filter(function (l) { return !l.invisible; }).map(function (l) { return line(l, ix); });
      case 'boxes': return arr.map(function (x) { return { l: xOf(x.xloc, x.left, ix), r: xOf(x.xloc, x.right, ix), t: num(x.top), b: num(x.bottom), bg: x.bgColor || null, bc: x.borderColor || null, bw: x.borderWidth == null ? 1 : x.borderWidth, bs: x.borderStyle || 'solid', ex: x.extend || 'none', tx: x.text || '', tc: x.textColor || null, ts: x.textSize || 'auto', ha: x.hAlign || 'center', va: x.vAlign || 'center' }; });
      case 'labels': return arr.map(function (x) { return { x: xOf(x.xloc, x.x, ix), y: num(x.y), yl: x.yloc || 'price', st: x.style || 'label_down', c: x.noFill ? null : (x.color || null), tx: x.text || '', tc: x.textColor || null, sz: x.size || 'normal' }; });
      case 'polylines': return arr.map(function (p) { return { p: (p.points || []).map(function (q) { return [xOf(q.xloc, q.x, ix), num(q.price)]; }), c: p.lineColor || null, w: p.lineWidth || 1, ls: p.lineStyle || 'solid', cl: !!p.closed, fc: p.fillColor || null }; });
      case 'linefills': return arr.map(function (f) { return { a: line(f.line1, ix), b: line(f.line2, ix), c: f.color || null }; });
      case 'tables': return arr.map(function (t) { return { pos: t.position || 'top_right', bg: t.bgColor || null, cells: (t.cells || []).map(function (row) { return (row || []).map(function (cl) { return cl ? [cl.text || '', cl.textColor || null, cl.bgColor || null] : null; }); }) }; });
    }
    return [];
  }
  function line(l, ix) { return { x1: xOf(l.xloc, l.x1, ix), y1: num(l.y1), x2: xOf(l.xloc, l.x2, ix), y2: num(l.y2), c: l.color || null, w: l.width || 1, st: l.style || 'solid', ex: l.extend || 'none' }; }
})();
