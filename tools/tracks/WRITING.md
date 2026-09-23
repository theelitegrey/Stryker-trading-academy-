# How to write a specialist-track chapter

This is the brief for every chapter in tools/tracks/. Read it all before writing.

## What a chapter is

Each chapter is one Python file at `tools/tracks/<track>/src/<ID>.py`. When it
runs it writes `tools/tracks/<track>/<ID>.json` in the core chapter schema,
using `write_chapter()` from `tools/tracks/svglib.py`. Copy
`tools/tracks/TEMPLATE.py` to start. The first lines must be:

    import os, sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
    from svglib import *

Build and validate:

    cd /root/projects/stryker-content
    python3 tools/tracks/<track>/src/<ID>.py && python3 tools/tracks/build.py <track> --check

The validator must show no "!" lines for your chapter. It checks:
- 2,000 to 3,500 words, counting bodyHtml plus the lesson texts but not figures;
- at least 3 sources;
- a quiz and a "Practice exercises" heading;
- at least 4 lessons;
- the word "illustrative" and the disclaimer;
- no script, style or on* attributes;
- no banned phrases.

## Who reads it

A paying student of Stryker Trading Academy (strykertrading.com), which teaches
ICT and smart money concepts: market structure, liquidity, order blocks, fair
value gaps, SMT divergence, killzones. Assume they know candlesticks and basic
SMC, but nothing about auction theory, volume profile or order flow. Write
plain, friendly English that a beginner can follow:
- short paragraphs, two to four sentences each;
- define every term in bold the first time it appears;
- use concrete worked examples with numbers.

## Structure of bodyHtml, in order

1. An opening paragraph: what the chapter covers and why it matters.
2. Four to seven `<h3>` sections of teaching. Each has at least one computed
   figure or table where a picture helps. Aim for 3 to 6 figures per chapter.
3. A worked example with specific (illustrative) numbers, walked step by step.
4. `<h3>Common mistakes</h3>` as a list.
5. `callout('Key takeaways', '<ul>...</ul>')`.
6. `<h3>Practice exercises</h3>` with three to five concrete tasks done on a
   real chart or platform.
7. `quiz([...])` with four to six questions, each answer explaining why.
8. Sources and the disclaimer are appended by `write_chapter()`. Don't add them yourself.

Lessons: 4 to 6 per chapter, as `(title, descHtml)`. Each lesson is one
practical task tied to a section, written as one or two `<p>`s of 40 to 90 words.

Allowed HTML in bodyHtml:
- p, h3, h4, strong, em, ul, ol, li, table/thead/tbody/tr/th/td, figure,
  figcaption, details, summary, a (https only), blockquote, code, br;
- plus the SVG that svglib emits.

Never use script, style, iframe, on* attributes or img. The reader renders
bodyHtml with innerHTML, so script and style would be dead weight or a risk.

## Figures

Use the svglib helpers only, and feed them data. Never place anything by eye:
- `profile()` builds volume profiles, and computes POC and the 70% value area
  with the CBOT two-row method;
- `tpo()` builds Market Profile letters, with IB and single prints computed;
- `dom()` builds ladders;
- `footprint()` builds bid x ask footprints, with diagonal imbalances computed;
- `candles()` builds candle charts;
- `series()` builds line charts such as cumulative delta;
- `boxes()` builds concept boxes;
- `vwap()` does the VWAP/SD maths, `value_area_steps()` gives the worked
  value-area table, and `table()` builds tables.

Rules for figures:
- Wrap every one in `figure(svg, caption)`. It adds "Illustrative data." automatically.
- Keep figures 400 units wide.
- Keep prices realistic for the instrument and on its tick grid:
  - ES/MES 0.25;
  - NQ 0.25;
  - CL 0.01;
  - GC 0.10.
- Numbers in figures must agree with the text. If the text says "the POC is
  5,001.50", compute it and read it from the helper's return value; don't type it.
- If you need a new figure type, write it in your chapter file using svglib's
  `svg()`, `text()`, `rect()` and `line()`. Keep fonts at 13 units or more, and
  stay inside the viewBox with about 60 units reserved on the right for labels.

## Truth rules (hard)

1. No profit, income or win-rate claims.
2. No invented statistics. Words like "statistically", "80% of traders" or
   "high probability" need a source you actually opened.
3. Present these as methods traders use, not laws. Auction theory, profile
   reading and order-flow patterns are practitioner frameworks, so write "traders
   read this as...", "a common interpretation is...".
4. Label every made-up number as illustrative. Examples are hypothetical.
5. Never say videos or recordings exist. The course is written lessons with diagrams.
6. Every factual claim (contract specs, how matching works, history, tool
   features, the 70% convention) needs a source in the chapter's list that you
   actually opened with web_extract. Prefer:
   - CME Group pages and the CME Client Systems Wiki;
   - SEC/Investor.gov;
   - BIS;
   - the official docs of TradingView, Sierra Chart, ATAS, NinjaTrader and Bookmap;
   - the Wiley and O'Reilly listing for Dalton's Mind Over Markets;
   - the listing for Steidlmayer and Koy's Markets and Market Logic.
   Wikipedia is acceptable only as a secondary history source. Don't cite a
   book for a specific claim you haven't seen in it. Cite it as "further reading"
   only if you can't open it.
7. Describe tools neutrally. No affiliate links, no "best".
8. Link to core chapters as `chapter.html?ch=NN` where relevant: 07 liquidity,
   08 structure, 09 order blocks, 10 FVG, 12 sweeps, 13 killzones, 15 instrument
   case studies, 18 SMT, 36 risk.

The verified source bank is sources.json in this folder. It lists URLs already
opened, with the facts confirmed from them. Use them freely, and add your own
after opening them.
