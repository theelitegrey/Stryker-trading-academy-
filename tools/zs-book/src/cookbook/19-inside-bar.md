---
title: Inside bars
dek: Highlight bars within the previous bar's range.
level: Beginner
---
```zscript
//@zscript 1
indicator("Inside bar", overlay=true)
inside = high <= high[1] and low >= low[1]
barcolor(inside ? color.yellow : na)
```

@chart cb-inside-bar

## How it works

Returning `na` for a color leaves the candle alone.
