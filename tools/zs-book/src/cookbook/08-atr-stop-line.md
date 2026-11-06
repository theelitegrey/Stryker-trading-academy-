---
title: ATR trailing line
dek: A line that keeps its distance from price.
level: Intermediate
---
```zscript
//@zscript 1
indicator("ATR trail", overlay=true)
mult = input.float(3.0, "ATR multiple", step=0.5)
atr1 = ta.atr(14)
var float trail = na
raw = close - atr1 * mult
trail := na(trail) ? raw : math.max(trail, raw)
plot(trail, "Trail", color=color.orange, style=plot.style_stepline)
```

## How it works

The line only moves up, never down, so it traces a path that stays a set number of bar-sizes below the close. A teaching example of `var`.
