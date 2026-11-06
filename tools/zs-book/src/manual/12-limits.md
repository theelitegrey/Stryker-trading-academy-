---
title: Limits
dek: The safety rails, so one script cannot slow down your chart or anyone else's.
---
Scripts from other members run in your browser. To make that safe, every script runs inside a locked room: it can do math and draw on the chart, and nothing else. It cannot open web connections, read your cookies or storage, or touch the page.

## What a script can never do

- Reach the network.
- Read or write your browser storage or cookies.
- Change the page, other than through the plots and drawings it declares.
- Run text as code. Zscript has no `eval`.

## Work limits

| Limit | What happens when you hit it |
|---|---|
| First run takes more than 20 seconds | The run stops. The message says which line was busiest. |
| Too much work on one bar | The script stops on that bar and tells you the line. |
| A loop turns too many times | The loop stops with an error on its line. |
| Too many items in an array or map | You get an error on the line that added the extra item. |
| Too many series, plots or inputs | You get an error when the script is added. |
| Too many labels, lines, boxes or tables | The oldest ones are removed, with a one-time note. |
| Output too large | The run stops with a message. |

The exact numbers are listed in the reference, under Limits, so they stay the same as the engine.

## Staying under the limits

- Prefer built-ins (`ta.highest`, `ta.sma`) over loops.
- Keep loops short and fixed in length.
- Delete drawings you no longer need.
- Do heavy work only on `barstate.islast` when you only need the result on the newest bar.
