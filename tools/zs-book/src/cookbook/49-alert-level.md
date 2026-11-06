---
title: Level alert with a message
dek: Build the message from live values.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Level alert", overlay=true)
level = input.float(100.0, "Level")
hline(level)
if ta.crossover(close, level) and barstate.isconfirmed
    alert("Close above " + str.tostring(level, "#.##"))
```

## How it works

The message is built from the number you chose in the settings.
