// Stryker Trading Academy — Global Monitor (war & geopolitics terminal)
// Depends on: assets/world-map-path.js (WORLD_MAP_PATH, WORLD_MAP_VIEWBOX),
//             assets/country-shapes.js (COUNTRY_SHAPES)
//
// A conflict-focused sibling of the market Terminal. The map, newswire and
// severity feed are GDELT; predictions are Polymarket; market impact is
// TradingView's embeddable widgets.
//
// WHY GDELT IS CALLED FROM THE BROWSER HERE
// The market Terminal reads a Firestore cache because GDELT rate-limits
// Google Cloud egress IPs into 59-second 429s (see refreshWorldData.js).
// That punishment applies to shared datacenter IPs, not to individual
// browsers: each student's own connection carries its own quota. So the
// primary path is a direct fetch — fresher data, war-specific queries the
// shared cache doesn't run — and the deployed cache functions remain as the
// fallback when a student's fetch fails, so the page degrades to slightly
// staler, broader data rather than to an error.

// ---- Queries ----------------------------------------------------------------
var GM_EVENTS_QUERY = '(war OR conflict OR military OR missile OR airstrike OR ' +
  'invasion OR troops OR ceasefire OR shelling OR "drone strike" OR sanctions OR ' +
  'coup OR insurgency OR terrorism OR protest OR mobilization)';

var GM_WIRE_QUERY = '(war OR ceasefire OR missile OR airstrike OR invasion OR ' +
  'troops OR sanctions OR nuclear OR NATO OR "drone strike" OR offensive OR ' +
  'militants OR coup) sourcelang:eng';

var GM_FIN_QUERY = '("federal reserve" OR "central bank" OR inflation OR ' +
  '"interest rate" OR forex OR currency OR dollar OR euro OR gold OR oil OR ' +
  '"stock market" OR stocks OR bonds OR recession OR tariffs OR sanctions) ' +
  'sourcelang:eng';

var GDELT_GEO = 'https://api.gdeltproject.org/api/v2/geo/geo';
var GDELT_DOC = 'https://api.gdeltproject.org/api/v2/doc/doc';
var POLYMARKET = 'https://gamma-api.polymarket.com/events';

// Deployed cache functions — the fallback path (see header).
var FN_BASE = 'https://us-central1-strykertrades-e0cd8.cloudfunctions.net/';

// ---- Categories -------------------------------------------------------------
// Order matters: first match wins, so the most specific patterns come first.
var GM_CATS = [
  { key: 'combat', label: 'Armed conflict', colour: '#e5484d',
    re: /\b(war|invasion|offensive|airstrikes?|air strikes?|attacks?|attacked|shelling|artillery|missiles?|rockets?|drone strikes?|bombing|bombardment|fighting|clashes|frontline|combat|strikes? on|killed in strike)\b/i },
  { key: 'terror', label: 'Terror & attacks', colour: '#b04adf',
    re: /\b(terror|suicide bomb|car bomb|ied|hostage|kidnapp|militants?|insurgen|extremis|massacre)\b/i },
  { key: 'military', label: 'Military moves', colour: '#f5a524',
    re: /\b(troops|military|deploy|mobiliz|drills?|exercises?|navy|warships?|fighter jets?|air defen[cs]e|weapons|arms deal|nuclear|missile test|conscription)\b/i },
  { key: 'unrest', label: 'Civil unrest', colour: '#f5c542',
    re: /\b(protests?|riots?|demonstrat|unrest|coup|martial law|crackdown|uprising|strikes? by workers)\b/i },
  { key: 'diplomacy', label: 'Diplomacy & sanctions', colour: '#00adb5',
    re: /\b(ceasefire|truce|peace|talks|negotiat|sanctions?|embargo|treaty|summit|diplomat|resolution|accord)\b/i },
  { key: 'humanitarian', label: 'Humanitarian', colour: '#8b7dd8',
    re: /\b(refugees?|humanitarian|famine|aid convoy|evacuat|casualt|civilians? killed|displaced|hospital hit)\b/i },
  { key: 'other', label: 'Other', colour: '#7c8894', re: null }
];

// Tension weighting: how much one report of each kind moves a country's score.
var GM_CAT_WEIGHT = {
  combat: 3, terror: 2.5, military: 2, unrest: 1.5,
  humanitarian: 1.2, diplomacy: 1, other: 1
};

function gmCategorise(text) {
  for (var i = 0; i < GM_CATS.length; i++) {
    if (GM_CATS[i].re && GM_CATS[i].re.test(text)) return GM_CATS[i].key;
  }
  return 'other';
}
function gmCatColour(key) {
  for (var i = 0; i < GM_CATS.length; i++) if (GM_CATS[i].key === key) return GM_CATS[i].colour;
  return '#7c8894';
}
function gmCatLabel(key) {
  for (var i = 0; i < GM_CATS.length; i++) if (GM_CATS[i].key === key) return GM_CATS[i].label;
  return 'Other';
}

// ---- Small helpers ----------------------------------------------------------
function gmEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function gmEscAttr(s) { return gmEsc(s).replace(/"/g, '&quot;'); }

function gmTimeAgo(ms) {
  if (!ms) return '';
  var d = Date.now() - ms;
  if (d < 60000) return 'now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h';
  return Math.floor(d / 86400000) + 'd';
}

function gmFingerprint(title) {
  return String(title || '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
    .split(' ').slice(0, 9).join(' ');
}

function gmParseSeenDate(s) {
  var m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  var t = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z');
  return isNaN(t) ? null : t;
}

// fetch with a timeout. GDELT's failure mode is hanging, not refusing —
// twenty seconds is long enough for a slow success and short enough that the
// fallback still feels like part of the page load.
function gmFetchJson(url, timeoutMs) {
  var ctrl = ('AbortController' in window) ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 20000) : null;
  return fetch(url, ctrl ? { signal: ctrl.signal } : {})
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      // GDELT sometimes labels JSON as text/html; parse the text ourselves so
      // a mislabelled success is still a success.
      return r.text();
    })
    .then(function (t) { return JSON.parse(t); })
    .finally(function () { if (timer) clearTimeout(timer); });
}

