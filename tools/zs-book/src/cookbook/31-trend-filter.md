---
title: Trend filter background
dek: Green when above a long average, red when below.
level: Beginner
---
```zscript
//@zscript 1
indicator("Trend filter", overlay=true)
len = input.int(100, "Length")
a = ta.sma(close, len)
plot(a, "Average", color=color.gray)
bgcolor(close > a ? color.new(color.green, 94) : color.new(color.red, 94))
```

## How it works

The simplest possible regime filter.
