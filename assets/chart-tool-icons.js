// TradeZoro — Charts: ONE shared icon set for every drawing tool (ES module, charts.html only)
// Owner order 2026-10-14: "Make the favourite bar same as tradingview ... icons are not like
// tradingview, example long/short icon is different". Every place a drawing tool shows an icon
// reads it from here, so a tool looks the same everywhere: the left drawing column and its
// flyouts, the phone drawings sheet, the object tree (all read the drawing-type registry, which
// installToolIcons() re-registers with these icons before the workspace is built), the floating
// favourites bar (assets/chart-fav-toolbar.js) and the column's own buttons
// (assets/chart-tv-toolbars.js, UI_ICONS).
//
// The icons are our own drawings in TradingView's visual language (inspired, not copied: no
// TradingView SVG files or paths are used): a 28x28 grid, 1px strokes on half-pixel lines so they
// stay crisp at 1x/2x/3x, and the small hollow anchor dots a tool shows on the chart. Lines that
// meet an anchor stop at its rim (clipped below), as on the chart itself.
//
// Long / Short Position (Owner named them): TradingView's split box. Long = green (target) zone on
// top, red (stop) zone below, entry line with its anchor on the left; Short = mirrored. The
// existing 'position' type (kept, so saved drawings and members' favourites keep their id) is the
// LONG tool now; 'shortposition' is new. Both are risk/reward MEASUREMENT drawings (no orders,
// no trading anywhere on the site). Colours: our mint #03c988 and loss red #f23645.
//
// Depends on: Vela core (passed in: registerDrawingType / getDrawingType / drawingTypes and
// PositionTool from its chunk). Nothing else.

const MINT = '#03c988';
const LOSS = '#f23645';
const AR = 2;        // anchor ring radius
const CLIP = 2.5;    // lines stop this far from an anchor centre (ring rim + half a stroke)

const r2 = (v) => Math.round(v * 100) / 100;

// ---- geometry helpers --------------------------------------------------------------------
function sample(fn, a, b, n){ const out = []; for (let i = 0; i <= n; i++) { const p = fn(a + (b - a) * i / n); out.push(p[0], p[1]); } return out; }
const ellipsePts = (cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, n = 48) => sample((t) => [cx + rx * Math.cos(t), cy + ry * Math.sin(t)], a0, a1, n);
const quadPts = (x0, y0, cx, cy, x1, y1, n = 24) => sample((t) => [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1], 0, 1, n);
const cubicPts = (x0, y0, c1x, c1y, c2x, c2y, x1, y1, n = 28) => sample((t) => { const u = 1 - t; return [u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1]; }, 0, 1, n);
const rectPts = (x1, y1, x2, y2) => [x1, y1, x2, y1, x2, y2, x1, y2, x1, y1];

// Parts of segment a->b outside every anchor circle, as [t0, t1] ranges.
function clipSeg(ax, ay, bx, by, anchors){
  let keep = [[0, 1]];
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  if (!L2) return [];
  for (const [cx, cy] of anchors) {
    const fx = ax - cx, fy = ay - cy;
    const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - CLIP * CLIP;
    const disc = B * B - 4 * L2 * C;
    if (disc <= 0) continue;
    const s = Math.sqrt(disc), t1 = (-B - s) / (2 * L2), t2 = (-B + s) / (2 * L2);
    const next = [];
    for (const [u, v] of keep) {
      if (t2 <= u || t1 >= v) { next.push([u, v]); continue; }
      if (t1 > u) next.push([u, t1]);
      if (t2 < v) next.push([t2, v]);
    }
    keep = next;
  }
  return keep.filter(([u, v]) => v - u > 1e-3);
}
// A polyline -> path data, clipped around anchors, consecutive pieces joined.
function polyD(pts, anchors){
  let d = '', pen = null;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    for (const [u, v] of clipSeg(ax, ay, bx, by, anchors)) {
      const x0 = r2(ax + (bx - ax) * u), y0 = r2(ay + (by - ay) * u), x1 = r2(ax + (bx - ax) * v), y1 = r2(ay + (by - ay) * v);
      if (!pen || pen[0] !== x0 || pen[1] !== y0) d += 'M' + x0 + ' ' + y0;
      d += 'L' + x1 + ' ' + y1;
      pen = [x1, y1];
    }
  }
  return d;
}

