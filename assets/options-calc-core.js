// TradeZoro: Options P&L calculator maths (pure, no DOM, no network). Used by assets/options-calc.js and assets/options-skew.js.
// Black-Scholes with r = 4.5 %, q = 0 (the same constants as the ZoroOptions feeder). Everything here is an ESTIMATE for education.
// Leg: { side: 1 buy | -1 sell, type: 'C' | 'P' | 'S' (100 shares), K, days (calendar days to expiry), qty, px (entry price per share), iv (decimal) }.
// Position size: qty * 100 per leg. P&L is in dollars. Tests: tools/tests/options-calc-core.test.mjs. Education only. Not financial advice.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.OptCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var R = 0.045, Q = 0, MULT = 100, MIN_DAYS = 0.25;
  var fin = function (v) { return typeof v === 'number' && isFinite(v); };

  // Standard normal CDF (Abramowitz and Stegun 26.2.17, error < 7.5e-8) and density.
  function npdf(x) { return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }
  function ncdf(x) {
    var t = 1 / (1 + 0.2316419 * Math.abs(x));
    var p = npdf(x) * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x >= 0 ? 1 - p : p;
  }
  function d12(S, K, T, v) {
    var sq = v * Math.sqrt(T), d1 = (Math.log(S / K) + (R - Q + v * v / 2) * T) / sq;
    return [d1, d1 - sq];
  }
  // Option value per share. T in years; T <= 0 or v <= 0 gives intrinsic value.
  function price(type, S, K, T, v) {
    if (!(T > 0) || !(v > 0)) return Math.max(0, type === 'C' ? S - K : K - S);
    var d = d12(S, K, T, v), eq = Math.exp(-Q * T), er = Math.exp(-R * T);
    return type === 'C' ? S * eq * ncdf(d[0]) - K * er * ncdf(d[1]) : K * er * ncdf(-d[1]) - S * eq * ncdf(-d[0]);
  }
  // Greeks per share: delta, gamma, theta per calendar day ($), vega per 1 volatility point ($).
  function greeks(type, S, K, T, v) {
    if (!(T > 0) || !(v > 0)) {
      var itm = type === 'C' ? S > K : S < K;
      return { delta: itm ? (type === 'C' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
    }
    var d = d12(S, K, T, v), sq = Math.sqrt(T), er = Math.exp(-R * T), pdf = npdf(d[0]);
    var th = -S * pdf * v / (2 * sq) - (type === 'C' ? 1 : -1) * R * K * er * ncdf((type === 'C' ? 1 : -1) * d[1]);
    return { delta: type === 'C' ? ncdf(d[0]) : ncdf(d[0]) - 1, gamma: pdf / (S * v * sq), theta: th / 365, vega: S * pdf * sq / 100 };
  }

  // ---- a leg valued at spot S, t days from now, with IV multiplied by ivMult ----
  function remaining(leg, t) { return leg.days - t; }
  function legValue(leg, S, t, ivMult) {
    if (leg.type === 'S') return S;
    var rem = remaining(leg, t);
    return price(leg.type, S, leg.K, rem / 365, rem > 0 ? leg.iv * (ivMult || 1) : 0);
  }
  function legPnl(leg, S, t, ivMult) { return leg.side * leg.qty * MULT * (legValue(leg, S, t, ivMult) - leg.px); }
  function pnl(legs, S, t, ivMult) { var s = 0; for (var i = 0; i < legs.length; i++) s += legPnl(legs[i], S, t, ivMult); return s; }
  // Model price a leg would have today (T floored so a 0DTE option still has a little time value).
  function entryPrice(type, S, K, days, iv) { return type === 'S' ? S : price(type, S, K, Math.max(days, MIN_DAYS) / 365, iv); }

  // ---- implied-volatility lookup from the IV surface { m: moneyness[], days: [], z: [[iv by m] per expiry] } ----
  function fillRow(r) {
    var o = r.slice(), last = null, i;
    for (i = 0; i < o.length; i++) { if (fin(o[i])) last = o[i]; else o[i] = last; }
    last = null; for (i = o.length - 1; i >= 0; i--) { if (fin(o[i])) last = o[i]; else o[i] = last; }
    return o;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function surfaceIV(surf) {
    var rows = surf.z.map(fillRow), m = surf.m, d = surf.days;
    var rowAt = function (j, mono) {
      var x = Math.max(m[0], Math.min(m[m.length - 1], mono)), i = 0;
      while (i < m.length - 2 && x > m[i + 1]) i++;
      return lerp(rows[j][i], rows[j][i + 1], (x - m[i]) / ((m[i + 1] - m[i]) || 1));
    };
    return function (K, S, days) {
      var j = 0; while (j < d.length - 2 && days > d[j + 1]) j++;
      if (d.length === 1) return rowAt(0, K / S);
      var t = Math.max(0, Math.min(1, (days - d[j]) / ((d[j + 1] - d[j]) || 1)));
      return lerp(rowAt(j, K / S), rowAt(j + 1, K / S), t);
    };
  }

  // ---- strikes and expiries ----
  function strikeStep(S) { return S < 25 ? 0.5 : S < 100 ? 1 : S < 250 ? 2.5 : S < 1000 ? 5 : 5; }
  function roundK(S, step) { return Math.round(S / step) * step; }
  function pickExpiry(exps, target, minDays) { // exps: [{days}] ascending; the one closest to target with days >= minDays
    var best = null;
    exps.forEach(function (e) { if (e.days >= (minDays || 0) && (best == null || Math.abs(e.days - target) < Math.abs(best.days - target))) best = e; });
    return best || exps[exps.length - 1];
  }

  // Preset templates. mk(side, type, K, exp, qty) is supplied by the caller so it can price the leg.
  var PRESETS = [
    ['long-call', 'Long call'], ['long-put', 'Long put'], ['bull-call', 'Bull call spread'], ['bear-put', 'Bear put spread'],
    ['straddle', 'Straddle'], ['strangle', 'Strangle'], ['iron-condor', 'Iron condor'], ['butterfly', 'Butterfly'],
    ['calendar', 'Calendar'], ['covered-call', 'Covered call']
  ];
  function presetLegs(id, S, exps) {
    var st = strikeStep(S), atm = roundK(S, st), n = Math.max(1, Math.round(S * 0.03 / st)) * st, w = Math.max(1, Math.round(S * 0.06 / st)) * st;
    var e1 = pickExpiry(exps, 30, 0), e0 = pickExpiry(exps, 10, 0), e2 = pickExpiry(exps, Math.max(60, e0.days + 20), e0.days + 1);
    var L = function (side, type, K, e) { return { side: side, type: type, K: K, exp: e, qty: 1 }; };
    switch (id) {
      case 'long-call': return [L(1, 'C', atm, e1)];
      case 'long-put': return [L(1, 'P', atm, e1)];
      case 'bull-call': return [L(1, 'C', atm, e1), L(-1, 'C', atm + n, e1)];
      case 'bear-put': return [L(1, 'P', atm, e1), L(-1, 'P', atm - n, e1)];
      case 'straddle': return [L(1, 'C', atm, e1), L(1, 'P', atm, e1)];
      case 'strangle': return [L(1, 'P', atm - n, e1), L(1, 'C', atm + n, e1)];
      case 'iron-condor': return [L(1, 'P', atm - n - w, e1), L(-1, 'P', atm - n, e1), L(-1, 'C', atm + n, e1), L(1, 'C', atm + n + w, e1)];
      case 'butterfly': return [L(1, 'C', atm - n, e1), L(-1, 'C', atm, e1), L(-1, 'C', atm, e1), L(1, 'C', atm + n, e1)];
      case 'calendar': return [L(-1, 'C', atm, e0), L(1, 'C', atm, e2)];
      case 'covered-call': return [L(1, 'S', 0, e1), L(-1, 'C', atm + n, e1)];
    }
    return [];
  }

  // ---- analysis of the position at expiry of the first leg to expire ----
  function firstDays(legs) { var d = Infinity; legs.forEach(function (l) { if (l.type !== 'S') d = Math.min(d, l.days); }); return isFinite(d) ? d : 0; }
  function netCost(legs) { var s = 0; legs.forEach(function (l) { s += l.side * l.qty * MULT * l.px; }); return s; } // > 0 = debit paid, < 0 = credit
  function avgIV(legs, ivMult) {
    var s = 0, n = 0; legs.forEach(function (l) { if (l.type !== 'S' && fin(l.iv)) { s += l.iv * (ivMult || 1) * l.qty; n += l.qty; } });
    return n ? s / n : null;
  }
  function viewRange(legs, S, ivMult) {
    var Ks = legs.filter(function (l) { return l.type !== 'S'; }).map(function (l) { return l.K; });
    var iv = avgIV(legs, ivMult) || 0.25, maxD = 0; legs.forEach(function (l) { maxD = Math.max(maxD, l.days); });
    var w = Math.max(0.08, Math.min(0.5, 2.2 * iv * Math.sqrt(Math.max(maxD, 1) / 365)));
    var lo = Math.min.apply(null, [S * (1 - w)].concat(Ks.map(function (k) { return k * 0.97; })));
    var hi = Math.max.apply(null, [S * (1 + w)].concat(Ks.map(function (k) { return k * 1.03; })));
    return [Math.max(S * 0.02, lo), hi];
  }
  function curve(legs, S0, lo, hi, n, t, ivMult) {
    var out = []; for (var i = 0; i <= n; i++) { var s = lo + (hi - lo) * i / n; out.push([s, pnl(legs, s, t, ivMult)]); }
    return out;
  }
  // P(S_T in (a, b)) for a lognormal S_T with drift r - q, volatility v, horizon T years.
  function probBetween(S, a, b, T, v) {
    var cdf = function (x) { return x <= 0 ? 0 : x === Infinity ? 1 : ncdf((Math.log(x / S) - (R - Q - v * v / 2) * T) / (v * Math.sqrt(T))); };
    return cdf(b) - cdf(a);
  }
  function analyse(legs, S, ivMult) {
    if (!legs.length) return null;
    var tE = firstDays(legs), Ks = legs.map(function (l) { return l.K; }).filter(function (k) { return k > 0; });
    var hiBig = Math.max(S * 4, (Ks.length ? Math.max.apply(null, Ks) : 0) * 3), N = 4000;
    var pts = curve(legs, S, 0, hiBig, N, tE, ivMult);
    Ks.forEach(function (k) { pts.push([k, pnl(legs, k, tE, ivMult)]); });
    pts.sort(function (a, b) { return a[0] - b[0]; });
    var up = 0; legs.forEach(function (l) { if (l.type === 'C' || l.type === 'S') up += l.side * l.qty; });
    var mx = -Infinity, mn = Infinity;
    pts.forEach(function (p, i) { if (i === pts.length - 1 && up !== 0) return; mx = Math.max(mx, p[1]); mn = Math.min(mn, p[1]); });
    var be = [];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      if ((a[1] < 0) !== (b[1] < 0) && a[1] !== b[1]) be.push(a[0] + (b[0] - a[0]) * (0 - a[1]) / (b[1] - a[1]));
    }
    var out = { days: tE, cost: netCost(legs), breakEvens: be, maxProfit: up > 0 ? Infinity : mx, maxLoss: up < 0 ? -Infinity : mn, pop: null, iv: avgIV(legs, ivMult) };
    var v = out.iv, T = Math.max(tE, MIN_DAYS) / 365;
    if (v && S > 0) {
      var edges = [0].concat(be, [Infinity]), p = 0;
      for (var j = 0; j < edges.length - 1; j++) {
        var mid = edges[j + 1] === Infinity ? Math.max(edges[j] * 1.5, hiBig) : (edges[j] + edges[j + 1]) / 2;
        if (pnl(legs, mid, tE, ivMult) > 0) p += probBetween(S, edges[j], edges[j + 1], T, v);
      }
      out.pop = Math.max(0, Math.min(1, p));
    }
    return out;
  }
  // Net greeks of the position at day t (dollars; delta in shares).
  function posGreeks(legs, S, t, ivMult) {
    var g = { delta: 0, gamma: 0, theta: 0, vega: 0 }, rows = [];
    legs.forEach(function (l) {
      var q = l.side * l.qty * MULT, x;
      if (l.type === 'S') x = { delta: 1, gamma: 0, theta: 0, vega: 0 };
      else { var rem = remaining(l, t); x = greeks(l.type, S, l.K, rem / 365, rem > 0 ? l.iv * (ivMult || 1) : 0); }
      var r = { delta: x.delta * q, gamma: x.gamma * q, theta: x.theta * q, vega: x.vega * q };
      rows.push(r); Object.keys(g).forEach(function (k) { g[k] += r[k]; });
    });
    return { net: g, legs: rows };
  }

  // ---- IV skew and term structure helpers (feeder summary.term rows: [expiry, days, atm, put25, call25]) ----
  function termRows(term) {
    return (term || []).map(function (r) {
      var p = fin(r[3]) ? r[3] * 100 : null, c = fin(r[4]) ? r[4] * 100 : null;
      return { exp: r[0], days: r[1], atm: fin(r[2]) ? r[2] * 100 : null, p25: p, c25: c, rr: p != null && c != null ? c - p : null };
    });
  }
  // Risk reversal convention used here: 25-delta CALL IV minus 25-delta PUT IV (negative = puts cost more).
  function smile(surf, j) { return { m: surf.m.map(function (m) { return Math.round((m - 1) * 1000) / 10; }), iv: fillRow(surf.z[j]).map(function (v) { return fin(v) ? v * 100 : null; }) }; }

  return { R: R, Q: Q, MULT: MULT, ncdf: ncdf, npdf: npdf, price: price, greeks: greeks, legValue: legValue, legPnl: legPnl, pnl: pnl, entryPrice: entryPrice,
    surfaceIV: surfaceIV, strikeStep: strikeStep, roundK: roundK, pickExpiry: pickExpiry, PRESETS: PRESETS, presetLegs: presetLegs, analyse: analyse,
    posGreeks: posGreeks, curve: curve, viewRange: viewRange, firstDays: firstDays, netCost: netCost, avgIV: avgIV, probBetween: probBetween,
    termRows: termRows, smile: smile, fillRow: fillRow };
});
