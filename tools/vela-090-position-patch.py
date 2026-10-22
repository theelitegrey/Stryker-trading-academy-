#!/usr/bin/env python3
"""TradingView-style Long/Short Position tool on Vela 0.9.0 (run after vela-090-handles-patch.py).

  python3 tools/vela-090-position-patch.py assets/vendor/vela-0.9.0-sN

Owner target 2026-10-22 18:30 (tv-ref-rr-box-1022.png):
1. Teal profit zone (#089981) and red stop zone (#f23645), solid ~20% fills, NO zone borders;
   a thin grey entry line across the width.
2. Progress shading: from the entry bar to the bar where the target/stop was hit (or the latest
   bar while open), the used part is drawn darker.
3. A dashed path line from the entry to that hit point (or the latest close).
4. TradingView labels (rounded, zone-coloured, white 12px) above the target, at the entry and
   below the stop, shown on hover/selection. Ticks + amounts use the paper-trading instrument
   spec (window.PaperEngine.specOf) for the active chart's symbol when known.
5. Handles: entry, stop and target on the left edge, the width on the right edge.
6. Settings window: Inputs tab (account, risk, size, direction, entry/stop/target in price,
   points or ticks) + Style tab (zone colours, line, labels, compact stats).
7. Default width ~25 bars.
Every edit is staged in memory; nothing is written unless every anchor matches exactly once.
"""
import sys, os

D = sys.argv[1]
BUF = {}
n_edits = 0


def edit(fname, old, new, count=1):
    global n_edits
    if fname not in BUF:
        BUF[fname] = open(os.path.join(D, fname), encoding='utf-8').read()
    n = BUF[fname].count(old)
    if n != count:
        sys.exit(f'{fname}: anchor found {n}x (want {count}): {old[:90]!r} (nothing written)')
    BUF[fname] = BUF[fname].replace(old, new)
    n_edits += 1


C = 'chunk-XIRSR3D6.js'
Y = 'chunk-YRCL3WMD.js'

# ================= model (chunk-YRCL3WMD) =================
# colours + width + spec hook
edit(Y, '''_PositionTool.DEFAULT_PROFIT_COLOR = VALID;
_PositionTool.DEFAULT_LOSS_COLOR = INVALID;''', '''// TradeZoro patch (position): TradingView colours, ~25 bars wide by default.
_PositionTool.DEFAULT_PROFIT_COLOR = "#089981";
_PositionTool.DEFAULT_LOSS_COLOR = "#f23645";
_PositionTool.STK_DEFAULT_BARS = 25;
/** The paper-trading instrument spec (tick, point value, qty step) for the active chart's symbol,
 *  or null when unknown (then ticks are hidden and amounts use 1 per point). */
_PositionTool.stkSpec = () => {
  try {
    const ws = globalThis.STRYKER_VELA;
    const PE = globalThis.PaperEngine;
    if (!ws || !PE || typeof PE.specOf !== "function") return null;
    const cell = ws.cell(ws.active.id);
    const sym = cell && (cell.symbol || cell.chart && cell.chart.symbol);
    if (!sym) return null;
    const sp = PE.specOf(String(sym));
    return sp && sp.ok ? sp : null;
  } catch (e) {
    return null;
  }
};''')
# old saved drawings carried the 0.6/0.9 neon defaults: show them in TV colours
edit(Y, '''    if (typeof props.lossColor === "string") this.lossColor = props.lossColor;
  }''', '''    if (typeof props.lossColor === "string") this.lossColor = props.lossColor;
    // TradeZoro patch (position): the old default greens/reds become TradingView's teal/red.
    if (/^#(0ecb81|26a69a|22c55e|089981)$/i.test(this.profitColor || "")) this.profitColor = _PositionTool.DEFAULT_PROFIT_COLOR;
    if (/^#(f6465d|ef5350|ef4444|f23645)$/i.test(this.lossColor || "")) this.lossColor = _PositionTool.DEFAULT_LOSS_COLOR;
  }''')
