---
title: EMA ribbon
dek: Four averages that fan out in a trend.
level: Beginner
---
```zscript
//@zscript 1
indicator("EMA ribbon", overlay=true)
plot(ta.ema(close, 8), "8", color=color.new(#03c988, 0))
plot(ta.ema(close, 13), "13", color=color.new(#03c988, 25))
plot(ta.ema(close, 21), "21", color=color.new(#03c988, 50))
plot(ta.ema(close, 34), "34", color=color.new(#03c988, 70))
```

## How it works

Each line is an exponential average. When they spread apart, price has been moving one way for a while. When they tangle, it has not. The fading color helps you tell the lines apart.
