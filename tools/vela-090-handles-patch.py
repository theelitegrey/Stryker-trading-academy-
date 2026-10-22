#!/usr/bin/env python3
"""TradingView-style selection handles on Vela 0.9.0 (run after vela-090-dsp-patch.py).

  python3 tools/vela-090-handles-patch.py assets/vendor/vela-0.9.0-sN

Owner target 2026-10-22 18:26 (tv-ref-box-handles-1022.png):
- A selected rectangle shows 8 handles: hollow circles on the corners, hollow rounded squares
  on the edge midpoints (white fill, blue 1.5 px outline, ~10 px).
- Corner drag resizes both sides; an edge midpoint moves only that edge (top/bottom = price,
  left/right = time); a drag inside moves the whole box.
- Resize cursors over the handles (nwse/nesw/ns/ew), a move cursor over a drawing body.
- Default box: blue border, light-blue see-through fill.
- Every other tool gets the same round handle look.
"""
import sys, os

D = sys.argv[1]
n_edits = 0


BUF = {}


def edit(fname, old, new, count=1):
    """All edits are staged in memory; files are written only when every anchor matched."""
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

# ---- handle look: white fill, blue ring, circles + rounded squares ----
edit(C, 'var HANDLE_RADIUS = 4.5;', '// TradeZoro patch (handles): TradingView handles, ~10 px, white fill, blue 1.5 px ring.\nvar HANDLE_RADIUS = 5;\nvar STK_HANDLE_BLUE = "#2962ff";')
edit(C, '''  paintHandles(ctx, points) {
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    for (const [x, y] of points) {
      ctx.beginPath();
      ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = HANDLE_FILL;
      ctx.fill();
      ctx.strokeStyle = HANDLE_BORDER;
      ctx.stroke();
    }
  }''', '''  paintHandles(ctx, points) {
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    for (const [x, y, shape] of points) {
      ctx.beginPath();
      if (shape === "sq") roundRect(ctx, x - 4.5, y - 4.5, 9, 9, 2.5);
      else ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = STK_HANDLE_BLUE;
      ctx.stroke();
    }
  }''')

# ---- box: 8 handles + their drag ----
edit(Y, '''    if (this.style.fillColor && pointInBox(px, py, r.x1, r.y1, r.x2, r.y2)) return true;
    const edges = [
      [r.x1, r.y1, r.x2, r.y1],
      [r.x2, r.y1, r.x2, r.y2],
      [r.x2, r.y2, r.x1, r.y2],
      [r.x1, r.y2, r.x1, r.y1]
    ];
    return edges.some((e) => distToSegment(px, py, e[0], e[1], e[2], e[3]) <= tol);
  }
  handlePoints(proj) {
    const r = this.rect(proj);
    return r ? [[r.x1, r.y1], [r.x2, r.y2]] : [];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  bounds(proj) {
    const r = this.rect(proj);
    if (!r) return null;
    return { x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }''', '''    if (this.style.fillColor && pointInBox(px, py, r.x1, r.y1, r.x2, r.y2)) return true;
    const edges = [
      [r.x1, r.y1, r.x2, r.y1],
      [r.x2, r.y1, r.x2, r.y2],
      [r.x2, r.y2, r.x1, r.y2],
      [r.x1, r.y2, r.x1, r.y1]
    ];
    return edges.some((e) => distToSegment(px, py, e[0], e[1], e[2], e[3]) <= tol);
  }
  // TradeZoro patch (handles): 8 handles like TradingView. 0/1 = the two anchors, 2/3 = the
  // other corners, 4/5 = midpoints of the a/b price edges, 6/7 = midpoints of the a/b time edges.
  handlePoints(proj) {
    const r = this.rect(proj);
    if (!r) return [];
    const mx = (r.x1 + r.x2) / 2, my = (r.y1 + r.y2) / 2;
    return [[r.x1, r.y1], [r.x2, r.y2], [r.x1, r.y2], [r.x2, r.y1], [mx, r.y1, "sq"], [mx, r.y2, "sq"], [r.x1, my, "sq"], [r.x2, my, "sq"]];
  }
  hitHandle(px, py, proj, tol) {
    return handleAt(px, py, this.handlePoints(proj), tol + 3);
  }
  /** Drag handle i to `pt`, from the anchors as they were at the press (`orig`). */
  stkDragHandle(i, pt, orig) {
    const a = this.anchors[0], b = this.anchors[1];
    if (!a || !b || !orig || orig.length < 2) return;
    a.time = orig[0].time; a.price = orig[0].price; b.time = orig[1].time; b.price = orig[1].price;
    if (i === 0) { a.time = pt.time; a.price = pt.price; }
    else if (i === 1) { b.time = pt.time; b.price = pt.price; }
    else if (i === 2) { a.time = pt.time; b.price = pt.price; }
    else if (i === 3) { b.time = pt.time; a.price = pt.price; }
    else if (i === 4) a.price = pt.price;
    else if (i === 5) b.price = pt.price;
    else if (i === 6) a.time = pt.time;
    else if (i === 7) b.time = pt.time;
  }
  /** The cursor over handle i (TradingView resize cursors). */
  stkHandleCursor(i, proj) {
    const h = this.handlePoints(proj);
    if (i >= 4) return i <= 5 ? "ns-resize" : "ew-resize";
    const opp = h[[1, 0, 3, 2][i]];
    if (!h[i] || !opp) return "move";
    return (h[i][0] - opp[0]) * (h[i][1] - opp[1]) > 0 ? "nwse-resize" : "nesw-resize";
  }
  bounds(proj) {
    const r = this.rect(proj);
    if (!r) return null;
    return { x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
  }
  priceRange() {
    const a = this.anchors[0];
    const b = this.anchors[1];
    if (!a || !b) return null;
    return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
  }''')
