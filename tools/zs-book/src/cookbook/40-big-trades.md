---
title: Big trade count
dek: How many large single trades hit the bar (Pro data).
level: Intermediate
---
```zscript
//@zscript 1
indicator("Big trades")
minSize = input.int(50, "Minimum trade size", minval=1)
n = flow.bigtrades(minSize)
plot(n, "Big trades", style=plot.style_columns, color=n > 0 ? color.orange : color.gray)
```

@chart cb-big-trades

## How it works

Counts single trades of at least `minSize` contracts or units.
