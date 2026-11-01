// TradeZoro — pre-market brief
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

  // Live copy first: the server feeder (workers/book-recorder/brief-feeder) publishes a fresh file
  // to the recorder Worker every 15 min in the US session without a site deploy. The committed
  // assets/ copy (refreshed once a day) is the fallback when the Worker is slow or unreachable.
  const TERMINAL_LIVE = 'https://book-recorder.theelitegrey.workers.dev/terminal/';
  function loadTerminal(name, local) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 5000) : 0;
    const fallback = () => fetch(local + '?t=' + Math.floor(Date.now() / 60000))
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    return fetch(TERMINAL_LIVE + name + '.json', ctl ? { signal: ctl.signal } : {})
      .then((r) => { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { if (!d || !isFinite(Date.parse(d.generatedAt))) throw new Error('bad file'); return d; })
      .catch(() => { clearTimeout(timer); return fallback(); });
  }

  // Guarded, like the map's: no motion.js means no movement, never no content.
  const M = () => (window.stkMotion || { reveal: function () {} });

  const esc = (s) => (typeof stkEsc === 'function'
    ? stkEsc(s)
    : String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

  function load() {
    // Cache-busted because the file changes daily and lives under /assets/,
    // which _headers caches for a year. The header override is there too; this
    // is belt and braces for anything that ignores it.
    return loadTerminal('market-brief', BRIEF_URL);
  }

  function ageHours(brief) {
    const t = Date.parse(brief && brief.generatedAt);
    if (!isFinite(t)) return Infinity;
    return (Date.now() - t) / 3600000;
  }

  // WHY A FILE CAN DECLARE ITS OWN EXPIRY
  //
  // A fixed hour count cannot know the market is shut. With staleAfterHours
  // alone a Friday brief turns red on Saturday afternoon and stays red all
  // weekend, shouting "not refreshed" when nothing has happened and nothing
  // can. A banner that cries wolf every weekend is a banner people learn to
  // scroll past, which is exactly when it stops protecting anyone.
  //
  // So the generator, which knows when the next session opens, may set
  // `goodUntil` to that instant. staleAfterHours stays as the fallback for a
  // file that does not say.
  function isStale(brief) {
    const until = Date.parse(brief && brief.goodUntil);
    if (isFinite(until)) return Date.now() > until;
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
    // "built 43 hours old" is not English. Age reads as "ago"; the noun form
    // belongs to the thing, not the act of building it.
    const when = hrs >= 48 ? Math.floor(hrs / 24) + ' days ago' : hrs + ' hours ago';
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
      '<section class="mb-card stk-rise">' +
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
              '<li class="stk-rise"><b>' + esc(b.title) + '</b> ' + esc(b.text) + '</li>').join('') + '</ul>'
          : '') +
        (!stale && next
          ? '<div class="mb-next"><span class="mb-next-time">' + esc(next.time) + '</span>' +
            '<span class="mb-next-event">' + esc(next.event) + '</span></div>'
          : '') +
        '<a class="mb-more" href="market-brief.html">Read the full brief &rarr;</a>' +
      '</section>';

    M().reveal(mount, {});
  }


  // ---- visuals -------------------------------------------------------------
  // Everything below is read out of the numbers the brief already prints in its bullets
  // ("the S&P 500 is at 7,714.25 (−1.17%)"). Nothing is added: no new levels, no forecasts. The
  // "prior close" on a ladder is arithmetic on the printed price and day change, and says so.
  const V = () => window.stkViz;
  const num = (t) => parseFloat(String(t).replace(/,/g, ''));
  const sgn = (t) => (/^[\u2212\-]/.test(t) ? -1 : 1) * Math.abs(num(String(t).replace(/^[\u2212\-+]/, '')));
  function parseMoves(brief) {
    const re = /(?:^|[,:.;]\s+|\band\s+)(?:the |The )?([A-Za-z][A-Za-z0-9&\/. \-]{1,26}?)\s+(?:is at |at )?([\d,]+(?:\.\d+)?)(%?)\s*\(([+\u2212\-]?[\d.]+)(%|bp)/g;
    const out = [], seen = {};
    (brief.bullets || []).forEach((b) => {
      let m; re.lastIndex = 0;
      while ((m = re.exec(b.text || ''))) {
        let name = m[1].trim().replace(/^(?:and|the)\s+/i, '');
        name = name.charAt(0).toUpperCase() + name.slice(1);
        if (seen[name] || !isFinite(sgn(m[4]))) continue;
        seen[name] = 1;
        const dec = (m[2].split('.')[1] || '').length;
        out.push({ name: name, level: num(m[2]), dec: dec, isYield: m[3] === '%', v: sgn(m[4]), unit: m[5] });
      }
    });
    return out;
  }
  const fmtN = (n, d) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtMove = (m) => (m.v > 0 ? '+' : m.v < 0 ? '\u2212' : '') + Math.abs(m.v).toFixed(m.unit === 'bp' ? 0 : 2) + (m.unit === 'bp' ? 'bp' : '%');
  const dir = (v) => (v < 0 ? 'd' : 'u');

  function chipRow(moves) {
    const top = moves.slice().sort((a, b) => Math.abs(b.v) / (b.unit === 'bp' ? 10 : 1) - Math.abs(a.v) / (a.unit === 'bp' ? 10 : 1)).slice(0, 8);
    if (!top.length) return '';
    return '<div class="mv-chg" role="list" aria-label="What changed">' + top.map((m) => {
      const bk = m.unit === 'bp' ? V().bucket(m.v, [1, 3, 6], 1) : V().bucket(m.v, [0.25, 0.75, 1.5], 1);
      return '<span role="listitem" class="mv-pill ' + V().cls(bk) + '">' + esc(m.name) + ' <small>' + esc(fmtMove(m)) + '</small></span>';
    }).join('') + '</div>';
  }

  function ladder(m) {
    const now = m.level, prev = now / (1 + m.v / 100), span = Math.abs(now - prev) || now * 0.001;
    const lo = Math.min(now, prev) - span * 0.6, hi = Math.max(now, prev) + span * 0.6;
    const y = (p) => 14 + (hi - p) / (hi - lo) * 122;
    const yn = y(now), yp = y(prev), c = dir(m.v), X = 56;
    let ticks = '';
    for (let i = 0; i <= 6; i++) ticks += '<line class="tk" x1="' + (X - 5) + '" x2="' + X + '" y1="' + (14 + i * 122 / 6).toFixed(1) + '" y2="' + (14 + i * 122 / 6).toFixed(1) + '"/>';
    const top = yn < yp;   // now above prior close
    return '<div class="mv-lad"><div class="mv-lad-h"><b>' + esc(m.name) + '</b><span class="mv-' + (c === 'd' ? 'dn' : 'up') + '">' + esc(fmtMove(m)) + '</span></div>' +
      '<svg viewBox="0 0 170 150" role="img" aria-label="' + esc(m.name + ' now ' + fmtN(now, m.dec) + ', prior close about ' + fmtN(prev, m.dec) + ' (derived from the day change)') + '">' +
      '<line class="rl" x1="' + X + '" x2="' + X + '" y1="14" y2="136"/>' + ticks +
      '<line class="seg ' + c + '" x1="' + X + '" x2="' + X + '" y1="' + yn.toFixed(1) + '" y2="' + yp.toFixed(1) + '"/>' +
      '<circle class="dot pr" cx="' + X + '" cy="' + yp.toFixed(1) + '" r="5"/>' +
      '<circle class="dot now ' + c + '" cx="' + X + '" cy="' + yn.toFixed(1) + '" r="6"/>' +
      '<text class="ml now" x="' + (X + 12) + '" y="' + (yn + (top ? -2 : 12)).toFixed(1) + '">Now ' + esc(fmtN(now, m.dec)) + '</text>' +
      '<text class="ml" x="' + (X + 12) + '" y="' + (yp + (top ? 12 : -2)).toFixed(1) + '">Prior ' + esc(fmtN(prev, m.dec)) + '</text></svg></div>';
  }

  function visuals(moves) {
    const lev = moves.filter((m) => m.unit === '%' && !m.isYield && m.level > 0).slice(0, 8);
    const pct = moves.filter((m) => m.unit === '%' && !m.isYield).map((m) => ({ label: m.name, v: m.v }));
    const bp = moves.filter((m) => m.unit === 'bp').map((m) => ({ label: m.name + ' yield', v: m.v }));
    if (!moves.length) return '';
    const mp = Math.max.apply(null, pct.map((r) => Math.abs(r.v)).concat([0.01]));
    const mb = Math.max.apply(null, bp.map((r) => Math.abs(r.v)).concat([1]));
    return '<section class="mv-block stk-rise"><h2 class="mv-h">What changed</h2>' + chipRow(moves) + '</section>' +
      (lev.length ? '<section class="mv-block stk-rise"><h2 class="mv-h">Where price sits against the prior close</h2>' +
        '<div class="mv-ladders">' + lev.map(ladder).join('') + '</div>' +
        '<p class="mv-foot-note">Prior close is worked out from the printed price and day change; the brief publishes no other levels.</p></section>' : '') +
      '<section class="mv-block stk-rise"><h2 class="mv-h">Session move</h2><div class="mv-card"><div class="mv-bars-2">' +
        (pct.length ? '<div><p class="mv-sub">Percent change on the day</p>' + V().divBars(pct, mp, (v) => (v > 0 ? '+' : '\u2212') + Math.abs(v).toFixed(2) + '%') + '</div>' : '') +
        (bp.length ? '<div><p class="mv-sub">Treasury yields, basis points on the day</p>' + V().divBars(bp, mb, (v) => (v > 0 ? '+' : v < 0 ? '\u2212' : '') + Math.abs(v) + 'bp', 1, [1, 3, 6]) + '</div>' : '') +
      '</div></div></section>';
  }

  const det = (title, body, open) => '<details class="mv-det"' + (open ? ' open' : '') + '><summary class="mv-sum">' + esc(title) + '</summary><p>' + esc(body) + '</p></details>';

  // ---- full page -----------------------------------------------------------

  function renderPage(mount, brief) {
    const stale = isStale(brief);

    const calendar = (!stale && (brief.calendar || []).length)
      ? '<section class="mb-block stk-rise">' +
          '<h2>On the calendar</h2>' +
          '<ul class="mb-cal">' + brief.calendar.map((c) =>
            '<li class="stk-rise">' +
              '<span class="mb-cal-time">' + esc(c.time) + '</span>' +
              '<span class="mb-cal-body">' +
                '<b>' + esc(c.event) + '</b>' +
                (c.note ? '<span>' + esc(c.note) + '</span>' : '') +
              '</span>' +
            '</li>').join('') + '</ul>' +
        '</section>'
      : '';

    const archive = (brief.archive || []).length
      ? '<section class="mb-block stk-rise">' +
          '<h2>Earlier briefs</h2>' +
          '<ul class="mb-archive">' + brief.archive.map((a) =>
            '<li><span class="mb-archive-date">' + esc(a.date) + '</span>' +
              '<b>' + esc(a.headline) + '</b>' +
              '<p>' + esc(a.summary) + '</p></li>').join('') + '</ul>' +
        '</section>'
      : '';

    mount.classList.add('mv-wide');
    mount.innerHTML =
      '<header class="mb-head stk-rise">' +
        '<span class="mb-kicker">Pre-market brief</span>' +
        '<h1>' + esc(brief.headline || 'Market brief') + '</h1>' +
        '<p class="mb-standfirst">' + esc(brief.standfirst || '') + '</p>' +
        '<p class="mb-meta' + (stale ? ' is-stale' : '') + '">Written ' + esc(whenLabel(brief)) + '</p>' +
      '</header>' +

      (stale ? staleBanner(brief) : '') +

      visuals(parseMoves(brief)) +

      '<section class="mb-block stk-rise">' +
        '<h2 class="mv-h">The notes behind it</h2>' +
        '<div class="mv-notes">' + (brief.bullets || []).map((b) => det(b.title, b.text)).join('') +
          (brief.sessionNote ? det('Reading the session', brief.sessionNote) : '') +
          (brief.watchOut ? det('The trap today', brief.watchOut, true) : '') + '</div>' +
      '</section>' +

      calendar +

      archive +

      '<footer class="mb-foot">' +
        ((brief.sources || []).length
          ? '<p><b>Sources:</b> ' + brief.sources.map((s) =>
              esc(s.name) + (s.note ? ' (' + esc(s.note) + ')' : '')).join(', ') + '</p>'
          : '') +
        (brief.attribution ? '<p>' + esc(brief.attribution) + '</p>' : '') +
        (brief.disclaimer ? '<p class="mb-disclaimer">' + esc(brief.disclaimer) + '</p>' : '') +
      '</footer>';

    M().reveal(mount, { stagger: 30 });
  }

  // ---- boot ----------------------------------------------------------------

  function fail(mount, isPage) {
    if (!mount) return;
    if (isPage) {
      mount.innerHTML = '<div class="mb-stale"><b>Brief data is temporarily unavailable.</b> ' +
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
      console.error('TradeZoro: market brief could not be loaded', err);
      fail(card, false);
      fail(page, true);
    });
  });

  // The desk (dashboard-user) reads the index ladders without mounting a card.
  function ladders(brief, n) {
    if (!V()) return '';
    const mv = parseMoves(brief).filter((m) => m.unit === '%' && !m.isYield && m.level > 0 && /S&P|Nasdaq|Dow|Russell/i.test(m.name)).slice(0, n || 4);
    return mv.length ? '<div class="mv-ladders">' + mv.map(ladder).join('') + '</div>' : '';
  }
  window.__MB = { isStale, ageHours, renderCard, renderPage, whenLabel, load, ladders };
})();
