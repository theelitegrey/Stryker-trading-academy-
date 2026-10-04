// Stryker Trading Academy — US stock market session clock (pure logic + header widget)
//
// Purpose: answers "is the US stock market's regular session open, and when
// does it next open/close?" and renders the small clock in the app header
// (.mobile-topnav) of every dash-shell page: a status pill plus New York time
// and the visitor's local time. It is a CLOCK computed from the calendar
// below; it reads no market data and must never be worded as live data.
//
// Market definition: NYSE/Nasdaq regular session, 09:30-16:00 America/New_York,
// Monday-Friday, closed on NYSE holidays, 13:00 close on the standard early-
// close days (Jul 3 when Jul 4 is Tue-Fri, the day after Thanksgiving, Dec 24
// when Dec 25 is Tue-Fri). One-off closures (national days of mourning) cannot
// be predicted and are not included.
//
// Time zones: every NY wall-clock value comes from Intl.DateTimeFormat with
// timeZone 'America/New_York', so DST is handled by the browser's tz database
// and half-hour zones (IST, UTC+5:30) need no special case.
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

  var api = { status: status, label: label, fmtLeft: fmtLeft, sessionFor: sessionFor, nyParts: nyParts, nyToUtc: nyToUtc };
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
      '<button type="button" class="mclock-pill" aria-expanded="false" aria-controls="mclock-pop" title="US stock market hours (clock, not market data)">' +
        '<span class="mclock-dot" aria-hidden="true"></span>' +
        '<span class="mclock-state"></span><span class="mclock-short"></span>' +
        '<span class="mclock-sep" aria-hidden="true"></span>' +
        '<span class="mclock-t mclock-nyt"><b>NY</b> <span class="mclock-ny"></span> <i class="mclock-nyz"></i></span>' +
        '<span class="mclock-t mclock-nym"><b>NY</b> <span class="mclock-nyhm"></span> <i class="mclock-nyz"></i></span>' +
        '<span class="mclock-t mclock-locm"><i class="mclock-ltz"></i> <span class="mclock-lthm"></span></span>' +
        '<span class="mclock-t mclock-loc"><b>Local</b> <span class="mclock-lt"></span> <i class="mclock-ltz"></i></span>' +
      '</button>' +
      '<div class="mclock-pop" id="mclock-pop" hidden>' +
        '<div class="mclock-row"><span>US stocks (NYSE)</span><b class="mclock-pstate"></b></div>' +
        '<div class="mclock-row"><span>New York</span><b><span class="mclock-ny"></span> <i class="mclock-nyz"></i></b></div>' +
        '<div class="mclock-row"><span>Your time</span><b><span class="mclock-lt"></span> <i class="mclock-ltz"></i></b></div>' +
        '<p class="mclock-note">Regular session 09:30-16:00 ET, Mon-Fri, NYSE holidays and early closes included. CME index futures (Globex) trade Sun 18:00 to Fri 17:00 ET with a daily break 17:00-18:00 ET.</p>' +
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
    var lastAbbr = 0, nyz = '', ltz = '';
    function setAll(sel, txt) { q(sel).forEach(function (el) { if (el.textContent !== txt) el.textContent = txt; }); }
    function tick() {
      var now = Date.now();
      if (now - lastAbbr > 60000) { nyz = tzAbbr(NY); ltz = tzAbbr(localTz); lastAbbr = now; }
      var l = label(now);
      w.classList.toggle('is-open', l.open);
      setAll('.mclock-state', l.text + (l.early ? ' (early close)' : ''));
      setAll('.mclock-pstate', l.text + (l.early ? ' (early close)' : ''));
      setAll('.mclock-short', l.short);
      setAll('.mclock-ny', nyF.format(now));
      setAll('.mclock-nyhm', nyHmF.format(now));
      setAll('.mclock-lthm', locHmF.format(now));
      setAll('.mclock-lt', locF.format(now));
      setAll('.mclock-nyz', nyz);
      setAll('.mclock-ltz', ltz);
      w.classList.toggle('same-tz', !!localTz && localTz === NY);
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
