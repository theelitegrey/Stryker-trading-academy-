// TradeZoro — Zscript: the five built-in Example scripts (ES module), written for TradeZoro.
// Shown in the Zscript editor (assets/chart-zscript.js) and the indicator window's Zscript tab, always
// labelled "Example". Education only. Not financial advice.

export const ZS_EXAMPLES = [
  { id: 'zs-example:ema-cross', name: 'EMA cross', source: [
    '//@zscript 1',
    'indicator("EMA cross", overlay=true)',
    '// Two exponential moving averages and a marker where they cross.',
    'fastLen = input.int(9, "Fast EMA", minval=1)',
    'slowLen = input.int(21, "Slow EMA", minval=1)',
    'fast = ta.ema(close, fastLen)',
    'slow = ta.ema(close, slowLen)',
    'plot(fast, "Fast EMA", color=color.teal, linewidth=2)',
    'plot(slow, "Slow EMA", color=color.orange, linewidth=2)',
    'plotshape(ta.crossover(fast, slow), "Cross up", style=shape.triangleup, location=location.belowbar, color=color.teal, size=size.small)',
    'plotshape(ta.crossunder(fast, slow), "Cross down", style=shape.triangledown, location=location.abovebar, color=color.orange, size=size.small)',
    ''
  ].join('\n') },
  { id: 'zs-example:rsi-zones', name: 'RSI with zones', source: [
    '//@zscript 1',
    'indicator("RSI with zones", overlay=false)',
    '// Relative strength index with shaded overbought and oversold zones.',
    'src = input.source(close, "Source")',
    'len = input.int(14, "Length", minval=2)',
    'upper = input.int(70, "Overbought", minval=50, maxval=100)',
    'lower = input.int(30, "Oversold", minval=0, maxval=50)',
    'r = ta.rsi(src, len)',
    'plot(r, "RSI", color=color.purple, linewidth=2)',
    'top = hline(70, "Overbought", color=color.gray)',
    'mid = hline(50, "Middle", color=color.gray, linestyle=hline.style_dotted)',
    'bottom = hline(30, "Oversold", color=color.gray)',
    'fill(top, bottom, color=color.new(color.purple, 90))',
    'bgcolor(r > upper ? color.new(color.red, 90) : r < lower ? color.new(color.green, 90) : na)',
    ''
  ].join('\n') },
  { id: 'zs-example:vwap-bands', name: 'VWAP bands', source: [
    '//@zscript 1',
    'indicator("VWAP bands", overlay=true)',
    '// Session VWAP with bands one and two standard deviations away, restarted each day.',
    'mult1 = input.float(1.0, "Band 1", step=0.5)',
    'mult2 = input.float(2.0, "Band 2", step=0.5)',
    'newDay = ta.change(time("D")) != 0',
    'var float sumPV = 0.0',
    'var float sumV = 0.0',
    'var float sumP2V = 0.0',
    'if newDay',
    '    sumPV := 0.0',
    '    sumV := 0.0',
    '    sumP2V := 0.0',
    'sumPV += hlc3 * volume',
    'sumV += volume',
    'sumP2V += hlc3 * hlc3 * volume',
    'vw = sumV > 0 ? sumPV / sumV : na',
    'dev = sumV > 0 ? math.sqrt(math.max(sumP2V / sumV - vw * vw, 0)) : na',
    'plot(vw, "VWAP", color=color.yellow, linewidth=2)',
    'u1 = plot(vw + dev * mult1, "Upper 1", color=color.new(color.teal, 30))',
    'l1 = plot(vw - dev * mult1, "Lower 1", color=color.new(color.teal, 30))',
    'plot(vw + dev * mult2, "Upper 2", color=color.new(color.orange, 40))',
    'plot(vw - dev * mult2, "Lower 2", color=color.new(color.orange, 40))',
    'fill(u1, l1, color=color.new(color.teal, 92))',
    ''
  ].join('\n') },
  { id: 'zs-example:book-imbalance', name: 'Order book imbalance', source: [
    '//@zscript 1',
    'indicator("Order book imbalance", overlay=false)',
    '// Share of resting size on the bid vs the ask over the first N book levels, -1 to 1, at each bar\'s time.',
    '// Needs order book data (futures and crypto venues); empty on symbols without it.',
    'levels = input.int(10, "Book levels", minval=1, maxval=50)',
    'smooth = input.int(5, "Smoothing", minval=1)',
    'imb = ta.ema(book.imbalance(levels), smooth)',
    'plot(imb, "Imbalance", color=imb >= 0 ? color.teal : color.red, style=plot.style_columns)',
    'hline(0, "Zero", color=color.gray, linestyle=hline.style_dotted)',
    'hline(0.3, "Bid heavy", color=color.new(color.teal, 50))',
    'hline(-0.3, "Ask heavy", color=color.new(color.red, 50))',
    ''
  ].join('\n') },
  { id: 'zs-example:gex-walls', name: 'GEX walls', source: [
    '//@zscript 1',
    'indicator("GEX walls", overlay=true)',
    '// Call wall, put wall and gamma flip from GEX+ (SPX, SPY, QQQ, ES, NQ). Levels are as of their last update.',
    'showFlip = input.bool(true, "Show gamma flip")',
    'plot(gex.callwall, "Call wall", color=color.teal, linewidth=2, style=plot.style_stepline)',
    'plot(gex.putwall, "Put wall", color=color.red, linewidth=2, style=plot.style_stepline)',
    'plot(showFlip ? gex.flip : na, "Gamma flip", color=color.yellow, style=plot.style_stepline)',
    ''
  ].join('\n') }
];
