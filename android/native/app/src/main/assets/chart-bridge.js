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

  var css = [
    // the site toolbar stays in the DOM (its buttons open the indicator / drawing sheets) but off screen
    '.stkc-bar{position:absolute!important;top:-400px!important;left:0!important;visibility:hidden!important}',
    '.tzc,.appnav-dock,.mobile-topnav,.stkchart-credit,.stkcps-handle,.skip-link{display:none!important}',
    'body{padding-bottom:0!important}'
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
      paper: !!(p && p.enabled), pos: pos, signedIn: !!(p && p.uid), toasts: toasts
    };
  }

  function click(sel) { var b = document.querySelector(sel); if (b) { b.click(); return true; } return false; }

  window.TZB = {
    state: state,
    setTf: function (tf) { try { return !!window.__stkIntervals.apply(String(tf)); } catch (e) { return false; } },
    // sym is a chart id, e.g. "MNQ1!" (futures) or "binance:BTCUSDT"
    setSymbol: function (sym, ticker) { try { window.__stkSearch.pick({ __sym: sym, ticker: ticker || sym, __formula: true }); return true; } catch (e) { return false; } },
    search: function () { try { window.__stkSearch.open(); return true; } catch (e) { return click('.vela-mb-symbol'); } },
    indicators: function () { return click('.vela-mb-indicators'); },
    drawings: function () { return click('.vela-mb-drawings'); },
    alerts: function () { try { window.__stkAlerts.open(); return true; } catch (e) { return false; } },
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
    flatten: function () { try { P().flattenAll(); return true; } catch (e) { return false; } }
  };
})();