edit(C, '''    if (this.state.handle < 0) {
      this.dragBody(d, x, y);
    } else {''', '''    if (this.state.handle < 0) {
      this.dragBody(d, x, y);
    } else if (typeof d.stkDragHandle === "function") {
      // TradeZoro patch (handles): handles that are not anchors (box corners/edges).
      d.stkDragHandle(this.state.handle, this.resolve(x, y, d.paneId, mode), this.state.orig);
    } else {''')

# ---- cursors ----
edit(C, '''  cursorAt(x, y) {
    if (this.deps.activeTool() != null) return null;
    return this.hitAt(x, y) ? "pointer" : null;
  }''', '''  cursorAt(x, y) {
    if (this.deps.activeTool() != null) return null;
    // TradeZoro patch (handles): resize cursors on handles, move cursor on a drawing body.
    if (this.state.kind === "pressed" && this.state.moved) {
      const dd = this.byId(this.state.id);
      if (dd && this.state.handle >= 0 && typeof dd.stkHandleCursor === "function") return dd.stkHandleCursor(this.state.handle, this.deps.projector());
      return this.state.handle >= 0 ? "grabbing" : "move";
    }
    const hit = this.hitAt(x, y);
    if (!hit) return null;
    if (hit.locked) return "pointer";
    const proj = this.deps.projector();
    const shown = this.handleDrawings().includes(hit);
    const i = shown ? hit.hitHandle(x, y, proj, HIT_TOLERANCE) : -1;
    if (i >= 0) return typeof hit.stkHandleCursor === "function" ? hit.stkHandleCursor(i, proj) : "grab";
    return "move";
  }''')

# ---- default rectangle: TradingView blue ----
edit(Y, '''  label: msg("drawing.box.label", "Rectangle"),
  icon: BOX_ICON,
  defaultStyle: { lineColor: DEFAULT_DRAWING_COLOR, lineWidth: 1, lineStyle: "solid", fillColor: `${DEFAULT_DRAWING_COLOR}26` },''', '''  label: msg("drawing.box.label", "Rectangle"),
  icon: BOX_ICON,
  // TradeZoro patch (handles): TradingView's blue rectangle.
  defaultStyle: { lineColor: "#2962ff", lineWidth: 1, lineStyle: "solid", fillColor: "#2962ff33" },''')

for f, txt in BUF.items():
    open(os.path.join(D, f), 'w', encoding='utf-8').write(txt)
print(f'{n_edits} edits OK')
