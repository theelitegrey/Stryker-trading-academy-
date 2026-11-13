#!/usr/bin/env python3
"""s9: locked drawings stay selectable by click (toolbar shows Unlock) but show no resize handles, and paint a small padlock. Usage: cp -r assets/vendor/vela-0.9.0-s8 assets/vendor/vela-0.9.0-s9; python3 tools/vela-090-lock-patch.py assets/vendor/vela-0.9.0-s9
"""
import sys, os
D = sys.argv[1]
def edit(f, old, new):
    p = os.path.join(D, f); s = open(p, encoding='utf-8').read()
    if s.count(old) != 1: sys.exit(f'{f}: anchor found {s.count(old)}x: {old[:80]!r}')
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))
C = 'chunk-XIRSR3D6.js'
# locked drawings stay hit-testable (click selects them so the floating toolbar / menu can Unlock); handles below are skipped
edit(C, '    for (const d of this.handleDrawings()) {\n      if (d.hitHandle(x, y, proj, HIT_TOLERANCE) >= 0) return d;',
        '    for (const d of this.handleDrawings()) {\n      if (!d.locked && d.hitHandle(x, y, proj, HIT_TOLERANCE) >= 0) return d;')
# padlock indicator
edit(C, '      this.paintClipped(ctx, d, proj, () => this.paintOne(ctx, d, proj, theme));\n    }\n    this.targets = {};',
        '      this.paintClipped(ctx, d, proj, () => { this.paintOne(ctx, d, proj, theme); if (d.locked) this.stkPaintLock(ctx, d, proj); });\n    }\n    this.targets = {};')
edit(C, '  paintAll(ctx, drawings, proj, theme, targets = {}) {',
'''  /** TradeZoro (lock): small padlock at the drawing's first point. */
  stkPaintLock(ctx, d, proj) {
    let p; try { p = d.handlePoints(proj)[0]; } catch (e) { return; }
    if (!p) return;
    const x = (Array.isArray(p) ? p[0] : p.x) + 5, y = (Array.isArray(p) ? p[1] : p.y) - 15;
    ctx.save();
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.fillStyle = "rgba(15,15,15,0.85)"; ctx.beginPath(); ctx.roundRect(x - 2, y - 2, 14, 15, 3); ctx.fill();
    ctx.strokeStyle = "#e5e7eb"; ctx.fillStyle = "#e5e7eb"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x + 5, y + 4, 2.6, Math.PI, 0); ctx.stroke();
    ctx.fillRect(x + 1, y + 5, 8, 6);
    ctx.restore();
  }
  paintAll(ctx, drawings, proj, theme, targets = {}) {''')
edit(C, '  if (ids.length < 2) return ids;\n  return ids.filter((id) => !drawings.find((d) => d.id === id)?.locked);',
        '  return ids.filter((id) => !drawings.find((d) => d.id === id)?.locked);   // TradeZoro (lock): also for a single selection')
edit(C, '      remove: () => {\n        this.closeTextEditor();\n        this.popup.close();\n        this.emit({ kind: "delete", ids: [id] });',
        '      remove: () => {\n        if (this.drawings.find((x) => x.id === id)?.locked) return;   // TradeZoro (lock): unlock first\n        this.closeTextEditor();\n        this.popup.close();\n        this.emit({ kind: "delete", ids: [id] });')
edit(C, '    bar.appendChild(this.toggle(this.t(TEXT10.lock), LOCK_ICON, common((d) => d.locked), (v) => actions.setLocked(v), UNLOCK_ICON));',
        '    const lockBtn = this.toggle(this.t(TEXT10.lock), LOCK_ICON, common((d) => d.locked), (v) => { actions.setLocked(v); nameLock(v); }, UNLOCK_ICON);\n    const nameLock = (v) => { const s = v === true ? "Unlock" : "Lock"; lockBtn.dataset.tip = s; lockBtn.setAttribute("aria-label", s); };   // TradeZoro (lock): name the next action\n    nameLock(common((d) => d.locked));\n    bar.appendChild(lockBtn);')
edit(C, '      if (d.visible && highlightIds.has(d.id)) {', '      if (d.visible && !d.locked && highlightIds.has(d.id)) {   // TradeZoro (lock): no resize handles on a locked drawing')
open(os.path.join(D, 'CHANGES.md'), 'a').write('\nThen tools/vela-090-lock-patch.py (s9: locked drawings stay selectable, no handles, padlock).\n')
print('ok')
