// TradingView-style Pine drawing (assets/chart-pine-tv-style.js), Node unit test.
//   node tools/tests/chart-pine-tv-style.test.mjs
// Pure helpers + the prototype wraps on a fake DrawingSceneRenderer / IndicatorDrawingSlices that
// records every canvas call, so the painted sizes and the culling are asserted without a browser.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const M = await import(pathToFileURL(path.join(root, 'assets', 'chart-pine-tv-style.js')).href);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

// sizes
check(M.SHAPE_PX.tiny < M.SHAPE_PX.small && M.SHAPE_PX.small < M.SHAPE_PX.normal && M.SHAPE_PX.normal < M.SHAPE_PX.large && M.SHAPE_PX.large < M.SHAPE_PX.huge, 'shape sizes rise tiny < small < normal < large < huge');
check(M.textPx('auto') === 12 && M.textPx('small') === 11 && M.textPx('normal') === 13 && M.textPx(15) === 15 && M.textPx('bogus') === 13, 'TV text size map (auto 12, small 11, normal 13, numbers kept)');
// culling: three overlapping texts on neighbouring bars -> only the newest painted; a far one kept
const r = (x) => ({ rect: M.textRect(30, 1, 11, x, 100, 'center') });
const skip = M.cullOverlaps([r(100), r(108), r(116), r(300)]);
check(skip.has(0) && skip.has(1) && !skip.has(2) && !skip.has(3), 'cull: stacked labels skipped, newest + separate one kept ' + JSON.stringify([...skip]));
check(M.cullOverlaps([r(0), r(100), r(200)]).size === 0, 'cull: labels that do not touch are all kept');
check(M.isTextOnly({ text: 'a', style: 'label_center', noFill: true }) && !M.isTextOnly({ text: 'a', style: 'label_down' }) && !M.isTextOnly({ text: 'a', style: 'circle', noFill: true }) && M.isTextOnly({ text: 'a', style: 'none' }), 'text-only detection');
// box text placement
const p1 = M.boxTextPlace('left', 'top', 10, 20, 200, 100, 15);
const p2 = M.boxTextPlace('right', 'bottom', 10, 20, 200, 100, 15);
const p3 = M.boxTextPlace('center', 'center', 10, 20, 200, 100, 15);
check(p1.x === 14 && p1.y === 24 && p1.align === 'left', 'box text top-left inside with 4 px padding');
check(p2.x === 206 && p2.y === 101 && p2.align === 'right', 'box text bottom-right inside with 4 px padding');
check(p3.x === 110 && p3.y === 62.5 && p3.align === 'center', 'box text centred');

