// Stryker Trading Academy — Terminal
// Depends on: assets/auth.js, assets/progress.js (db), assets/world-map-path.js
//
// A market terminal inside the dashboard. Charts, quotes, screener, heatmap,
// calendar and news come from TradingView's embeddable widgets; the world map
// is built here.
//
// WHY TRADINGVIEW RATHER THAN A DATA API
// Every free market-data tier is licensed for personal, non-commercial use, and
// this sits behind a paid membership. Alpha Vantage's free tier is also now 25
// requests per day — a single student opening this page would exhaust it.
// TradingView's widgets are free, real-time, and explicitly embeddable on
// commercial sites, with no key to leak and no quota to exhaust.
//
// The trade-off is honest: we never hold the raw numbers, so we cannot compute
// our own indicators over them. We get their charts, not their data.
//
// WHAT IS BUILT HERE
// The map's session layer is pure arithmetic — no network, no key, no failure
// mode. It works offline and cannot rate-limit. The event layer needs GDELT via
// a Cloud Function proxy, and the panel degrades to sessions-only when that is
// absent rather than showing an error.

var TERMINAL_SYMBOLS = [
  { s: 'OANDA:XAUUSD',    label: 'Gold',      group: 'metals' },
  { s: 'OANDA:EURUSD',    label: 'EUR/USD',   group: 'fx' },
  { s: 'OANDA:GBPUSD',    label: 'GBP/USD',   group: 'fx' },
  { s: 'OANDA:USDJPY',    label: 'USD/JPY',   group: 'fx' },
  { s: 'TVC:DXY',         label: 'Dollar',    group: 'fx' },
  { s: 'OANDA:NAS100USD', label: 'Nasdaq',    group: 'indices' },
  { s: 'OANDA:SPX500USD', label: 'S&P 500',   group: 'indices' },
  { s: 'OANDA:US30USD',   label: 'Dow',       group: 'indices' },
  { s: 'BITSTAMP:BTCUSD', label: 'Bitcoin',   group: 'crypto' },
  { s: 'BITSTAMP:ETHUSD', label: 'Ethereum',  group: 'crypto' }
];

// Trading sessions in UTC. Stored as hours, because the map's x axis IS
// longitude and longitude IS time — the session band's position is computed
// straight from these numbers with no lookup table.
var SESSIONS = [
  { name: 'Sydney', open: 22, close: 7,  lon: 151.2, lat: -33.9, colour: '#8b7dd8' },
  { name: 'Tokyo',  open: 0,  close: 9,  lon: 139.7, lat: 35.7,  colour: '#e5484d' },
  { name: 'London', open: 8,  close: 17, lon: -0.13, lat: 51.5,  colour: '#00adb5' },
  { name: 'New York', open: 13, close: 22, lon: -74.0, lat: 40.7, colour: '#03c988' }
];

// Scheduled high-impact releases, by country. Static because the calendar
// WIDGET already carries live timings — this layer exists to show WHERE the
// week's risk sits, which a list cannot convey.
var ECON_CENTRES = [
  { code: 'US', name: 'United States', lon: -98.6, lat: 39.8, weight: 3 },
  { code: 'EU', name: 'Euro area',     lon: 8.7,   lat: 50.1, weight: 3 },
  { code: 'GB', name: 'United Kingdom',lon: -1.5,  lat: 52.5, weight: 2 },
  { code: 'JP', name: 'Japan',         lon: 138.3, lat: 36.2, weight: 2 },
  { code: 'CH', name: 'Switzerland',   lon: 8.2,   lat: 46.8, weight: 1 },
  { code: 'CA', name: 'Canada',        lon: -106.3,lat: 56.1, weight: 1 },
  { code: 'AU', name: 'Australia',     lon: 133.8, lat: -25.3,weight: 1 },
  { code: 'NZ', name: 'New Zealand',   lon: 174.9, lat: -40.9,weight: 1 },
  { code: 'CN', name: 'China',         lon: 104.2, lat: 35.9, weight: 2 }
];

var MAP_W = 1000, MAP_H = 460;
var LAT_MAX = 80, LAT_MIN = -56;

function lonToX(lon) { return ((lon + 180) / 360) * MAP_W; }
function latToY(lat) {
  var c = Math.max(LAT_MIN, Math.min(LAT_MAX, lat));
  return ((LAT_MAX - c) / (LAT_MAX - LAT_MIN)) * MAP_H;
}

