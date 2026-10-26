// TradeZoro — Backtest order lines + trade markers on OUR chart (ES module)
//
// A Vela renderer layer ("stk_bt_orders", above the candles), modelled on chart-paper.js but with NO
// account of its own: assets/replay.js keeps the simulator (replay-engine.js) and hands this layer
// the lines it wants drawn (entry / stop / target / pending orders / previews) and the trade markers.
//   - lines: { id, price, color, dash, label, kind, draggable, chip:{text,action}, axis }
//   - dragging a chip with draggable:true calls onDrag(line, price) once on release (price snapped to the tick)
//   - the chip's x calls onAction(line, 'close'|'cancel')
//   - markers: { t, price, side, kind:'entry'|'exit', color, label }
// Simulated only: nothing here talks to a broker.
// Education only. Not financial advice.

export const BT_LAYER = 'stk_bt_orders';

const CSS = `
.stkbt-ov{ position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:5; }
.stkbt-chip{ position:absolute; top:0; right:70px; height:22px; display:flex; align-items:stretch; pointer-events:auto; user-select:none; touch-action:none; font-size:11px; font-weight:600; border-radius:3px; overflow:hidden; background:var(--bg-2,#1c1f26); color:var(--ink-1,#e6e8ee); border:1px solid var(--c); box-shadow:0 1px 4px rgba(0,0,0,.35); }
.stkbt-chip[data-drag="1"]{ cursor:ns-resize; }
.stkbt-chip-a{ background:var(--c); color:#fff; padding:0 7px; white-space:nowrap; line-height:20px; }
.stkbt-chip-x{ border:0; border-left:1px solid var(--c); background:none; color:inherit; width:24px; padding:0; cursor:pointer; font-size:14px; line-height:20px; }
.stkbt-chip-x:hover{ background:var(--c); color:#fff; }
.stkbt-chip.dragging{ opacity:.85; }
:root[data-theme="light"] .stkbt-chip{ background:#fff; color:#131722; }
`;

