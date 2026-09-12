// Stryker Trading Academy — cross-asset market map
// Renders assets/market-map.json in three places:
//   #mm-page   the full map (market-map.html)
//   #mm-strip  a leaders-and-laggards strip (market-brief.html)
//   #dash-map  the same strip, on the dashboard
// Depends on: assets/sanitize.js for stkEsc.
//
// WHY A FLAT FILE, AGAIN
//
// Same reason as the pre-market brief: the data is fetched and committed by a
// scheduled job, so the browser holds no API key, the page costs nothing per
// visit, and there is no third-party request at load. See tools/market-map.md.
//
// HOW THE COLOUR WORKS, AND WHY IT IS NOT EYEBALLED
//
// Returns are polarity data — up or down from a meaningful zero — so the scale
// is diverging: two hues with a neutral grey in the middle, never a rainbow.
// Each arm is a three-step one-hue ramp validated separately against both the
// dark and the light chart surface (monotone lightness, visible step gaps, the
// pale end clearing 2:1 against the surface). The values are in the CSS as
// --mm-d3..--mm-u3; do not substitute a colour by eye without re-running the
// check, because "looks fine" and "a red-green reader can tell these apart"
// are different claims.
//
// Colour is never the only encoding. Every cell prints its own number, every
// grid is a real <table> with row and column headers, and the sign is in the
// text. A reader who sees no colour at all loses nothing but scanning speed.
//
// WHY THE BUCKETS ARE PER PERIOD AND PER GROUP
//
// A 0.5% day is a large move; a 0.5% year is noise. A single threshold across
// all seven windows would paint the 1Y column solid and the 1D column blank.
// So thresholds scale with the window (BANDS) and then again with the asset
// class (group.scale in the JSON) — crypto at 3.5x, FX at 0.22x. Without that
// second factor every currency cell reads neutral and every crypto cell reads
// extreme, which tells the reader nothing about either.

