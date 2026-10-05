// Stryker Trading Academy — trading session clock + US stock market hours (pure logic + header widget)
//
// Purpose: renders the "Trading session clock" in the app header
// (.mobile-topnav) of every dash-shell page: which forex/futures trading
// session is open now (Asia, London, New York), a per-second countdown to the
// next session that is not open, plus New York time and the visitor's local
// time. It is a CLOCK computed from the calendar below; it reads no market
// data and must never be worded as live or real-time data.
//
// Session definitions (standard trader convention, each in its own city's
// local time so every DST switch is handled by the browser's tz database):
//   Asia      09:00-18:00 Asia/Tokyo
//   London    08:00-17:00 Europe/London
//   New York  08:00-17:00 America/New_York
// Each session runs Monday-Friday in its own city's calendar. Weekend = no
// session open between Fri 17:00 New York and the Monday Asia open (Tokyo).
// Bank holidays are not modelled for the sessions.
//
// The module ALSO still exports the US stock market regular-session logic
// (status/label: NYSE/Nasdaq 09:30-16:00 America/New_York, Mon-Fri, NYSE
// holidays, 13:00 early closes on Jul 3 when Jul 4 is Tue-Fri, the day after
// Thanksgiving and Dec 24 when Dec 25 is Tue-Fri). dash-path.js uses it for
// the dashboard market chip. One-off closures cannot be predicted.
//
// Time zones: every wall-clock value comes from Intl.DateTimeFormat with an
// explicit timeZone, so DST is handled by the browser and half-hour zones
// (IST, UTC+5:30) need no special case.
//
// Depends on: nothing. Loaded after dash-nav.js on the app pages; also
// require()-able from Node for tools/tests/market-hours-test.js.

