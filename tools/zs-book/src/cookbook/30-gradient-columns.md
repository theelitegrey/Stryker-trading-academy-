---
title: Gradient volume
dek: Color by how big a value is.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Gradient")
r = ta.rsi(close, 14)
c = color.from_gradient(r, 30, 70, color.red, color.green)
plot(r, "RSI", style=plot.style_columns, color=c)
```

## How it works

`color.from_gradient(value, low, high, colorLow, colorHigh)` blends between two colors.
