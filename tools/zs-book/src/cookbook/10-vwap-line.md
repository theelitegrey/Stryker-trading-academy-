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

@chart cb-vwap-line

## How it works

`ta.vwap` weights each bar's typical price by its volume and starts again each day (UTC). Pass `anchor="W"` or `"M"` for a weekly or monthly start.
