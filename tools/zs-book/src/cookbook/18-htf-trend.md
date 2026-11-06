---
title: Higher timeframe trend
dek: Show the 1-hour trend on a small chart.
level: Intermediate
---
```zscript
//@zscript 1
indicator("HTF trend", overlay=true)
tf = input.timeframe("60", "Higher timeframe")
htf = request.security(syminfo.tickerid, tf, ta.ema(close, 50)[1])
plot(htf, "HTF EMA", color=color.yellow, style=plot.style_stepline)
bgcolor(close > htf ? color.new(color.green, 94) : color.new(color.red, 94))
```

## How it works

The background turns green when price is above the higher timeframe average.