# default width in bars (a drag wider than that is kept)
edit(Y, '''      endPx = ex + Math.max(Math.abs(proj.xOf(t.time) - ex), _PositionTool.MIN_WIDTH_PX);
    } else {
      targetPx = ey - _PositionTool.DEFAULT_RISK_PX * _PositionTool.DEFAULT_RR;
      endPx = ex + _PositionTool.DEFAULT_WIDTH_PX;
    }''', '''      endPx = ex + Math.max(Math.abs(proj.xOf(t.time) - ex), _PositionTool.MIN_WIDTH_PX, this.stkBarsPx(proj, e, ex, ey));
    } else {
      targetPx = ey - _PositionTool.DEFAULT_RISK_PX * _PositionTool.DEFAULT_RR;
      endPx = ex + this.stkBarsPx(proj, e, ex, ey);
    }''')
# ticks unit + handles + drag
edit(Y, '''    const price = level === "stop" ? p.stop : p.target;
    if (mode === "price") return roundFloat(price);
    return roundFloat(Math.abs(price - p.entry));
  }''', '''    const price = level === "stop" ? p.stop : p.target;
    if (mode === "price") return roundFloat(price);
    if (mode === "ticks") {
      const sp = _PositionTool.stkSpec();
      return sp && sp.tick > 0 ? Math.round(Math.abs(price - p.entry) / sp.tick) : roundFloat(Math.abs(price - p.entry));
    }
    return roundFloat(Math.abs(price - p.entry));
  }
  /** TradeZoro patch (position): pixels for the default width (STK_DEFAULT_BARS bars). */
  stkBarsPx(proj, e, ex, ey) {
    let px = _PositionTool.DEFAULT_WIDTH_PX;
    try {
      const probe = proj.pxToPoint(ex + 200, ey, this.paneId).time;
      const n = proj.barsBetween(e.time, probe);
      if (Number.isFinite(n) && n > 0) px = 200 / n * _PositionTool.STK_DEFAULT_BARS;
    } catch (err) {
    }
    return Math.max(_PositionTool.MIN_WIDTH_PX, Math.min(px, (proj.width || 1e4) * 0.6));
  }''')
edit(Y, '''    if (!p || mode === "price") return value;
    const current = level === "stop" ? p.stop : p.target;''', '''    if (!p || mode === "price") return value;
    if (mode === "ticks") {
      const sp = _PositionTool.stkSpec();
      if (sp && sp.tick > 0) value = Math.abs(value) * sp.tick;
    }
    const current = level === "stop" ? p.stop : p.target;''')
edit(Y, '''  handlePoints(proj) {
    const r = this.resolved();
    if (!r) return [];
    const pts = [];
    for (const a of r) {
      const y = proj.yOf(a.price, this.paneId);
      if (y == null) return [];
      pts.push([proj.xOf(a.time), y]);
    }
    return pts;
  }''', '''  handlePoints(proj) {
    const r = this.resolved();
    if (!r) return [];
    const pts = [];
    for (const a of r) {
      const y = proj.yOf(a.price, this.paneId);
      if (y == null) return [];
      pts.push([proj.xOf(a.time), y]);
    }
    if (!this.anchors[2]) return pts;
    // TradeZoro patch (position): TradingView handles. 0 = entry, 1 = stop, 2 = target (left
    // edge, round), 3 = the right edge at the entry (square, sets the width).
    const xs = pts.map((p) => p[0]);
    const x1 = Math.min(...xs);
    const x2 = Math.max(...xs);
    return [[x1, pts[0][1]], [x1, pts[1][1]], [x1, pts[2][1]], [x2, pts[0][1], "sq"]];
  }
  stkDragHandle(i, pt, orig) {
    const e = this.anchors[0], s = this.anchors[1], t = this.anchors[2];
    if (!t || !orig || orig.length < 3) {
      const a = this.anchors[i];
      if (a) { a.time = pt.time; a.price = pt.price; }
      return;
    }
    [e, s, t].forEach((a, k) => { a.time = orig[k].time; a.price = orig[k].price; });
    if (i === 0) {
      e.price = pt.price;
      if (pt.time < s.time) e.time = pt.time;
    } else if (i === 1) s.price = pt.price;
    else if (i === 2) t.price = pt.price;
    else if (i === 3) {
      if (pt.time > e.time) { s.time = pt.time; t.time = pt.time; }
    }
    if (i <= 2) this.constrainHandleDrag(i);
  }
  stkHandleCursor(i) {
    return i === 0 ? "move" : i === 3 ? "ew-resize" : "ns-resize";
  }''')