// ---- Projection (matches world-map-path.js: equirect, 80N..56S, 1000x460) ---
var GM_W = 1000, GM_H = 460, GM_LAT_MAX = 80, GM_LAT_MIN = -56;
function gmLonX(lon) { return ((lon + 180) / 360) * GM_W; }
function gmLatY(lat) {
  var c = Math.max(GM_LAT_MIN, Math.min(GM_LAT_MAX, lat));
  return ((GM_LAT_MAX - c) / (GM_LAT_MAX - GM_LAT_MIN)) * GM_H;
}

// ---- Country lookup ---------------------------------------------------------
function gmPointInRing(lon, lat, ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function gmCountryAt(lon, lat) {
  if (typeof COUNTRY_SHAPES === 'undefined') return null;
  var c, r;
  for (c = 0; c < COUNTRY_SHAPES.length; c++) {
    var shape = COUNTRY_SHAPES[c];
    for (r = 0; r < shape.p.length; r++) {
      if (gmPointInRing(lon, lat, shape.p[r])) return shape;
    }
  }
  // Coastal events land just offshore of the country they belong to; snap to
  // the nearest outline vertex within ~1.5 degrees rather than dropping them.
  var best = null, bestD = 2.25;
  for (c = 0; c < COUNTRY_SHAPES.length; c++) {
    var s = COUNTRY_SHAPES[c];
    for (r = 0; r < s.p.length; r++) {
      var ring = s.p[r];
      for (var v = 0; v < ring.length; v++) {
        var dx = ring[v][0] - lon, dy = ring[v][1] - lat, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = s; }
      }
    }
  }
  return best;
}

function gmCountryCentroid(shape) {
  // centre of the largest ring's bbox — good enough to fly the map to
  var best = null, bestArea = -1;
  for (var i = 0; i < shape.p.length; i++) {
    var minx = 999, maxx = -999, miny = 999, maxy = -999;
    for (var v = 0; v < shape.p[i].length; v++) {
      var pt = shape.p[i][v];
      if (pt[0] < minx) minx = pt[0]; if (pt[0] > maxx) maxx = pt[0];
      if (pt[1] < miny) miny = pt[1]; if (pt[1] > maxy) maxy = pt[1];
    }
    var a = (maxx - minx) * (maxy - miny);
    if (a > bestArea) { bestArea = a; best = [(minx + maxx) / 2, (miny + maxy) / 2]; }
  }
  return best;
}

// ---- Map rendering ----------------------------------------------------------
var GM_EVENTS = [];
var GM_ACTIVE_CATS = null;   // null = all; a Set once the user filters
var GM_VIEW = { x: 0, y: 0, w: GM_W, h: GM_H };
var GM_MIN_ZOOM = 1, GM_MAX_ZOOM = 14;

function gmZoomLevel() { return GM_W / GM_VIEW.w; }

function gmRenderMap() {
  var host = document.getElementById('gm-map');
  if (!host || typeof WORLD_MAP_PATH === 'undefined') return;

  // Night shading — same simplification as the Terminal map: night is the
  // half of the globe antipodal to the subsolar longitude.
  var h = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
  var nightCentreLon = (12 - h) * 15 + 180;
  while (nightCentreLon > 180) nightCentreLon -= 360;
  while (nightCentreLon < -180) nightCentreLon += 360;

  var svg = '' +
    '<svg viewBox="' + WORLD_MAP_VIEWBOX + '" class="term-map-svg gm-map-svg" ' +
        'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">' +
      '<rect width="' + GM_W + '" height="' + GM_H + '" fill="#08080a"/>' +
      gmGraticule() +
      '<path d="' + WORLD_MAP_PATH + '" fill="#1c2126" stroke="#2e363d" stroke-width="0.7"/>' +
      gmNightBand(nightCentreLon) +
      '<g id="gm-map-events"></g>' +
    '</svg>';

  host.innerHTML = svg;
  gmApplyView();
  gmBindMapInteraction();
  gmDrawEvents();
}

function gmGraticule() {
  var g = '';
  for (var lon = -150; lon <= 150; lon += 30) {
    g += '<line x1="' + gmLonX(lon).toFixed(1) + '" y1="0" x2="' + gmLonX(lon).toFixed(1) +
         '" y2="' + GM_H + '" stroke="#12181c" stroke-width="1"/>';
  }
  for (var lat = -40; lat <= 70; lat += 20) {
    g += '<line x1="0" y1="' + gmLatY(lat).toFixed(1) + '" x2="' + GM_W +
         '" y2="' + gmLatY(lat).toFixed(1) + '" stroke="#12181c" stroke-width="1"/>';
  }
  return g;
}

function gmNightBand(centreLon) {
  var halfWidth = GM_W / 4;
  var cx = gmLonX(centreLon);
  var rects = '';
  function rect(x, w) {
    if (w <= 0) return '';
    return '<rect x="' + x.toFixed(1) + '" y="0" width="' + w.toFixed(1) +
           '" height="' + GM_H + '" fill="#000" opacity="0.38"/>';
  }
  var left = cx - halfWidth, right = cx + halfWidth;
  if (left < 0) { rects += rect(0, right); rects += rect(GM_W + left, -left); }
  else if (right > GM_W) { rects += rect(left, GM_W - left); rects += rect(0, right - GM_W); }
  else rects += rect(left, halfWidth * 2);
  return rects;
}

function gmClampView() {
  GM_VIEW.w = Math.min(GM_W / GM_MIN_ZOOM, Math.max(GM_W / GM_MAX_ZOOM, GM_VIEW.w));
  GM_VIEW.h = GM_VIEW.w * (GM_H / GM_W);
  GM_VIEW.x = Math.max(0, Math.min(GM_W - GM_VIEW.w, GM_VIEW.x));
  GM_VIEW.y = Math.max(0, Math.min(GM_H - GM_VIEW.h, GM_VIEW.y));
}

function gmApplyView() {
  var svg = document.querySelector('.gm-map-svg');
  if (!svg) return;
  gmClampView();
  svg.setAttribute('viewBox',
    GM_VIEW.x.toFixed(2) + ' ' + GM_VIEW.y.toFixed(2) + ' ' +
    GM_VIEW.w.toFixed(2) + ' ' + GM_VIEW.h.toFixed(2));
  gmScaleMarkers();
  var lbl = document.getElementById('gm-zoom-level');
  if (lbl) lbl.textContent = gmZoomLevel().toFixed(1) + '×';
}

