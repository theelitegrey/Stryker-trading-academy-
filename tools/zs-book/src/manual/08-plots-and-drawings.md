---
title: Plots and drawings
dek: Lines, histograms, marks, colored bars, labels, lines, boxes and tables.
---
## plot

`plot(series, title, color, linewidth, style)` draws one value per bar.

Styles: `plot.style_line` (default), `plot.style_histogram`, `plot.style_columns`, `plot.style_area`, `plot.style_circles`, `plot.style_stepline`, `plot.style_cross`.

```zscript
//@zscript 1
indicator("Volume with color")

up = close >= open
plot(volume, "Volume", color=up ? color.green : color.red, style=plot.style_columns)
```

A color can differ bar by bar, as above.

## hline and fill

`hline(price)` draws a flat line across the pane. `fill(a, b, color)` shades between two plots or two hlines.

```zscript
//@zscript 1
indicator("RSI zone")

r = ta.rsi(close, 14)
top = hline(70)
bot = hline(30)
fill(top, bot, color.new(color.gray, 90))
plot(r, "RSI")
```

## Marks on bars

`plotshape(condition, title, shape, location)` puts a small shape on every bar where the condition is true. `plotchar` does the same with a letter or symbol. `plotarrow` draws an arrow whose length follows a number.

```zscript
//@zscript 1
indicator("Cross marks", overlay=true)

fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
plot(fast)
plot(slow)
plotshape(ta.crossover(fast, slow), "Cross up", shape.triangleup, location.belowbar, color.green)
plotshape(ta.crossunder(fast, slow), "Cross down", shape.triangledown, location.abovebar, color.red)
```

## Coloring the chart itself

`bgcolor(color)` tints the pane background on a bar. `barcolor(color)` recolors the candle. `plotcandle(o, h, l, c)` draws your own candles.

```zscript
//@zscript 1
indicator("Inside bars", overlay=true)

inside = high < high[1] and low > low[1]
barcolor(inside ? color.yellow : na)
bgcolor(inside ? color.new(color.yellow, 90) : na)
```

## Labels, lines, boxes and tables

These are **drawings**. Unlike a plot, they are objects you create, move and delete. Each has a `.new` call and `set_` calls to change it.

```zscript
//@zscript 1
indicator("Swing labels", overlay=true)

ph = ta.pivothigh(high, 5, 5)
pl = ta.pivotlow(low, 5, 5)
if not na(ph)
    label.new(bar_index - 5, ph, "H", style=label.style_label_down, color=color.red, textcolor=color.white)
if not na(pl)
    label.new(bar_index - 5, pl, "L", style=label.style_label_up, color=color.green, textcolor=color.white)
```

```zscript
//@zscript 1
indicator("Today's range box", overlay=true)

var box rangeBox = na
if dayofmonth != dayofmonth[1]
    rangeBox := box.new(bar_index, high, bar_index, low, border_color=color.gray, bgcolor=color.new(color.gray, 90))
else
    box.set_right(rangeBox, bar_index)
    box.set_top(rangeBox, math.max(box.get_top(rangeBox), high))
    box.set_bottom(rangeBox, math.min(box.get_bottom(rangeBox), low))
```

```zscript
//@zscript 1
indicator("Info table", overlay=true)

var t = table.new(position.top_right, 2, 2)
if barstate.islast
    table.cell(t, 0, 0, "Close")
    table.cell(t, 1, 0, str.tostring(close, "#.##"))
    table.cell(t, 0, 1, "Volume")
    table.cell(t, 1, 1, str.tostring(volume, "#"))
```

`line.new(x1, y1, x2, y2)` draws a segment. `line.delete(id)` removes it. Each kind has `get_` and `set_` calls, and a `*.delete` call. The reference lists them all.

## Drawing limits

Each kind of drawing has a maximum count on screen (labels, lines, boxes, tables). When you go over, the oldest ones are removed first. If you create drawings in a loop, delete the ones you no longer need. See [Limits](/zscript/limits).
