---
title: Option range edges
dek: The expected range as two lines (ZoroOptions data).
level: Beginner
---
```zscript
//@zscript 1
indicator("Option range", overlay=true)
[lo, hi] = opt.range("expected")
plot(hi, "Upper", color=color.gray, style=plot.style_stepline)
plot(lo, "Lower", color=color.gray, style=plot.style_stepline)
```

@chart cb-options-range

## How it works

Range numbers are updated a few minutes at a time, not tick by tick.
