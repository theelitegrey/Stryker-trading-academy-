// TradeZoro — Market Stats engine (pure functions, no DOM). Classic script; also loads under Node for tests
// (module.exports). Used by assets/market-stats.js (the page).
//
// Statistics engine based on LuxAlgo Edge Stats (MIT), https://github.com/LuxAlgo/edge-stats
// Copyright (c) 2026 LuxAlgo Global, LLC
// MIT License: Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
// associated documentation files (the "Software"), to deal in the Software without restriction, including without
// limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
// Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of
// the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
// LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
// SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
// CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.
//
// What is taken from Edge Stats: the idea of an outcome with an explicit denominator ("eligibility") and numerator
// ("success"), the Wilson 95% interval on every proportion, the minimum-sample guards (warn below 30, withhold below
// 10), the first-half / second-half stability split with a CI-overlap flag, per-year counts, and the gap-size buckets
// (xs < 0.15 %, s 0.15-0.3, m 0.3-0.75, l 0.75-1.5, xl >= 1.5 of the prior close). The code is our own TypeScript-free
// re-implementation over per-session rows built by workers/book-recorder/ms-feeder/ms_feeder.py.
//
// Row columns (see COLS): d YYYYMMDD, dow 0=Mon, o/h/l/c RTH session, pdh/pdl/pdc prior session, gf minutes from the open
// until the gap closed (-1 never / no gap), o15*/o30* opening range (h, l, first-break dir 1 up / -1 down / 2 both in one
// bar / 0 none, minutes to the break, extension in points), ib* initial balance (first hour), thi/tlo minutes to first
// touch of the prior high / low, bhi/blo minutes to the first CLOSE beyond them.
(function (root) {
  'use strict';
  var COLS = ['d', 'dow', 'o', 'h', 'l', 'c', 'pdh', 'pdl', 'pdc', 'gf', 'o15h', 'o15l', 'o15d', 'o15t', 'o15x', 'o30h', 'o30l', 'o30d', 'o30t', 'o30x',
    'ibh', 'ibl', 'ibd', 'ibt', 'ibx', 'ibu', 'ibw', 'ibxu', 'ibxd', 'thi', 'tlo', 'bhi', 'blo'];
  var WARN_N = 30, REFUSE_N = 10, Z = 1.959964;
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  var BUCKETS = [['xs', 'XS', 0, 0.15], ['s', 'S', 0.15, 0.3], ['m', 'M', 0.3, 0.75], ['l', 'L', 0.75, 1.5], ['xl', 'XL', 1.5, Infinity]];
  var BUCKET_TEXT = { xs: 'under 0.15%', s: '0.15 to 0.3%', m: '0.3 to 0.75%', l: '0.75 to 1.5%', xl: '1.5% and over' };

  // ---- rows ------------------------------------------------------------------------------------------------------
  function toRows(part) {
    var cols = part.cols, out = [];
    for (var i = 0; i < part.rows.length; i++) {
      var r = part.rows[i], o = {};
      for (var j = 0; j < cols.length; j++) o[cols[j]] = r[j];
      o.date = dateStr(o.d);
      o.gapPct = o.pdc ? (o.o - o.pdc) / o.pdc * 100 : 0;
      o.bucket = o.o === o.pdc ? 'none' : bucketOf(Math.abs(o.gapPct));
      out.push(o);
    }
    out.sort(function (a, b) { return a.d - b.d; });
    return out;
  }
  function dateStr(d) { var s = String(d); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
  function bucketOf(a) { for (var i = 0; i < BUCKETS.length; i++) if (a >= BUCKETS[i][2] && a < BUCKETS[i][3]) return BUCKETS[i][0]; return 'xl'; }

  // ---- statistics ------------------------------------------------------------------------------------------------
  // Wilson score interval for k successes in n trials (95%).
  function wilson(k, n) {
    if (!n) return { p: null, lo: null, hi: null };
    var p = k / n, z2 = Z * Z, d = 1 + z2 / n;
    var c = (p + z2 / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d;
    return { p: p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
  }
  // Distribution-free 95% interval for the median (order statistics). v sorted ascending.
  function medianCI(v) {
    var n = v.length;
    if (!n) return null;
    var m = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
    var j = Math.floor(n / 2 - Z * Math.sqrt(n) / 2), k = Math.ceil(1 + n / 2 + Z * Math.sqrt(n) / 2);
    return { med: m, lo: v[Math.max(0, j - 1)], hi: v[Math.min(n - 1, k - 1)] };
  }
  function quantile(v, q) {
    if (!v.length) return null;
    var x = (v.length - 1) * q, a = Math.floor(x), b = Math.ceil(x);
    return v[a] + (v[b] - v[a]) * (x - a);
  }
  function sortNum(a) { return a.slice().sort(function (x, y) { return x - y; }); }
  function guard(n) { return n < REFUSE_N ? 'withheld' : n < WARN_N ? 'low' : 'ok'; }

  // items: [{ r: row, hit: bool, t: minutes|null }] already limited to the eligible sessions, in date order.
  function summarize(items) {
    var n = items.length, k = 0, i;
    for (i = 0; i < n; i++) if (items[i].hit) k++;
    var w = wilson(k, n), g = guard(n);
    var half = Math.floor(n / 2), a = 0, b = 0;
    for (i = 0; i < n; i++) if (items[i].hit) { if (i < half) a++; else b++; }
    var w1 = wilson(a, half), w2 = wilson(b, n - half);
    var stab = n >= 2 * REFUSE_N ? { first: w1, second: w2, agree: !(w1.hi < w2.lo || w2.hi < w1.lo) } : null;
    var years = {}, times = [];
    for (i = 0; i < n; i++) {
      var y = String(items[i].r.d).slice(0, 4);
      var o = years[y] || (years[y] = { n: 0, k: 0 });
      o.n++;
      if (items[i].hit) { o.k++; if (items[i].t != null && items[i].t >= 0) times.push(items[i].t); }
    }
    return { n: n, k: k, p: w.p, lo: w.lo, hi: w.hi, guard: g, stability: stab, years: years, tmed: medianCI(sortNum(times)), tn: times.length };
  }

  // ---- filters ---------------------------------------------------------------------------------------------------
  // f: { from: 'YYYY-MM-DD', to, dow: -1|0..4, bucket: 'any'|'none'|'xs'.., }
  function applyFilters(rows, f) {
    return rows.filter(function (r) {
      if (f.from && r.date < f.from) return false;
      if (f.to && r.date > f.to) return false;
      if (f.dow != null && f.dow >= 0 && r.dow !== f.dow) return false;
      if (f.bucket && f.bucket !== 'any' && r.bucket !== f.bucket) return false;
      return true;
    });
  }

  // ---- reports ---------------------------------------------------------------------------------------------------
  // A card: { id, title, sub, elig(r), hit(r), time(r) }. `time` is the outcome time in minutes after the open.
  function pc(r) { return r.pdc; }
  var yes = function () { return true; };
  function gapCards(rows, f) {
    var gapped = function (r) { return r.o !== pc(r); };
    var filled = function (r) { return r.gf >= 0; };
    var tm = function (r) { return r.gf; };
    var out = [{ id: 'gap.all', title: 'Gap filled', sub: 'Of sessions that opened away from the prior close, price traded back to it', elig: gapped, hit: filled, time: tm, main: true }];
    out.push({ id: 'gap.up', title: 'Up gaps filled', sub: 'Opened above the prior close', elig: function (r) { return r.o > pc(r); }, hit: filled, time: tm });
    out.push({ id: 'gap.down', title: 'Down gaps filled', sub: 'Opened below the prior close', elig: function (r) { return r.o < pc(r); }, hit: filled, time: tm });
    out.push({ id: 'gap.in30', title: 'Filled in the first 30 min', sub: 'Of gapped sessions', elig: gapped, hit: function (r) { return r.gf >= 0 && r.gf <= 30; }, time: tm });
    out.push({ id: 'gap.in60', title: 'Filled in the first hour', sub: 'Of gapped sessions', elig: gapped, hit: function (r) { return r.gf >= 0 && r.gf <= 60; }, time: tm });
    BUCKETS.forEach(function (b) {
      out.push({ id: 'gap.b.' + b[0], group: 'By gap size (of prior close)', title: 'Gap ' + b[1] + ': ' + BUCKET_TEXT[b[0]], sub: 'Gap filled', elig: function (r) { return r.bucket === b[0]; }, hit: filled, time: tm });
    });
    DOW.forEach(function (d, i) {
      out.push({ id: 'gap.d.' + i, group: 'By day of week', title: d, sub: 'Gap filled', elig: function (r) { return r.o !== pc(r) && r.dow === i; }, hit: filled, time: tm });
    });
    return out;
  }
  function orCards(win) {
    var p = 'o' + win, name = win + ' min';
    var rng = function (r) { return r[p + 'h'] - r[p + 'l']; };
    var dir = function (d) { return function (r) { return r[p + 'd'] === d; }; };
    var t = function (r) { return r[p + 't']; };
    var up = dir(1), dn = dir(-1);
    return [
      { id: 'or' + win + '.up', title: 'First break up', sub: 'Of all sessions, the ' + name + ' opening range broke up first', elig: yes, hit: up, time: t, main: true },
      { id: 'or' + win + '.down', title: 'First break down', sub: 'Of all sessions, broke down first', elig: yes, hit: dn, time: t, main: true },
      { id: 'or' + win + '.none', title: 'No break', sub: 'Of all sessions, stayed inside until the close', elig: yes, hit: dir(0), time: null },
      { id: 'or' + win + '.up.x1', group: 'Follow-through after a break up', title: 'Extended 1x the range', sub: 'Of up breaks, price went at least 1x the range above the high', elig: up, hit: function (r) { return r[p + 'x'] >= rng(r) && rng(r) > 0; }, time: t },
      { id: 'or' + win + '.up.x05', group: 'Follow-through after a break up', title: 'Extended 0.5x the range', sub: 'Of up breaks', elig: up, hit: function (r) { return r[p + 'x'] >= rng(r) / 2 && rng(r) > 0; }, time: t },
      { id: 'or' + win + '.up.c', group: 'Follow-through after a break up', title: 'Closed above the range high', sub: 'Of up breaks, the session close', elig: up, hit: function (r) { return r.c > r[p + 'h']; }, time: null },
      { id: 'or' + win + '.dn.x1', group: 'Follow-through after a break down', title: 'Extended 1x the range', sub: 'Of down breaks, price went at least 1x the range below the low', elig: dn, hit: function (r) { return r[p + 'x'] >= rng(r) && rng(r) > 0; }, time: t },
      { id: 'or' + win + '.dn.x05', group: 'Follow-through after a break down', title: 'Extended 0.5x the range', sub: 'Of down breaks', elig: dn, hit: function (r) { return r[p + 'x'] >= rng(r) / 2 && rng(r) > 0; }, time: t },
      { id: 'or' + win + '.dn.c', group: 'Follow-through after a break down', title: 'Closed below the range low', sub: 'Of down breaks, the session close', elig: dn, hit: function (r) { return r.c < r[p + 'l']; }, time: null }
    ];
  }
  function ibCards() {
    var rng = function (r) { return r.ibh - r.ibl; };
    var upOnly = function (r) { return r.ibu === 1 && r.ibw === 0; };
    var dnOnly = function (r) { return r.ibw === 1 && r.ibu === 0; };
    var both = function (r) { return r.ibu === 1 && r.ibw === 1; };
    var anyUp = function (r) { return r.ibu === 1; }, anyDn = function (r) { return r.ibw === 1; };
    return [
      { id: 'ib.up', title: 'Broke the high only', sub: 'Of all sessions, after the first hour only the IB high was broken', elig: yes, hit: upOnly, time: null, main: true },
      { id: 'ib.down', title: 'Broke the low only', sub: 'Of all sessions, only the IB low was broken', elig: yes, hit: dnOnly, time: null, main: true },
      { id: 'ib.both', title: 'Broke both sides', sub: 'Of all sessions', elig: yes, hit: both, time: null },
      { id: 'ib.none', title: 'Stayed inside', sub: 'Of all sessions, neither side broken after the first hour', elig: yes, hit: function (r) { return !r.ibu && !r.ibw; }, time: null },
      { id: 'ib.first.up', group: 'First break', title: 'First break was up', sub: 'Of sessions that broke the IB', elig: function (r) { return r.ibd === 1 || r.ibd === -1; }, hit: function (r) { return r.ibd === 1; }, time: function (r) { return r.ibt; } },
      { id: 'ib.up.x1', group: 'Extension', title: 'Up break extended 1x the IB', sub: 'Of sessions that broke the high, price went at least 1x the IB range above it', elig: anyUp, hit: function (r) { return r.ibxu >= rng(r) && rng(r) > 0; }, time: null },
      { id: 'ib.up.x05', group: 'Extension', title: 'Up break extended 0.5x the IB', sub: 'Of sessions that broke the high', elig: anyUp, hit: function (r) { return r.ibxu >= rng(r) / 2 && rng(r) > 0; }, time: null },
      { id: 'ib.dn.x1', group: 'Extension', title: 'Down break extended 1x the IB', sub: 'Of sessions that broke the low, price went at least 1x the IB range below it', elig: anyDn, hit: function (r) { return r.ibxd >= rng(r) && rng(r) > 0; }, time: null },
      { id: 'ib.dn.x05', group: 'Extension', title: 'Down break extended 0.5x the IB', sub: 'Of sessions that broke the low', elig: anyDn, hit: function (r) { return r.ibxd >= rng(r) / 2 && rng(r) > 0; }, time: null }
    ];
  }
  function priorCards() {
    return [
      { id: 'pd.hi.touch', title: 'Prior day high touched', sub: 'Of all sessions, price reached the prior day high', elig: yes, hit: function (r) { return r.thi >= 0; }, time: function (r) { return r.thi; }, main: true },
      { id: 'pd.lo.touch', title: 'Prior day low touched', sub: 'Of all sessions, price reached the prior day low', elig: yes, hit: function (r) { return r.tlo >= 0; }, time: function (r) { return r.tlo; }, main: true },
      { id: 'pd.hi.break', group: 'Break and close', title: 'Closed a bar above the high', sub: 'Of sessions that touched the prior high, a bar closed above it', elig: function (r) { return r.thi >= 0; }, hit: function (r) { return r.bhi >= 0; }, time: function (r) { return r.bhi; } },
      { id: 'pd.lo.break', group: 'Break and close', title: 'Closed a bar below the low', sub: 'Of sessions that touched the prior low, a bar closed below it', elig: function (r) { return r.tlo >= 0; }, hit: function (r) { return r.blo >= 0; }, time: function (r) { return r.blo; } },
      { id: 'pd.hi.hold', group: 'Break and close', title: 'Session closed above the high', sub: 'Of sessions that touched the prior high', elig: function (r) { return r.thi >= 0; }, hit: function (r) { return r.c > r.pdh; }, time: null },
      { id: 'pd.lo.hold', group: 'Break and close', title: 'Session closed below the low', sub: 'Of sessions that touched the prior low', elig: function (r) { return r.tlo >= 0; }, hit: function (r) { return r.c < r.pdl; }, time: null },
      { id: 'pd.close.above', group: 'Prior close', title: 'Opened above the prior close and closed above it', sub: 'Of sessions that opened above the prior close', elig: function (r) { return r.o > r.pdc; }, hit: function (r) { return r.c > r.pdc; }, time: null },
      { id: 'pd.close.below', group: 'Prior close', title: 'Opened below the prior close and closed below it', sub: 'Of sessions that opened below the prior close', elig: function (r) { return r.o < r.pdc; }, hit: function (r) { return r.c < r.pdc; }, time: null },
      { id: 'pd.inside', group: 'Prior range', title: 'Stayed inside the prior day range', sub: 'Of all sessions, never touched the prior high or low', elig: yes, hit: function (r) { return r.thi < 0 && r.tlo < 0; }, time: null }
    ];
  }
  function dowCards() {
    var out = [{ id: 'dow.all', title: 'Up days (all days)', sub: 'Of all sessions, the close was above the open', elig: yes, hit: function (r) { return r.c > r.o; }, time: null, main: true }];
    DOW.forEach(function (d, i) {
      out.push({ id: 'dow.' + i, group: 'Up day by weekday', title: d, sub: 'Close above the open', elig: function (r) { return r.dow === i; }, hit: function (r) { return r.c > r.o; }, time: null });
    });
    return out;
  }
  var REPORTS = {
    gap: { title: 'Gap fill', blurb: 'How often an opening gap trades back to the prior close, and how fast.', cards: gapCards },
    or15: { title: 'Opening range 15 min', blurb: 'First 15 minutes of the session: which side breaks first and what follows.', cards: function () { return orCards(15); } },
    or30: { title: 'Opening range 30 min', blurb: 'First 30 minutes of the session: which side breaks first and what follows.', cards: function () { return orCards(30); } },
    ib: { title: 'Initial balance (first hour)', blurb: 'The first hour range: which sides break afterwards and by how much.', cards: ibCards },
    prior: { title: 'Prior day levels', blurb: 'How often the session reaches yesterday\'s high, low and close.', cards: priorCards },
    dow: { title: 'Day of week', blurb: 'Up days by weekday and the typical session range.', cards: dowCards }
  };

  // Run one report on filtered rows. -> { cards: [{ id, title, sub, group, main, s: summary, items }], extra }
  function run(reportId, rows, f) {
    var rep = REPORTS[reportId];
    var base = applyFilters(rows, f || {});
    var cards = rep.cards(base, f).map(function (c) {
      var items = [];
      for (var i = 0; i < base.length; i++) {
        var r = base[i];
        if (!c.elig(r)) continue;
        var h = !!c.hit(r);
        items.push({ r: r, hit: h, t: h && c.time ? c.time(r) : null });
      }
      return { id: c.id, title: c.title, sub: c.sub, group: c.group || '', main: !!c.main, s: summarize(items), items: items, timed: !!c.time };
    });
    var extra = reportId === 'dow' ? rangeByDow(base) : null;
    return { cards: cards, extra: extra, sessions: base.length };
  }
  // Session range as % of the open, by weekday: median with a distribution-free 95% interval.
  function rangeByDow(base) {
    var out = [];
    for (var d = -1; d < 5; d++) {
      var v = [];
      base.forEach(function (r) { if ((d < 0 || r.dow === d) && r.o) v.push((r.h - r.l) / r.o * 100); });
      var m = medianCI(sortNum(v));
      out.push({ label: d < 0 ? 'All days' : DOW[d], n: v.length, med: m && m.med, lo: m && m.lo, hi: m && m.hi, guard: guard(v.length) });
    }
    return out;
  }

  // ---- formatting ------------------------------------------------------------------------------------------------
  function pct(x, d) { return x == null ? '—' : (x * 100).toFixed(d == null ? 0 : d) + '%'; }
  function fmtMin(m) {
    if (m == null) return '—';
    m = Math.round(m);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '');
  }
  // Chart date -> epoch seconds of the session open (09:30 New York) for a YYYY-MM-DD date.
  function nyOffsetHours(y, m, d) {
    function nth(mm, n) { var first = Date.UTC(y, mm, 1), dw = new Date(first).getUTCDay(); return 1 + ((7 - dw) % 7) + 7 * (n - 1); }
    var ms = Date.UTC(y, m - 1, d), ds = Date.UTC(y, 2, nth(2, 2)), de = Date.UTC(y, 10, nth(10, 1));
    return ms >= ds && ms < de ? -4 : -5;
  }
  function sessionOpenEpoch(date) {
    var p = date.split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2], 9 - nyOffsetHours(p[0], p[1], p[2]), 30) / 1000;
  }


  // ---- Today: this session's conditions against the history ---------------------------------------------------------
  // Pure functions. bars: [[t, o, h, l, c, v]] 5-minute bars (t = bar open, epoch seconds). One bar = 5 minutes.
  function nyOffsetSecs(t) {
    var y = new Date(t * 1000).getUTCFullYear();
    function nth(m, n) { var first = Date.UTC(y, m, 1), dw = new Date(first).getUTCDay(); return first + (((7 - dw) % 7) + 7 * (n - 1)) * 864e5; }
    var start = nth(2, 2) / 1000 + 7 * 3600, end = nth(10, 1) / 1000 + 6 * 3600;
    return t >= start && t < end ? -4 * 3600 : -5 * 3600;
  }
  function nyDate(t) { return new Date((t + nyOffsetSecs(t)) * 1000).toISOString().slice(0, 10); }
  function nyClock(t) { var d = new Date((t + nyOffsetSecs(t)) * 1000); return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }
  // Bars of one New York session (09:30 to 16:00), ascending.
  function sessionBars(bars, date) {
    var open = sessionOpenEpoch(date), end = open + 390 * 60, out = [];
    for (var i = 0; i < bars.length; i++) if (bars[i][0] >= open && bars[i][0] < end) out.push(bars[i]);
    out.sort(function (a, b) { return a[0] - b[0]; });
    return out;
  }
  // The latest complete-looking session before `date` in a bar list -> { date, h, l, c } or null.
  function priorFromBars(bars, date) {
    var days = {};
    for (var i = 0; i < bars.length; i++) { var d = nyDate(bars[i][0]); if (d < date && days[d] !== false) (days[d] = days[d] || []).push(bars[i]); }
    var keys = Object.keys(days).sort().reverse();
    for (var k = 0; k < keys.length; k++) {
      var sb = sessionBars(bars, keys[k]);
      if (sb.length >= 70) {
        var h = -Infinity, l = Infinity;
        sb.forEach(function (b) { if (b[2] > h) h = b[2]; if (b[3] < l) l = b[3]; });
        return { date: keys[k], h: h, l: l, c: sb[sb.length - 1][4] };
      }
    }
    return null;
  }
  function firstBreak(sb, from, hi, lo) {
    for (var i = from; i < sb.length; i++) {
      var up = sb[i][2] > hi, dn = sb[i][3] < lo;
      if (up && dn) return { dir: 2, i: i };
      if (up) return { dir: 1, i: i };
      if (dn) return { dir: -1, i: i };
    }
    return { dir: 0, i: -1 };
  }
  // sb: the session's bars so far; prior: { h, l, c }. -> the state of every Today card.
  function todayState(sb, prior, date) {
    if (!sb.length || !prior) return null;
    var open = sessionOpenEpoch(date), o = sb[0][1];
    var last = sb[sb.length - 1], end = last[0] + 300;
    var elapsed = (end - open) / 60;
    var mins = function (i) { return (sb[i][0] + 300 - open) / 60; };
    var T = { date: date, dow: (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7, open: o, last: last[4], endEpoch: end, elapsed: elapsed, bars: sb.length, prior: prior, complete: elapsed >= 390 };
    // gap
    var gap = { has: o !== prior.c, dir: o > prior.c ? 1 : -1, pct: (o - prior.c) / prior.c * 100, pts: o - prior.c, filled: false, fillMin: null };
    gap.bucket = gap.has ? bucketOf(Math.abs(gap.pct)) : 'none';
    if (gap.has) for (var i = 0; i < sb.length; i++) if ((o > prior.c && sb[i][3] <= prior.c) || (o < prior.c && sb[i][2] >= prior.c)) { gap.filled = true; gap.fillMin = mins(i); break; }
    T.gap = gap;
    // opening ranges
    T.or = {};
    [15, 30].forEach(function (w) {
      var n = w / 5, r = { w: w, done: sb.length >= n, mins: w };
      if (r.done) {
        var hi = -Infinity, lo = Infinity;
        for (var j = 0; j < n; j++) { if (sb[j][2] > hi) hi = sb[j][2]; if (sb[j][3] < lo) lo = sb[j][3]; }
        r.hi = hi; r.lo = lo;
        var fb = firstBreak(sb, n, hi, lo);
        r.dir = fb.dir; r.t = fb.i >= 0 ? mins(fb.i) : null;
        r.pos = last[4] > hi ? 1 : last[4] < lo ? -1 : 0;
        if (fb.dir === 1 || fb.dir === -1) {
          var ext = 0;
          for (var q = fb.i; q < sb.length; q++) ext = Math.max(ext, fb.dir === 1 ? sb[q][2] - hi : lo - sb[q][3]);
          r.ext = ext;
        }
      }
      T.or[w] = r;
    });
    // initial balance (first hour); statuses count from 10:30
    var ib = { done: sb.length >= 12 };
    if (ib.done) {
      var ih = -Infinity, il = Infinity;
      for (var m = 0; m < 12; m++) { if (sb[m][2] > ih) ih = sb[m][2]; if (sb[m][3] < il) il = sb[m][3]; }
      ib.hi = ih; ib.lo = il; ib.range = ih - il;
      var xu = 0, xd = 0, tu = null, td = null;
      for (var k = 12; k < sb.length; k++) {
        if (sb[k][2] > ih) { if (tu == null) tu = mins(k); xu = Math.max(xu, sb[k][2] - ih); }
        if (sb[k][3] < il) { if (td == null) td = mins(k); xd = Math.max(xd, il - sb[k][3]); }
      }
      ib.xu = xu; ib.xd = xd; ib.tu = tu; ib.td = td;
      ib.up = tu != null; ib.dn = td != null;
    }
    T.ib = ib;
    // prior day range
    var pd = { loc: o > prior.h ? 'above' : o < prior.l ? 'below' : 'inside', vsClose: o > prior.c ? 'above' : o < prior.c ? 'below' : 'at', thi: null, tlo: null };
    for (var z = 0; z < sb.length; z++) {
      if (pd.thi == null && sb[z][2] >= prior.h) pd.thi = mins(z);
      if (pd.tlo == null && sb[z][3] <= prior.l) pd.tlo = mins(z);
    }
    T.pd = pd;
    return T;
  }

  // "X% of N sessions (range a to b%)" for a summary, or the too-few-sessions line.
  function freq(s) {
    if (s.guard === 'withheld') return 'too few sessions to estimate (N = ' + s.n + ')';
    return pct(s.p) + ' of ' + s.n + ' sessions (range ' + (s.lo * 100).toFixed(0) + '\u2013' + pct(s.hi) + ')' + (s.guard === 'low' ? ' \u00b7 low sample' : '');
  }
  function itemsOf(rows, elig, hit, time) {
    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!elig(r)) continue;
      var h = !!hit(r);
      items.push({ r: r, hit: h, t: h && time ? time(r) : null });
    }
    return items;
  }
  function sum(rows, elig, hit, time) { return summarize(itemsOf(rows, elig, hit, time)); }

  // History lines for each Today card. rows: all sessions of the symbol (before today). -> { gap, or, ib, pd }
  function todayHistory(rows, T) {
    var past = rows.filter(function (r) { return r.date < T.date; });
    var out = { n: past.length };
    // gap: same size bucket (and the same weekday), plus "still unfilled after N minutes"
    var g = T.gap;
    if (g.has) {
      var gapped = function (r) { return r.o !== r.pdc; };
      var inB = function (r) { return gapped(r) && r.bucket === g.bucket; };
      var fl = function (r) { return r.gf >= 0; };
      out.gap = {
        bucket: sum(past, inB, fl, function (r) { return r.gf; }),
        bucketDow: sum(past, function (r) { return inB(r) && r.dow === T.dow; }, fl, function (r) { return r.gf; }),
        later: g.filled ? null : sum(past, function (r) { return inB(r) && (r.gf < 0 || r.gf > T.elapsed); }, fl, function (r) { return r.gf; })
      };
    }
    // opening ranges
    out.or = {};
    [15, 30].forEach(function (w) {
      var p = 'o' + w, rng = function (r) { return r[p + 'h'] - r[p + 'l']; };
      var up = function (r) { return r[p + 'd'] === 1; }, dn = function (r) { return r[p + 'd'] === -1; };
      out.or[w] = {
        up: sum(past, function () { return true; }, up),
        down: sum(past, function () { return true; }, dn),
        none: sum(past, function () { return true; }, function (r) { return r[p + 'd'] === 0; }),
        upX1: sum(past, up, function (r) { return rng(r) > 0 && r[p + 'x'] >= rng(r); }),
        dnX1: sum(past, dn, function (r) { return rng(r) > 0 && r[p + 'x'] >= rng(r); }),
        upC: sum(past, up, function (r) { return r.c > r[p + 'h']; }),
        dnC: sum(past, dn, function (r) { return r.c < r[p + 'l']; })
      };
    });
    // initial balance extensions: sessions that broke that side, how far did it go (multiples of the IB range)
    out.ib = { up: {}, dn: {}, first: null };
    [0.5, 1, 1.5, 2].forEach(function (m) {
      out.ib.up[m] = sum(past, function (r) { return r.ibu === 1; }, function (r) { return r.ibh > r.ibl && r.ibxu >= m * (r.ibh - r.ibl); });
      out.ib.dn[m] = sum(past, function (r) { return r.ibw === 1; }, function (r) { return r.ibh > r.ibl && r.ibxd >= m * (r.ibh - r.ibl); });
    });
    out.ib.broke = {
      up: sum(past, function () { return true; }, function (r) { return r.ibu === 1 && r.ibw === 0; }),
      down: sum(past, function () { return true; }, function (r) { return r.ibw === 1 && r.ibu === 0; }),
      both: sum(past, function () { return true; }, function (r) { return r.ibu === 1 && r.ibw === 1; }),
      none: sum(past, function () { return true; }, function (r) { return !r.ibu && !r.ibw; })
    };
    // prior day range: sessions that opened in the same place relative to the prior range
    var loc = function (r) { return r.o > r.pdh ? 'above' : r.o < r.pdl ? 'below' : 'inside'; };
    var same = function (r) { return loc(r) === T.pd.loc; };
    out.pd = {
      hi: sum(past, same, function (r) { return r.thi >= 0; }, function (r) { return r.thi; }),
      lo: sum(past, same, function (r) { return r.tlo >= 0; }, function (r) { return r.tlo; }),
      closeAbove: sum(past, same, function (r) { return r.c > r.pdh; }),
      closeBelow: sum(past, same, function (r) { return r.c < r.pdl; }),
      closeInside: sum(past, same, function (r) { return r.c <= r.pdh && r.c >= r.pdl; })
    };
    return out;
  }

  var api = { todayState: todayState, todayHistory: todayHistory, sessionBars: sessionBars, priorFromBars: priorFromBars, nyDate: nyDate, nyClock: nyClock, freq: freq, sum: sum, COLS: COLS, DOW: DOW, BUCKETS: BUCKETS, BUCKET_TEXT: BUCKET_TEXT, REPORTS: REPORTS, WARN_N: WARN_N, REFUSE_N: REFUSE_N,
    toRows: toRows, wilson: wilson, medianCI: medianCI, quantile: quantile, summarize: summarize, applyFilters: applyFilters, run: run,
    pct: pct, fmtMin: fmtMin, dateStr: dateStr, bucketOf: bucketOf, guard: guard, sessionOpenEpoch: sessionOpenEpoch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StkMS = api;
})(typeof window !== 'undefined' ? window : globalThis);
