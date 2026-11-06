---
title: Bars and series
dek: The one idea behind every indicator. A value that has a history.
---
## One run per bar

A chart is a row of bars. Zscript runs your whole script for each bar. When it is working on bar number 500, `close` means "the close of bar 500". When it moves on to bar 501, `close` now means that bar's close.

A value that changes bar by bar is called a **series**. `open`, `high`, `low`, `close`, `volume` and `time` are series that exist in every script. Anything you calculate from a series is a series too.

## Looking back

To see an older value of a series, put a number in square brackets after it. `close[1]` is the close one bar ago, `close[2]` is two bars ago, and so on.

```zscript
//@zscript 1
indicator("Bar change")

change1 = close - close[1]
plot(change1, "Change since last bar", style=plot.style_histogram)
```

On the very first bar there is no bar before it, so `close[1]` has no value. Zscript calls "no value" **na** (not available). Any math with `na` gives `na`, and a plot skips `na` bars. That is by design: no value means no line, not a wrong line.

You can test for it and fix it:

```zs-snippet
prev = nz(close[1], close)   // use close itself when there is no older bar
isMissing = na(close[1])
```

`nz(x, replacement)` swaps `na` for the replacement (or 0 if you leave it out). `na(x)` is `true` when x is missing.

## Remembering across bars with var

An ordinary value is recalculated from scratch on each bar. To keep a number alive from bar to bar, declare it with `var`. A `var` is set once, on the first bar, and keeps whatever you assign to it after that.

```zscript
//@zscript 1
indicator("Count green bars")

var int greens = 0
if close > open
    greens := greens + 1

plot(greens, "Green bars so far")
```

Two things to notice. First, `:=` changes an existing value; a single `=` creates a new one. Second, `greens` never resets, so the plot only goes up.

## Realtime bars: var and varip

On historical bars each bar runs once. The newest bar runs again on every tick. A plain `var` is rolled back to its value from the end of the last finished bar before each tick, so history and live look the same. Use `varip` only when you truly need a value to survive between ticks of the same bar, for example to count ticks.

```zscript
//@zscript 1
indicator("Ticks on this bar")

varip int ticks = 0
if barstate.isnew
    ticks := 0
ticks := ticks + 1
plot(ticks)
```

On finished history bars this plots 1, because each bar runs once. On the live bar it counts up.

## Series are not arrays

A series is "one value per bar". An **array** is a list you fill and read yourself, on a single bar. Both exist; see [Types and values](/zscript/types-and-values).

## Rules of thumb

- Think in terms of "what is true on this bar".
- Use `[n]` to look at the past, never the future. Zscript has no way to read a bar that has not happened yet. That is on purpose, and the same rule holds for order book, order flow, GEX and options numbers: you only see what was known at that bar.
- Use `var` when something must be remembered.
