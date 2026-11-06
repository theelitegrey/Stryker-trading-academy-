---
title: Our data
dek: Order book, order flow, GEX levels and ZoroOptions numbers, inside your script.
---
Most scripting languages stop at price and volume. Zscript can also read the extra data TradeZoro already shows on its charts. Each kind lives in its own namespace.

| Namespace | What it is | Plan |
|---|---|---|
| `book.*` | Order book (level 2): resting orders above and below price | Pro |
| `flow.*` | Order flow: trades, delta, big trades, footprint, volume profile | Pro |
| `gex.*` | GEX+ levels: call wall, put wall, flip, zero gamma | GEX+ |
| `opt.*` | ZoroOptions summary: gamma nodes, ranges, IV rank, max pain | Pro |

Your script gets the data your plan gives you on the chart, no more. When your plan does not include a data kind, the call returns `na` and you see one short notice on the chart, once. The script keeps running; the rest of your lines still draw.

## No peeking

Every value is the value known **at that bar**. There is no way to read a future bar, so a script that uses this data looks the same live and in Replay. Order book, GEX and options numbers are snapshots: a snapshot is stored at some time and used for the bars that follow it, until the next one arrives. For GEX and ZoroOptions numbers, treat them as "updated a few minutes ago", never as an instant live feed.

## Order book: book

```text
book.bid(level)        price of the bid at depth `level` (0 = best)
book.ask(level)        price of the ask at depth `level`
book.bidsize(level)    size resting there
book.asksize(level)    size resting there
book.depth(side, n)    total size in the best n levels of a side (book.side_bid or book.side_ask)
book.imbalance(n)      (bid depth - ask depth) / (bid depth + ask depth) in the best n levels, -1 to 1
book.wall(side, minSize)  price of the nearest level with at least minSize resting (side is book.side_bid or book.side_ask)
book.heat(price)       size resting at that price (nearest level within one tick)
```

Available where we have a depth feed: the futures hub and the supported crypto venues. On other symbols you get `na` and a notice.

```zscript
//@zscript 1
indicator("Book imbalance", overlay=false)

imb = book.imbalance(10)
plot(imb, "Imbalance (10 levels)", style=plot.style_columns, color=imb >= 0 ? color.green : color.red)
hline(0)
```

## Order flow: flow

```text
flow.buyvol, flow.sellvol    volume that traded at the ask / at the bid, per bar
flow.delta                   buyvol - sellvol for the bar
flow.cvd                     running total of delta
flow.trades                  number of trades in the bar
flow.bigtrades(minSize)      count of single trades of at least minSize
flow.footprint(price)        volume traded at one price level inside the bar
flow.bigtrades_vol(minSize)  total size of those big trades
flow.poc, flow.vah, flow.val point of control, value area high and low of the bar
```

```zscript
//@zscript 1
indicator("Delta and CVD")

plot(flow.delta, "Delta", style=plot.style_columns, color=flow.delta >= 0 ? color.green : color.red)
plot(flow.cvd, "CVD", color=color.white)
```

## GEX levels: gex

```text
gex.callwall   strike with the largest call gamma
gex.putwall    strike with the largest put gamma
gex.flip       gamma flip level
gex.zero_upper, gex.zero_lower   the two zero-gamma levels around price
gex.net        net gamma number
gex.level(n)   the nth strongest level (0 = strongest)
gex.updated    when the levels were computed (ms)
```

ES and NQ use the same mapping as the GEX+ page.

```zscript
//@zscript 1
indicator("GEX walls", overlay=true)

plot(gex.callwall, "Call wall", color=color.green, style=plot.style_stepline)
plot(gex.putwall, "Put wall", color=color.red, style=plot.style_stepline)
plot(gex.flip, "Flip", color=color.yellow, style=plot.style_stepline)
```

## ZoroOptions: opt

```text
opt.node(n)      price of the nth gamma node
opt.range(kind)  a pair [low, high] for kind "day", "week" or "expected"
opt.ivrank       IV rank, 0 to 100
opt.pc           put/call ratio
opt.maxpain      max pain strike
opt.zone         the current zone label
opt.updated      when the data was computed (ms): show it as "updated X min ago"
```

```zscript
//@zscript 1
indicator("Option ranges", overlay=true)

[lo, hi] = opt.range("expected")
plot(hi, "Range high", color=color.gray, style=plot.style_stepline)
plot(lo, "Range low", color=color.gray, style=plot.style_stepline)
```

## Handling "no data"

Because these calls return `na` when data is missing, protect your math with `nz` or `na()`:

```zscript
//@zscript 1
indicator("Safe delta", overlay=false)

d = nz(flow.delta, 0)
plot(d, "Delta (0 when no data)", style=plot.style_columns)
```

Education only. Data samples in this manual are labelled "Sample" and are not results.
