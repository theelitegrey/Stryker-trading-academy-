# Specialist tracks: outline and status

Owner: @content-developer. Branches:
- `hermes/content-track-vp` (Track 1)
- `hermes/content-track-pf` (Track 2, starts after Track 1 is delivered)

These tracks are separate from the core 42 chapters. They are NOT numbered 43 and up.
Paid (Pro/Elite). Access control, the "Specialist tracks" UI and Firestore
publishing belong to website-developer, through stryker-website-manager.

Files:
- `tools/tracks/<track>/src/<ID>.py`: chapter source. Figures are computed by `tools/tracks/svglib.py`.
- `tools/tracks/<track>/<ID>.json`: output in the core chapter schema, plus `track`.
- `tools/tracks/build.py <track>`: rebuilds and validates. It checks word count,
  sources, quiz, practice, disclaimer, illustrative label, markup and wording.
- `tools/tracks/preview_server.py`: serves the real chapter.html with the track
  chapters appended to CHAPTERS_SEED, for 390/1440 review.
- `tools/tracks/WRITING.md`: the writing brief.
- `tools/tracks/sources.json`: the verified source bank.

Status key:
- todo
- draft: JSON builds and validates
- reviewed: rendered at 390 and 1440 and read by the content gate
- APPROVED

## Track 1: Volume Profile & Order Flow (VP)

| ID | Title | Level | Status | Words | Sources |
|---|---|---|---|---|---|
| VP-01 | Auction Market Theory: How Markets Find Value | foundation | reviewed | 2165 | 6 |
| VP-02 | Market Profile & TPO Charts | foundation | reviewed | 2254 | 5 |
| VP-03 | Volume Profile Anatomy: POC, Value Area, HVN & LVN | foundation | reviewed | 2164 | 6 |
| VP-04 | Profile Shapes & Day Types | intermediate | reviewed | 2126 | 5 |
| VP-05 | Session, Composite & Fixed-Range Profiles | intermediate | reviewed | 2101 | 6 |
| VP-06 | VWAP, Anchored VWAP & Deviation Bands | intermediate | reviewed | 2020 | 5 |
| VP-07 | Order Flow Foundations: Orders, the Book & Matching | intermediate | reviewed | 2052 | 9 |
| VP-08 | Footprint Charts & Delta | advanced | reviewed | 2038 | 5 |
| VP-09 | Order Flow Patterns: Absorption, Exhaustion, Imbalances & Icebergs | advanced | todo | | |
| VP-10 | Data & Tools: Futures, FX Tick Volume & Platforms | intermediate | todo | | |
| VP-11 | Combining Profile & Order Flow with Liquidity & SMC | advanced | todo | | |
| VP-12 | Case Studies & the Profile/Order-Flow Playbook | advanced | todo | | |

Chapter scope:
- VP-01:
  - auction market theory as a framework: the market advertises price to find
    trade, and value is where the most trade occurs;
  - balance vs imbalance, and rotations;
  - initiative vs responsive activity;
  - day timeframe vs other timeframe participants;
  - where Steidlmayer's work came from (CBOT, 1985).
- VP-02:
  - TPO letters (30-minute periods);
  - initial balance and range extension;
  - single prints, tails and buying/selling tails;
  - poor highs/lows;
  - TPO POC and TPO value area.
- VP-03:
  - how a volume profile is built, both from ticks and from lower-timeframe bars;
  - POC;
  - the 70% value area computed step by step (two-row method);
  - VAH/VAL;
  - HVN/LVN;
  - volume vs TPO profiles.
- VP-04:
  - shapes: D (balanced), P, b, thin/elongated (trend), double distribution;
  - day types: trend, normal, normal variation, neutral (centre/extreme), non-trend;
  - how shapes are read as short covering vs long liquidation, as an interpretation.
- VP-05:
  - session vs composite vs fixed-range vs visible-range vs developing profiles;
  - naked/virgin POCs;
  - value migration (higher, lower, overlapping);
  - the open relative to the prior value area (inside, above, below, and above/below range);
  - the "80% rule" framed as a practitioner heuristic without statistics.
