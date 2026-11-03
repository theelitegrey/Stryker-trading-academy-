// TradeZoro — Screener engine (pure, no DOM). Loaded by scanner.html before assets/scanner.js; also required by
// tools/tests/screener-core.test.js. Owner-approved 2026-11-03 (full screener, all markets).
// Holds: the field catalogue (what each column / filter is), derived values, the filter engine (above / below /
// between / equals / crosses / text), column sets, access gating (order-flow = futures L2 gate, GEX levels = Pro),
// preset screens, the chart-symbol mapping, and the share-link codec. Copy rules: plain English, no vendor names.
(function (root) {
  'use strict';
  var isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  var ALL = ['stock', 'etf', 'crypto', 'fut'];
  var MARKETS = [['stock', 'Stocks'], ['etf', 'ETFs'], ['crypto', 'Crypto'], ['fut', 'Futures']];

  // ---- field catalogue -------------------------------------------------------------------------------------------
  // k key, l column label, g filter group, f format, m markets, gate ('l2' order flow | 'gex' GEX levels), t 'cat' = text,
  // x = for the cross filters: the price-average column this position is measured against.
  var F = [];
  function def(k, l, g, f, m, o) { var d = { k: k, l: l, g: g, f: f, m: m || ALL }; if (o) for (var i in o) d[i] = o[i]; F.push(d); }
  var SE = ['stock', 'etf'], SEC = ['stock', 'etf', 'crypto'], SC = ['stock', 'crypto'], SEF = ['stock', 'etf', 'fut'];
  var NOF = ['stock', 'etf', 'crypto'];
  // price & volume
  def('c', 'Price', 'Price & volume', 'px');
  def('chg', 'Change 1D %', 'Price & volume', 'pct');
  def('chgAbs', 'Size of 1D move %', 'Price & volume', 'n2');
  def('gap', 'Gap %', 'Price & volume', 'pct');
  def('vol', 'Volume', 'Price & volume', 'big');
  def('rvol', 'Relative volume', 'Price & volume', 'x', SEF);
  def('av', 'Avg volume 30D', 'Price & volume', 'big', ['stock', 'etf', 'fut']);
  def('adv', 'Avg traded value (30D)', 'Price & volume', 'big', NOF);
  def('dv', 'Traded value', 'Price & volume', 'big', NOF);
  // performance
  def('perfW', 'Change 5D %', 'Performance', 'pct');
  def('perfWm', 'Change 5D minus 1M %', 'Performance', 'pct');
  def('perfM', 'Change 1M %', 'Performance', 'pct');
  def('perfQ', 'Change 3M %', 'Performance', 'pct', ['stock', 'etf', 'fut']);
  def('perfYtd', 'Change YTD %', 'Performance', 'pct');
  def('perfY', 'Change 1Y %', 'Performance', 'pct');
  def('hi52', '52-week high', 'Performance', 'px');
  def('lo52', '52-week low', 'Performance', 'px');
  def('off52h', 'Below 52-week high %', 'Performance', 'n2');
  def('off52l', 'Above 52-week low %', 'Performance', 'n2');
  def('r52', 'Position in 52-week range %', 'Performance', 'n1');
  def('w52', '52-week range width %', 'Performance', 'n1');
  def('hiAtr', 'Distance to 52-week high (ATRs)', 'Performance', 'n1');
  def('loAtr', 'Distance to 52-week low (ATRs)', 'Performance', 'n1');
  // technicals
  def('rsi', 'RSI (14)', 'Technicals', 'n1');
  def('atr', 'ATR (14)', 'Technicals', 'px', ALL);
  def('atrp', 'ATR (14) % of price', 'Technicals', 'n2');
  [['s', 'SMA'], ['e', 'EMA']].forEach(function (t) {
    [20, 50, 200].forEach(function (n) {
      var k = (t[0] === 's' ? 'sma' : 'ema') + n, pk = 'p' + k.toUpperCase();
      def(k, t[1] + ' ' + n, 'Moving averages', 'px', ALL);
      def(pk, 'Price vs ' + t[1] + ' ' + n + ' %', 'Moving averages', 'pct', ALL, { x: k });
    });
  });
  def('s50v200', 'SMA 50 vs SMA 200 %', 'Moving averages', 'pct');
  def('s20v50', 'SMA 20 vs SMA 50 %', 'Moving averages', 'pct');
  def('e20v50', 'EMA 20 vs EMA 50 %', 'Moving averages', 'pct');
  def('e50v200', 'EMA 50 vs EMA 200 %', 'Moving averages', 'pct');
  def('s20v200', 'SMA 20 vs SMA 200 %', 'Moving averages', 'pct');
  def('e20v200', 'EMA 20 vs EMA 200 %', 'Moving averages', 'pct');
  def('s50ve50', 'SMA 50 vs EMA 50 %', 'Moving averages', 'pct');
  def('s200ve200', 'SMA 200 vs EMA 200 %', 'Moving averages', 'pct');
  def('maSpread', 'Spread of 20/50/200 SMAs % of price', 'Moving averages', 'n2');
  def('pS20Atr', 'Price vs SMA 20 (in ATRs)', 'Moving averages', 'n1');
  def('pS50Atr', 'Price vs SMA 50 (in ATRs)', 'Moving averages', 'n1');
  def('pS200Atr', 'Price vs SMA 200 (in ATRs)', 'Moving averages', 'n1');
  def('gapAtr', 'Gap size (in ATRs)', 'Price & volume', 'n1');
  def('chgAtr', '1D move (in ATRs)', 'Price & volume', 'n1');
  def('perfYvY', 'Change 1Y minus YTD %', 'Performance', 'pct');
  def('perfQvM', 'Change 3M minus 1M %', 'Performance', 'pct', ['stock', 'etf', 'fut']);
  // valuation & events
  def('cap', 'Market cap', 'Valuation', 'big', SC);
  def('pe', 'P/E (trailing)', 'Valuation', 'n1', ['stock']);
  def('dy', 'Dividend yield %', 'Valuation', 'n2', ['stock']);
  def('beta', 'Beta (1 year)', 'Valuation', 'n2', SE);
  def('earn', 'Next earnings date', 'Valuation', 'date', ['stock'], { nofilter: true });
  def('earnD', 'Days to earnings', 'Valuation', 'int', ['stock']);
  // text
  def('sec', 'Sector', 'Category', 'txt', ['stock', 'fut'], { t: 'cat' });
  def('ind', 'Industry', 'Category', 'txt', ['stock'], { t: 'cat' });
  def('exch', 'Exchange', 'Category', 'txt', ['stock', 'etf', 'crypto', 'fut'], { t: 'cat' });
  // order flow (futures L2, same gate as the L2 indicators) and GEX levels (Pro)
  def('imb', 'Book imbalance', 'Order flow', 'n2', ['fut'], { gate: 'l2' });
  def('bw', 'Nearest bid wall', 'Order flow', 'px', ['fut'], { gate: 'l2', nofilter: true });
  def('bwS', 'Bid wall size', 'Order flow', 'big', ['fut'], { gate: 'l2' });
  def('aw', 'Nearest ask wall', 'Order flow', 'px', ['fut'], { gate: 'l2', nofilter: true });
  def('awS', 'Ask wall size', 'Order flow', 'big', ['fut'], { gate: 'l2' });
  def('delta', 'Delta (last 6 h)', 'Order flow', 'sbig', ['fut'], { gate: 'l2' });
  def('bigN', 'Big trades (since you opened this)', 'Order flow', 'int', ['fut'], { gate: 'l2' });
  def('cw', 'Call wall', 'GEX levels', 'px', ['etf', 'fut'], { gate: 'gex', nofilter: true });
  def('zg', 'Zero gamma', 'GEX levels', 'px', ['etf', 'fut'], { gate: 'gex', nofilter: true });
  def('pw', 'Put wall', 'GEX levels', 'px', ['etf', 'fut'], { gate: 'gex', nofilter: true });

  var BY = {}; F.forEach(function (d) { BY[d.k] = d; });

  // ---- access gating -------------------------------------------------------------------------------------------------
  // ctx = { l2: bool (futures L2 gate: admin now, Pro when TS_ACCESS flips), pro: bool }. A gated column is never part of the
  // visible list unless its gate is open; the page shows a locked chip (paywall on tap) for the 'gex' / 'l2' groups instead.
  function open(d, ctx) { return !d.gate || (d.gate === 'l2' ? !!(ctx && ctx.l2) : !!(ctx && ctx.pro)); }
  function fieldsFor(m, ctx) { return F.filter(function (d) { return d.m.indexOf(m) !== -1 && open(d, ctx); }); }
  function filterFieldsFor(m, ctx) { return fieldsFor(m, ctx).filter(function (d) { return !d.nofilter && !d.hide; }); }
  function allFor(m) { return F.filter(function (d) { return d.m.indexOf(m) !== -1; }); }
  function gateCols(keys, m, ctx) { return keys.filter(function (k) { var d = BY[k]; return d && d.m.indexOf(m) !== -1 && open(d, ctx); }); }

  // ---- column sets -----------------------------------------------------------------------------------------------------
  var SETS = {
    overview: { l: 'Overview', c: { stock: ['c', 'chg', 'vol', 'rvol', 'cap', 'pe', 'sec'], etf: ['c', 'chg', 'vol', 'rvol', 'av', 'perfYtd'], crypto: ['c', 'chg', 'vol', 'cap', 'perfW', 'perfYtd'], fut: ['c', 'chg', 'vol', 'rvol', 'gap', 'sec'] } },
    perf: { l: 'Performance', c: { stock: ['chg', 'perfW', 'perfM', 'perfQ', 'perfYtd', 'perfY', 'off52h', 'r52'], etf: ['chg', 'perfM', 'perfQ', 'perfYtd', 'perfY', 'off52h', 'r52'], crypto: ['chg', 'perfW', 'perfM', 'perfYtd', 'perfY', 'off52h', 'r52'], fut: ['chg', 'perfW', 'perfM', 'perfQ', 'perfYtd', 'perfY', 'off52h', 'r52'] } },
    tech: { l: 'Technicals', c: { stock: ['rsi', 'atrp', 'pSMA20', 'pSMA50', 'pSMA200', 's50v200', 'gap'], etf: ['rsi', 'atrp', 'pSMA20', 'pSMA50', 'pSMA200', 's50v200', 'gap'], crypto: ['rsi', 'atrp', 'pSMA20', 'pSMA50', 'pSMA200', 's50v200', 'gap'], fut: ['rsi', 'atrp', 'pSMA20', 'pSMA50', 'pSMA200', 's50v200', 'gap'] } },
    val: { l: 'Valuation', c: { stock: ['cap', 'pe', 'dy', 'beta', 'earn', 'earnD', 'ind'], etf: ['beta', 'av', 'perfYtd'], crypto: ['cap', 'dv', 'perfYtd'] } },
    flow: { l: 'Order flow', c: { fut: ['imb', 'bw', 'bwS', 'aw', 'awS', 'delta', 'bigN'] } },
    gexs: { l: 'GEX levels', c: { etf: ['cw', 'zg', 'pw'], fut: ['cw', 'zg', 'pw'] } }
  };
  function setKeys(id, m, ctx) { var s = SETS[id]; return s && s.c[m] ? gateCols(s.c[m], m, ctx) : []; }
  // sets listed for a market; gated ones are shown (as locked) only for the markets that have them
  function setsFor(m) { return Object.keys(SETS).filter(function (id) { return SETS[id].c[m]; }); }
  function setLocked(id, m, ctx) { var s = SETS[id]; return !!(s && s.c[m] && gateCols(s.c[m], m, ctx).length === 0); }

  // ---- derived values ------------------------------------------------------------------------------------------------------
  var pctOf = function (a, b) { return isNum(a) && isNum(b) && b !== 0 ? (a / b - 1) * 100 : null; };
  // A 1D move beyond +/-300% is almost always bad source data (ticker change, split, stale previous close). It is kept only when the
  // name trades heavily (volume > 1M; for crypto traded value > $1M) AND the previous close was above $1. Otherwise the move is
  // blanked (shown as a dash, never matches a change filter), so one bad row cannot top Top gainers.
  function cleanMove(r, m) {
    if (!isNum(r.chg) || Math.abs(r.chg) <= 300 || !isNum(r.c)) return;
    var prev = r.c / (1 + r.chg / 100), heavy = m === 'crypto' ? isNum(r.vol) && r.vol * r.c > 1e6 : isNum(r.vol) && r.vol > 1e6;
    if (!(heavy && prev > 1)) { r.chg = null; r.gap = isNum(r.gap) && Math.abs(r.gap) > 300 ? null : r.gap; r.bad = 1; }
  }
  function enrich(r, nowSec, m) {
    cleanMove(r, m);
    var c = r.c;
    r.perfWm = isNum(r.perfW) && isNum(r.perfM) ? r.perfW - r.perfM : null;
    r.chgAbs = isNum(r.chg) ? Math.abs(r.chg) : null;
    r.dv = isNum(c) && isNum(r.vol) ? c * r.vol : null;
    r.off52h = isNum(c) && isNum(r.hi52) && r.hi52 > 0 ? (1 - c / r.hi52) * 100 : null;
    r.off52l = isNum(c) && isNum(r.lo52) && r.lo52 > 0 ? (c / r.lo52 - 1) * 100 : null;
    r.w52 = isNum(r.hi52) && isNum(r.lo52) && r.lo52 > 0 ? (r.hi52 / r.lo52 - 1) * 100 : null;
    r.hiAtr = isNum(r.atr) && r.atr > 0 && isNum(c) && isNum(r.hi52) ? (r.hi52 - c) / r.atr : null;
    r.loAtr = isNum(r.atr) && r.atr > 0 && isNum(c) && isNum(r.lo52) ? (c - r.lo52) / r.atr : null;
    r.adv = isNum(c) && isNum(r.av) ? c * r.av : null;
    r.r52 = isNum(c) && isNum(r.hi52) && isNum(r.lo52) && r.hi52 > r.lo52 ? (c - r.lo52) / (r.hi52 - r.lo52) * 100 : null;
    ['sma20', 'sma50', 'sma200', 'ema20', 'ema50', 'ema200'].forEach(function (k) { r['p' + k.toUpperCase()] = pctOf(c, r[k]); });
    r.s50v200 = pctOf(r.sma50, r.sma200); r.s20v50 = pctOf(r.sma20, r.sma50); r.e20v50 = pctOf(r.ema20, r.ema50); r.e50v200 = pctOf(r.ema50, r.ema200);
    r.s20v200 = pctOf(r.sma20, r.sma200); r.e20v200 = pctOf(r.ema20, r.ema200); r.s50ve50 = pctOf(r.sma50, r.ema50); r.s200ve200 = pctOf(r.sma200, r.ema200);
    var mas = [r.sma20, r.sma50, r.sma200].filter(isNum);
    r.maSpread = mas.length === 3 && isNum(c) && c > 0 ? (Math.max.apply(null, mas) - Math.min.apply(null, mas)) / c * 100 : null;
    var ok = isNum(r.atr) && r.atr > 0 && isNum(c);
    r.pS20Atr = ok && isNum(r.sma20) ? (c - r.sma20) / r.atr : null; r.pS50Atr = ok && isNum(r.sma50) ? (c - r.sma50) / r.atr : null; r.pS200Atr = ok && isNum(r.sma200) ? (c - r.sma200) / r.atr : null;
    r.gapAtr = ok && isNum(r.gap) ? c * r.gap / 100 / r.atr : null; r.chgAtr = ok && isNum(r.chg) ? c * r.chg / 100 / r.atr : null;
    r.perfYvY = isNum(r.perfY) && isNum(r.perfYtd) ? r.perfY - r.perfYtd : null; r.perfQvM = isNum(r.perfQ) && isNum(r.perfM) ? r.perfQ - r.perfM : null;
    r.atrp = isNum(r.atr) && isNum(c) && c > 0 ? r.atr / c * 100 : null;
    if (!r.exch) r.exch = symParts(r.s).ex || null;
    if (isNum(r.earn)) { var dd = (r.earn - (nowSec || Date.now() / 1000)) / 86400; r.earnD = dd >= -0.5 ? Math.max(0, Math.ceil(dd)) : null; }
    return r;
  }
  // exchange from the symbol code ("NASDAQ:AAPL" -> NASDAQ) when the feed did not send one
  function symParts(s) { var t = String(s || '').split(':'); return { ex: t.length > 1 ? t[0] : '', t: t[t.length - 1] }; }

  // ---- filters ----------------------------------------------------------------------------------------------------------------
  // Operators: gt lt ge le  (number) · bt (between a and b) · eq (number, ±0.5%) · cu / cd (price crosses UP / DOWN through the
  // field's average today) · is / not (text: one of, comma list) · has (text contains).
  var OPS = {
    gt: 'above', lt: 'below', bt: 'between', cu: 'crosses above', cd: 'crosses below'
  };
  function opsFor(d) {
    if (!d) return [];
    if (d.t === 'cat') return [['is', 'is'], ['not', 'is not'], ['has', 'contains']];
    var o = [['gt', 'above'], ['lt', 'below'], ['bt', 'between']];
    if (d.x) o.push(['cu', 'crosses above'], ['cd', 'crosses below']);
    return o;
  }
  function clean(x, m, ctx) {
    var d = x && BY[x.f];
    if (!d || d.nofilter || d.hide || d.m.indexOf(m) === -1 || !open(d, ctx)) return null;
    var op = x.op, ok = opsFor(d).some(function (o) { return o[0] === op; });
    if (!ok) return null;
    if (d.t === 'cat') { var v = String(x.v == null ? '' : x.v).trim().slice(0, 80); return v ? { f: d.k, op: op, v: v } : null; }
    if (op === 'cu' || op === 'cd') return { f: d.k, op: op };
    var a = Number(x.v); if (x.v === '' || x.v == null || !isFinite(a)) return null;
    if (op === 'bt') { var b = Number(x.v2); if (x.v2 === '' || x.v2 == null || !isFinite(b)) return null; return { f: d.k, op: op, v: Math.min(a, b), v2: Math.max(a, b) }; }
    return { f: d.k, op: op, v: a };
  }
  function crossed(r, d, up) {
    // price crossed the average today: yesterday's close was on the other side, now it is on this side
    var ma = r[d.x], c = r.c, chg = r.chg;
    if (!isNum(ma) || !isNum(c) || !isNum(chg) || chg <= -100) return false;
    var prev = c / (1 + chg / 100);
    return up ? (prev <= ma && c > ma) : (prev >= ma && c < ma);
  }
  function buildFilter(filters, m, ctx) {
    var fs = (filters || []).map(function (x) { return clean(x, m, ctx); }).filter(Boolean);
    return {
      n: fs.length, list: fs,
      test: function (r) {
        for (var i = 0; i < fs.length; i++) {
          var x = fs[i], d = BY[x.f], a = r[x.f];
          if (x.op === 'cu' || x.op === 'cd') { if (!crossed(r, d, x.op === 'cu')) return false; continue; }
          if (d.t === 'cat') {
            var s = String(a == null ? '' : a).toLowerCase(), w = x.v.toLowerCase();
            var any = w.split(',').map(function (z) { return z.trim(); }).filter(Boolean);
            var hit = x.op === 'has' ? s.indexOf(w) !== -1 : any.indexOf(s) !== -1;
            if (x.op === 'not') { if (!s || hit) return false; } else if (!hit) return false;
            continue;
          }
          if (!isNum(a)) return false;
          if (x.op === 'gt' && !(a > x.v)) return false;
          if (x.op === 'lt' && !(a < x.v)) return false;
          if (x.op === 'bt' && !(a >= x.v && a <= x.v2)) return false;
        }
        return true;
      }
    };
  }
  function sortRows(rows, k, dir) {
    if (!k) return rows;
    var txt = BY[k] && BY[k].t === 'cat' || k === 's';
    return rows.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (txt) { x = x == null ? '' : String(x); y = y == null ? '' : String(y); if (!x && !y) return 0; if (!x) return 1; if (!y) return -1; return x.localeCompare(y) * dir; }
      if (!isNum(x) && !isNum(y)) return 0;
      if (!isNum(x)) return 1;
      if (!isNum(y)) return -1;
      return (x - y) * dir;
    });
  }

  // ---- preset screens (quick screens on top of the screener) -----------------------------------------------------------------
  // The feeder still sends its ranked preset lists; these are the same ideas as ordinary filters so they edit like any screen.
  var BASE_LIQ = [{ f: 'c', op: 'gt', v: 1 }, { f: 'vol', op: 'gt', v: 1e5 }, { f: 'dv', op: 'gt', v: 1e6 }];
  var PRESETS = [
    { id: 'gainers', m: 'stock', t: 'Top gainers', flt: BASE_LIQ.concat([{ f: 'chg', op: 'gt', v: 0 }]), sort: ['chg', -1] },
    { id: 'losers', m: 'stock', t: 'Top losers', flt: BASE_LIQ.concat([{ f: 'chg', op: 'lt', v: 0 }]), sort: ['chg', 1] },
    { id: 'unusual', m: 'stock', t: 'Unusual volume', flt: BASE_LIQ.concat([{ f: 'rvol', op: 'gt', v: 2 }]), sort: ['rvol', -1] },
    { id: 'high52', m: 'stock', t: 'Near 52-week high', flt: BASE_LIQ.concat([{ f: 'off52h', op: 'lt', v: 0.5 }]), sort: ['chg', -1] },
    { id: 'low52', m: 'stock', t: 'Near 52-week low', flt: BASE_LIQ.concat([{ f: 'off52l', op: 'lt', v: 0.5 }]), sort: ['chg', 1] },
    { id: 'gapup', m: 'stock', t: 'Gap up', flt: BASE_LIQ.concat([{ f: 'gap', op: 'gt', v: 2 }]), sort: ['gap', -1] },
    { id: 'gapdown', m: 'stock', t: 'Gap down', flt: BASE_LIQ.concat([{ f: 'gap', op: 'lt', v: -2 }]), sort: ['gap', 1] },
    { id: 'rsihigh', m: 'stock', t: 'RSI above 70', flt: BASE_LIQ.concat([{ f: 'rsi', op: 'gt', v: 70 }]), sort: ['rsi', -1], set: 'tech' },
    { id: 'rsilow', m: 'stock', t: 'RSI below 30', flt: BASE_LIQ.concat([{ f: 'rsi', op: 'lt', v: 30 }]), sort: ['rsi', 1], set: 'tech' },
    { id: 'goldx', m: 'stock', t: 'Price crossed above SMA 50', flt: BASE_LIQ.concat([{ f: 'pSMA50', op: 'cu' }]), sort: ['dv', -1], set: 'tech' },
    { id: 'divs', m: 'stock', t: 'Dividend payers', flt: BASE_LIQ.concat([{ f: 'dy', op: 'gt', v: 3 }, { f: 'cap', op: 'gt', v: 2e9 }]), sort: ['dy', -1], set: 'val' },
    { id: 'earn', m: 'stock', t: 'Earnings this week', flt: BASE_LIQ.concat([{ f: 'earnD', op: 'bt', v: 0, v2: 7 }]), sort: ['cap', -1], set: 'val' },
    { id: 'etfup', m: 'etf', t: 'ETF gainers', flt: BASE_LIQ.concat([{ f: 'chg', op: 'gt', v: 0 }]), sort: ['chg', -1] },
    { id: 'etfdown', m: 'etf', t: 'ETF losers', flt: BASE_LIQ.concat([{ f: 'chg', op: 'lt', v: 0 }]), sort: ['chg', 1] },
    { id: 'cryptoup', m: 'crypto', t: 'Crypto gainers', flt: [{ f: 'cap', op: 'gt', v: 50e6 }, { f: 'chg', op: 'gt', v: 0 }], sort: ['chg', -1] },
    { id: 'cryptodown', m: 'crypto', t: 'Crypto losers', flt: [{ f: 'cap', op: 'gt', v: 50e6 }, { f: 'chg', op: 'lt', v: 0 }], sort: ['chg', 1] },
    { id: 'cryptorsi', m: 'crypto', t: 'RSI below 30', flt: [{ f: 'cap', op: 'gt', v: 50e6 }, { f: 'rsi', op: 'lt', v: 30 }], sort: ['rsi', 1], set: 'tech' },
    { id: 'futup', m: 'fut', t: 'Futures gainers', flt: [{ f: 'chg', op: 'gt', v: 0 }], sort: ['chg', -1] },
    { id: 'futdown', m: 'fut', t: 'Futures losers', flt: [{ f: 'chg', op: 'lt', v: 0 }], sort: ['chg', 1] },
    { id: 'futidx', m: 'fut', t: 'Index futures', flt: [{ f: 'sec', op: 'is', v: 'Index' }], sort: ['dv', -1] }
  ];
  function presetsFor(m) { return PRESETS.filter(function (p) { return p.m === m; }); }
  function presetById(id) { return PRESETS.filter(function (p) { return p.id === id; })[0] || null; }

  // ---- chart symbol (same mapping as the chart search: binance:/coinbase: venues, idx:, futures:) --------------------------
  var FUT_ROOTS = ['NQ', 'MNQ', 'ES', 'MES', 'YM', 'MYM', 'RTY', 'M2K', 'GC', 'MGC', 'SI', 'SIL', 'HG', 'MHG', 'CL', 'MCL', 'NG', 'ZN', 'ZB', '6E'];
  var IDX_SYMS = ['SPX', 'NDX', 'VIX', 'RUT', 'QQQ', 'SPY', 'IWM', 'DIA'];
  function chartSymbol(row, m) {
    var p = symParts(row && row.s), t = p.t.toUpperCase(), ex = p.ex.toUpperCase();
    if (!t) return null;
    if (m === 'crypto') return (ex === 'BINANCE' || ex === 'COINBASE') && /^[A-Z0-9]{2,20}$/.test(t) ? ex.toLowerCase() + ':' + t : null;
    if (m === 'fut') { var r = t.replace(/1!$/, ''); return FUT_ROOTS.indexOf(r) !== -1 ? 'futures:' + r + '1!' : null; }
    return IDX_SYMS.indexOf(t) !== -1 && /^(NASDAQ|NYSE|AMEX|ARCA|CBOE|)$/.test(ex) ? 'idx:' + t : null;
  }

  // ---- share link / saved screen codec -----------------------------------------------------------------------------------------
  // A screen = { m, flt:[{f,op,v,v2}], sort:[k,dir], cols:[keys] | null, set:'overview' }. Sanitised on the way in AND out, so a
  // pasted link can never carry anything but known fields / operators / short values.
  var MAXF = 12, MAXC = 24;
  function sanitize(sc, ctx) {
    var m = sc && ALL.indexOf(sc.m) !== -1 ? sc.m : 'stock';
    var out = { m: m, flt: [], sort: null, cols: null, set: 'overview' };
    (Array.isArray(sc && sc.flt) ? sc.flt : []).slice(0, MAXF).forEach(function (x) { var c = clean(x, m, ctx || { l2: true, pro: true }); if (c) out.flt.push(c); });
    if (sc && Array.isArray(sc.sort) && BY[sc.sort[0]] && BY[sc.sort[0]].m.indexOf(m) !== -1) out.sort = [sc.sort[0], sc.sort[1] > 0 ? 1 : -1];
    if (sc && sc.set && SETS[sc.set] && SETS[sc.set].c[m]) out.set = sc.set;
    if (sc && Array.isArray(sc.cols)) { var cs = sc.cols.filter(function (k) { return BY[k] && BY[k].m.indexOf(m) !== -1 && !BY[k].hide; }).slice(0, MAXC); if (cs.length) out.cols = cs; }
    return out;
  }
  function b64e(s) { var b = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'); return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64d(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8'); }
  function encodeScreen(sc) { return b64e(JSON.stringify(sanitize(sc))); }
  function decodeScreen(str) { try { if (!str || String(str).length > 4000) return null; return sanitize(JSON.parse(b64d(str))); } catch (e) { return null; } }

  // ---- formatting ----------------------------------------------------------------------------------------------------------------
  function fmt(v, f) {
    if (f === 'txt') return v == null || v === '' ? '—' : String(v);
    if (!isNum(v)) return '—';
    if (f === 'pct') return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
    if (f === 'x') return v.toFixed(2) + '×';
    if (f === 'n1') return v.toFixed(1);
    if (f === 'n2') return v.toFixed(2);
    if (f === 'int') return String(Math.round(v));
    if (f === 'date') { var d = new Date(v * 1000); return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
    if (f === 'big') {
      var a = Math.abs(v);
      if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
      if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
      if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
      return String(Math.round(v));
    }
    if (f === 'px') return Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(4);
    return String(v);
  }
  function agoText(t, now) {
    if (!isNum(t) || !t) return '';
    var m = Math.max(0, Math.floor(((now || Date.now()) / 1000 - t) / 60));
    if (m < 1) return 'Updated just now';
    if (m < 60) return 'Updated ' + m + ' min ago';
    var h = Math.floor(m / 60);
    return h < 24 ? 'Updated ' + h + ' h ago' : 'Updated ' + Math.floor(h / 24) + ' days ago';
  }
  // The feed's column names -> the names used here. The feed's names are the screener's names; ATR is in price units and atrp is derived.
  var ALIAS = {};
  // columnar table { n, cols, d } -> row objects, enriched (market m adds exchange / group)
  function rowsOfTable(t, m, nowSec) {
    var out = [], n = t.n, d = t.d, cols = t.cols;
    for (var i = 0; i < n; i++) {
      var o = {};
      for (var j = 0; j < cols.length; j++) o[ALIAS[cols[j]] || cols[j]] = d[cols[j]][i];
      var p = symParts(o.s);
      o.exch = exchName(p.ex);
      if (m === 'fut') o.grp = o.sec;
      out.push(enrich(o, nowSec, m));
    }
    return out;
  }
  function exchName(e) { return { CME_MINI: 'CME', CBOT_MINI: 'CBOT', COMEX_MINI: 'COMEX' }[e] || e; }
  // one filter as a short sentence for its chip
  function shortV(d, v) {
    if (!isNum(Number(v)) || v === '' || v == null) return v;
    var n = Number(v), a = Math.abs(n);
    if (d && (d.f === 'big') ) {
      if (a >= 1e12) return +(n / 1e12).toFixed(2) + 'T';
      if (a >= 1e9) return +(n / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return +(n / 1e6).toFixed(2) + 'M';
      if (a >= 1e3) return +(n / 1e3).toFixed(1) + 'K';
    }
    return v;
  }
  function describe(x) {
    var d = BY[x.f]; if (!d) return '';
    if (x.op === 'cu') return d.l.replace(/^Price vs /, 'Price crossed above ').replace(/ %$/, '');
    if (x.op === 'cd') return d.l.replace(/^Price vs /, 'Price crossed below ').replace(/ %$/, '');
    var lbl = d.l.replace(/ %$/, ' %');
    if (d.t === 'cat') return lbl + ' ' + (x.op === 'not' ? 'is not ' : x.op === 'has' ? 'contains ' : 'is ') + x.v;
    if (x.op === 'bt') return lbl + ' between ' + shortV(d, x.v) + ' and ' + shortV(d, x.v2);
    return lbl + ' ' + (x.op === 'gt' ? 'above ' : 'below ') + shortV(d, x.v);
  }

  // rows to draw for a virtual list: first / last index for a scroll position (+ overscan each side). Pure.
  function windowOf(total, rowH, scrollTop, viewH, over) {
    over = over == null ? 6 : over;
    var a = Math.max(0, Math.floor(scrollTop / rowH) - over), b = Math.min(total, Math.ceil((scrollTop + viewH) / rowH) + over);
    a = Math.min(a, total);
    return { first: a, last: Math.max(a, b) };
  }

  var api = {
    windowOf: windowOf,
    ALL: ALL, MARKETS: MARKETS, FIELDS: F, BY: BY, SETS: SETS, PRESETS: PRESETS, FUT_ROOTS: FUT_ROOTS, IDX_SYMS: IDX_SYMS, MAXF: MAXF,
    fieldsFor: fieldsFor, filterFieldsFor: filterFieldsFor, allFor: allFor, gateCols: gateCols, setKeys: setKeys, setsFor: setsFor, setLocked: setLocked,
    enrich: enrich, symParts: symParts, opsFor: opsFor, clean: clean, buildFilter: buildFilter, sortRows: sortRows, presetsFor: presetsFor, presetById: presetById,
    chartSymbol: chartSymbol, sanitize: sanitize, encodeScreen: encodeScreen, decodeScreen: decodeScreen, fmt: fmt, agoText: agoText, rowsOfTable: rowsOfTable,
    describe: describe, shortV: shortV, isNum: isNum
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.stkScreener = api;
})(typeof window !== 'undefined' ? window : this);
