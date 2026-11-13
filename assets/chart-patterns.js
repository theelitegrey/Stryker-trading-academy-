// TradeZoro — Charts: AUTO CHART PATTERNS (Owner order 2026-11-04, "Build everything"). One indicator, Free for every plan.
//   stk_patterns   Auto Chart Patterns   chart overlay: pivots (zigzag, pivot length setting) -> double top / bottom, head & shoulders (and inverse),
//                  ascending / descending / symmetrical triangles, rising / falling wedges, bull / bear flags, channels.
// Each pattern: outline lines, a small name label, a dotted neckline / breakout line, and (optional) a dotted measured-move target line.
// A pattern is "forming" until a bar closes through its neckline / trendline; then it is complete. Maths: assets/chart-patterns-data.js.
// Incremental (only new closed bars are read) and bounded (last N pivots). Words: "pattern", never "signal". Education only. Not financial advice.
import * as D from './chart-patterns-data.js?v=969';

export const PATTERN_TYPES = ['stk_patterns'];
const UP = '#03c988', DN = '#f23645', NEUTRAL = '#f5b301';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const light = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}

const SCHEMA = [
  { key: 'pivot', title: 'Pivot length (bars each side)', type: 'int', defval: 5, min: 2, max: 30, step: 1, tooltip: 'Bigger = fewer, larger patterns. Smaller = more, smaller ones.' },
  { key: 'forming', title: 'Show forming patterns', type: 'bool', defval: true },
  { key: 'targets', title: 'Show measured-move target line', type: 'bool', defval: false },
  { key: 'labels', title: 'Show pattern names', type: 'bool', defval: true },
  { key: 'maxShown', title: 'Show at most (newest)', type: 'int', defval: 6, min: 1, max: 20, step: 1 },
  { key: 'upColor', title: 'Rising-side colour', type: 'color', defval: UP },
  { key: 'downColor', title: 'Falling-side colour', type: 'color', defval: DN },
  { key: 'neutralColor', title: 'Neutral colour', type: 'color', defval: NEUTRAL }
].concat(D.PATTERNS.map((p) => ({ key: 'p_' + p.id, title: p.name, type: 'bool', defval: true })));
const defaults = () => Object.fromEntries(SCHEMA.map((i) => [i.key, i.defval]));

class PatternsNative {
  constructor() { this.inputs = defaults(); this.eng = null; this.on = false; this.off = false; this.tm = 0; this.sig = ''; this.ms = 0; this.n = 0; }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(defaults(), inputs); this.on = true; this.render(); }
  onBars() { this.later(); }
  onViewport() { this.push(); }
  setInputs(i) { this.inputs = Object.assign(defaults(), i); this.render(); }
  suspend() { this.on = false; this.push(); }
  resume() { this.on = true; this.render(); }
  stop() { this.off = true; this.on = false; clearTimeout(this.tm); this.push(); }
  later() { if (this.tm || this.off) return; this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 150); }   // at most ~6 passes a second
  push() { try { this.ctx.pushData({ owner: this, on: this.on && !this.off, type: 'stk_patterns', v: this.v || 0 }); } catch (e) {} }
  render() {
    if (!this.ctx || this.off) return;
    const t0 = performance.now();
    try {
      const I = this.inputs, bars = this.ctx.bars();
      const strength = clamp(Math.round(Number(I.pivot) || 5), 2, 30);
      if (!this.eng || this.eng.o.strength !== strength) this.eng = new D.PatternEngine({ strength });
      this.eng.update(bars.map ? bars : []);
      this.v = (this.v || 0) + 1; (window.__stkPatterns || (window.__stkPatterns = {})).owner = this;   // test hook
      this.ctx.setStatus('idle');
      this.ctx.emit({ series: [] });
      this.push();
    } finally {
      this.ms += performance.now() - t0; this.n++;
      (window.__stkPatterns || (window.__stkPatterns = {})).perf = { passes: this.n, avgMs: this.ms / this.n };
    }
  }
  // what the layer draws
  shapes() {
    const I = this.inputs, en = {};
    D.PATTERNS.forEach((p) => { en[p.id] = I['p_' + p.id] !== false; });
    return this.eng ? this.eng.view(en, I.forming !== false, clamp(Math.round(Number(I.maxShown) || 6), 1, 20)) : { done: [], forming: [] };
  }
}