// spec: { l: [polyline...], d: [dashed polyline...], a: [[x,y]...], f: 'raw svg drawn first', raw: 'raw svg drawn last', fill: [[pts, colour, opacity]] }
function build(spec){
  const A = spec.a || [];
  let body = spec.f || '';
  for (const pts of spec.l || []) { const d = polyD(pts, A); if (d) body += '<path d="' + d + '"/>'; }
  for (const pts of spec.d || []) { const d = polyD(pts, A); if (d) body += '<path d="' + d + '" stroke-dasharray="2 2"/>'; }
  for (const [x, y] of A) body += '<circle cx="' + x + '" cy="' + y + '" r="' + AR + '"/>';
  body += spec.raw || '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}

// ---- the drawing-tool icons (keyed by Vela drawing type) ----------------------------------
const S = {};
// Lines
S.trendline = { l: [[5.5, 22.5, 22.5, 5.5]], a: [[5.5, 22.5], [22.5, 5.5]] };
S.ray = { l: [[5.5, 22.5, 25.5, 2.5]], a: [[5.5, 22.5], [14.5, 12.5]] };
S.extendedline = { l: [[2.5, 25.5, 25.5, 2.5]], a: [[9.5, 18.5], [18.5, 9.5]] };
S.infoline = { l: [[6.5, 23.5, 21.5, 11.5], [4.5, 4.5, 14.5, 4.5, 14.5, 9.5, 4.5, 9.5, 4.5, 4.5], [6.5, 7, 12.5, 7]], a: [[6.5, 23.5], [21.5, 11.5]] };
S.trendangle = { l: [[5.5, 21.5, 21.5, 7.5]], d: [[5.5, 21.5, 24.5, 21.5]], a: [[5.5, 21.5], [21.5, 7.5]], raw: '<path d="M14.5 21.5a9 9 0 0 0-2.3-5.9"/>' };
S.hline = { l: [[2.5, 14.5, 25.5, 14.5]], a: [[14.5, 14.5]] };
S.hray = { l: [[6.5, 14.5, 25.5, 14.5]], a: [[6.5, 14.5]] };
S.vline = { l: [[14.5, 2.5, 14.5, 25.5]], a: [[14.5, 14.5]] };
S.crossline = { l: [[2.5, 14.5, 25.5, 14.5], [14.5, 2.5, 14.5, 25.5]], a: [[14.5, 14.5]] };
// Channels
S.parallelchannel = { l: [[4.5, 15.5, 19.5, 5.5], [8.5, 22.5, 23.5, 12.5]], d: [[6.5, 19, 21.5, 9]], a: [[4.5, 15.5], [19.5, 5.5], [23.5, 12.5]] };
S.disjointchannel = { l: [[4.5, 11.5, 23.5, 4.5], [4.5, 17.5, 23.5, 23.5]], a: [[4.5, 11.5], [23.5, 4.5], [4.5, 17.5], [23.5, 23.5]] };
S.flattopbottom = { l: [[3.5, 6.5, 24.5, 6.5], [4.5, 22.5, 23.5, 13.5]], a: [[14.5, 6.5], [4.5, 22.5], [23.5, 13.5]] };
S.regressionchannel = { l: [[4.5, 17.5, 23.5, 10.5]], d: [[4.5, 11.5, 23.5, 4.5], [4.5, 23.5, 23.5, 16.5]], a: [[4.5, 17.5], [23.5, 10.5]] };
// Pitchforks: P0 handle, P1/P2 the fork; the median runs from the origin through mid(P1,P2).
function fork(o, p1, p2, k, extra){
  const m = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const dx = (m[0] - o[0]) * k, dy = (m[1] - o[1]) * k;
  const s = { l: [[o[0], o[1], m[0] + dx, m[1] + dy], [p1[0], p1[1], p1[0] + dx, p1[1] + dy], [p2[0], p2[1], p2[0] + dx, p2[1] + dy], [p1[0], p1[1], p2[0], p2[1]]], a: [o, p1, p2] };
  return Object.assign(s, extra || {});
}
S.pitchfork = fork([4.5, 22.5], [13.5, 8.5], [17.5, 19.5], 0.65);
S.schiffpitchfork = (() => { const s = fork([4.5, 15.5], [13.5, 8.5], [17.5, 19.5], 0.65); s.a = [[4.5, 22.5], [13.5, 8.5], [17.5, 19.5]]; s.d = [[4.5, 22.5, 4.5, 15.5]]; return s; })();
S.modifiedschiffpitchfork = (() => { const s = fork([9, 15.5], [13.5, 8.5], [17.5, 19.5], 0.75); s.a = [[4.5, 22.5], [13.5, 8.5], [17.5, 19.5]]; s.d = [[4.5, 22.5, 9, 15.5]]; return s; })();
S.insidepitchfork = { l: [[4.5, 22.5, 25, 10], [13.5, 8.5, 25, 6.5], [17.5, 19.5, 25, 13.5], [13.5, 8.5, 17.5, 19.5]], a: [[4.5, 22.5], [13.5, 8.5], [17.5, 19.5]] };
// Fibonacci
S.fibretracement = { l: [[3.5, 5.5, 24.5, 5.5], [3.5, 10.5, 24.5, 10.5], [3.5, 14.5, 24.5, 14.5], [3.5, 18.5, 24.5, 18.5], [3.5, 22.5, 24.5, 22.5]], d: [[6.5, 22.5, 21.5, 5.5]], a: [[6.5, 22.5], [21.5, 5.5]] };
S.fibextension = { l: [[3.5, 4.5, 24.5, 4.5], [3.5, 9.5, 24.5, 9.5], [3.5, 14.5, 24.5, 14.5], [3.5, 23.5, 24.5, 23.5]], d: [[6.5, 23.5, 19.5, 14.5]], a: [[6.5, 23.5], [19.5, 14.5]] };
S.fibextensiontrend = { l: [[15.5, 4.5, 25.5, 4.5], [15.5, 9.5, 25.5, 9.5], [15.5, 14.5, 25.5, 14.5], [15.5, 19.5, 25.5, 19.5]], d: [[3.5, 22.5, 8.5, 9.5, 12.5, 18.5]], a: [[3.5, 22.5], [8.5, 9.5], [12.5, 18.5]] };
S.fibfan = { l: [[4.5, 23.5, 24.5, 3.5], [4.5, 23.5, 24.5, 9.5], [4.5, 23.5, 24.5, 15.5], [4.5, 23.5, 10.5, 3.5], [4.5, 23.5, 16.5, 3.5]], a: [[4.5, 23.5], [19.5, 8.5]] };
S.fibtimezones = { l: [[3.5, 3.5, 3.5, 24.5], [6.5, 3.5, 6.5, 24.5], [9.5, 3.5, 9.5, 24.5], [13.5, 3.5, 13.5, 24.5], [18.5, 3.5, 18.5, 24.5], [24.5, 3.5, 24.5, 24.5]], a: [[3.5, 20.5], [6.5, 20.5]] };
S.fibchannel = { l: [[3.5, 13.5, 18.5, 3.5], [5.5, 19.5, 22.5, 8.2], [7.5, 23.5, 24.5, 12.2]], d: [[9.5, 25.5, 25.5, 14.8]], a: [[3.5, 13.5], [18.5, 3.5], [7.5, 23.5]] };
S.fibspeedfan = { l: [[4.5, 23.5, 24.5, 4.5], [4.5, 23.5, 24.5, 11.5], [4.5, 23.5, 24.5, 17.5], [4.5, 23.5, 11.5, 4.5], [4.5, 23.5, 17.5, 4.5]], d: [[4.5, 4.5, 24.5, 4.5, 24.5, 23.5]], a: [[4.5, 23.5], [24.5, 4.5]] };
S.trendfibtime = { l: [[14.5, 3.5, 14.5, 24.5], [18.5, 3.5, 18.5, 24.5], [24.5, 3.5, 24.5, 24.5]], d: [[3.5, 22.5, 7.5, 8.5, 11.5, 17.5]], a: [[3.5, 22.5], [7.5, 8.5], [11.5, 17.5]] };
S.fibcircles = { l: [ellipsePts(14, 14, 4, 4, 0, Math.PI * 2, 32), ellipsePts(14, 14, 7.5, 7.5, 0, Math.PI * 2, 48), ellipsePts(14, 14, 11, 11, 0, Math.PI * 2, 64)], a: [[14, 14]] };
S.fibarcs = { l: [[3.5, 23.5, 24.5, 23.5], ellipsePts(14, 23.5, 5, 5, Math.PI, Math.PI * 2, 24), ellipsePts(14, 23.5, 9, 9, Math.PI, Math.PI * 2, 36), ellipsePts(14, 23.5, 12.5, 12.5, Math.PI, Math.PI * 2, 48)], a: [[14, 23.5]] };
S.fibwedge = { l: [[4.5, 14, 24.5, 4.5], [4.5, 14, 24.5, 23.5], ellipsePts(4.5, 14, 9, 9, -0.44, 0.44, 12), ellipsePts(4.5, 14, 14.5, 14.5, -0.44, 0.44, 16), ellipsePts(4.5, 14, 19.8, 19.8, -0.44, 0.44, 20)], a: [[4.5, 14]] };
S.fibspiral = { l: [(() => { const pts = []; for (let i = 0; i <= 120; i++) { const t = i / 120 * 3.6 * Math.PI; const r = 1 + 11.5 * Math.pow(t / (3.6 * Math.PI), 1.5); pts.push(14.5 + r * Math.cos(t + 0.6), 14.5 - r * Math.sin(t + 0.6)); } return pts; })()], a: [[14.5, 14.5]] };
S.gannfan = { l: [[4.5, 23.5, 24.5, 3.5], [4.5, 23.5, 24.5, 13.5], [4.5, 23.5, 24.5, 18.5], [4.5, 23.5, 14.5, 3.5], [4.5, 23.5, 9.5, 3.5]], a: [[4.5, 23.5], [24.5, 3.5]] };
S.gannbox = { l: [rectPts(4.5, 4.5, 23.5, 23.5), [4.5, 23.5, 23.5, 4.5], [4.5, 4.5, 23.5, 23.5], [9.5, 4.5, 9.5, 23.5], [18.5, 4.5, 18.5, 23.5], [4.5, 9.5, 23.5, 9.5], [4.5, 18.5, 23.5, 18.5]], a: [[4.5, 23.5], [23.5, 4.5]] };
S.gannsquare = { l: [rectPts(4.5, 4.5, 23.5, 23.5), [4.5, 23.5, 23.5, 4.5], [4.5, 23.5, 14, 4.5], [4.5, 23.5, 23.5, 14], ellipsePts(4.5, 23.5, 10, 10, -Math.PI / 2, 0, 20)], a: [[4.5, 23.5], [23.5, 4.5]] };
// Geometry
S.dedekind = { l: [[3.5, 22.5, 14, 4.5, 24.5, 22.5, 3.5, 22.5], quadPts(3.5, 22.5, 14, 15, 24.5, 22.5), quadPts(14, 4.5, 11, 15, 14, 18.5), [9, 13, 14, 18.5, 19, 13]], a: [] };
function mach(n, golden){
  const s = { l: [[4.5, 14, 24.5, 4.5], [4.5, 14, 24.5, 23.5]], a: [[4.5, 14]] };
  const rs = n === 1 ? [13] : [8, 13.5, 19];
  rs.forEach((r) => s.l.push(ellipsePts(4.5, 14, r, r, -0.44, 0.44, 16)));
  if (golden) s.d = [[7, 14, 25.5, 14]];
  return s;
}
S.sonic = mach(1); S.supersonic = mach(3); S.goldensonic = mach(1, true); S.goldensupersonic = mach(3, true);
// Patterns (zigzags; the triangles of a harmonic pattern are lightly filled)
function zig(pts, dashed, tri){
  const a = []; for (let i = 0; i < pts.length; i += 2) a.push([pts[i], pts[i + 1]]);
  let f = '';
  (tri || []).forEach((t) => { f += '<path d="M' + t.map((p) => p.join(' ')).join('L') + 'Z" fill="currentColor" fill-opacity=".16" stroke="none"/>'; });
  return { l: [pts], d: dashed || [], a, f };
}
function harmonic(X, A, B, C, D){ return zig([...X, ...A, ...B, ...C, ...D], [[...X, ...B], [...B, ...D], [...X, ...D]], [[X, A, B], [B, C, D]]); }
S.xabcd = harmonic([3.5, 21.5], [8.5, 6.5], [13.5, 15.5], [18.5, 8.5], [24.5, 22.5]);
S.abcd = zig([4.5, 21.5, 10.5, 7.5, 16.5, 15.5, 23.5, 5.5], [[4.5, 21.5, 16.5, 15.5], [10.5, 7.5, 23.5, 5.5]]);
S.headshoulders = { l: [[2.5, 21.5, 6.5, 12.5, 9.5, 17.5, 14, 5.5, 18.5, 17.5, 21.5, 12.5, 25.5, 21.5]], d: [[5.5, 17.5, 22.5, 17.5]], a: [], raw: '<circle cx="14" cy="5.5" r="1.4" fill="currentColor" stroke="none"/>' };
S.elliottimpulse = { l: [[3.5, 23.5, 7.5, 15.5, 10.5, 19.5, 16.5, 7.5, 19.5, 12.5, 24.5, 4.5]], a: [[3.5, 23.5], [24.5, 4.5]], raw: '<g fill="currentColor" stroke="none"><circle cx="7.5" cy="15.5" r="1.2"/><circle cx="10.5" cy="19.5" r="1.2"/><circle cx="16.5" cy="7.5" r="1.2"/><circle cx="19.5" cy="12.5" r="1.2"/></g>' };
S.elliottcorrection = { l: [[4.5, 5.5, 11.5, 18.5, 16.5, 11.5, 23.5, 23.5]], a: [[4.5, 5.5], [23.5, 23.5]], raw: '<g fill="currentColor" stroke="none"><circle cx="11.5" cy="18.5" r="1.2"/><circle cx="16.5" cy="11.5" r="1.2"/></g>' };
S.gartley = harmonic([3.5, 22.5], [8.5, 5.5], [13.5, 15.5], [18.5, 9.5], [24.5, 19.5]);
S.bat = harmonic([3.5, 22.5], [8.5, 5.5], [13.5, 17.5], [18.5, 10.5], [24.5, 21.5]);
S.butterfly = harmonic([3.5, 18.5], [8.5, 5.5], [13.5, 14.5], [18.5, 8.5], [24.5, 24.5]);
S.crab = harmonic([3.5, 16.5], [7.5, 4.5], [12.5, 12.5], [17.5, 7.5], [24.5, 25.5]);
S.shark = harmonic([3.5, 20.5], [8.5, 9.5], [12.5, 16.5], [18.5, 4.5], [24.5, 22.5]);
S.cypher = harmonic([3.5, 22.5], [8.5, 9.5], [13.5, 15.5], [18.5, 4.5], [24.5, 18.5]);
// Measurements + volume
const posBox = (topC, topY0, midY, botY1) => {
  const botC = topC === MINT ? LOSS : MINT;
  return {
    f: '<rect x="10.5" y="' + topY0 + '" width="14" height="' + (midY - topY0) + '" fill="' + topC + '" fill-opacity=".28" stroke="' + topC + '"/>' +
       '<rect x="10.5" y="' + midY + '" width="14" height="' + (botY1 - midY) + '" fill="' + botC + '" fill-opacity=".28" stroke="' + botC + '"/>',
    l: [[5.5, midY, 24.5, midY]], a: [[5.5, midY]]
  };
};
S.position = posBox(MINT, 4.5, 15.5, 22.5);        // Long: target (green) on top, stop (red) below
S.shortposition = posBox(LOSS, 5.5, 12.5, 23.5);  // Short: stop (red) on top, target (green) below
S.datepricerange = { l: [rectPts(4.5, 4.5, 23.5, 23.5), [14, 8, 14, 20], [11.5, 10.5, 14, 8, 16.5, 10.5], [11.5, 17.5, 14, 20, 16.5, 17.5], [8, 14, 20, 14], [10.5, 11.5, 8, 14, 10.5, 16.5], [17.5, 11.5, 20, 14, 17.5, 16.5]], a: [[4.5, 23.5], [23.5, 4.5]] };
S.magnifier = { l: [ellipsePts(12, 12, 7.5, 7.5, 0, Math.PI * 2, 48), [17.5, 17.5, 23.5, 23.5], [9.5, 9, 9.5, 15], [12.5, 7.5, 12.5, 13.5], [15.5, 10, 15.5, 14]], a: [] };
S.anchoredvwap = { l: [cubicPts(6.5, 21.5, 11, 9, 16, 15, 25.5, 9.5)], d: [cubicPts(8.6, 17, 12, 6, 17, 10, 25.5, 5.5), cubicPts(9, 23.5, 13, 15.5, 18, 20, 25.5, 14.5)], a: [[6.5, 21.5]] };
S.fixedrangevp = { f: '<g fill="currentColor" stroke="none"><rect x="5" y="5" width="8" height="2" opacity=".55"/><rect x="5" y="9" width="12" height="2" opacity=".55"/><rect x="5" y="13" width="17" height="2"/><rect x="5" y="17" width="10" height="2" opacity=".55"/><rect x="5" y="21" width="6" height="2" opacity=".55"/></g>', l: [[3.5, 3.5, 3.5, 24.5]], d: [[24.5, 3.5, 24.5, 24.5]], a: [] };
// Shapes, brushes, arrows
S.box = { l: [rectPts(5.5, 7.5, 22.5, 20.5)], a: [[5.5, 7.5], [22.5, 20.5]] };
S.ellipse = { l: [ellipsePts(14, 14, 10, 6.5, 0, Math.PI * 2, 64)], a: [[4, 14], [24, 14]] };
S.triangle = { l: [[4.5, 22.5, 12.5, 5.5, 23.5, 19.5, 4.5, 22.5]], a: [[4.5, 22.5], [12.5, 5.5], [23.5, 19.5]] };
S.polyline = { l: [[3.5, 18.5, 9.5, 8.5, 15.5, 19.5, 20.5, 12.5, 24.5, 22.5]], a: [[3.5, 18.5], [9.5, 8.5], [15.5, 19.5], [20.5, 12.5], [24.5, 22.5]] };
S.freehand = { l: [cubicPts(3.5, 22.5, 7, 15, 10, 25, 13.5, 18), [14, 15, 22, 5.5, 24.5, 8, 16.5, 17.5], [14, 15, 12.5, 17, 13.5, 19, 16.5, 17.5]], a: [] };
S.highlighter = { f: '<path d="M3.5 22h13" stroke="currentColor" stroke-width="4" stroke-opacity=".3" stroke-linecap="butt"/>', l: [[12.5, 17.5, 21.5, 5, 25, 8, 16, 20.5, 12.5, 17.5], [12.5, 17.5, 11, 21.5, 16, 20.5]], a: [] };
S.circle = { l: [ellipsePts(14, 14, 10, 10, 0, Math.PI * 2, 64), [14, 14, 21.07, 6.93]], a: [[14, 14], [21.07, 6.93]] };
S.rotatedrect = { l: [[4.5, 15.5, 12.5, 4.5, 23.5, 12.5, 15.5, 23.5, 4.5, 15.5]], a: [[4.5, 15.5], [12.5, 4.5], [23.5, 12.5]] };
S.path = { l: [[4.5, 21.5, 10.5, 9.5, 17.5, 17.5, 23.5, 6.5], [19.5, 7.5, 23.5, 6.5, 23.8, 10.6]], a: [[4.5, 21.5], [10.5, 9.5], [17.5, 17.5]] };
S.arc = { l: [quadPts(4.5, 21.5, 14, 0, 23.5, 21.5, 32)], a: [[4.5, 21.5], [23.5, 21.5]], raw: '<circle cx="14" cy="10.75" r="1.2" fill="currentColor" stroke="none"/>' };
S.curve = { l: [cubicPts(4.5, 21.5, 7, 5, 21, 23, 23.5, 6.5)], d: [[4.5, 21.5, 7, 9], [23.5, 6.5, 21, 18.5]], a: [[4.5, 21.5], [23.5, 6.5]] };
S.arrow = { l: [[5.5, 22.5, 22.5, 5.5], [15.5, 6, 22.5, 5.5, 22, 12.5]], a: [[5.5, 22.5]] };
S.arrowmarkup = { l: [[14, 4.5, 22.5, 13.5, 17.5, 13.5, 17.5, 23.5, 10.5, 23.5, 10.5, 13.5, 5.5, 13.5, 14, 4.5]], a: [] };
S.arrowmarkdown = { l: [[14, 23.5, 22.5, 14.5, 17.5, 14.5, 17.5, 4.5, 10.5, 4.5, 10.5, 14.5, 5.5, 14.5, 14, 23.5]], a: [] };
S.flagmark = { l: [[7.5, 24.5, 7.5, 4.5], [7.5, 5.5, 22.5, 5.5, 19, 10, 22.5, 14.5, 7.5, 14.5]], a: [] };
S.iconstamp = { l: [ellipsePts(14, 14, 9.5, 9.5, 0, Math.PI * 2, 56), ellipsePts(14, 14.5, 5, 5, 0.35, Math.PI - 0.35, 18)], a: [], raw: '<g fill="currentColor" stroke="none"><circle cx="10.8" cy="11.5" r="1.2"/><circle cx="17.2" cy="11.5" r="1.2"/></g>' };
// Text + notes
S.text = { l: [[7.5, 8.5, 7.5, 5.5, 20.5, 5.5, 20.5, 8.5], [14, 5.5, 14, 22.5], [11, 22.5, 17, 22.5]], a: [] };
S.callout = { l: [[4.5, 4.5, 23.5, 4.5, 23.5, 16.5, 12.5, 16.5, 6.5, 22.5, 7.5, 16.5, 4.5, 16.5, 4.5, 4.5], [9.5, 8.5, 18.5, 8.5], [9.5, 12.5, 16, 12.5]], a: [] };
S.note = { l: [[6.5, 3.5, 17.5, 3.5, 22.5, 8.5, 22.5, 20.5, 6.5, 20.5, 6.5, 3.5], [17.5, 3.5, 17.5, 8.5, 22.5, 8.5], [9.5, 11.5, 19.5, 11.5], [9.5, 15.5, 17, 15.5], [14.5, 20.5, 14.5, 22]], a: [[14.5, 24]] };
S.pricenote = { l: [[4.5, 23.5, 12, 14.5], [12, 14.5, 12, 6.5, 24.5, 6.5, 24.5, 14.5, 12, 14.5], [15, 10.5, 21.5, 10.5]], a: [[4.5, 23.5]] };
S.comment = { l: [cubicPts(14, 21.5, 3, 22, 3, 5, 14, 5, 24), cubicPts(14, 5, 25, 5, 25, 21, 15, 21.5, 24), [15, 21.5, 9.5, 25, 10.5, 20.8]], a: [], raw: '<g fill="currentColor" stroke="none"><circle cx="9.5" cy="13.5" r="1.2"/><circle cx="14" cy="13.5" r="1.2"/><circle cx="18.5" cy="13.5" r="1.2"/></g>' };
S.pricelabel = { l: [[7.5, 14, 11.5, 8.5, 24.5, 8.5, 24.5, 19.5, 11.5, 19.5, 7.5, 14], [14.5, 14, 21.5, 14]], a: [[4.5, 14]], raw: '' };
S.signpost = { l: [[14.5, 13.5, 14.5, 23.5], [6.5, 4.5, 19.5, 4.5, 23.5, 9, 19.5, 13.5, 6.5, 13.5, 6.5, 4.5], [9.5, 9, 17, 9]], a: [[14.5, 23.5]] };
// pricelabel: line from the anchor to the tag tip
S.pricelabel.l.push([4.5, 14, 7.5, 14]);

// TradingView-style labels for our two position tools.
const LABELS = { position: 'Long Position', shortposition: 'Short Position' };

export const TOOL_ICONS = {};
for (const k of Object.keys(S)) TOOL_ICONS[k] = build(S[k]);

// ---- column / bar UI icons (same grid, same stroke) -----------------------------------------
const U = {
  cursor: { l: [[14, 3.5, 14, 11], [14, 17, 14, 24.5], [3.5, 14, 11, 14], [17, 14, 24.5, 14]], raw: '<circle cx="14" cy="14" r="1" fill="currentColor" stroke="none"/>' },
  measure: { l: [[3.5, 18.5, 18.5, 3.5, 24.5, 9.5, 9.5, 24.5, 3.5, 18.5], [8.5, 13.5, 11, 16], [11.5, 10.5, 13, 12], [14.5, 7.5, 17, 10], [17.5, 4.5, 19, 6]] },
  zoomIn: { l: [ellipsePts(12, 12, 7.5, 7.5, 0, Math.PI * 2, 48), [17.5, 17.5, 24, 24], [8.5, 12, 15.5, 12], [12, 8.5, 12, 15.5]] },
  zoomOut: { l: [ellipsePts(12, 12, 7.5, 7.5, 0, Math.PI * 2, 48), [17.5, 17.5, 24, 24], [8.5, 12, 15.5, 12]] },
  magnet: { l: [[7.5, 5.5, 7.5, 14, ...cubicPts(7.5, 14, 7.5, 23.5, 20.5, 23.5, 20.5, 14, 20).slice(2), 20.5, 5.5, 16.5, 5.5, 16.5, 14, ...cubicPts(16.5, 14, 16.5, 18.5, 11.5, 18.5, 11.5, 14, 12).slice(2), 11.5, 5.5, 7.5, 5.5], [7.5, 9.5, 11.5, 9.5], [16.5, 9.5, 20.5, 9.5]] },
  stay: { l: [[4.5, 23.5, 5.5, 18.5, 17.5, 6.5, 21.5, 10.5, 9.5, 22.5, 4.5, 23.5], [15, 9, 19, 13], rectPts(17.5, 19.5, 24.5, 24.5), [19, 19.5, 19, 17.5, ...ellipsePts(21, 17.5, 2, 2, Math.PI, Math.PI * 2, 10).slice(2), 23, 19.5]] },
  sync: { l: [[4.5, 23.5, 5.5, 18.5, 15.5, 8.5, 19.5, 12.5, 9.5, 22.5, 4.5, 23.5], ellipsePts(20, 8, 4.5, 4.5, Math.PI * 0.9, Math.PI * 2.3, 24), [24.6, 4.2, 23.3, 6.3, 25.8, 6.6]] },
  eraser: { l: [[3.5, 17.5, 15.5, 5.5, 23.5, 13.5, 13.5, 23.5, 9.5, 23.5, 3.5, 17.5], [9.5, 11.5, 17.5, 19.5], [13.5, 23.5, 24.5, 23.5]] },
  lock: { l: [rectPts(6.5, 12.5, 21.5, 23.5), [9.5, 12.5, 9.5, 9, ...ellipsePts(14, 9, 4.5, 4.5, Math.PI, Math.PI * 2, 20).slice(2), 18.5, 12.5], [14, 16.5, 14, 19.5]] },
  unlock: { l: [rectPts(6.5, 12.5, 21.5, 23.5), [9.5, 12.5, 9.5, 9, ...ellipsePts(14, 9, 4.5, 4.5, Math.PI, Math.PI * 1.9, 18).slice(2)], [14, 16.5, 14, 19.5]] },
  eye: { l: [[...quadPts(3.5, 14, 14, 3, 24.5, 14, 24), ...quadPts(24.5, 14, 14, 25, 3.5, 14, 24).slice(2)], ellipsePts(14, 14, 3.5, 3.5, 0, Math.PI * 2, 24)] },
  eyeOff: { l: [[...quadPts(3.5, 14, 14, 3, 24.5, 14, 24), ...quadPts(24.5, 14, 14, 25, 3.5, 14, 24).slice(2)], ellipsePts(14, 14, 3.5, 3.5, 0, Math.PI * 2, 24), [5.5, 22.5, 22.5, 5.5]] },
  trash: { l: [[5.5, 7.5, 22.5, 7.5], [11.5, 7.5, 11.5, 4.5, 16.5, 4.5, 16.5, 7.5], [7.5, 7.5, 8.5, 23.5, 19.5, 23.5, 20.5, 7.5], [12, 11.5, 12, 19.5], [16, 11.5, 16, 19.5]] },
  star: { l: [(() => { const p = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4.3 : 10; p.push(14 + r * Math.cos(a), 15 + r * Math.sin(a)); } return p; })()] },
  chevronsLeft: { l: [[15.5, 8.5, 10, 14, 15.5, 19.5], [21.5, 8.5, 16, 14, 21.5, 19.5]] }
};
export const UI_ICONS = {};
for (const k of Object.keys(U)) UI_ICONS[k] = build(Object.assign({ a: [] }, U[k]));

