---
title: Donchian channel
dek: Highest high and lowest low of N bars.
level: Beginner
---
```zscript
//@zscript 1
indicator("Donchian", overlay=true)
n = input.int(20, "Length", minval=2)
hi = ta.highest(high, n)
lo = ta.lowest(low, n)
p1 = plot(hi, "High", color=color.green)
p2 = plot(lo, "Low", color=color.red)
fill(p1, p2, color.new(color.gray, 94))
```

@chart cb-donchian

## How it works

A breakout channel: a close above the top line is a new N-bar high.
