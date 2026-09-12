// Stryker Trading Academy — economic calendar
//
// Renders assets/econ-calendar.json on economic-calendar.html (#ec-page) and a
// compact "next release" strip on the dashboard (#dash-cal) and the brief.
// Depends on: assets/sanitize.js (stkEsc), assets/motion.js (stkMotion).
//
// WHY UTC IN THE FILE AND LOCAL TIME ON SCREEN
//
// The file stores one field per event: an ISO UTC timestamp. Nothing else is
// safe. "08:30 ET" is wrong for most of the membership all year and wrong for
// everyone twice a year when the clocks move, and a calendar that shows the
// wrong minute for a high-impact release is worse than no calendar. The
// renderer converts to the reader's own clock with Intl, and offers a
// New York view for people who think in the session's own time.
//
// WHY DEFAULT TO USD
//
// Asked for, and right. Index futures and the dollar are what this membership
// trades; every other currency on the page is context for those. The filter
// is a real filter though — it changes the day headers and the counts, not
// just which rows are dimmed.
//
// IMPACT IS A MARKET-STRUCTURE CLAIM
//
// "High" here means the spread widens and the first move often reverses. It is
// not a claim about which release matters most to the economy. That
// distinction is spelled out on the page, because trading a medium-impact row
// as if it were noise is how people get hurt on a quiet Tuesday.

