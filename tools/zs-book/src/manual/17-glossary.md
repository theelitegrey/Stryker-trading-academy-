---
title: Glossary
dek: Every word used in this manual, in plain English.
---
**Alert.** A rule that tells you when it becomes true.

**Array.** A list of values you fill and read yourself.

**ATR.** Average true range: the typical size of a bar.

**Bar.** One candle: its open, high, low, close and volume.

**Bar index.** The number of a bar, counting from 0 at the oldest.

**Bool.** A value that is `true` or `false`.

**Built-in.** A function or value that comes with Zscript, such as `ta.sma` or `close`.

**CVD.** Cumulative volume delta: the running total of delta.

**Declaration.** The `indicator(...)` line that names the script.

**Delta.** Volume traded at the ask minus volume traded at the bid.

**Drawing.** A label, line, box or table that you create and can change or delete.

**Footprint.** Volume traded at each price level inside a bar.

**Function.** A named piece of logic, such as `ta.sma` or one you write yourself.

**GEX.** Gamma exposure: a way of summarising option positions into price levels.

**Header.** The first line, `//@zscript 1`.

**History.** Older values of a series, read with `[n]`.

**Input.** A setting the person using the script can change.

**Level two (L2).** The order book: resting buy and sell orders at each price.

**na.** "Not available": no value on this bar.

**Namespace.** A group of built-ins sharing a prefix, such as `ta.` or `book.`.

**Overlay.** Drawing on the price chart instead of in a separate pane.

**Pane.** A chart area. Price is one pane; an indicator with `overlay=false` gets its own.

**Pivot.** A swing high or low, confirmed by bars on both sides.

**Plot.** A line, histogram or other shape with one value per bar.

**Plan.** Your TradeZoro plan, which decides which data kinds your scripts can read.

**Protected script.** A published script that people can use but not read.

**Series.** A value that has one number per bar and keeps its history.

**Tuple.** Several values returned together, taken apart with `[a, b] = f()`.

**var.** A keyword that makes a value remember itself from bar to bar.

**ZoroOptions.** TradeZoro's options summary: gamma nodes, ranges, IV rank and more.
