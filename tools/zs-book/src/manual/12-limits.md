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

## The numbers

These are the limits the engine enforces today.

| What | Limit |
|---|---|
| Script size | 256 KB, 20,000 lines |
| Nesting depth | 128 |
| Bars in one run | 50,000 |
| First full run | 20 seconds |
| Work per bar | 1,000,000 operations |
| Turns of one loop, per bar | 100,000 |
| Function calls inside each other | 64 (a function cannot call itself) |
| Items in one array | 100,000 (1,000,000 across all arrays) |
| Keys in one map | 50,000 |
| Length of one string | 4,096 characters |
| Plots, marks, fills, hlines, bgcolor and barcolor calls | 64 together |
| Labels, lines, boxes | 50 each by default, up to 500 with `max_labels_count` and friends |
| Tables | up to 20; 1,000 cells each |
| Alerts kept per run | 500 |
| `request.security` calls | 16 |
| Look-back with `[n]` | 500 bars by default, up to 5,000 with `max_bars_back` |

## What happens when you hit one

| Limit | What you see |
|---|---|
| Run takes longer than 20 seconds | The run stops (E401). |
| Too much work on one bar | The script stops on that bar and shows the line (E403). |
| A loop turns too many times | The loop stops with an error on its line (E404). |
| Too many items in an array or map | Error on the line that added the extra item (E405, E406). |
| Too many plots | Error when the script is added (E341). |
| Too many labels, lines or boxes | The oldest are removed first. This is not an error. |
| Too many tables | Error (E408). |

Every code is explained in [Error and warning codes](/zscript/error-codes).

## Staying under the limits

- Prefer built-ins (`ta.highest`, `ta.sma`) over loops.
- Keep loops short and fixed in length.
- Delete drawings you no longer need.
- Do heavy work only on `barstate.islast` when you only need the result on the newest bar.
