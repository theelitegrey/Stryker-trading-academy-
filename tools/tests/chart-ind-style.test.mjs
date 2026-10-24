// Indicator Style tab: pure helpers (model restyle, fonts, timeframes, persistence sanitise).  node tools/tests/chart-ind-style.test.mjs
import assert from 'node:assert/strict';
import { applyStyle, catalog, groupOf, slugOf, styleColor, rewriteFont, shownOnTf, tfBand, sanitize, hasStyle, toHex } from '../../assets/chart-ind-style.js';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };

const model = () => ({
  title: 'Liquidity Master',
  series: [
    { id: 'i1:plot:basis#0', title: 'Basis', kind: 'line', style: { color: '#2962ff', width: 1, lineStyle: 'solid' }, points: [{ time: 1, value: 2 }, { time: 2, value: 3, color: '#ff0000' }] },
    { id: 'i1:candle:x#0', title: 'c', kind: 'candle', style: {}, points: [] }
  ],
  fills: [], backgrounds: [], priceLines: [{ id: 'i1:hline:zero#0', title: 'Zero', color: '#787b86', width: 1, lineStyle: 'dashed' }],
  labels: [{ id: 'i1:label:7#0', text: 'BOS', style: 'label_down', size: 'normal', color: '#089981', textColor: '#fff' }, { id: 'i1:label:buy#0', text: '', style: 'triangleup', size: 'small', yloc: 'belowbar', color: '#0f0' }],
  lines: [{ id: 'i1:line:3#0', color: '#f00', width: 1, style: 'solid', extend: 'none' }],
  boxes: [{ id: 'i1:box:9#0', bgColor: 'rgba(41,98,255,0.2)', borderColor: '#2962ff', borderWidth: 1, borderStyle: 'solid', extend: 'none', text: 'OB', textSize: 10 }],
  tables: [{ id: 'i1:table:1#0', position: 'top_right', bgColor: '#131722', cells: [[{ text: 'a', textColor: '#fff', textSize: 10 }]] }]
});

// identity when nothing is set
const m0 = model();
assert.equal(applyStyle(m0, null, '60'), m0);
assert.equal(applyStyle(m0, {}, '60'), m0);
assert.equal(applyStyle(m0, { el: { 's:Basis': {} } }, '60'), m0);
assert.equal(hasStyle({ el: { a: {} } }), false);
ok('no overrides: the very same model object is passed on (scripts look identical)');

// catalogue / grouping
assert.equal(slugOf('i1:label:7#0'), ''); assert.equal(slugOf('i1:label:buy#2'), 'buy'); assert.equal(slugOf('x:plot:a-b#1#0'), 'a-b');
const cat = catalog(model());
assert.deepEqual(cat.map((c) => c.key), ['s:Basis', 'label', 'l:buy', 'line', 'box', 'table', 'h:Zero']);
assert.equal(cat.find((c) => c.key === 'label').name, 'Labels');
assert.equal(groupOf('box', { id: 'i:box:12#0' }).name, 'Boxes');
ok('catalogue: groups by script titles, falls back to Labels / Lines / Boxes / Tables; candles are not listed');

// series
const s1 = applyStyle(m0, { el: { 's:Basis': { color: '#ff9800', opacity: 50, width: 4, lineStyle: 'dotted', kind: 'histogram', priceScale: false, statusLine: false } } }, '60');
const b = s1.series[0];
assert.equal(b.style.color, 'rgba(255,152,0,0.5)'); assert.equal(b.style.width, 4); assert.equal(b.style.lineStyle, 'dotted'); assert.equal(b.kind, 'histogram'); assert.equal(b.style.base, 0);
assert.equal(b.points[1].color, 'rgba(255,152,0,0.5)'); assert.equal(b.display.priceScale, false); assert.equal(b.display.legend, false); assert.equal(b.display.pane, true);
assert.equal(m0.series[0].style.color, '#2962ff'); assert.equal(m0.series[0].kind, 'line');
assert.equal(s1.series[1], m0.series[1]); assert.equal(s1.labels, m0.labels);
ok('plot: colour + opacity, width, dotted, plot type, price-scale label + status line off; raw model untouched');
assert.equal(applyStyle(m0, { el: { 's:Basis': { width: 99 } } }).series[0].style.width, 6);
assert.equal(applyStyle(m0, { el: { 's:Basis': { visible: false } } }).series[0].display.pane, false);
ok('width clamps to 1-6; visible off hides the plot');

// labels / shapes
const s2 = applyStyle(m0, { el: { label: { fontPx: 18, bold: true, italic: true, font: 'mono', textColor: '#ffeb3b', place: 'below' }, 'l:buy': { shape: 'diamond', size: 'huge', place: 'above' } } });
assert.equal(s2.labels[0].__stkPx, 18); assert.equal(s2.labels[0].bold, true); assert.equal(s2.labels[0].italic, true); assert.equal(s2.labels[0].fontFamily, 'monospace');
assert.equal(s2.labels[0].style, 'label_up'); assert.equal(s2.labels[0].textColor, 'rgba(255,235,59,1)');
assert.equal(s2.labels[1].style, 'diamond'); assert.equal(s2.labels[1].size, 'huge'); assert.equal(s2.labels[1].yloc, 'abovebar');
ok('labels: text size / bold / italic / mono / colour / placement; markers: shape + size + above/below');

