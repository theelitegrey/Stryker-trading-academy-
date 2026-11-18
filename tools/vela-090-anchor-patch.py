#!/usr/bin/env python3
"""s11: a Pine script with drawings but no plots stays on its bars when the chart's first bars are cut off
(member bug, GK 16-18 Nov: iFVG Pro+ risk/reward box far from the candle where the IFVG triggered).

  cp -r assets/vendor/vela-0.9.0-s10 assets/vendor/vela-0.9.0-s11; python3 tools/vela-090-anchor-patch.py assets/vendor/vela-0.9.0-s11

Cause: when the chart's head moves forward under a mounted model (the "days to load" window trims old bars), the renderer
re-derives the model's index offset from its plot series. A model with only boxes / lines / labels (iFVG Pro+) has no series,
so it fell back to "unanchored" (offset 0): every bar_index drawing moved right by the number of trimmed bars, and stayed
there until the script was re-added. Now, with no series to align on, the offset is carried over from the previous bars:
the model's old chart index minus the number of bars cut off the head.
"""
import sys, os
D = sys.argv[1]
C = 'chunk-XIRSR3D6.js'
p = os.path.join(D, C)
s = open(p, encoding='utf-8').read()
def edit(old, new):
    global s
    n = s.count(old)
    if n != 1: sys.exit(f'{C}: anchor found {n}x: {old[:80]!r}')
    s = s.replace(old, new)
edit('    for (const model of this.scene.indicators.values()) this.refreshAnchorOffset(model);\n    if (opts?.preserveView === true && prevHeadTime != null',
     '    for (const model of this.scene.indicators.values()) this.refreshAnchorOffset(model, prevBars);\n    if (opts?.preserveView === true && prevHeadTime != null')
edit('''  refreshAnchorOffset(model) {
    const anchor = model.anchorTime;''', '''  refreshAnchorOffset(model, prevBars) {
    const anchor = model.anchorTime;''')
edit('''      const skip = leadingPointsBefore(model, head);
      if (skip == null) {
        console.warn''', '''      const skip = leadingPointsBefore(model, head);
      // TradeZoro (anchor): drawings-only model (no series): carry the offset over from the previous bars
      if (skip == null && prevBars && prevBars.length) {
        let lo = 0, hi = prevBars.length - 1, cut = -1;
        while (lo <= hi) {
          const mid = lo + hi >> 1, t = prevBars[mid].time;
          if (t === head) { cut = mid; break; }
          if (t < head) lo = mid + 1; else hi = mid - 1;
        }
        if (cut >= 0) {
          this.scene.setAnchorOffset(model.id, this.scene.offsetOf(model.id) - cut);
          return;
        }
      }
      if (skip == null) {
        console.warn''')
open(p, 'w', encoding='utf-8').write(s)
print('3 edits OK')
