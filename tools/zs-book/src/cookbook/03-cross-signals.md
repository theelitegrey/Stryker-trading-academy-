---
title: Average cross marks
dek: Arrows when a fast line crosses a slow one.
level: Beginner
---
```zscript
//@zscript 1
indicator("Cross marks", overlay=true)
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
plot(fast, "Fast", color=color.green)
plot(slow, "Slow", color=color.red)
plotshape(ta.crossover(fast, slow), "Up", shape.triangleup, location.belowbar, color.green)
plotshape(ta.crossunder(fast, slow), "Down", shape.triangledown, location.abovebar, color.red)
```

## How it works

`ta.crossover(a, b)` is true on the bar where `a` moves from below `b` to above it. This is a teaching sample of a rule, not a trading system.
