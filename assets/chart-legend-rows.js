// Stryker Trading Academy — Charts: one legend-row path for every Stryker native indicator (ES module)
// Depends on: assets/vela-chart.js (wraps Core with legendCore() and hands the result to the
// installers that call registerNativeIndicator: chart-gex-levels.js; order-flow stays on raw Core);
// Vela 0.6.17's orchestrator (vendor, NOT edited): a native gets its legend row (title, eye,
// settings cog, move, remove ×) only when it calls ctx.emit(); hiding drops its scene model.
//
// WHY (Owner 2026-10-08: "gex indicator is applied yet not showing in this indicators area,
// should be showing below volume"): GEX Levels paints through its own renderer layer
// (ctx.pushData) and never called ctx.emit(), so Vela never mounted it: no legend row, so no
// eye / cog / ×. And a layer keeps painting its last pushed data after the eye hides it.
//
// WHAT legendCore() DOES, for every native registered through it (no special cases):
//   - start / resume: if the indicator emitted nothing itself, emit an empty model, which is
//     what Vela's own Volume does: the row appears (and re-appears after "show").
//   - the row is placed under the rows already there (Vela prepends natives above Volume).
//   - suspend (eye = hide): clear the layer's data and drop pushData until resume, so the
//     lines really go away; resume re-pushes (each indicator's own resume does that).
//   - optional descriptor.legendNote(data) -> short text shown after the title in the row
//     (GEX: "SPX 0DTE · updated 12 min ago"), updated whenever the indicator pushes data.
// Indicators that already emit can stay on raw Core and behave exactly as before.

const NOTE_CLS = 'stk-leg-note';

// Find the Vela legend row element for a wrapped native instance (any chart cell).
function rowFor(inst, wsGet) {
  let ws = null;
  try { ws = wsGet() || window.STRYKER_VELA; } catch (e) {}
  if (!ws) return null;
  let cells = [];
  try { cells = ws.context().cells; } catch (e) { return null; }
  for (const c of cells) {
    try {
      const o = c.chart.orchestrator;
      for (const rec of o.registry.all()) {
        if (rec.native && rec.native.instance === inst) {
          const row = o.renderer.inputsUI.rows.get(rec.id);
          return row ? row.el : null;
        }
      }
    } catch (e) {}
  }
  return null;
}

function paintNote(el, text) {
  if (!el) return false;
  let n = el.querySelector(':scope > .' + NOTE_CLS);
  if (!text) { if (n) n.remove(); return true; }
  if (!n) {
    n = document.createElement('span');
    n.className = NOTE_CLS;
    const title = el.firstElementChild;
    if (title && title.nextSibling) el.insertBefore(n, title.nextSibling); else el.appendChild(n);
  }
  if (n.textContent !== text) { n.textContent = text; n.title = text; }
  return true;
}

// Vela pins native rows to the TOP of the legend (prepend), so a newly added tool landed above
// Volume. TradingView (and what the Owner expects) lists a new indicator BELOW the existing
// rows: move the row to the end, before the fold button. Done once, when the row first exists.
function placeLast(el) {
  const box = el.parentElement;
  if (!box) return;
  const fold = box.querySelector(':scope > .vela-ind-fold');
  if (fold) box.insertBefore(el, fold); else box.appendChild(el);
}

class LegendNative {
  constructor(inner, desc, wsGet) {
    this.inner = inner; this.desc = desc; this.wsGet = wsGet;
    this.ctx = null; this.emitted = false; this.suspended = false; this.note = ''; this.lastData = null;
  }
  start(ctx, inputs) {
    this.ctx = ctx;
    const self = this;
    // Prototype-linked, so every other ctx field (symbol, bars(), data, setStatus) reads through.
    const wrapped = Object.create(ctx);
    wrapped.emit = (out) => { self.emitted = true; return ctx.emit(out); };
    wrapped.pushData = (data) => {
      self.lastData = data;
      if (self.suspended) return undefined;
      const r = ctx.pushData(data);
      self.updateNote(data);
      return r;
    };
    this.emitted = false;
    this.inner.start(wrapped, inputs);
    if (!this.emitted) { this.emitted = true; try { ctx.emit({}); } catch (e) {} }
    this.updateNote(this.lastData);
  }
  updateNote(data) {
    let t = '';
    if (typeof this.desc.legendNote === 'function') { try { t = String(this.desc.legendNote(data) || ''); } catch (e) {} }
    if (!t && this.placed && !this.note) return;
    this.note = t;
    const apply = (tries) => {
      const el = rowFor(this, this.wsGet);
      if (el && !this.placed) { this.placed = true; placeLast(el); }
      if (paintNote(el, this.note)) return;
      if (tries > 0) setTimeout(() => apply(tries - 1), 250);
    };
    apply(8);
  }
  onBars(...a) { return this.inner.onBars && this.inner.onBars(...a); }
  onViewport(...a) { return this.inner.onViewport && this.inner.onViewport(...a); }
  setInputs(...a) { return this.inner.setInputs && this.inner.setInputs(...a); }
  suspend() {
    this.suspended = true;
    try { this.inner.suspend && this.inner.suspend(); } catch (e) {}
    try { this.ctx && this.ctx.pushData(null); } catch (e) {}
  }
  resume() {
    this.suspended = false;
    this.emitted = false;
    try { this.inner.resume && this.inner.resume(); } catch (e) {}
    // Vela drops the visuals on hide and re-mounts on the next model: make sure one comes.
    if (!this.emitted) { this.emitted = true; try { this.ctx.emit({}); } catch (e) {} }
    if (this.lastData != null) { try { this.ctx.pushData(this.lastData); } catch (e) {} }
    this.updateNote(this.lastData);
  }
  stop() {
    try { this.inner.stop && this.inner.stop(); } catch (e) {}
    this.suspended = true;
    try { this.ctx && this.ctx.pushData(null); } catch (e) {}
  }
}

// Pure: the descriptor with create() wrapped (exported for tests).
export function withLegendRow(desc, wsGet) {
  if (!desc || typeof desc.create !== 'function' || desc.__stkLegend) return desc;
  const create = desc.create;
  return Object.assign({}, desc, { __stkLegend: true, create: (...a) => new LegendNative(create(...a), desc, wsGet || (() => null)) });
}

// Core with registerNativeIndicator routed through withLegendRow. Everything else unchanged.
export function legendCore(Core, wsGet) {
  const out = Object.assign({}, Core);
  out.registerNativeIndicator = (desc) => Core.registerNativeIndicator(withLegendRow(desc, wsGet));
  return out;
}
