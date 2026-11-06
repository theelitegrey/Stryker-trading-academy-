---
title: Opening gap marks
dek: Mark days that open away from the prior close.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Gap marks", overlay=true)
minGap = input.float(0.3, "Minimum gap %", step=0.1)
newDay = ta.change(time("D")) != 0
gapPct = (open - close[1]) / close[1] * 100
plotshape(newDay and gapPct > minGap, "Gap up", shape.triangleup, location.belowbar, color.green)
plotshape(newDay and gapPct < -minGap, "Gap down", shape.triangledown, location.abovebar, color.red)
```

## How it works

Compares each day's first open with the last close before it.