function utcHourNow() {
  var d = new Date();
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

// Sessions wrap midnight (Sydney opens 22:00 and closes 07:00), so a plain
// open <= h < close comparison is wrong for exactly the sessions that matter
// most to this audience.
function sessionOpen(sess, h) {
  if (sess.open < sess.close) return h >= sess.open && h < sess.close;
  return h >= sess.open || h < sess.close;
}

function fmtHour(h) {
  var hh = Math.floor(h) % 24;
  var mm = Math.round((h - Math.floor(h)) * 60);
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
}

// ---- Map rendering ---------------------------------------------------------
function renderMap() {
  var host = document.getElementById('term-map');
  if (!host || typeof WORLD_MAP_PATH === 'undefined') return;

  var h = utcHourNow();

  // Night shading. The terminator is a straight vertical band at this
  // simplification — accurate enough for "where is it dark", and far cheaper
  // than a solar declination curve nobody reads off a 400px panel.
  //
  // The +180 is the whole point and was missing at first: (12 - h) * 15 gives
  // the SUBSOLAR longitude, where it is local noon. Shading that band put
  // darkness over New York at midday. Night is the antipode.
  var nightCentreLon = (12 - h) * 15 + 180;
  while (nightCentreLon > 180) nightCentreLon -= 360;
  while (nightCentreLon < -180) nightCentreLon += 360;

  var svg = '' +
    '<svg viewBox="' + WORLD_MAP_VIEWBOX + '" class="term-map-svg" ' +
        'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">' +
      '<defs>' +
        '<radialGradient id="tmGlow">' +
          '<stop offset="0%" stop-color="#fff" stop-opacity="0.9"/>' +
          '<stop offset="100%" stop-color="#fff" stop-opacity="0"/>' +
        '</radialGradient>' +
      '</defs>' +
      '<rect width="' + MAP_W + '" height="' + MAP_H + '" fill="#08080a"/>' +
      // Graticule: sparse, purely to give the eye a sense of scale.
      graticule() +
      '<path d="' + WORLD_MAP_PATH + '" fill="#152329" stroke="#223a42" stroke-width="0.7"/>' +
      nightBand(nightCentreLon) +
      econLayer() +
      '<g id="term-map-sessions">' + sessionLayer(h) + '</g>' +
      '<g id="term-map-events"></g>' +
    '</svg>';

  host.innerHTML = svg;
  applyView();          // restore zoom/pan across the minute refresh
  bindMapInteraction();
  drawEvents();         // pins live in their own group and survive a redraw
  renderSessionList(h);
}

function graticule() {
  var g = '';
  for (var lon = -150; lon <= 150; lon += 30) {
    g += '<line x1="' + lonToX(lon).toFixed(1) + '" y1="0" x2="' + lonToX(lon).toFixed(1) +
         '" y2="' + MAP_H + '" stroke="#12181c" stroke-width="1"/>';
  }
  for (var lat = -40; lat <= 70; lat += 20) {
    g += '<line x1="0" y1="' + latToY(lat).toFixed(1) + '" x2="' + MAP_W +
         '" y2="' + latToY(lat).toFixed(1) + '" stroke="#12181c" stroke-width="1"/>';
  }
  return g;
}

function nightBand(centreLon) {
  // Half the globe is dark; drawn as up to two rects because the band wraps
  // the edge of the canvas as often as not.
  var halfWidth = MAP_W / 4;
  var cx = lonToX(centreLon);
  var rects = '';
  function rect(x, w) {
    if (w <= 0) return '';
    return '<rect x="' + x.toFixed(1) + '" y="0" width="' + w.toFixed(1) +
           '" height="' + MAP_H + '" fill="#000" opacity="0.42"/>';
  }
  var left = cx - halfWidth, right = cx + halfWidth;
  if (left < 0) { rects += rect(0, right); rects += rect(MAP_W + left, -left); }
  else if (right > MAP_W) { rects += rect(left, MAP_W - left); rects += rect(0, right - MAP_W); }
  else rects += rect(left, halfWidth * 2);
  return rects;
}

function sessionLayer(h) {
  var g = '';
  SESSIONS.forEach(function (s) {
    var open = sessionOpen(s, h);
    var x = lonToX(s.lon), y = latToY(s.lat);
    if (open) {
      g += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="26" ' +
           'fill="' + s.colour + '" opacity="0.13"/>';
      g += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="14" ' +
           'fill="' + s.colour + '" opacity="0.22"/>';
    }
    g += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4.5" fill="' +
         (open ? s.colour : '#3a4650') + '"/>';
    g += '<text x="' + (x + 10).toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" ' +
         'font-size="12" font-family="monospace" fill="' +
         (open ? s.colour : '#4a5560') + '">' + s.name + '</text>';
  });
  return g;
}

function econLayer() {
  var g = '';
  ECON_CENTRES.forEach(function (c) {
    var x = lonToX(c.lon), y = latToY(c.lat);
    var r = 2.5 + c.weight * 1.1;
    g += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) +
         '" fill="none" stroke="#f5c542" stroke-width="1.2" opacity="0.55">' +
         '<title>' + c.name + '</title></circle>';
  });
  return g;
}

