---
title: Anatomy of a script
dek: The four parts every Zscript has, and the rules for spelling them.
---
Every script has the same four parts, always in this order.

1. The **header**: `//@zscript 1`.
2. The **declaration**: one `indicator(...)` call.
3. The **inputs**: settings the person using your script can change.
4. The **logic and drawing**: calculations, then `plot` and friends.

```zscript
//@zscript 1
indicator("Anatomy demo", overlay=false)

length = input.int(14, "Length", minval=2)
momentum = ta.rsi(close, length)

plot(momentum, "RSI")
hline(70)
hline(30)
```

## Comments

Anything after `//` on a line is a comment. The computer ignores it. Use comments to remind yourself why, not what.

```zs-snippet
// this line is ignored
x = close // so is this part
```

## Names

Names of values may use letters, digits and `_`, and cannot start with a digit. Names are case sensitive: `Length` and `length` are two different things. Pick names a stranger could read: `fastLength` beats `a1`.

## Lines and blocks

One statement per line. Code that belongs together is indented under its header, with two or four spaces. The indent is how Zscript knows where a block ends.

```zs-snippet
up = close > open
bgcolor(up ? color.new(#03c988, 85) : na)
```

A long line can break after an operator or a comma. Indent the continuation by at least one more level than the line it continues.

## Running order

Your script is not run once. It is run **once for every bar** on the chart, from the oldest bar to the newest, and again on every tick of the newest bar. Every line sees the world as it was at that bar. The next chapter shows why this matters.

## The declaration

`indicator()` takes a title and a few optional settings.

| Setting | What it does |
|---|---|
| `title` | The name shown on the chart and in the list. |
| `overlay` | `true` draws on the price chart. `false` (default) uses its own pane. |
| `max_bars_back` | How far back your script may look. Leave it alone unless you see an error asking for it. |

A script has exactly one `indicator()` call, and it must come before any drawing.
