# vela-0.9.0-s4

Upstream @luxalgo/vela 0.9.0 dist (ESM), patched by tools/vela-090-patch.py then tools/vela-090-dsp-patch.py.
The folder suffix changes whenever patched files change: /assets/* is cached for a year.
Then tools/vela-090-handles-patch.py (8 box handles, TradingView handle look, resize/move cursors, blue box default).
Then tools/vela-090-position-patch.py (TradingView Long/Short Position tool).

Then tools/vela-090-ctypes-patch.py (s5: a chart type transform with derive:true rebuilds the view on every bar and gets its settings).

Then tools/vela-090-scale-patch.py (s6: "Scale price chart only" - candles-only price auto-scale, saved as priceScale.scalePriceOnly).

Then tools/vela-090-mem-patch.py (s7: renderer-layer canvases hold pixels only while the layer has an owner or data; phone memory).
