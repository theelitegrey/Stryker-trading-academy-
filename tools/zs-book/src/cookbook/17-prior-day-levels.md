---
title: Previous day high and low
dek: Lines from yesterday's range.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Prior day", overlay=true)
pdh = request.security(syminfo.tickerid, "D", high[1])
pdl = request.security(syminfo.tickerid, "D", low[1])
plot(pdh, "Prior high", color=color.green, style=plot.style_stepline)
plot(pdl, "Prior low", color=color.red, style=plot.style_stepline)
```

## How it works

`request.security` asks for a value from another timeframe. `[1]` on the daily series means "the last finished day", which keeps it free of look-ahead.
