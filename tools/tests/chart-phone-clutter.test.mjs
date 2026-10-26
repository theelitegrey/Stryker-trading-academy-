// Phone chart clutter (2026-10-26): pure helpers + the Pine text-rect sink, in Node.
//   node tools/tests/chart-phone-clutter.test.mjs
import { slideLeft, layoutTags, mergeTags } from '../../assets/chart-gex-levels.js';
import { _patchScene, _patchRects } from '../../assets/chart-pine-tv-style.js';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

// slideLeft
const b = { x: 300, y: 100, w: 60, h: 16 };
ok(slideLeft(b, [], 50) === 300, 'nothing in the way: stays');
ok(slideLeft(b, [{ left: 320, right: 380, top: 104, bottom: 116 }], 50) === 320 - 3 - 60, 'slides left past one rect');
ok(slideLeft(b, [{ left: 320, right: 380, top: 104, bottom: 116 }, { left: 240, right: 262, top: 98, bottom: 110 }], 50) === 240 - 3 - 60, 'slides past a chain of rects');
ok(slideLeft(b, [{ left: 320, right: 380, top: 130, bottom: 140 }], 50) === 300, 'a rect on another row is ignored');
ok(slideLeft(b, [{ left: 60, right: 380, top: 104, bottom: 116 }], 50) === null, 'no room before minX: null');
// layoutTags still stacks
const g = layoutTags(mergeTags([{ y: 100, l: { id: 'a', text: 'A', price: 1 } }, { y: 104 + 10, l: { id: 'b', text: 'B', price: 2 } }]), 0, 500);
ok(g[1].yc - g[0].yc >= 17, 'layoutTags keeps 17 px between stacked tags');

// rect sink: patchScene + patchRects on fake prototypes
class Scene {
  constructor(){ this.set = { labels: [] }; this.deps = { theme: {}, barAt: () => null }; }
  logicalOf(xl, x){ return x; }
  labelFont(lb, f){ return f + 'px x'; }
  measure(ctx, font, t){ return t.length * 6; }
  drawBubble(ctx, lb, px, py){ return { x: px - 20, y: py - 10, w: 40, h: 20 }; }
  drawLabelShape(){} drawLabelText(){}
  drawLabels(){}
}
_patchScene(Scene.prototype);
class Slices {
  constructor(){ this.drawScene = new Scene(); }
  paintEntry(ctx, e){ this.drawScene.set = e.set; this.drawScene.drawLabels(ctx, 400, e.pane.bounds.height, (x) => x, (p) => p); }
  prepare(entries){ for (const e of entries) this.paintEntry(null, e); return new Map(); }
}
_patchRects(Slices.prototype);
const s = new Slices();
const plot = {}; s.__stkPlot = plot;
const lbl = (text, x, y, style) => ({ text, x, y, xloc: 'bar_index', yloc: 'price', style: style || 'label_left', size: 'small' });
s.prepare([
  { pane: { kind: 'price', bounds: { top: 0, height: 500 } }, set: { labels: [lbl('15m FVG', 300, 120), lbl('PDL', 200, 300, 'none')] } },
  { pane: { kind: 'osc', bounds: { top: 500, height: 100 } }, set: { labels: [lbl('RSI', 100, 50)] } }
]);
const R = plot.__stkPineRects || [];
ok(R.length === 2 && R.some((r) => r.text === '15m FVG') && R.some((r) => r.text === 'PDL'), 'price-pane text rects collected: ' + R.map((r) => r.text).join(','));
ok(!R.some((r) => r.text === 'RSI'), 'lower panes are not collected');
ok(s.drawScene.__stkRectSink === null, 'sink is cleared after paintEntry');
const s2 = new Slices(); s2.prepare([{ pane: { kind: 'price', bounds: { top: 0, height: 500 } }, set: { labels: [lbl('x', 1, 1)] } }]);
ok(true, 'no plot element: no throw');
console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
process.exit(fail ? 1 : 0);
