---
title: Volume spike marks
dek: Mark bars with unusually high volume.
level: Beginner
---
```zscript
//@zscript 1
indicator("Volume spikes")
mult = input.float(2.0, "Times the average", step=0.1)
avg = ta.sma(volume, 20)
spike = volume > avg * mult
plot(volume, "Volume", style=plot.style_columns, color=spike ? color.orange : color.gray)
plot(avg, "Average", color=color.white)
```

## How it works

Orange columns are bars where volume was more than `mult` times its 20-bar average.
