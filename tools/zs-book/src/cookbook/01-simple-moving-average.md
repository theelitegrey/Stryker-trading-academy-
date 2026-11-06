---
title: Simple moving average
dek: The classic smooth line.
level: Beginner
---
```zscript
//@zscript 1
indicator("SMA", overlay=true)
len = input.int(20, "Length", minval=1)
plot(ta.sma(close, len), "SMA", color=#03c988, linewidth=2)
```

@chart cb-simple-moving-average

## How it works

The average of the last `len` closes. Longer length, smoother and slower line.
Try: switch `close` for `hl2` to average the middle of each bar instead.
