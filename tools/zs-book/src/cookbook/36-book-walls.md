---
title: Nearest book walls
dek: Draw the nearest big resting levels (Pro data).
level: Advanced
---
```zscript
//@zscript 1
indicator("Book walls", overlay=true)
minSize = input.int(500, "Minimum size", minval=1)
plot(book.wall(book.side_bid, minSize), "Bid wall", color=color.green, style=plot.style_stepline)
plot(book.wall(book.side_ask, minSize), "Ask wall", color=color.red, style=plot.style_stepline)
```

@chart cb-book-walls

## How it works

A wall is a single price level with at least `minSize` resting. Walls can be pulled at any time, so treat them as information, not a promise.
