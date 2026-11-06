---
title: Delta against price
dek: Mark bars where price and delta disagree (Pro data).
level: Advanced
---
```zscript
//@zscript 1
indicator("Delta divergence", overlay=true)
newHigh = high >= ta.highest(high, 20)
weak = flow.delta < 0
plotshape(newHigh and weak, "High on negative delta", shape.xcross, location.abovebar, color.orange)
newLow = low <= ta.lowest(low, 20)
strong = flow.delta > 0
plotshape(newLow and strong, "Low on positive delta", shape.xcross, location.belowbar, color.orange)
```

## How it works

A new 20-bar high that traded with negative delta (or a low with positive delta) is flagged. It is a thing to look at, not a signal.