edit(Y, '''  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid" },
  create: (init) => new PositionTool(init)''', '''  // TradeZoro patch (position): TradingView's grey entry line.
  defaultStyle: { lineColor: "#787b86", lineWidth: 1, lineStyle: "solid" },
  create: (init) => new PositionTool(init)''')

# ================= painter + settings (chunk-XIRSR3D6) =================
edit(C, '''  { value: "points", label: msg("drawing.position.unit.points", "Points") }
];''', '''  { value: "points", label: msg("drawing.position.unit.points", "Points") },
  // TradeZoro patch (position): ticks, from the instrument's tick size.
  { value: "ticks", label: "Ticks" }
];''')

edit(C, '''  paintPosition(ctx, d, proj, theme) {
    const L = d.layout(proj);
    if (!L) return;
    const { x1, x2, ey, sy, ty } = L;
    const w = x2 - x1;
    const zone = (yA, yB, color) => {
      ctx.save();
      ctx.globalAlpha = 0.13 * ctx.globalAlpha;
      ctx.fillStyle = color;
      ctx.fillRect(x1, Math.min(yA, yB), w, Math.abs(yB - yA));
      ctx.restore();
    };
    zone(ey, ty, d.profitColor);
    zone(ey, sy, d.lossColor);
    const line = (y, color) => this.stroke(ctx, { ...d.style, lineColor: color }, () => {
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
    });
    line(ty, d.profitColor);
    line(sy, d.lossColor);
    line(ey, d.style.lineColor);
    if (!d.showText) return;''', '''  // TradeZoro patch (position): TradingView's position tool. Solid zones without borders, the
  // used part darker, a dashed path from the entry to the exit (or the last close), a grey entry
  // line, and the three TradingView labels on hover / selection.
  paintPosition(ctx, d, proj, theme) {
    const L = d.layout(proj);
    if (!L) return;
    const { x1, x2, ey, sy, ty } = L;
    const w = x2 - x1;
    if (!(w > 0)) return;
    const pc = d.profitColor || "#089981";
    const lc = d.lossColor || "#f23645";
    const fill = (yA, yB, xa, xb, color, a) => {
      ctx.save();
      ctx.globalAlpha = a * ctx.globalAlpha;
      ctx.fillStyle = color;
      ctx.fillRect(xa, Math.min(yA, yB), xb - xa, Math.abs(yB - yA));
      ctx.restore();
    };
    fill(ey, ty, x1, x2, pc, 0.2);
    fill(ey, sy, x1, x2, lc, 0.2);
    const run = d.anchors[2] ? stkPositionRun(d, proj) : null;
    if (run) {
      const xe = Math.min(Math.max(proj.xOf(run.time), x1), x2);
      const ye = proj.yOf(run.price, d.paneId);
      if (ye != null && xe > x1) {
        fill(ey, ye, x1, xe, (run.price - run.entry) * run.dir >= 0 ? pc : lc, 0.3);
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#9598a1";
        ctx.moveTo(x1, ey);
        ctx.lineTo(xe, ye);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.lineWidth = d.style.lineWidth || 1;
    ctx.strokeStyle = d.style.lineColor || "#787b86";
    const yy = Math.round(ey) + 0.5;
    ctx.moveTo(x1, yy);
    ctx.lineTo(x2, yy);
    ctx.stroke();
    ctx.restore();
    const t = this.targets || {};
    const shown = t.selected?.has(d.id) || t.hovered === d.id;
    if (d.showText && shown) this.stkPositionLabels(ctx, d, L, run, pc, lc, theme);
  }
  stkPositionLabels(ctx, d, L, run, pc, lc, theme) {
    const { x1, x2, ey, sy, ty } = L;
    const p = d.prices();
    if (!p) return;
    const sp = PositionTool.stkSpec ? PositionTool.stkSpec() : null;
    const tick = sp && sp.tick > 0 ? sp.tick : 0;
    const pv = sp && sp.pointValue > 0 ? sp.pointValue : 1;
    const dir = p.target >= p.entry ? 1 : -1;
    const risk = Math.abs(p.entry - p.stop);
    const reward = Math.abs(p.target - p.entry);
    let qty = risk > 1e-12 ? d.dollarLoss() / (risk * pv) : 0;
    if (sp && sp.qtyStep > 0) qty = Math.floor(qty / sp.qtyStep + 1e-9) * sp.qtyStep;
    const dec = sp ? Math.min(8, sp.decimals) : Math.abs(p.entry) >= 100 ? 2 : Math.abs(p.entry) >= 1 ? 4 : 6;
    const num = (n, k) => n.toLocaleString("en-US", { minimumFractionDigits: k, maximumFractionDigits: k });
    const pts = (n) => num(n, dec);
    const pct = (n) => p.entry ? num(n / Math.abs(p.entry) * 100, 2) : "0.00";
    const tk = (n) => tick ? " " + num(Math.round(n / tick), 0) : "";
    const amt = (n) => num(n * qty * pv, 2);
    const qtyTxt = sp && sp.qtyStep >= 1 ? num(qty, 0) : num(qty, qty >= 100 ? 2 : 4);
    const compact = d.style?.stkCompact === true;
    const pnl = run ? (run.price - p.entry) * dir * qty * pv : 0;
    const status = run && run.status !== "open" ? "Closed" : "Open";
    const tgt = compact ? [`${pts(reward)} (${pct(reward)}%)`] : [`Target: ${pts(reward)} (${pct(reward)}%)${tk(reward)}, Amount: ${amt(reward)}`];
    const stp = compact ? [`${pts(risk)} (${pct(risk)}%)`] : [`Stop: ${pts(risk)} (${pct(risk)}%)${tk(risk)}, Amount: ${amt(risk)}`];
    const mid = compact ? [`${num(d.rr(), 2)}`] : [`${status} P&L: ${num(pnl, 2)}, Qty: ${qtyTxt}`, `Risk/Reward Ratio: ${num(d.rr(), 2)}`];
    const fs = 12;
    const lh = 16;
    ctx.save();
    ctx.font = `${fs}px ${theme.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cx = x1 + (x2 - x1) / 2;
    const pill = (lines, y, where, bg) => {
      const tw = Math.max(...lines.map((s) => ctx.measureText(s).width));
      const bw = Math.round(tw + 16);
      const bh = lines.length * lh + 8;
      const top = where === "above" ? y - 4 - bh : where === "below" ? y + 4 : y - bh / 2;
      ctx.beginPath();
      roundRect(ctx, Math.round(cx - bw / 2), Math.round(top), bw, bh, 4);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      lines.forEach((s, k) => ctx.fillText(s, cx, top + 4 + lh * k + lh / 2));
    };
    const away = (y) => y <= ey ? "above" : "below";
    if (d.showTargetLabel !== false) pill(tgt, ty, away(ty), pc);
    if (d.showStopLabel !== false) pill(stp, sy, away(sy), lc);
    pill(mid, ey, "center", pnl < 0 ? lc : pnl > 0 ? pc : "#787b86");
    ctx.restore();
  }''')
