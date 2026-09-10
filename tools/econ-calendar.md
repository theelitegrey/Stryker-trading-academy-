# Producing the economic calendar

`assets/econ-calendar.json` is regenerated on a schedule and committed. The site
only renders it. Same publish-a-file shape as the pre-market brief and the
market map — produce all three in the same sitting, before the London open.

---

## The one rule you cannot break

**Times are UTC, and only UTC.** Every event carries a single `at` field: an
ISO timestamp ending in `Z`. Never write "08:30 ET" into this file. It is wrong
for most of the membership all year, wrong for everyone twice a year when the
clocks move, and a calendar showing the wrong minute for a high-impact release
is worse than no calendar at all. The renderer converts to the reader's own
clock and offers a New York view for people who think in the session's time.

The test suite asserts this: a string matching a time followed by a zone name
anywhere in `events` fails the build.

---

## Where the data comes from

Bigdata.com covers two of the three layers directly and one indirectly.

| Layer | Tool | Notes |
| --- | --- | --- |
| Macro releases, forecasts, previous | `bigdata_search` | Not a structured feed. Research it the way the brief is researched: focused queries, one topic each. |
| Central bank decisions and market pricing | `bigdata_search` | Swap and futures pricing gets quoted constantly in FX coverage; that is where the odds come from. |
| Corporate earnings | `bigdata_events_calendar` | Structured. `categories: ["earnings-call"]`, `countries: ["US"]`. Returns UTC timestamps already. |

**`bigdata_events_calendar` does not cover macro releases.** It is a corporate
events calendar — earnings, conferences, IPOs, delistings. Reaching for it to
build a Forex Factory-style page returns the wrong thing. Use it for the
earnings rows only, and mark those `"kind": "earnings"`.

---

## The rules that matter

**Never invent a forecast.** If no consensus figure was published, leave
`forecast` out entirely and let it render as a dash. The August core CPI row is
the worked example: no clean consensus was quoted anywhere, so the row carries
only `previous` and says so in its note. A made-up consensus is worse than a
missing one, because price trades the gap to consensus and a wrong one puts the
reader on the wrong side of it.

**Grade impact by market structure, not importance.** High means the spread
widens, liquidity thins and the first move often reverses. It is not a claim
about which release matters most to the economy. Plenty of genuinely important
data is medium because the market has already priced it. The page says this out
loud in `howToRead`, because trading a medium row as if it were noise is how
people get hurt on a quiet Tuesday.

**A market holiday is not low impact.** Holidays carry `"impact": "holiday"`
and survive every impact filter by design. A closed market is the single most
useful thing this page can tell someone, and burying it under a "high only"
filter would be a bug. (It was one, briefly.)

**A policy card needs a rate.** `banks[]` entries lead with the current policy
rate as their headline number. If the research did not give you one, leave the
central bank out rather than shipping a card whose hero is a dash. The next
meeting date alone is not worth a card — its absence from the calendar already
says that. The test suite fails a bank row with no rate.

**Notes earn their place.** `note` is what the row means for the session, in
trading terms. Every high-impact row should have one. If a note could have been
written without looking at anything, cut it.

**Actual only when it is actually out.** Rows for releases that have happened
carry `actual`. The renderer colours it against `forecast` and nothing else —
up or down against the *previous* reading is deliberately left uncoloured,
because that is not what price trades.

---

## The date ranges

The chips are `From today` (the default), `Today`, `Past week`, `This week`,
`Next week`, `This month`, `Next month` and `All dates`. Three things about how
they are built:

They compare **calendar-day strings in the displayed zone**, not timestamps.
That means "this week" always means the same week as the day headers the reader
is looking at, switching to the New York view reshuffles both together, and
there is no hour of the day where a boundary lands on the wrong side.

Weeks start **Monday**. A trading week is Monday to Friday, and "this week" on
a Sunday should mean the week about to start, not the one that just ended.

Every chip's badge answers one question: **how many rows would I see if I
clicked this, leaving my other choices alone.** All three rows — range,
currency, impact — are built from the same helper so the numbers are
comparable. A chip reading 0 dims but stays clickable: hiding a filter because
it currently has no results makes the control set shift under the reader every
time another filter changes.

The default is `From today` rather than `Today` because the page's job is
preparation. Someone opening it at 06:00 needs the rest of the week, not only
the next few hours. The past is one click away.

Keep `rangeStart` and `rangeEnd` honest — the empty state quotes them verbatim
when a reader picks a window the file does not reach, which is a far better
message than blaming a filter.

## Regenerating it

1. Research the week's macro releases — one focused Bigdata.com search per
   topic, per the discipline in `tools/market-brief.md`.
2. Pull earnings with `bigdata_events_calendar` for the same window.
3. Update the row literals in the generator, keeping `rangeStart` / `rangeEnd`
   about a week back and a week forward. The past week is what makes the
   forward week readable.
4. Move any release that has printed from `forecast`-only to carrying `actual`.
5. Refresh `banks` — the policy rate, the next meeting date and what is priced.
6. `python3 tools/check.py`, then commit.

No version bump is needed for a content-only change: `econ-calendar.json` is
excluded from the year-long asset cache in `_headers`.

## Automating it

Skip weekends and US market holidays. A calendar is the one module where the
staleness banner is a poor substitute for the real thing, because a reader
checking a release time is looking for a fact, not an opinion.
