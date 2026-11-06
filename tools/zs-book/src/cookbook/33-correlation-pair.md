---
title: Correlation with another symbol
dek: How closely two markets move together.
level: Advanced
---
```zscript
//@zscript 1
indicator("Correlation")
other = input.string("NQ1!", "Other symbol")
o = request.security(other, timeframe.period, close)
c = ta.correlation(close, o, 50)
hline(0)
plot(c, "Correlation (50 bars)", color=#00adb5)
```

## How it works

Near 1 they move together, near -1 they move opposite, near 0 they do not relate.