# the rest of the old painter (header/labels) is now unreachable: keep it out
edit(C, '''    const fs = namedFontSize(d.text?.size ?? "normal");
    ctx.fillStyle = d.text?.color ?? theme.textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fs}px ${theme.fontFamily}`;
    const cx = x1 + w / 2;
    const topY = Math.min(ey, sy, ty) - 9;
    if (d.showHeader) ctx.fillText(d.headerLabel(this.i18n), cx, d.showLossSize ? topY - Math.round(fs * 1.15) : topY);
    ctx.font = `${Math.max(10, fs - 1)}px ${theme.fontFamily}`;
    if (d.showLossSize) ctx.fillText(d.lossSizeLabel(this.i18n), cx, topY);
    if (d.showTargetLabel) ctx.fillText(d.targetLabel(this.i18n), cx, (ey + ty) / 2);
    if (d.showStopLabel) ctx.fillText(d.stopLabel(this.i18n), cx, (ey + sy) / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  /** Paint a linear-regression channel''', '''  /** Paint a linear-regression channel''')
edit(C, '''// src/renderers/native/drawings/Projector.ts''', '''// TradeZoro patch (position): walk the bars from the entry to the box's right edge. Returns the
// bar where the stop or the target was first touched (the stop wins inside one bar, like
// TradingView's conservative fill), else the last bar so far with its close; null with no bars.
function stkPositionRun(d, proj) {
  if (!proj.barsInRange) return null;
  const p = d.prices();
  const e = d.anchors[0];
  if (!p || !e) return null;
  const end = Math.max(d.anchors[1].time, d.anchors[2].time);
  const bars = proj.barsInRange(e.time, end);
  if (!bars || !bars.length) return null;
  const dir = p.target >= p.entry ? 1 : -1;
  let last = null;
  for (const b of bars) {
    if (b.time < e.time) continue;
    last = b;
    const stopHit = dir > 0 ? b.low <= p.stop : b.high >= p.stop;
    const tgtHit = dir > 0 ? b.high >= p.target : b.low <= p.target;
    if (stopHit) return { time: b.time, price: p.stop, status: "stop", entry: p.entry, dir };
    if (tgtHit) return { time: b.time, price: p.target, status: "target", entry: p.entry, dir };
  }
  return last ? { time: last.time, price: last.close, status: "open", entry: p.entry, dir } : null;
}
// src/renderers/native/drawings/Projector.ts''')