function gmScaleMarkers() {
  var k = 1 / gmZoomLevel();
  document.querySelectorAll('.gm-pin').forEach(function (g) {
    var cx = parseFloat(g.dataset.cx), cy = parseFloat(g.dataset.cy);
    g.setAttribute('transform',
      'translate(' + cx + ' ' + cy + ') scale(' + k.toFixed(4) + ') translate(' +
      (-cx) + ' ' + (-cy) + ')');
  });
}

function gmZoomBy(factor, fx, fy) {
  if (fx === undefined) fx = GM_VIEW.x + GM_VIEW.w / 2;
  if (fy === undefined) fy = GM_VIEW.y + GM_VIEW.h / 2;
  var newW = GM_VIEW.w / factor;
  GM_VIEW.x = fx - (fx - GM_VIEW.x) * (newW / GM_VIEW.w);
  GM_VIEW.y = fy - (fy - GM_VIEW.y) * (newW / GM_VIEW.w);
  GM_VIEW.w = newW;
  gmApplyView();
}

function gmResetView() {
  GM_VIEW = { x: 0, y: 0, w: GM_W, h: GM_H };
  gmApplyView();
}

function gmSvgPoint(evt) {
  var svg = document.querySelector('.gm-map-svg');
  if (!svg) return null;
  var r = svg.getBoundingClientRect();
  return {
    x: GM_VIEW.x + (evt.clientX - r.left) / r.width * GM_VIEW.w,
    y: GM_VIEW.y + (evt.clientY - r.top) / r.height * GM_VIEW.h
  };
}

function gmBindMapInteraction() {
  var svg = document.querySelector('.gm-map-svg');
  if (!svg || svg.dataset.bound === '1') return;
  svg.dataset.bound = '1';

  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = gmSvgPoint(e);
    if (p) gmZoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25, p.x, p.y);
  }, { passive: false });

  var dragging = false, lastX = 0, lastY = 0;
  svg.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = 'grabbing';
  });
  svg.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var r = svg.getBoundingClientRect();
    GM_VIEW.x -= (e.clientX - lastX) / r.width * GM_VIEW.w;
    GM_VIEW.y -= (e.clientY - lastY) / r.height * GM_VIEW.h;
    lastX = e.clientX; lastY = e.clientY;
    gmApplyView();
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

  // pinch zoom — two pointers tracked manually (Safari-only gesture events
  // are not portable)
  var pointers = {}, pinchStart = null;
  svg.addEventListener('pointerdown', function (e) { pointers[e.pointerId] = e; });
  svg.addEventListener('pointermove', function (e) {
    if (!(e.pointerId in pointers)) return;
    pointers[e.pointerId] = e;
    var ids = Object.keys(pointers);
    if (ids.length !== 2) return;
    dragging = false;
    var a = pointers[ids[0]], b = pointers[ids[1]];
    var dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinchStart === null) { pinchStart = dist; return; }
    if (Math.abs(dist - pinchStart) < 6) return;
    var mid = { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
    var p = gmSvgPoint(mid);
    if (p) gmZoomBy(dist / pinchStart, p.x, p.y);
    pinchStart = dist;
  });
  function dropPointer(e) { delete pointers[e.pointerId]; pinchStart = null; }
  svg.addEventListener('pointerup', dropPointer);
  svg.addEventListener('pointercancel', dropPointer);
}

function gmVisibleEvents() {
  if (!GM_ACTIVE_CATS || !GM_ACTIVE_CATS.size) return GM_EVENTS;
  return GM_EVENTS.filter(function (e) { return GM_ACTIVE_CATS.has(e.cat); });
}

function gmDrawEvents() {
  var g = document.getElementById('gm-map-events');
  if (!g) return;

  var list = gmVisibleEvents();
  var z = gmZoomLevel();
  var cap = z < 1.5 ? 120 : (z < 4 ? 250 : list.length);
  list = list.slice(0, cap);

  g.innerHTML = list.map(function (e, i) {
    var x = gmLonX(e.lon), y = gmLatY(e.lat);
    var colour = gmCatColour(e.cat);
    var r = 2.2 + Math.min(4.5, Math.sqrt(e.count) * 0.9);
    // The heaviest stories pulse. Animated on the halo, not the dot, so the
    // marker itself stays a stable click target.
    var pulse = e.count >= 8
      ? '<circle class="gm-pulse" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
        '" r="' + r.toFixed(1) + '" fill="none" stroke="' + colour + '" stroke-width="1.4">' +
        '<animate attributeName="r" values="' + r.toFixed(1) + ';' + (r + 9).toFixed(1) +
          '" dur="2.2s" repeatCount="indefinite"/>' +
        '<animate attributeName="opacity" values="0.8;0" dur="2.2s" repeatCount="indefinite"/>' +
        '</circle>'
      : '';
    return '<g class="term-pin gm-pin" data-i="' + i + '" data-cx="' + x.toFixed(1) +
             '" data-cy="' + y.toFixed(1) + '">' +
      pulse +
      '<circle class="term-pin-hit" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
        '" r="' + (r + 6).toFixed(1) + '" fill="transparent"/>' +
      '<circle class="term-pin-halo" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) +
        '" r="' + r.toFixed(1) + '" fill="none" stroke="' + colour + '" stroke-width="1"/>' +
      '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) +
        '" fill="' + colour + '" fill-opacity="0.78"/>' +
    '</g>';
  }).join('');

  g.__events = list;
  gmScaleMarkers();
  gmBindPinHover(g);

  var shown = document.getElementById('gm-shown-count');
  if (shown) {
    shown.textContent = list.length + (list.length < gmVisibleEvents().length
      ? ' of ' + gmVisibleEvents().length + ' — zoom in for more' : ' events shown');
  }
}

function gmBindPinHover(g) {
  if (g.dataset.hoverBound === '1') return;
  g.dataset.hoverBound = '1';

  g.addEventListener('pointerover', function (e) {
    var pin = e.target.closest('.gm-pin');
    if (!pin) return;
    var ev = (g.__events || [])[parseInt(pin.dataset.i, 10)];
    if (ev) gmShowTip(ev, e.clientX, e.clientY);
    pin.classList.add('is-hot');
  });
  g.addEventListener('pointermove', function (e) {
    var tip = document.getElementById('gm-tip');
    if (tip && tip.style.display === 'flex') gmPositionTip(e.clientX, e.clientY);
  });
  g.addEventListener('pointerout', function (e) {
    var pin = e.target.closest('.gm-pin');
    if (pin) pin.classList.remove('is-hot');
    gmHideTip();
  });
  g.addEventListener('click', function (e) {
    var pin = e.target.closest('.gm-pin');
    if (!pin) return;
    var ev = (g.__events || [])[parseInt(pin.dataset.i, 10)];
    if (ev && ev.url) window.open(ev.url, '_blank', 'noopener');
  });
}

