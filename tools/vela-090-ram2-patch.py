#!/usr/bin/env python3
"""RAM round 2: Pine drawing-slice canvases kept in plain memory, not on the GPU (s8).

  cp -r assets/vendor/vela-0.9.0-s7 assets/vendor/vela-0.9.0-s8
  python3 tools/vela-090-ram2-patch.py assets/vendor/vela-0.9.0-s8

Member report 11 Nov (GK: "one chart tab ~4 GB", 2 charts, 16 indicators). Each Pine indicator's
lines/boxes/labels/tables are painted on an off-screen "slice" canvas the size of the plot, then
uploaded to the WebGL chart as a texture every frame. Chrome backs such canvases with GPU memory and
a renderer-side copy (~30 MB each at 1440x900 @2x), and a chart has 2-4 of them. They are never shown
themselves, so they gain nothing from the GPU: willReadFrequently keeps their pixels in plain memory
(one copy). Same canvas size, same drawing code, same texture upload: pixel-identical output.
"""
import sys, os

D = sys.argv[1]
F = os.path.join(D, 'chunk-XIRSR3D6.js')
s = open(F).read()
old = '''        canvas.height = ref.height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      beginPlotFrame(ctx, dpr);'''
new = '''        canvas.height = ref.height;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) continue;
      beginPlotFrame(ctx, dpr);'''
assert s.count(old) == 1, 'anchor not found: IndicatorDrawingSlices.prepare getContext'
open(F, 'w').write(s.replace(old, new))
print('vela-090-ram2-patch: 1 edit applied to', F)