// fake renderer
function fakeCtx(){
  const calls = [];
  const ctx = new Proxy({ calls }, { get(t, k){ if (k in t) return t[k]; return (...a) => { calls.push([k, ...a]); return { width: 6 * String(a[0] || '').length }; }; }, set(t, k, v){ calls.push(['set:' + String(k), v]); t[k] = v; return true; } });
  ctx.measureText = (s) => ({ width: 6 * String(s).length });
  return ctx;
}
class Scene {
  constructor(set){ this.set = set; this.deps = { theme: { textColor: '#d1d4dc', fontFamily: 'sans-serif' }, barAt: () => ({ high: 110, low: 90 }) }; this.tipRegions = []; this.shapes = []; this.texts = []; this.bubbles = []; }
  logicalOf(x, v){ return v; }
  measure(ctx, font, t){ return 6 * t.length; }
  labelFont(lb, f){ return f + 'px sans-serif'; }
  drawLabels(){ throw new Error('original should not run'); }
  drawLabelShape(ctx, style, cx, cy, fontPx){ this.shapes.push({ style, r: Math.max(4, fontPx * 0.6), cy }); }
  drawLabelText(ctx, lb, cx, cy, f){ this.texts.push({ text: lb.text, f, cx, cy }); }
  drawBubble(ctx, lb, px, py, f){ this.bubbles.push({ f, text: lb.text, fill: !lb.noFill }); return { x: px, y: py, w: 10, h: 10 }; }
  drawBoxText(){ throw new Error('original should not run'); }
}
check(M._patchScene(Scene.prototype) === true && M._patchScene(Scene.prototype) === false, 'scene prototype patched once');
const mk = (i, size, extra) => Object.assign({ xloc: 'bar_index', x: i, y: 100, yloc: 'price', style: 'circle', size, color: '#00ffaa99' }, extra || {});
const labels = [mk(10, 'normal'), mk(20, 'large'), mk(30, 'huge')];
for (let i = 0; i < 6; i++) labels.push({ xloc: 'bar_index', x: 100 + i, y: 100, yloc: 'price', style: 'label_center', noFill: true, size: 'small', text: '1.' + i + 'K', textAlign: 'center', tooltip: 't' + i });
labels.push({ xloc: 'bar_index', x: 50, y: 100, yloc: 'price', style: 'label_down', size: 'normal', text: 'PDH', color: '#333' });
const sc = new Scene({ labels });
sc.drawLabels(fakeCtx(), 1000, 500, (l) => l * 4, (p) => p);
check(sc.shapes.map((s) => Math.round(s.r * 2)).join(',') === [M.SHAPE_PX.normal, M.SHAPE_PX.large, M.SHAPE_PX.huge].join(','), 'circle diameters normal/large/huge = ' + sc.shapes.map((s) => Math.round(s.r * 2)).join(','));
const painted = sc.bubbles.filter((b) => !b.fill).map((b) => b.text);
check(painted.length < 6 && painted.includes('1.5K'), 'stacked bubble texts culled, newest painted: ' + painted.join(' '));
check(sc.bubbles.filter((b) => !b.fill).every((b) => b.f === 11), 'size.small text at 11 px');
check(sc.tipRegions.filter((t) => /^t\d$/.test(t.text)).length === 6, 'every culled text keeps its tooltip region');
check(sc.bubbles.filter((b) => b.fill).length === 1 && sc.bubbles.find((b) => b.fill).f === 13, 'filled label bubble kept, size.normal 13 px');
// shapes with yloc abovebar sit above the bar high by half their size
const sc2 = new Scene({ labels: [mk(5, 'huge', { yloc: 'abovebar' })] });
sc2.drawLabels(fakeCtx(), 1000, 500, (l) => l, (p) => p);
check(sc2.shapes[0].cy === 110 - (M.SHAPE_PX.huge / 2 + 4), 'abovebar shape offset by half its size + 4 px');
// box text
const ctx = fakeCtx();
sc.drawBoxText(ctx, { text: 'FVG', textSize: 'auto', hAlign: 'left', vAlign: 'top', textColor: '#fff' }, 0, 0, 300, 200);
const ft = ctx.calls.find((c) => c[0] === 'fillText');
const font = ctx.calls.filter((c) => c[0] === 'set:font').pop();
check(ft && ft[2] === 4 && ft[3] === 4 && font && /^12px /.test(font[1]), 'box text: size.auto 12 px at top-left + 4 px inside the box');
check(!ctx.calls.some((c) => c[0] === 'fillRect'), 'box text has no background');

// bottom tables lifted above Fit price / Latest
class Slices { constructor(){ this.seen = []; } paintEntry(ctx, e){ this.seen.push({ tables: e.tables.map((t) => t.position), h: e.pane.bounds.height, labels: e.set.labels.length }); } }
M._patchSlices(Slices.prototype);
const s = new Slices();
s.paintEntry({}, { pane: { bounds: { top: 0, height: 600 } }, set: { labels: [1], lines: [], boxes: [], polylines: [], linefills: [] }, tables: [{ position: 'top_right' }, { position: 'bottom_right' }] });
check(s.seen.length === 2 && s.seen[0].tables.join() === 'top_right' && s.seen[0].h === 600 && s.seen[1].tables.join() === 'bottom_right' && s.seen[1].h === 600 - M.BOTTOM_TABLE_LIFT && s.seen[1].labels === 0, 'bottom table painted in a pane ' + M.BOTTOM_TABLE_LIFT + ' px shorter, drawings once ' + JSON.stringify(s.seen));
const s2 = new Slices();
s2.paintEntry({}, { pane: { bounds: { top: 400, height: 150 } }, set: { labels: [] }, tables: [{ position: 'bottom_right' }] });
check(s2.seen.length === 1 && s2.seen[0].h === 150, 'lower panes untouched');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
