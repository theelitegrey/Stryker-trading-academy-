// Zscript built-in catalog: every built-in function, variable and constant, with its
// signature and a one-line meaning. Used by the compiler (type checking, named args,
// defaults), by the editor (autocomplete, hover) and by the book (reference pages).
// No implementations here (see builtins.js), so the editor can import it cheaply.
//
// Function line format:  [flags] name(param:type=default, ...) -> ret ~ doc
//   flags: s = keeps state per call site, t = top level only, d:<ns> = our data (Pro gate)
//   types: num int float bool string color any array map label line box table
//          T (same type as the source/value arg, number types widen)
//   ret:   a type, `void`, `num` (int if all number args are int, else float),
//          `arg0` (type of the first argument), `elem0` (element type of the array/map arg),
//          `[t1,t2]` (tuple), `arr:<t>` (array of t), `newarr`, `newmap`, `keys0`, `vals0`
//   ...name:type = variadic.  Defaults are literals, `na`, or a built-in variable name.

const FUNCS = `
# general
na(x:any) -> bool ~ True if x is na (missing).
nz(x:any, replacement:any=0) -> arg0 ~ x, or replacement when x is na.
s fixnan(x:any) -> arg0 ~ The last non-na value of x.
int(x:any) -> int ~ Converts to a whole number (truncates toward zero).
float(x:any) -> float ~ Converts to a float.
bool(x:any) -> bool ~ Converts to bool (na and 0 are false).
string(x:any) -> string ~ Converts to text.
color(x:any) -> color ~ Casts to color.
t indicator(title:string, shorttitle:string="", overlay:bool=false, format:string="price", precision:int=na, max_bars_back:int=500, max_labels_count:int=50, max_lines_count:int=50, max_boxes_count:int=50, max_tables_count:int=10, scale:string="right", timeframe:string="", explicit_plot_zorder:bool=false) -> void ~ Declares the script: its title and where it draws.
# inputs
t input(defval:any, title:string="", tooltip:string="", group:string="", inline:string="", confirm:bool=false, display:string="all") -> arg0 ~ A setting; its type comes from the default value.
t input.int(defval:int, title:string="", minval:int=na, maxval:int=na, step:int=1, options:array=na, tooltip:string="", group:string="", inline:string="", confirm:bool=false, display:string="all") -> int ~ A whole-number setting.
t input.float(defval:float, title:string="", minval:float=na, maxval:float=na, step:float=na, options:array=na, tooltip:string="", group:string="", inline:string="", confirm:bool=false, display:string="all") -> float ~ A decimal-number setting.
t input.bool(defval:bool, title:string="", tooltip:string="", group:string="", inline:string="", confirm:bool=false, display:string="all") -> bool ~ An on/off setting.
t input.string(defval:string, title:string="", options:array=na, tooltip:string="", group:string="", inline:string="", confirm:bool=false, display:string="all") -> string ~ A text setting (or a dropdown with options).
t input.color(defval:color, title:string="", tooltip:string="", group:string="", inline:string="", confirm:bool=false, display:string="all") -> color ~ A color setting.
t input.source(defval:float=close, title:string="", tooltip:string="", group:string="", inline:string="", confirm:bool=false, display:string="all") -> float ~ A price source setting (open, high, low, close, volume, hl2, hlc3, ohlc4, hlcc4).
t input.timeframe(defval:string="", title:string="", options:array=na, tooltip:string="", group:string="", inline:string="", confirm:bool=false, display:string="all") -> string ~ A timeframe setting ("" = chart timeframe).
t input.price(defval:float, title:string="", tooltip:string="", group:string="", inline:string="", confirm:bool=false, display:string="all") -> float ~ A price-level setting.
t input.text_area(defval:string, title:string="", tooltip:string="", group:string="", confirm:bool=false, display:string="all") -> string ~ A multi-line text setting.
t input.symbol(defval:string="", title:string="", tooltip:string="", group:string="", inline:string="", confirm:bool=false, display:string="all") -> string ~ A symbol setting ("" = chart symbol).
# ta
s ta.sma(source:num, length:int) -> float ~ Simple moving average of the last length values.
s ta.ema(source:num, length:int) -> float ~ Exponential moving average (alpha 2/(length+1), starts from an SMA).
s ta.rma(source:num, length:int) -> float ~ Wilder's moving average (alpha 1/length, starts from an SMA).
s ta.wma(source:num, length:int) -> float ~ Linearly weighted moving average.
s ta.vwma(source:num, length:int) -> float ~ Volume-weighted moving average.
s ta.hma(source:num, length:int) -> float ~ Hull moving average.
s ta.alma(source:num, length:int, offset:float=0.85, sigma:float=6) -> float ~ Gaussian-weighted moving average (offset moves the peak, sigma sets the width).
s ta.swma(source:num) -> float ~ Symmetric 4-bar weighted moving average.
s ta.rsi(source:num, length:int) -> float ~ Relative strength index, 0 to 100.
s ta.macd(source:num, fastlen:int=12, slowlen:int=26, siglen:int=9) -> [float,float,float] ~ MACD line, signal line and histogram.
s ta.stoch(source:num, high:num, low:num, length:int) -> float ~ Stochastic: where source sits in the high-low range of length bars, 0 to 100.
s ta.atr(length:int) -> float ~ Average true range (RMA of the true range).
s ta.tr(handle_na:bool=false) -> float ~ True range of this bar.
s ta.bb(source:num, length:int, mult:float) -> [float,float,float] ~ Bollinger Bands: middle, upper, lower.
s ta.bbw(source:num, length:int, mult:float) -> float ~ Bollinger Band width as a percent of the middle band.
s ta.kc(source:num, length:int, mult:float, useTrueRange:bool=true) -> [float,float,float] ~ Keltner Channels: middle (EMA), upper, lower.
s ta.kcw(source:num, length:int, mult:float, useTrueRange:bool=true) -> float ~ Keltner Channel width.
s ta.cci(source:num, length:int) -> float ~ Commodity channel index.
s ta.mfi(source:num, length:int) -> float ~ Money flow index, 0 to 100.
s ta.vwap(source:num=hlc3, anchor:string="D") -> float ~ Volume-weighted average price, restarting each day ("D"), week ("W") or month ("M").
s ta.cum(source:num) -> float ~ Running total of source since the first bar.
s ta.change(source:any, length:int=1) -> num ~ source minus its value length bars ago (for bool: true if it changed).
s ta.mom(source:num, length:int) -> float ~ Momentum: source minus source length bars ago.
s ta.roc(source:num, length:int) -> float ~ Rate of change in percent.
s ta.crossover(a:num, b:num) -> bool ~ True on the bar where a crosses above b.
s ta.crossunder(a:num, b:num) -> bool ~ True on the bar where a crosses below b.
s ta.cross(a:num, b:num) -> bool ~ True on the bar where a and b cross either way.
s ta.highest(source:num=high, length:int) -> float ~ Highest value of the last length bars.
s ta.lowest(source:num=low, length:int) -> float ~ Lowest value of the last length bars.
s ta.highestbars(source:num=high, length:int) -> int ~ Offset (0 or negative) to the highest bar of the last length bars.
s ta.lowestbars(source:num=low, length:int) -> int ~ Offset (0 or negative) to the lowest bar of the last length bars.
s ta.pivothigh(source:num=high, leftbars:int, rightbars:int) -> float ~ Pivot high price, known rightbars bars after the pivot (na otherwise).
s ta.pivotlow(source:num=low, leftbars:int, rightbars:int) -> float ~ Pivot low price, known rightbars bars after the pivot (na otherwise).
s ta.valuewhen(condition:bool, source:any, occurrence:int=0) -> arg1 ~ Value of source on the bar where condition was true (occurrence 0 = most recent).
s ta.barssince(condition:bool) -> int ~ Bars since condition was last true (na if never).
s ta.stdev(source:num, length:int, biased:bool=true) -> float ~ Standard deviation.
s ta.variance(source:num, length:int, biased:bool=true) -> float ~ Variance.
s ta.dev(source:num, length:int) -> float ~ Mean absolute deviation from the SMA.
s ta.correlation(source1:num, source2:num, length:int) -> float ~ Correlation coefficient, -1 to 1.
s ta.linreg(source:num, length:int, offset:int=0) -> float ~ Linear regression value (least squares line) at offset bars back.
s ta.supertrend(factor:float, atrPeriod:int) -> [float,int] ~ SuperTrend line and direction (-1 up trend, 1 down trend).
s ta.percentrank(source:num, length:int) -> float ~ Percent of the previous length values that are at or below the current one.
s ta.median(source:num, length:int) -> float ~ Median of the last length values.
s ta.range(source:num, length:int) -> float ~ Highest minus lowest of the last length values.
s ta.rising(source:num, length:int) -> bool ~ True if source rose on each of the last length bars.
s ta.falling(source:num, length:int) -> bool ~ True if source fell on each of the last length bars.
s ta.dmi(diLength:int, adxSmoothing:int) -> [float,float,float] ~ Directional movement: +DI, -DI and ADX.
s ta.wpr(length:int) -> float ~ Williams %R, -100 to 0.
s ta.cmo(source:num, length:int) -> float ~ Chande momentum oscillator.
s ta.tsi(source:num, short_length:int, long_length:int) -> float ~ True strength index, -1 to 1.
s ta.sar(start:float, inc:float, max:float) -> float ~ Parabolic SAR.
s ta.mode(source:num, length:int) -> float ~ Most frequent value of the last length values.
# math
math.abs(x:num) -> num ~ Absolute value.
math.sign(x:num) -> float ~ -1, 0 or 1.
math.sqrt(x:num) -> float ~ Square root.
math.exp(x:num) -> float ~ e to the power x.
math.log(x:num) -> float ~ Natural logarithm.
math.log10(x:num) -> float ~ Base-10 logarithm.
math.pow(base:num, exponent:num) -> float ~ base to the power exponent.
math.round(x:num, precision:int=na) -> num ~ Rounds to the nearest whole number, or to precision decimals.
math.floor(x:num) -> int ~ Rounds down.
math.ceil(x:num) -> int ~ Rounds up.
math.min(...values:num) -> num ~ Smallest of the values.
math.max(...values:num) -> num ~ Largest of the values.
math.avg(...values:num) -> float ~ Average of the values.
s math.sum(source:num, length:int) -> float ~ Sum of the last length values.
math.sin(x:num) -> float ~ Sine (radians).
math.cos(x:num) -> float ~ Cosine (radians).
math.tan(x:num) -> float ~ Tangent (radians).
math.asin(x:num) -> float ~ Arc sine.
math.acos(x:num) -> float ~ Arc cosine.
math.atan(x:num) -> float ~ Arc tangent.
math.todegrees(x:num) -> float ~ Radians to degrees.
math.toradians(x:num) -> float ~ Degrees to radians.
s math.random(min:num=0, max:num=1, seed:int=na) -> float ~ A repeatable pseudo-random number between min and max.
math.round_to_mintick(x:num) -> float ~ Rounds to the symbol's tick size.
# str
str.tostring(value:any, format:string="") -> string ~ Formats a value as text ("#.##", "0.00", "percent", "price", "volume").
str.tonumber(s:string) -> float ~ Parses text as a number (na if it is not one).
str.length(s:string) -> int ~ Number of characters.
str.contains(s:string, sub:string) -> bool ~ True if s contains sub.
str.startswith(s:string, prefix:string) -> bool ~ True if s starts with prefix.
str.endswith(s:string, suffix:string) -> bool ~ True if s ends with suffix.
str.pos(s:string, sub:string) -> int ~ Position of sub in s (na if absent).
str.substring(s:string, begin:int, end:int=na) -> string ~ Part of s from begin up to (not including) end.
str.replace(s:string, target:string, replacement:string, occurrence:int=0) -> string ~ Replaces one occurrence of target.
str.replace_all(s:string, target:string, replacement:string) -> string ~ Replaces every occurrence of target.
str.lower(s:string) -> string ~ Lower case.
str.upper(s:string) -> string ~ Upper case.
str.trim(s:string) -> string ~ Removes spaces at both ends.
str.split(s:string, separator:string) -> arr:string ~ Splits text into an array.
str.format(formatString:string, ...args:any) -> string ~ Fills {0}, {1}, ... placeholders.
str.repeat(s:string, repeat:int, separator:string="") -> string ~ s repeated n times.
# color
color.new(c:color, transp:num=0) -> color ~ The same color with transparency 0 (solid) to 100 (invisible).
color.rgb(red:num, green:num, blue:num, transp:num=0) -> color ~ A color from red, green, blue (0-255).
color.from_gradient(value:num, bottom_value:num, top_value:num, bottom_color:color, top_color:color) -> color ~ A color between two colors, by where value sits between two values.
color.r(c:color) -> float ~ Red part, 0-255.
color.g(c:color) -> float ~ Green part, 0-255.
color.b(c:color) -> float ~ Blue part, 0-255.
color.t(c:color) -> float ~ Transparency, 0-100.
# arrays
array.new(size:int=0, initial_value:any=na) -> newarr ~ A new array (write the type: array.new<float>(...)).
array.new_float(size:int=0, initial_value:float=na) -> arr:float ~ A new array of floats.
array.new_int(size:int=0, initial_value:int=na) -> arr:int ~ A new array of ints.
array.new_bool(size:int=0, initial_value:bool=false) -> arr:bool ~ A new array of bools.
array.new_string(size:int=0, initial_value:string=na) -> arr:string ~ A new array of strings.
array.new_color(size:int=0, initial_value:color=na) -> arr:color ~ A new array of colors.
array.new_label(size:int=0, initial_value:label=na) -> arr:label ~ A new array of labels.
array.new_line(size:int=0, initial_value:line=na) -> arr:line ~ A new array of lines.
array.new_box(size:int=0, initial_value:box=na) -> arr:box ~ A new array of boxes.
array.from(...values:any) -> fromarr ~ A new array holding the given values.
array.copy(id:array) -> arg0 ~ A copy of the array.
array.size(id:array) -> int ~ Number of items.
array.get(id:array, index:int) -> elem0 ~ The item at index (-1 = last).
array.set(id:array, index:int, value:any) -> void ~ Replaces the item at index.
array.push(id:array, value:any) -> void ~ Adds an item at the end.
array.pop(id:array) -> elem0 ~ Removes and returns the last item.
array.unshift(id:array, value:any) -> void ~ Adds an item at the start.
array.shift(id:array) -> elem0 ~ Removes and returns the first item.
array.insert(id:array, index:int, value:any) -> void ~ Inserts an item at index.
array.remove(id:array, index:int) -> elem0 ~ Removes and returns the item at index.
array.clear(id:array) -> void ~ Removes every item.
array.concat(id1:array, id2:array) -> arg0 ~ Appends the second array to the first.
array.slice(id:array, index_from:int, index_to:int=na) -> arg0 ~ A copy of part of the array.
array.reverse(id:array) -> void ~ Reverses the order in place.
array.sort(id:array, order:string="ascending") -> void ~ Sorts in place (order.ascending or order.descending).
array.sort_indices(id:array, order:string="ascending") -> arr:int ~ Indices that would sort the array.
array.includes(id:array, value:any) -> bool ~ True if the value is in the array.
array.indexof(id:array, value:any) -> int ~ First index of value (-1 if absent).
array.lastindexof(id:array, value:any) -> int ~ Last index of value (-1 if absent).
array.first(id:array) -> elem0 ~ First item.
array.last(id:array) -> elem0 ~ Last item.
array.fill(id:array, value:any, index_from:int=0, index_to:int=na) -> void ~ Sets items in a range to value.
array.sum(id:array) -> float ~ Sum of the items.
array.avg(id:array) -> float ~ Average of the items.
array.min(id:array) -> float ~ Smallest item.
array.max(id:array) -> float ~ Largest item.
array.median(id:array) -> float ~ Median of the items.
array.stdev(id:array, biased:bool=true) -> float ~ Standard deviation of the items.
array.variance(id:array, biased:bool=true) -> float ~ Variance of the items.
array.range(id:array) -> float ~ Largest minus smallest item.
array.abs(id:array) -> arg0 ~ A new array with absolute values.
array.join(id:array, separator:string="") -> string ~ The items joined as text.
# maps
map.new() -> newmap ~ A new map (write the types: map.new<string, float>()).
map.put(id:map, key:any, value:any) -> void ~ Sets the value for key.
map.get(id:map, key:any) -> vals0 ~ The value for key (na if absent).
map.contains(id:map, key:any) -> bool ~ True if the key is present.
map.remove(id:map, key:any) -> vals0 ~ Removes the key and returns its value.
map.size(id:map) -> int ~ Number of keys.
map.keys(id:map) -> keys0 ~ An array of the keys, in insertion order.
map.values(id:map) -> valarr0 ~ An array of the values, in insertion order.
map.clear(id:map) -> void ~ Removes every key.
map.copy(id:map) -> arg0 ~ A copy of the map.
map.put_all(id:map, id2:map) -> void ~ Copies every key of id2 into id.
# plots
t plot(series:num, title:string="", color:color=na, linewidth:int=1, style:string="line", trackprice:bool=false, histbase:float=0, offset:int=0, join:bool=false, editable:bool=true, show_last:int=na, display:string="all", format:string="", precision:int=na) -> plotid ~ Draws a series as a line (or histogram, columns, circles, area...).
t plotshape(series:any, title:string="", style:string="circle", location:string="abovebar", color:color=na, offset:int=0, text:string="", textcolor:color=na, editable:bool=true, size:string="auto", show_last:int=na, display:string="all") -> void ~ Draws a shape on bars where series is true (or not na).
t plotchar(series:any, title:string="", char:string="•", location:string="abovebar", color:color=na, offset:int=0, text:string="", textcolor:color=na, editable:bool=true, size:string="auto", show_last:int=na, display:string="all") -> void ~ Draws a character on bars where series is true (or not na).
t plotarrow(series:num, title:string="", colorup:color=#089981, colordown:color=#f23645, offset:int=0, minheight:int=5, maxheight:int=100, editable:bool=true, show_last:int=na, display:string="all") -> void ~ Draws up arrows for positive values and down arrows for negative values.
t plotcandle(open:num, high:num, low:num, close:num, title:string="", color:color=na, wickcolor:color=na, editable:bool=true, show_last:int=na, bordercolor:color=na, display:string="all") -> void ~ Draws candles.
t plotbar(open:num, high:num, low:num, close:num, title:string="", color:color=na, editable:bool=true, show_last:int=na, display:string="all") -> void ~ Draws OHLC bars.
t hline(price:num, title:string="", color:color=#787b86, linestyle:string="dashed", linewidth:int=1, editable:bool=true, display:string="all") -> hlineid ~ Draws a horizontal line at a fixed price.
t fill(plot1:any, plot2:any, color:color=na, title:string="", editable:bool=true, show_last:int=na, fillgaps:bool=false, display:string="all") -> void ~ Fills the space between two plots or two hlines.
t bgcolor(color:color, offset:int=0, editable:bool=true, show_last:int=na, title:string="", display:string="all") -> void ~ Colors the chart background of each bar.
t barcolor(color:color, offset:int=0, editable:bool=true, show_last:int=na, title:string="", display:string="all") -> void ~ Colors the candles.
# labels
label.new(x:num, y:num, text:string="", xloc:string="bar_index", yloc:string="price", color:color=na, style:string="label_down", textcolor:color=na, size:string="normal", textalign:string="center", tooltip:string="", text_font_family:string="default") -> label ~ Creates a label and returns its id.
label.set_x(id:label, x:num) -> void ~ Moves the label horizontally.
label.set_y(id:label, y:num) -> void ~ Moves the label vertically.
label.set_xy(id:label, x:num, y:num) -> void ~ Moves the label.
label.set_text(id:label, text:string) -> void ~ Changes the text.
label.set_color(id:label, color:color) -> void ~ Changes the background color.
label.set_textcolor(id:label, textcolor:color) -> void ~ Changes the text color.
label.set_style(id:label, style:string) -> void ~ Changes the style.
label.set_size(id:label, size:string) -> void ~ Changes the size.
label.set_tooltip(id:label, tooltip:string) -> void ~ Changes the tooltip.
label.set_textalign(id:label, textalign:string) -> void ~ Changes the text alignment.
label.set_xloc(id:label, x:num, xloc:string) -> void ~ Changes x and how it is read.
label.set_yloc(id:label, yloc:string) -> void ~ Changes how y is read.
label.get_x(id:label) -> int ~ The label's x.
label.get_y(id:label) -> float ~ The label's y.
label.get_text(id:label) -> string ~ The label's text.
label.delete(id:label) -> void ~ Removes the label.
label.copy(id:label) -> label ~ A copy of the label.
# lines
line.new(x1:num, y1:num, x2:num, y2:num, xloc:string="bar_index", extend:string="none", color:color=na, style:string="solid", width:int=1) -> line ~ Creates a line and returns its id.
line.set_x1(id:line, x:num) -> void ~ Moves the first point horizontally.
line.set_y1(id:line, y:num) -> void ~ Moves the first point vertically.
line.set_x2(id:line, x:num) -> void ~ Moves the second point horizontally.
line.set_y2(id:line, y:num) -> void ~ Moves the second point vertically.
line.set_xy1(id:line, x:num, y:num) -> void ~ Moves the first point.
line.set_xy2(id:line, x:num, y:num) -> void ~ Moves the second point.
line.set_color(id:line, color:color) -> void ~ Changes the color.
line.set_width(id:line, width:int) -> void ~ Changes the width.
line.set_style(id:line, style:string) -> void ~ Changes the style.
line.set_extend(id:line, extend:string) -> void ~ Extends the line left, right, both or none.
line.set_xloc(id:line, x1:num, x2:num, xloc:string) -> void ~ Changes x1, x2 and how they are read.
line.get_x1(id:line) -> int ~ First point x.
line.get_y1(id:line) -> float ~ First point y.
line.get_x2(id:line) -> int ~ Second point x.
line.get_y2(id:line) -> float ~ Second point y.
line.get_price(id:line, x:num) -> float ~ The line's price at bar x.
line.delete(id:line) -> void ~ Removes the line.
line.copy(id:line) -> line ~ A copy of the line.
# boxes
box.new(left:num, top:num, right:num, bottom:num, border_color:color=na, border_width:int=1, border_style:string="solid", extend:string="none", xloc:string="bar_index", bgcolor:color=na, text:string="", text_size:string="auto", text_color:color=na, text_halign:string="center", text_valign:string="center") -> box ~ Creates a box and returns its id.
box.set_left(id:box, left:num) -> void ~ Moves the left edge.
box.set_top(id:box, top:num) -> void ~ Moves the top edge.
box.set_right(id:box, right:num) -> void ~ Moves the right edge.
box.set_bottom(id:box, bottom:num) -> void ~ Moves the bottom edge.
box.set_lefttop(id:box, left:num, top:num) -> void ~ Moves the top-left corner.
box.set_rightbottom(id:box, right:num, bottom:num) -> void ~ Moves the bottom-right corner.
box.set_bgcolor(id:box, color:color) -> void ~ Changes the fill color.
box.set_border_color(id:box, color:color) -> void ~ Changes the border color.
box.set_border_width(id:box, width:int) -> void ~ Changes the border width.
box.set_border_style(id:box, style:string) -> void ~ Changes the border style.
box.set_extend(id:box, extend:string) -> void ~ Extends the box left, right, both or none.
box.set_text(id:box, text:string) -> void ~ Changes the text.
box.set_text_color(id:box, text_color:color) -> void ~ Changes the text color.
box.get_left(id:box) -> int ~ Left edge.
box.get_top(id:box) -> float ~ Top edge.
box.get_right(id:box) -> int ~ Right edge.
box.get_bottom(id:box) -> float ~ Bottom edge.
box.delete(id:box) -> void ~ Removes the box.
box.copy(id:box) -> box ~ A copy of the box.
# tables
table.new(position:string, columns:int, rows:int, bgcolor:color=na, frame_color:color=na, frame_width:int=0, border_color:color=na, border_width:int=0) -> table ~ Creates a table fixed to a corner of the chart.
table.cell(table_id:table, column:int, row:int, text:string="", width:num=0, height:num=0, text_color:color=na, text_halign:string="center", text_valign:string="center", text_size:string="normal", bgcolor:color=na, tooltip:string="") -> void ~ Sets a cell's text and colors.
table.cell_set_text(table_id:table, column:int, row:int, text:string) -> void ~ Changes a cell's text.
table.cell_set_bgcolor(table_id:table, column:int, row:int, bgcolor:color) -> void ~ Changes a cell's background.
table.cell_set_text_color(table_id:table, column:int, row:int, text_color:color) -> void ~ Changes a cell's text color.
table.clear(table_id:table, start_column:int, start_row:int, end_column:int=na, end_row:int=na) -> void ~ Clears a range of cells.
table.delete(table_id:table) -> void ~ Removes the table.
# alerts
t alertcondition(condition:bool, title:string="", message:string="") -> void ~ An alert the member can pick in the alert dialog.
alert(message:string, freq:string="once_per_bar") -> void ~ Fires an alert from code.
# request
t request.security(symbol:string, timeframe:string, expression:any, gaps:bool=false, lookahead:bool=false) -> arg2 ~ The value of an expression on another symbol or a higher timeframe (only closed bars, never future data).
# timestamps
timestamp(year:int, month:int, day:int, hour:int=0, minute:int=0, second:int=0) -> int ~ Time in ms (UTC) for a date.
# our data: order book (L2)
d:book book.bid(level:int=0) -> float ~ Bid price at a book level (0 = best bid).
d:book book.ask(level:int=0) -> float ~ Ask price at a book level (0 = best ask).
d:book book.bidsize(level:int=0) -> float ~ Size resting at a bid level.
d:book book.asksize(level:int=0) -> float ~ Size resting at an ask level.
d:book book.depth(side:string, n:int=10) -> float ~ Total size of the first n levels of one side (book.side_bid or book.side_ask).
d:book book.imbalance(n:int=10) -> float ~ (bid depth - ask depth) / (bid depth + ask depth) over n levels, -1 to 1.
d:book book.wall(side:string, minSize:num) -> float ~ Price of the nearest level on one side with at least minSize resting (na if none).
d:book book.heat(price:num) -> float ~ Size resting at a price (the nearest book level).
# our data: order flow
d:flow flow.bigtrades(minSize:num) -> float ~ Number of trades in this bar of at least minSize.
d:flow flow.bigtrades_vol(minSize:num) -> float ~ Total size of the trades in this bar of at least minSize.
d:flow flow.footprint(price:num, side:string="both") -> float ~ Volume traded at a price in this bar (flow.side_buy, flow.side_sell or both).
# our data: GEX
d:gex gex.level(n:int=0) -> float ~ The n-th strongest GEX level (0 = strongest).
# our data: ZoroOptions
d:opt opt.node(n:int=0) -> float ~ Price of the n-th gamma node (0 = strongest).
d:opt opt.range(kind:string="day") -> [float,float] ~ Low and high of an options range ("day", "1dte", "week", "month").
`;

