---
title: Stochastic
dek: Where the close sits inside the recent range.
level: Beginner
---
```zscript
//@zscript 1
indicator("Stochastic")
k = ta.stoch(close, high, low, 14)
d = ta.sma(k, 3)
hline(80)
hline(20)
plot(k, "%K", color=color.blue)
plot(d, "%D", color=color.orange)
```

## How it works

100 means the close is at the top of the last 14 bars' range, 0 the bottom.
