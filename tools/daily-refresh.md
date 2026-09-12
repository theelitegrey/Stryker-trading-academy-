# The daily refresh

Three files on this site are dated content: they state what the market did and
what is due, and they are wrong the moment they stop being current.

    assets/market-brief.json    the pre-market brief
    assets/market-map.json      the cross-asset map
    assets/econ-calendar.json   the economic calendar

A scheduled agent session regenerates all three once a day, before the London
open, and pushes them. This file is the runbook that session follows. It is the
instruction set, not a summary of one — the Routine's prompt says little more
than "read this and do it", so anything this file leaves out does not happen.

## Why all three in one sitting

They describe one session. The brief says what is due today, the calendar lists
it with a countdown, and the map prices the board the brief is arguing about. A
fresh brief beside a stale calendar is worse than two stale files, because the
reader has no way to tell which one to believe. Regenerate all three or none.

## The schedule

Weekdays at 05:30 UTC. That is roughly ninety minutes before the London open,
which leaves room for the research, the write-up and the deploy.

There is no weekend run, and there does not need to be one: see `goodUntil`
below. A holiday is the same case — if the US cash market is shut, do not
publish a brief pretending otherwise. Set the previous session's `goodUntil` to
the next real open instead, or leave the files alone if that was already done.

## What to do

1. **Read the three module docs first.** `tools/market-brief.md`,
   `tools/market-map.md` and `tools/econ-calendar.md` each specify their own
   file's fields, tone and failure modes in detail. This runbook only covers
   what is common to all three.

2. **Research with Bigdata.com, in focused passes.** One focus, one period, one
   aspect per call. Never invent a date or a level. If the research does not
   give you a figure, describe the move without one — a wrong level in a trading
   brief is worse than no level. Bigdata.com content is licensed: summarise and
   attribute in our own words, never paste article text into a published file.

   What the three files need, in order:

   - `bigdata_market_tearsheet` for the close: indices, the Treasury curve,
     commodities, FX, crypto. This is the map's backbone.
   - Overnight tape and what moved it.
   - Rates and the dollar — the transmission mechanism.
   - Today's releases, with times, and the actuals for anything that printed
     since the last run.
   - Central bank decisions and what is priced into the next one.

3. **Write the three files.** Follow each module doc. Move the outgoing brief
   into `archive[0]` and trim to the last seven. Fill in `actual` on calendar
   rows that have since printed, extend the far end of the range, and refresh
   `banks[]` whenever a policy rate moves.

4. **Set `generatedAt` and `goodUntil` on all three.** See below.

5. **Validate.** `node -e "require('./assets/<file>.json')"` on each, then
   `python3 tools/check.py`. A JSON file that fails to parse takes its whole
   module off the page.

6. **Commit and push.** Develop on the branch the session is given, then
   fast-forward `main` and push that — the deploy workflow watches `main`.
   A content-only change to these three files needs **no version bump**: all
   three are exempted from the year-long asset cache in `_headers` and
   revalidate on every request. Bump `?v=` only if you also changed a `.js`,
   `.css` or `.html` file.

7. **Confirm the deploy went green** before finishing.

## `generatedAt` and `goodUntil`

`generatedAt` is when you wrote the file. `goodUntil` is the instant it stops
being current, and it outranks the `staleAfterHours` fallback in all three
renderers.

Set `goodUntil` to **the next scheduled run**, never later:

| Run day | `goodUntil` |
| --- | --- |
| Monday – Thursday | the next weekday's 05:30 UTC run |
| Friday | Monday's open (11:00 UTC), or Tuesday's if Monday is a holiday |
| Before a holiday | the next real session's open |

Two rules, and they pull in opposite directions on purpose:

- **Never set it further out than the next run.** `goodUntil` is what silences
  the stale banner, and the stale banner is the only thing that tells a member a
  run was missed. A `goodUntil` a week out means a week of members reading
  last Tuesday's plan with nothing on the page to warn them.
- **`goodUntil` is not a licence to publish old numbers.** It asserts the file is
  still current, so it is only honest when the content genuinely is. A weekend
  `goodUntil` requires a weekend edition — the week that closed and the week
  ahead — not Friday's pre-market brief with a later expiry bolted on.

## What to check before you push

- All three files carry the same `goodUntil`. They describe one session; they
  should expire together.
- Every figure in the prose appears in the research. Spot-check the headline
  numbers against the tearsheet.
- The brief's `calendar[]`, the calendar module's rows for today, and anything
  the map's `read` claims is due all agree with each other.
- Nothing states a direction. These are context, not calls. "Positioning, not
  conviction" is a fair reading; "the market will do X" is not.
- No verbatim licensed text anywhere in the three files.

## If a run fails

Do not publish a partial set. Three stale files with an accurate stale banner
are a better outcome than one fresh file beside two old ones, because the banner
is honest and the mismatch is not. Leave the files untouched, let the banner
fire, and say what broke.