// name:type ~ doc   (built-in variables; d:<ns> = our data)
const VARS = `
open:float ~ Open price of the bar.
high:float ~ High price of the bar.
low:float ~ Low price of the bar.
close:float ~ Close price of the bar (the latest price on the live bar).
volume:float ~ Volume of the bar.
hl2:float ~ (high + low) / 2.
hlc3:float ~ (high + low + close) / 3.
ohlc4:float ~ (open + high + low + close) / 4.
hlcc4:float ~ (high + low + close + close) / 4.
time:int ~ Bar open time, ms since 1970 (UTC).
time_close:int ~ Bar close time, ms since 1970 (UTC).
bar_index:int ~ Bar number, 0 for the first bar.
last_bar_index:int ~ Bar number of the last loaded bar.
year:int ~ Year of the bar (UTC).
month:int ~ Month of the bar, 1-12 (UTC).
dayofmonth:int ~ Day of the month (UTC).
dayofweek:int ~ Day of the week, 1 = Sunday ... 7 = Saturday (UTC).
hour:int ~ Hour (UTC).
minute:int ~ Minute.
second:int ~ Second.
weekofyear:int ~ Week number of the year (ISO).
barstate.isfirst:bool ~ True on the first bar.
barstate.islast:bool ~ True on the last bar.
barstate.isnew:bool ~ True on the first update of a bar.
barstate.isrealtime:bool ~ True on live bars.
barstate.ishistory:bool ~ True on history bars.
barstate.isconfirmed:bool ~ True when the bar is closed.
barstate.islastconfirmedhistory:bool ~ True on the last closed history bar.
syminfo.ticker:string ~ Symbol without exchange, e.g. "NQ".
syminfo.tickerid:string ~ Full symbol id.
syminfo.type:string ~ Market type: "futures", "crypto", "stock", "forex", "index".
syminfo.currency:string ~ Quote currency.
syminfo.mintick:float ~ Tick size.
syminfo.pointvalue:float ~ Value of one point move for one contract.
timeframe.period:string ~ Chart timeframe, e.g. "5", "60", "D".
timeframe.multiplier:int ~ Number part of the timeframe.
timeframe.isintraday:bool ~ True for minute and second timeframes.
timeframe.isdaily:bool ~ True on daily charts.
timeframe.isweekly:bool ~ True on weekly charts.
timeframe.ismonthly:bool ~ True on monthly charts.
timeframe.isminutes:bool ~ True for minute timeframes.
timeframe.isseconds:bool ~ True for second timeframes.
ta.obv:float ~ On-balance volume.
ta.tr:float ~ True range of this bar (na on the first bar).
ta.vwap:float ~ Daily volume-weighted average price of hlc3.
ta.accdist:float ~ Accumulation/distribution.
d:flow flow.buyvol:float ~ Volume bought at the ask in this bar.
d:flow flow.sellvol:float ~ Volume sold at the bid in this bar.
d:flow flow.delta:float ~ Buy volume minus sell volume in this bar.
d:flow flow.cvd:float ~ Running total of delta (cumulative volume delta).
d:flow flow.trades:float ~ Number of trades in this bar.
d:flow flow.poc:float ~ This bar's point of control (price with the most volume).
d:flow flow.vah:float ~ This bar's value area high (70% of volume).
d:flow flow.val:float ~ This bar's value area low (70% of volume).
d:gex gex.callwall:float ~ Call wall level.
d:gex gex.putwall:float ~ Put wall level.
d:gex gex.flip:float ~ Gamma flip level.
d:gex gex.zero_upper:float ~ Upper zero-gamma level.
d:gex gex.zero_lower:float ~ Lower zero-gamma level.
d:gex gex.net:float ~ Net gamma exposure.
d:gex gex.updated:int ~ Time the GEX levels were computed (ms).
d:opt opt.ivrank:float ~ IV rank, 0 to 100.
d:opt opt.pc:float ~ Put/call ratio.
d:opt opt.maxpain:float ~ Max pain strike.
d:opt opt.zone:string ~ Current options zone name.
d:opt opt.updated:int ~ Time of the options data (ms); show it as "updated X min ago".
`;