function gmShowTip(ev, cx, cy) {
  var tip = document.getElementById('gm-tip');
  if (!tip) return;
  tip.innerHTML =
    '<span class="term-tip-cat" style="color:' + gmCatColour(ev.cat) + '">' +
      gmEsc(gmCatLabel(ev.cat)) + '</span>' +
    '<span class="term-tip-title">' + gmEsc(ev.title) + '</span>' +
    '<span class="term-tip-meta">' + gmEsc(ev.place || '—') +
      (ev.country ? ' · ' + gmEsc(ev.country) : '') +
      (ev.count > 1 ? ' · ' + ev.count + ' reports' : '') + '</span>';
  tip.style.display = 'flex';
  gmPositionTip(cx, cy);
}

function gmPositionTip(cx, cy) {
  var tip = document.getElementById('gm-tip');
  if (!tip) return;
  var w = tip.offsetWidth, h = tip.offsetHeight;
  var x = cx + 16, y = cy + 16;
  if (x + w > window.innerWidth - 12) x = cx - w - 16;
  if (y + h > window.innerHeight - 12) y = cy - h - 16;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}

function gmHideTip() {
  var tip = document.getElementById('gm-tip');
  if (tip) tip.style.display = 'none';
}

function gmFlyTo(lon, lat) {
  var targetW = GM_W / 6;
  GM_VIEW.w = targetW;
  GM_VIEW.h = targetW * (GM_H / GM_W);
  GM_VIEW.x = gmLonX(lon) - GM_VIEW.w / 2;
  GM_VIEW.y = gmLatY(lat) - GM_VIEW.h / 2;
  gmApplyView();
  gmDrawEvents();
  var wrap = document.querySelector('.term-map-wrap');
  if (wrap) wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---- Event loading ----------------------------------------------------------
function gmSetBadge(id, text, off) {
  var b = document.getElementById(id);
  if (b) { b.textContent = text; b.className = 'term-badge' + (off ? ' is-off' : ''); }
}

function gmLoadEvents() {
  var url = GDELT_GEO + '?query=' + encodeURIComponent(GM_EVENTS_QUERY) +
    '&mode=pointdata&format=geojson&timespan=6h';

  gmFetchJson(url, 20000)
    .then(function (json) {
      var events = gmParseGeo(json);
      if (!events.length) throw new Error('empty');
      gmApplyEvents(events, 'live');
    })
    .catch(function () {
      // Fallback: the shared Firestore cache (market Terminal's feed),
      // narrowed to its geopolitics/politics categories.
      gmFetchJson(FN_BASE + 'getWorldEvents', 15000)
        .then(function (data) {
          var all = (data && data.events) || [];
          var events = all.filter(function (e) {
            return e.cat === 'conflict' || e.cat === 'politics';
          }).map(function (e) {
            return {
              lon: e.lon, lat: e.lat, place: e.place, title: e.title,
              url: e.url, count: e.count || 1,
              cat: gmCategorise(e.title + ' ' + (e.place || ''))
            };
          });
          if (!events.length) {
            gmEventsUnavailable(data && data.error ? 'Feed error: ' + data.error
              : 'No events reported in the window.');
            return;
          }
          gmApplyEvents(events, 'cached');
        })
        .catch(function () { gmEventsUnavailable('Event feed unreachable.'); });
    });
}

function gmParseGeo(json) {
  var features = (json && json.features) || [];
  return features.map(function (f) {
    var coords = (f.geometry && f.geometry.coordinates) || [];
    var p = f.properties || {};
    var lon = typeof coords[0] === 'number' ? coords[0] : null;
    var lat = typeof coords[1] === 'number' ? coords[1] : null;
    if (lon === null || lat === null) return null;
    var raw = String(p.html || p.name || '');
    var link = raw.match(/href=["']([^"']+)["']/i);
    var title = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title) return null;
    return {
      lon: lon, lat: lat,
      place: String(p.name || '').trim().slice(0, 80),
      title: title.slice(0, 220),
      url: link ? link[1] : null,
      count: Number(p.count) || 1,
      cat: gmCategorise(title + ' ' + (p.name || ''))
    };
  }).filter(Boolean).sort(function (a, b) { return b.count - a.count; });
}

function gmApplyEvents(events, sourceLabel) {
  // country attribution once per load, not per render
  events.forEach(function (e) {
    var c = gmCountryAt(e.lon, e.lat);
    e.country = c ? c.n : null;
  });
  GM_EVENTS = events;
  gmSetBadge('gm-events-badge', sourceLabel, sourceLabel !== 'live');
  gmRenderCatFilter();
  gmDrawEvents();
  gmRenderEventTable();
  gmRenderTension();
}

function gmEventsUnavailable(msg) {
  var host = document.getElementById('gm-table-body');
  if (host) host.innerHTML = '<p class="term-empty">' + gmEsc(msg) + '</p>';
  gmSetBadge('gm-events-badge', 'offline', true);
  var t = document.getElementById('gm-tension');
  if (t) t.innerHTML = '<p class="term-empty">Needs the event feed.</p>';
}

function gmRenderCatFilter() {
  var host = document.getElementById('gm-cats');
  if (!host) return;
  var counts = {};
  GM_EVENTS.forEach(function (e) { counts[e.cat] = (counts[e.cat] || 0) + 1; });

  host.innerHTML = GM_CATS.map(function (c) {
    var n = counts[c.key] || 0;
    var on = !GM_ACTIVE_CATS || GM_ACTIVE_CATS.has(c.key);
    return '<button type="button" class="term-cat' + (on ? ' is-on' : '') +
      (n ? '' : ' is-empty') + '" data-cat="' + c.key + '">' +
      '<i style="background:' + c.colour + '"></i>' +
      c.label + '<b>' + n + '</b></button>';
  }).join('');
}

