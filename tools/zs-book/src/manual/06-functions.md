---
title: Functions
dek: Name a piece of logic once, use it everywhere.
---
## One-line functions

```zscript
//@zscript 1
indicator("Typical price band", overlay=true)

typical(h, l, c) => (h + l + c) / 3
band(x, pct) => x * (1 + pct / 100)

tp = typical(high, low, close)
plot(tp)
plot(band(tp, 1.0))
plot(band(tp, -1.0))
```

## Functions with several lines

The last line is the value the function gives back.

```zscript
//@zscript 1
indicator("Smoothed range", overlay=false)

smoothRange(len) =>
    r = high - low
    avg = ta.sma(r, len)
    avg * 100 / close

plot(smoothRange(14), "Range as % of price")
```

## Returning more than one value

```zscript
//@zscript 1
indicator("Two bands", overlay=true)

channel(len) =>
    top = ta.highest(high, len)
    bottom = ta.lowest(low, len)
    [top, bottom]

[t, b] = channel(20)
plot(t)
plot(b)
```

## Things to know

- A function must be defined before the line that uses it.
- Functions see the series history of what you pass in: inside `f(x)`, `x[1]` is the previous bar's value of whatever you passed.
- A function that calls `ta.*` functions should be called on every bar, not only inside an `if`. The `ta` functions keep a running history, and skipping bars gives wrong answers. Zscript warns you when it spots this.
- Functions cannot call themselves.
