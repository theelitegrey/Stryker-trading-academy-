---
title: Patterns every scripter uses
dek: Ten small habits that make scripts shorter, faster and correct.
---
Once you know the pieces, a few patterns turn up again and again. Learn these and most scripts write themselves.

## 1. Compute first, decide after

Work out every indicator at the top of the script, on every bar. Then use the finished numbers inside `if` and `switch`. This keeps each `ta` function's memory complete.

```zscript
//@zscript 1
indicator("Compute first", overlay=true)
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
trendUp = fast > slow

plot(trendUp ? fast : slow, "Active line", color=trendUp ? color.green : color.red)
```

## 2. Use `na` to mean "draw nothing"

A plot cannot sit inside an `if`. Instead make the value `na` on the bars where you want nothing.

```zscript
//@zscript 1
indicator("Only when quiet", overlay=false)
r = (high - low) / close * 100
quiet = r < ta.sma(r, 20) * 0.7
plot(quiet ? r : na, "Quiet bars", style=plot.style_columns, color=color.gray)
```

## 3. A flag that flips

Remember the last state with `var` and change it only when something happens.

```zscript
//@zscript 1
indicator("Last cross direction", overlay=true)
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
var int dir = 0
if ta.crossover(fast, slow)
    dir := 1
if ta.crossunder(fast, slow)
    dir := -1
bgcolor(dir == 1 ? color.new(color.green, 94) : dir == -1 ? color.new(color.red, 94) : na)
```

## 4. Remember a price at the signal

`ta.valuewhen` hands you the value a series had when a condition was last true.

```zscript
//@zscript 1
indicator("Price at last cross", overlay=true)
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
lastCrossPrice = ta.valuewhen(ta.cross(fast, slow), close, 0)
plot(lastCrossPrice, "Close at last cross", color=color.yellow, style=plot.style_stepline)
```

## 5. Normalize so scripts work on any symbol

Divide by price or by ATR so your numbers mean the same on every market.

```zscript
//@zscript 1
indicator("Move in ATRs")
move = (close - close[10]) / ta.atr(14)
hline(0)
plot(move, "10-bar move in ATRs", style=plot.style_histogram, color=move >= 0 ? color.green : color.red)
```

## 6. Smooth a noisy value

```zscript
//@zscript 1
indicator("Smoothed volume")
plot(volume, "Volume", style=plot.style_columns, color=color.new(color.gray, 60))
plot(ta.ema(volume, 10), "Smoothed", color=color.orange)
```

## 7. Limit how many drawings you make

Create a drawing only when it is new, and delete old ones.

```zscript
//@zscript 1
indicator("One line for the latest high", overlay=true)
var line hiLine = na
ph = ta.pivothigh(high, 5, 5)
if not na(ph)
    line.delete(hiLine)
    hiLine := line.new(bar_index - 5, ph, bar_index, ph, extend=extend.right, color=color.red)
```

## 8. Draw the summary only on the last bar

```zscript
//@zscript 1
indicator("Last bar summary", overlay=true)
upBars = ta.sma(close > open ? 1.0 : 0.0, 50) * 100
if barstate.islast
    label.new(bar_index, high, "Up bars: " + str.tostring(upBars, "#") + "%", style=label.style_label_down)
```

## 9. Reuse with a function

If you write the same three lines twice, make a function.

```zscript
//@zscript 1
indicator("Two stochastics")
stoch1(len) => ta.stoch(close, high, low, len)
plot(stoch1(14), "Slow", color=color.blue)
plot(stoch1(5), "Fast", color=color.orange)
```

## 10. Guard data calls

Every call into `book`, `flow`, `gex` and `opt` can return `na`. Use `nz` when a missing value should count as zero, and `na()` when it should mean "skip".

```zscript
//@zscript 1
indicator("Guarded delta")
d = flow.delta
plot(na(d) ? na : d, "Delta", style=plot.style_columns, color=nz(d) >= 0 ? color.green : color.red)
```
