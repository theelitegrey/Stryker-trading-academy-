---
title: Gamma nodes with GEX walls
dek: Combine two data kinds in one script (GEX+ and ZoroOptions data).
level: Advanced
---
```zscript
//@zscript 1
indicator("Nodes and walls", overlay=true)
plot(opt.node(1), "Node 1", color=color.purple, style=plot.style_stepline)
plot(opt.node(2), "Node 2", color=color.purple, style=plot.style_stepline)
plot(gex.callwall, "Call wall", color=color.green, style=plot.style_stepline)
plot(gex.putwall, "Put wall", color=color.red, style=plot.style_stepline)
```

## How it works

Each data kind follows your plan on its own. If one is missing, only its lines go blank.
