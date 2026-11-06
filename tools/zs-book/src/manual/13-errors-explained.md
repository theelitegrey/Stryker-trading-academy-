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

### Unknown name

```text
3:11  I don't know "ta.smaa".
      Did you mean ta.sma?
```
A typo. Names are case sensitive, and every built-in has its namespace in front (`ta.`, `math.`, `str.`).

### Wrong type

```text
5:8   plot() needs a number, but "label" is text.
```
You passed text where a number goes. Check the order of the arguments.

### Missing header or declaration

```text
1:1   The first line must be //@zscript 1.
```
Add the header line. Then make sure there is exactly one `indicator(...)`.

### Indentation

```text
6:1   This line is indented, but nothing above it opens a block.
```
Indent only under `if`, `for`, `while`, `switch` and function bodies.

### Using a value before it exists

```text
4:5   "average" is used here, before the line that creates it.
```
Move the line that creates it up.

### Changing with = instead of :=

```text
7:5   "greens" already exists. To change it, write greens := ...
```

### No value (na)

An `na` result is not an error. It means "nothing to show on this bar". See [Bars and series](/zscript/bars-and-series).

### Limit errors

```text
12:5  This loop ran more than the limit allows.
```
Shorten the loop, or use a built-in. See [Limits](/zscript/limits).

## If you are stuck

Cut the script down to the smallest piece that still shows the problem. Add lines back one at a time until the error returns. The line it returns on is the cause.
