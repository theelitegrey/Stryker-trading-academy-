---
title: GEX levels
dek: Call wall, put wall and flip as lines (GEX+ data).
level: Beginner
---
```zscript
//@zscript 1
indicator("GEX levels", overlay=true)
plot(gex.callwall, "Call wall", color=color.green, style=plot.style_stepline)
plot(gex.putwall, "Put wall", color=color.red, style=plot.style_stepline)
plot(gex.flip, "Flip", color=color.yellow, style=plot.style_stepline)
```

## How it works

The levels come from the latest GEX+ update, not an instant feed. For ES and NQ they follow the GEX+ page mapping.