# ---- settings window: Inputs + Style tabs for the position tool ----
edit(C, '''    if (d instanceof PositionTool) style.push(this.richBlock(this.t(TEXT9.position), (grid) => buildPositionSection(grid, d, b.actions, this.theme, (m, v) => this.t(m, v))));''',
     '''    // TradeZoro patch (position): TradingView's Inputs tab; the Style tab is our own.
    const stkInputs = d instanceof PositionTool ? [this.richBlock(null, (grid) => buildPositionSection(grid, d, b.actions, this.theme, (m, v) => this.t(m, v)))] : null;
    if (d instanceof PositionTool) style.length = 0, style.push(this.stkPositionStyle(b));''')
edit(C, '''    const own = this.optionsBlock(b, fields, d);
    if (own) style.push(own);
    const tabs = [];
    if (style.length) tabs.push(["style", "Style", style]);''', '''    const own = d instanceof PositionTool ? null : this.optionsBlock(b, fields, d);
    if (own) style.push(own);
    const tabs = [];
    if (stkInputs) tabs.push(["inputs", "Inputs", stkInputs]);
    if (style.length) tabs.push(["style", "Style", style]);''')
edit(C, '''  /** Text tab: colour, size (px), B, I; the words; alignment (TradingView). */''', '''  /** TradeZoro patch (position): Style tab: zone colours, the entry line, labels, compact stats. */
  stkPositionStyle(b) {
    const live = () => b.live();
    const st = () => live().style;
    const rows = [];
    rows.push(row("Profit zone", this.swatch(b, "Profit zone colour", () => live().profitColor || "#089981", "profitColor")));
    rows.push(row("Stop zone", this.swatch(b, "Stop zone colour", () => live().lossColor || "#f23645", "lossColor")));
    const lw = stkSelect([1, 2, 3, 4].map((n) => ({ value: n, label: `${n}px` })), () => st().lineWidth ?? 1, (v) => b.edit({ "style.lineWidth": Number(v) }), this.t(TEXT9.lineWidth));
    lw.el.style.width = "68px";
    b.watch(lw.sync);
    rows.push(row("Line", this.swatch(b, "Line colour", () => st().lineColor || "#787b86", "style.lineColor"), lw.el));
    const chk = (label, get, set) => {
      const c = stkCheck(label, get, set);
      b.watch(c.sync);
      const r = document.createElement("div");
      r.className = "vela-dsp-row";
      r.append(c.el);
      rows.push(r);
    };
    chk("Show labels", () => live().showText !== false, (on) => b.edit({ showText: on }));
    chk("Show target label", () => live().showTargetLabel !== false, (on) => b.edit({ showTargetLabel: on }));
    chk("Show stop label", () => live().showStopLabel !== false, (on) => b.edit({ showStopLabel: on }));
    chk("Compact stats mode", () => st().stkCompact === true, (on) => b.edit({ "style.stkCompact": on }));
    return block(null, ...rows);
  }
  /** Text tab: colour, size (px), B, I; the words; alignment (TradingView). */''')

for f, txt in BUF.items():
    open(os.path.join(D, f), 'w', encoding='utf-8').write(txt)
print(f'{n_edits} edits OK')
