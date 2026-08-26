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
      sessionLayer(h) +
      econLayer() +
      '<g id="term-map-events"></g>' +
    '</svg>';

  host.innerHTML = svg;
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
// Requires the getWorldEvents Cloud Function. Absent it, the map shows sessions
// and scheduled centres only — a partial map beats an error panel, and the two
// layers that need no network are the ones most used day to day.
function loadWorldEvents() {
  var host = document.getElementById('term-events-list');
  var fn = 'https://us-central1-strykertrades-e0cd8.cloudfunctions.net/getWorldEvents';

  fetch(fn)
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(r.status)); })
    .then(function (data) {
      var events = (data && data.events) || [];
      if (!events.length) { markEventsUnavailable('No events in the last few hours.'); return; }
      plotEvents(events);
      if (host) {
        host.innerHTML = events.slice(0, 12).map(function (e) {
          return '<a class="term-event" href="' + escAttr(e.url) + '" target="_blank" rel="noopener noreferrer">' +
            '<span class="term-event-loc">' + esc(e.country || '—') + '</span>' +
            '<span class="term-event-title">' + esc(e.title) + '</span>' +
          '</a>';
        }).join('');
      }
    })
    .catch(function () {
      markEventsUnavailable('Live event feed not connected.');
    });
}

function plotEvents(events) {
  var g = document.getElementById('term-map-events');
  if (!g) return;
  g.innerHTML = events.slice(0, 60).map(function (e) {
    if (typeof e.lat !== 'number' || typeof e.lon !== 'number') return '';
    var x = lonToX(e.lon), y = latToY(e.lat);
    return '<g class="term-event-pin">' +
      '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="#ff6b4a"/>' +
      '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="none" ' +
        'stroke="#ff6b4a" stroke-width="1.2" opacity="0.7">' +
        '<animate attributeName="r" from="3" to="16" dur="2.6s" repeatCount="indefinite"/>' +
        '<animate attributeName="opacity" from="0.7" to="0" dur="2.6s" repeatCount="indefinite"/>' +
      '</circle>' +
      '<title>' + esc(e.title || '') + '</title>' +
    '</g>';
  }).join('');
}

function markEventsUnavailable(msg) {
  var host = document.getElementById('term-events-list');
  if (host) {
    host.innerHTML = '<p class="term-empty">' + esc(msg) + '</p>';
  }
  var badge = document.getElementById('term-events-badge');
  if (badge) { badge.textContent = 'offline'; badge.className = 'term-badge is-off'; }
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

  // The session layer is the live part; a minute is the finest granularity the
  // countdown displays, so refreshing faster would burn frames for nothing.
  setInterval(renderMap, 60000);
  setInterval(loadWorldEvents, 15 * 60000);   // GDELT itself updates every 15 min
});
