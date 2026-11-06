---
title: Bars since last cross
dek: Count bars since a signal.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Bars since cross")
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
n = ta.barssince(ta.cross(fast, slow))
plot(n, "Bars since last cross", style=plot.style_columns, color=#00adb5)
```

## How it works

`ta.barssince(condition)` counts bars since the condition was last true.
