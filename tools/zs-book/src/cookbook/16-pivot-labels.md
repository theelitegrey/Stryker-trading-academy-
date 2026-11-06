---
title: Swing high and low labels
dek: Mark pivots after they are confirmed.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Pivots", overlay=true)
n = input.int(5, "Bars each side", minval=1, maxval=20)
ph = ta.pivothigh(high, n, n)
pl = ta.pivotlow(low, n, n)
if not na(ph)
    label.new(bar_index - n, ph, "H", style=label.style_label_down, color=color.red, textcolor=color.white)
if not na(pl)
    label.new(bar_index - n, pl, "L", style=label.style_label_up, color=color.green, textcolor=color.white)
```

@chart cb-pivot-labels

## How it works

A pivot needs `n` bars on each side to be sure, so it is only known `n` bars later. That is why the label is placed at `bar_index - n`: it goes back to where the pivot really was, without ever using a future bar.
