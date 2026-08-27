// Stryker Trading Academy — Global Monitor (geopolitics & markets terminal)
// Depends on: assets/world-map-path.js (WORLD_MAP_PATH, WORLD_MAP_VIEWBOX),
//             assets/country-shapes.js (COUNTRY_SHAPES)
//
// DATA PATH
// Primary: monitor-data.json, produced every ~20 minutes by the
// .github/workflows/monitor-data.yml pipeline and published to this repo's
// `data` branch. One fetch feeds every panel: map events, wire, financial
// severity feed, markets, outbreaks, DEFCON, predictions. This is the only
// path that works for every student — GDELT rate-limits datacenter IPs and is
// unreachable from some student networks entirely, so a static JSON served
// from GitHub (reachable iff the site itself is reachable) is the reliable
// route.
//
// Fallbacks, per section, when the pipeline JSON cannot be fetched:
//   events/wire/finance -> direct GDELT from the browser -> Firebase cache fns
//   predictions         -> direct Polymarket -> getIntel
//   markets/outbreaks/defcon -> quiet offline note (TradingView quotes stay
//                               live regardless; they never depend on us)
// Upstream error text is logged to the console, never shown to students.

// ---- Data sources -----------------------------------------------------------
var GM_DATA_URL = 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data/monitor-data.json';
var GDELT_GEO = 'https://api.gdeltproject.org/api/v2/geo/geo';
var GDELT_DOC = 'https://api.gdeltproject.org/api/v2/doc/doc';
var POLYMARKET = 'https://gamma-api.polymarket.com/events';
var FN_BASE = 'https://us-central1-strykertrades-e0cd8.cloudfunctions.net/';

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

// ---- Categories -------------------------------------------------------------
var GM_CATS = [
  { key: 'combat', label: 'Armed conflict', colour: '#e5484d',
    re: /\b(war|invasion|offensive|airstrikes?|air strikes?|attacks?|attacked|shelling|artillery|missiles?|rockets?|drone strikes?|bombing|bombardment|fighting|clashes|frontline|combat|strikes? on|killed in strike)\b/i },
  { key: 'terror', label: 'Terror & attacks', colour: '#b04adf',
    re: /\b(terror|suicide bomb|car bomb|ied|hostage|kidnapp|militants?|insurgen|extremis|massacre)\b/i },
  { key: 'military', label: 'Military moves', colour: '#f5a524',
    re: /\b(troops|military|deploy|mobiliz|drills?|exercises?|navy|warships?|fighter jets?|air defen[cs]e|weapons|arms deal|nuclear|missile test|conscription)\b/i },
  { key: 'unrest', label: 'Civil unrest', colour: '#f5c542',
    re: /\b(protests?|riots?|demonstrat|unrest|coup|martial law|crackdown|uprising)\b/i },
  { key: 'diplomacy', label: 'Diplomacy & sanctions', colour: '#00adb5',
    re: /\b(ceasefire|truce|peace|talks|negotiat|sanctions?|embargo|treaty|summit|diplomat|resolution|accord)\b/i },
  { key: 'humanitarian', label: 'Humanitarian', colour: '#8b7dd8',
    re: /\b(refugees?|humanitarian|famine|aid convoy|evacuat|casualt|civilians? killed|displaced|hospital hit)\b/i },
  { key: 'other', label: 'Other', colour: '#7c8894', re: null }
];
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

var GM_SEV_META = {
  critical: { label: 'Critical', colour: '#e5484d' },
  high:     { label: 'High',     colour: '#f5a524' },
  elevated: { label: 'Elevated', colour: '#f5c542' },
  active:   { label: 'Active',   colour: '#00adb5' },
  watch:    { label: 'Watch',    colour: '#f5c542' },
  moderate: { label: 'Moderate', colour: '#03c988' }
};
function gmSevMeta(sev) { return GM_SEV_META[sev] || { label: sev || '—', colour: '#7c8894' }; }

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

function gmFetchJson(url, timeoutMs) {
  var ctrl = ('AbortController' in window) ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 20000) : null;
  return fetch(url, ctrl ? { signal: ctrl.signal } : {})
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function (t) { return JSON.parse(t); })
    .finally(function () { if (timer) clearTimeout(timer); });
}

function gmSetBadge(id, text, off) {
  var b = document.getElementById(id);
  if (b) { b.textContent = text; b.className = 'term-badge' + (off ? ' is-off' : ''); }
}

// Adds entrance-stagger animation to a container's children (CSS handles the
// rest; capped by nth-child so long lists don't take seconds to settle).
function gmAnimate(el) {
  if (!el) return;
  el.classList.remove('gm-anim');
  void el.offsetWidth;              // restart the CSS animation
  el.classList.add('gm-anim');
}

// ---- Projection (equirect, 80N..56S, 1000x460 — matches world-map-path.js) --
var GM_W = 1000, GM_H = 460, GM_LAT_MAX = 80, GM_LAT_MIN = -56;
function gmLonX(lon) { return ((lon + 180) / 360) * GM_W; }
function gmLatY(lat) {
  var c = Math.max(GM_LAT_MIN, Math.min(GM_LAT_MAX, lat));
  return ((GM_LAT_MAX - c) / (GM_LAT_MAX - GM_LAT_MIN)) * GM_H;
}

// ---- Country lookup (fallback paths only; pipeline data arrives attributed) -
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
      if (gmPointInRing(lon, lat, shape.p[r])) return shape.n;
    }
  }
  var best = null, bestD = 2.25;
  for (c = 0; c < COUNTRY_SHAPES.length; c++) {
    var s = COUNTRY_SHAPES[c];
    for (r = 0; r < s.p.length; r++) {
      var ring = s.p[r];
      for (var v = 0; v < ring.length; v++) {
        var dx = ring[v][0] - lon, dy = ring[v][1] - lat, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = s.n; }
      }
    }
  }
  return best;
}
function gmCountryCentroid(name) {
  if (typeof COUNTRY_SHAPES === 'undefined') return null;
  for (var i = 0; i < COUNTRY_SHAPES.length; i++) {
    if (COUNTRY_SHAPES[i].n !== name) continue;
    var best = null, bestArea = -1;
    for (var p = 0; p < COUNTRY_SHAPES[i].p.length; p++) {
      var ring = COUNTRY_SHAPES[i].p[p];
      var minx = 999, maxx = -999, miny = 999, maxy = -999;
      for (var v = 0; v < ring.length; v++) {
        if (ring[v][0] < minx) minx = ring[v][0]; if (ring[v][0] > maxx) maxx = ring[v][0];
        if (ring[v][1] < miny) miny = ring[v][1]; if (ring[v][1] > maxy) maxy = ring[v][1];
      }
      var a = (maxx - minx) * (maxy - miny);
      if (a > bestArea) { bestArea = a; best = [(minx + maxx) / 2, (miny + maxy) / 2]; }
    }
    return best;
  }
  return null;
}

// ============================================================================
// MAP
// ============================================================================
var GM_EVENTS = [];
var GM_ACTIVE_CATS = null;
var GM_VIEW = { x: 0, y: 0, w: GM_W, h: GM_H };
var GM_MIN_ZOOM = 1, GM_MAX_ZOOM = 14;

function gmZoomLevel() { return GM_W / GM_VIEW.w; }

