---
title: Decisions and loops
dek: if, switch, for, while, and how to keep loops short.
---
## if / else

```zscript
//@zscript 1
indicator("Trend color", overlay=true)

fast = ta.ema(close, 9)
slow = ta.ema(close, 21)

lineColor = color.gray
if fast > slow
    lineColor := color.green
else if fast < slow
    lineColor := color.red

plot(fast, color=lineColor, linewidth=2)
```

`if` can also give back a value:

```zs-snippet
label1 = if close > open
    "up"
else
    "down"
```

## switch

Pick one branch out of several by value:

```zscript
//@zscript 1
indicator("Pick an average", overlay=true)

kind = input.string("EMA", "Type", options=["SMA", "EMA", "WMA"])
len = input.int(20, "Length")

line1 = switch kind
    "SMA" => ta.sma(close, len)
    "WMA" => ta.wma(close, len)
    => ta.ema(close, len)

plot(line1)
```

The lone `=>` is the default branch.

## for loops

`for` counts from one number to another. Use it to look at the last few bars one by one.

```zscript
//@zscript 1
indicator("Count higher closes")

n = input.int(10, "Look at last", minval=1, maxval=50)
higher = 0
for i = 0 to n - 1
    if close[i] > close[i + 1]
        higher += 1

plot(higher, style=plot.style_columns)
```

`for x in myArray` walks the items of an array.

## while

```zs-snippet
n = 0
while n < 10 and close[n] > open[n]
    n += 1
```

## Keep loops short

Zscript runs your script on every bar, so a loop that runs 500 times does 500 times the work on every one of thousands of bars. Two safeguards protect you and everyone else:

- A loop has a maximum number of turns per bar, and your script has a maximum amount of work per bar. Hit either and the script stops with a clear message on the line that went too far.
- The first run must finish in 20 seconds.

When you can, use the built-in functions such as `ta.highest` or `ta.sma`: they are faster than the same logic in a loop. More in [Limits](/zscript/limits).

`break` leaves a loop early. `continue` skips to the next turn.
