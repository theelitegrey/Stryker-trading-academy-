---
title: Fair value gaps
dek: Box the gap between candle 1 and candle 3.
level: Advanced
---
```zscript
//@zscript 1
indicator("FVG", overlay=true, max_bars_back=5)
bullGap = low > high[2]
bearGap = high < low[2]
if bullGap
    box.new(bar_index - 2, low, bar_index + 10, high[2], border_color=color.green, bgcolor=color.new(color.green, 88))
if bearGap
    box.new(bar_index - 2, low[2], bar_index + 10, high, border_color=color.red, bgcolor=color.new(color.red, 88))
```

@chart cb-fair-value-gap

## How it works

A gap exists when the wicks of candles one and three do not overlap. We draw a box from the gap forward ten bars.
