---
title: Getting started
dek: Open the editor, paste a script, see it on your chart. Five minutes.
---
Zscript is the small language you use on TradeZoro to build your own chart indicators. You write a few lines, press **Add to chart**, and your idea is drawn on the chart. It is free for everyone: writing, saving and publishing scripts.

If you know other chart scripting languages, Zscript will feel familiar. If you have never written a line of code, that is fine too. This manual starts at zero.

## What you can build

- Lines and histograms from price, such as moving averages and momentum.
- Marks on the chart, such as arrows when two lines cross.
- Colored backgrounds, boxes, lines and labels.
- Tables with numbers you care about.
- Alerts that fire when your rule is true.
- Indicators that use data most scripting languages do not have: the order book, order flow, GEX levels and ZoroOptions numbers. See [Our data](/zscript/our-data).

## Your first script

Open ZoroCharts, open the script editor panel, and choose **Zscript** as the language. Paste this:

```zscript
//@zscript 1
indicator("My first line", overlay=true)

average = ta.sma(close, 20)
plot(average, title="20-bar average", color=color.new(#03c988, 0), linewidth=2)
```

Press **Add to chart**. A green line appears on the price chart. It is the average of the last 20 closing prices, recalculated on every bar.

Here is what each line does:

1. `//@zscript 1` tells the editor this is a Zscript file, version 1. Always the first line.
2. `indicator(...)` names your script. `overlay=true` draws it on top of the price candles. Leave it out (or use `false`) to get a separate pane under the chart.
3. `average = ta.sma(close, 20)` makes a value called `average`. `ta.sma` is a built-in function: the simple moving average. `close` is the closing price of each bar.
4. `plot(...)` draws the value as a line.

## Change something

Edit the number `20` to `50` and press **Add to chart** again. The line gets smoother and slower. That is the whole loop: change, run, look.

## Where scripts live

Your scripts are saved in your account, next to your chart layout. You can keep as many as you like. Publishing one to the Script Library is optional and free; see [Publishing and selling](/zscript/publishing-and-selling).

## What to read next

- [Your first script, line by line](/zscript/anatomy-of-a-script) explains the shape of every script.
- [Bars and series](/zscript/bars-and-series) explains the one idea that makes everything else easy.
- The [Cookbook](/zscript/cookbook/) has working scripts you can copy and change.
