---
title: Bollinger Bands with shading
dek: An average and a band of standard deviations.
level: Beginner
---
```zscript
//@zscript 1
indicator("Bands", overlay=true)
len = input.int(20, "Length")
mult = input.float(2.0, "Width", step=0.1)
[mid, up, lo] = ta.bb(close, len, mult)
p1 = plot(up, "Upper", color=#00adb5)
p2 = plot(lo, "Lower", color=#00adb5)
plot(mid, "Middle", color=color.gray)
fill(p1, p2, color.new(#00adb5, 92))
```

@chart cb-bollinger-bands

## How it works

`ta.bb` returns three values at once, so we take them apart with square brackets.
