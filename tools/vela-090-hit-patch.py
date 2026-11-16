#!/usr/bin/env python3
"""s10: range drawings no longer swallow the pointer over their whole range (member bug, raajans 16 Nov), and a drawing's
right-click menu can Lock / Unlock it.

  cp -r assets/vendor/vela-0.9.0-s9 assets/vendor/vela-0.9.0-s10; python3 tools/vela-090-hit-patch.py assets/vendor/vela-0.9.0-s10

Cause: Anchored VWAP.hitTest returned true for the whole +-sd band polygon, Fixed Range Volume Profile for the whole
bounding box of its histogram, Regression Channel for the whole channel polygon. hitAt() runs before pan / tool placement /
selection, so any press inside the range was claimed by that drawing: no cursor, no pan, no placing a new drawing, no
selecting another one. Now each one hits only what you can see and mean to grab: its lines and handles (VWAP, channel) or its
bars and lines (profile). Locked drawings stay clickable on those parts (s9); the chart's right-click menu now offers
Lock / Unlock for the drawing under the pointer.
"""
import sys, os
D = sys.argv[1]
BUF = {}
def edit(f, old, new):
    if f not in BUF: BUF[f] = open(os.path.join(D, f), encoding='utf-8').read()
    n = BUF[f].count(old)
    if n != 1: sys.exit(f'{f}: anchor found {n}x: {old[:80]!r}')
    BUF[f] = BUF[f].replace(old, new)
Y = 'chunk-YRCL3WMD.js'
edit(Y, '    if (pointInPolygon(px, py, this.bandPolygon(L))) return true;\n    return polylineHit(px, py, L.mid, tol)',
        '    // TradeZoro (hit): lines only. The band polygon used to claim every press inside the range.\n    return polylineHit(px, py, L.mid, tol)')
edit(Y, '''    const yLo = Math.min(L.yEdges[0], L.yEdges[L.yEdges.length - 1]);
    const yHi = Math.max(L.yEdges[0], L.yEdges[L.yEdges.length - 1]);
    if (pointInPolygon(px, py, [
      [left, yLo],
      [right, yLo],
      [right, yHi],
      [left, yHi]
    ])) return true;
''', '''    // TradeZoro (hit): the histogram bars only, not the whole box around them (the empty part is the chart's).
    const rows = L.profile.rows;
    for (let k = 0; k < rows.length; k += 1) {
      const total = rows[k].up + rows[k].down;
      if (total <= 0 || !(L.profile.maxTotal > 0)) continue;
      const w2 = total / L.profile.maxTotal * L.maxW;
      const a = L.yEdges[k], b = L.yEdges[k + 1];
      if (py < Math.min(a, b) || py > Math.max(a, b)) continue;
      const bx0 = L.grow === 1 ? L.anchorX : L.anchorX - w2;
      if (px >= bx0 && px <= bx0 + w2) return true;
    }
''')
edit(Y, '''    if (pointInPolygon(px, py, poly)) return true;
    const lines = [
      [L.x0, L.midY0, L.x1, L.midY1],''', '''    // TradeZoro (hit): the three lines only; the channel body is not grabbed
    const lines = [
      [L.x0, L.midY0, L.x1, L.midY1],''')
# unused const poly would still be fine; unused vars left, harmless.
C = 'chunk-4WAHYL7Y.js'
edit(C, '''      this.menu.setItems(this.itemsFor(this.lastZone));
      this.menu.openAt(e.clientX, e.clientY);
    };
    this.host = host;''', '''      let items = this.itemsFor(this.lastZone);
      this.stkDrawingId = null;
      try {   // TradeZoro (hit): right-click on a drawing offers Lock / Unlock (a locked one ignores every other click)
        const ud = this.lastZone === "body" ? this.chart.renderer.renderer.userDrawings : null;
        const el = ud && this.chart.renderer.renderer.input.el;
        const r = el && el.getBoundingClientRect();
        const hit = r && ud.interaction.hitAt(e.clientX - r.left, e.clientY - r.top);
        if (hit) {
          this.stkDrawingId = hit.id;
          items = [{ id: "stk-drawing-lock", label: hit.locked ? "Unlock drawing" : "Lock drawing", icon: hit.locked ? "unlock" : "lock" }, ...items.map((it, i) => i === 0 ? { ...it, separatorBefore: true } : it)];
        }
      } catch (err) {}
      this.menu.setItems(items);
      this.menu.openAt(e.clientX, e.clientY);
    };
    this.host = host;''')
edit(C, '''    if (id.startsWith("action:")) {
      const ctx = this.context();''', '''    if (id === "stk-drawing-lock") {
      const did = this.stkDrawingId, d = did && chart.drawings.all().find((x) => x.id === did);
      if (d) { chart.drawings.lock(did, !d.locked); chart.drawings.select([did]); }
      return;
    }
    if (id.startsWith("action:")) {
      const ctx = this.context();''')
for f, s in BUF.items(): open(os.path.join(D, f), 'w', encoding='utf-8').write(s)
open(os.path.join(D, 'CHANGES.md'), 'a').write('\nThen tools/vela-090-hit-patch.py (s10: Anchored VWAP / profile / regression channel hit only their lines and bars, not the whole range; right-click a drawing: Lock / Unlock).\n')
print('ok')
