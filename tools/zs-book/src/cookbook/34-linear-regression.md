---
title: Regression line and bands
dek: A fitted line through recent closes.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Regression", overlay=true)
len = input.int(50, "Length")
lr = ta.linreg(close, len, 0)
sd = ta.stdev(close, len)
p1 = plot(lr + 2 * sd, "Upper", color=color.gray)
p2 = plot(lr - 2 * sd, "Lower", color=color.gray)
plot(lr, "Line", color=#03c988)
fill(p1, p2, color.new(color.gray, 94))
```

## How it works

The fitted line and a band two standard deviations away.
