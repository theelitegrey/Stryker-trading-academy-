---
title: Build four indicators step by step
dek: Four short projects. Each one grows in small steps, and each step runs.
---
The best way to learn is to build. Here are four indicators, from small to bigger. Type each step in and watch it grow.

## Project 1. A trend ribbon

Goal: a line that is green in an up-trend and red in a down-trend.

**Step 1.** Draw the average.

```zscript
//@zscript 1
indicator("Ribbon, step 1", overlay=true)
mid = ta.ema(close, 21)
plot(mid)
```

**Step 2.** Decide the trend: price above the average means up.

```zscript
//@zscript 1
indicator("Ribbon, step 2", overlay=true)
mid = ta.ema(close, 21)
up = close > mid
plot(mid, color=up ? color.green : color.red, linewidth=2)
```

**Step 3.** Make the length a setting and add a soft band using ATR.

```zscript
//@zscript 1
indicator("Trend ribbon", overlay=true)
len = input.int(21, "Length", minval=2)
width = input.float(1.0, "Band width in ATRs", minval=0.1, step=0.1)
mid = ta.ema(close, len)
rng = ta.atr(14) * width
up = close > mid
tone = up ? color.green : color.red
p1 = plot(mid + rng, "Upper", color=color.new(tone, 80))
p2 = plot(mid - rng, "Lower", color=color.new(tone, 80))
plot(mid, "Middle", color=tone, linewidth=2)
fill(p1, p2, color.new(tone, 92))
```

You just used inputs, a condition, a color choice and a fill. That is most of the language.

## Project 2. Previous day levels

Goal: draw yesterday's high, low and close as flat lines on a small chart.

**Step 1.** Ask for the daily values. `[1]` means the last finished day.

```zscript
//@zscript 1
indicator("Prior day, step 1", overlay=true)
pdh = request.security(syminfo.tickerid, "D", high[1])
plot(pdh, "Prior day high", color=color.green, style=plot.style_stepline)
```

**Step 2.** Add the low and the close, and label the newest bar.

```zscript
//@zscript 1
indicator("Prior day levels", overlay=true)
pdh = request.security(syminfo.tickerid, "D", high[1])
pdl = request.security(syminfo.tickerid, "D", low[1])
pdc = request.security(syminfo.tickerid, "D", close[1])
plot(pdh, "Prior day high", color=color.green, style=plot.style_stepline)
plot(pdl, "Prior day low", color=color.red, style=plot.style_stepline)
plot(pdc, "Prior day close", color=color.gray, style=plot.style_stepline)

if barstate.islast
    label.new(bar_index, pdh, "PDH", style=label.style_label_left, color=color.green, textcolor=color.white)
    label.new(bar_index, pdl, "PDL", style=label.style_label_left, color=color.red, textcolor=color.white)
```

## Project 3. A volume pressure panel

Goal: a pane that shows how much of each bar's volume was at the ask, with a smoothed line. Needs order flow data, which follows your plan.

**Step 1.** The share of buying volume, per bar.

```zscript
//@zscript 1
indicator("Buy share, step 1")
share = flow.buyvol / (flow.buyvol + flow.sellvol) * 100
hline(50)
plot(share, "Buy share %", style=plot.style_columns, color=color.gray)
```

**Step 2.** Color by side and add a smooth line.

```zscript
//@zscript 1
indicator("Buy share")
share = flow.buyvol / (flow.buyvol + flow.sellvol) * 100
hline(50)
plot(share, "Buy share %", style=plot.style_columns, color=share >= 50 ? color.new(color.green, 40) : color.new(color.red, 40))
plot(ta.ema(share, 10), "Smoothed", color=color.white, linewidth=2)
```

When the plan lacks order flow data, `share` is `na`, nothing draws, and you see a short notice. The script itself is fine.

## Project 4. A level board with alerts

Goal: show GEX levels as lines, a small table with the distance to each, and an alert when price crosses the flip level.

```zscript
//@zscript 1
indicator("Level board", overlay=true)

plot(gex.callwall, "Call wall", color=color.green, style=plot.style_stepline)
plot(gex.putwall, "Put wall", color=color.red, style=plot.style_stepline)
plot(gex.flip, "Flip", color=color.yellow, style=plot.style_stepline)

var t = table.new(position.top_right, 2, 3)
if barstate.islast
    table.cell(t, 0, 0, "To call wall")
    table.cell(t, 1, 0, str.tostring(gex.callwall - close, "#.##"))
    table.cell(t, 0, 1, "To put wall")
    table.cell(t, 1, 1, str.tostring(close - gex.putwall, "#.##"))
    table.cell(t, 0, 2, "To flip")
    table.cell(t, 1, 2, str.tostring(close - gex.flip, "#.##"))

alertcondition(ta.crossover(close, gex.flip), "Crossed above flip", "Price crossed above the flip level")
alertcondition(ta.crossunder(close, gex.flip), "Crossed below flip", "Price crossed below the flip level")
```

GEX levels are updated a few minutes at a time, so this board shows the latest update, not an instant feed. Education only. Not financial advice.

## Where to go from here

Open the [Cookbook](/zscript/cookbook/) and change a recipe. Then try your own idea. When it works, think about [publishing](/zscript/publishing-and-selling) it.