(function () {
  'use strict';

  const MAP_URL = 'assets/market-map.json';

  // Every motion call goes through this. If motion.js is missing the module
  // renders exactly as before, just without the movement — a chart nobody can
  // read because an animation library failed is not a trade-off worth making.
  const M = () => (window.stkMotion || {
    reveal: function () {}, countAll: function () {}, growBars: function () {},
    drawPath: function () {}, flip: function (c, sel, f) { f(); },
    reduced: function () { return true; }
  });

  const esc = (s) => (typeof stkEsc === 'function'
    ? stkEsc(s)
    : String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));

  // Band edges per window, in percent, for a baseline asset class. Below the
  // first edge is neutral; the three edges give the three steps of each arm.
  const BANDS = {
    '1D':  [0.25, 0.75, 1.5],
    '5D':  [0.5,  1.5,  3],
    '1M':  [1,    3,    7],
    '3M':  [2,    5,    12],
    '6M':  [3,    8,    20],
    'YTD': [3,    10,   25],
    '1Y':  [5,    15,   35]
  };

  let DATA = null;
  let PERIOD = '1D';

  // ---- scale ---------------------------------------------------------------

  // Returns -3..3. Sign is direction, magnitude is which step of the arm.
  function bucket(value, period, scale) {
    if (value === null || value === undefined || !isFinite(value)) return null;
    const edges = BANDS[period] || BANDS['1D'];
    const k = Number(scale) > 0 ? Number(scale) : 1;
    const a = Math.abs(value);
    let step = 0;
    if (a >= edges[2] * k) step = 3;
    else if (a >= edges[1] * k) step = 2;
    else if (a >= edges[0] * k) step = 1;
    if (step === 0) return 0;
    return value < 0 ? -step : step;
  }

  function fmtPct(v) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    const s = v > 0 ? '+' : '';
    return s + v.toFixed(Math.abs(v) >= 100 ? 0 : (Math.abs(v) >= 10 ? 1 : 2)) + '%';
  }

  function fmtPrice(v) {
    if (!isFinite(v)) return '';
    if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (v >= 10) return v.toFixed(2);
    return v.toFixed(v < 1 ? 4 : 3);
  }

  function periodIndex(p) {
    const i = (DATA.periods || []).indexOf(p);
    return i < 0 ? 0 : i;
  }

  // ---- staleness -----------------------------------------------------------

  function ageHours() {
    const t = Date.parse(DATA && DATA.generatedAt);
    if (!isFinite(t)) return Infinity;
    return (Date.now() - t) / 3600000;
  }

  // See the note in market-brief.js: a fixed hour count cannot know the market
  // is shut, so the generator may declare its own expiry instead.
  function isStale() {
    const until = Date.parse(DATA && DATA.goodUntil);
    if (isFinite(until)) return Date.now() > until;
    const limit = Number(DATA && DATA.staleAfterHours) || 30;
    return ageHours() > limit;
  }

  function whenLabel() {
    const t = Date.parse(DATA && DATA.generatedAt);
    if (!isFinite(t)) return 'date unknown';
    const d = new Date(t);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
      ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // A stale map is different from a stale brief. The brief hides its calendar
  // because a day-old list of releases is a lie about what is coming. Returns
  // to a stated close do not go wrong the same way — they just stop being
  // today's. So the map keeps everything and dates it loudly.
  function staleBanner() {
    const hrs = Math.floor(ageHours());
    // "built 43 hours old" is not English. Age reads as "ago"; the noun form
    // belongs to the thing, not the act of building it.
    const when = hrs >= 48 ? Math.floor(hrs / 24) + ' days ago' : hrs + ' hours ago';
    return '<div class="mm-stale"><b>These numbers have not been refreshed.</b> ' +
      'The map was built ' + esc(when) + ', so treat every figure as history rather than as ' +
      'the current board.</div>';
  }

  // ---- leaders and laggards ------------------------------------------------

  // Everything on the page competes in one list, which is the point: the
  // interesting mornings are the ones where a currency or a bond outranks
  // every equity index on the board.
  //
  // With one exception. The factor rows are EXCESS return against the S&P,
  // not return. "Momentum +0.66%" and "Brent +1.19%" are different
  // quantities, and ranking them against each other produces a number that
  // means nothing — the exact mistake this page exists to argue against. So
  // excess-return groups are held out of the ranking and read in their own
  // grid, where the comparison is like for like.
  function ranked(period) {
    const i = periodIndex(period);
    const all = [];
    (DATA.groups || []).forEach((g) => {
      if (g.excess) return;
      (g.rows || []).forEach((r) => {
        const v = r.v[i];
        if (v === null || v === undefined || !isFinite(v)) return;
        all.push({ label: r.label, ticker: r.ticker, group: g.title, scale: g.scale, v: v });
      });
    });
    all.sort((a, b) => b.v - a.v);
    return all;
  }

  function barRow(item, period, max) {
    const b = bucket(item.v, period, item.scale);
    const w = max > 0 ? Math.min(100, (Math.abs(item.v) / max) * 100) : 0;
    return '<li class="mm-bar-row">' +
      '<span class="mm-bar-label" title="' + esc(item.group) + '">' + esc(item.label) + '</span>' +
      '<span class="mm-bar-track">' +
        '<span class="mm-bar-fill mm-b' + (b < 0 ? 'd' : 'u') + Math.abs(b) + '" ' +
          'data-grow-to="' + w.toFixed(1) + '%" style="width:' + w.toFixed(1) + '%"></span>' +
      '</span>' +
      '<span class="mm-bar-val" data-count-to="' + item.v + '">' + esc(fmtPct(item.v)) + '</span>' +
    '</li>';
  }

  function renderStrip(mount, opts) {
    const period = (opts && opts.period) || DATA.defaultPeriod || '1D';
    const n = (opts && opts.count) || 5;
    const all = ranked(period);
    if (!all.length) { mount.hidden = true; return; }

    const up = all.slice(0, n);
    const down = all.slice(-n).reverse();
    const max = Math.max.apply(null, all.map((x) => Math.abs(x.v)).concat([0.01]));

    mount.hidden = false;
    mount.innerHTML =
      '<section class="mm-strip stk-rise">' +
        '<div class="mm-strip-head">' +
          '<div>' +
            '<span class="mm-kicker">Leaders and laggards</span>' +
            '<h3>The whole board over ' + esc(period === '1D' ? 'one day' : period) + '</h3>' +
          '</div>' +
          '<span class="mm-when' + (isStale() ? ' is-stale' : '') + '">' + esc(whenLabel()) + '</span>' +
        '</div>' +
        (isStale() ? staleBanner() : '') +
        '<div class="mm-strip-cols">' +
          '<div class="mm-strip-col">' +
            '<h4>Up the most</h4>' +
            '<ul class="mm-bars">' + up.map((x) => barRow(x, period, max)).join('') + '</ul>' +
          '</div>' +
          '<div class="mm-strip-col">' +
            '<h4>Down the most</h4>' +
            '<ul class="mm-bars">' + down.map((x) => barRow(x, period, max)).join('') + '</ul>' +
          '</div>' +
        '</div>' +
        '<p class="mm-strip-foot">Across every asset class on the map. Factor rows are '
  + 'excess return against the S&amp;P 500, so they are ranked separately rather than '
  + 'against outright returns.</p>' +
        '<a class="mm-more" href="market-map.html">See the full market map &rarr;</a>' +
      '</section>';

    M().reveal(mount, {});
    M().growBars(mount, '.mm-bar-fill[data-grow-to]');
    M().countAll(mount, fmtPct);
  }

  // ---- the Treasury curve --------------------------------------------------

  // A line chart, not a heatmap, because the reader's question here is about
  // shape rather than magnitude: is the front end or the long end moving? The
  // month-ago curve is derived from the stored percentage change in each
  // yield rather than typed a second time, so the two lines cannot drift apart
  // through a transcription error.
  function curveSvg(curve) {
    const pts = (curve.points || []).filter((p) => isFinite(p.yield));
    if (pts.length < 3) return '';

    const W = 840, H = 300;
    // The right margin holds the direct labels, so it is sized for the longest
    // of them ("A month ago 5.24%"), not picked to look balanced.
    const M = { t: 26, r: 132, b: 40, l: 46 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;

    const prior = pts.map((p) => p.yield / (1 + (Number(p.chg1M) || 0) / 100));
    const vals = pts.map((p) => p.yield).concat(prior);
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    const pad = Math.max(0.08, (hi - lo) * 0.15);
    lo -= pad; hi += pad;

    const x = (i) => M.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
    const y = (v) => M.t + ih - ((v - lo) / (hi - lo)) * ih;

    const path = (arr) => arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');

    // Gridlines on round quarter-percent steps, recessive.
    const ticks = [];
    for (let v = Math.ceil(lo * 4) / 4; v <= hi; v += 0.25) ticks.push(Number(v.toFixed(2)));

    const grid = ticks.map((v) =>
      '<line class="mm-grid-line" x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + y(v).toFixed(1) +
      '" y2="' + y(v).toFixed(1) + '"/>' +
      '<text class="mm-axis" x="' + (M.l - 8) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' +
        v.toFixed(2) + '</text>').join('');

    const xlabels = pts.map((p, i) =>
      '<text class="mm-axis" x="' + x(i).toFixed(1) + '" y="' + (H - M.b + 20) + '" text-anchor="middle">' +
        esc(p.label) + '</text>').join('');

    const dots = pts.map((p, i) =>
      '<circle class="mm-curve-dot" cx="' + x(i).toFixed(1) + '" cy="' + y(p.yield).toFixed(1) + '" r="5">' +
        '<title>' + esc(p.label) + ': ' + p.yield.toFixed(2) + '% today, ' +
          prior[i].toFixed(2) + '% a month ago (' +
          ((p.yield - prior[i]) * 100 >= 0 ? '+' : '') + ((p.yield - prior[i]) * 100).toFixed(0) + 'bp)' +
        '</title>' +
      '</circle>').join('');

    // Direct labels at the long end, so the two lines are named on the chart
    // itself and not only in the legend. The whole point of this chart is the
    // gap between the lines closing at the long end — which means that is
    // exactly where the two labels want to sit on top of each other. Push
    // them apart when they collide rather than letting them overprint.
    const last = pts.length - 1;
    let yNow = y(pts[last].yield), yPrior = y(prior[last]);
    const MIN_GAP = 15;
    if (Math.abs(yNow - yPrior) < MIN_GAP) {
      const mid = (yNow + yPrior) / 2;
      const up = yNow <= yPrior ? -1 : 1;
      yNow = mid + up * (MIN_GAP / 2);
      yPrior = mid - up * (MIN_GAP / 2);
    }
    const tagX = x(last) + 12;
    const tags =
      '<text class="mm-curve-tag is-now" x="' + tagX.toFixed(1) + '" y="' + (yNow + 4).toFixed(1) + '">' +
        'Today ' + pts[last].yield.toFixed(2) + '%</text>' +
      '<text class="mm-curve-tag is-prior" x="' + tagX.toFixed(1) + '" y="' + (yPrior + 4).toFixed(1) + '">' +
        'A month ago ' + prior[last].toFixed(2) + '%</text>';

    return '<figure class="mm-figure">' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="mm-curve" role="img" ' +
        'aria-label="US Treasury yield curve today against a month ago, from one month to thirty years">' +
        grid + xlabels +
        '<path class="mm-curve-prior" d="' + path(prior) + '"/>' +
        '<path class="mm-curve-now" d="' + path(pts.map((p) => p.yield)) + '"/>' +
        dots +
        tags +
      '</svg>' +
      '<figcaption class="mm-legend">' +
        '<span class="mm-key"><i class="mm-swatch is-now"></i>Today</span>' +
        '<span class="mm-key"><i class="mm-swatch is-prior"></i>A month ago</span>' +
        '<span class="mm-axis-note">Yield, percent &middot; maturity not to scale</span>' +
      '</figcaption>' +
    '</figure>';
  }

  function curveTable(curve) {
    const pts = (curve.points || []).filter((p) => isFinite(p.yield));
    return '<details class="mm-table-toggle"><summary>The curve as a table</summary>' +
      '<div class="mm-scroll"><table class="mm-grid"><thead><tr>' +
        '<th scope="col">Maturity</th><th scope="col">Today</th>' +
        '<th scope="col">A month ago</th><th scope="col">Change</th>' +
      '</tr></thead><tbody>' +
      pts.map((p) => {
        const prior = p.yield / (1 + (Number(p.chg1M) || 0) / 100);
        const bp = (p.yield - prior) * 100;
        return '<tr><th scope="row">' + esc(p.label) + '</th>' +
          '<td>' + p.yield.toFixed(2) + '%</td>' +
          '<td>' + prior.toFixed(2) + '%</td>' +
          '<td>' + (bp >= 0 ? '+' : '') + bp.toFixed(0) + 'bp</td></tr>';
      }).join('') +
      '</tbody></table></div></details>';
  }

  function renderCurve(curve) {
    if (!curve || !(curve.points || []).length) return '';
    const spreads = (curve.spreads || []).length
      ? '<ul class="mm-spreads">' + curve.spreads.map((s) =>
          '<li><span class="mm-spread-v">' + esc((s.value > 0 ? '+' : '') + s.value + (s.unit || '')) + '</span>' +
            '<b>' + esc(s.label) + '</b>' +
            (s.note ? '<span>' + esc(s.note) + '</span>' : '') + '</li>').join('') + '</ul>'
      : '';
    return '<section class="mm-block stk-rise" id="mm-curve">' +
      '<h2>' + esc(curve.title || 'The Treasury curve') + '</h2>' +
      (curve.note ? '<p class="mm-note">' + esc(curve.note) + '</p>' : '') +
      curveSvg(curve) + spreads + curveTable(curve) +
    '</section>';
  }

  // ---- the heatmap grids ---------------------------------------------------

  function renderGroup(g) {
    const periods = DATA.periods || [];
    const pi = periodIndex(PERIOD);
    const unit = g.excess ? ' excess return' : ' return';

    // Sorting by the selected column is the whole reason the period chips
    // exist: the table already shows every window, so the chips answer
    // "rank the board by this one" rather than "show me only this one".
    const rows = (g.rows || []).slice().sort((a, b) => {
      const av = a.v[pi], bv = b.v[pi];
      if (!isFinite(av)) return 1;
      if (!isFinite(bv)) return -1;
      return bv - av;
    });

    const head = '<tr><th scope="col" class="mm-th-name">Instrument</th>' +
      '<th scope="col" class="mm-th-price">Price</th>' +
      periods.map((p) =>
        '<th scope="col" class="mm-th-p' + (p === PERIOD ? ' is-on' : '') + '">' + esc(p) + '</th>').join('') +
      '</tr>';

    const body = rows.map((r) => {
      const cells = periods.map((p, i) => {
        const v = r.v[i];
        const b = bucket(v, p, g.scale);
        const cls = b === null ? 'mm-na' : (b === 0 ? 'mm-b0' : 'mm-b' + (b < 0 ? 'd' : 'u') + Math.abs(b));
        return '<td class="mm-cell ' + cls + (p === PERIOD ? ' is-on' : '') + '" ' +
          'style="--mm-c:' + i + '" ' +
          'title="' + esc(r.label + ' (' + r.ticker + ') · ' + p + unit + ': ' + fmtPct(v)) + '">' +
          esc(fmtPct(v)) + '</td>';
      }).join('');
      return '<tr class="mm-tr" data-flip-key="' + esc(g.id + '|' + r.ticker) + '">' +
        '<th scope="row" class="mm-row-name">' + esc(r.label) +
        '<span class="mm-ticker">' + esc(r.ticker) + '</span></th>' +
        '<td class="mm-price">' + esc(fmtPrice(r.price)) + '</td>' + cells + '</tr>';
    }).join('');

    return '<section class="mm-block stk-rise" id="mm-g-' + esc(g.id) + '">' +
      '<h2>' + esc(g.title) + '</h2>' +
      (g.note ? '<p class="mm-note">' + esc(g.note) + '</p>' : '') +
      '<div class="mm-scroll"><table class="mm-grid mm-heat">' +
        '<caption class="sr-only">' + esc(g.title) + ', percentage ' +
          (g.excess ? 'excess return against the S&P 500' : 'return') +
          ' over seven windows, sorted by ' + esc(PERIOD) + '.</caption>' +
        '<thead>' + head + '</thead><tbody>' + body + '</tbody>' +
      '</table></div>' +
    '</section>';
  }

  function renderScaleKey() {
    const steps = ['mm-bd3', 'mm-bd2', 'mm-bd1', 'mm-b0', 'mm-bu1', 'mm-bu2', 'mm-bu3'];
    const titles = ['down hard', 'down', 'down a little', 'flat', 'up a little', 'up', 'up hard'];
    return '<div class="mm-key-row">' +
      '<span class="mm-key-label">Scale</span>' +
      '<span class="mm-ramp-wrap">' +
        '<span class="mm-ramp" role="img" aria-label="Colour scale, from down hard through flat to up hard">' +
          steps.map((c, i) =>
            '<i class="mm-ramp-step ' + c + '" title="' + titles[i] + '"></i>').join('') +
        '</span>' +
        '<span class="mm-key-ends"><span>Down hard</span><span>Flat</span><span>Up hard</span></span>' +
      '</span>' +
      '<span class="mm-key-note">Bands scale with the window and with the asset class, so a ' +
        'one percent day and a one percent year are not painted the same.</span>' +
    '</div>';
  }

  function renderControls() {
    return '<div class="mm-controls">' +
      '<div class="mm-periods" role="group" aria-label="Rank the board by">' +
        '<span class="mm-ctrl-label">Rank by</span>' +
        (DATA.periods || []).map((p) =>
          '<button type="button" class="mm-chip' + (p === PERIOD ? ' is-on' : '') + '" ' +
            'data-period="' + esc(p) + '" aria-pressed="' + (p === PERIOD) + '">' + esc(p) + '</button>').join('') +
      '</div>' +
      renderScaleKey() +
    '</div>';
  }

  // ---- the full page -------------------------------------------------------

  function renderPage(mount) {
    const read = DATA.read || {};
    mount.innerHTML =
      '<header class="mm-head stk-rise">' +
        '<span class="mm-kicker">Cross-asset map</span>' +
        '<h1>' + esc(read.headline || 'The board') + '</h1>' +
        (read.standfirst ? '<p class="mm-standfirst">' + esc(read.standfirst) + '</p>' : '') +
        '<p class="mm-meta' + (isStale() ? ' is-stale' : '') + '">Built ' + esc(whenLabel()) +
          (DATA.asOf ? ' &middot; ' + esc(DATA.asOf) : '') + '</p>' +
      '</header>' +

      (isStale() ? staleBanner() : '') +

      '<div id="mm-strip-inline"></div>' +

      ((read.points || []).length
        ? '<section class="mm-block mm-read stk-rise">' +
            '<h2>What the spread between them means</h2>' +
            '<ul class="mm-points">' + read.points.map((p) =>
              '<li class="stk-rise"><b>' + esc(p.title) + '</b><p>' + esc(p.text) + '</p></li>').join('') + '</ul>' +
            (read.howToUse ? '<p class="mm-howto">' + esc(read.howToUse) + '</p>' : '') +
          '</section>'
        : '') +

      renderCurve(DATA.curve) +

      '<div id="mm-grids"></div>' +

      '<footer class="mm-foot">' +
        ((DATA.sources || []).length
          ? '<p><b>Data:</b> ' + DATA.sources.map((s) =>
              esc(s.name) + (s.note ? ' (' + esc(s.note) + ')' : '')).join(', ') + '</p>'
          : '') +
        (DATA.attribution ? '<p>' + esc(DATA.attribution) + '</p>' : '') +
        (DATA.disclaimer ? '<p class="mm-disclaimer">' + esc(DATA.disclaimer) + '</p>' : '') +
      '</footer>';

    paintPeriodDependent(mount, true);
    M().reveal(mount, { stagger: 28 });

    // The curve is the one chart on the page whose meaning IS its shape, so
    // drawing it left to right is not decoration — it walks the reader along
    // the maturities in the order the story is told.
    const now = mount.querySelector('.mm-curve-now');
    const prior = mount.querySelector('.mm-curve-prior');
    if (prior) M().drawPath(prior, 900, 120);
    if (now) M().drawPath(now, 1000, 320);

    mount.addEventListener('click', (e) => {
      const btn = e.target.closest('.mm-chip[data-period]');
      if (!btn) return;
      const p = btn.getAttribute('data-period');
      if (!p || p === PERIOD) return;
      PERIOD = p;
      paintPeriodDependent(mount, false);
    });
  }

  // Everything that depends on the selected window is repainted together, so
  // the chips, the sort order, the highlighted column and the strip can never
  // disagree about which period is showing.
  function paintPeriodDependent(mount, first) {
    const grids = mount.querySelector('#mm-grids');
    if (grids) {
      // A FLIP, not a repaint. When the reader switches window the rows
      // visibly travel to their new ranks, so they can see WHICH row overtook
      // which — a re-sorted table that simply appears tells them only that
      // something changed.
      M().flip(grids, 'tr.mm-tr', () => {
        grids.innerHTML = renderControls() + (DATA.groups || []).map(renderGroup).join('');
      });
      if (first) M().reveal(grids, { stagger: 24 });
      else Array.prototype.forEach.call(grids.querySelectorAll('.stk-rise'),
        (n) => n.classList.add('is-in'));
    }
    const strip = mount.querySelector('#mm-strip-inline');
    if (strip) renderStrip(strip, { period: PERIOD, count: 6 });
  }

  // ---- boot ----------------------------------------------------------------

  function load() {
    return fetch(MAP_URL + '?t=' + Math.floor(Date.now() / 60000))
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function fail(mount, isPage) {
    if (!mount) return;
    if (isPage) {
      mount.innerHTML = '<div class="mm-stale"><b>The market map could not be loaded.</b> ' +
        'Refresh in a moment, or check back before the next session.</div>';
    } else {
      mount.hidden = true;
      mount.innerHTML = '';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('mm-page');
    const strips = [document.getElementById('mm-strip'), document.getElementById('dash-map')]
      .filter(Boolean);
    if (!page && !strips.length) return;

    load().then((data) => {
      DATA = data;
      PERIOD = data.defaultPeriod || '1D';
      if (page) renderPage(page);
      strips.forEach((m) => renderStrip(m, { period: PERIOD, count: 5 }));
    }).catch((err) => {
      console.error('Stryker: market map could not be loaded', err);
      fail(page, true);
      strips.forEach((m) => fail(m, false));
    });
  });

  window.__MM = {
    bucket: bucket,
    fmtPct: fmtPct,
    fmtPrice: fmtPrice,
    isStale: isStale,
    ranked: ranked,
    renderStrip: renderStrip,
    renderPage: renderPage,
    setData: function (d) { DATA = d; PERIOD = (d && d.defaultPeriod) || '1D'; },
    getPeriod: function () { return PERIOD; }
  };
})();
