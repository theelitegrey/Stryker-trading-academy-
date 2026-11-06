---
title: Cross alert
dek: An alert you can set from the chart.
level: Beginner
---
```zscript
//@zscript 1
indicator("Cross alert", overlay=true)
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
plot(fast)
plot(slow)
alertcondition(ta.crossover(fast, slow), "Up cross", "Fast EMA crossed above slow EMA")
alertcondition(ta.crossunder(fast, slow), "Down cross", "Fast EMA crossed below slow EMA")
```

## How it works

After you add the script, the alert dialog lists both rules.