function gmRenderEventTable() {
  var host = document.getElementById('gm-table-body');
  if (!host) return;
  var list = gmVisibleEvents();
  if (!list.length) {
    host.innerHTML = '<p class="term-empty">Nothing matches those filters.</p>';
    return;
  }
  host.innerHTML = list.slice(0, 200).map(function (e) {
    return '<div class="term-row" data-lon="' + e.lon + '" data-lat="' + e.lat + '">' +
      '<span class="term-row-cat" style="background:' + gmCatColour(e.cat) + '"></span>' +
      '<div class="term-row-main">' +
        '<span class="term-row-title">' + gmEsc(e.title) + '</span>' +
        '<span class="term-row-meta">' + gmEsc(e.place || '—') +
          (e.country && e.country !== e.place ? ' · ' + gmEsc(e.country) : '') +
          ' · ' + gmEsc(gmCatLabel(e.cat)) +
          (e.count > 1 ? ' · ' + e.count + ' reports' : '') + '</span>' +
      '</div>' +
      (e.url ? '<a class="term-row-link" href="' + gmEscAttr(e.url) +
        '" target="_blank" rel="noopener noreferrer" title="Open source">↗</a>' : '') +
    '</div>';
  }).join('');

  var count = document.getElementById('gm-table-count');
  if (count) count.textContent = list.length + ' events';
}

// ---- Tension rankings -------------------------------------------------------
// Score = Σ sqrt(reports) × category weight, per country. sqrt for the same
// reason pin radius uses it: a story syndicated 40 times is not 40 separate
// crises. Trend arrows compare against a snapshot saved 30min-24h ago.

