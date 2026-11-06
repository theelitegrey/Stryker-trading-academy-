---
title: Engulfing candles
dek: Mark bars that wrap the previous body.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Engulfing", overlay=true)
bull = close > open and close[1] < open[1] and close >= open[1] and open <= close[1]
bear = close < open and close[1] > open[1] and close <= open[1] and open >= close[1]
plotshape(bull, "Bullish", shape.arrowup, location.belowbar, color.green)
plotshape(bear, "Bearish", shape.arrowdown, location.abovebar, color.red)
```

## How it works

A pattern finder in four lines. A pattern is a shape, not a prediction.