function renderSessionList(h) {
  var host = document.getElementById('term-sessions');
  if (!host) return;
  host.innerHTML = SESSIONS.map(function (s) {
    var open = sessionOpen(s, h);
    // Hours until the next state change, which is the number a trader actually
    // wants — "London closes in 2h" beats a pair of clock times.
    var target = open ? s.close : s.open;
    var delta = target - h;
    if (delta < 0) delta += 24;
    return '<div class="term-session' + (open ? ' is-open' : '') + '">' +
      '<span class="term-session-dot" style="background:' + (open ? s.colour : '#3a4650') + '"></span>' +
      '<span class="term-session-name">' + s.name + '</span>' +
      '<span class="term-session-state">' + (open ? 'open' : 'closed') + '</span>' +
      '<span class="term-session-next">' + (open ? 'closes' : 'opens') + ' in ' +
        Math.floor(delta) + 'h ' + Math.round((delta % 1) * 60) + 'm</span>' +
    '</div>';
  }).join('');

  var clock = document.getElementById('term-utc');
  if (clock) clock.textContent = fmtHour(h) + ' UTC';
}

// ---- Live events from GDELT ------------------------------------------------
//
// Requires the getWorldEvents Cloud Function. Absent it, the map shows sessions
// and scheduled centres only — a partial map beats an error panel, and the
// layers needing no network are the ones used most.

var EVENTS = [];
var EVENT_CATS = [];
var ACTIVE_CATS = null;      // null means "all"; a Set once the user filters
var EVENTS_FN = 'https://us-central1-strykertrades-e0cd8.cloudfunctions.net/getWorldEvents';

function loadWorldEvents() {
  fetch(EVENTS_FN)
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(r.status)); })
    .then(function (data) {
      EVENTS = (data && data.events) || [];
      EVENT_CATS = (data && data.categories) || [];
      if (!EVENTS.length) {
        markEventsUnavailable(data && data.error
          ? 'Feed unavailable right now.'
          : 'No events in the last few hours.');
        return;
      }
      var badge = document.getElementById('term-events-badge');
      if (badge) {
        badge.textContent = data.stale ? 'stale' : (data.cached ? 'cached' : 'live');
        badge.className = 'term-badge' + (data.stale ? ' is-off' : '');
      }
      renderCatFilter();
      drawEvents();
      renderEventTable();
    })
    .catch(function () {
      markEventsUnavailable('Live event feed not connected.');
    });
}

function visibleEvents() {
  if (!ACTIVE_CATS || !ACTIVE_CATS.size) return EVENTS;
  return EVENTS.filter(function (e) { return ACTIVE_CATS.has(e.cat); });
}

function catColour(key) {
  for (var i = 0; i < EVENT_CATS.length; i++) {
    if (EVENT_CATS[i].key === key) return EVENT_CATS[i].colour;
  }
  return '#7c8894';
}

function catLabel(key) {
  for (var i = 0; i < EVENT_CATS.length; i++) {
    if (EVENT_CATS[i].key === key) return EVENT_CATS[i].label;
  }
  return 'Other';
}

function renderCatFilter() {
  var host = document.getElementById('term-cats');
  if (!host) return;
  var counts = {};
  EVENTS.forEach(function (e) { counts[e.cat] = (counts[e.cat] || 0) + 1; });

  var all = EVENT_CATS.concat([{ key: 'other', label: 'Other', colour: '#7c8894' }]);
  host.innerHTML = all.map(function (c) {
    var n = counts[c.key] || 0;
    // Categories with nothing in them are shown greyed rather than hidden.
    // A filter list that changes length every refresh is disorienting, and
    // "Conflict: 0" is itself information.
    var on = !ACTIVE_CATS || ACTIVE_CATS.has(c.key);
    return '<button type="button" class="term-cat' + (on ? ' is-on' : '') +
      (n ? '' : ' is-empty') + '" data-cat="' + c.key + '">' +
      '<i style="background:' + c.colour + '"></i>' +
      c.label + '<b>' + n + '</b></button>';
  }).join('');
}

