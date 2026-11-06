---
title: Opening range box
dek: Box the first bars of the session.
level: Advanced
---
```zscript
//@zscript 1
indicator("Opening range", overlay=true)
bars = input.int(6, "Bars in range", minval=1)
newDay = dayofmonth != dayofmonth[1]
var int count = 0
var float hi = na
var float lo = na
var box b = na
if newDay
    count := 1
    hi := high
    lo := low
    b := box.new(bar_index, high, bar_index, low, border_color=color.gray, bgcolor=color.new(color.gray, 90))
else if count < bars
    count += 1
    hi := math.max(hi, high)
    lo := math.min(lo, low)
    box.set_right(b, bar_index)
    box.set_top(b, hi)
    box.set_bottom(b, lo)
```

@chart cb-range-box

## How it works

Each new day starts a fresh box. For the first `bars` bars it grows to include every high and low.
