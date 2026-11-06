---
title: Inputs
dek: Let people tune your script without touching the code.
---
Anything you want to be changeable goes in an `input.*` call. Each one adds a control to your script's settings dialog.

| Call | Control | Example |
|---|---|---|
| `input.int` | whole number box | `input.int(14, "Length", minval=1)` |
| `input.float` | decimal box | `input.float(2.0, "Multiplier", step=0.1)` |
| `input.bool` | switch | `input.bool(true, "Show labels")` |
| `input.string` | text or a pick list | `input.string("EMA", "Type", options=["SMA","EMA"])` |
| `input.color` | color picker | `input.color(#03c988, "Line color")` |
| `input.source` | pick a price (close, hl2...) | `input.source(close, "Source")` |
| `input.timeframe` | timeframe picker | `input.timeframe("60", "Higher timeframe")` |

```zscript
//@zscript 1
indicator("Tunable bands", overlay=true)

src    = input.source(close, "Source")
len    = input.int(20, "Length", minval=2, maxval=500, group="Average")
mult   = input.float(2.0, "Width", minval=0.1, step=0.1, group="Average")
shade  = input.bool(true, "Shade between bands", group="Look")
tint   = input.color(#00adb5, "Tint", group="Look")

[mid, up, lo] = ta.bb(src, len, mult)
p1 = plot(up, color=tint)
p2 = plot(lo, color=tint)
plot(mid, color=color.gray)
fill(p1, p2, color=shade ? color.new(tint, 90) : na)
```

## Good habits

- Give every input a short, plain title and a sensible default. The default is what everyone sees first.
- Set `minval` and `maxval` so nobody can type 0 into a length.
- Use `group="..."` to keep long lists tidy.
- Add `tooltip="..."` to explain anything a newcomer would ask about.
- Inputs are read once per run. You cannot change an input while the script is running.
