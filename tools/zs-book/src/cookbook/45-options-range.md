---
title: Option range edges
dek: The expected range as two lines (ZoroOptions data).
level: Beginner
---
```zscript
//@zscript 1
indicator("Option range", overlay=true)
plot(opt.range("upper"), "Upper", color=color.gray, style=plot.style_stepline)
plot(opt.range("lower"), "Lower", color=color.gray, style=plot.style_stepline)
```

## How it works

Range numbers are updated a few minutes at a time, not tick by tick.
