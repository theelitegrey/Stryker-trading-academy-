# Producing the cross-asset market map

`assets/market-map.json` is regenerated on a schedule and committed. The site
only renders it — no API key in the browser, no per-visit cost, no third-party
request at page load. Same shape as the pre-market brief and the Global
Monitor. See `tools/market-brief.md`; the two are produced in the same sitting
and read together.

The source is the Bigdata.com market tearsheet, which returns all eight asset
classes over all seven windows in one call. One call, one file.

---

## The rules that matter

**Never hand-type a number twice.** `assets/market-map.json` is built by a
script (`gen_map.py` in the working notes) that holds the tearsheet rows as
literals and emits the JSON. A row typed once in a Python tuple with the
columns lined up is a row you can proofread against the source table. A row
typed twice — once as a value and once as a "prior" — will drift. This is why
the Treasury curve stores `chg1M` and lets the renderer derive the month-ago
yield rather than storing a second curve.

**Never mix excess return with outright return.** The factor rows are excess
against the S&P 500. They live in their own group with `"excess": true`, and
the renderer holds them out of the leaders-and-laggards ranking because
"Momentum +0.66%" and "Brent +1.19%" are not the same quantity. If a new group
is a relative measure, flag it the same way.

**Every number comes from the tearsheet.** No estimates, no rounding to a
rounder number, no filling a gap with something plausible. A missing value is
`null` and renders as a dash. The tearsheet prints `–` for instruments with
short histories; carry that through as `null`, do not drop the row silently
and do not invent it.

**Set `scale` deliberately for each group.** It is the multiplier on the
colour bands. Without it the FX grid paints entirely neutral and the crypto
grid entirely extreme, and neither tells the reader anything. Current values:
equities and sectors 1.0, bonds 0.45, commodities 1.8, FX 0.22, crypto 3.5,
factors 0.7. Change one only if the asset class's typical move has genuinely
changed, and say why in the commit.

**The read is the product; the grid is the evidence.** Anyone can publish a
heatmap. `read.points` is what makes the page worth opening — each one names
two things on the board and says what the gap between them means, in trading
terms. Five or six is right. If a point could have been written without
looking at the data, cut it.

**Say what you do not know.** A spread is an observation. "One of them is
early" is a fair reading. "X will converge" is a call, and this page does not
make calls.

---

## Regenerating it

1. Call the Bigdata.com market tearsheet. It returns everything in one pass.
2. Update the row literals in the generator, keeping the same instruments so
   the page does not reshuffle under a returning reader. Add a row only when
   the board genuinely changed.
3. Update `generatedAt` (UTC) and `asOf`. `asOf` matters: the tearsheet mixes
   an equity close with a live commodity and FX print, and the reader deserves
   to know that rather than being told a single time that is wrong for half
   the page.
4. Rewrite `read` from the new numbers. Do not lightly edit yesterday's — the
   whole value is that it describes today's board. If the board has not moved
   enough to change the read, say so in the standfirst rather than dressing up
   the same points.
5. Update `curve.points` and re-check `curve.spreads` arithmetic against the
   yields you just wrote.
6. `python3 tools/check.py`, then commit.

No version bump is needed for a content-only change: `market-map.json` is
excluded from the year-long asset cache in `_headers` and fetched with a
cache-busting parameter.

---

## The colour scale, and why not to change it by eye

The scale is diverging — two hues around a neutral middle — because returns
are polarity data. Each arm is a three-step one-hue ramp, and each arm was
validated **separately** against its own surface: lightness monotone, adjacent
steps at least 0.06 apart in L, and the pale end clearing 2:1 against the
chart background. Validating all seven steps at once fails by construction; a
diverging scale is two sequential ramps plus a midpoint, not one ramp.

The values live in `assets/style.css` as `--mm-d3..--mm-u3` with a paired
`--mm-i*` ink for each, chosen so the text on every fill clears 4.5:1 — which
is why the strongest step flips to the opposite ink. The test suite asserts
those contrasts in both themes, so a substituted colour fails the tests rather
than shipping.

Colour is never the only encoding here. Every cell prints its own signed
number, every grid is a real `<table>` with row and column headers and a
caption, and forced-colors mode drops the fills and puts borders back. A
reader who sees no colour at all loses scanning speed and nothing else.

## The other two terminal files

`assets/market-brief.json` (what moved overnight and what is due) and
`assets/econ-calendar.json` (the schedule itself) are produced in the same
sitting from the same research. All three describe one session, so a stale one
among two fresh ones is the failure mode to avoid. See `tools/market-brief.md`
and `tools/econ-calendar.md`.

## Automating it

A scheduled agent session can do the whole thing. Two things it must be told:

- Produce it alongside the pre-market brief, before the London open, so the
  strip on the brief page and the brief itself describe the same board.
- Skip weekends and US market holidays. The staleness banner exists to catch a
  missed day, not to excuse publishing a Saturday map of Friday's close.
