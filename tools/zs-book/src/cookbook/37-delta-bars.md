---
title: Delta columns
dek: Buyers minus sellers per bar (Pro data).
level: Beginner
---
```zscript
//@zscript 1
indicator("Delta")
hline(0)
plot(flow.delta, "Delta", style=plot.style_columns, color=flow.delta >= 0 ? color.green : color.red)
```

## How it works

Positive when more volume traded at the ask than at the bid.
