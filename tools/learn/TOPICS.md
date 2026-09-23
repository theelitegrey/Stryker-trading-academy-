# Learn library: topic plan (batch 2 onward)

Owner: @content-developer. Updated 2026-09-23. This replaces the earlier 20-topic
ICT-only proposal; its remaining items are kept in the backlog at the bottom.
Already live: fair value gap, order blocks, liquidity sweeps.

## How this list is ranked

We have no keyword-volume tool, so this file contains **no search-volume
numbers**, and none should be invented. The ranking uses two signals we can check:

1. **Beginner search demand (proxy).** The phrase and its beginner variants
   ("meaning", "example", "explained", "vs") appear in Google autocomplete
   (checked 2026-09-23 via suggestqueries.google.com; the variants seen are listed
   under each topic). Autocomplete shows that people search for a phrase. It is not a volume figure.
2. **Course fit.** How directly the topic leads into chapters of the curriculum
   (assets/chapters-data.js), so each article is a real on-ramp to the course.
   Articles explain the concept publicly and never copy chapter text.

Standard for every article: 1200-2500 words, key takeaways, a worked example,
common mistakes, FAQ (+ FAQPage JSON-LD), sources you actually opened, a UTM-tagged CTA,
"Education only. Not financial advice.", and screenshots checked at 390px and 1440px before approval.
ICT/SMC ideas are presented as practitioner methods. Prop-firm rules are
quoted from the firm's own page and marked "as of <month year>".

## The next 12

| # | Status | Slug | Target search phrase | Area | Chapters |
|---|---|---|---|---|---|
| 1 | Written (batch 2) | prop-firm-challenge-rules | how to pass a prop firm challenge | Prop firms | 41 |
| 2 | Written (batch 2) | bos-vs-choch | break of structure and change of character | Market structure | 04, 08 |
| 3 | Written (batch 2) | smt-divergence | smt divergence | SMT divergence | 17-20, 27-29 |
| 4 | Planned | position-sizing-futures | position size calculator futures | Risk management | 36, 38 |
| 5 | Planned | smart-money-concepts | smart money concepts | SMC + ICT overview | 01-16 |
| 6 | Planned | buy-side-sell-side-liquidity | buy side liquidity and sell side liquidity | ICT / liquidity | 07 |
| 7 | Planned | premium-and-discount | premium and discount ict | ICT | 11 |
| 8 | Planned | ict-killzones | ict killzone times | ICT / sessions | 13 |
| 9 | Written (track funnel) | volume-profile | volume profile | Volume | VP track (VP-01 to VP-06) |
| 10 | Written (track funnel) | order-flow | order flow trading | Order flow | VP track (VP-07 to VP-11) |
| 11 | Planned | prop-firm-payouts | prop firm payout rules | Prop firms | 41 |
| 12 | Planned | multiple-timeframe-analysis | multiple timeframe analysis | Market structure | 16 |

## Angle and visuals

1. **How to pass a prop firm challenge: the rules that matter.**
   Autocomplete: "how to pass a prop firm challenge", "prop firm challenge rules",
   "trailing drawdown vs static drawdown which is better".
   Angle: most accounts end on a rule, not on a bad read. Covers static vs EOD vs intraday trailing
   drawdown, daily loss limits, consistency rules and payouts, quoted from Topstep, Apex, Tradeify,
   Blue Guardian, MFFU and Lucid. No promises of passing.
   Visuals: toggle chart of one hypothetical balance path under the three
   drawdown rules (floors computed in tools/learn/figs.py); consistency calculator; table.
2. **Break of structure vs change of character.**
   Autocomplete: "break of structure and change of character", "break of structure
   meaning in trading", "break of structure examples", "change of character chart".
   Angle: a trend has many BOS and one CHoCH. Which swing counts, and why a wick is not a break.
   Visuals: 6-step step-through swing chart (computed break points), comparison table, quiz.
3. **SMT divergence explained.**
   Autocomplete: "smt divergence meaning", "smt divergence pairs list".
   Angle: SMT is when two correlated markets disagree at a level you already marked. It is
   confirmation, not a signal. Pairs covered: ES/NQ, EUR/USD vs GBP/USD, and EUR/USD vs DXY (inverse).
   Visuals: ES and NQ panels on a shared time axis with a bullish/bearish toggle; quiz.
