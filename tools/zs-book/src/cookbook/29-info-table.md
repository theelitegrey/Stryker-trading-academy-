---
title: Info table
dek: A small table with key numbers.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Info table", overlay=true)
var t = table.new(position.top_right, 2, 3)
if barstate.islast
    table.cell(t, 0, 0, "ATR(14)")
    table.cell(t, 1, 0, str.tostring(ta.atr(14), "#.##"))
    table.cell(t, 0, 1, "RSI(14)")
    table.cell(t, 1, 1, str.tostring(ta.rsi(close, 14), "#.#"))
    table.cell(t, 0, 2, "Volume")
    table.cell(t, 1, 2, str.tostring(volume, "#"))
```

## How it works

The indicator functions are called on every bar (as they must be) and the table is only written on the last bar.