export function toolIcon(type){ return TOOL_ICONS[type] || ''; }
export function toolLabel(type, fallback){ return LABELS[type] || fallback || type; }
export const TOOL_TYPES_WITH_ICONS = Object.keys(TOOL_ICONS);

// ---- install: re-register every drawing type with its icon; Long / Short Position -----------
// Call BEFORE the workspace is built (it reads the registry once for its toolbar definition).
// `PositionTool` is Vela's class (chunk export). Returns the list of types left without an icon
// (should be empty; the browser test asserts it).
export function installToolIcons(Core, PositionTool){
  const missing = [];
  if (PositionTool) {
    // Long / Short: the second click sets the target's distance; the side is fixed by the tool
    // (TradingView behaviour). Placed drawings (3 anchors) are never touched, and the settings
    // "Direction" switch still works on a placed box.
    const forced = (type, dir) => class extends PositionTool {
      constructor(init){ super(init); this.type = type; }
      stkFix(){
        const e = this.anchors[0], t = this.anchors[1];
        if (!e || !t || this.anchors[2]) return;
        const want = dir === 'long' ? 1 : -1;
        if (Math.sign(t.price - e.price) === -want) t.price = 2 * e.price - t.price;
      }
      resolved(){ this.stkFix(); return super.resolved(); }
      onPlaced(proj){
        this.stkFix();
        super.onPlaced(proj);
        try { if (this.direction !== dir) this.direction = dir; } catch (err) {}
      }
    };
    const base = Core.getDrawingType('position');
    if (base) {
      const Long = forced('position', 'long'), Short = forced('shortposition', 'short');
      Core.registerDrawingType(Object.assign({}, base, { label: LABELS.position, icon: TOOL_ICONS.position, create: (init) => new Long(init) }));
      Core.registerDrawingType(Object.assign({}, base, { type: 'shortposition', label: LABELS.shortposition, icon: TOOL_ICONS.shortposition, create: (init) => new Short(init) }));
    }
  }
  for (const meta of Core.drawingTypes()) {
    const ic = TOOL_ICONS[meta.type];
    if (!ic) { missing.push(meta.type); continue; }
    if (meta.icon !== ic) Core.registerDrawingType(Object.assign({}, meta, { icon: ic }));
  }
  return missing;
}

// The workspace's toolbar layout is a fixed list inside Vela; put Short Position right after
// Long Position (Measurements group) in the definition the column and the phone sheet read.
export function addShortToToolbar(ws, Core){
  try {
    const def = ws.toolbarDef;
    const meta = Core.getDrawingType('shortposition');
    if (!def || !meta) return false;
    const tool = { type: 'shortposition', label: meta.label, icon: meta.icon };
    let done = false;
    for (const g of def.groups || []) {
      if (g.tools.some((t) => t.type === 'shortposition')) return true;
      const i = g.tools.findIndex((t) => t.type === 'position');
      if (i < 0) continue;
      g.tools.splice(i + 1, 0, tool);
      for (const s of g.sections || []) { const j = s.tools.findIndex((t) => t.type === 'position'); if (j >= 0 && s.tools !== g.tools) s.tools.splice(j + 1, 0, tool); }
      done = true;
    }
    if (done && ws.drawToolbar) ws.drawToolbar.setDefinition(def);
    return done;
  } catch (e) { console.warn('TradeZoro: short position tool', e); return false; }
}
