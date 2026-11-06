---
title: Supertrend
dek: A built-in trend line that flips color.
level: Beginner
---
```zscript
//@zscript 1
indicator("Supertrend", overlay=true)
[st, dir] = ta.supertrend(3.0, 10)
plot(st, "Supertrend", color=dir < 0 ? color.green : color.red, linewidth=2)
```

## How it works

`dir` is -1 in an up-trend and 1 in a down-trend. We use it to choose the color.
