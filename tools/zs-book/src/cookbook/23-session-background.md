---
title: Session background
dek: Tint the background by time of day (UTC).
level: Intermediate
---
```zscript
//@zscript 1
indicator("Session tint", overlay=true)
minuteOfDay = hour * 60 + minute
inSession = minuteOfDay >= 13 * 60 + 30 and minuteOfDay < 20 * 60
bgcolor(inSession ? color.new(color.blue, 94) : na)
```

@chart cb-session-background

## How it works

`hour` and `minute` are in UTC in Zscript v1, so the window above (13:30 to 20:00 UTC) is the New York cash session in summer. Move the two numbers for other markets or for winter time.