// ---- Zoom / pan -------------------------------------------------------------
//
// Implemented by moving the SVG viewBox rather than applying a CSS transform.
// A transform scales stroke widths and text with the map, so at 8x zoom the
// country outlines become thick smears and the labels are unreadable. Moving
// the viewBox changes only what is framed; everything drawn keeps its intended
// size, which is what a map should do.

var VIEW = { x: 0, y: 0, w: MAP_W, h: MAP_H };
var MIN_ZOOM = 1, MAX_ZOOM = 14;

function zoomLevel() { return MAP_W / VIEW.w; }

function clampView() {
  VIEW.w = Math.min(MAP_W / MIN_ZOOM, Math.max(MAP_W / MAX_ZOOM, VIEW.w));
  VIEW.h = VIEW.w * (MAP_H / MAP_W);
  VIEW.x = Math.max(0, Math.min(MAP_W - VIEW.w, VIEW.x));
  VIEW.y = Math.max(0, Math.min(MAP_H - VIEW.h, VIEW.y));
}

function applyView() {
  var svg = document.querySelector('.term-map-svg');
  if (!svg) return;
  clampView();
  svg.setAttribute('viewBox',
    VIEW.x.toFixed(2) + ' ' + VIEW.y.toFixed(2) + ' ' +
    VIEW.w.toFixed(2) + ' ' + VIEW.h.toFixed(2));
  // Markers are re-scaled inversely so a dot stays the same size on screen at
  // every zoom. Without this, zooming in turns each pin into a blob covering
  // half a continent.
  scaleMarkers();
  var lbl = document.getElementById('term-zoom-level');
  if (lbl) lbl.textContent = zoomLevel().toFixed(1) + '×';
}

function scaleMarkers() {
  var k = 1 / zoomLevel();
  document.querySelectorAll('.term-pin').forEach(function (g) {
    var cx = parseFloat(g.dataset.cx), cy = parseFloat(g.dataset.cy);
    g.setAttribute('transform',
      'translate(' + cx + ' ' + cy + ') scale(' + k.toFixed(4) + ') translate(' +
      (-cx) + ' ' + (-cy) + ')');
  });
  var sess = document.getElementById('term-map-sessions');
  if (sess) sess.setAttribute('style', 'font-size:' + (12 * k).toFixed(2) + 'px');
}

function zoomBy(factor, focusX, focusY) {
  var fx = (focusX === undefined) ? VIEW.x + VIEW.w / 2 : focusX;
  var fy = (focusY === undefined) ? VIEW.y + VIEW.h / 2 : focusY;
  var newW = VIEW.w / factor;
  // Keep the focus point stationary on screen — zooming toward the cursor
  // rather than the centre is the difference between a map that feels
  // controllable and one that feels like it is fighting you.
  VIEW.x = fx - (fx - VIEW.x) * (newW / VIEW.w);
  VIEW.y = fy - (fy - VIEW.y) * (newW / VIEW.w);
  VIEW.w = newW;
  applyView();
}

function resetView() {
  VIEW = { x: 0, y: 0, w: MAP_W, h: MAP_H };
  applyView();
}

function svgPointFromEvent(evt) {
  var svg = document.querySelector('.term-map-svg');
  if (!svg) return null;
  var r = svg.getBoundingClientRect();
  var px = (evt.clientX - r.left) / r.width;
  var py = (evt.clientY - r.top) / r.height;
  return { x: VIEW.x + px * VIEW.w, y: VIEW.y + py * VIEW.h };
}

