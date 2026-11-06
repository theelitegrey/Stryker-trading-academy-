---
title: Above or below the flip
dek: Tint the background by gamma regime (GEX+ data).
level: Intermediate
---
```zscript
//@zscript 1
indicator("Flip regime", overlay=true)
f = gex.flip
bgcolor(na(f) ? na : close > f ? color.new(color.green, 94) : color.new(color.red, 94))
```

## How it works

Green above the flip level, red below. No tint when there is no data.
