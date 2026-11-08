// Zoro for Vest: pure logic (no DOM, no network). Sizing, points -> price, brackets, copy fan-out, rate limiter,
// change detection (response shapes), settings caps, levels link parsing. Loaded in the page bundle and by the unit tests.
// Education only. Not financial advice.
(function (root) {
  'use strict';

  // ---- hard limits (the member can lower these, never raise them) -------------------------------------------------------------------
  var HARD = { maxNotionalUsd: 250000, maxFollowers: 10, maxOrdersPerMin: 60 };
  var DEFAULTS = {
    maxNotionalUsd: 5000, maxFollowers: 3, maxOrdersPerMin: 20, sizing: 'equal', mirrorVestForm: true,
    master: null, followers: [], theme: 'auto', showLevels: true, panelX: null, panelY: null,
  };
  var TERMS_VERSION = 1;

  function num(x) { var n = typeof x === 'string' ? Number(x.trim()) : x; return typeof n === 'number' && isFinite(n) ? n : NaN; }
  function intIn(x, lo, hi, dflt) { var n = Math.floor(num(x)); return isFinite(n) && n >= lo ? Math.min(n, hi) : dflt; }

  function clampSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    var o = {};
    o.maxNotionalUsd = intIn(s.maxNotionalUsd, 1, HARD.maxNotionalUsd, DEFAULTS.maxNotionalUsd);
    o.maxFollowers = intIn(s.maxFollowers, 0, HARD.maxFollowers, DEFAULTS.maxFollowers);
    o.maxOrdersPerMin = intIn(s.maxOrdersPerMin, 1, HARD.maxOrdersPerMin, DEFAULTS.maxOrdersPerMin);
    o.sizing = s.sizing === 'balance' ? 'balance' : 'equal';
    o.mirrorVestForm = s.mirrorVestForm !== false;
    o.master = typeof s.master === 'string' && s.master.length < 100 ? s.master : null;
    o.followers = Array.isArray(s.followers) ? s.followers.filter(function (f) { return typeof f === 'string' && f.length < 100 && f !== o.master; }).slice(0, HARD.maxFollowers) : [];
    o.theme = ['dark', 'light'].indexOf(s.theme) >= 0 ? s.theme : 'auto';
    o.showLevels = s.showLevels !== false;
    o.panelX = isFinite(num(s.panelX)) ? num(s.panelX) : null;
    o.panelY = isFinite(num(s.panelY)) ? num(s.panelY) : null;
    return o;
  }

  // ---- decimals: work in integer units so 0.1 + 0.2 never leaks into an order ---------------------------------------------------------
  function pow10(d) { return Math.pow(10, d); }
  function toUnits(x, dec) { return Math.round(num(x) * pow10(dec)); }
  function fromUnits(u, dec) {
    var neg = u < 0, s = String(Math.abs(u));
    if (dec === 0) return (neg ? '-' : '') + s;
    while (s.length <= dec) s = '0' + s;
    var a = s.slice(0, s.length - dec), b = s.slice(s.length - dec).replace(/0+$/, '');
    return (neg ? '-' : '') + (b ? a + '.' + b : a);
  }
  function decimalsOf(step) { var s = String(step); if (/e-/i.test(s)) return Number(s.split(/e-/i)[1]); var i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }

  // price rounded to the market's tick. mode: 'near' | 'down' | 'up'
  function roundToTick(price, tick, priceDecimals, mode) {
    var d = Math.max(priceDecimals, decimalsOf(tick));
    var p = toUnits(price, d), t = toUnits(tick, d);
    if (!(t > 0) || !isFinite(p)) return null;
    var q = mode === 'down' ? Math.floor(p / t) : mode === 'up' ? Math.ceil(p / t) : Math.round(p / t);
    return fromUnits(q * t, d);
  }

  // size: always rounded DOWN to the size step (never more than asked)
  function floorSize(qty, sizeDecimals) {
    var u = Math.floor(num(qty) * pow10(sizeDecimals) + 1e-7);
    return u > 0 ? fromUnits(u, sizeDecimals) : '0';
  }

  // ---- points from entry -> price ---------------------------------------------------------------------------------------------------
  // kind 'stop': long below entry, short above. kind 'target': the other way. Returns a price string or null when invalid.
  function pointsToPrice(o) {
    var entry = num(o.entry), pts = num(o.points);
    if (!(entry > 0) || !(pts > 0)) return null;
    var below = (o.kind === 'stop') === !!o.isLong;
    var raw = below ? entry - pts : entry + pts;
    if (!(raw > 0)) return null;
    return roundToTick(raw, o.tick, o.priceDecimals, 'near');
  }

  // $ risk -> contracts. Vest perps are linear: 1 contract moves $1 per 1 point. Rounded down to the size step.
  function sizeFromRisk(o) {
    var risk = num(o.riskUsd), pts = num(o.stopPoints);
    if (!(risk > 0) || !(pts > 0)) return '0';
    return floorSize(risk / pts, o.sizeDecimals);
  }

  // Full bracket for one order. targets: [points, points?]. Two targets split the size in half (last leg takes the remainder).
  // -> { stop: price|null, targets: [{ price, qty|null }], riskUsd } or { error }
  function bracket(o) {
    var spec = o.spec, isLong = !!o.isLong;
    var q = toUnits(o.qty, spec.sizeDecimals);
    if (!(q > 0)) return { error: 'Size must be more than 0.' };
    var out = { stop: null, targets: [], riskUsd: null };
    if (num(o.stopPoints) > 0) {
      out.stop = pointsToPrice({ entry: o.entry, points: o.stopPoints, isLong: isLong, kind: 'stop', tick: spec.tick, priceDecimals: spec.priceDecimals });
      if (!out.stop) return { error: 'Stop is beyond zero. Use fewer points.' };
      out.riskUsd = Math.abs(num(o.entry) - num(out.stop)) * num(o.qty);
    }
    var tp = (o.targetPoints || []).map(num).filter(function (x) { return x > 0; });
    if (tp.length > 2) return { error: 'Two targets at most.' };
    var legs = tp.length === 2 ? [Math.floor(q / 2), q - Math.floor(q / 2)] : [q];
    if (tp.length === 2 && legs[0] < 1) return { error: 'Size is too small to split into two targets.' };
    for (var i = 0; i < tp.length; i++) {
      var price = pointsToPrice({ entry: o.entry, points: tp[i], isLong: isLong, kind: 'target', tick: spec.tick, priceDecimals: spec.priceDecimals });
      if (!price) return { error: 'Target ' + (i + 1) + ' is not valid.' };
      out.targets.push({ price: price, qty: tp.length === 2 ? fromUnits(legs[i], spec.sizeDecimals) : null });
    }
    return out;
  }

  // ---- copy sizing --------------------------------------------------------------------------------------------------------------------
  // mode 'equal' = same size as the master (1:1). 'balance' = master size x follower balance / master balance. Rounded down.
  function followerQty(o) {
    var mq = num(o.masterQty);
    if (!(mq > 0)) return '0';
    if (o.mode !== 'balance') return floorSize(mq, o.sizeDecimals);
    var mb = num(o.masterBalance), fb = num(o.followerBalance);
    if (!(mb > 0) || !(fb > 0)) return '0';
    return floorSize(mq * fb / mb, o.sizeDecimals);
  }

  function scaleLegs(legs, ratio, sizeDecimals) {
    return (legs || []).map(function (l) {
      var c = {}; for (var k in l) c[k] = l[k];
      if (l.quantity != null) c.quantity = floorSize(num(l.quantity) * ratio, sizeDecimals);
      return c;
    }).filter(function (l) { return l.quantity == null || num(l.quantity) > 0; });
  }

  // Plan the follower copies of one master action.
  // action: { kind, symbol, qty (master size, string|null), body }   accounts: [{ id, balance, enabled }]
  // -> [{ accountId, qty, ratio, skip: reason|null }] in follower order; followers past maxFollowers are skipped.
  function planFanout(action, followers, o) {
    var out = [], used = 0;
    (followers || []).forEach(function (f) {
      if (!f.enabled) return;
      if (used >= o.maxFollowers) { out.push({ accountId: f.id, skip: 'Over the follower limit (' + o.maxFollowers + ').' }); return; }
      used++;
      if (action.qty == null) { out.push({ accountId: f.id, qty: null, ratio: 1, skip: null }); return; }
      var q = followerQty({ masterQty: action.qty, mode: o.sizing, masterBalance: o.masterBalance, followerBalance: f.balance, sizeDecimals: o.sizeDecimals });
      var ratio = num(q) / num(action.qty);
      out.push({ accountId: f.id, qty: q, ratio: ratio, skip: num(q) > 0 ? null : 'Size rounds to 0 for this account.' });
    });
    return out;
  }

  // ---- order checks before anything is sent ---------------------------------------------------------------------------------------------
  function checkOrder(o) {
    var q = num(o.qty), px = num(o.price);
    if (!(q > 0)) return 'Size must be more than 0.';
    if (toUnits(q, o.spec.sizeDecimals) / pow10(o.spec.sizeDecimals) !== q) return 'Size has too many decimals for this market.';
    if (!(px > 0)) return 'No price for this market right now.';
    if (q * px > o.maxNotionalUsd) return 'Order value $' + Math.round(q * px).toLocaleString('en-US') + ' is over your limit of $' + o.maxNotionalUsd.toLocaleString('en-US') + '.';
    return null;
  }

  // ---- rate limiter: sliding 60 s window over every order request sent (all accounts together) -----------------------------------------
  function RateLimiter(perMin, now) {
    this.perMin = perMin; this.now = now || Date.now; this.t = [];
  }
  RateLimiter.prototype.prune = function () { var c = this.now() - 60000; while (this.t.length && this.t[0] <= c) this.t.shift(); };
  RateLimiter.prototype.room = function () { this.prune(); return Math.max(0, this.perMin - this.t.length); };
  RateLimiter.prototype.take = function (n) {
    n = n || 1; this.prune();
    if (this.t.length + n > this.perMin) return false;
    var at = this.now(); for (var i = 0; i < n; i++) this.t.push(at);
    return true;
  };

  // ---- change detection: refuse to trade when Vest's answers no longer look like what this version was built against -------------------
  // schema: { key: 'string'|'number'|'boolean'|'any'|'string?'|[schema]|{...} }. Returns the list of paths that do not match.
  function shapeErrors(v, schema, path) {
    path = path || '$';
    var errs = [];
    if (Array.isArray(schema)) {
      if (!Array.isArray(v)) return [path + ' is not a list'];
      for (var i = 0; i < Math.min(v.length, 5); i++) errs = errs.concat(shapeErrors(v[i], schema[0], path + '[' + i + ']'));
      return errs;
    }
    if (typeof schema === 'object') {
      if (!v || typeof v !== 'object') return [path + ' is missing'];
      for (var k in schema) errs = errs.concat(shapeErrors(v[k], schema[k], path + '.' + k));
      return errs;
    }
    var opt = /\?$/.test(schema), t = schema.replace('?', '');
    if (v === undefined || v === null) return opt ? [] : [path + ' is missing'];
    if (t === 'any') return [];
    if (t === 'numstr') return (typeof v === 'string' || typeof v === 'number') && isFinite(Number(v)) ? [] : [path + ' is not a number'];
    return typeof v === t ? [] : [path + ' is ' + typeof v + ', expected ' + t];
  }

  var LEG = { id: 'string', executionType: 'string', triggerPrice: 'numstr' };
  var SCHEMAS = {
    exchangeInfo: { symbols: [{ symbol: 'string', sizeDecimals: 'number', priceDecimals: 'number', minTickSize: 'numstr', tradingStatus: 'string' }] },
    ticker: { tickers: [{ symbol: 'string', markPrice: 'numstr' }] },
    accounts: { accounts: [{ account_id: 'string', account_type: 'any', amount: 'numstr' }] },
    positions: { positions: [{ positionId: 'string', symbol: 'string', side: 'string', quantity: 'numstr', openPrice: 'numstr', takeProfits: [LEG], stopLosses: [LEG] }] },
    orders: { orders: [{ id: 'string', symbol: 'string', status: 'string' }] },
    accountToken: { accessToken: 'string' },
    orderAck: { commandId: 'any' },
  };
  // the endpoints this version uses; every one must still appear in Vest's own page code, or trading stays off
  var ENDPOINTS = ['/v3/positions/open', '/v3/positions/append', '/v3/positions/reduce', '/v3/positions/close', '/v3/positions/cancel-order',
    '/v3/positions/opened', '/v3/positions/opened-orders', '/v3/auth/account-token', '/v3/accounts', '/v3/exchangeInfo', 'take-profit', 'stop-loss'];
  // quoted, so "/v3/positions/open" is not satisfied by "/v3/positions/opened"
  function missingEndpoints(bundleText) { var t = String(bundleText); return ENDPOINTS.filter(function (e) { return t.indexOf('"' + e + '"') < 0; }); }

  // ---- tokens (read the expiry only; nothing is verified or stored) ----------------------------------------------------------------------
  function jwtPayload(tok) {
    try {
      var p = String(tok).split('.')[1]; if (!p) return null;
      p = p.replace(/-/g, '+').replace(/_/g, '/'); while (p.length % 4) p += '=';
      var s = typeof atob === 'function' ? atob(p) : Buffer.from(p, 'base64').toString('binary');
      var j = JSON.parse(decodeURIComponent(s.split('').map(function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')));
      return j && typeof j === 'object' ? j : null;
    } catch (e) { return null; }
  }
  function tokenExpMs(tok, fallbackMs) { var p = jwtPayload(tok); return p && isFinite(p.exp) ? p.exp * 1000 : fallbackMs; }

  // ---- TradeZoro levels ---------------------------------------------------------------------------------------------------------------
  var LEVELS_ORIGIN = 'https://tradezoro.com';
  // Vest's index perps track the cash index (checked against SPY/QQQ marks), not futures, so ES/NQ levels would sit off by the basis.
  // The feed has no NDX: NDX gets the QQQ levels moved to NDX's scale with Vest's own two mark prices (said under the list).
  var LV_MAP = { 'SPX-USD-PERP': 'SPX', 'NDX-USD-PERP': 'QQQ', 'SPY-USD-PERP': 'SPY', 'QQQ-USD-PERP': 'QQQ' };
  var LV_SCALE = { 'NDX-USD-PERP': 'QQQ-USD-PERP' };
  function levelsSymbol(vestSym) { return LV_MAP[vestSym] || null; }
  function levelsScaleFrom(vestSym) { return LV_SCALE[vestSym] || null; }
  // levels moved by ratio of two marks; null when either mark is missing (then nothing is drawn rather than guessed)
  function scaleLevels(levels, ratio, priceDecimals) {
    if (!(ratio > 0) || !isFinite(ratio)) return null;
    var f = Math.pow(10, priceDecimals == null ? 2 : priceDecimals);
    return levels.map(function (l) { return Object.assign({}, l, { price: Math.round(l.price * ratio * f) / f }); });
  }
  // the member pastes the private link from tradezoro.com/platform-levels; only the secret is kept, the host is always ours
  function parseLevelsLink(s) {
    var m = /\/api\/lv\/feed\/([A-Za-z0-9_-]{43})\.[a-z]{2,6}/.exec(String(s || '').trim());
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{43}$/.test(String(s || '').trim()) ? String(s).trim() : null;
  }
  function levelsUrl(secret, u) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || ['SPX', 'SPY', 'QQQ', 'ES', 'NQ'].indexOf(u) < 0) return null;
    return LEVELS_ORIGIN + '/api/lv/feed/' + secret + '.json?u=' + u + '&inc=gex,em,nodes,dp';
  }
  var LEVELS_SCHEMA = { symbol: 'string', updated: 'string', levels: [{ type: 'string', label: 'string', price: 'number', color: 'string?' }] };
  function minsAgo(iso, now) { var t = Date.parse(iso); if (!isFinite(t)) return null; return Math.max(0, Math.round(((now || Date.now()) - t) / 60000)); }
  function agoText(m) { return m === null ? '' : m < 1 ? 'updated just now' : m < 60 ? 'updated ' + m + ' min ago' : 'updated ' + Math.round(m / 60) + ' h ago'; }

  function shortId(id) { return '…' + String(id || '').slice(-4); }

  var api = {
    HARD: HARD, DEFAULTS: DEFAULTS, TERMS_VERSION: TERMS_VERSION, SCHEMAS: SCHEMAS, ENDPOINTS: ENDPOINTS, LEVELS_SCHEMA: LEVELS_SCHEMA,
    clampSettings: clampSettings, toUnits: toUnits, fromUnits: fromUnits, decimalsOf: decimalsOf, roundToTick: roundToTick, floorSize: floorSize,
    pointsToPrice: pointsToPrice, sizeFromRisk: sizeFromRisk, bracket: bracket, followerQty: followerQty, scaleLegs: scaleLegs,
    planFanout: planFanout, checkOrder: checkOrder, RateLimiter: RateLimiter, shapeErrors: shapeErrors, missingEndpoints: missingEndpoints,
    jwtPayload: jwtPayload, tokenExpMs: tokenExpMs, levelsSymbol: levelsSymbol, levelsScaleFrom: levelsScaleFrom, scaleLevels: scaleLevels, parseLevelsLink: parseLevelsLink, levelsUrl: levelsUrl,
    minsAgo: minsAgo, agoText: agoText, shortId: shortId, num: num,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZV_CORE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