function bindMapInteraction() {
  var svg = document.querySelector('.term-map-svg');
  if (!svg || svg.dataset.bound === '1') return;
  svg.dataset.bound = '1';

  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = svgPointFromEvent(e);
    if (p) zoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25, p.x, p.y);
  }, { passive: false });

  var dragging = false, lastX = 0, lastY = 0, moved = 0;
  svg.addEventListener('pointerdown', function (e) {
    dragging = true; moved = 0;
    lastX = e.clientX; lastY = e.clientY;
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = 'grabbing';
  });
  svg.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var r = svg.getBoundingClientRect();
    var dx = (e.clientX - lastX) / r.width * VIEW.w;
    var dy = (e.clientY - lastY) / r.height * VIEW.h;
    moved += Math.abs(dx) + Math.abs(dy);
    VIEW.x -= dx; VIEW.y -= dy;
    lastX = e.clientX; lastY = e.clientY;
    applyView();
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    svg.style.cursor = 'grab';
    try { svg.releasePointerCapture(e.pointerId); } catch (err) {}
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.style.cursor = 'grab';

  // Pinch. Two pointers tracked manually rather than relying on gesture events,
  // which Safari implements and nothing else does.
  var pointers = {};
  var pinchStart = null;
  svg.addEventListener('pointerdown', function (e) { pointers[e.pointerId] = e; });
  svg.addEventListener('pointermove', function (e) {
    if (!(e.pointerId in pointers)) return;
    pointers[e.pointerId] = e;
    var ids = Object.keys(pointers);
    if (ids.length !== 2) return;
    dragging = false;      // a two-finger gesture is not a drag
    var a = pointers[ids[0]], b = pointers[ids[1]];
    var dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinchStart === null) { pinchStart = dist; return; }
    if (Math.abs(dist - pinchStart) < 6) return;
    var mid = { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
    var p = svgPointFromEvent(mid);
    if (p) zoomBy(dist / pinchStart, p.x, p.y);
    pinchStart = dist;
  });
  function dropPointer(e) { delete pointers[e.pointerId]; pinchStart = null; }
  svg.addEventListener('pointerup', dropPointer);
  svg.addEventListener('pointercancel', dropPointer);
}

// ---- Event pins -------------------------------------------------------------
function drawEvents() {
  var g = document.getElementById('term-map-events');
  if (!g) return;

  var list = visibleEvents();

  // Thin by zoom. At world view, 400 overlapping pins is a smear that hides
  // exactly the clustering the map exists to show; zoomed in there is room for
  // all of them. The list is already sorted densest-first, so thinning keeps
  // the most-reported stories.
  var z = zoomLevel();
  var cap = z < 1.5 ? 120 : (z < 4 ? 250 : list.length);
  list = list.slice(0, cap);

  g.innerHTML = list.map(function (e, i) {
    var x = lonToX(e.lon), y = latToY(e.lat);
    var colour = catColour(e.cat);
    // Radius carries report volume, lightly. sqrt rather than linear, or a
    // story reported 40 times draws a circle forty times the area of one
    // reported once and swamps the map.
    var r = 2.2 + Math.min(4.5, Math.sqrt(e.count) * 0.9);
    return '<g class="term-pin" data-i="' + i + '" data-cx="' + x.toFixed(1) +
             '" data-cy="' + y.toFixed(1) + '">' +
      '<circle class="term-pin-hit" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
        '" r="' + (r + 6).toFixed(1) + '" fill="transparent"/>' +
      '<circle class="term-pin-halo" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
        '" r="' + r.toFixed(1) + '" fill="none" stroke="' + colour + '" stroke-width="1"/>' +
      '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) +
        '" fill="' + colour + '" fill-opacity="0.75"/>' +
    '</g>';
  }).join('');

  // Stored so hover can look the event up by index without re-filtering.
  g.__events = list;
  scaleMarkers();
  bindPinHover(g);

  var shown = document.getElementById('term-shown-count');
  if (shown) {
    shown.textContent = list.length + (list.length < visibleEvents().length
      ? ' of ' + visibleEvents().length + ' — zoom in for more' : ' events');
  }
}

function bindPinHover(g) {
  if (g.dataset.hoverBound === '1') return;
  g.dataset.hoverBound = '1';

  g.addEventListener('pointerover', function (e) {
    var pin = e.target.closest('.term-pin');
    if (!pin) return;
    var ev = (g.__events || [])[parseInt(pin.dataset.i, 10)];
    if (ev) showTooltip(ev, e.clientX, e.clientY);
    pin.classList.add('is-hot');
  });
  g.addEventListener('pointermove', function (e) {
    if (document.getElementById('term-tip').style.display === 'flex') {
      positionTooltip(e.clientX, e.clientY);
    }
  });
  g.addEventListener('pointerout', function (e) {
    var pin = e.target.closest('.term-pin');
    if (pin) pin.classList.remove('is-hot');
    hideTooltip();
  });
  // Tap opens the source. On touch there is no hover, so the tooltip shows on
  // pointerover (which fires once on tap) and the link needs a deliberate
  // second action rather than firing on the same tap.
  g.addEventListener('click', function (e) {
    var pin = e.target.closest('.term-pin');
    if (!pin) return;
    var ev = (g.__events || [])[parseInt(pin.dataset.i, 10)];
    if (ev && ev.url) window.open(ev.url, '_blank', 'noopener');
  });
}

