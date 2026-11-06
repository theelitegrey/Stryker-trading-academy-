---
title: Order book imbalance
dek: Which side has more resting size (Pro data).
level: Intermediate
---
```zscript
//@zscript 1
indicator("Book imbalance")
n = input.int(10, "Levels", minval=1, maxval=40)
imb = book.imbalance(n)
hline(0)
plot(imb, "Imbalance", style=plot.style_columns, color=imb >= 0 ? color.green : color.red)
```

## How it works

Above zero means more size resting on the bid side. Without a plan that includes the data, or on a symbol with no depth feed, this shows nothing and a one-time notice explains why.
