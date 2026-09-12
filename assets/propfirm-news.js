// Stryker Trading Academy — news blackout guard
//
// Pure. Turns the economic calendar's high-impact releases into the restricted
// windows most prop firms enforce, and checks journal trades against them.
//
// THE TIMEZONE PROBLEM, WHICH IS THE WHOLE PROBLEM
//
// A journal trade stores a date and an HH:MM time, and NOTHING about what zone
// that time is in. Members type whatever their platform showed them, which is
// often broker server time (frequently UTC+2 or +3), sometimes exchange time,
// sometimes their own clock. The calendar stores UTC.
//
// A blackout window is four minutes wide. Comparing an unknown-zone time
// against a UTC instant can be wrong by hours, and a tool that tells someone
// "you traded through PPI" when they did not — or worse, clears them when they
// did — is actively harmful. So the audit REFUSES to run until the member has
// stated which zone their journal times are in, exactly like the rule limits.
// Upcoming windows need no journal time at all and are always available.
//
// WHAT THIS IS NOT
//
// It is not a compliance ruling. Firms differ on whether the restriction
// covers all high-impact news or only news affecting the instrument traded,
// on whether it is symmetric around the release, and on whether a position
// merely held through the window counts. The defaults here are the
// conservative reading. The member's own firm decides.

(function (root) {
  'use strict';

  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  // How far the named zone is ahead of UTC at a given instant, in ms.
  function tzOffsetMs(utcMs, tz) {
    try {
      const p = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).formatToParts(new Date(utcMs));
      const g = (k) => +p.find((x) => x.type === k).value;
      return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - utcMs;
    } catch (e) {
      return 0;
    }
  }

  // A wall-clock date and time in a named zone, as a UTC instant.
  // Two passes: the first offset is looked up at the wrong instant, which is
  // off by an hour across a DST boundary. Re-reading it at the corrected
  // instant fixes that, and is why this is not a one-liner.
  function zonedToUtc(dateStr, timeStr, tz) {
    if (!dateStr || !timeStr) return null;
    const naive = Date.parse(String(dateStr) + 'T' + String(timeStr).slice(0, 5) + ':00Z');
    if (!isFinite(naive)) return null;
    if (!tz || tz === 'UTC') return naive;
    let utc = naive - tzOffsetMs(naive, tz);
    utc = naive - tzOffsetMs(utc, tz);
    return utc;
  }

  // ---- windows -------------------------------------------------------------

  const IMPACT_RANK = { high: 0, medium: 1, low: 2, holiday: 3 };

  // Turns calendar events into restricted windows. `currencies` null means
  // every currency, which is the conservative default: most firms police the
  // clock, not whether the release was relevant to your instrument.
  function windowsFor(events, rules) {
    const r = rules || {};
    const before = num(r.newsBeforeMin);
    const after = num(r.newsAfterMin);
    if (before === null && after === null) return [];
    const b = (before || 0) * 60000;
    const a = (after || 0) * 60000;
    const floor = r.newsImpact || 'high';
    const curs = Array.isArray(r.newsCurrencies) && r.newsCurrencies.length ? r.newsCurrencies : null;

    return (events || [])
      .filter((e) => e && e.at && e.impact !== 'holiday' && !e.allday
        && IMPACT_RANK[e.impact] <= IMPACT_RANK[floor]
        && (!curs || curs.indexOf(e.cur) >= 0))
      .map((e) => {
        const at = Date.parse(e.at);
        return isFinite(at)
          ? { at: at, from: at - b, to: at + a, event: e.event, cur: e.cur, impact: e.impact }
          : null;
      })
      .filter(Boolean)
      .sort((x, y) => x.from - y.from);
  }

  // The window covering `now`, if any, and the next one after it.
  function status(windows, now) {
    const t = now || Date.now();
    const inside = (windows || []).find((w) => t >= w.from && t <= w.to) || null;
    const next = (windows || []).find((w) => w.from > t) || null;
    return {
      inside: inside,
      next: next,
      msUntilNext: next ? next.from - t : null,
      msUntilClear: inside ? inside.to - t : null
    };
  }

  // ---- the audit -----------------------------------------------------------

  // Checks journal trades against the windows. Reports THREE counts, not one:
  // how many were checked, how many could not be (no time recorded), and how
  // many fall outside the calendar's own range. A clean result that quietly
  // skipped half the journal is not a clean result.
  function audit(trades, windows, opts) {
    const o = opts || {};
    const tz = o.journalTz || 'UTC';
    const account = o.account || null;
    const lo = o.rangeStart ? Date.parse(o.rangeStart + 'T00:00:00Z') : null;
    const hi = o.rangeEnd ? Date.parse(o.rangeEnd + 'T23:59:59Z') : null;

    const hits = [];
    let checked = 0, noTime = 0, outOfRange = 0;

    (trades || []).forEach((t) => {
      if (!t || (account && (t.account || '') !== account)) return;
      if (num(t.pnl) === null) return;              // open trades have no outcome to judge

      // Range first: a trade the calendar does not reach cannot be cleared OR
      // flagged, and counting it as "no time" would misattribute the gap.
      const dayMs = Date.parse(String(t.date || '') + 'T12:00:00Z');
      if (!isFinite(dayMs) || (lo !== null && dayMs < lo) || (hi !== null && dayMs > hi)) {
        outOfRange++;
        return;
      }
      if (!t.time) { noTime++; return; }

      const at = zonedToUtc(t.date, t.time, tz);
      if (at === null) { noTime++; return; }
      checked++;

      const w = (windows || []).find((x) => at >= x.from && at <= x.to);
      if (w) hits.push({ trade: t, window: w, at: at });
    });

    return {
      hits: hits, checked: checked, noTime: noTime, outOfRange: outOfRange,
      total: checked + noTime + outOfRange,
      // Only meaningful against `checked`. Expressing it against the total
      // would flatter a journal that mostly could not be checked.
      clean: hits.length === 0 && checked > 0
    };
  }

  function isConfigured(rules) {
    if (!rules) return false;
    const has = num(rules.newsBeforeMin) !== null || num(rules.newsAfterMin) !== null;
    return !!(has && (num(rules.newsBeforeMin) > 0 || num(rules.newsAfterMin) > 0));
  }

  function canAudit(rules) {
    return isConfigured(rules) && !!(rules.journalTz && rules.journalTzConfirmed);
  }

  root.propfirmNews = {
    tzOffsetMs: tzOffsetMs,
    zonedToUtc: zonedToUtc,
    windowsFor: windowsFor,
    status: status,
    audit: audit,
    isConfigured: isConfigured,
    canAudit: canAudit
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.propfirmNews;
})(typeof window !== 'undefined' ? window : globalThis);