function gmRenderTension() {
  var host = document.getElementById('gm-tension');
  if (!host) return;

  var scores = {}, counts = {};
  GM_EVENTS.forEach(function (e) {
    if (!e.country) return;
    var w = GM_CAT_WEIGHT[e.cat] || 1;
    scores[e.country] = (scores[e.country] || 0) + Math.sqrt(e.count || 1) * w;
    counts[e.country] = (counts[e.country] || 0) + 1;
  });

  var rows = Object.keys(scores).map(function (n) {
    return { country: n, score: scores[n], events: counts[n] };
  }).sort(function (a, b) { return b.score - a.score; }).slice(0, 12);

  if (!rows.length) {
    host.innerHTML = '<p class="term-empty">No attributable events yet.</p>';
    return;
  }

  // trend vs a stored snapshot
  var prev = null;
  try {
    var raw = localStorage.getItem('stryker_gm_tension');
    if (raw) {
      var parsed = JSON.parse(raw);
      var age = Date.now() - (parsed.at || 0);
      if (age > 30 * 60000 && age < 24 * 3600000) prev = parsed.scores;
      if (age > 30 * 60000) {
        localStorage.setItem('stryker_gm_tension',
          JSON.stringify({ at: Date.now(), scores: scores }));
      }
    } else {
      localStorage.setItem('stryker_gm_tension',
        JSON.stringify({ at: Date.now(), scores: scores }));
    }
  } catch (e) {}

  var max = rows[0].score;
  host.innerHTML = rows.map(function (r, i) {
    var pct = Math.round((r.score / max) * 100);
    var trend = '';
    if (prev && prev[r.country]) {
      var delta = r.score / prev[r.country];
      if (delta > 1.15) trend = '<span class="gm-trend is-up">▲</span>';
      else if (delta < 0.85) trend = '<span class="gm-trend is-down">▼</span>';
    } else if (prev && !prev[r.country]) {
      trend = '<span class="gm-trend is-up">▲</span>';
    }
    return '<div class="gm-tension-row" data-country="' + gmEscAttr(r.country) + '">' +
      '<span class="gm-tension-rank">' + (i + 1) + '</span>' +
      '<div class="gm-tension-main">' +
        '<div class="gm-tension-top"><span class="gm-tension-name">' + gmEsc(r.country) +
          '</span>' + trend +
          '<span class="gm-tension-val">' + r.events + ' events</span></div>' +
        '<div class="gm-tension-bar"><i style="width:' + pct + '%"></i></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ---- Newswire + ticker ------------------------------------------------------
var GM_WIRE = [];
var GM_WIRE_SEEN = null;

function gmLoadWire() {
  var url = GDELT_DOC + '?query=' + encodeURIComponent(GM_WIRE_QUERY) +
    '&mode=artlist&format=json&maxrecords=100&sort=datedesc&timespan=3h';

  gmFetchJson(url, 20000)
    .then(function (json) {
      var items = gmParseArticles(json);
      if (!items.length) throw new Error('empty');
      gmApplyWire(items, 'live');
    })
    .catch(function () {
      gmFetchJson(FN_BASE + 'getNewswire', 15000)
        .then(function (data) {
          var items = ((data && data.items) || []).map(function (it) {
            return {
              id: it.id, title: it.title, url: it.url, source: it.source,
              at: it.at, cat: gmCategorise(it.title)
            };
          });
          // geopolitics first, but keep the rest — a thin wire is worse than
          // a broad one
          items.sort(function (a, b) {
            var ga = (a.cat !== 'other') ? 0 : 1, gb = (b.cat !== 'other') ? 0 : 1;
            return ga - gb || (b.at || 0) - (a.at || 0);
          });
          if (!items.length) {
            gmWireUnavailable(data && data.error ? 'Newswire error: ' + data.error
              : 'No headlines in the window.');
            return;
          }
          gmApplyWire(items, 'cached');
        })
        .catch(function () { gmWireUnavailable('Newswire unreachable.'); });
    });
}

function gmParseArticles(json) {
  var articles = (json && json.articles) || [];
  var seen = new Set();
  var items = [];
  for (var i = 0; i < articles.length; i++) {
    var a = articles[i];
    var title = String(a.title || '').trim();
    if (!title) continue;
    var fp = gmFingerprint(title);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    items.push({
      id: fp, title: title.slice(0, 200), url: a.url || null,
      source: String(a.domain || '').replace(/^www\./, '').slice(0, 40),
      at: gmParseSeenDate(a.seendate), cat: gmCategorise(title)
    });
    if (items.length >= 60) break;
  }
  return items;
}

function gmApplyWire(items, sourceLabel) {
  var firstLoad = (GM_WIRE_SEEN === null);
  var nowSeen = {};
  items.forEach(function (it) {
    nowSeen[it.id] = true;
    it.isNew = !firstLoad && !GM_WIRE_SEEN[it.id];
  });
  GM_WIRE_SEEN = nowSeen;
  GM_WIRE = items;
  gmSetBadge('gm-wire-badge', sourceLabel, sourceLabel !== 'live');
  gmRenderWire();
  gmRenderTicker();
}

function gmWireUnavailable(msg) {
  var host = document.getElementById('gm-wire-feed');
  if (host) host.innerHTML = '<p class="term-empty">' + gmEsc(msg) + '</p>';
  gmSetBadge('gm-wire-badge', 'offline', true);
  var track = document.getElementById('gm-ticker-track');
  if (track) track.innerHTML = '<span class="gm-ticker-item">' + gmEsc(msg) + '</span>';
}

function gmRenderWire() {
  var host = document.getElementById('gm-wire-feed');
  if (!host) return;
  host.innerHTML = GM_WIRE.map(function (it) {
    return '<a class="news-item' + (it.isNew ? ' is-new' : '') + '"' +
        (it.url ? ' href="' + gmEscAttr(it.url) + '" target="_blank" rel="noopener noreferrer"' : '') + '>' +
      '<span class="news-bar" style="background:' + gmCatColour(it.cat) + '"></span>' +
      '<span class="news-body">' +
        '<span class="news-title">' + gmEsc(it.title) + '</span>' +
        '<span class="news-meta">' +
          '<time>' + gmEsc(gmTimeAgo(it.at)) + '</time>' +
          (it.source ? '<span class="news-src">' + gmEsc(it.source) + '</span>' : '') +
        '</span>' +
      '</span>' +
    '</a>';
  }).join('');
}

function gmRenderTicker() {
  var track = document.getElementById('gm-ticker-track');
  if (!track) return;
  var items = GM_WIRE.slice(0, 30);
  if (!items.length) return;
  var html = items.map(function (it) {
    var inner = '<i style="background:' + gmCatColour(it.cat) + '"></i>' + gmEsc(it.title);
    return it.url
      ? '<a class="gm-ticker-item" href="' + gmEscAttr(it.url) +
        '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
      : '<span class="gm-ticker-item">' + inner + '</span>';
  }).join('');
  // Content duplicated once so the CSS loop (translateX 0 → -50%) is seamless.
  track.innerHTML = html + html;
  // Constant speed regardless of headline count: duration scales with width.
  requestAnimationFrame(function () {
    var w = track.scrollWidth / 2;
    track.style.animationDuration = Math.max(30, Math.round(w / 55)) + 's';
  });
}

function gmTickWireTimes() {
  document.querySelectorAll('#gm-wire-feed .news-item time').forEach(function (el, i) {
    if (GM_WIRE[i]) el.textContent = gmTimeAgo(GM_WIRE[i].at);
  });
}

// ---- Financial & forex news by severity -------------------------------------
// Severity comes from GDELT's tone filter: one query for sharply negative
// coverage (tone < -7) and one for negative coverage (tone < -2.5). Membership
// in the severe set plus hard keywords decides the band. The two queries run
// 1.5s apart — GDELT rate-limits per IP, and two simultaneous requests from
// one browser is how you meet that limit.

var GM_SEV_ACTIVE = null;   // null = all bands
var GM_SEV_ITEMS = [];

var GM_HARD_RE = /\b(crash|collaps|plunge|panic|emergency|default|crisis|war|invasion|meltdown|turmoil|freefall|contagion|bank run)\b/i;

function gmLoadSeverity() {
  var severeUrl = GDELT_DOC + '?query=' + encodeURIComponent(GM_FIN_QUERY + ' tone<-7') +
    '&mode=artlist&format=json&maxrecords=50&sort=datedesc&timespan=12h';
  var moderateUrl = GDELT_DOC + '?query=' + encodeURIComponent(GM_FIN_QUERY + ' tone<-2.5') +
    '&mode=artlist&format=json&maxrecords=75&sort=datedesc&timespan=12h';

  gmFetchJson(severeUrl, 20000)
    .then(function (severeJson) {
      var severe = gmParseArticles(severeJson);
      return new Promise(function (resolve) { setTimeout(resolve, 1500); })
        .then(function () { return gmFetchJson(moderateUrl, 20000); })
        .then(function (moderateJson) {
          gmApplySeverity(severe, gmParseArticles(moderateJson), 'live');
        })
        .catch(function () { gmApplySeverity(severe, [], 'live'); });
    })
    .catch(function () {
      // Fallback: the cached market newswire, no tone data — everything lands
      // in Watch unless keywords argue otherwise.
      gmFetchJson(FN_BASE + 'getNewswire', 15000)
        .then(function (data) {
          var items = ((data && data.items) || []).filter(function (it) {
            return it.cat === 'markets' || it.cat === 'econ' || it.cat === 'centralbank';
          }).map(function (it) {
            return {
              id: it.id, title: it.title, url: it.url, source: it.source, at: it.at,
              sev: GM_HARD_RE.test(it.title) ? 'high' : 'watch'
            };
          });
          if (!items.length) throw new Error('empty');
          GM_SEV_ITEMS = items;
          gmSetBadge('gm-sev-badge', 'cached', true);
          gmRenderSeverity();
        })
        .catch(function () {
          var host = document.getElementById('gm-sev-list');
          if (host) host.innerHTML = '<p class="term-empty">Severity feed unreachable.</p>';
          gmSetBadge('gm-sev-badge', 'offline', true);
        });
    });
}

function gmApplySeverity(severe, moderate, sourceLabel) {
  var severeIds = new Set(severe.map(function (it) { return it.id; }));
  var all = {};
  severe.forEach(function (it) { all[it.id] = it; });
  moderate.forEach(function (it) { if (!all[it.id]) all[it.id] = it; });

  var items = Object.keys(all).map(function (id) {
    var it = all[id];
    var hard = GM_HARD_RE.test(it.title);
    var sev;
    if (severeIds.has(id)) sev = hard ? 'critical' : 'high';
    else sev = hard ? 'high' : 'watch';
    return {
      id: it.id, title: it.title, url: it.url, source: it.source, at: it.at, sev: sev
    };
  });

  var rank = { critical: 0, high: 1, watch: 2 };
  items.sort(function (a, b) {
    return rank[a.sev] - rank[b.sev] || (b.at || 0) - (a.at || 0);
  });

  GM_SEV_ITEMS = items.slice(0, 60);
  gmSetBadge('gm-sev-badge', sourceLabel, sourceLabel !== 'live');
  gmRenderSeverity();
}

var GM_SEV_META = {
  critical: { label: 'Critical', colour: '#e5484d' },
  high:     { label: 'High',     colour: '#f5a524' },
  watch:    { label: 'Watch',    colour: '#f5c542' }
};

function gmRenderSeverity() {
  var chips = document.getElementById('gm-sev-chips');
  var host = document.getElementById('gm-sev-list');
  if (!host) return;

  var counts = { critical: 0, high: 0, watch: 0 };
  GM_SEV_ITEMS.forEach(function (it) { counts[it.sev]++; });

  if (chips) {
    chips.innerHTML = ['critical', 'high', 'watch'].map(function (k) {
      var on = !GM_SEV_ACTIVE || GM_SEV_ACTIVE === k;
      return '<button type="button" class="term-cat' + (on ? ' is-on' : '') +
        (counts[k] ? '' : ' is-empty') + '" data-sev="' + k + '">' +
        '<i style="background:' + GM_SEV_META[k].colour + '"></i>' +
        GM_SEV_META[k].label + '<b>' + counts[k] + '</b></button>';
    }).join('');
  }

  var list = GM_SEV_ACTIVE
    ? GM_SEV_ITEMS.filter(function (it) { return it.sev === GM_SEV_ACTIVE; })
    : GM_SEV_ITEMS;

  if (!list.length) {
    host.innerHTML = '<p class="term-empty">Nothing at this severity right now.</p>';
    return;
  }

  host.innerHTML = list.map(function (it) {
    var m = GM_SEV_META[it.sev];
    return '<a class="news-item"' +
        (it.url ? ' href="' + gmEscAttr(it.url) + '" target="_blank" rel="noopener noreferrer"' : '') + '>' +
      '<span class="news-bar" style="background:' + m.colour + '"></span>' +
      '<span class="news-body">' +
        '<span class="news-title">' + gmEsc(it.title) + '</span>' +
        '<span class="news-meta">' +
          '<span class="gm-sev-tag" style="color:' + m.colour + '">' + m.label + '</span>' +
          '<time>' + gmEsc(gmTimeAgo(it.at)) + '</time>' +
          (it.source ? '<span class="news-src">' + gmEsc(it.source) + '</span>' : '') +
        '</span>' +
      '</span>' +
    '</a>';
  }).join('');
}

// ---- Prediction markets -----------------------------------------------------
// Polymarket's public gamma API, keyless. Filtered to geopolitics by keyword
// because tag coverage is inconsistent. Falls back to the getIntel function's
// curated predictions list.

var GM_GEO_RE = /\b(war|ceasefire|invasion|invade|missile|nuclear|NATO|Russia|Ukraine|Israel|Gaza|Iran|China|Taiwan|Korea|strike[s]? on|military|troops|sanctions?|Hezbollah|Houthis?|Putin|Zelensky|Netanyahu|Xi Jinping|regime|annex|treaty|border)\b/i;

function gmLoadPredictions() {
  var url = POLYMARKET + '?closed=false&order=volume24hr&ascending=false&limit=100';
  gmFetchJson(url, 20000)
    .then(function (json) {
      var events = Array.isArray(json) ? json : [];
      var rows = [];
      for (var i = 0; i < events.length && rows.length < 10; i++) {
        var ev = events[i];
        var title = String(ev.title || '');
        if (!GM_GEO_RE.test(title)) continue;
        var mk = gmTopMarket(ev.markets);
        if (!mk) continue;
        rows.push({
          question: title.slice(0, 120),
          detail: mk.label,
          probability: mk.prob,
          volume: Number(ev.volume24hr || ev.volume || 0),
          url: ev.slug ? 'https://polymarket.com/event/' + ev.slug : null
        });
      }
      if (!rows.length) throw new Error('no geo markets');
      gmRenderPredictions(rows, 'live');
    })
    .catch(function () {
      gmFetchJson(FN_BASE + 'getIntel', 15000)
        .then(function (res) {
          var rows = (((res || {}).data || {}).predictions || []).map(function (r) {
            return { question: r.question, detail: null,
                     probability: r.probability, volume: null, url: null };
          });
          if (!rows.length) throw new Error('empty');
          gmRenderPredictions(rows, 'cached');
        })
        .catch(function () {
          var host = document.getElementById('gm-predict');
          if (host) host.innerHTML = '<p class="term-empty">Prediction feed unreachable.</p>';
          gmSetBadge('gm-predict-badge', 'offline', true);
        });
    });
}

// Pick the market that best summarises an event: for a Yes/No market, its Yes
// probability; for a multi-outcome event, the leading market's own title.
function gmTopMarket(markets) {
  if (!Array.isArray(markets) || !markets.length) return null;
  var best = null, bestVol = -1;
  for (var i = 0; i < markets.length; i++) {
    var m = markets[i];
    var vol = Number(m.volume24hr || m.volume || 0);
    var prices, outcomes;
    try {
      prices = JSON.parse(m.outcomePrices || '[]');
      outcomes = JSON.parse(m.outcomes || '[]');
    } catch (e) { continue; }
    if (!prices.length) continue;
    var yesIdx = 0;
    for (var o = 0; o < outcomes.length; o++) {
      if (String(outcomes[o]).toLowerCase() === 'yes') { yesIdx = o; break; }
    }
    var prob = Number(prices[yesIdx]);
    if (isNaN(prob)) continue;
    var label = null;
    if (markets.length > 1) {
      label = String(m.groupItemTitle || m.question || '').slice(0, 60) || null;
    }
    if (vol > bestVol) { bestVol = vol; best = { prob: prob, label: label }; }
  }
  return best;
}

function gmFmtVolume(v) {
  if (!v) return '';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}

function gmRenderPredictions(rows, sourceLabel) {
  var host = document.getElementById('gm-predict');
  if (!host) return;
  gmSetBadge('gm-predict-badge', sourceLabel, sourceLabel !== 'live');

  host.innerHTML = rows.map(function (r) {
    var pct = Math.round((r.probability || 0) * 100);
    var hue = r.probability >= 0.5 ? '#e5484d' : '#00adb5';
    var inner =
      '<div class="gm-pred-top">' +
        '<span class="gm-pred-q">' + gmEsc(r.question) + '</span>' +
        '<span class="gm-pred-pct" style="color:' + hue + '">' + pct + '%</span>' +
      '</div>' +
      '<div class="gm-pred-bar"><i style="width:' + pct + '%; background:' + hue + '"></i></div>' +
      '<div class="gm-pred-meta">' +
        (r.detail ? '<span>' + gmEsc(r.detail) + '</span>' : '<span>Yes</span>') +
        (r.volume ? '<span>' + gmFmtVolume(r.volume) + ' · 24h</span>' : '') +
      '</div>';
    return r.url
      ? '<a class="gm-pred-row" href="' + gmEscAttr(r.url) +
        '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
      : '<div class="gm-pred-row">' + inner + '</div>';
  }).join('');
}

// ---- Market impact (TradingView) --------------------------------------------
// Same rationale as the Terminal: free data APIs are non-commercial or
// quota-starved; TradingView's widgets are free, live and embeddable.

function gmMountMarkets() {
  var host = document.getElementById('gm-markets');
  if (!host || host.dataset.mounted === '1') return;
  host.innerHTML = '';
  var s = document.createElement('script');
  s.type = 'text/javascript';
  s.async = true;
  s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js';
  s.innerHTML = JSON.stringify({
    colorTheme: 'dark', isTransparent: true, locale: 'en',
    width: '100%', height: 480,
    symbolsGroups: [
      { name: 'Safe havens', symbols: [
        { name: 'OANDA:XAUUSD', displayName: 'Gold' },
        { name: 'OANDA:XAGUSD', displayName: 'Silver' },
        { name: 'TVC:DXY', displayName: 'Dollar index' },
        { name: 'OANDA:USDCHF', displayName: 'USD/CHF' },
        { name: 'OANDA:USDJPY', displayName: 'USD/JPY' }
      ] },
      { name: 'Energy', symbols: [
        { name: 'TVC:USOIL', displayName: 'WTI crude' },
        { name: 'TVC:UKOIL', displayName: 'Brent crude' },
        { name: 'NYMEX:NG1!', displayName: 'Natural gas' }
      ] },
      { name: 'Defense stocks', symbols: [
        { name: 'NYSE:LMT', displayName: 'Lockheed Martin' },
        { name: 'NYSE:RTX', displayName: 'RTX' },
        { name: 'NYSE:NOC', displayName: 'Northrop Grumman' },
        { name: 'NYSE:GD', displayName: 'General Dynamics' },
        { name: 'NYSE:BA', displayName: 'Boeing' }
      ] },
      { name: 'Risk barometers', symbols: [
        { name: 'OANDA:SPX500USD', displayName: 'S&P 500' },
        { name: 'OANDA:EURUSD', displayName: 'EUR/USD' },
        { name: 'BITSTAMP:BTCUSD', displayName: 'Bitcoin' }
      ] }
    ]
  });
  host.appendChild(s);
  host.dataset.mounted = '1';
}

// ---- Clock ------------------------------------------------------------------
function gmTickClock() {
  var el = document.getElementById('gm-utc');
  if (!el) return;
  var d = new Date();
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  el.textContent = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

// ---- Boot -------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('gm-map')) return;

  gmRenderMap();
  gmTickClock();
  gmMountMarkets();

  // Loads are staggered so a fresh page never fires four GDELT requests in
  // the same second from one IP.
  gmLoadEvents();
  setTimeout(gmLoadWire, 2000);
  setTimeout(gmLoadSeverity, 5000);
  setTimeout(gmLoadPredictions, 1000);

  var cats = document.getElementById('gm-cats');
  if (cats) cats.addEventListener('click', function (e) {
    var btn = e.target.closest('.term-cat');
    if (!btn) return;
    var key = btn.dataset.cat;
    if (!GM_ACTIVE_CATS) GM_ACTIVE_CATS = new Set([key]);
    else if (GM_ACTIVE_CATS.has(key)) {
      GM_ACTIVE_CATS.delete(key);
      if (!GM_ACTIVE_CATS.size) GM_ACTIVE_CATS = null;
    } else GM_ACTIVE_CATS.add(key);
    gmRenderCatFilter(); gmDrawEvents(); gmRenderEventTable();
  });

  var sevChips = document.getElementById('gm-sev-chips');
  if (sevChips) sevChips.addEventListener('click', function (e) {
    var btn = e.target.closest('.term-cat');
    if (!btn) return;
    GM_SEV_ACTIVE = (GM_SEV_ACTIVE === btn.dataset.sev) ? null : btn.dataset.sev;
    gmRenderSeverity();
  });

  var table = document.getElementById('gm-table-body');
  if (table) table.addEventListener('click', function (e) {
    if (e.target.closest('.term-row-link')) return;
    var row = e.target.closest('.term-row');
    if (row) gmFlyTo(parseFloat(row.dataset.lon), parseFloat(row.dataset.lat));
  });

  var tension = document.getElementById('gm-tension');
  if (tension) tension.addEventListener('click', function (e) {
    var row = e.target.closest('.gm-tension-row');
    if (!row || typeof COUNTRY_SHAPES === 'undefined') return;
    for (var i = 0; i < COUNTRY_SHAPES.length; i++) {
      if (COUNTRY_SHAPES[i].n === row.dataset.country) {
        var c = gmCountryCentroid(COUNTRY_SHAPES[i]);
        if (c) gmFlyTo(c[0], c[1]);
        return;
      }
    }
  });

  var zin = document.getElementById('gm-zoom-in');
  var zout = document.getElementById('gm-zoom-out');
  var zres = document.getElementById('gm-zoom-reset');
  if (zin) zin.addEventListener('click', function () { gmZoomBy(1.6); gmDrawEvents(); });
  if (zout) zout.addEventListener('click', function () { gmZoomBy(1 / 1.6); gmDrawEvents(); });
  if (zres) zres.addEventListener('click', function () { gmResetView(); gmDrawEvents(); });

  setInterval(gmTickClock, 15000);
  setInterval(gmRenderMap, 10 * 60000);            // refresh the night band
  setInterval(gmLoadEvents, 12 * 60000);           // GDELT updates every 15 min
  setInterval(gmLoadWire, 10 * 60000);
  setInterval(gmLoadSeverity, 15 * 60000);
  setInterval(gmLoadPredictions, 10 * 60000);
  setInterval(gmTickWireTimes, 60000);
});
