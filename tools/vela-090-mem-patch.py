#!/usr/bin/env python3
"""Phone memory: renderer-layer canvases hold pixels only while their layer has something to paint (s7).

  cp -r assets/vendor/vela-0.9.0-s6 assets/vendor/vela-0.9.0-s7
  python3 tools/vela-090-mem-patch.py assets/vendor/vela-0.9.0-s7

Member report 09 Nov ("Mobile is bad", iPhone Safari crash loop on a 5-indicator 1m NQ layout).
Every registered renderer layer (order flow, L2, GEX, alerts, sessions, events ... 70 of them once the
volume tools load) got its OWN full-size plot canvas at boot, whether or not its indicator is on the
chart. At devicePixelRatio 3 on a 390x789 chart each canvas is 1170x2367 px = 10.6 MB, so the chart held
~740 MB of canvas pixels, ~670 MB of it for layers with nothing to draw. iOS Safari counts canvas pixels
against a tab budget far below that, so the tab was killed again and again.

Now a layer canvas is sized to the plot only while the layer is LIVE: it has an owner indicator on the
chart or data on its channel (the same two inputs every layer's render() reads). Otherwise it is 0x0
(its CSS size stays 100%, so it is still in place; a 0x0 canvas paints nothing, which is what an idle
layer draws anyway). It is re-sized the moment the layer gets an owner or data, before its render(),
at the same devicePixelRatio, so nothing looks different. Applies everywhere (desktop too): same
pixels on screen, less memory.
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

# syncSize: remember the plot's device size; idle layers stay 0x0.
edit(C, '''    size(this.volumeCanvas);
    for (const l of this.extLayers) size(l.canvas);''', '''    size(this.volumeCanvas);
    // TradeZoro patch (mem): layer canvases are sized only while the layer has an owner or data (stkLayerFit).
    this.stkDev = { bw, bh, pw, ph };
    for (const l of this.extLayers) this.stkLayerFit(l);''')

# the helper, next to clearLayerCanvas
edit(C, '''  /** Blank one SDK layer canvas (a collapsed host pane suppresses the layer's painting). */
  clearLayerCanvas(canvas) {''', '''  /** TradeZoro patch (mem): size a layer canvas to the plot while the layer is live (an owner indicator on the
   *  chart or data on its channel), free its pixels (0x0) while it is not. Called before every layer render. */
  stkLayerFit(l) {
    const d = this.stkDev, c = l.canvas;
    if (!d || !c) return;
    const live = l.owner !== null || this.scene.nativeData.get(l.channel) != null || !!this.layerOwner(l);
    const w = live ? d.bw : 0, h = live ? d.bh : 0;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    if (live) { c.style.width = `${d.pw}px`; c.style.height = `${d.ph}px`; }
  }
  /** Blank one SDK layer canvas (a collapsed host pane suppresses the layer's painting). */
  clearLayerCanvas(canvas) {''')

# data paint: fit before each layer paints
edit(C, '''      for (const l of this.extLayers) {
        const lp = this.layerPane(l) ?? pane;
        if (lp.collapsed || this.layerHiddenWithCandles(l)) {
          this.clearLayerCanvas(l.canvas);
          continue;
        }''', '''      for (const l of this.extLayers) {
        this.stkLayerFit(l);
        const lp = this.layerPane(l) ?? pane;
        if (lp.collapsed || this.layerHiddenWithCandles(l)) {
          this.clearLayerCanvas(l.canvas);
          continue;
        }''')

# cursor repaint path too
edit(C, '''    for (const l of this.extLayers) {
      if (!l.def.repaintOnCursor) continue;''', '''    for (const l of this.extLayers) {
      if (!l.def.repaintOnCursor) continue;
      this.stkLayerFit(l);''')

for f, txt in BUF.items():
    open(os.path.join(D, f), 'w', encoding='utf-8').write(txt)
print(f'{n_edits} edits OK')
