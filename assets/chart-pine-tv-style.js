// TradeZoro — Charts: TradingView-style drawing for Pine indicators (ES module)
// Imported by assets/chart-pine.js (installTvStyle(chart) once per chart before a script runs).
// Owner 2026-10-22: "how indicator is shown on tradingview and same indicator being shown on our
// chart ... should match the styling of TV, same is for all indicators". Gap list:
// stryker-notes/reports/workers/t3-pine-tv-style.md.
//
// WHAT: Pine drawings (label.new, plotshape/plotchar, box text, tables) are painted by Vela's
// DrawingSceneRenderer and paintTable. Upstream ties a plotshape's size to its FONT size
// (radius = 0.6 x font: size.huge = 17 px), uses 10/12/14/18/28 px label text, auto-fits box text
// up to 48 px and paints every text label even when neighbours stack into an unreadable blob
// (Volume Bubbles' "1.1K / 1.78K / 2.47K"). This module changes HOW they are painted, following
// TradingView's documented Pine behaviour; it never changes what a script computes.
//   1. Shapes: fixed TV diameters per size.* (SHAPE_PX), constant at every zoom.
//   2. Text: one TV size map for labels and box text (TEXT_PX); size.auto = 12 px.
//   3. Text-only labels (no fill / style none) that would overlap an already painted text label
//      are skipped (newest bar wins), like TV not stacking them; their tooltips still work.
//   4. Box text sits INSIDE the box at text_halign / text_valign with 4 px padding, 12 px
//      default, no background, clipped to the box.
//   5. Tables anchored at the bottom of the price pane sit above the "Fit price / Latest"
//      buttons (assets/chart-settings.js) instead of under them.
//
// HOW: runtime wraps on the prototypes of the renderer objects reached from the chart
// (chart.renderer.renderer.indicatorSlices and its drawScene). No vendor file is edited, and
// the same classes/method names exist in Vela 0.6.17-s3 and 0.9.0-s1, so this works on both.
// A method that is missing (another Vela version) is simply left alone.
// The pure helpers are exported for tools/tests/chart-pine-tv-style.test.mjs.

export const SHAPE_PX = { tiny: 6, small: 10, normal: 14, auto: 10, large: 22, huge: 32 };
export const TEXT_PX = { tiny: 9, small: 11, normal: 13, auto: 12, large: 16, huge: 21 };
export const BOX_PAD = 4;
export const BOTTOM_TABLE_LIFT = 34;   // the Fit price / Latest row (chart-settings.js .stkc-fl, bottom 36 px incl. the time axis)

export function textPx(size){
  if (typeof size === 'number' && size > 0) return size;
  return TEXT_PX[size] || TEXT_PX.normal;
}
export function shapePx(size){ return SHAPE_PX[size] || SHAPE_PX.small; }
const POINT = new Set(['circle', 'square', 'diamond', 'flag', 'arrowup', 'arrowdown', 'triangleup', 'triangledown', 'cross', 'xcross']);
export const isPointShape = (s) => POINT.has(s);
// A label that is only text (nothing filled behind it).
export function isTextOnly(lb){
  if (!lb || !lb.text) return false;
  if (lb.style === 'none' || lb.style === 'text_outline') return true;
  return !!lb.noFill && !isPointShape(lb.style);
}
export function overlaps(a, b, gap = 1){
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}
// Rect of a text-only label centred at (cx, cy) (Vela draws label_center / none centred).
export function textRect(w, lines, fontPx, cx, cy, align){
  const h = fontPx * 1.25 * lines;
  const left = align === 'left' ? cx : align === 'right' ? cx - w : cx - w / 2;
  return { left, top: cy - h / 2, right: left + w, bottom: cy + h / 2 };
}
// Greedy collision culling. items: [{ rect }] in paint order; newest (last) wins. Returns a Set
// of indexes to skip.
export function cullOverlaps(items){
  const kept = [], skip = new Set();
  for (let i = items.length - 1; i >= 0; i--) {
    const r = items[i] && items[i].rect; if (!r) continue;
    if (kept.some((k) => overlaps(k, r))) { skip.add(i); continue; }
    kept.push(r);
  }
  return skip;
}
// Box text block origin inside a box (TV: text_halign / text_valign, small padding).
export function boxTextPlace(hAlign, vAlign, left, top, w, h, blockH){
  const x = hAlign === 'left' ? left + BOX_PAD : hAlign === 'right' ? left + w - BOX_PAD : left + w / 2;
  const y = vAlign === 'top' ? top + BOX_PAD : vAlign === 'bottom' ? top + h - BOX_PAD - blockH : top + (h - blockH) / 2;
  return { x, y, align: hAlign === 'left' || hAlign === 'right' ? hAlign : 'center' };
}