(function (root) {
  'use strict';

  var NY = 'America/New_York';
  var partsFmt = null;
  function nyParts(ms) {
    if (!partsFmt) {
      partsFmt = new Intl.DateTimeFormat('en-US', {
        timeZone: NY, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short'
      });
    }
    var o = {};
    partsFmt.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    var wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday];
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: wd };
  }

  // NY wall-clock -> UTC ms. Two passes so a guess on the wrong side of a DST
  // switch corrects itself. Session times (09:30, 13:00, 16:00) never fall in
  // the 02:00 DST gap, so the result is always exact for our use.
  function nyToUtc(y, m, d, h, mi) {
    var guess = Date.UTC(y, m - 1, d, h, mi);
    for (var i = 0; i < 2; i++) {
      var p = nyParts(guess);
      var asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
      guess += Date.UTC(y, m - 1, d, h, mi) - asUtc;
    }
    return guess;
  }

  function dow(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  function key(y, m, d) { return y * 10000 + m * 100 + d; }
  function addDays(y, m, d, n) {
    var t = new Date(Date.UTC(y, m - 1, d + n));
    return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
  }
  // nth weekday (wd 0-6) of a month; n = -1 for the last one
  function nthWeekday(y, m, wd, n) {
    if (n > 0) {
      var first = dow(y, m, 1);
      return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    }
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return last - ((dow(y, m, last) - wd + 7) % 7);
  }
  function easter(y) { // anonymous Gregorian algorithm
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
      mm = Math.floor((a + 11 * h + 22 * l) / 451), month = Math.floor((h + l - 7 * mm + 114) / 31),
      day = ((h + l - 7 * mm + 114) % 31) + 1;
    return [month, day];
  }
  // Fixed-date holiday observed on Fri when on Sat, Mon when on Sun.
  function observed(y, m, d) {
    var w = dow(y, m, d);
    if (w === 6) return addDays(y, m, d, -1);
    if (w === 0) return addDays(y, m, d, 1);
    return [y, m, d];
  }

  var cache = {};
  function yearCalendar(y) {
    if (cache[y]) return cache[y];
    var hol = {}, early = {};
    function H(a) { hol[key(a[0], a[1], a[2])] = 1; }
    // New Year's Day: on a Saturday it is NOT moved to Friday (NYSE rule).
    if (dow(y, 1, 1) === 0) H([y, 1, 2]); else if (dow(y, 1, 1) !== 6) H([y, 1, 1]);
    H([y, 1, nthWeekday(y, 1, 1, 3)]);   // Martin Luther King Jr. Day
    H([y, 2, nthWeekday(y, 2, 1, 3)]);   // Washington's Birthday
    var e = easter(y); H(addDays(y, e[0], e[1], -2)); // Good Friday
    H([y, 5, nthWeekday(y, 5, 1, -1)]);  // Memorial Day
    if (y >= 2022) H(observed(y, 6, 19)); // Juneteenth
    H(observed(y, 7, 4));                // Independence Day
    H([y, 9, nthWeekday(y, 9, 1, 1)]);   // Labor Day
    var tg = nthWeekday(y, 11, 4, 4);    // Thanksgiving
    H([y, 11, tg]);
    H(observed(y, 12, 25));              // Christmas
    var j4 = dow(y, 7, 4);
    if (j4 >= 2 && j4 <= 5) early[key(y, 7, 3)] = 1;
    early[key(y, 11, tg + 1)] = 1;
    var x = dow(y, 12, 25);
    if (x >= 2 && x <= 5) early[key(y, 12, 24)] = 1;
    cache[y] = { hol: hol, early: early };
    return cache[y];
  }

  // Session for a NY calendar date, or null if the market is closed that day.
  function sessionFor(y, m, d) {
    var w = dow(y, m, d);
    if (w === 0 || w === 6) return null;
    var cal = yearCalendar(y), k = key(y, m, d);
    if (cal.hol[k]) return null;
    var closeH = cal.early[k] ? 13 : 16;
    return { open: nyToUtc(y, m, d, 9, 30), close: nyToUtc(y, m, d, closeH, 0), early: !!cal.early[k] };
  }

  // { open:bool, until:ms (next close if open, next open if closed), early:bool }
  function status(nowMs) {
    var p = nyParts(nowMs), y = p.y, m = p.m, d = p.d;
    for (var i = 0; i < 15; i++) {
      var s = sessionFor(y, m, d);
      if (s) {
        if (nowMs < s.open) return { open: false, until: s.open, next: s };
        if (nowMs < s.close) return { open: true, until: s.close, next: s, early: s.early };
      }
      var n = addDays(y, m, d, 1); y = n[0]; m = n[1]; d = n[2];
    }
    return null;
  }

  function fmtLeft(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var dd = Math.floor(t / 86400), hh = Math.floor((t % 86400) / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
    function z(n) { return (n < 10 ? '0' : '') + n; }
    if (dd > 0) return dd + 'd ' + hh + 'h';
    if (hh > 0) return hh + 'h ' + z(mm) + 'm';
    return mm + 'm ' + z(ss) + 's';
  }

  function label(nowMs) {
    var st = status(nowMs);
    if (!st) return { open: false, text: 'Market closed', short: 'Closed' };
    var left = fmtLeft(st.until - nowMs);
    return st.open
      ? { open: true, text: 'Open, closes in ' + left, short: 'Closes ' + left, early: !!st.early }
      : { open: false, text: 'Opens in ' + left, short: 'Opens ' + left };
  }

  // ---- trading sessions -----------------------------------------------------
  var SESSIONS = [
    { name: 'Asia', short: 'Asia', tz: 'Asia/Tokyo', open: 9, close: 18 },
    { name: 'London', short: 'London', tz: 'Europe/London', open: 8, close: 17 },
    { name: 'New York', short: 'NY', tz: NY, open: 8, close: 17 }
  ];
  var tzFmts = {};
  function tzParts(tz, ms) {
    if (tz === NY) return nyParts(ms);
    if (!tzFmts[tz]) {
      tzFmts[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short'
      });
    }
    var o = {};
    tzFmts[tz].formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    var wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday];
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: wd };
  }
  // Wall clock in tz -> UTC ms (session hours never fall inside a DST gap).
  function tzToUtc(tz, y, m, d, h, mi) {
    var guess = Date.UTC(y, m - 1, d, h, mi);
    for (var i = 0; i < 2; i++) {
      var p = tzParts(tz, guess);
      guess += Date.UTC(y, m - 1, d, h, mi) - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    }
    return guess;
  }
  // Weekday intervals of one session around nowMs: [{start, end}], ascending.
  function sessionIntervals(sess, nowMs) {
    var p = tzParts(sess.tz, nowMs), out = [];
    for (var k = -1; k <= 9; k++) {
      var t = addDays(p.y, p.m, p.d, k), w = dow(t[0], t[1], t[2]);
      if (w === 0 || w === 6) continue;
      out.push({ start: tzToUtc(sess.tz, t[0], t[1], t[2], sess.open, 0), end: tzToUtc(sess.tz, t[0], t[1], t[2], sess.close, 0) });
    }
    return out;
  }

  // HH:MM:SS countdown; "1d 05:33:25" once it is 24 h or more.
  function fmtClock(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var dd = Math.floor(t / 86400), hh = Math.floor((t % 86400) / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return (dd > 0 ? dd + 'd ' : '') + z(hh) + ':' + z(mm) + ':' + z(ss);
  }
  function joinNames(a) {
    return a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
  }

  // { open:[{name, short, start, end}], next:{name, short, at}, weekend:bool }
  function sessionStatus(nowMs) {
    var open = [], next = null;
    SESSIONS.forEach(function (s) {
      var iv = sessionIntervals(s, nowMs), cur = null, nx = null;
      for (var i = 0; i < iv.length; i++) {
        if (iv[i].start <= nowMs && nowMs < iv[i].end) cur = iv[i];
        else if (iv[i].start > nowMs && !nx) nx = iv[i];
      }
      if (cur) open.push({ name: s.name, short: s.short, start: cur.start, end: cur.end });
      else if (nx && (!next || nx.start < next.at)) next = { name: s.name, short: s.short, at: nx.start };
    });
    open.sort(function (a, b) { return a.start - b.start; });
    var weekend = false;
    if (!open.length) {
      var p = nyParts(nowMs);
      weekend = p.wd === 6 || p.wd === 0 || (p.wd === 5 && p.h >= 17);
    }
    return { open: open, next: next, weekend: weekend };
  }

  // Display strings for the header pill.
  function sessionLabel(nowMs) {
    var st = sessionStatus(nowMs);
    var names = st.open.map(function (o) { return o.name; });
    var shorts = st.open.map(function (o) { return o.short; });
    var head, shortHead;
    if (names.length === 1) { head = names[0] + ' Session is Open'; shortHead = shorts[0] + ' open'; }
    else if (names.length > 1) { head = joinNames(names) + ' Sessions are Open'; shortHead = joinNames(shorts) + ' open'; }
    else if (st.weekend) { head = 'Markets closed (weekend)'; shortHead = 'Weekend'; }
    else { head = 'No session open'; shortHead = 'Closed'; }
    var left = st.next ? fmtClock(st.next.at - nowMs) : '';
    var tail = st.next ? 'Next Session: ' + st.next.name + ' opens in ' + left : '';
    var shortTail = st.next ? st.next.short + ' in ' + left : '';
    return {
      open: names.length > 0, weekend: st.weekend, sessions: names, next: st.next,
      head: head, tail: tail, text: head + (tail ? ' \u00b7 ' + tail : ''),
      shortHead: shortHead, shortTail: shortTail, short: shortHead + (shortTail ? ' \u00b7 ' + shortTail : '')
    };
  }

  // Session hours in another zone (the visitor's), for the tooltip:
  // "Asia 05:30–14:30 · London 12:30–21:30 · New York 17:30–02:30".
  // Uses each session's current interval, else its next one, so the hours
  // shown are the ones that apply around now (DST-correct).
  function sessionHours(nowMs, tz) {
    var f = new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return SESSIONS.map(function (s) {
      var iv = sessionIntervals(s, nowMs), use = null;
      for (var i = 0; i < iv.length && !use; i++) if (iv[i].end > nowMs) use = iv[i];
      return s.name + ' ' + f.format(use.start) + '\u2013' + f.format(use.end);
    }).join(' \u00b7 ');
  }

  var api = { status: status, label: label, fmtLeft: fmtLeft, sessionFor: sessionFor, nyParts: nyParts, nyToUtc: nyToUtc,
    SESSIONS: SESSIONS, sessionStatus: sessionStatus, sessionLabel: sessionLabel, sessionHours: sessionHours, fmtClock: fmtClock, tzToUtc: tzToUtc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  root.StrykerMarketHours = api;

  // ---- header widget --------------------------------------------------------
  function tzAbbr(tz) {
    try {
      var o = {};
      new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date())
        .forEach(function (p) { o[p.type] = p.value; });
      var a = o.timeZoneName || '';
      // en-US only has letters for US zones; try the visitor's locale (en-IN gives IST)
      if (/^GMT/.test(a) && typeof navigator !== 'undefined') {
        var o2 = {};
        new Intl.DateTimeFormat(navigator.language || 'en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date())
          .forEach(function (p) { o2[p.type] = p.value; });
        if (o2.timeZoneName && /^[A-Z]{2,5}$/.test(o2.timeZoneName)) a = o2.timeZoneName;
      }
      return a;
    } catch (e) { return ''; }
  }

  function mount() {
    var host = document.querySelector('.mobile-topnav');
    if (!host || document.getElementById('mclock')) return;
    var localTz = '';
    try { localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var timeFmt = function (tz) {
      return new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    };
    var nyF = timeFmt(NY), locF = timeFmt(localTz);
    var hmFmt = function (tz) { return new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); };
    var nyHmF = hmFmt(NY), locHmF = hmFmt(localTz);

    var w = document.createElement('div');
    w.className = 'mclock';
    w.id = 'mclock';
    w.innerHTML =
      '<button type="button" class="mclock-pill" aria-label="Trading session clock" aria-expanded="false" aria-controls="mclock-pop">' +
        '<span class="mclock-dot" aria-hidden="true"></span>' +
        '<span class="mclock-state"><b class="mclock-head"></b> <span class="mclock-tail"></span></span>' +
        '<span class="mclock-short"><b class="mclock-shead"></b> <span class="mclock-stail"></span></span>' +
        '<span class="mclock-sep" aria-hidden="true"></span>' +
        '<span class="mclock-t mclock-nyt"><b>NY</b> <span class="mclock-ny"></span> <i class="mclock-nyz"></i></span>' +
        '<span class="mclock-t mclock-nym"><b>NY</b> <span class="mclock-nyhm"></span> <i class="mclock-nyz"></i></span>' +
        '<span class="mclock-t mclock-locm"><i class="mclock-ltz"></i> <span class="mclock-lthm"></span></span>' +
        '<span class="mclock-t mclock-loc"><b>Local</b> <span class="mclock-lt"></span> <i class="mclock-ltz"></i></span>' +
      '</button>' +
      '<div class="mclock-pop" id="mclock-pop" role="region" aria-label="Trading session hours" hidden>' +
        '<div class="mclock-row mclock-prow"><span>Now</span><b class="mclock-pstate"></b></div>' +
        '<div class="mclock-row"><span>Next</span><b class="mclock-pnext"></b></div>' +
        '<div class="mclock-hours"></div>' +
        '<div class="mclock-row"><span>New York</span><b><span class="mclock-ny"></span> <i class="mclock-nyz"></i></b></div>' +
        '<div class="mclock-row"><span>Your time</span><b><span class="mclock-lt"></span> <i class="mclock-ltz"></i></b></div>' +
        '<p class="mclock-note">Session hours in your time zone. Asia 09:00-18:00 Tokyo, London 08:00-17:00 London, New York 08:00-17:00 New York, Mon-Fri; each follows its own city\'s daylight saving. A clock from the calendar, not market data. Bank holidays not included.</p>' +
      '</div>';
    var right = host.querySelector('.topnav-right');
    host.insertBefore(w, right || null);

    var pill = w.querySelector('.mclock-pill'), pop = w.querySelector('.mclock-pop');
    function setOpen(on) {
      pop.hidden = !on; pill.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    pill.addEventListener('click', function (e) { e.stopPropagation(); setOpen(pop.hidden); });
    document.addEventListener('click', function (e) { if (!pop.hidden && !w.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { setOpen(false); pill.focus(); } });

    var q = function (sel) { return w.querySelectorAll(sel); };
    var lastAbbr = 0, lastHours = 0, nyz = '', ltz = '';
    function setAll(sel, txt) { q(sel).forEach(function (el) { if (el.textContent !== txt) el.textContent = txt; }); }
    // Fit the pill to the header without wrapping or sideways scroll:
    // level 1 drops the local clock, 2 switches to the short session text,
    // 3 drops the NY clock too. Re-run when the text length or width changes.
    var fitKey = '';
    function overflowing() { return pill.scrollWidth > pill.clientWidth + 1; }
    function fit() {
      w.classList.remove('fit-1', 'fit-2', 'fit-3');
      for (var lv = 1; lv <= 3 && overflowing(); lv++) w.classList.add('fit-' + lv);
    }
    window.addEventListener('resize', function () { fitKey = ''; });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fit(); });
    function tick() {
      var now = Date.now();
      if (now - lastAbbr > 60000) { nyz = tzAbbr(NY); ltz = tzAbbr(localTz); lastAbbr = now; }
      var l = sessionLabel(now);
      w.classList.toggle('is-open', l.open);
      setAll('.mclock-head', l.head);
      setAll('.mclock-tail', l.tail ? '\u00b7 ' + l.tail : '');
      setAll('.mclock-shead', l.shortHead);
      setAll('.mclock-stail', l.shortTail ? '\u00b7 ' + l.shortTail : '');
      setAll('.mclock-pstate', l.head);
      setAll('.mclock-pnext', l.next ? l.next.name + ' in ' + fmtClock(l.next.at - now) : '');
      if (now - lastHours > 30000) {
        lastHours = now;
        var hrs = sessionHours(now, localTz);
        pill.title = hrs + ' (your time)';
        var hb = w.querySelector('.mclock-hours');
        hb.innerHTML = '';
        hrs.split(' \u00b7 ').forEach(function (seg) {
          var sp = seg.lastIndexOf(' '), row = document.createElement('div');
          row.className = 'mclock-row';
          var a = document.createElement('span'); a.textContent = seg.slice(0, sp);
          var b = document.createElement('b'); b.textContent = seg.slice(sp + 1);
          row.appendChild(a); row.appendChild(b); hb.appendChild(row);
        });
      }
      setAll('.mclock-ny', nyF.format(now));
      setAll('.mclock-nyhm', nyHmF.format(now));
      setAll('.mclock-lthm', locHmF.format(now));
      setAll('.mclock-lt', locF.format(now));
      setAll('.mclock-nyz', nyz);
      setAll('.mclock-ltz', ltz);
      w.classList.toggle('same-tz', !!localTz && localTz === NY);
      var fk = l.text.length + '|' + l.short.length + '|' + (window.innerWidth || 0);
      if (fk !== fitKey) { fitKey = fk; fit(); }
    }
    var timer = null;
    function start() {
      if (timer) return;
      tick();
      // align to the next whole second so the seconds digit never stutters
      timer = setTimeout(function loop() { tick(); timer = setTimeout(loop, 1000 - (Date.now() % 1000) + 5); }, 1000 - (Date.now() % 1000) + 5);
    }
    function stop() { clearTimeout(timer); timer = null; }
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
    if (!document.hidden) start(); else tick();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})(typeof window !== 'undefined' ? window : this);
