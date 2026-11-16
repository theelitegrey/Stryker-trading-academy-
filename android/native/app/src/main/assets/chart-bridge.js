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
    }
  };
})();
