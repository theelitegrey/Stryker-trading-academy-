---
title: Session background
dek: Tint the background by time of day.
level: Intermediate
---
```zscript
//@zscript 1
indicator("Session tint", overlay=true)
inSession = not na(time(timeframe.period, "0930-1600"))
bgcolor(inSession ? color.new(color.blue, 94) : na)
```

## How it works

`time(timeframe, session)` gives `na` outside the session. The session string is in the exchange time zone.