- VP-06:
  - VWAP formula and a worked computation;
  - session reset;
  - anchored VWAP (anchor choices: session, swing, event);
  - standard deviation bands maths;
  - how traders use them, including execution benchmarking.
- VP-07:
  - market vs limit vs stop orders;
  - bid/ask/spread;
  - the DOM ladder;
  - time and sales;
  - how an aggressor matches resting liquidity (FIFO worked example, pro-rata mention);
  - partial fills and sweeping the book;
  - queue priority rules.
- VP-08:
  - footprint anatomy (bid x ask, what "bid volume" means: sells hitting the bid);
  - delta per price and per bar;
  - cumulative delta;
  - delta divergence;
  - diagonal imbalance maths;
  - footprint bar statistics;
  - volume vs delta profiles.
- VP-09:
  - absorption;
  - exhaustion;
  - stacked imbalances;
  - iceberg orders (exchange display quantity, and MBO-based detection);
  - trapped traders;
  - "spoofing" is illegal, so describe it only as a reason displayed size is unreliable.
- VP-10:
  - why futures have centralised exchange volume and spot FX does not (OTC, BIS);
  - tick volume and its caveats;
  - ES/MES, NQ/MNQ, CL, GC specs (ticks and multipliers);
  - Globex hours and session choice;
  - data feeds (aggregated vs MBO);
  - tools described neutrally: ATAS, Sierra Chart, Bookmap, NinjaTrader, TradingView and its up/down-volume limitation.
- VP-11:
  - mapping VP/OF onto Stryker's SMC framework;
  - liquidity sweeps into LVNs or through value edges;
  - FVGs vs single prints/LVNs;
  - order blocks at HVN/value edges;
  - killzone timing with IB;
  - SMT with delta divergence;
  - confirmation, not a replacement.
- VP-12:
  - three illustrative worked sessions (responsive fade at VAH, initiative breakout with acceptance, failed auction/poor high);
  - a pre-session checklist;
  - an in-trade checklist;
  - a journaling template;
  - the playbook.

Free Learn funnel articles:
- /learn-volume-profile ("volume profile trading")
- /learn-order-flow ("order flow trading")

## Track 2: Prop Firm Mastery (PF)

Not started. It begins after Track 1 is delivered.

| ID | Title | Status |
|---|---|---|
| PF-01 | What Prop Firms Are & How They Make Money | todo |
| PF-02 | Futures vs Forex/CFD Firms & the Regulatory Landscape | todo |
| PF-03 | How to Vet a Prop Firm | todo |
| PF-04 | The Rules Deep Dive | todo |
| PF-05 | Major Firms Compared (as of <month year>) | todo |
| PF-06 | Passing the Evaluation: Sizing, Risk Plan & Frequency | todo |
| PF-07 | The Funded Stage: Buffers, Payouts & Withdrawals | todo |
| PF-08 | Psychology & Failure Modes | todo |
| PF-09 | Multiple Accounts, Copy Trading & Automation Rules | todo |
| PF-10 | The Business View: Costs, Resets & Expected Value | todo |

Free Learn funnel articles:
- /learn-prop-firm-challenge-rules (live on batch 2)
- /learn-how-prop-firms-work
- /learn-prop-firm-payouts

## Overlaps flagged in the core curriculum

- Ch 15 "Order Flow Case Studies: Gold & Indices" contains no order flow (no
  volume, delta or DOM). Suggest renaming it "Instrument Case Studies: Gold &
  Indices". Unsourced claim: "cleaner structural breaks ... due to concentrated
  institutional participation".
- Ch 41 "Prop Firm & Funded Account Considerations" states unsourced statistics
  as fact: 5-10% pass rates, 70% of failures from loss limits, 40-50% lose within
  90 days, 7% ever paid, "most successful funded traders needed several
  attempts". These must be sourced or cut. Track 2 will link to ch 41 and will
  not repeat them.