export function installBtOrders(Core, hooks) {
  // hooks: { onDrag(line, price), onAction(line, act), tick() }
  if (!document.getElementById('stkbt-css')) { const st = document.createElement('style'); st.id = 'stkbt-css'; st.textContent = CSS; document.head.appendChild(st); }
  const state = { insts: new Set(), data: { lines: [], markers: [] }, drag: null };

  function factory() {
    let canvas = null, overlay = null, last = null;
    const inst = {
      get args() { return last; },
      mount(c) { canvas = c; overlay = document.createElement('div'); overlay.className = 'stkbt-ov'; (c.parentElement || c).appendChild(overlay); inst.overlay = overlay; state.insts.add(inst); },
      render(a) {
        if (!canvas) return; last = a;
        const co = a.coords, dpr = co.dpr || 1, W = co.width, fullW = canvas.width / dpr;
        const g = canvas.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const d = state.data; const top = a.bounds.top, bot = top + a.bounds.height;
        const ys = {};
        const drag = state.drag;
        g.save();
        if (hooks.bands) {   // NY / London session shading (up to the replay cursor only)
          for (const bd of hooks.bands()) { const x0 = Math.max(0, co.timeToX(bd.t0)), x1 = Math.min(W, co.timeToX(bd.t1)); if (!(x1 > x0)) continue; g.fillStyle = bd.color; g.fillRect(x0, top, x1 - x0, bot - top); }
        }
        for (const l0 of d.lines) {
          const l = drag && drag.id === l0.id ? Object.assign({}, l0, { price: drag.price }) : l0;
          const y = Math.round(co.priceToY(l.price, a.scale, a.bounds)) + 0.5; ys[l.id] = y;
          if (y < top || y > bot) continue;
          g.strokeStyle = l.color; g.lineWidth = 1; g.globalAlpha = l.kind === 'preview' ? 0.6 : 0.95;
          g.setLineDash(l.dash ? [6, 3] : []);
          g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
          if (l.axis !== false && fullW > W + 4) {
            g.globalAlpha = 1; g.fillStyle = l.color; g.fillRect(W, y - 9, fullW - W, 18);
            g.fillStyle = '#fff'; g.font = '11px -apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,sans-serif'; g.textBaseline = 'middle';
            g.fillText(hooks.fmt ? hooks.fmt(l.price) : String(l.price), W + 4, y);
          }
        }
        // trade markers (entry triangles, exit dots with the result)
        g.globalAlpha = 1; g.font = '600 10.5px -apple-system,BlinkMacSystemFont,Roboto,sans-serif'; g.textBaseline = 'middle';
        for (const m of d.markers) {
          const x = co.timeToX(m.t); if (!(x >= 0 && x <= W)) continue;
          const y = co.priceToY(m.price, a.scale, a.bounds); if (y < top || y > bot) continue;
          const up = m.side === 'buy'; const col = m.color || (up ? '#03c988' : '#e5484d');
          g.fillStyle = col;
          g.beginPath();
          if (m.kind === 'entry') { const s = 6; if (up) { g.moveTo(x, y); g.lineTo(x - s, y + s * 1.6); g.lineTo(x + s, y + s * 1.6); } else { g.moveTo(x, y); g.lineTo(x - s, y - s * 1.6); g.lineTo(x + s, y - s * 1.6); } g.closePath(); g.fill(); g.fillText(m.label || '', x + 8, y + (up ? 11 : -11)); }
          else { g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); g.fillText(m.label || '', x + 7, y - 9); }
        }
        g.restore();
        syncChips(inst, ys, a, W, fullW);
      },
      destroy() { state.insts.delete(inst); if (overlay) overlay.remove(); canvas = null; overlay = null; }
    };
    return inst;
  }

  function syncChips(inst, ys, a, W, fullW) {
    const ov = inst.overlay; if (!ov) return;
    const lines = state.data.lines.filter((l) => l.chip || l.draggable);
    const have = new Map([...ov.querySelectorAll('.stkbt-chip')].map((c) => [c.dataset.id, c]));
    const top = a.bounds.top, bot = top + a.bounds.height;
    const placed = [];
    for (const l of lines) {
      let chip = have.get(l.id);
      if (!chip) {
        chip = document.createElement('div'); chip.className = 'stkbt-chip'; chip.dataset.id = l.id;
        chip.innerHTML = '<span class="stkbt-chip-a"></span>';
        if (l.chip && l.chip.action) {
          const x = document.createElement('button'); x.type = 'button'; x.className = 'stkbt-chip-x'; x.textContent = '×'; x.setAttribute('aria-label', l.chip.action === 'close' ? 'Close position' : 'Cancel order'); x.title = x.getAttribute('aria-label');
          x.addEventListener('pointerdown', (e) => e.stopPropagation());
          x.addEventListener('click', (e) => { e.stopPropagation(); const cur = state.data.lines.find((z) => z.id === chip.dataset.id); if (cur) hooks.onAction(cur, cur.chip.action); });
          chip.appendChild(x);
        }
        chip.addEventListener('pointerdown', (e) => onDown(e, inst, chip));
        ov.appendChild(chip);
      }
      have.delete(l.id);
      chip.dataset.drag = l.draggable ? '1' : '';
      chip.style.setProperty('--c', l.color);
      const txt = (state.drag && state.drag.id === l.id && l.dragLabel) ? l.dragLabel(state.drag.price) : (l.chip ? l.chip.text : l.label);
      const A = chip.firstChild; if (A.textContent !== txt) A.textContent = txt;
      let y = ys[l.id];
      if (y == null) { chip.style.visibility = 'hidden'; continue; }
      let cy = y - 11, pin = '';
      if (y < top + 12) cy = top + 4; else if (y > bot - 12) cy = bot - 26;
      let right = Math.round(fullW - W + 8);
      const w = chip.offsetWidth;
      for (const p of placed) if (Math.abs(p.cy - cy) < 22 && right < p.right + p.w + 4) right = p.right + p.w + 4;
      if (right + w > fullW - 6) { right = Math.round(fullW - W + 8); cy += (y > (top + bot) / 2 ? -1 : 1) * 24; }
      placed.push({ cy, right, w });
      chip.style.visibility = '';
      chip.style.transform = 'translate3d(0,' + Math.round(cy) + 'px,0)';
      chip.style.right = right + 'px';
    }
    for (const [, c] of have) c.remove();
  }

  function onDown(e, inst, chip) {
    if (e.button != null && e.button !== 0) return;
    const l = state.data.lines.find((z) => z.id === chip.dataset.id); if (!l || !l.draggable) return;
    const a = inst.args; if (!a) return;
    e.preventDefault(); e.stopPropagation();
    const rect = inst.overlay.getBoundingClientRect();
    const y0 = e.clientY; let moved = false;
    try { chip.setPointerCapture(e.pointerId); } catch (e2) {}
    chip.classList.add('dragging');
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientY - y0) < 3) return; moved = true;
      const args = inst.args || a; const y = ev.clientY - rect.top;
      let price = args.coords.yToPrice(y, args.scale, args.bounds); const t = hooks.tick(); if (t) price = Math.round(price / t) * t;
      state.drag = { id: l.id, price }; requestRender();
    };
    const up = () => {
      chip.removeEventListener('pointermove', move); chip.removeEventListener('pointerup', up); chip.removeEventListener('pointercancel', up);
      chip.classList.remove('dragging');
      const d = state.drag; state.drag = null;
      if (moved && d) hooks.onDrag(l, d.price); else requestRender();
    };
    chip.addEventListener('pointermove', move); chip.addEventListener('pointerup', up); chip.addEventListener('pointercancel', up);
  }

  const cellsRef = { get: () => [] };
  function requestRender() { for (const f of renderers) try { f(); } catch (e) {} }
  const renderers = new Set();

  Core.registerRendererLayer({ id: BT_LAYER, placement: 'above-data', create: factory });

  return {
    // push the current lines + markers into every cell's layer
    set(cells, lines, markers) {
      state.data = { lines: lines || [], markers: markers || [] };
      renderers.clear();
      for (const cell of cells) {
        let R; try { R = cell.chart.renderer.renderer; } catch (e) { continue; }
        if (!R || !R.setNativeData) continue;
        try { R.setNativeData(BT_LAYER, { n: Date.now() }); } catch (e) {}
        renderers.add(() => R.setNativeData(BT_LAYER, { n: Date.now() }));
      }
    },
    state
  };
}
