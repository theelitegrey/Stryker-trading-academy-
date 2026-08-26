/**
 * Converts world-atlas TopoJSON into a single SVG path for the terminal map.
 *
 * Equirectangular projection, chosen deliberately over something prettier like
 * Robinson: longitude maps linearly to x, so a session's position on the map is
 * a straight function of UTC hour. The trading-session arcs and the country
 * markers can then be placed with arithmetic instead of a projection library
 * shipped to the browser.
 *
 * Land only, not country borders. At the size this renders — a panel a few
 * hundred pixels wide — borders become noise, and the map is a backdrop for
 * event markers rather than a reference atlas.
 *
 * Coordinates are rounded to one decimal place. At this scale that is
 * sub-pixel, and it cuts the path string by more than half.
 */

const fs = require('fs');
const topojson = require('topojson-client');

const W = 1000;
const H = 460;

// Latitude window rather than the full -90..90. Antarctica occupied a third of
// the height and no market sits there, and the empty Arctic above ~78N is the
// same waste at the other end. Cropping buys real estate for the populated
// latitudes where every exchange actually is.
const LAT_MAX = 88;
const LAT_MIN = -56;
const PRECISION = 0;

// 110m is the coarsest world-atlas offering, which is what we want: the finer
// sets carry detail that is invisible here and costs tens of kilobytes.
const topo = JSON.parse(
  fs.readFileSync('node_modules/world-atlas/land-110m.json', 'utf8')
);
const land = topojson.feature(topo, topo.objects.land);

function project([lon, lat]) {
  return [
    ((lon + 180) / 360) * W,
    ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H
  ];
}

/**
 * Sutherland–Hodgman clip of a lat/lon ring against one horizontal edge.
 *
 * Clamping was tried first and produced a band across the top of the map:
 * rings crossing the crop edge got flattened onto it, and where two such
 * flattened sections failed to meet they left a full-width stripe that read as
 * a rendering fault. Clamping moves points; clipping inserts new vertices
 * exactly where the ring crosses the boundary, which is what actually closes
 * the shape along the edge.
 */
function clipLat(coords, bound, keepAbove) {
  const out = [];
  const inside = (p) => (keepAbove ? p[1] >= bound : p[1] <= bound);
  for (let i = 0; i < coords.length; i++) {
    const cur = coords[i];
    const prev = coords[(i + coords.length - 1) % coords.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn !== prevIn) {
      // Interpolate the crossing point along the segment.
      const t = (bound - prev[1]) / (cur[1] - prev[1]);
      out.push([prev[0] + (cur[0] - prev[0]) * t, bound]);
    }
    if (curIn) out.push(cur);
  }
  return out;
}

// Everything outside the window is clipped rather than squashed, so shapes
// inside keep their true proportions.
function inWindow(coords) {
  return coords.some(([, lat]) => lat <= LAT_MAX && lat >= LAT_MIN);
}

// Minimum distance between kept points, in projected units. Rounding alone
// only removed exact duplicates and left the path at 58KB; dropping points
// closer together than a pixel is real simplification and cuts it by ~4x with
// no visible difference at panel size.
const MIN_DIST = 2.5;

/**
 * Ring to SVG path, split at the antimeridian.
 *
 * THIS is what caused the stripe across the map, not the latitude crop.
 * Russia spans both sides of 180 degrees — Chukotka sits near +170 and the
 * easternmost islands wrap past -170. In an equirectangular projection those
 * neighbouring points land at opposite edges of the canvas, and the path
 * drawn between them is a straight line across the entire map.
 *
 * Clamping and clipping latitude could never fix it, because the problem was
 * longitude. A jump of more than 180 degrees between consecutive points means
 * the ring wrapped, so the path is broken there and resumed on the far side.
 */
function ring(coords) {
  const segments = [];
  let current = [];
  let lastLon = null;
  let lastPt = null;

  for (const c of coords) {
    if (lastLon !== null && Math.abs(c[0] - lastLon) > 180) {
      if (current.length >= 3) segments.push(current);
      current = [];
      lastPt = null;
    }
    lastLon = c[0];

    const p = project(c);
    if (lastPt) {
      const dx = p[0] - lastPt[0], dy = p[1] - lastPt[1];
      if (dx * dx + dy * dy < MIN_DIST * MIN_DIST) continue;
    }
    current.push(p);
    lastPt = p;
  }
  if (current.length >= 3) segments.push(current);

  let d = '';
  for (const seg of segments) {
    let sub = '';
    for (const [x, y] of seg) {
      sub += (sub ? 'L' : 'M') + x.toFixed(PRECISION) + ' ' + y.toFixed(PRECISION);
    }
    d += sub + 'Z';
  }
  return d;
}

let path = '';
let polygons = 0;

for (const feature of land.features) {
  const geom = feature.geometry;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    // Outer ring only. Holes are lakes; at this size they read as speckle.
    if (!inWindow(poly[0])) continue;
    let clipped = clipLat(poly[0], LAT_MAX, false);
    if (clipped.length < 3) continue;
    clipped = clipLat(clipped, LAT_MIN, true);
    if (clipped.length < 3) continue;
    const d = ring(clipped);
    if (d.length > 30) {      // skip slivers that render as a dot or less
      path += d;
      polygons++;
    }
  }
}

console.log('polygons kept:', polygons);
console.log('path length  :', path.length, 'chars');

fs.writeFileSync('/home/claude/mapgen/world-path.txt', path);
console.log('written');