const PALETTE = { aqua: '#00bcd4', black: '#363a45', blue: '#2962ff', fuchsia: '#e040fb', gray: '#787b86', green: '#4caf50',
  lime: '#00e676', maroon: '#880e4f', navy: '#311b92', olive: '#808000', orange: '#ff9800', purple: '#9c27b0', red: '#f23645',
  silver: '#b2b5be', teal: '#089981', white: '#ffffff', yellow: '#ffeb3b', bull: '#089981', bear: '#f23645', neutral: '#787b86', accent: '#7c5cff' };

const CONST_GROUPS = {
  'plot.style_': ['string', ['line', 'stepline', 'histogram', 'columns', 'circles', 'cross', 'area', 'areabr', 'linebr', 'stepline_diamond']],
  'shape.': ['string', ['xcross', 'cross', 'circle', 'triangleup', 'triangledown', 'flag', 'arrowup', 'arrowdown', 'labelup', 'labeldown', 'square', 'diamond']],
  'location.': ['string', ['abovebar', 'belowbar', 'top', 'bottom', 'absolute']],
  'size.': ['string', ['auto', 'tiny', 'small', 'normal', 'large', 'huge']],
  'hline.style_': ['string', ['solid', 'dotted', 'dashed']],
  'line.style_': ['string', ['solid', 'dotted', 'dashed', 'arrow_left', 'arrow_right', 'arrow_both']],
  'label.style_': ['string', ['none', 'label_up', 'label_down', 'label_left', 'label_right', 'label_center', 'label_upper_left', 'label_upper_right', 'label_lower_left', 'label_lower_right', 'circle', 'square', 'diamond', 'arrowup', 'arrowdown', 'triangleup', 'triangledown', 'xcross', 'cross', 'flag', 'text_outline']],
  'xloc.': ['string', ['bar_index', 'bar_time']],
  'yloc.': ['string', ['price', 'abovebar', 'belowbar']],
  'extend.': ['string', ['none', 'left', 'right', 'both']],
  'text.align_': ['string', ['left', 'center', 'right', 'top', 'bottom']],
  'position.': ['string', ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right']],
  'display.': ['string', ['all', 'none', 'pane', 'data_window', 'price_scale', 'status_line']],
  'format.': ['string', ['price', 'volume', 'percent', 'inherit']],
  'order.': ['string', ['ascending', 'descending']],
  'alert.freq_': ['string', ['all', 'once_per_bar', 'once_per_bar_close']],
  'scale.': ['string', ['right', 'left', 'none']],
  'book.side_': ['string', ['bid', 'ask']],
  'flow.side_': ['string', ['buy', 'sell', 'both']],
  'font.family_': ['string', ['default', 'monospace']],
  'barmerge.gaps_': ['bool', ['on', 'off']],
  'barmerge.lookahead_': ['bool', ['on', 'off']],
};

function parseType(t) { return t.trim(); }

function parseFuncs(text) {
  const out = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const m = /^(?:([a-z]+(?::[a-z]+)?(?: [a-z]+(?::[a-z]+)?)*) )?([a-z_][\w.]*)\((.*)\) -> (\S+) ~ (.*)$/.exec(line);
    if (!m) throw new Error('catalog: bad line ' + line);
    const flags = (m[1] || '').split(' ').filter(Boolean);
    const f = { name: m[2], params: [], ret: m[4], doc: m[5], state: false, top: false, data: null, variadic: false };
    for (const fl of flags) {
      if (fl === 's') f.state = true;
      else if (fl === 't') f.top = true;
      else if (fl.startsWith('d:')) f.data = fl.slice(2);
      else throw new Error('catalog: bad flag ' + fl);
    }
    if (m[3].trim()) {
      for (const ps of splitTop(m[3])) {
        const pm = /^(\.\.\.)?(\w+):(\w+)(?:=(.*))?$/.exec(ps.trim());
        if (!pm) throw new Error('catalog: bad param ' + ps + ' in ' + f.name);
        const p = { name: pm[2], type: parseType(pm[3]) };
        if (pm[1]) { p.rest = true; f.variadic = true; }
        if (pm[4] !== undefined) p.def = parseDefault(pm[4]);
        f.params.push(p);
      }
    }
    out.set(f.name, f);
  }
  return out;
}