// boxes, lines, tables, hlines
const s3 = applyStyle(m0, { el: { box: { color: '#4caf50', opacity: 30, borderWidth: 3, lineStyle: 'dashed', extendRight: true, fontPx: 14, bold: true }, line: { width: 3, lineStyle: 'dashed', extendRight: true }, table: { position: 'bottom_left', fontPx: 16, italic: true, cellColor: '#000000' }, 'h:Zero': { width: 2, lineStyle: 'solid', color: '#ffffff' } } });
assert.equal(s3.boxes[0].bgColor, 'rgba(76,175,80,0.3)'); assert.equal(s3.boxes[0].borderWidth, 3); assert.equal(s3.boxes[0].borderStyle, 'dashed'); assert.equal(s3.boxes[0].extend, 'right'); assert.equal(s3.boxes[0].__stkPx, 14); assert.equal(s3.boxes[0].textSize, 10); assert.equal(s3.boxes[0].bold, true);
assert.equal(s3.lines[0].width, 3); assert.equal(s3.lines[0].style, 'dashed'); assert.equal(s3.lines[0].extend, 'right');
assert.equal(s3.tables[0].position, 'bottom_left'); assert.equal(s3.tables[0].cells[0][0].textSize, 16); assert.equal(s3.tables[0].cells[0][0].italic, true); assert.equal(s3.tables[0].cells[0][0].bgColor, 'rgba(0,0,0,1)');
assert.equal(s3.priceLines[0].width, 2); assert.equal(s3.priceLines[0].lineStyle, 'solid'); assert.equal(s3.priceLines[0].color, 'rgba(255,255,255,1)');
assert.equal(applyStyle(m0, { el: { box: { border: false } } }).boxes[0].borderWidth, 0);
assert.equal(applyStyle(m0, { el: { line: { visible: false } } }).lines.length, 0);
ok('boxes (fill, border, style, extend, text), lines, tables (position, text, cells), hlines; group visible off removes them');

// colours
assert.equal(styleColor('#2962ff', null, 25), 'rgba(41,98,255,0.25)');
assert.equal(styleColor('rgba(41,98,255,0.2)', '#ff0000', null), 'rgba(255,0,0,0.2)');
assert.equal(styleColor('#abc', null, null), '#abc'); assert.equal(toHex('rgba(255, 0, 16, .5)'), '#ff0010');
ok('colour helpers: opacity only keeps the hue, colour only keeps the alpha');

// fonts on canvas layers
assert.equal(rewriteFont('600 10px MONO', { fontPx: 16 }), '600 16px MONO');
assert.equal(rewriteFont('600 10px MONO', { bold: true, italic: true }), 'italic bold 10px MONO');
assert.equal(rewriteFont('bold 11px Inter, sans-serif', { bold: false, font: 'mono' }), '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
assert.equal(rewriteFont('10px sans-serif', null), '10px sans-serif');
ok('canvas font rewrite: size, bold, italic, family');

// timeframes
assert.deepEqual(tfBand('1'), { band: 'm', n: 1 }); assert.deepEqual(tfBand('240'), { band: 'h', n: 4 }); assert.deepEqual(tfBand('1D'), { band: 'D', n: 1 }); assert.deepEqual(tfBand('5S'), { band: 's', n: 5 }); assert.deepEqual(tfBand('1M'), { band: 'M', n: 1 });
const vis = { tf: { on: true, bands: { m: [1, 15], h: { off: true } } } };
assert.equal(shownOnTf(vis, '5'), true); assert.equal(shownOnTf(vis, '30'), false); assert.equal(shownOnTf(vis, '60'), false); assert.equal(shownOnTf(vis, '1D'), true);
assert.equal(shownOnTf({ tf: { on: false, bands: { m: { off: true } } } }, '5'), true);
const hid = applyStyle(m0, vis, '60');
assert.equal(hid.series[0].display.pane, false); assert.equal(hid.labels.length, 0); assert.equal(hid.boxes.length, 0);
assert.equal(applyStyle(m0, vis, '5'), m0);
ok('Visibility: per timeframe band and range; hidden = nothing drawn; shown with no other edits = same model');

// sanitise (persistence)
assert.equal(sanitize(null), null); assert.equal(sanitize({ el: { a: {} } }), null);
const sz = sanitize({ el: { 's:A': { width: 3, evil: { x: 1 }, f: () => 1 } }, z: 'back', junk: 1, tf: { on: 1, bands: { m: [1, 5], q: [1, 2] } } });
assert.deepEqual(sz, { el: { 's:A': { width: 3 } }, z: 'back', tf: { on: true, bands: { m: [1, 5] } } });
ok('persisted payload is sanitised: primitives only, known keys only');

console.log(n + ' passed');
