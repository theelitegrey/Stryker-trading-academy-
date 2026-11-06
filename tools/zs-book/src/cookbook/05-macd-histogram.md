---
title: MACD with colored histogram
dek: Momentum from two averages.
level: Beginner
---
```zscript
//@zscript 1
indicator("MACD")
[macdLine, signal, hist] = ta.macd(close, 12, 26, 9)
plot(hist, "Histogram", style=plot.style_columns, color=hist >= 0 ? color.green : color.red)
plot(macdLine, "MACD", color=color.white)
plot(signal, "Signal", color=color.yellow)
```

## How it works

The histogram is the gap between the MACD line and its signal line. Green above zero, red below.