// ---------------------------------------------------------------------------------------- canvas layer
function patternsLayer() {
  let canvas = null;
  const Y = (a, p) => a.coords.priceToY(p, a.scale, a.bounds);
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = canvas && canvas.getContext('2d');
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      const d = a.data;
      if (!d || !d.owner || !d.owner.on || d.off || !a.bars || a.bars.length < 2) return;
      const co = a.coords, dpr = co.dpr || 1, I = d.owner.inputs, phone = co.width < 520, day = light();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.save(); g.beginPath(); g.rect(0, a.bounds.top, co.width, a.bounds.height); g.clip();
      try {
        const vr = co.visibleLogicalRange(), i0 = Math.floor(vr.from) - 2, i1 = Math.ceil(vr.to) + 2, last = a.bars.length - 1;
        const V = d.owner.shapes(), list = V.done.map((x) => [x, false]).concat(V.forming.map((x) => [x, true]));
        const colorOf = (dir) => (dir > 0 ? I.upColor || UP : dir < 0 ? I.downColor || DN : I.neutralColor || NEUTRAL);
        g.font = '700 ' + (phone ? 9 : 10) + 'px ' + MONO; g.textBaseline = 'middle'; g.textAlign = 'left';
        const X = (i) => co.logicalToX(i);
        const placed = [];   // label boxes already drawn, so two names never sit on top of each other
        const seg = (i, p, j, q) => { g.moveTo(X(i), Y(a, p)); g.lineTo(X(j), Y(a, q)); };
        const dash = (on) => g.setLineDash(on ? [(phone ? 3 : 4), 4] : []);
        for (const [x, forming] of list) {
          const end = forming ? last : x.brk;
          if (end < i0 || x.start > i1) continue;
          const def = D.BY_ID[x.id], col = colorOf(forming ? def.dir : x.dir), al = forming ? 0.65 : 1, lw = phone ? 1.4 : 1.8;
          g.lineWidth = lw; g.strokeStyle = rgba(col, al); g.lineJoin = 'round';
          // outline
          g.beginPath(); dash(forming);
          if (x.kind === 'rev') { x.pts.forEach((q, k) => (k ? g.lineTo(X(q.i), Y(a, q.p)) : g.moveTo(X(q.i), Y(a, q.p)))); }
          else { const e = Math.min(end, forming ? x.end + (x.wait || 0) : end); seg(x.start, at(x.up, x.start), e, at(x.up, e)); seg(x.start, at(x.lo, x.start), e, at(x.lo, e)); if (x.pole) seg(x.pole.i, x.pole.p, x.pts[0].i, x.pts[0].p); }
          g.stroke();
          // dotted neckline / breakout line
          g.lineWidth = 1.2; g.setLineDash([1.5, 3.5]); g.lineCap = 'round'; g.strokeStyle = rgba(col, forming ? 0.55 : 0.9); g.beginPath();
          if (x.kind === 'rev') { const s0 = x.pts[0].i, e0 = forming ? Math.min(last, x.end + 12) : x.brk; seg(s0, at(x.neck, s0), e0, at(x.neck, e0)); }
          else if (!forming) { const l = x.level; seg(x.end, l, x.brk, l); }
          g.stroke();
          // measured-move target (completed only)
          if (!forming && I.targets === true && x.target != null && Y(a, x.target) > a.bounds.top + 4 && Y(a, x.target) < a.bounds.top + a.bounds.height - 4) {
            g.strokeStyle = rgba(col, 0.9); g.beginPath(); g.setLineDash([5, 4]);
            const e = Math.min(last, x.brk + Math.max(10, Math.round((x.end - x.start) * 0.5))), y = Y(a, x.target);
            g.moveTo(X(x.brk), y); g.lineTo(X(e), y); g.stroke();
            g.setLineDash([]); g.lineWidth = 1; g.beginPath(); g.moveTo(X(x.brk), Y(a, x.level)); g.lineTo(X(x.brk), y); g.stroke();
          }
          g.setLineDash([]); g.lineCap = 'butt';
          // label
          if (I.labels !== false) {
            const nm = (phone ? def.short || def.name : def.name) + (forming ? ' · forming' : '');
            const ap = x.kind === 'rev' ? x.pts.reduce((m, q) => (x.s > 0 ? (q.p > m.p ? q : m) : (q.p < m.p ? q : m))) : null;
            const lx = ap ? X(ap.i) : X((x.start + x.end) / 2), above = ap ? x.s > 0 : at(x.up, x.end) >= 0 && x.dir >= 0;
            let ly = ap ? Y(a, ap.p) + (x.s > 0 ? -12 : 12) : Y(a, above ? at(x.up, (x.start + x.end) / 2) : at(x.lo, (x.start + x.end) / 2)) + (above ? -12 : 12);
            const tw = g.measureText(nm).width + 10, bx = clamp(lx - tw / 2, 2, co.width - tw - 2);
            for (let tries = 0; tries < 4; tries++) { const hit = placed.some((r) => bx < r.x + r.w && bx + tw > r.x && Math.abs(ly - r.y) < 15); if (!hit) break; ly += ap && x.s < 0 ? 15 : -15; }
            if (placed.some((r) => bx < r.x + r.w && bx + tw > r.x && Math.abs(ly - r.y) < 15)) continue;   // still crowded: skip the name, keep the lines
            if (ly < a.bounds.top + 8 || ly > a.bounds.top + a.bounds.height - 8) continue;
            placed.push({ x: bx, w: tw, y: ly });
            g.fillStyle = day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.88)'; g.strokeStyle = rgba(col, 0.9); g.lineWidth = 1;
            g.beginPath(); (g.roundRect ? g.roundRect(bx, ly - 8, tw, 16, 4) : g.rect(bx, ly - 8, tw, 16)); g.fill(); g.stroke();
            g.fillStyle = day ? '#1e293b' : '#e6e8ee'; g.fillText(nm, bx + 5, ly + 0.5);
          }
        }
      } finally { g.restore(); }
    },
    destroy() { canvas = null; }
  };
}
const at = (l, i) => l.p + l.sl * (i - l.i);

// ---------------------------------------------------------------------------------------- install
export function installPatterns(Core, hooks, reg) {
  Core.registerRendererLayer({ id: 'stk_patterns', placement: 'above-data', create: patternsLayer });
  reg(Core, { type: 'stk_patterns', title: 'Auto Chart Patterns', shortTitle: 'Chart Patterns', paneHint: 'price', overlay: true, reactsToViewport: true, inputsSchema: () => SCHEMA, create: () => new PatternsNative() });
}
