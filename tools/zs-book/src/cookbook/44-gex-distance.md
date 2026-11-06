---
title: Distance to the call wall
dek: How far price is from a level, in percent (GEX+ data).
level: Intermediate
---
```zscript
//@zscript 1
indicator("Distance to call wall")
d = (gex.callwall - close) / close * 100
hline(0)
plot(d, "% to call wall", color=#00adb5)
```

## How it works

Positive when price is below the wall.