function showTooltip(ev, cx, cy) {
  var tip = document.getElementById('term-tip');
  if (!tip) return;
  tip.innerHTML =
    '<span class="term-tip-cat" style="color:' + catColour(ev.cat) + '">' +
      esc(catLabel(ev.cat)) + '</span>' +
    '<span class="term-tip-title">' + esc(ev.title) + '</span>' +
    '<span class="term-tip-meta">' + esc(ev.place || '—') +
      (ev.count > 1 ? ' · ' + ev.count + ' reports' : '') + '</span>';
  // 'flex', not 'block'. The stylesheet lays the tooltip out as a flex column
  // with a gap; an inline display:block overrode that and ran the category
  // label straight into the headline with no space between them.
  tip.style.display = 'flex';
  positionTooltip(cx, cy);
}

function positionTooltip(cx, cy) {
  var tip = document.getElementById('term-tip');
  if (!tip) return;
  var w = tip.offsetWidth, h = tip.offsetHeight;
  // Flip rather than clip at the viewport edge, or half the tooltip is unread
  // for every event on the right-hand side of the map — which is most of Asia.
  var x = cx + 16, y = cy + 16;
  if (x + w > window.innerWidth - 12) x = cx - w - 16;
  if (y + h > window.innerHeight - 12) y = cy - h - 16;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}

function hideTooltip() {
  var tip = document.getElementById('term-tip');
  if (tip) tip.style.display = 'none';
}

// ---- Event table ------------------------------------------------------------
function renderEventTable() {
  var host = document.getElementById('term-table-body');
  if (!host) return;
  var list = visibleEvents();
  if (!list.length) {
    host.innerHTML = '<p class="term-empty">Nothing matches those filters.</p>';
    return;
  }
  host.innerHTML = list.slice(0, 200).map(function (e, i) {
    return '<div class="term-row" data-lon="' + e.lon + '" data-lat="' + e.lat + '">' +
      '<span class="term-row-cat" style="background:' + catColour(e.cat) + '"></span>' +
      '<div class="term-row-main">' +
        '<span class="term-row-title">' + esc(e.title) + '</span>' +
        '<span class="term-row-meta">' + esc(e.place || '—') +
          ' · ' + esc(catLabel(e.cat)) +
          (e.count > 1 ? ' · ' + e.count + ' reports' : '') + '</span>' +
      '</div>' +
      (e.url ? '<a class="term-row-link" href="' + escAttr(e.url) +
        '" target="_blank" rel="noopener noreferrer" title="Open source">↗</a>' : '') +
    '</div>';
  }).join('');

  var count = document.getElementById('term-table-count');
  if (count) count.textContent = list.length + ' events';
}

