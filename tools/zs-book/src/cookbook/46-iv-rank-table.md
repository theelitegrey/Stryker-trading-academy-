---
title: IV rank readout
dek: A table with IV rank and put/call ratio (ZoroOptions data).
level: Beginner
---
```zscript
//@zscript 1
indicator("Options readout", overlay=true)
var t = table.new(position.top_right, 2, 2)
if barstate.islast
    table.cell(t, 0, 0, "IV rank")
    table.cell(t, 1, 0, str.tostring(opt.ivrank, "#.#"))
    table.cell(t, 0, 1, "Put/call")
    table.cell(t, 1, 1, str.tostring(opt.pc, "#.##"))
```

@chart cb-iv-rank-table

## How it works

Shows "NaN" style blanks when your plan lacks the data; the script still runs.
