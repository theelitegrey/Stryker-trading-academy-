---
title: On-balance volume
dek: A running volume total that follows direction.
level: Beginner
---
```zscript
//@zscript 1
indicator("OBV")
plot(ta.obv, "OBV", color=#03c988)
```

@chart cb-obv

## How it works

Volume is added on up closes and subtracted on down closes. Look at the shape, not the number.
