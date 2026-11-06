---
title: Money flow index
dek: RSI that includes volume.
level: Intermediate
---
```zscript
//@zscript 1
indicator("MFI")
hline(80)
hline(20)
plot(ta.mfi(hlc3, 14), "MFI", color=color.purple)
```

@chart cb-mfi

## How it works

Like RSI, but each bar counts more when volume was high.
