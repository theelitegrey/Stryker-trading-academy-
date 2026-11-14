// TradeZoro — Screener: GEX level columns (call wall / zero gamma / put wall). Classic script, window.StkScanGex.
// Pro only: the levels API itself refuses non-Pro tokens (403), and the page never fetches for a Free member.
// Covers what the GEX levels cover: SPY, QQQ, GLD on the ETF tab; ES, MES, NQ, MNQ, GC, MGC on the Futures tab (levels the API
// converted to that contract). One fetch per market per 5 minutes, shared. Education only. Not financial advice.
(function (root) {
  'use strict';
  var API = '/api/gex/levels/';
  var ETF = { SPY: 'SPY', QQQ: 'QQQ', GLD: 'GLD' };
  var FUT = { ES: 'SPX', MES: 'SPX', NQ: 'QQQ', MNQ: 'QQQ', GC: 'GLD', MGC: 'GLD' };
  var isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  var pick = function (l) { return l && (isNum(l.call_wall) || isNum(l.zero_gamma) || isNum(l.put_wall)) ? { cw: isNum(l.call_wall) ? l.call_wall : null, zg: isNum(l.zero_gamma) ? l.zero_gamma : null, pw: isNum(l.put_wall) ? l.put_wall : null } : null; };
  // API responses { SPX: data, SPY: data, ... } -> { 'SPY': {cw,zg,pw}, 'ES': {...} } keyed by ticker. Pure.
  function levelsOf(resp) {
    var out = {};
    Object.keys(ETF).forEach(function (t) { var l = pick(resp[ETF[t]]); if (l) out[t] = l; });
    Object.keys(FUT).forEach(function (t) {
      var d = resp[FUT[t]], f = d && d.futures && d.futures[t];
      var l = pick(f && !f.error && f.levels);
      if (l) out[t] = l;
    });
    return out;
  }
  var cache = null, at = 0, inflight = null;
  function load(force) {
    if (inflight) return inflight;
    if (!force && cache && Date.now() - at < 290000) return Promise.resolve(cache);
    inflight = import('./rt-access.js?v=988').then(function (rt) { return rt.rtHeadersReady(); }).then(function (hd) {
      return Promise.all(['SPX', 'SPY', 'QQQ', 'GLD'].map(function (m) {
        return fetch(API + m + '?dte=0', { headers: Object.assign({ accept: 'application/json' }, hd) }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
      }));
    }).then(function (arr) {
      var resp = { SPX: arr[0], SPY: arr[1], QQQ: arr[2], GLD: arr[3] };
      cache = levelsOf(resp); at = Date.now(); inflight = null; return cache;
    }, function () { inflight = null; return cache || {}; });
    return inflight;
  }
  var api = { levelsOf: levelsOf, load: load, ETF: ETF, FUT: FUT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.StkScanGex = api;
})(typeof window !== 'undefined' ? window : globalThis);