4. **Position sizing for futures: how many contracts?**
   Autocomplete: "position size calculator futures", "lot size calculator nasdaq
   futures", "risk management trading meaning".
   Angle: pick a fixed dollar risk, then contracts = risk / (stop in ticks x tick
   value). Tick values come from CME contract specs for ES, NQ, MES and MNQ. On a prop account,
   size against the drawdown, not the balance.
   Visuals: interactive calculator; tick-value table; hypothetical losing-streak
   chart at two risk levels (labelled hypothetical).
5. **What are smart money concepts? A beginner's map of SMC and ICT.**
   Autocomplete: "smart money concepts", "ict trading meaning", "ict trading concepts".
   Angle: a map of the vocabulary (structure, liquidity, PD arrays, entries), with an honest note
   that these are practitioner methods. This becomes the hub page that links to every Learn article.
   Visuals: clickable concept-map SVG; glossary accordion.
6. **Buy-side and sell-side liquidity.**
   Autocomplete: "buy side liquidity and sell side liquidity", "buy side liquidity
   meaning", "buy side liquidity example".
   Angle: where resting orders cluster (above highs, below lows) and why, and what a "draw
   on liquidity" means. It complements the liquidity sweeps article and doesn't repeat it.
   Visuals: annotated range chart with BSL/SSL pools; step-through draw on liquidity.
7. **Premium and discount zones.**
   Autocomplete: "premium and discount ict", "premium and discount zone ict",
   "premium vs discount ict".
   Angle: split a dealing range at 50% and use the halves as a filter. How to choose the range,
   and why changing the range changes the answer.
   Visuals: draggable range (touch-friendly) with a live 50% line and an OTE band.
8. **ICT killzones: session times explained.**
   Autocomplete: "ict killzone times", "ict killzone times utc-4", "... ist", "... gmt".
   Angle: the session windows in New York time, converted with daylight saving handled
   correctly, plus the caveat that the windows are a convention.
   Visuals: 24-hour dial showing the reader's local time (JS timezone); conversion table.
9. **Volume profile: POC, value area, HVN and LVN.**
   Autocomplete: "volume profile", "volume profile strategy", "volume profile indicator".
   Angle: volume by price, not by time. Point of control and value area, traced
   back to the CBOT Market Profile, using CME Group education as the primary source.
   Visuals: a profile built from real, dated public OHLCV data; toggle between time bars and
   the price histogram.
10. **Order flow basics: DOM, time and sales, delta, footprint.**
    Autocomplete: "order flow trading", "order flow trading strategy".
    Angle: what the order book and the tape actually show: bid/ask aggression and
    delta. Limited to verifiable mechanics.
    Visuals: animated order book where market orders consume price levels (reduced-motion safe);
    footprint cell explainer.
11. **Prop firm payouts: how they actually work.**
    Autocomplete: "prop firm payout", "prop firm payout rules".
    Angle: eligibility days, splits, caps, buffers and consistency resets, quoted per
    firm "as of <month year>". No income claims. The homepage payout
    certificates are not restated, reworded or used as evidence here.
    Visuals: payout-eligibility flowchart; a worked hypothetical payout cycle.
12. **Multiple timeframe analysis (top-down).**
    Autocomplete: "multiple timeframe analysis", "multiple time frame analysis for day trading".
    Angle: one timeframe for direction, one for setup, one for entry, and how to stop
    them contradicting each other. Reuses the BOS/CHoCH vocabulary.
    Visuals: three stacked views of one illustrative move with linked highlights.

## Backlog (from the first proposal)
Displacement; optimal trade entry (OTE); breaker blocks vs order blocks; inverse FVG;
Judas swing; power of three (AMD); how to journal trades; stop placement;
ICT vs classic supply and demand.

## Specialist tracks (paid, Pro/Elite)
Separate from the core 42 chapters; outline and status in tools/tracks/TRACKS.md.

| Track | IDs | Status | Free funnel articles |
|---|---|---|---|
| Volume Profile & Order Flow | VP-01 to VP-12 | Written, reviewed at 390/1440 | /learn-volume-profile, /learn-order-flow |
| Prop Firm Mastery | PF-01 to PF-10 | Next | /learn-prop-firm-challenge-rules (exists), /learn-prop-firm-payouts (planned, topic 11) |