// ── renderer wraps ───────────────────────────────────────────────────────────
function patchScene(proto){
  if (!proto || proto.__stkTv || typeof proto.drawLabels !== 'function') return false;
  proto.__stkTv = true;
  const origLabels = proto.drawLabels;
  proto.drawLabels = function (ctx, W, H, xOf, yOf) {
    if (typeof this.drawBubble !== 'function' || typeof this.drawLabelShape !== 'function' || typeof this.drawLabelText !== 'function') return origLabels.apply(this, arguments);
    const theme = (this.deps && this.deps.theme) || {};
    const pos = [], cull = [];
    const labels = this.set.labels || [];
    for (let i = 0; i < labels.length; i++) {
      const lb = labels[i];
      const px = xOf(this.logicalOf(lb.xloc, lb.x));
      if (px < -50 || px > W + 50) { pos.push(null); cull.push(null); continue; }
      let py;
      if (lb.yloc === 'price') py = yOf(lb.y);
      else if (lb.yloc === 'top') py = 14;
      else if (lb.yloc === 'bottom') py = H - 14;
      else {
        const bar = this.deps.barAt(this.logicalOf(lb.xloc, lb.x));
        const base = bar ? yOf(lb.yloc === 'abovebar' ? bar.high : bar.low) : null;
        // TV puts an abovebar/belowbar shape a little off the bar, half its own size further out.
        const off = isPointShape(lb.style) ? shapePx(lb.size) / 2 + 4 : 14;
        py = base == null ? null : base + (lb.yloc === 'abovebar' ? -off : off);
      }
      if (py == null) { pos.push(null); cull.push(null); continue; }
      pos.push([px, py]);
      if (isTextOnly(lb)) {
        const f = textPx(lb.size), lines = lb.text.split('\n');
        const font = this.labelFont(lb, f);
        const w = Math.max(1, ...lines.map((l) => this.measure(ctx, font, l)));
        cull.push({ rect: textRect(w, lines.length, f, px, py, lb.textAlign) });
      } else cull.push(null);
    }
    const skip = cullOverlaps(cull);
    this.tipRegions = this.tipRegions || [];
    for (let i = 0; i < labels.length; i++) {
      const p = pos[i]; if (!p) continue;
      const lb = labels[i], [px, py] = p;
      const color = lb.color || theme.textColor;
      const f = textPx(lb.size);
      if (isPointShape(lb.style)) {
        const d = shapePx(lb.size);
        // drawLabelShape's radius is max(4, 0.6 x its size argument): pass d / 1.2 for radius d / 2.
        if (!lb.noFill) this.drawLabelShape(ctx, lb.style, px, py, d / 1.2, color);
        if (lb.text) {
          const n = lb.text.split('\n').length, half = f * 1.25 * n / 2;
          const dy = d / 2 + 2 + half;
          this.drawLabelText(ctx, lb, px, lb.yloc === 'belowbar' ? py + dy : lb.yloc === 'abovebar' ? py - dy : py + dy, f);
        }
        if (lb.tooltip) { const r = d / 2 + 3; this.tipRegions.push({ left: px - r, top: py - r, right: px + r, bottom: py + r, text: lb.tooltip }); }
        continue;
      }
      if (skip.has(i)) {   // stacked text: not painted, the tooltip stays reachable
        if (lb.tooltip && cull[i]) this.tipRegions.push(Object.assign({ text: lb.tooltip }, cull[i].rect));
        continue;
      }
      if (lb.style === 'none' || lb.style === 'text_outline') {
        this.drawLabelText(ctx, lb, px, py, f, lb.style === 'text_outline');
        if (lb.tooltip && cull[i]) this.tipRegions.push(Object.assign({ text: lb.tooltip }, cull[i].rect));
      } else {
        const r = this.drawBubble(ctx, lb, px, py, f, color);
        if (lb.tooltip && r) this.tipRegions.push({ left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h, text: lb.tooltip });
      }
    }
  };
  if (typeof proto.drawBoxText === 'function') {
    proto.drawBoxText = function (ctx, bx, left, top, w, h) {
      const theme = (this.deps && this.deps.theme) || {};
      const family = bx.fontFamily === 'monospace' ? 'monospace' : theme.fontFamily || 'sans-serif';
      const size = textPx(bx.textSize);
      const font = (bx.italic ? 'italic ' : '') + (bx.bold ? 'bold ' : '') + size + 'px ' + family;
      const lines = bx.wrap && typeof this.wrapText === 'function' ? this.wrapText(ctx, font, bx.text, Math.max(1, w - BOX_PAD * 2)) : String(bx.text).split('\n');
      const lineH = size * 1.3;
      const p = boxTextPlace(bx.hAlign, bx.vAlign, left, top, w, h, lineH * lines.length);
      ctx.save();
      ctx.beginPath(); ctx.rect(left, top, w, h); ctx.clip();
      ctx.font = font;
      ctx.fillStyle = bx.textColor || theme.textColor || '#d1d4dc';
      ctx.textAlign = p.align;
      ctx.textBaseline = 'top';
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], p.x, p.y + i * lineH);
      ctx.restore();
    };
  }
  return true;
}
function patchSlices(proto){
  if (!proto || proto.__stkTv || typeof proto.paintEntry !== 'function') return;
  proto.__stkTv = true;
  const orig = proto.paintEntry;
  proto.paintEntry = function (ctx, e, coords, dataW, theme) {
    const tables = (e && e.tables) || [];
    const low = tables.filter((t) => String(t.position || '').startsWith('bottom'));
    const h = e && e.pane && e.pane.bounds && e.pane.bounds.height;
    // only the top (price) pane, which holds the Fit price / Latest row, and only when it is tall enough
    if (!low.length || !(h > BOTTOM_TABLE_LIFT * 4) || !(e.pane.bounds.top < 2)) return orig.apply(this, arguments);
    orig.call(this, ctx, Object.assign({}, e, { tables: tables.filter((t) => low.indexOf(t) < 0) }), coords, dataW, theme);
    const empty = { lines: [], boxes: [], labels: [], polylines: [], linefills: [] };
    const pane = Object.assign({}, e.pane, { bounds: Object.assign({}, e.pane.bounds, { height: h - BOTTOM_TABLE_LIFT }) });
    return orig.call(this, ctx, Object.assign({}, e, { set: empty, tables: low, pane }), coords, dataW, theme);
  };
}
export function installTvStyle(chart){
  try {
    const R = chart && chart.renderer && chart.renderer.renderer;
    const sl = R && R.indicatorSlices;
    if (!sl) return false;
    patchSlices(Object.getPrototypeOf(sl));
    return sl.drawScene ? patchScene(Object.getPrototypeOf(sl.drawScene)) || !!Object.getPrototypeOf(sl.drawScene).__stkTv : false;
  } catch (e) { return false; }
}
// For Node tests: patch a bare prototype.
export const _patchScene = patchScene;
export const _patchSlices = patchSlices;
