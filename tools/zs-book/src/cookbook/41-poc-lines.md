---
title: POC and value area
dek: Point of control with value area edges (Pro data).
level: Intermediate
---
```zscript
//@zscript 1
indicator("POC and value area", overlay=true)
plot(flow.poc, "POC", color=color.yellow, style=plot.style_stepline)
p1 = plot(flow.vah, "VAH", color=color.gray, style=plot.style_stepline)
p2 = plot(flow.val, "VAL", color=color.gray, style=plot.style_stepline)
fill(p1, p2, color.new(color.gray, 94))
```

@chart cb-poc-lines

## How it works

The price with the most volume in the bar, and the range holding most of the volume.
