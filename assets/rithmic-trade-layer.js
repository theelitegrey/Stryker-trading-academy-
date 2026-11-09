// TradeZoro — chart line layer for admin Rithmic paper trading (ES module). Inert for everyone else.
// The Vela renderer builds its layer canvases at construction, so a layer must be registered before the first chart
// exists. This tiny file is that registration and NOTHING else: it draws the horizontal lines it is handed through
// R.setNativeData('stk_rtrade', { lines }) and exposes its overlay + coordinates. No order code, no Rithmic code:
// only assets/rithmic-trade.js (admins only, dynamic import) ever hands it lines. Members never get any.
export const RT_LAYER = 'stk_rtrade';
let done = false;
export function installRithmicTradeLayer(Core) {
  if (done || !Core || !Core.registerRendererLayer) return;
  done = true;
  try { Core.registerRendererLayer({ id: RT_LAYER, placement: 'above-data', create: layer }); } catch (e) { console.warn('TradeZoro: trade layer', e); }
}
function layer() {
  let canvas = null, overlay = null, last = null, ys = {};
  return {
    get overlay() { return overlay; }, get args() { return last; }, get ys() { return ys; },
    mount(c) { canvas = c; overlay = document.createElement('div'); overlay.className = 'stkrt-ov'; overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5'; (c.parentElement || c).appendChild(overlay); },
    render(a) {
      if (!canvas) return;
      last = a;
      const lines = (a.data && a.data.lines) || [];
      if (!lines.length && !Object.keys(ys).length) return;
      const co = a.coords, dpr = co.dpr || 1, W = co.width, g = canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const top = a.bounds.top, bot = top + a.bounds.height; ys = {};
      for (const l of lines) {
        const y = Math.round(co.priceToY(l.price, a.scale, a.bounds)) + 0.5; ys[l.id] = y;
        if (y < top || y > bot) continue;
        g.strokeStyle = l.color; g.lineWidth = 1; g.setLineDash(l.solid ? [] : [6, 3]);
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      }
      g.setLineDash([]);
      if (overlay) for (const chip of overlay.querySelectorAll('[data-rt]')) {
        const y = ys[chip.dataset.rt];
        if (y == null || y < top || y > bot) { chip.style.visibility = 'hidden'; continue; }
        chip.style.visibility = ''; chip.style.transform = 'translate3d(0,' + Math.round(y - 11) + 'px,0)';  // left edge of the plot: the trading panel covers the right side on desktop
      }
    },
    destroy() { if (overlay) overlay.remove(); canvas = null; overlay = null; }
  };
}
