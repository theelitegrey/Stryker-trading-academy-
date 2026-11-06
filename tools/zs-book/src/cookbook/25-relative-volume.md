---
title: Relative volume
dek: Volume as a multiple of normal.
level: Beginner
---
```zscript
//@zscript 1
indicator("Relative volume")
rv = volume / ta.sma(volume, 30)
hline(1)
plot(rv, "Relative volume", style=plot.style_columns, color=rv > 1 ? #03c988 : color.gray)
```

## How it works

1.0 is normal. 2.0 means twice the 30-bar average.