function splitTop(s) { return s.split(','); }

function parseDefault(s) {
  s = s.trim();
  if (s === 'na') return { na: true };
  if (s === 'true' || s === 'false') return { v: s === 'true' };
  if (/^#[0-9a-f]{6}$/i.test(s)) return { v: s.toLowerCase() + 'ff', color: true };
  if (/^-?[0-9.]+$/.test(s)) return { v: Number(s), int: !s.includes('.') };
  if (s[0] === '"') return { v: s.slice(1, -1) };
  if (/^[a-z_][\w.]*$/.test(s)) return { var: s };
  throw new Error('catalog: bad default ' + s);
}

function parseVars(text) {
  const out = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(?:d:(\w+) )?([a-z_][\w.]*):(\w+) ~ (.*)$/.exec(line);
    if (!m) throw new Error('catalog: bad var ' + line);
    out.set(m[2], { name: m[2], type: m[3], doc: m[4], data: m[1] || null });
  }
  return out;
}

export const FUNCTIONS = parseFuncs(FUNCS);
export const VARIABLES = parseVars(VARS);
export const CONSTANTS = new Map();
for (const [k, hex] of Object.entries(PALETTE)) CONSTANTS.set('color.' + k, { name: 'color.' + k, type: 'color', value: hex + 'ff', doc: 'Color ' + k + '.' });
for (const [prefix, [type, names]] of Object.entries(CONST_GROUPS)) {
  for (const n of names) {
    const value = type === 'bool' ? n === 'on' : n;
    CONSTANTS.set(prefix + n, { name: prefix + n, type, value, doc: '' });
  }
}
for (const [i, d] of ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].entries()) {
  CONSTANTS.set('dayofweek.' + d, { name: 'dayofweek.' + d, type: 'int', value: i + 1, doc: '' });
}
CONSTANTS.set('math.pi', { name: 'math.pi', type: 'float', value: Math.PI, doc: 'Pi.' });
CONSTANTS.set('math.e', { name: 'math.e', type: 'float', value: Math.E, doc: 'Euler\'s number.' });
CONSTANTS.set('math.phi', { name: 'math.phi', type: 'float', value: (1 + Math.sqrt(5)) / 2, doc: 'The golden ratio.' });

// Namespaces a name can start with (for "did you mean" and member resolution).
export const NAMESPACES = new Set();
for (const m of [FUNCTIONS, VARIABLES, CONSTANTS]) {
  for (const k of m.keys()) {
    const parts = k.split('.');
    for (let i = 1; i < parts.length; i++) NAMESPACES.add(parts.slice(0, i).join('.'));
  }
}

export const KEYWORD_LIST = ['and', 'or', 'not', 'if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'var', 'varip', 'true', 'false', 'na', 'break', 'continue'];
export const TYPE_LIST = ['int', 'float', 'bool', 'string', 'color', 'label', 'line', 'box', 'table', 'array', 'map', 'series', 'simple', 'const'];

// Plain-data view for the editor / book generators.
export function catalogJSON() {
  return {
    functions: [...FUNCTIONS.values()],
    variables: [...VARIABLES.values()],
    constants: [...CONSTANTS.values()],
    keywords: KEYWORD_LIST,
    types: TYPE_LIST,
  };
}
