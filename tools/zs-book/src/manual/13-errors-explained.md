---
title: Errors explained
dek: What the messages mean and how to fix them.
---
When something is wrong, Zscript tells you the **line and column**, says what happened in plain English, and when it can, suggests a fix ("Did you mean ...?").

## The three kinds

- **Errors** stop the script from running. The editor underlines the spot in red.
- **Warnings** let it run but point at something risky. Underlined in amber.
- **Notices** are short one-time notes on the chart, such as "Order book data needs Pro".

## Common errors

Messages below are written the way the engine words them. Your names and numbers fill the gaps. Every code is listed in [Error and warning codes](/zscript/error-codes).

### E303 Unknown name

```text
3:11  E303  Unknown name `smaa`.
            Did you mean `ta.sma`?
```
A typo. Names are case sensitive, and every built-in sits inside a namespace (`ta.`, `math.`, `str.`).

### E309 Wrong type for an argument

```text
5:8   E309  Argument `title` of `plot` must be string, got float.
```
You passed a number where text goes. Check the order of the arguments, or name them: `plot(x, title="Mine")`.

### E201 Missing header

```text
1:1   E201  Missing header.
            Put `//@zscript 1` on the first line.
```
Add the header line. Then make sure there is exactly one `indicator(...)` (E301 means it is missing, E302 means there are two).

### E105 and E205 Indentation

```text
6:1   E105  Indentation does not match any outer block.
```
Indent only under `if`, `for`, `while`, `switch` and function bodies, and line up the lines of one block exactly.

### E305 Already declared

```text
7:5   E305  `greens` is already declared in this scope.
            Use `:=` to change it.
```
A single `=` makes a new value; `:=` changes one that exists. E306 is the reverse: using `:=` before the value was ever made.

### E209 One equals sign in a condition

```text
4:8   E209  `=` used in a condition.
            Use `==` to compare, `:=` to reassign.
```

### E340 Plot inside a block

```text
9:5   E340  `plot` must be called at top level (not inside if/for/functions).
```
Plots and their friends sit at the top of the script. To plot only sometimes, make the value `na` when you do not want it: `plot(cond ? x : na)`.

### W101 A `ta` function that skips bars

```text
12:9  W101  `ta.ema` is called only on some bars (inside `if`), so its state skips the other bars.
            Compute it at top level and use the result inside the `if`.
```
A warning, not an error. The script runs, but the numbers can be wrong. Do what the hint says.

### Runtime errors (E4xx)

```text
12:5  E404  Loop ran more than 100,000 times on one bar.
```
Shorten the loop, or use a built-in. See [Limits](/zscript/limits). `E402` on a history look-back means you looked further back than `max_bars_back` allows; raise it in `indicator()`.

### No value (na)

An `na` result is not an error. It means "nothing to show on this bar". See [Bars and series](/zscript/bars-and-series). Division by zero gives `na`, not an error.

## If you are stuck

Cut the script down to the smallest piece that still shows the problem. Add lines back one at a time until the error returns. The line it returns on is the cause.
