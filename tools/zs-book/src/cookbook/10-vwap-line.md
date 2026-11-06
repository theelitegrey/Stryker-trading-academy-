---
title: Session VWAP
dek: Average price weighted by volume.
level: Beginner
---
```zscript
//@zscript 1
indicator("VWAP", overlay=true)
plot(ta.vwap(hlc3), "VWAP", color=#03c988, linewidth=2)
```

## How it works

`ta.vwap` weights each bar's typical price by its volume and resets at the start of each session.
