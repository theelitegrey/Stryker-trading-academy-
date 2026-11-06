---
title: CCI
dek: How far typical price strays from its average.
level: Beginner
---
```zscript
//@zscript 1
indicator("CCI")
c = ta.cci(hlc3, 20)
hline(100)
hline(-100)
hline(0)
plot(c, "CCI", color=#00adb5)
```

## How it works

Bigger than 100 or smaller than -100 means an unusually big move compared with recent bars.
