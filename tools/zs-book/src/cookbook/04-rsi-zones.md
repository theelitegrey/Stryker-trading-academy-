---
title: RSI with zones
dek: RSI with shaded 30 and 70 lines.
level: Beginner
---
```zscript
//@zscript 1
indicator("RSI zones")
len = input.int(14, "Length", minval=2)
r = ta.rsi(close, len)
top = hline(70)
bot = hline(30)
fill(top, bot, color.new(color.gray, 92))
plot(r, "RSI", color=#00adb5)
```

@chart cb-rsi-zones

## How it works

RSI measures how strong recent up moves are compared with down moves, on a 0 to 100 scale. 70 and 30 are common reference lines, not signals on their own.