(function () {
  'use strict';

  const CAL_URL = 'assets/econ-calendar.json';

  const esc = (s) => (typeof stkEsc === 'function'
    ? stkEsc(s)
    : String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

  const M = () => (window.stkMotion || {
    reveal: function () {}, countAll: function () {}, growBars: function () {},
    flip: function (c, s, f) { f(); }, reduced: function () { return true; }
  });

  const IMPACT_RANK = { high: 0, medium: 1, low: 2, holiday: 3 };
  const NY_TZ = 'America/New_York';

  let DATA = null;
  let CUR = 'USD';           // selected currency, or 'ALL'
  let MINIMPACT = 'low';     // low = show everything
  let RANGE = 'ahead';       // see RANGES; defaults to today onwards
  let TZMODE = 'local';      // 'local' | 'ny'
  let TICKER = null;         // countdown interval

  // ---- time ----------------------------------------------------------------

  function tz() { return TZMODE === 'ny' ? NY_TZ : undefined; }

  function timeLabel(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return '--:--';
    return new Date(t).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz()
    });
  }

  function dayKey(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return 'unknown';
    // Group by the calendar day in the DISPLAYED zone, not in UTC. A 21:00 ET
    // earnings call is Thursday to a New York reader and Friday to a UTC one,
    // and it must sit under the header the reader is actually looking at.
    return new Date(t).toLocaleDateString('en-CA', { timeZone: tz() });
  }

  function dayLabel(key) {
    const d = new Date(key + 'T12:00:00Z');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz() });
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: tz() });
    const name = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
    if (key === today) return { name: name, tag: 'Today' };
    if (key === tomorrow) return { name: name, tag: 'Tomorrow' };
    return { name: name, tag: '' };
  }

  // Ranges are computed as calendar-day strings (YYYY-MM-DD) in the DISPLAYED
  // zone and compared against each event's own day key. Doing it this way
  // instead of with timestamp arithmetic means "this week" means the same
  // thing as the day headers the reader is looking at — switching to the New
  // York view reshuffles both together, and there is no hour of the day where
  // the boundary lands on the wrong side. YYYY-MM-DD also sorts as a string,
  // so the comparison is just <= and >=.
  function todayKey() {
    return new Date().toLocaleDateString('en-CA', { timeZone: tz() });
  }

  function shiftKey(key, days) {
    const d = new Date(key + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // 0 = Sunday. Weeks start Monday here: a trading week is Monday to Friday,
  // and "this week" on a Sunday should mean the week about to start, not the
  // one that just ended.
  function mondayOf(key) {
    const dow = new Date(key + 'T12:00:00Z').getUTCDay();
    return shiftKey(key, -((dow + 6) % 7));
  }

  function monthBounds(key, monthsAhead) {
    const d = new Date(key + 'T12:00:00Z');
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + (monthsAhead || 0));
    const from = d.toISOString().slice(0, 10);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);            // day 0 of the next month is the last of this one
    return { from: from, to: d.toISOString().slice(0, 10) };
  }

  const RANGES = {
    // The default. Not "today" — a calendar whose job is preparation has to
    // show what is coming, and a member opening this at 06:00 needs the rest
    // of the week, not just the next few hours.
    ahead:  { label: 'From today', span: () => ({ from: todayKey(), to: null }) },
    today:  { label: 'Today',      span: () => ({ from: todayKey(), to: todayKey() }) },
    past:   { label: 'Past week',  span: () => ({ from: shiftKey(todayKey(), -6), to: todayKey() }) },
    week:   { label: 'This week',  span: () => { const m = mondayOf(todayKey());
                                                 return { from: m, to: shiftKey(m, 6) }; } },
    next:   { label: 'Next week',  span: () => { const m = shiftKey(mondayOf(todayKey()), 7);
                                                 return { from: m, to: shiftKey(m, 6) }; } },
    month:  { label: 'This month', span: () => monthBounds(todayKey(), 0) },
    nmonth: { label: 'Next month', span: () => monthBounds(todayKey(), 1) },
    all:    { label: 'All dates',  span: () => ({ from: null, to: null }) }
  };
  const RANGE_ORDER = ['ahead', 'today', 'past', 'week', 'next', 'month', 'nmonth', 'all'];

  function span() {
    return (RANGES[RANGE] || RANGES.ahead).span();
  }

  function inRange(ev, s) {
    const k = dayKey(ev.at);
    if (s.from && k < s.from) return false;
    if (s.to && k > s.to) return false;
    return true;
  }

  // The IANA identifier is the wrong thing to print. It is a database key, not
  // a label: a reader in Kolkata was being shown "Asia/Calcutta" — a deprecated
  // alias for a city that changed its name in 2001 — where they expected a
  // clock. Ask Intl for the short name instead and get "IST", "BST", "EDT" or
  // "GMT+5:30", which is what people actually say.
  function zoneName() {
    const zone = TZMODE === 'ny' ? NY_TZ : undefined;
    try {
      const part = new Intl.DateTimeFormat(undefined, { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(new Date()).find((p) => p.type === 'timeZoneName');
      if (part && part.value) return part.value;
    } catch (e) { /* fall through */ }
    return TZMODE === 'ny' ? 'New York' : 'your time';
  }

  function countdown(ms) {
    if (ms <= 0) return null;
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (d > 0) return d + 'd ' + h + 'h ' + String(m).padStart(2, '0') + 'm';
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(ss).padStart(2, '0') + 's';
    return m + 'm ' + String(ss).padStart(2, '0') + 's';
  }

  // ---- selection -----------------------------------------------------------

  // Currency and impact only. The date range is applied separately, because
  // the two things it feeds want different answers: the table browses a
  // window, the next-release card is always about now.
  function matches(ev) {
    if (CUR !== 'ALL' && ev.cur !== CUR) return false;
    // A holiday is not an impact level, it is a different kind of row, and a
    // closed market is the single most useful thing this page can tell
    // someone. It survives every impact floor.
    if (ev.impact === 'holiday') return true;
    if (IMPACT_RANK[ev.impact] > IMPACT_RANK[MINIMPACT]) return false;
    return true;
  }

  // What the table shows: everything, including the date range.
  function shown() {
    const s = span();
    return (DATA.events || []).filter((e) => matches(e) && inRange(e, s));
  }

  // Every chip's badge answers exactly one question: how many rows would I see
  // if I clicked THIS, leaving my other choices alone. Built from one helper so
  // the numbers are comparable across the three rows — a currency count that
  // quietly ignored the impact floor could promise three rows and deliver one.
  function countWith(over) {
    const o = over || {};
    const cur = o.cur !== undefined ? o.cur : CUR;
    const imp = o.imp !== undefined ? o.imp : MINIMPACT;
    const sp = (RANGES[o.range !== undefined ? o.range : RANGE] || RANGES.ahead).span();
    return (DATA.events || []).filter((e) => {
      if (cur !== 'ALL' && e.cur !== cur) return false;
      if (e.impact !== 'holiday' && IMPACT_RANK[e.impact] > IMPACT_RANK[imp]) return false;
      return inRange(e, sp);
    }).length;
  }

  // What the hero and the strip show. Deliberately NOT range-filtered: "next
  // release" means the next one, full stop. Browsing last week's prints should
  // not make the countdown claim there is nothing coming.
  function nextUp() {
    const now = Date.now();
    return (DATA.events || []).filter((e) =>
        matches(e) && Date.parse(e.at) > now && e.impact !== 'holiday')
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] || null;
  }

  // Same rule as the brief and the map: the generator knows when the next
  // session opens and may declare an explicit expiry, so a Friday file does
  // not spend the whole weekend claiming to be out of date.
  function isStale() {
    const until = Date.parse(DATA && DATA.goodUntil);
    if (isFinite(until)) return Date.now() > until;
    const t = Date.parse(DATA && DATA.generatedAt);
    if (!isFinite(t)) return true;
    return (Date.now() - t) / 3600000 > (Number(DATA.staleAfterHours) || 30);
  }

  function curMeta(code) {
    return (DATA.currencies || []).find((c) => c.code === code) || { code: code, name: code, flag: '' };
  }

  // ---- rows ----------------------------------------------------------------

  function impactDots(impact) {
    if (impact === 'holiday') {
      return '<span class="ec-impact is-holiday" title="Market holiday">' +
        '<span class="ec-imp-word">Holiday</span></span>';
    }
    const n = impact === 'high' ? 3 : (impact === 'medium' ? 2 : 1);
    let bars = '';
    for (let i = 0; i < 3; i++) bars += '<i class="ec-bar' + (i < n ? ' on' : '') + '"></i>';
    return '<span class="ec-impact is-' + esc(impact) + '" title="' + esc(impact) + ' impact" ' +
      'aria-label="' + esc(impact) + ' impact">' + bars +
      '<span class="ec-imp-word">' + esc(impact) + '</span></span>';
  }

  // Actual against forecast is the only comparison that matters, so it is the
  // only one that gets colour. Up or down against the PREVIOUS reading is
  // deliberately left uncoloured — it is not what price trades.
  function surprise(ev) {
    const a = parseFloat(String(ev.actual || '').replace(/[^0-9.\-]/g, ''));
    const f = parseFloat(String(ev.forecast || '').replace(/[^0-9.\-]/g, ''));
    if (!isFinite(a) || !isFinite(f)) return '';
    if (a > f) return ' is-above';
    if (a < f) return ' is-below';
    return ' is-inline';
  }

  function eventRow(ev, idx) {
    const t = Date.parse(ev.at);
    const past = t < Date.now();
    const id = 'ec-' + idx;
    const cur = curMeta(ev.cur);

    return '<tr class="ec-row stk-rise is-' + esc(ev.impact) + (past ? ' is-past' : '') +
        (ev.kind === 'earnings' ? ' is-earnings' : '') + '"' +
        ' data-at="' + esc(ev.at) + '" data-flip-key="' + esc(ev.at + '|' + ev.event) + '"' +
        (ev.note ? ' data-note="' + id + '" tabindex="0" role="button" aria-expanded="false"' +
                   ' aria-controls="' + id + '"' : '') + '>' +
      '<td class="ec-time"><span class="ec-time-v">' +
        (ev.allday ? 'All day' : esc(timeLabel(ev.at))) + '</span></td>' +
      '<td class="ec-cur"><span class="ec-flag" aria-hidden="true">' + esc(cur.flag) + '</span>' +
        '<span class="ec-code">' + esc(ev.cur) + '</span></td>' +
      '<td class="ec-imp">' + impactDots(ev.impact) + '</td>' +
      '<td class="ec-name"><span class="ec-name-v">' + esc(ev.event) + '</span>' +
        (ev.ticker ? '<span class="ec-tick">' + esc(ev.ticker) + '</span>' : '') +
        (ev.note ? '<span class="ec-why" aria-hidden="true">why</span>' : '') + '</td>' +
      '<td class="ec-num ec-actual' + surprise(ev) + '">' + (ev.actual ? esc(ev.actual) : '<i>—</i>') + '</td>' +
      '<td class="ec-num ec-fc">' + (ev.forecast ? esc(ev.forecast) : '<i>—</i>') + '</td>' +
      '<td class="ec-num ec-prev">' + (ev.previous ? esc(ev.previous) : '<i>—</i>') + '</td>' +
    '</tr>' +
    (ev.note
      ? '<tr class="ec-note-row" id="' + id + '" hidden><td colspan="7">' +
          '<div class="ec-note"><span class="ec-note-k">Why it matters</span>' +
          '<p>' + esc(ev.note) + '</p></div></td></tr>'
      : '');
  }

  function dayBlock(key, rows, startIdx) {
    const lab = dayLabel(key);
    const highs = rows.filter((e) => e.impact === 'high').length;
    return '<section class="ec-day">' +
      '<header class="ec-day-head stk-rise">' +
        '<h3>' + esc(lab.name) + '</h3>' +
        (lab.tag ? '<span class="ec-daytag">' + esc(lab.tag) + '</span>' : '') +
        '<span class="ec-daycount">' + rows.length + ' event' + (rows.length === 1 ? '' : 's') +
          (highs ? ' · <b>' + highs + ' high impact</b>' : '') + '</span>' +
      '</header>' +
      '<div class="ec-scroll"><table class="ec-table">' +
        '<caption class="sr-only">' + esc(lab.name) + ' — scheduled releases, times in ' +
          esc(zoneName()) + '.</caption>' +
        '<thead><tr>' +
          '<th scope="col">Time</th><th scope="col">Cur</th><th scope="col">Impact</th>' +
          '<th scope="col">Event</th><th scope="col">Actual</th>' +
          '<th scope="col">Forecast</th><th scope="col">Previous</th>' +
        '</tr></thead>' +
        '<tbody>' + rows.map((e, i) => eventRow(e, startIdx + i)).join('') + '</tbody>' +
      '</table></div>' +
    '</section>';
  }

  function renderDays() {
    const list = shown().slice().sort((a, b) => {
      const d = Date.parse(a.at) - Date.parse(b.at);
      return d || (IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact]);
    });
    if (!list.length) {
      const sp = span();
      const anyInRange = (DATA.events || []).some((e) => inRange(e, sp));
      const label = (RANGES[RANGE] || RANGES.ahead).label.toLowerCase();
      const anyDate = RANGE === 'all';
      // Two different empty states, because they have two different fixes.
      // "Nothing in this window at all" is about the file's coverage; "nothing
      // that matches" is about the currency and impact chips.
      return '<div class="ec-empty">' +
        (anyInRange
          ? '<b>Nothing matching those filters ' + esc(anyDate ? 'at all' : 'in ' + label) + '.</b>' +
            '<p>Widen the currency or drop the impact floor. An empty week is usually a filter, ' +
            'not a quiet market.</p>'
          : '<b>This calendar does not reach ' + esc(label) + '.</b>' +
            '<p>It covers ' + esc(DATA.rangeStart || '') + ' to ' + esc(DATA.rangeEnd || '') +
            '. Pick a nearer window, or check back once it has been refreshed.</p>') +
      '</div>';
    }
    const groups = [];
    let cur = null;
    list.forEach((e) => {
      const k = dayKey(e.at);
      if (!cur || cur.key !== k) { cur = { key: k, rows: [] }; groups.push(cur); }
      cur.rows.push(e);
    });
    let idx = 0;
    return groups.map((g) => { const s = idx; idx += g.rows.length; return dayBlock(g.key, g.rows, s); }).join('');
  }

  // ---- the next-release hero ----------------------------------------------

  function renderNext() {
    const ev = nextUp();
    if (!ev) {
      return '<div class="ec-next is-quiet stk-rise"><div class="ec-next-body">' +
        '<span class="ec-kicker">Nothing left</span>' +
        '<h2>No further releases in this window</h2>' +
        '<p>Everything on the calendar for the selected filter has already happened.</p>' +
      '</div></div>';
    }
    const cur = curMeta(ev.cur);
    return '<div class="ec-next is-' + esc(ev.impact) + ' stk-rise" data-at="' + esc(ev.at) + '">' +
      '<div class="ec-ring" aria-hidden="true">' +
        '<svg viewBox="0 0 120 120"><circle class="ec-ring-bg" cx="60" cy="60" r="52"/>' +
        '<circle class="ec-ring-fg" cx="60" cy="60" r="52"/></svg>' +
        '<span class="ec-ring-pulse"></span>' +
        '<span class="ec-ring-time">' + esc(timeLabel(ev.at)) + '</span>' +
      '</div>' +
      '<div class="ec-next-body">' +
        '<span class="ec-kicker">Next release</span>' +
        '<h2>' + esc(ev.event) + '</h2>' +
        '<div class="ec-next-meta">' +
          '<span class="ec-flag" aria-hidden="true">' + esc(cur.flag) + '</span>' +
          '<span class="ec-code">' + esc(ev.cur) + '</span>' +
          impactDots(ev.impact) +
          '<span class="ec-next-at">' + esc(timeLabel(ev.at)) + ' ' + esc(zoneName()) + '</span>' +
        '</div>' +
        '<div class="ec-cd"><span class="ec-cd-v" id="ec-countdown">—</span>' +
          '<span class="ec-cd-l">until it prints</span></div>' +
        (ev.forecast
          ? '<div class="ec-next-nums">' +
              '<span><b>' + esc(ev.forecast) + '</b>forecast</span>' +
              (ev.previous ? '<span><b>' + esc(ev.previous) + '</b>previous</span>' : '') +
            '</div>'
          : '') +
        (ev.note ? '<p class="ec-next-note">' + esc(ev.note) + '</p>' : '') +
      '</div>' +
    '</div>';
  }

  function tick() {
    const el = document.getElementById('ec-countdown');
    if (!el) return;
    const host = el.closest('[data-at]');
    const at = Date.parse(host && host.getAttribute('data-at'));
    if (!isFinite(at)) return;
    const left = at - Date.now();
    const label = countdown(left);
    if (label === null) {
      el.textContent = 'now';
      host.classList.add('is-live');
      return;
    }
    el.textContent = label;
    host.classList.remove('is-live');
    // Inside the last five minutes the card starts breathing. That window is
    // exactly when someone should be flat or deliberately positioned, not
    // drifting into a print without noticing.
    host.classList.toggle('is-imminent', left < 300000);
    const ring = host.querySelector('.ec-ring-fg');
    if (ring) {
      // The ring fills over the final hour, so it means something at a glance
      // rather than being decoration that always looks the same.
      const p = Math.max(0, Math.min(1, 1 - left / 3600000));
      const c = 2 * Math.PI * 52;
      ring.style.strokeDasharray = c;
      ring.style.strokeDashoffset = c * (1 - p);
    }
  }

  // ---- banks ---------------------------------------------------------------

  function renderBanks() {
    const banks = DATA.banks || [];
    if (!banks.length) return '';
    return '<section class="ec-block">' +
      '<h2>Where policy actually stands</h2>' +
      '<p class="ec-note-p">A calendar tells you when. This tells you from what. Every forecast on ' +
        'this page is a move away from one of these numbers.</p>' +
      '<div class="ec-banks">' + banks.map((b) => {
        const cur = curMeta(b.cur);
        return '<article class="ec-bank stk-rise is-' + esc(b.bias) + '">' +
          '<header><span class="ec-flag" aria-hidden="true">' + esc(cur.flag) + '</span>' +
            '<span class="ec-code">' + esc(b.cur) + '</span>' +
            '<span class="ec-bias" aria-hidden="true"></span></header>' +
          '<div class="ec-bank-rate">' + esc(b.rate) + '</div>' +
          '<div class="ec-bank-name">' + esc(b.bank) + '</div>' +
          '<div class="ec-bank-next">' + esc(b.expect) + '</div>' +
        '</article>';
      }).join('') + '</div>' +
    '</section>';
  }

  // ---- controls ------------------------------------------------------------

  function renderControls() {
    const counts = {};
    (DATA.currencies || []).forEach((c) => { counts[c.code] = countWith({ cur: c.code }); });
    const list = (DATA.currencies || []).filter((c) => counts[c.code]);
    const allCount = countWith({ cur: 'ALL' });

    // A chip reading 0 is information — it says the window is empty before you
    // click it, rather than sending you to a blank page.
    return '<div class="ec-controls">' +
      '<div class="ec-ctrl-row" role="group" aria-label="Filter by date range">' +
        '<span class="ec-ctrl-label">Showing</span>' +
        RANGE_ORDER.map((k) => {
          const n = countWith({ range: k });
          return '<button type="button" class="ec-chip is-range' +
            (RANGE === k ? ' is-on' : '') + (n === 0 ? ' is-empty' : '') + '" ' +
            'data-range="' + k + '" aria-pressed="' + (RANGE === k) + '">' +
            esc(RANGES[k].label) + '<span class="ec-chip-n">' + n + '</span></button>';
        }).join('') +
      '</div>' +
      '<div class="ec-ctrl-row" role="group" aria-label="Filter by currency">' +
        '<span class="ec-ctrl-label">Currency</span>' +
        '<button type="button" class="ec-chip' + (CUR === 'ALL' ? ' is-on' : '') + '" data-cur="ALL" ' +
          'aria-pressed="' + (CUR === 'ALL') + '">All<span class="ec-chip-n">' +
          allCount + '</span></button>' +
        list.map((c) =>
          '<button type="button" class="ec-chip' + (CUR === c.code ? ' is-on' : '') + '" ' +
            'data-cur="' + esc(c.code) + '" aria-pressed="' + (CUR === c.code) + '" ' +
            'title="' + esc(c.name) + '">' +
            '<span class="ec-flag" aria-hidden="true">' + esc(c.flag) + '</span>' + esc(c.code) +
            '<span class="ec-chip-n">' + counts[c.code] + '</span></button>').join('') +
      '</div>' +
      '<div class="ec-ctrl-row">' +
        '<span class="ec-ctrl-label">Impact</span>' +
        ['high', 'medium', 'low'].map((k) => {
          const n = countWith({ imp: k });
          return '<button type="button" class="ec-chip is-imp' + (MINIMPACT === k ? ' is-on' : '') +
            (n === 0 ? ' is-empty' : '') + '" ' +
            'data-imp="' + k + '" aria-pressed="' + (MINIMPACT === k) + '">' +
            (k === 'high' ? 'High only' : k === 'medium' ? 'Medium and up' : 'All impacts') +
            '<span class="ec-chip-n">' + n + '</span></button>';
        }).join('') +
        '<span class="ec-ctrl-spacer"></span>' +
        '<span class="ec-ctrl-label">Times in</span>' +
        '<button type="button" class="ec-chip' + (TZMODE === 'local' ? ' is-on' : '') + '" ' +
          'data-tz="local" aria-pressed="' + (TZMODE === 'local') + '">Your clock</button>' +
        '<button type="button" class="ec-chip' + (TZMODE === 'ny' ? ' is-on' : '') + '" ' +
          'data-tz="ny" aria-pressed="' + (TZMODE === 'ny') + '">New York</button>' +
      '</div>' +
    '</div>';
  }

  // ---- page ----------------------------------------------------------------

  function renderPage(mount) {
    mount.innerHTML =
      '<header class="ec-head stk-rise">' +
        '<span class="ec-kicker">Economic calendar</span>' +
        '<h1>What is scheduled, and what it does to the tape</h1>' +
        '<p class="ec-standfirst">Every release with its consensus and its previous reading, in your ' +
          'own clock. Opens on what is still to come; the range chips reach back over ' +
          'the past week or forward into next month. Impact is graded by what happens to ' +
          'spreads and liquidity at the print, not by what the number means for the economy.</p>' +
      '</header>' +
      (isStale()
        ? '<div class="ec-stale"><b>This calendar has not been refreshed.</b> Times and forecasts ' +
          'move. Confirm against a primary source before trading any release below.</div>'
        : '') +
      '<div id="ec-next-mount"></div>' +
      '<div id="ec-controls-mount"></div>' +
      '<div id="ec-days"></div>' +
      renderBanks() +
      ((DATA.howToRead || []).length
        ? '<section class="ec-block"><h2>How to read this page</h2>' +
            '<ul class="ec-how">' + DATA.howToRead.map((h) =>
              '<li class="stk-rise"><b>' + esc(h.title) + '</b><p>' + esc(h.text) + '</p></li>').join('') +
            '</ul></section>'
        : '') +
      '<footer class="ec-foot">' +
        ((DATA.sources || []).length
          ? '<p><b>Data:</b> ' + DATA.sources.map((s) =>
              esc(s.name) + (s.note ? ' (' + esc(s.note) + ')' : '')).join(', ') + '</p>'
          : '') +
        (DATA.attribution ? '<p>' + esc(DATA.attribution) + '</p>' : '') +
        (DATA.disclaimer ? '<p class="ec-disclaimer">' + esc(DATA.disclaimer) + '</p>' : '') +
      '</footer>';

    paint(mount, true);

    mount.addEventListener('click', (e) => {
      const chip = e.target.closest('.ec-chip');
      if (chip) return onChip(mount, chip);
      const row = e.target.closest('.ec-row[data-note]');
      if (row) toggleNote(row);
    });
    mount.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest && e.target.closest('.ec-row[data-note]');
      if (!row) return;
      e.preventDefault();
      toggleNote(row);
    });

    if (TICKER) clearInterval(TICKER);
    tick();
    TICKER = setInterval(tick, 1000);
  }

  function toggleNote(row) {
    const note = document.getElementById(row.getAttribute('data-note'));
    if (!note) return;
    const open = !note.hidden;
    note.hidden = open;
    row.setAttribute('aria-expanded', String(!open));
    row.classList.toggle('is-open', !open);
  }

  function onChip(mount, chip) {
    const c = chip.getAttribute('data-cur');
    const i = chip.getAttribute('data-imp');
    const z = chip.getAttribute('data-tz');
    const g = chip.getAttribute('data-range');
    if (c) CUR = c;
    else if (i) MINIMPACT = i;
    else if (z) TZMODE = z;
    else if (g) RANGE = g;
    else return;
    paint(mount, false);
  }

  function paint(mount, first) {
    const days = mount.querySelector('#ec-days');
    const ctrls = mount.querySelector('#ec-controls-mount');
    const next = mount.querySelector('#ec-next-mount');

    // Re-sorting under a filter change is a FLIP so surviving rows travel to
    // their new place instead of the table simply looking different.
    M().flip(days, '.ec-row', () => {
      if (days) days.innerHTML = renderDays();
    });
    if (ctrls) ctrls.innerHTML = renderControls();
    if (next) next.innerHTML = renderNext();

    M().reveal(mount, { stagger: first ? 26 : 0 });
    tick();
  }

  // ---- the compact strip ---------------------------------------------------

  function renderStrip(mount) {
    const ev = nextUp();
    const soon = shown().filter((e) => Date.parse(e.at) > Date.now() && e.impact === 'high')
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 3);
    if (!ev) { mount.hidden = true; return; }
    const cur = curMeta(ev.cur);

    mount.hidden = false;
    mount.innerHTML =
      '<section class="ec-strip stk-rise">' +
        '<div class="ec-strip-head">' +
          '<span class="ec-kicker">Next on the calendar</span>' +
          '<a class="ec-more" href="economic-calendar.html">Full calendar &rarr;</a>' +
        '</div>' +
        '<div class="ec-strip-next is-' + esc(ev.impact) + '" data-at="' + esc(ev.at) + '">' +
          '<span class="ec-flag" aria-hidden="true">' + esc(cur.flag) + '</span>' +
          '<div><b>' + esc(ev.event) + '</b>' +
            '<span>' + esc(timeLabel(ev.at)) + ' ' + esc(zoneName()) + '</span></div>' +
          '<span class="ec-cd-v" id="ec-countdown">—</span>' +
        '</div>' +
        (soon.length > 1
          ? '<ul class="ec-strip-list">' + soon.slice(1).map((e) =>
              '<li><span class="ec-code">' + esc(e.cur) + '</span>' +
                '<b>' + esc(e.event) + '</b>' +
                '<span>' + esc(timeLabel(e.at)) + '</span></li>').join('') + '</ul>'
          : '') +
      '</section>';

    if (TICKER) clearInterval(TICKER);
    tick();
    TICKER = setInterval(tick, 1000);
    M().reveal(mount, {});
  }

  // ---- boot ----------------------------------------------------------------

  function load() {
    return fetch(CAL_URL + '?t=' + Math.floor(Date.now() / 60000))
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('ec-page');
    const strips = [document.getElementById('dash-cal'), document.getElementById('ec-strip')].filter(Boolean);
    if (!page && !strips.length) return;

    if (page) page.innerHTML = '<div class="ec-skel">' +
      '<div class="ec-skel-hero"></div><div class="ec-skel-row"></div>' +
      '<div class="ec-skel-row"></div><div class="ec-skel-row"></div></div>';

    load().then((data) => {
      DATA = data;
      CUR = data.defaultCurrency || 'USD';
      if (page) renderPage(page);
      strips.forEach(renderStrip);
    }).catch((err) => {
      console.error('Stryker: economic calendar could not be loaded', err);
      if (page) page.innerHTML = '<div class="ec-stale"><b>The calendar could not be loaded.</b> ' +
        'Refresh in a moment.</div>';
      strips.forEach((m) => { m.hidden = true; m.innerHTML = ''; });
    });
  });

  window.__EC = {
    countdown: countdown,
    surprise: surprise,
    setData: function (d) { DATA = d; CUR = (d && d.defaultCurrency) || 'USD'; },
    setFilter: function (c, i, z, g) {
      if (c) CUR = c; if (i) MINIMPACT = i; if (z) TZMODE = z; if (g) RANGE = g;
    },
    span: span,
    ranges: RANGE_ORDER,
    getRange: function () { return RANGE; },
    shown: shown,
    nextUp: nextUp,
    dayKey: dayKey,
    renderPage: renderPage
  };
})();