function gmRenderMap() {
  var host = document.getElementById('gm-map');
  if (!host || typeof WORLD_MAP_PATH === 'undefined') return;

  var h = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
  var nightCentreLon = (12 - h) * 15 + 180;
  while (nightCentreLon > 180) nightCentreLon -= 360;
  while (nightCentreLon < -180) nightCentreLon += 360;

  var svg = '' +
    '<svg viewBox="' + WORLD_MAP_VIEWBOX + '" class="term-map-svg gm-map-svg" ' +
        'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">' +
      '<defs>' +
        '<radialGradient id="gmVignette" cx="50%" cy="42%" r="75%">' +
          '<stop offset="0%" stop-color="#0d1a14" stop-opacity="0.9"/>' +
          '<stop offset="70%" stop-color="#08080a" stop-opacity="1"/>' +
        '</radialGradient>' +
      '</defs>' +
      '<rect width="' + GM_W + '" height="' + GM_H + '" fill="url(#gmVignette)"/>' +
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

function gmApplyEvents(events, sourceLabel) {
  events.forEach(function (e) {
    if (e.country === undefined) e.country = gmCountryAt(e.lon, e.lat);
  });
  GM_EVENTS = events;
  gmSetBadge('gm-events-badge', sourceLabel, sourceLabel !== 'live');
  gmRenderCatFilter();
  gmDrawEvents();
  gmRenderEventTable();
  gmRenderTension();
}

function gmEventsUnavailable() {
  if (GM_EVENTS.length) return;   // stale data on screen beats an offline note
  var host = document.getElementById('gm-table-body');
  if (host) host.innerHTML = '<p class="term-empty">Event feed is temporarily offline — it retries automatically every few minutes.</p>';
  gmSetBadge('gm-events-badge', 'offline', true);
  var t = document.getElementById('gm-tension');
  if (t) t.innerHTML = '<p class="term-empty">Waiting for the event feed…</p>';
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

var GM_TABLE_LIMIT = 8;   // a handful by default; Load more expands

function gmRenderEventTable() {
  var host = document.getElementById('gm-table-body');
  if (!host) return;
  var list = gmVisibleEvents();
  if (!list.length) {
    host.innerHTML = '<p class="term-empty">Nothing matches those filters.</p>';
    return;
  }
  var shown = list.slice(0, GM_TABLE_LIMIT);
  host.innerHTML = shown.map(function (e) {
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
  }).join('') +
  (list.length > shown.length
    ? '<button type="button" class="gm-loadmore" id="gm-table-more">Load more · ' +
      (list.length - shown.length) + ' remaining</button>'
    : '');
  gmAnimate(host);

  var more = document.getElementById('gm-table-more');
  if (more) more.addEventListener('click', function () {
    GM_TABLE_LIMIT += 25;
    gmRenderEventTable();
  });

  var count = document.getElementById('gm-table-count');
  if (count) count.textContent = list.length + ' events';
}

// ---- Most active locations (24h) --------------------------------------------
function gmRenderActive24(items) {
  var host = document.getElementById('gm-active24');
  if (!host) return;
  if (!items || !items.length) {
    host.innerHTML = '<p class="term-empty">No location data yet.</p>';
    return;
  }
  var max = items[0].count || 1;
  host.innerHTML = items.slice(0, 8).map(function (r, i) {
    var pct = Math.round((r.count / max) * 100);
    return '<div class="gm-tension-row" data-place-lon="" data-country="' + gmEscAttr(r.country || '') + '">' +
      '<span class="gm-tension-rank">' + (i + 1) + '</span>' +
      '<div class="gm-tension-main">' +
        '<div class="gm-tension-top">' +
          '<span class="gm-tension-name">' + gmEsc(r.place) + '</span>' +
          (r.country && r.country !== r.place
            ? '<span class="gm-active-country">' + gmEsc(r.country) + '</span>' : '') +
          '<span class="gm-tension-val">×' + r.count + '</span>' +
        '</div>' +
        '<div class="gm-tension-bar"><i style="width:' + pct + '%; background:linear-gradient(90deg,' +
          gmCatColour(r.cat) + '88,' + gmCatColour(r.cat) + ')"></i></div>' +
      '</div>' +
    '</div>';
  }).join('');
  gmAnimate(host);
}

// ---- Tension index ----------------------------------------------------------
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
  gmAnimate(host);
}

// ============================================================================
// WIRE
// ============================================================================
var GM_WIRE = [];
var GM_WIRE_SEEN = null;
var GM_WIRE_SEV = null;      // null = all severities
var GM_WIRE_QUERY_TEXT = '';

function gmApplyWire(items, sourceLabel) {
  var firstLoad = (GM_WIRE_SEEN === null);
  var nowSeen = {};
  items.forEach(function (it) {
    nowSeen[it.id] = true;
    it.isNew = !firstLoad && !GM_WIRE_SEEN[it.id];
    if (!it.sev) it.sev = 'active';
  });
  GM_WIRE_SEEN = nowSeen;
  GM_WIRE = items;
  gmSetBadge('gm-wire-badge', sourceLabel, sourceLabel !== 'live');
  gmRenderWire();
  gmRenderTicker();
}

function gmWireUnavailable() {
  if (GM_WIRE.length) return;     // stale data on screen beats an offline note
  var host = document.getElementById('gm-wire-feed');
  if (host) host.innerHTML = '<p class="term-empty">Newswire is temporarily offline — it retries automatically.</p>';
  gmSetBadge('gm-wire-badge', 'offline', true);
  var track = document.getElementById('gm-ticker-track');
  if (track) track.innerHTML = '<span class="gm-ticker-item">Newswire reconnecting…</span>';
}

function gmWireCounts() {
  var c = { highplus: 0, elevated: 0, total: GM_WIRE.length };
  GM_WIRE.forEach(function (it) {
    if (it.sev === 'critical' || it.sev === 'high') c.highplus++;
    else if (it.sev === 'elevated') c.elevated++;
  });
  return c;
}

function gmRenderWire() {
  var host = document.getElementById('gm-wire-feed');
  if (!host) return;

  var counts = gmWireCounts();
  var stats = document.getElementById('gm-wire-stats');
  if (stats) {
    stats.innerHTML =
      '<span class="gm-stat is-high">' + counts.highplus + ' HIGH+</span>' +
      '<span class="gm-stat is-elev">' + counts.elevated + ' ELEVATED</span>' +
      '<span class="gm-stat">' + counts.total + ' ACTIVE</span>';
  }

  var chips = document.getElementById('gm-wire-chips');
  if (chips) {
    chips.innerHTML = ['critical', 'high', 'elevated', 'active'].map(function (k) {
      var n = GM_WIRE.filter(function (it) { return it.sev === k; }).length;
      var on = !GM_WIRE_SEV || GM_WIRE_SEV === k;
      return '<button type="button" class="term-cat' + (on ? ' is-on' : '') +
        (n ? '' : ' is-empty') + '" data-sev="' + k + '">' +
        '<i style="background:' + gmSevMeta(k).colour + '"></i>' +
        gmSevMeta(k).label + '<b>' + n + '</b></button>';
    }).join('');
  }

  var q = GM_WIRE_QUERY_TEXT.toLowerCase();
  var list = GM_WIRE.filter(function (it) {
    if (GM_WIRE_SEV && it.sev !== GM_WIRE_SEV) return false;
    if (q && (it.title + ' ' + (it.country || '') + ' ' + (it.source || '')).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });

  if (!list.length) {
    host.innerHTML = '<p class="term-empty">Nothing matches. Clear the search or filters.</p>';
    return;
  }

  host.innerHTML = list.slice(0, 120).map(function (it) {
    var m = gmSevMeta(it.sev);
    var inner =
      '<span class="gm-wire-dot" style="background:' + m.colour + '; box-shadow:0 0 8px ' + m.colour + '66"></span>' +
      '<span class="gm-wire-body">' +
        '<span class="gm-wire-meta-top">' +
          (it.country ? '<span class="gm-wire-loc">' + gmEsc(it.country.toUpperCase()) + '</span>' : '') +
          '<span class="gm-wire-sev" style="color:' + m.colour + '; border-color:' + m.colour + '55; background:' + m.colour + '14">' + m.label.toUpperCase() + '</span>' +
          '<span class="gm-wire-time">' + gmEsc(gmTimeAgo(it.at)) + ' ago</span>' +
        '</span>' +
        '<span class="gm-wire-title">' + gmEsc(it.title) + '</span>' +
        (it.source ? '<span class="gm-wire-src">' + gmEsc(it.source) + '</span>' : '') +
      '</span>';
    return it.url
      ? '<a class="gm-wire-item' + (it.isNew ? ' is-new' : '') + '" href="' + gmEscAttr(it.url) +
        '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
      : '<div class="gm-wire-item' + (it.isNew ? ' is-new' : '') + '">' + inner + '</div>';
  }).join('');
  gmAnimate(host);
}

function gmRenderTicker() {
  var track = document.getElementById('gm-ticker-track');
  if (!track) return;
  var items = GM_WIRE.slice(0, 30);
  if (!items.length) return;
  var html = items.map(function (it) {
    var inner = '<i style="background:' + gmSevMeta(it.sev).colour + '"></i>' + gmEsc(it.title);
    return it.url
      ? '<a class="gm-ticker-item" href="' + gmEscAttr(it.url) +
        '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
      : '<span class="gm-ticker-item">' + inner + '</span>';
  }).join('');
  track.innerHTML = html + html;
  requestAnimationFrame(function () {
    var w = track.scrollWidth / 2;
    track.style.animationDuration = Math.max(30, Math.round(w / 55)) + 's';
  });
}

function gmTickWireTimes() {
  document.querySelectorAll('#gm-wire-feed .gm-wire-time').forEach(function (el, i) {
    // indexes line up only when unfiltered; cheap and cosmetic either way
    if (!GM_WIRE_SEV && !GM_WIRE_QUERY_TEXT && GM_WIRE[i]) {
      el.textContent = gmTimeAgo(GM_WIRE[i].at) + ' ago';
    }
  });
}

// ============================================================================
// FINANCIAL SEVERITY FEED
// ============================================================================
var GM_SEV_ACTIVE = null;
var GM_SEV_ITEMS = [];
var GM_SEV_LIMIT = 10;    // a handful by default; Load more expands
var GM_HARD_RE = /\b(crash|collaps|plunge|panic|emergency|default|crisis|war|invasion|meltdown|turmoil|freefall|contagion|bank run)\b/i;

function gmApplyFinance(items, sourceLabel) {
  GM_SEV_ITEMS = items;
  gmSetBadge('gm-sev-badge', sourceLabel, sourceLabel !== 'live');
  gmRenderSeverity();
  if (typeof gmRenderFinMap === 'function') gmRenderFinMap();
}

function gmRenderSeverity() {
  var chips = document.getElementById('gm-sev-chips');
  var host = document.getElementById('gm-sev-list');
  if (!host) return;

  var counts = {};
  GM_SEV_ITEMS.forEach(function (it) { counts[it.sev] = (counts[it.sev] || 0) + 1; });

  var bands = ['critical', 'high', 'watch'];
  if (chips) {
    chips.innerHTML = bands.map(function (k) {
      var on = !GM_SEV_ACTIVE || GM_SEV_ACTIVE === k;
      return '<button type="button" class="term-cat' + (on ? ' is-on' : '') +
        ((counts[k] || 0) ? '' : ' is-empty') + '" data-sev="' + k + '">' +
        '<i style="background:' + gmSevMeta(k).colour + '"></i>' +
        gmSevMeta(k).label + '<b>' + (counts[k] || 0) + '</b></button>';
    }).join('');
  }

  // FinancialJuice-style wire: latest first by default; the severity chips
  // narrow, they don't reorder.
  var list = (GM_SEV_ACTIVE
    ? GM_SEV_ITEMS.filter(function (it) { return it.sev === GM_SEV_ACTIVE; })
    : GM_SEV_ITEMS.slice()
  ).sort(function (a, b) { return (b.at || 0) - (a.at || 0); });

  if (!list.length) {
    host.innerHTML = '<p class="term-empty">Nothing at this severity right now.</p>';
    return;
  }

  var shown = list.slice(0, GM_SEV_LIMIT);
  host.innerHTML = shown.map(function (it) {
    var m = gmSevMeta(it.sev);
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
  }).join('') +
  (list.length > shown.length
    ? '<button type="button" class="gm-loadmore" id="gm-sev-more">Load more · ' +
      (list.length - shown.length) + ' remaining</button>'
    : '');
  gmAnimate(host);

  var more = document.getElementById('gm-sev-more');
  if (more) more.addEventListener('click', function () {
    GM_SEV_LIMIT += 20;
    gmRenderSeverity();
  });
}

// ============================================================================
// MARKETS
// ============================================================================
var GM_MARKET_GROUPS = [
  ['idx', 'US indices'], ['fut', 'US futures'], ['haven', 'Safe havens'],
  ['fx', 'Forex'], ['energy', 'Energy'], ['defense', 'Defense stocks'],
  ['crypto', 'Crypto']
];

function gmSpark(points, up) {
  if (!points || points.length < 2) return '';
  var min = Infinity, max = -Infinity;
  points.forEach(function (v) { if (v < min) min = v; if (v > max) max = v; });
  var range = (max - min) || 1;
  var W = 72, H = 22;
  var coords = points.map(function (v, i) {
    var x = (i / (points.length - 1)) * W;
    var y = H - 2 - ((v - min) / range) * (H - 4);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  var colour = up ? 'var(--bull)' : 'var(--bear)';
  return '<svg class="gm-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
    '<polyline points="' + coords + '" fill="none" stroke="' + colour + '" stroke-width="1.4" ' +
    'stroke-linejoin="round" stroke-linecap="round"/></svg>';
}

function gmFmtPct(p) {
  var s = (p > 0 ? '+' : '') + p.toFixed(2) + '%';
  return '<span class="' + (p >= 0 ? 'gm-up' : 'gm-down') + '">' + s + '</span>';
}

function gmFmtPrice(v) {
  if (v >= 10000) return Math.round(v).toLocaleString('en-US');
  if (v >= 100) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function gmRenderMarkets(markets) {
  var host = document.getElementById('gm-markets-grid');
  var sigHost = document.getElementById('gm-signals');
  var secHost = document.getElementById('gm-sectors');
  if (!host) return;

  if (!markets || !markets.items || !markets.items.length) {
    host.innerHTML = '<p class="term-empty">Market data feed is warming up — the live TradingView quotes below are unaffected.</p>';
    if (sigHost) sigHost.innerHTML = '';
    if (secHost) secHost.innerHTML = '';
    gmSetBadge('gm-markets-badge', 'offline', true);
    return;
  }
  gmSetBadge('gm-markets-badge', markets.stale ? 'stale' : 'live', !!markets.stale);

  var byGroup = {};
  markets.items.forEach(function (it) {
    (byGroup[it.group] = byGroup[it.group] || []).push(it);
  });

  host.innerHTML = GM_MARKET_GROUPS.map(function (g) {
    var rows = byGroup[g[0]];
    if (!rows || !rows.length) return '';
    return '<div class="gm-mkt-table">' +
      '<div class="gm-mkt-head"><span>[' + g[0].toUpperCase() + ']</span> ' + g[1] +
        '<span class="gm-mkt-count">' + rows.length + '</span></div>' +
      rows.map(function (r) {
        return '<div class="gm-mkt-row">' +
          '<span class="gm-mkt-label">' + gmEsc(r.label) + '</span>' +
          '<span class="gm-mkt-price">' + gmFmtPrice(r.price) + '</span>' +
          '<span class="gm-mkt-chg">' + gmFmtPct(r.chgPct) + '</span>' +
          gmSpark(r.spark, r.chgPct >= 0) +
        '</div>';
      }).join('') +
    '</div>';
  }).join('');
  gmAnimate(host);

  // signals
  var s = markets.signals || {};
  if (sigHost) {
    var tiles = [];
    if (s.riskTone) {
      tiles.push('<div class="gm-sig">' +
        '<div class="gm-sig-name">Risk tone</div>' +
        '<div class="gm-sig-val" style="color:' +
          (s.riskTone.label === 'RISK-ON' ? 'var(--bull)' : (s.riskTone.label === 'RISK-OFF' ? 'var(--bear)' : 'var(--amber)')) + '">' +
          s.riskTone.label + '</div>' +
        '<div class="gm-sig-sub">Score ' + s.riskTone.score + '/100 · SPX ' +
          (s.riskTone.spx > 0 ? '+' : '') + s.riskTone.spx + '%</div>' +
        '<div class="gm-tension-bar"><i style="width:' + s.riskTone.score + '%"></i></div>' +
      '</div>');
    }
    if (s.breadth) {
      tiles.push('<div class="gm-sig">' +
        '<div class="gm-sig-name">Sector breadth</div>' +
        '<div class="gm-sig-val ' + (s.breadth.adv * 2 >= s.breadth.total ? 'gm-up' : 'gm-down') + '">' +
          s.breadth.adv + '/' + s.breadth.total + '</div>' +
        '<div class="gm-sig-sub">sector avg ' + (s.breadth.avg > 0 ? '+' : '') + s.breadth.avg + '%</div>' +
      '</div>');
    }
    if (s.rotation) {
      tiles.push('<div class="gm-sig">' +
        '<div class="gm-sig-name">Rotation leader</div>' +
        '<div class="gm-sig-val">' + gmEsc(s.rotation.leader) + '</div>' +
        '<div class="gm-sig-sub">' + (s.rotation.leaderPct > 0 ? '+' : '') + s.rotation.leaderPct +
          '% vs ' + gmEsc(s.rotation.laggard) + ' ' + s.rotation.laggardPct + '%</div>' +
      '</div>');
    }
    if (s.curve) {
      tiles.push('<div class="gm-sig">' +
        '<div class="gm-sig-name">Curve / credit</div>' +
        '<div class="gm-sig-val ' + (s.curve.spreadBp >= 0 ? 'gm-up' : 'gm-down') + '">' +
          (s.curve.spreadBp > 0 ? '+' : '') + s.curve.spreadBp + ' bp</div>' +
        '<div class="gm-sig-sub">10Y ' + s.curve.y10 + '% · 5Y ' + s.curve.y5 + '%' +
          (typeof s.curve.hyg === 'number' ? ' · HYG ' + (s.curve.hyg > 0 ? '+' : '') + s.curve.hyg + '%' : '') +
        '</div>' +
      '</div>');
    }
    if (s.vix) {
      tiles.push('<div class="gm-sig">' +
        '<div class="gm-sig-name">Volatility / VIX</div>' +
        '<div class="gm-sig-val" style="color:' +
          (s.vix.label === 'CALM' ? 'var(--bull)' : (s.vix.label === 'NORMAL' ? 'var(--amber)' : 'var(--bear)')) + '">' +
          s.vix.value.toFixed(2) + ' ' + s.vix.label + '</div>' +
        '<div class="gm-sig-sub">' + (s.vix.chgPct > 0 ? '+' : '') + s.vix.chgPct + '% today</div>' +
      '</div>');
    }
    sigHost.innerHTML = tiles.join('');
    gmAnimate(sigHost);
  }

  // movers
  var movHost = document.getElementById('gm-movers');
  if (movHost) {
    if (s.movers) {
      function moverCol(title, rows, cls) {
        return '<div class="gm-mover-col"><div class="gm-mover-head ' + cls + '">' + title + '</div>' +
          rows.map(function (r) {
            return '<div class="gm-mover-row"><span>' + gmEsc(r.label) + '</span>' +
              '<span class="gm-mkt-chg">' + gmFmtPct(r.chgPct) + '</span></div>';
          }).join('') + '</div>';
      }
      movHost.innerHTML =
        moverCol('▲ Gainers', s.movers.up || [], 'gm-up') +
        moverCol('▼ Losers', s.movers.down || [], 'gm-down');
      gmAnimate(movHost);
    } else {
      movHost.innerHTML = '';
    }
  }

  // mega-cap ticker strip
  var strip = document.getElementById('gm-stock-strip');
  if (strip) {
    var megas = (byGroup.mega || []).concat(byGroup.crypto || []);
    if (megas.length) {
      var cells = megas.map(function (r) {
        return '<span class="gm-strip-item"><b>' +
          gmEsc(r.s.replace('-USD', '')) + '</b> ' + gmFmtPrice(r.price) + ' ' + gmFmtPct(r.chgPct) + '</span>';
      }).join('');
      strip.innerHTML = '<div class="gm-ticker-track gm-strip-track">' + cells + cells + '</div>';
      requestAnimationFrame(function () {
        var t = strip.querySelector('.gm-strip-track');
        if (t) t.style.animationDuration = Math.max(25, Math.round(t.scrollWidth / 2 / 60)) + 's';
      });
    }
  }

  // sector board
  if (secHost) {
    var sectors = (byGroup.sector || []).slice().sort(function (a, b) { return b.chgPct - a.chgPct; });
    if (sectors.length) {
      var maxAbs = Math.max.apply(null, sectors.map(function (x) { return Math.abs(x.chgPct); })) || 1;
      secHost.innerHTML = sectors.map(function (r) {
        var w = Math.round((Math.abs(r.chgPct) / maxAbs) * 100);
        return '<div class="gm-sector-row">' +
          '<span class="gm-sector-name">' + gmEsc(r.label) + '</span>' +
          '<div class="gm-sector-bar">' +
            '<i class="' + (r.chgPct >= 0 ? 'is-up' : 'is-down') + '" style="width:' + w + '%"></i>' +
          '</div>' +
          '<span class="gm-mkt-chg">' + gmFmtPct(r.chgPct) + '</span>' +
        '</div>';
      }).join('');
      gmAnimate(secHost);
    } else {
      secHost.innerHTML = '';
    }
  }
}

function gmMountTradingView() {
  var host = document.getElementById('gm-tv-quotes');
  if (!host || host.dataset.mounted === '1') return;
  host.innerHTML = '';
  var s = document.createElement('script');
  s.type = 'text/javascript';
  s.async = true;
  s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js';
  s.innerHTML = JSON.stringify({
    colorTheme: 'dark', isTransparent: true, locale: 'en',
    width: '100%', height: 450,
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

// ============================================================================
// RISK: DEFCON + OUTBREAKS + PREDICTIONS
// ============================================================================
var GM_DEFCON_LEVELS = [
  { n: 1, name: 'COCKED PISTOL', desc: 'Nuclear war is imminent or has already begun. Maximum readiness.', colour: '#e5484d' },
  { n: 2, name: 'FAST PACE', desc: 'Armed forces ready to deploy and engage in 6 hours.', colour: '#f56042' },
  { n: 3, name: 'ROUND HOUSE', desc: 'Air Force ready to mobilize in 15 minutes. Increased readiness.', colour: '#f5a524' },
  { n: 4, name: 'DOUBLE TAKE', desc: 'Above normal readiness. Increased intelligence watch.', colour: '#03c988' },
  { n: 5, name: 'FADE OUT', desc: 'Lowest state of readiness. Normal peacetime posture.', colour: '#03c988' }
];

function gmRenderDefcon(d) {
  var host = document.getElementById('gm-defcon');
  if (!host) return;
  if (!d || !d.level) {
    host.innerHTML = '<p class="term-empty">DEFCON estimate unavailable right now.</p>';
    return;
  }
  var current = GM_DEFCON_LEVELS.filter(function (l) { return l.n === d.level; })[0] || GM_DEFCON_LEVELS[4];
  host.innerHTML =
    '<div class="gm-defcon-hero" style="border-color:' + current.colour + '66; box-shadow:0 0 40px -18px ' + current.colour + '">' +
      '<div class="gm-defcon-num" style="color:' + current.colour + '; text-shadow:0 0 24px ' + current.colour + '66">' + d.level + '</div>' +
      '<div class="gm-defcon-word">DEFCON</div>' +
      '<div class="gm-defcon-name" style="color:' + current.colour + '">' + current.name + '</div>' +
      '<div class="gm-defcon-desc">' + current.desc + '</div>' +
    '</div>' +
    '<div class="gm-defcon-levels">' +
      GM_DEFCON_LEVELS.map(function (l) {
        var isCur = l.n === d.level;
        return '<div class="gm-defcon-level' + (isCur ? ' is-current' : '') + '">' +
          '<span class="gm-defcon-badge" style="color:' + l.colour + '; border-color:' + l.colour + '">' + l.n + '</span>' +
          '<div><b>' + l.name + (isCur ? ' <span class="gm-defcon-cur">(current)</span>' : '') + '</b>' +
          '<p>' + l.desc + '</p></div>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<p class="gm-fineprint">Source: ' + gmEsc(d.source || 'OSINT estimate') +
      (d.at ? ' · updated ' + gmTimeAgo(d.at) + ' ago' : '') + '</p>' +
    '<p class="gm-fineprint gm-warnprint">Third-party OSINT estimate — not official DoD data.</p>';
  gmAnimate(host);
}

function gmRenderOutbreaks(ob) {
  var host = document.getElementById('gm-outbreaks');
  if (!host) return;
  var items = (ob && ob.items) || [];
  if (!items.length) {
    host.innerHTML = '<p class="term-empty">Outbreak feed unavailable right now.</p>';
    return;
  }
  var hi = items.filter(function (i) { return i.sev === 'critical' || i.sev === 'high'; }).length;
  var el = items.filter(function (i) { return i.sev === 'elevated'; }).length;
  var head = document.getElementById('gm-outbreak-stats');
  if (head) {
    head.innerHTML =
      '<span class="gm-stat is-high">' + hi + ' HIGH+</span>' +
      '<span class="gm-stat is-elev">' + el + ' ELEVATED</span>' +
      '<span class="gm-stat">' + items.length + ' TRACKED</span>';
  }

  host.innerHTML = items.slice(0, 20).map(function (it) {
    var m = gmSevMeta(it.sev === 'high' ? 'high' : it.sev);
    var chips = '';
    if (it.cases) chips += '<span class="gm-chip">' + gmEsc(it.cases) + ' cases</span>';
    if (it.deaths) chips += '<span class="gm-chip is-bad">' + gmEsc(it.deaths) + ' deaths</span>';
    if (it.cfr) chips += '<span class="gm-chip is-warn">' + gmEsc(it.cfr) + '% CFR</span>';
    var inner =
      '<span class="gm-wire-dot" style="background:' + m.colour + '; box-shadow:0 0 8px ' + m.colour + '66"></span>' +
      '<span class="gm-wire-body">' +
        '<span class="gm-wire-meta-top">' +
          (it.country ? '<span class="gm-wire-loc">' + gmEsc(it.country.toUpperCase()) + '</span>' : '') +
          '<span class="gm-wire-sev" style="color:' + m.colour + '; border-color:' + m.colour + '55; background:' + m.colour + '14">' + m.label.toUpperCase() + '</span>' +
          '<span class="gm-wire-time">' + gmEsc(gmTimeAgo(it.at)) + ' ago</span>' +
        '</span>' +
        '<span class="gm-wire-title">' + gmEsc(it.disease) + '</span>' +
        (chips ? '<span class="gm-chip-row">' + chips + '</span>' : '') +
        (it.summary ? '<span class="gm-wire-src">' + gmEsc(it.summary) + '…</span>' : '') +
      '</span>';
    return it.url
      ? '<a class="gm-wire-item" href="' + gmEscAttr(it.url) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
      : '<div class="gm-wire-item">' + inner + '</div>';
  }).join('');
  gmAnimate(host);
}

function gmFmtVolume(v) {
  if (!v) return '';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}

// Accepts both shapes: pipeline rows carry an `outcomes` ladder; the older
// fallback paths carry a single `probability`.
function gmNormalizePred(r) {
  if (r.outcomes && r.outcomes.length) return r;
  return {
    question: r.question,
    outcomes: [{ label: r.detail || 'Yes', prob: r.probability || 0 }],
    more: 0, volume: r.volume || null, closes: null, url: r.url || null
  };
}

function gmFmtCloses(ts) {
  if (!ts) return '';
  var d = ts - Date.now();
  if (d <= 0) return 'closing';
  var days = Math.round(d / 86400000);
  if (days < 1) return 'closes today';
  if (days < 14) return 'closes ' + days + 'd';
  if (days < 60) return 'closes ' + Math.round(days / 7) + 'w';
  var dt = new Date(ts);
  return 'closes ' + dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function gmPredRowHtml(raw) {
  var r = gmNormalizePred(raw);
  var lead = r.outcomes[0] || { prob: 0 };
  var ladder = r.outcomes.map(function (o) {
    var pct = Math.round((o.prob || 0) * 100);
    var hue = o.prob >= 0.5 ? '#03c988' : (o.prob >= 0.2 ? '#00adb5' : '#5c6472');
    return '<div class="gm-pred-outcome">' +
      '<span class="gm-pred-olabel">' + gmEsc(o.label) + '</span>' +
      '<span class="gm-pred-obar"><i style="width:' + Math.max(2, pct) + '%; background:' + hue + '"></i></span>' +
      '<span class="gm-pred-opct">' + (pct < 1 ? '&lt;1' : pct) + '%</span>' +
    '</div>';
  }).join('');
  var inner =
    '<div class="gm-pred-top"><span class="gm-pred-q">' + gmEsc(r.question) + '</span></div>' +
    ladder +
    (r.more ? '<div class="gm-pred-more">+' + r.more + ' more</div>' : '') +
    '<div class="gm-pred-meta">' +
      '<span>POLYMARKET' + (r.volume ? ' · ' + gmFmtVolume(r.volume) + ' 24h' : '') + '</span>' +
      (r.closes ? '<span>' + gmEsc(gmFmtCloses(r.closes)) + '</span>' : '') +
    '</div>';
  return r.url
    ? '<a class="gm-pred-row" href="' + gmEscAttr(r.url) +
      '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
    : '<div class="gm-pred-row">' + inner + '</div>';
}

var GM_PRED_TRENDING = [];
var GM_PRED_SEARCH = '';
var GM_PRED_RENDERED = false;

function gmRenderPredictions(rows, sourceLabel) {
  var host = document.getElementById('gm-predict');
  if (host) {
    gmSetBadge('gm-predict-badge', sourceLabel, sourceLabel !== 'live');
    host.innerHTML = rows.map(gmPredRowHtml).join('');
    gmAnimate(host);
    GM_PRED_RENDERED = true;
  }
}

function gmRenderTrendingPredictions() {
  var host = document.getElementById('gm-predict-trend');
  if (!host) return;
  var q = GM_PRED_SEARCH.toLowerCase();
  var rows = GM_PRED_TRENDING.filter(function (r) {
    return !q || (r.question || '').toLowerCase().indexOf(q) !== -1;
  });
  host.innerHTML = rows.length
    ? rows.map(gmPredRowHtml).join('')
    : '<p class="term-empty">' + (GM_PRED_TRENDING.length ? 'No markets match that search.' : 'Prediction feed warming up…') + '</p>';
  gmAnimate(host);
}

// ============================================================================
// ECONOMIC CALENDAR (Forex Factory feed via the pipeline)
// ============================================================================
var GM_CAL_ITEMS = [];
var GM_CAL_RANGE = 'today';       // today | thisweek | nextweek | all
var GM_CAL_IMPACT = null;         // null = all; 'high' | 'medium' | 'low'
var GM_CAL_COUNTRY = null;        // null = all; currency code
var GM_CAL_IMPACT_META = {
  high: { label: 'High', colour: '#e5484d' },
  medium: { label: 'Medium', colour: '#f5a524' },
  low: { label: 'Low', colour: '#f5c542' }
};

function gmCalRangeBounds(range) {
  var now = new Date();
  var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var day = (now.getDay() + 6) % 7;                     // 0 = Monday
  var startWeek = startToday - day * 86400000;
  var endWeek = startWeek + 7 * 86400000;
  if (range === 'today') return [startToday, startToday + 86400000];
  if (range === 'thisweek') return [startWeek, endWeek];
  if (range === 'nextweek') return [endWeek, endWeek + 7 * 86400000];
  return [0, Infinity];
}

function gmApplyCalendar(items, sourceLabel) {
  GM_CAL_ITEMS = items || [];
  gmSetBadge('gm-cal-badge', sourceLabel, sourceLabel !== 'live');
  gmRenderCalendarFilters();
  gmRenderCalendar();
}

function gmRenderCalendarFilters() {
  var ranges = document.getElementById('gm-cal-ranges');
  if (ranges) {
    var defs = [['today', 'Today'], ['thisweek', 'This week'], ['nextweek', 'Next week'], ['all', 'All']];
    ranges.innerHTML = defs.map(function (d) {
      return '<button type="button" class="term-cat' + (GM_CAL_RANGE === d[0] ? ' is-on' : '') +
        '" data-range="' + d[0] + '">' + d[1] + '</button>';
    }).join('');
  }
  var imp = document.getElementById('gm-cal-impacts');
  if (imp) {
    imp.innerHTML = ['high', 'medium', 'low'].map(function (k) {
      var m = GM_CAL_IMPACT_META[k];
      var on = !GM_CAL_IMPACT || GM_CAL_IMPACT === k;
      return '<button type="button" class="term-cat' + (on ? ' is-on' : '') + '" data-impact="' + k + '">' +
        '<i style="background:' + m.colour + '"></i>' + m.label + '</button>';
    }).join('');
  }
  var sel = document.getElementById('gm-cal-country');
  if (sel && sel.options.length <= 1) {
    var seen = {};
    GM_CAL_ITEMS.forEach(function (c) { if (c.country) seen[c.country] = true; });
    var codes = Object.keys(seen).sort();
    sel.innerHTML = '<option value="">All countries</option>' + codes.map(function (c) {
      return '<option value="' + gmEscAttr(c) + '">' + gmEsc(c) + '</option>';
    }).join('');
  }
}

function gmRenderCalendar() {
  var host = document.getElementById('gm-cal-list');
  if (!host) return;
  if (!GM_CAL_ITEMS.length) {
    host.innerHTML = '<p class="term-empty">Calendar feed warming up…</p>';
    return;
  }
  var bounds = gmCalRangeBounds(GM_CAL_RANGE);
  var list = GM_CAL_ITEMS.filter(function (c) {
    if (c.at < bounds[0] || c.at >= bounds[1]) return false;
    if (GM_CAL_IMPACT && c.impact !== GM_CAL_IMPACT) return false;
    if (GM_CAL_COUNTRY && c.country !== GM_CAL_COUNTRY) return false;
    return true;
  });
  if (!list.length) {
    host.innerHTML = '<p class="term-empty">No releases match those filters' +
      (GM_CAL_RANGE === 'today' ? ' today — try “This week”.' : '.') + '</p>';
    return;
  }

  var out = '', lastDay = '';
  var now = Date.now();
  list.forEach(function (c) {
    var d = new Date(c.at);
    var dayKey = d.toDateString();
    if (dayKey !== lastDay) {
      lastDay = dayKey;
      out += '<div class="gm-cal-day">' +
        d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + '</div>';
    }
    var m = GM_CAL_IMPACT_META[c.impact] || GM_CAL_IMPACT_META.low;
    out += '<div class="gm-cal-row' + (c.at < now ? ' is-past' : '') + '">' +
      '<span class="gm-cal-time">' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) + '</span>' +
      '<span class="gm-cal-cty">' + gmEsc(c.country || '—') + '</span>' +
      '<i class="gm-cal-dot" style="background:' + m.colour + '; box-shadow:0 0 6px ' + m.colour + '66" title="' + m.label + ' impact"></i>' +
      '<span class="gm-cal-title">' + gmEsc(c.title) + '</span>' +
      '<span class="gm-cal-vals">' +
        (c.forecast ? 'F ' + gmEsc(c.forecast) : '') +
        (c.previous ? (c.forecast ? ' · ' : '') + 'P ' + gmEsc(c.previous) : '') +
      '</span>' +
    '</div>';
  });
  host.innerHTML = out;
  gmAnimate(host);
}

// ============================================================================
// FINANCIAL MAP — finance headlines + central-bank hubs on the same projection
// ============================================================================
var GM_CB_HUBS = [
  { name: 'Federal Reserve', cur: 'USD', lon: -77.04, lat: 38.89 },
  { name: 'European Central Bank', cur: 'EUR', lon: 8.68, lat: 50.11 },
  { name: 'Bank of England', cur: 'GBP', lon: -0.09, lat: 51.51 },
  { name: 'Bank of Japan', cur: 'JPY', lon: 139.77, lat: 35.68 },
  { name: 'Swiss National Bank', cur: 'CHF', lon: 7.45, lat: 46.95 },
  { name: 'Bank of Canada', cur: 'CAD', lon: -75.70, lat: 45.42 },
  { name: 'Reserve Bank of Australia', cur: 'AUD', lon: 151.21, lat: -33.87 },
  { name: 'RBNZ', cur: 'NZD', lon: 174.78, lat: -41.29 },
  { name: 'PBoC', cur: 'CNY', lon: 116.40, lat: 39.90 }
];

function gmRenderFinMap() {
  var host = document.getElementById('gm-fin-map');
  if (!host || typeof WORLD_MAP_PATH === 'undefined') return;

  // Aggregate the financial wire by country -> dot at country centroid.
  var agg = {};
  GM_SEV_ITEMS.forEach(function (it) {
    var c = it.country || countryFromTitleClient(it.title);
    if (!c) return;
    if (!agg[c]) agg[c] = { country: c, count: 0, worst: 'watch', top: [] };
    agg[c].count++;
    var rank = { critical: 0, high: 1, watch: 2 };
    if ((rank[it.sev] || 2) < (rank[agg[c].worst] || 2)) agg[c].worst = it.sev;
    if (agg[c].top.length < 2) agg[c].top.push(it);
  });

  var dots = '';
  Object.keys(agg).forEach(function (name) {
    var c = gmCountryCentroid(name);
    if (!c) return;
    var a = agg[name];
    var colour = gmSevMeta(a.worst).colour;
    var r = 3 + Math.min(6, Math.sqrt(a.count) * 1.6);
    dots += '<g class="gm-fin-pin" data-country="' + gmEscAttr(name) + '">' +
      '<circle cx="' + gmLonX(c[0]).toFixed(1) + '" cy="' + gmLatY(c[1]).toFixed(1) +
        '" r="' + (r + 5).toFixed(1) + '" fill="transparent"/>' +
      '<circle cx="' + gmLonX(c[0]).toFixed(1) + '" cy="' + gmLatY(c[1]).toFixed(1) +
        '" r="' + r.toFixed(1) + '" fill="' + colour + '" fill-opacity="0.7" stroke="' + colour + '" stroke-width="1"/>' +
    '</g>';
  });

  // Central-bank hubs: gold rings, next high-impact release in the tooltip.
  var hubs = '';
  GM_CB_HUBS.forEach(function (h) {
    hubs += '<g class="gm-fin-hub" data-cur="' + h.cur + '">' +
      '<circle cx="' + gmLonX(h.lon).toFixed(1) + '" cy="' + gmLatY(h.lat).toFixed(1) +
        '" r="10" fill="transparent"/>' +
      '<circle cx="' + gmLonX(h.lon).toFixed(1) + '" cy="' + gmLatY(h.lat).toFixed(1) +
        '" r="5" fill="none" stroke="#f5c542" stroke-width="1.4" opacity="0.9"/>' +
      '<circle cx="' + gmLonX(h.lon).toFixed(1) + '" cy="' + gmLatY(h.lat).toFixed(1) +
        '" r="1.6" fill="#f5c542"/>' +
    '</g>';
  });

  host.innerHTML =
    '<svg viewBox="' + WORLD_MAP_VIEWBOX + '" class="term-map-svg" ' +
        'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">' +
      '<rect width="' + GM_W + '" height="' + GM_H + '" fill="#08080a"/>' +
      gmGraticule() +
      '<path d="' + WORLD_MAP_PATH + '" fill="#1c2126" stroke="#2e363d" stroke-width="0.7"/>' +
      '<g>' + dots + hubs + '</g>' +
    '</svg>';

  if (host.dataset.bound !== '1') {
    host.dataset.bound = '1';
    host.addEventListener('pointerover', function (e) { gmFinMapTip(e, agg); });
    host.addEventListener('pointermove', function (e) {
      var tip = document.getElementById('gm-tip');
      if (tip && tip.style.display === 'flex') gmPositionTip(e.clientX, e.clientY);
    });
    host.addEventListener('pointerout', function (e) {
      if (e.target.closest && e.target.closest('.gm-fin-pin, .gm-fin-hub')) gmHideTip();
    });
    host.addEventListener('click', function (e) {
      var pin = e.target.closest && e.target.closest('.gm-fin-pin');
      if (!pin) return;
      var a = (gmFinMapAgg || {})[pin.dataset.country];
      if (a && a.top[0] && a.top[0].url) window.open(a.top[0].url, '_blank', 'noopener');
    });
  }
  gmFinMapAgg = agg;
}
var gmFinMapAgg = null;

function gmFinMapTip(e, agg) {
  var tip = document.getElementById('gm-tip');
  if (!tip) return;
  var pin = e.target.closest && e.target.closest('.gm-fin-pin');
  var hub = e.target.closest && e.target.closest('.gm-fin-hub');
  if (pin) {
    var a = agg[pin.dataset.country];
    if (!a) return;
    tip.innerHTML =
      '<span class="term-tip-cat" style="color:' + gmSevMeta(a.worst).colour + '">' +
        gmEsc(pin.dataset.country) + ' · ' + a.count + ' financial ' + (a.count === 1 ? 'story' : 'stories') + '</span>' +
      a.top.map(function (t) {
        return '<span class="term-tip-title">' + gmEsc(t.title) + '</span>';
      }).join('') +
      '<span class="term-tip-meta">click to open the top story</span>';
    tip.style.display = 'flex';
    gmPositionTip(e.clientX, e.clientY);
  } else if (hub) {
    var cur = hub.dataset.cur;
    var conf = GM_CB_HUBS.filter(function (h) { return h.cur === cur; })[0];
    var next = GM_CAL_ITEMS.filter(function (c) {
      return c.country === cur && c.impact === 'high' && c.at > Date.now();
    }).slice(0, 2);
    tip.innerHTML =
      '<span class="term-tip-cat" style="color:#f5c542">' + gmEsc(conf ? conf.name : cur) + ' · ' + gmEsc(cur) + '</span>' +
      (next.length
        ? next.map(function (c) {
            var d = new Date(c.at);
            return '<span class="term-tip-title">' + gmEsc(c.title) + '</span>' +
              '<span class="term-tip-meta">' +
              d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' +
              d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) +
              ' · high impact</span>';
          }).join('')
        : '<span class="term-tip-meta">No high-impact releases scheduled in the window.</span>');
    tip.style.display = 'flex';
    gmPositionTip(e.clientX, e.clientY);
  }
}

// Lightweight client-side country tagging for fallback wire items that
// arrived without one.
var GM_TITLE_COUNTRY = [
  ['United States', /\b(U\.?S\.?|Fed|Federal Reserve|Wall Street|dollar|Treasur)\b/i],
  ['United Kingdom', /\b(UK|Bank of England|sterling|FTSE|London)\b/i],
  ['Japan', /\b(Japan|yen|BoJ|Nikkei)\b/i],
  ['China', /\b(China|yuan|PBoC|Beijing)\b/i],
  ['Germany', /\b(ECB|euro ?zone|euro\b|Germany|DAX)\b/i]
];
function countryFromTitleClient(title) {
  for (var i = 0; i < GM_TITLE_COUNTRY.length; i++) {
    if (GM_TITLE_COUNTRY[i][1].test(title)) return GM_TITLE_COUNTRY[i][0];
  }
  return null;
}

// ============================================================================
// AI OSINT BRIEFING
// ============================================================================
function gmRenderBrief(brief) {
  var host = document.getElementById('gm-brief');
  if (!host) return;
  if (!brief || (!brief.summary && !brief.hotspots)) {
    host.innerHTML = '<p class="term-empty">The next pipeline run will generate the first briefing.</p>';
    return;
  }
  var html = '';
  html += '<div class="gm-brief-head">' +
    '<span class="gm-onair"><i></i>STRYKER AI</span>' +
    '<span class="gm-brief-time">SITREP · ' + (brief.at ? gmTimeAgo(brief.at) + ' ago' : 'live') + '</span>' +
  '</div>';

  if (brief.summary && brief.summary.length) {
    html += '<div class="gm-brief-block"><h4>Executive summary</h4>' +
      '<p class="gm-brief-type" id="gm-brief-typed" data-full="' +
        gmEscAttr(brief.summary.join(' ')) + '"></p></div>';
  }
  if (brief.hotspots && brief.hotspots.length) {
    html += '<div class="gm-brief-block"><h4>Hotspot assessment</h4>' +
      brief.hotspots.map(function (h, i) {
        return '<div class="gm-brief-hotspot">' +
          '<span class="gm-tension-rank">' + (i + 1) + '</span>' +
          '<div><b>' + gmEsc(h.country) + '</b> — ' + gmEsc(h.driver) +
            ' · ' + h.events + ' tracked events' +
            (h.headline ? '<p>' + gmEsc(h.headline) + '</p>' : '') +
          '</div></div>';
      }).join('') + '</div>';
  }
  if (brief.marketRead) {
    html += '<div class="gm-brief-block"><h4>Market read</h4><p>' + gmEsc(brief.marketRead) + '</p></div>';
  }
  if (brief.critWire && brief.critWire.length) {
    html += '<div class="gm-brief-block"><h4>Priority signals</h4>' +
      brief.critWire.map(function (w) {
        var m = gmSevMeta(w.sev);
        var line = '<span class="gm-wire-sev" style="color:' + m.colour + '; border-color:' + m.colour +
          '55; background:' + m.colour + '14">' + m.label.toUpperCase() + '</span> ' + gmEsc(w.title);
        return w.url
          ? '<a class="gm-brief-signal" href="' + gmEscAttr(w.url) + '" target="_blank" rel="noopener noreferrer">' + line + '</a>'
          : '<div class="gm-brief-signal">' + line + '</div>';
      }).join('') + '</div>';
  }
  if (brief.watch && brief.watch.length) {
    html += '<div class="gm-brief-block"><h4>Watchlist</h4><ul class="gm-brief-watch">' +
      brief.watch.map(function (w) { return '<li>' + gmEsc(w) + '</li>'; }).join('') + '</ul></div>';
  }
  html += '<p class="gm-fineprint">Automated OSINT synthesis of this terminal\'s live feeds — regenerated every pipeline run. Not investment advice.</p>';
  host.innerHTML = html;
  gmAnimate(host);
}

// Typewriter for the executive summary — run when the AI tab first opens so
// the effect is actually seen. Instant under prefers-reduced-motion.
var GM_BRIEF_TYPED = false;
function gmTypeBrief() {
  var el = document.getElementById('gm-brief-typed');
  if (!el || GM_BRIEF_TYPED) return;
  GM_BRIEF_TYPED = true;
  var full = el.getAttribute('data-full') || '';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { el.textContent = full; return; }
  el.classList.add('is-typing');
  var i = 0;
  var timer = setInterval(function () {
    i += 3;
    el.textContent = full.slice(0, i);
    if (i >= full.length) { clearInterval(timer); el.classList.remove('is-typing'); }
  }, 16);
}

// ============================================================================
// STREAMS
// ============================================================================
// youtube.com/embed/live_stream?channel=<id> shows whatever that channel is
// currently broadcasting live — no API key, survives stream-ID rotation.
var GM_STREAMS = [
  { key: 'bloomberg', label: 'Bloomberg', channel: 'UCIALMKvObZNtJ6AmdCLP7Lg' },
  { key: 'skynews', label: 'Sky News', channel: 'UCoMdktPbSTixAyNGwb-UYkQ' },
  { key: 'dw', label: 'DW News', channel: 'UCknLrEdhRCp1aegoMqRaCZg' },
  { key: 'aljazeera', label: 'Al Jazeera', channel: 'UCNye-wNBqNL5ZzHSJj3l8Bg' },
  { key: 'euronews', label: 'Euronews', channel: 'UCSrZ3UV4jOidv8ppoVuvW9Q' },
  { key: 'cnbc', label: 'CNBC', channel: 'UCvJJ_dzjViJCoLf5uKUTwoA' }
];
var GM_STREAM_ACTIVE = null;

function gmMountStream(key) {
  var conf = null;
  for (var i = 0; i < GM_STREAMS.length; i++) if (GM_STREAMS[i].key === key) conf = GM_STREAMS[i];
  if (!conf) return;
  GM_STREAM_ACTIVE = key;

  var tabs = document.getElementById('gm-stream-tabs');
  if (tabs) {
    tabs.querySelectorAll('.term-cat').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.stream === key);
    });
  }
  var label = document.getElementById('gm-stream-label');
  if (label) label.textContent = conf.label.toUpperCase();

  var host = document.getElementById('gm-stream-frame');
  if (!host) return;
  host.innerHTML = '<iframe src="https://www.youtube.com/embed/live_stream?channel=' +
    conf.channel + '" title="' + gmEscAttr(conf.label) + ' live" ' +
    'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ' +
    'allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
}

function gmInitStreams() {
  var tabs = document.getElementById('gm-stream-tabs');
  if (!tabs || tabs.dataset.built === '1') return;
  tabs.dataset.built = '1';
  tabs.innerHTML = GM_STREAMS.map(function (s) {
    return '<button type="button" class="term-cat" data-stream="' + s.key + '">' + s.label + '</button>';
  }).join('');
  tabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.term-cat');
    if (btn) gmMountStream(btn.dataset.stream);
  });
  gmMountStream(GM_STREAMS[0].key);
}

// ============================================================================
// DATA LOADING — pipeline first, per-section fallbacks second
// ============================================================================
var GM_HAVE = { events: false, wire: false, finance: false, predictions: false };

function gmUpdateFreshness(generatedAt) {
  var el = document.getElementById('gm-data-age');
  var badge = document.getElementById('gm-live-badge');
  if (!generatedAt) {
    if (badge) badge.className = 'gm-live is-off';
    if (el) el.textContent = 'FALLBACK FEEDS';
    return;
  }
  var mins = Math.max(0, Math.round((Date.now() - generatedAt) / 60000));
  var label = mins < 1 ? 'LIVE'
    : (mins < 90 ? mins + 'M AGO' : Math.round(mins / 60) + 'H AGO');
  if (el) el.textContent = 'DATA ' + label;
  if (badge) badge.className = 'gm-live' + (mins > 90 ? ' is-off' : '');
}

// Pipeline data older than this counts as stale on the page: it still
// renders (old data beats empty panels), but the direct browser fallbacks
// are fired to try to top it up with something fresher.
var GM_FRESH_MS = 90 * 60000;

function gmLoadData() {
  // raw.githubusercontent caches ~5 min per URL; a slow-rolling buster keeps
  // us at most one cache window behind the pipeline.
  var buster = Math.floor(Date.now() / 300000);
  gmFetchJson(GM_DATA_URL + '?t=' + buster, 25000)
    .then(function (d) {
      gmUpdateFreshness(d.generatedAt);

      // Old pipeline data still renders (old beats empty), but only FRESH
      // data marks a section as satisfied — anything else lets the direct
      // browser fallbacks try to top it up. And stale pipeline data never
      // overwrites fresher data a fallback already fetched this session.
      var fresh = d.generatedAt && (Date.now() - d.generatedAt) < GM_FRESH_MS;

      if (d.events && d.events.items && d.events.items.length &&
          (fresh || !GM_EVENTS.length)) {
        GM_HAVE.events = fresh && !d.events.stale;
        gmApplyEvents(d.events.items, (d.events.stale || !fresh) ? 'stale' : 'live');
      }
      if (d.active24 && d.active24.items) gmRenderActive24(d.active24.items);

      if (d.wire && d.wire.items && d.wire.items.length &&
          (fresh || !GM_WIRE.length)) {
        GM_HAVE.wire = fresh && !d.wire.stale;
        gmApplyWire(d.wire.items, (d.wire.stale || !fresh) ? 'stale' : 'live');
      }
      if (d.finance && d.finance.items && d.finance.items.length &&
          (fresh || !GM_SEV_ITEMS.length)) {
        GM_HAVE.finance = fresh && !d.finance.stale;
        gmApplyFinance(d.finance.items, (d.finance.stale || !fresh) ? 'stale' : 'live');
      }
      if (d.markets) gmRenderMarkets(d.markets);
      if (d.outbreaks) gmRenderOutbreaks(d.outbreaks);
      if (d.defcon) gmRenderDefcon(d.defcon);
      if (d.predictions && d.predictions.items && d.predictions.items.length &&
          (fresh || !GM_PRED_RENDERED)) {
        GM_HAVE.predictions = fresh && !d.predictions.stale;
        gmRenderPredictions(d.predictions.items, (d.predictions.stale || !fresh) ? 'stale' : 'live');
        GM_PRED_TRENDING = (d.predictions.trending && d.predictions.trending.length)
          ? d.predictions.trending : d.predictions.items;
        gmRenderTrendingPredictions();
      }
      if (d.calendar && d.calendar.items) {
        gmApplyCalendar(d.calendar.items, d.calendar.stale ? 'stale' : 'live');
      }
      if (d.brief) gmRenderBrief(d.brief);
      gmRenderFinMap();

      // Anything the pipeline could not supply still tries its fallback.
      gmLoadFallbacks();
    })
    .catch(function (err) {
      console.warn('Global Monitor: pipeline data unavailable, using fallbacks', err);
      gmUpdateFreshness(null);
      gmRenderMarkets(null);
      gmRenderOutbreaks(null);
      gmRenderDefcon(null);
      gmLoadFallbacks();
    });
}

function gmLoadFallbacks() {
  if (!GM_HAVE.events) gmLoadEventsDirect();
  if (!GM_HAVE.wire) setTimeout(gmLoadWireDirect, 1500);
  if (!GM_HAVE.finance) setTimeout(gmLoadFinanceDirect, 4000);
  if (!GM_HAVE.predictions) gmLoadPredictionsDirect();
}

// ---- Fallback: events -------------------------------------------------------
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

function gmLoadEventsDirect() {
  var url = GDELT_GEO + '?query=' + encodeURIComponent(GM_EVENTS_QUERY) +
    '&mode=pointdata&format=geojson&timespan=6h';
  gmFetchJson(url, 20000)
    .then(function (json) {
      var events = gmParseGeo(json);
      if (!events.length) throw new Error('empty');
      GM_HAVE.events = true;
      gmApplyEvents(events, 'direct');
    })
    .catch(function () {
      gmFetchJson(FN_BASE + 'getWorldEvents', 15000)
        .then(function (data) {
          var events = ((data && data.events) || []).filter(function (e) {
            return e.cat === 'conflict' || e.cat === 'politics';
          }).map(function (e) {
            return { lon: e.lon, lat: e.lat, place: e.place, title: e.title,
                     url: e.url, count: e.count || 1,
                     cat: gmCategorise(e.title + ' ' + (e.place || '')) };
          });
          if (!events.length) throw new Error('cache empty');
          GM_HAVE.events = true;
          gmApplyEvents(events, 'cached');
        })
        .catch(function (err) {
          console.warn('Global Monitor: all event sources failed', err);
          gmEventsUnavailable();
        });
    });
}

// ---- Fallback: wire ---------------------------------------------------------
function gmParseArticles(json) {
  var articles = (json && json.articles) || [];
  var seen = {};
  var items = [];
  for (var i = 0; i < articles.length; i++) {
    var a = articles[i];
    var title = String(a.title || '').trim();
    if (!title) continue;
    var fp = gmFingerprint(title);
    if (!fp || seen[fp]) continue;
    seen[fp] = true;
    items.push({
      id: fp, title: title.slice(0, 200), url: a.url || null,
      source: String(a.domain || '').replace(/^www\./, '').slice(0, 40),
      country: String(a.sourcecountry || '').slice(0, 40) || null,
      at: gmParseSeenDate(a.seendate), cat: gmCategorise(title),
      sev: GM_HARD_RE.test(title) ? 'high' : 'active'
    });
    if (items.length >= 60) break;
  }
  return items;
}

function gmLoadWireDirect() {
  var url = GDELT_DOC + '?query=' + encodeURIComponent(GM_WIRE_QUERY) +
    '&mode=artlist&format=json&maxrecords=100&sort=datedesc&timespan=3h';
  gmFetchJson(url, 20000)
    .then(function (json) {
      var items = gmParseArticles(json);
      if (!items.length) throw new Error('empty');
      GM_HAVE.wire = true;
      gmApplyWire(items, 'direct');
    })
    .catch(function () {
      gmFetchJson(FN_BASE + 'getNewswire', 15000)
        .then(function (data) {
          var items = ((data && data.items) || []).map(function (it) {
            return { id: it.id, title: it.title, url: it.url, source: it.source,
                     country: null, at: it.at, cat: gmCategorise(it.title),
                     sev: GM_HARD_RE.test(it.title) ? 'high' : 'active' };
          });
          if (!items.length) throw new Error('cache empty');
          GM_HAVE.wire = true;
          gmApplyWire(items, 'cached');
        })
        .catch(function (err) {
          console.warn('Global Monitor: all wire sources failed', err);
          gmWireUnavailable();
        });
    });
}

// ---- Fallback: finance severity --------------------------------------------
function gmLoadFinanceDirect() {
  var severeUrl = GDELT_DOC + '?query=' + encodeURIComponent(GM_FIN_QUERY + ' tone<-7') +
    '&mode=artlist&format=json&maxrecords=50&sort=datedesc&timespan=12h';
  var moderateUrl = GDELT_DOC + '?query=' + encodeURIComponent(GM_FIN_QUERY + ' tone<-2.5') +
    '&mode=artlist&format=json&maxrecords=75&sort=datedesc&timespan=12h';

  gmFetchJson(severeUrl, 20000)
    .then(function (severeJson) {
      var severe = gmParseArticles(severeJson);
      return new Promise(function (resolve) { setTimeout(resolve, 1500); })
        .then(function () { return gmFetchJson(moderateUrl, 20000); })
        .then(function (moderateJson) { return [severe, gmParseArticles(moderateJson)]; })
        .catch(function () { return [severe, []]; });
    })
    .then(function (pair) {
      var severeIds = {}, all = {};
      pair[0].forEach(function (it) { severeIds[it.id] = true; all[it.id] = it; });
      pair[1].forEach(function (it) { if (!all[it.id]) all[it.id] = it; });
      var items = Object.keys(all).map(function (id) {
        var it = all[id];
        var hard = GM_HARD_RE.test(it.title);
        var sev = severeIds[id] ? (hard ? 'critical' : 'high') : (hard ? 'high' : 'watch');
        return { id: it.id, title: it.title, url: it.url, source: it.source, at: it.at, sev: sev };
      });
      var rank = { critical: 0, high: 1, watch: 2 };
      items.sort(function (a, b) { return rank[a.sev] - rank[b.sev] || (b.at || 0) - (a.at || 0); });
      if (!items.length) throw new Error('empty');
      GM_HAVE.finance = true;
      gmApplyFinance(items.slice(0, 60), 'direct');
    })
    .catch(function () {
      gmFetchJson(FN_BASE + 'getNewswire', 15000)
        .then(function (data) {
          var items = ((data && data.items) || []).filter(function (it) {
            return it.cat === 'markets' || it.cat === 'econ' || it.cat === 'centralbank';
          }).map(function (it) {
            return { id: it.id, title: it.title, url: it.url, source: it.source, at: it.at,
                     sev: GM_HARD_RE.test(it.title) ? 'high' : 'watch' };
          });
          if (!items.length) throw new Error('cache empty');
          GM_HAVE.finance = true;
          gmApplyFinance(items, 'cached');
        })
        .catch(function (err) {
          console.warn('Global Monitor: all finance sources failed', err);
          if (GM_SEV_ITEMS.length) return;   // keep the stale list on screen
          var host = document.getElementById('gm-sev-list');
          if (host) host.innerHTML = '<p class="term-empty">Severity feed is temporarily offline.</p>';
          gmSetBadge('gm-sev-badge', 'offline', true);
        });
    });
}

// ---- Fallback: predictions --------------------------------------------------
var GM_GEO_RE = /\b(war|ceasefire|invasion|invade|missile|nuclear|NATO|Russia|Ukraine|Israel|Gaza|Iran|China|Taiwan|Korea|military|troops|sanctions?|Hezbollah|Houthis?|Putin|Zelensky|Netanyahu|regime|annex|treaty|border)\b/i;

function gmLoadPredictionsDirect() {
  gmFetchJson(POLYMARKET + '?closed=false&order=volume24hr&ascending=false&limit=100', 20000)
    .then(function (json) {
      var events = Array.isArray(json) ? json : [];
      var rows = [];
      for (var i = 0; i < events.length && rows.length < 10; i++) {
        var ev = events[i];
        var title = String(ev.title || '');
        if (!GM_GEO_RE.test(title)) continue;
        var best = null, bestVol = -1;
        for (var k = 0; k < (ev.markets || []).length; k++) {
          var m = ev.markets[k];
          var prices, outcomes;
          try { prices = JSON.parse(m.outcomePrices || '[]'); outcomes = JSON.parse(m.outcomes || '[]'); }
          catch (e) { continue; }
          if (!prices.length) continue;
          var yesIdx = 0;
          for (var o = 0; o < outcomes.length; o++) {
            if (String(outcomes[o]).toLowerCase() === 'yes') { yesIdx = o; break; }
          }
          var prob = Number(prices[yesIdx]);
          if (isNaN(prob)) continue;
          var vol = Number(m.volume24hr || m.volume || 0);
          if (vol > bestVol) {
            bestVol = vol;
            best = { prob: prob,
                     label: ev.markets.length > 1 ? String(m.groupItemTitle || m.question || '').slice(0, 60) : null };
          }
        }
        if (!best) continue;
        rows.push({
          question: title.slice(0, 120), detail: best.label, probability: best.prob,
          volume: Number(ev.volume24hr || ev.volume || 0),
          url: ev.slug ? 'https://polymarket.com/event/' + ev.slug : null
        });
      }
      if (!rows.length) throw new Error('no geo markets');
      GM_HAVE.predictions = true;
      gmRenderPredictions(rows, 'direct');
    })
    .catch(function () {
      gmFetchJson(FN_BASE + 'getIntel', 15000)
        .then(function (res) {
          var rows = (((res || {}).data || {}).predictions || []).map(function (r) {
            return { question: r.question, detail: null,
                     probability: r.probability, volume: null, url: null };
          });
          if (!rows.length) throw new Error('empty');
          GM_HAVE.predictions = true;
          gmRenderPredictions(rows, 'cached');
        })
        .catch(function (err) {
          console.warn('Global Monitor: all prediction sources failed', err);
          if (GM_PRED_RENDERED) return;      // keep the stale ladders on screen
          var host = document.getElementById('gm-predict');
          if (host) host.innerHTML = '<p class="term-empty">Prediction feed is temporarily offline.</p>';
          gmSetBadge('gm-predict-badge', 'offline', true);
        });
    });
}

// ============================================================================
// TABS + CLOCK + BOOT
// ============================================================================
function gmShowTab(tab) {
  document.querySelectorAll('.gm-panel').forEach(function (p) {
    p.classList.toggle('is-active', p.dataset.tab === tab);
  });
  document.querySelectorAll('#gm-tabs .term-tab').forEach(function (b) {
    b.classList.toggle('is-active', b.dataset.tab === tab);
  });
  // Heavy embeds mount on first view, not at page load.
  if (tab === 'markets') gmMountTradingView();
  if (tab === 'streams') gmInitStreams();
  if (tab === 'map') { gmApplyView(); }
  if (tab === 'ai') gmTypeBrief();
  try { localStorage.setItem('stryker_gm_tab', tab); } catch (e) {}
}

function gmTickClock() {
  var el = document.getElementById('gm-utc');
  if (!el) return;
  var d = new Date();
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  el.textContent = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC';
}

document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('gm-map')) return;

  gmRenderMap();
  gmTickClock();
  gmLoadData();

  var tabs = document.getElementById('gm-tabs');
  if (tabs) tabs.addEventListener('click', function (e) {
    var btn = e.target.closest('.term-tab');
    if (btn) gmShowTab(btn.dataset.tab);
  });
  // Markets is the home tab — this is a trading site first. Last-used tab is
  // still remembered per visitor.
  var saved = 'markets';
  try { saved = localStorage.getItem('stryker_gm_tab') || 'markets'; } catch (e) {}
  gmShowTab(saved);

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
    GM_TABLE_LIMIT = 8;
    gmRenderCatFilter(); gmDrawEvents(); gmRenderEventTable();
  });

  var wireChips = document.getElementById('gm-wire-chips');
  if (wireChips) wireChips.addEventListener('click', function (e) {
    var btn = e.target.closest('.term-cat');
    if (!btn) return;
    GM_WIRE_SEV = (GM_WIRE_SEV === btn.dataset.sev) ? null : btn.dataset.sev;
    gmRenderWire();
  });

  var wireSearch = document.getElementById('gm-wire-search');
  if (wireSearch) wireSearch.addEventListener('input', function () {
    GM_WIRE_QUERY_TEXT = wireSearch.value.trim();
    gmRenderWire();
  });

  var sevChips = document.getElementById('gm-sev-chips');
  if (sevChips) sevChips.addEventListener('click', function (e) {
    var btn = e.target.closest('.term-cat');
    if (!btn) return;
    GM_SEV_ACTIVE = (GM_SEV_ACTIVE === btn.dataset.sev) ? null : btn.dataset.sev;
    GM_SEV_LIMIT = 10;
    gmRenderSeverity();
  });

  var calRanges = document.getElementById('gm-cal-ranges');
  if (calRanges) calRanges.addEventListener('click', function (e) {
    var btn = e.target.closest('.term-cat');
    if (!btn) return;
    GM_CAL_RANGE = btn.dataset.range;
    gmRenderCalendarFilters(); gmRenderCalendar();
  });
  var calImpacts = document.getElementById('gm-cal-impacts');
  if (calImpacts) calImpacts.addEventListener('click', function (e) {
    var btn = e.target.closest('.term-cat');
    if (!btn) return;
    GM_CAL_IMPACT = (GM_CAL_IMPACT === btn.dataset.impact) ? null : btn.dataset.impact;
    gmRenderCalendarFilters(); gmRenderCalendar();
  });
  var calCountry = document.getElementById('gm-cal-country');
  if (calCountry) calCountry.addEventListener('change', function () {
    GM_CAL_COUNTRY = calCountry.value || null;
    gmRenderCalendar();
  });

  var predSearch = document.getElementById('gm-pred-search');
  if (predSearch) predSearch.addEventListener('input', function () {
    GM_PRED_SEARCH = predSearch.value.trim();
    gmRenderTrendingPredictions();
  });

  var table = document.getElementById('gm-table-body');
  if (table) table.addEventListener('click', function (e) {
    if (e.target.closest('.term-row-link')) return;
    var row = e.target.closest('.term-row');
    if (row) gmFlyTo(parseFloat(row.dataset.lon), parseFloat(row.dataset.lat));
  });

  function flyToCountryRow(e) {
    var row = e.target.closest('.gm-tension-row');
    if (!row || !row.dataset.country) return;
    var c = gmCountryCentroid(row.dataset.country);
    if (c) { gmShowTab('map'); gmFlyTo(c[0], c[1]); }
  }
  var tension = document.getElementById('gm-tension');
  if (tension) tension.addEventListener('click', flyToCountryRow);
  var active24 = document.getElementById('gm-active24');
  if (active24) active24.addEventListener('click', flyToCountryRow);

  var zin = document.getElementById('gm-zoom-in');
  var zout = document.getElementById('gm-zoom-out');
  var zres = document.getElementById('gm-zoom-reset');
  if (zin) zin.addEventListener('click', function () { gmZoomBy(1.6); gmDrawEvents(); });
  if (zout) zout.addEventListener('click', function () { gmZoomBy(1 / 1.6); gmDrawEvents(); });
  if (zres) zres.addEventListener('click', function () { gmResetView(); gmDrawEvents(); });

  setInterval(gmTickClock, 1000);
  setInterval(gmRenderMap, 10 * 60000);        // night band drift
  setInterval(gmLoadData, 6 * 60000);          // pipeline republishes every ~20
  setInterval(gmTickWireTimes, 60000);
});