// Clicking a table row flies the map to that event — the table and the map are
// two views of one dataset, and a table that cannot point at the map is just a
// list sitting next to a picture.
function flyTo(lon, lat) {
  var targetW = MAP_W / 6;
  VIEW.w = targetW;
  VIEW.h = targetW * (MAP_H / MAP_W);
  VIEW.x = lonToX(lon) - VIEW.w / 2;
  VIEW.y = latToY(lat) - VIEW.h / 2;
  applyView();
  drawEvents();
  var wrap = document.querySelector('.term-map-wrap');
  if (wrap) wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function markEventsUnavailable(msg) {
  var host = document.getElementById('term-table-body');
  if (host) host.innerHTML = '<p class="term-empty">' + esc(msg) + '</p>';
  var badge = document.getElementById('term-events-badge');
  if (badge) { badge.textContent = 'offline'; badge.className = 'term-badge is-off'; }
  var shown = document.getElementById('term-shown-count');
  if (shown) shown.textContent = '—';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

// ---- TradingView widgets ---------------------------------------------------
// Each widget is an iframe TradingView builds from a script tag it finds in its
// own container. Re-running the loader on an already-populated container stacks
// duplicates, so containers are emptied first — the usual bug when widgets are
// mounted on tab switches rather than once at load.
function mountWidget(containerId, script, config) {
  var host = document.getElementById(containerId);
  if (!host || host.dataset.mounted === '1') return;
  host.innerHTML = '';
  var s = document.createElement('script');
  s.type = 'text/javascript';
  s.async = true;
  s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-' + script + '.js';
  s.innerHTML = JSON.stringify(config);
  host.appendChild(s);
  host.dataset.mounted = '1';
}

var TV_THEME = {
  colorTheme: 'dark',
  isTransparent: true,
  locale: 'en'
};

function mountForTab(tab) {
  if (tab === 'markets') {
    mountWidget('tv-quotes', 'market-quotes', Object.assign({}, TV_THEME, {
      width: '100%', height: 520,
      symbolsGroups: [
        { name: 'FX & Metals', symbols: TERMINAL_SYMBOLS.filter(function (t) {
            return t.group === 'fx' || t.group === 'metals';
          }).map(function (t) { return { name: t.s, displayName: t.label }; }) },
        { name: 'Indices', symbols: TERMINAL_SYMBOLS.filter(function (t) {
            return t.group === 'indices';
          }).map(function (t) { return { name: t.s, displayName: t.label }; }) },
        { name: 'Crypto', symbols: TERMINAL_SYMBOLS.filter(function (t) {
            return t.group === 'crypto';
          }).map(function (t) { return { name: t.s, displayName: t.label }; }) }
      ]
    }));
  } else if (tab === 'chart') {
    mountWidget('tv-chart', 'advanced-chart', Object.assign({}, TV_THEME, {
      width: '100%', height: 560,
      symbol: 'OANDA:XAUUSD', interval: '15', timezone: 'Etc/UTC',
      style: '1', hide_side_toolbar: false, allow_symbol_change: true,
      studies: [], support_host: 'https://www.tradingview.com'
    }));
  } else if (tab === 'news') {
    mountWidget('tv-news', 'timeline', Object.assign({}, TV_THEME, {
      feedMode: 'all_symbols', width: '100%', height: 560, displayMode: 'regular'
    }));
  } else if (tab === 'calendar') {
    mountWidget('tv-calendar', 'events', Object.assign({}, TV_THEME, {
      width: '100%', height: 560, importanceFilter: '0,1',
      countryFilter: 'us,eu,gb,jp,ch,ca,au,nz,cn'
    }));
  } else if (tab === 'screener') {
    mountWidget('tv-screener', 'screener', Object.assign({}, TV_THEME, {
      width: '100%', height: 560, defaultColumn: 'overview',
      defaultScreen: 'general', market: 'forex', showToolbar: true
    }));
  } else if (tab === 'heatmap') {
    mountWidget('tv-heatmap', 'forex-heat-map', Object.assign({}, TV_THEME, {
      width: '100%', height: 480,
      currencies: ['EUR', 'USD', 'JPY', 'GBP', 'CHF', 'AUD', 'CAD', 'NZD']
    }));
  }
}

// ---- Tabs ------------------------------------------------------------------
function showTab(tab) {
  document.querySelectorAll('.term-panel').forEach(function (p) {
    p.style.display = (p.dataset.tab === tab) ? '' : 'none';
  });
  document.querySelectorAll('.term-tab').forEach(function (b) {
    b.classList.toggle('is-active', b.dataset.tab === tab);
  });
  // Widgets mount on FIRST view rather than at page load. Mounting all seven
  // upfront means seven iframes and seven socket connections for a student who
  // only ever opens the chart.
  mountForTab(tab);
  try { localStorage.setItem('stryker_terminal_tab', tab); } catch (e) {}
}

document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('term-tabs')) return;

  document.getElementById('term-tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.term-tab');
    if (btn) showTab(btn.dataset.tab);
  });

  var saved = 'map';
  try { saved = localStorage.getItem('stryker_terminal_tab') || 'map'; } catch (e) {}
  showTab(saved);

  renderMap();
  loadWorldEvents();

  var cats = document.getElementById('term-cats');
  if (cats) cats.addEventListener('click', function (e) {
    var btn = e.target.closest('.term-cat');
    if (!btn) return;
    var key = btn.dataset.cat;
    // First click on any category switches from "all" to "only this", which is
    // what people expect from a legend. Subsequent clicks toggle.
    if (!ACTIVE_CATS) ACTIVE_CATS = new Set([key]);
    else if (ACTIVE_CATS.has(key)) { ACTIVE_CATS.delete(key); if (!ACTIVE_CATS.size) ACTIVE_CATS = null; }
    else ACTIVE_CATS.add(key);
    renderCatFilter(); drawEvents(); renderEventTable();
  });

  var table = document.getElementById('term-table-body');
  if (table) table.addEventListener('click', function (e) {
    if (e.target.closest('.term-row-link')) return;   // let the link do its job
    var row = e.target.closest('.term-row');
    if (row) flyTo(parseFloat(row.dataset.lon), parseFloat(row.dataset.lat));
  });

  var zin = document.getElementById('term-zoom-in');
  var zout = document.getElementById('term-zoom-out');
  var zres = document.getElementById('term-zoom-reset');
  if (zin) zin.addEventListener('click', function () { zoomBy(1.6); drawEvents(); });
  if (zout) zout.addEventListener('click', function () { zoomBy(1 / 1.6); drawEvents(); });
  if (zres) zres.addEventListener('click', function () { resetView(); drawEvents(); });

  // The session layer is the live part; a minute is the finest granularity the
  // countdown displays, so refreshing faster would burn frames for nothing.
  setInterval(renderMap, 60000);
  setInterval(loadWorldEvents, 15 * 60000);   // GDELT itself updates every 15 min
});

