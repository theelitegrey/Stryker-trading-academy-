// Stryker Trading Academy — pre-market brief
// Renders assets/market-brief.json in two places: a compact card on the user
// dashboard (#dash-brief) and the full page (market-brief.html, #mb-page).
// Depends on: assets/sanitize.js for stkEsc.
//
// WHY A FLAT FILE AND NOT AN API
//
// The brief is written by a scheduled job that researches the overnight
// session and commits the JSON. The site only renders it. That means no API
// key in the browser, no per-visit cost, no third-party dependency at page
// load, and the same publish-a-file shape the Global Monitor already uses.
//
// STALENESS IS THE WHOLE PROBLEM
//
// A stale market brief is worse than no market brief. Yesterday's levels
// presented as today's plan is actively harmful in a way that a stale blog
// post is not. So every render checks generatedAt against staleAfterHours and,
// once past it, says so plainly and HIDES the economic calendar entirely —
// the calendar is the part someone would act on, and a day-old one is a lie
// about what is coming. The analysis stays visible, marked as dated, because
// context about what moved the tape is still worth reading.

(function () {
  'use strict';

  const BRIEF_URL = 'assets/market-brief.json';

  const esc = (s) => (typeof stkEsc === 'function'
    ? stkEsc(s)
    : String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

  function load() {
    // Cache-busted because the file changes daily and lives under /assets/,
    // which _headers caches for a year. The header override is there too; this
    // is belt and braces for anything that ignores it.
    return fetch(BRIEF_URL + '?t=' + Math.floor(Date.now() / 60000))
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function ageHours(brief) {
    const t = Date.parse(brief && brief.generatedAt);
    if (!isFinite(t)) return Infinity;
    return (Date.now() - t) / 3600000;
  }

  function isStale(brief) {
    const limit = Number(brief && brief.staleAfterHours) || 30;
    return ageHours(brief) > limit;
  }

  function whenLabel(brief) {
    const t = Date.parse(brief && brief.generatedAt);
    if (!isFinite(t)) return 'date unknown';
    const d = new Date(t);
    const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return day + ', ' + time;
  }

  function staleBanner(brief) {
    const hrs = Math.floor(ageHours(brief));
    const when = hrs >= 48 ? Math.floor(hrs / 24) + ' days old' : hrs + ' hours old';
    return '<div class="mb-stale">' +
      '<b>This brief has not been refreshed.</b> It was written ' + esc(when) +
      ', so today’s releases are not shown. Read the analysis as background, not as a plan for this session.' +
      '</div>';
  }

  // ---- dashboard card ------------------------------------------------------

  function renderCard(mount, brief) {
    const stale = isStale(brief);
    const bullets = (brief.bullets || []).slice(0, 2);
    const next = (brief.calendar || [])[0];

    mount.hidden = false;
    mount.innerHTML =
      '<section class="mb-card">' +
        '<div class="mb-card-head">' +
          '<div>' +
            '<span class="mb-kicker">Pre-market brief</span>' +
            '<h3>' + esc(brief.headline || 'Market brief') + '</h3>' +
          '</div>' +
          '<span class="mb-when' + (stale ? ' is-stale' : '') + '">' + esc(whenLabel(brief)) + '</span>' +
        '</div>' +
        (stale ? staleBanner(brief) : '') +
        '<p class="mb-standfirst">' + esc(brief.standfirst || '') + '</p>' +
        (bullets.length
          ? '<ul class="mb-card-points">' + bullets.map((b) =>
              '<li><b>' + esc(b.title) + '</b> ' + esc(b.text) + '</li>').join('') + '</ul>'
          : '') +
        (!stale && next
          ? '<div class="mb-next"><span class="mb-next-time">' + esc(next.time) + '</span>' +
            '<span class="mb-next-event">' + esc(next.event) + '</span></div>'
          : '') +
        '<a class="mb-more" href="market-brief.html">Read the full brief &rarr;</a>' +
      '</section>';
  }

  // ---- full page -----------------------------------------------------------

  function renderPage(mount, brief) {
    const stale = isStale(brief);

    const calendar = (!stale && (brief.calendar || []).length)
      ? '<section class="mb-block">' +
          '<h2>On the calendar</h2>' +
          '<ul class="mb-cal">' + brief.calendar.map((c) =>
            '<li>' +
              '<span class="mb-cal-time">' + esc(c.time) + '</span>' +
              '<span class="mb-cal-body">' +
                '<b>' + esc(c.event) + '</b>' +
                (c.note ? '<span>' + esc(c.note) + '</span>' : '') +
              '</span>' +
            '</li>').join('') + '</ul>' +
        '</section>'
      : '';

    const archive = (brief.archive || []).length
      ? '<section class="mb-block">' +
          '<h2>Earlier briefs</h2>' +
          '<ul class="mb-archive">' + brief.archive.map((a) =>
            '<li><span class="mb-archive-date">' + esc(a.date) + '</span>' +
              '<b>' + esc(a.headline) + '</b>' +
              '<p>' + esc(a.summary) + '</p></li>').join('') + '</ul>' +
        '</section>'
      : '';

    mount.innerHTML =
      '<header class="mb-head">' +
        '<span class="mb-kicker">Pre-market brief</span>' +
        '<h1>' + esc(brief.headline || 'Market brief') + '</h1>' +
        '<p class="mb-standfirst">' + esc(brief.standfirst || '') + '</p>' +
        '<p class="mb-meta' + (stale ? ' is-stale' : '') + '">Written ' + esc(whenLabel(brief)) + '</p>' +
      '</header>' +

      (stale ? staleBanner(brief) : '') +

      '<section class="mb-block">' +
        '<h2>What is actually moving it</h2>' +
        '<ul class="mb-points">' + (brief.bullets || []).map((b) =>
          '<li><b>' + esc(b.title) + '</b><p>' + esc(b.text) + '</p></li>').join('') + '</ul>' +
      '</section>' +

      calendar +

      (brief.sessionNote
        ? '<section class="mb-block mb-note"><h2>Reading the session</h2><p>' + esc(brief.sessionNote) + '</p></section>'
        : '') +

      (brief.watchOut
        ? '<section class="mb-block mb-warn"><h2>The trap today</h2><p>' + esc(brief.watchOut) + '</p></section>'
        : '') +

      archive +

      '<footer class="mb-foot">' +
        ((brief.sources || []).length
          ? '<p><b>Sources:</b> ' + brief.sources.map((s) =>
              esc(s.name) + (s.note ? ' (' + esc(s.note) + ')' : '')).join(', ') + '</p>'
          : '') +
        (brief.attribution ? '<p>' + esc(brief.attribution) + '</p>' : '') +
        (brief.disclaimer ? '<p class="mb-disclaimer">' + esc(brief.disclaimer) + '</p>' : '') +
      '</footer>';
  }

  // ---- boot ----------------------------------------------------------------

  function fail(mount, isPage) {
    if (!mount) return;
    if (isPage) {
      mount.innerHTML = '<div class="mb-stale"><b>The brief could not be loaded.</b> ' +
        'Refresh in a moment, or check back before the next session.</div>';
    } else {
      // On the dashboard a missing brief is not worth a broken panel. Say
      // nothing rather than showing an error box among working modules.
      mount.hidden = true;
      mount.innerHTML = '';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const card = document.getElementById('dash-brief');
    const page = document.getElementById('mb-page');
    if (!card && !page) return;

    load().then((brief) => {
      if (card) renderCard(card, brief);
      if (page) renderPage(page, brief);
    }).catch((err) => {
      console.error('Stryker: market brief could not be loaded', err);
      fail(card, false);
      fail(page, true);
    });
  });

  window.__MB = { isStale, ageHours, renderCard, renderPage, whenLabel };
})();
