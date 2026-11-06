---
title: Bar range as percent
dek: How big is each bar, relative to price?
level: Beginner
---
```zscript
//@zscript 1
indicator("Range %")
pct = (high - low) / close * 100
plot(pct, "Range %", style=plot.style_columns, color=#00adb5)
plot(ta.sma(pct, 20), "Average", color=color.white)
```

## How it works

Useful for comparing quiet and busy markets on the same scale.
