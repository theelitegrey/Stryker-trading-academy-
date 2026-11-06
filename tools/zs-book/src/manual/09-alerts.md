---
title: Alerts
dek: Turn a rule into a notification.
---
An alert is a rule that is true or false on each bar. When it turns true, TradeZoro can tell you.

## alertcondition

Declare the rule once. It then shows up in the alert dialog on the chart, where you choose how to be told.

```zscript
//@zscript 1
indicator("Cross alerts", overlay=true)

fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
plot(fast)
plot(slow)

alertcondition(ta.crossover(fast, slow), "Fast crossed above slow", "9 EMA is above 21 EMA")
alertcondition(ta.crossunder(fast, slow), "Fast crossed below slow", "9 EMA is below 21 EMA")
```

## alert()

`alert(message)` fires from inside your code, which lets you build the message from values.

```zscript
//@zscript 1
indicator("Big bar alert", overlay=true)

big = (high - low) > ta.atr(14) * 2
if big and barstate.isconfirmed
    alert("Big bar: range " + str.tostring(high - low, "#.##"))
```

`barstate.isconfirmed` is true once the bar has closed. Alerting only on closed bars avoids alerts that appear and vanish within a bar.

## Good to know

- Alerts run while the chart is open in your browser, using the same data as the chart.
- A message is plain text. Keep it short.
- An alert on data from the order book, order flow, GEX or options follows the same plan rules as showing that data on a chart.
