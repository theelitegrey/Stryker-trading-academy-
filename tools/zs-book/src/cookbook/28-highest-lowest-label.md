---
title: Label the day's high
dek: Write the high of the day on the newest bar.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Day high label", overlay=true)
var float dayHigh = na
if ta.change(time("D")) != 0
    dayHigh := high
else
    dayHigh := math.max(dayHigh, high)
if barstate.islast
    label.new(bar_index, dayHigh, "Day high " + str.tostring(dayHigh, "#.##"), style=label.style_label_left)
```

## How it works

Drawing only on `barstate.islast` keeps the script light: one label, not thousands.
