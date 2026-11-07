---
title: Keltner channel
dek: An average with bands from average true range.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Keltner", overlay=true)
[mid, up, lo] = ta.kc(close, 20, 1.5)
p1 = plot(up, "Upper", color=color.orange)
p2 = plot(lo, "Lower", color=color.orange)
plot(mid, "Middle", color=color.gray)
fill(p1, p2, color.new(color.orange, 93))
```

@chart cb-keltner-channel

## How it works

Same idea as Bollinger Bands, but the width follows the typical bar size (ATR) rather than standard deviation.
