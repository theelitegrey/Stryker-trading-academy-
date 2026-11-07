---
title: Types and values
dek: Numbers, true/false, text, colors, arrays and maps.
---
Every value has a type. Zscript works out the type for you most of the time, and you can write it when you want to be clear.

| Type | Holds | Example |
|---|---|---|
| `int` | whole numbers | `14` |
| `float` | numbers with a decimal part | `0.5` |
| `bool` | `true` or `false` | `close > open` |
| `string` | text | `"Buy zone"` |
| `color` | a color | `#03c988`, `color.red` |
| `series<T>` | one value of type T per bar | `close` |
| `array<T>` | a list of values of type T | `array.new<float>()` |
| `map<K,V>` | a lookup table | `map.new<string, float>()` |

## Making and changing values

```zscript
//@zscript 1
indicator("Values")

float range1 = high - low        // type written out
mid = (high + low) / 2           // type worked out
bool bigBar = range1 > ta.sma(range1, 20) * 1.5

var float biggest = 0.0
if range1 > biggest
    biggest := range1

plot(mid, "Mid")
plotshape(bigBar, "Big bar", shape.circle, location.abovebar)
```

- `=` creates a value. `:=` changes one that already exists.
- Math: `+ - * / %`. Compare with `== != < <= > >=`. Combine tests with `and`, `or`, `not`.
- Text joins with `+`: `"Range " + str.tostring(range1)`.
- `x ? a : b` gives `a` when `x` is true, else `b`.

## Colors

Write a color as `#rrggbb`, use a named one such as `color.green`, or build one with `color.new(base, transparency)` where transparency is 0 (solid) to 100 (invisible). `color.rgb(r, g, b)` builds one from numbers.

## Arrays

```zscript
//@zscript 1
indicator("Array demo")

var prices = array.new<float>()
array.push(prices, close)
if array.size(prices) > 5
    array.shift(prices)

plot(array.avg(prices), "Average of the last 5 closes")
```

## Maps

```zscript
//@zscript 1
indicator("Map demo")

var counts = map.new<string, int>()
key = close > open ? "up" : "down"
map.put(counts, key, nz(map.get(counts, key)) + 1)
plot(nz(map.get(counts, "up")), "Up bars")
```

## Tuples

A function can return several values at once. Take them apart with square brackets.

```zscript
//@zscript 1
indicator("Tuple demo", overlay=true)

[middle, upper, lower] = ta.bb(close, 20, 2.0)
plot(middle)
plot(upper)
plot(lower)
```

## Limits to know

Arrays, maps, series and drawings each have a size cap so a script cannot use all your memory. See [Limits](/zscript/limits).