// ---- FinancialJuice newswire ------------------------------------------------
//
// FinancialJuice generates its embed code from a form on their widgets page,
// and the resulting iframe URL is not documented anywhere I could verify. So it
// is CONFIGURED rather than hardcoded: paste the embed from
// financialjuice.com/widgets/get-widget.aspx into Settings admin
// (settings/terminal -> financialJuiceEmbed) and it appears here.
//
// Guessing the URL would have produced a panel that looked right in
// development and rendered an error page in production, which is worse than a
// panel that plainly says it needs configuring.
//
// Only an <iframe> is accepted. The value comes from Firestore, which admins
// can write, and injecting arbitrary admin-supplied HTML into every student's
// page is a stored-XSS hole even when the admin is trustworthy — one
// compromised admin account would otherwise mean script execution for everyone.
function mountFinancialJuice() {
  var host = document.getElementById('term-fj');
  if (!host || typeof db === 'undefined' || !db) return;

  db.collection('settings').doc('terminal').get().then(function (doc) {
    var embed = doc.exists ? (doc.data().financialJuiceEmbed || '') : '';
    if (!embed) { fjPlaceholder(host); return; }

    var m = embed.match(/<iframe[^>]*\ssrc=["']([^"']+)["'][^>]*>/i);
    if (!m) { fjPlaceholder(host, 'That embed code has no iframe in it.'); return; }

    var src = m[1];
    if (!/^https:\/\/(www\.)?financialjuice\.com\//i.test(src)) {
      // Refuse anything not from FinancialJuice. Without this the field is an
      // open redirect into an iframe on a page students are logged into.
      fjPlaceholder(host, 'That embed is not a financialjuice.com URL.');
      return;
    }

    var frame = document.createElement('iframe');
    frame.src = src;
    frame.title = 'FinancialJuice newswire';
    frame.loading = 'lazy';
    frame.setAttribute('scrolling', 'no');
    // The widget is third-party, so it runs sandboxed with only what a news
    // feed needs. Notably no allow-same-origin, so it cannot reach into the
    // parent page.
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    frame.style.cssText = 'width:100%; height:420px; border:0; display:block;';
    host.innerHTML = '';
    host.appendChild(frame);
  }).catch(function () { fjPlaceholder(host); });
}

function fjPlaceholder(host, why) {
  host.innerHTML =
    '<p class="term-empty">' + esc(why || 'Newswire not configured.') + '</p>' +
    '<p class="term-empty term-fj-help">Add the embed code from ' +
      '<a href="https://www.financialjuice.com/widgets/get-widget.aspx" ' +
      'target="_blank" rel="noopener noreferrer">financialjuice.com</a> ' +
      'in Settings admin.</p>';
}

document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('term-fj')) {
    // After auth, since the settings read goes through Firestore rules.
    if (typeof auth !== 'undefined' && auth) {
      var done = false;
      auth.onAuthStateChanged(function (u) {
        if (done || !u) return;
        done = true;
        mountFinancialJuice();
      });
    } else {
      mountFinancialJuice();
    }
  }
});
