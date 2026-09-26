# Storyboard authoring guide (assets/setup-player.js)

A storyboard is `model.storyboard` in a model object (see the header
comment of `assets/setup-player.js` for the exact schema and
`assets/models-data.js`'s header comment for where it sits on a model).
It drives the interactive setup player on model.html: candles arrive, then
annotations (levels, zones, the sweep, the MSS, entry/stop/target...) are
drawn in frame by frame with a caption under the chart.

Before you paste a storyboard into `assets/models-data.js`, run it through
the validator:

    node tools/storyboards/validate.mjs                      # checks the whole models-data.js file
    node tools/storyboards/validate.mjs path/to/your.json     # checks a standalone JSON file first

Fix everything it reports. It calls the REAL player code, so if it passes,
the player will actually render your storyboard; if it silently drops an
annotation or rejects the whole thing, the validator tells you exactly
which one and why, before it ever reaches a visitor.

## Ground rules (non-negotiable)

1. **Illustrative candles only.** Candles are made up to demonstrate the
   shape of the setup. Never trace a chart from a real chart, a real
   symbol, or a real date. The player labels every storyboard
   "Illustrative example" on screen — keep that true.
2. **No prices in labels or captions.** Prices are numbers the player uses
   to position lines and zones; they must never appear as literal text a
   student reads (a label like `"114.20"` or a caption like "enters at
   114.2" is wrong). Use plain descriptive labels instead: `"Entry"`,
   `"Old high"`, `"Buy-side liquidity"`.
3. **No win rates, no performance numbers, no claims of results anywhere**
   in a storyboard. This is a walkthrough of a pattern's shape, not a
   track record. If you want to show real backtest numbers, that is the
   separate stats card (`model.stats`, Owner-approval required) — never
   the storyboard.
4. **Captions are plain text, never HTML**, and must be 300 characters or
   fewer. Write like you're explaining the frame out loud to a student
   looking at the chart with you.
5. **6-10 frames.** Fewer than 6 rushes the idea; more than 10 loses the
   reader's attention on a page that already has the full written
   walkthrough below it. (The player technically allows 1-30 frames — this
   guide's 6-10 is the house style, not a hard validator limit.)

## Annotation types (cheat sheet)

Every annotation needs a unique `id` (string) inside its OWN storyboard.
Candle positions (`from`, `to`, `at`) are 0-based indices into `candles`.
`label` is always optional plain text. `tone` is one of `liq | bull | bear
| neutral` (only used by `level`; `fvg` defaults to `bull`, `level`
defaults to `liq`, everything else `neutral`).

| type | required fields | what it draws |
|---|---|---|
| `level` | `price` | dashed horizontal line (liquidity, an old high/low) |
| `zone` | `top`, `bottom` | a price box (order block, a range) |
| `fvg` | `top`, `bottom` | a price box, same as `zone`, defaults to bullish tone |
| `band` | (none beyond from/to) | a full-height time window (a killzone, the session open) |
| `sweep` | `at`, `side: "high"\|"low"` | a marker on the wick that ran the liquidity |
| `mss` | `price` | the broken swing line, drawn to the breaking candle |
| `entry` / `stop` / `target` | `price` | an order line |
| `highlight` | (none beyond from/to) | a ring around one or more candles |
| `arrow` | `from: {at, price}`, `to: {at, price}` | direction of delivery |
| `note` | `at`, `price`, `label` (label is REQUIRED here) | free text pinned to a candle |

`labelSide: "left" | "right"` moves a line/zone label to either end
(default right).

**Forward-projecting lines are fine.** `level`, `zone`, `band`, `mss`,
`entry`, `stop`, `target` and `arrow` are drawn with a fixed
whole-storyboard x-formula, so a line's `to` (or an arrow's `to.at`) can
point at a candle several frames in the future and it will still render
correctly stretching into that space — this is how you draw "buy-side
liquidity" pointing at a high the story hasn't reached yet. Only the
line's `from` (its origin) needs to be on an already-revealed candle.
`highlight`, `sweep` and `note` are different: they index straight into a
specific candle's real price, so every candle index they use must already
be revealed in that frame (or a later frame while the annotation is still
on screen).

## Frame fields

```
{
  title:   "Mark the liquidity",     // short step name (optional, shown above the caption)
  caption: "Plain-text caption ...", // REQUIRED, plain text, <= 300 chars
  reveal:  10,                       // candles visible this frame (default: previous frame's; first frame: all)
  add:     [ <annotation>, ... ],    // appears this frame, stays after it until removed
  remove:  [ "id", ... ],            // annotation ids that disappear from this frame on
  focus:   [ "id", ... ],            // optional: every OTHER annotation dims this frame
  hold:    3200                      // optional ms at 1x before auto-advance (default from caption length)
}
```

## Copy-paste skeleton (one of every annotation type)

Paste this into a scratch JSON file, edit the numbers/labels, run it
through the validator, THEN paste the finished object into
`assets/models-data.js` under the matching model's `storyboard` key. Or
start from `node tools/storyboards/new-model.mjs <your-model-id>`, which
gives you the whole model object (not just the storyboard) with this
skeleton already wired in.

```json
{
  "version": 1,
  "title": "Replace with a short storyboard title",
  "timeframe": "15m",
  "candles": [
    {"o": 100.0, "h": 100.8, "l": 99.6,  "c": 100.4},
    {"o": 100.4, "h": 101.2, "l": 100.0, "c": 100.9},
    {"o": 100.9, "h": 101.6, "l": 100.5, "c": 101.3},
    {"o": 101.3, "h": 102.4, "l": 101.0, "c": 102.1},
    {"o": 102.1, "h": 102.6, "l": 101.6, "c": 101.9},
    {"o": 101.9, "h": 102.2, "l": 101.2, "c": 101.5},
    {"o": 101.5, "h": 101.8, "l": 100.6, "c": 100.9},
    {"o": 100.9, "h": 101.4, "l": 100.7, "c": 101.2},
    {"o": 101.2, "h": 102.5, "l": 101.0, "c": 102.3},
    {"o": 102.3, "h": 103.4, "l": 102.1, "c": 103.1},
    {"o": 103.1, "h": 103.6, "l": 102.8, "c": 103.4},
    {"o": 103.4, "h": 104.3, "l": 103.2, "c": 104.0}
  ],
  "frames": [
    {
      "title": "Frame 1 — set the stage",
      "caption": "Plain-text description of what the reader should notice in the first few candles.",
      "reveal": 4,
      "add": [
        { "type": "band", "id": "session", "from": 0, "to": 3, "label": "Session open" }
      ]
    },
    {
      "title": "Frame 2 — mark the liquidity",
      "caption": "Describe the level being marked and why it matters to the setup.",
      "reveal": 6,
      "add": [
        { "type": "level", "id": "liq1", "price": 102.6, "from": 4, "to": 11, "label": "Old high", "tone": "liq" }
      ]
    },
    {
      "title": "Frame 3 — the sweep",
      "caption": "Describe the wick that takes the liquidity.",
      "reveal": 7,
      "add": [
        { "type": "sweep", "id": "sweep1", "at": 6, "side": "low", "label": "Sweep" }
      ]
    },
    {
      "title": "Frame 4 — the reaction",
      "caption": "Describe the highlighted candle(s) reacting away from the level.",
      "reveal": 8,
      "focus": ["sweep1", "reactHl"],
      "add": [
        { "type": "highlight", "id": "reactHl", "from": 7, "to": 7 }
      ]
    },
    {
      "title": "Frame 5 — confirm structure",
      "caption": "Describe the market structure shift that confirms the idea.",
      "reveal": 9,
      "remove": ["reactHl"],
      "add": [
        { "type": "mss", "id": "mss1", "price": 101.9, "from": 6, "to": 8, "label": "MSS" }
      ]
    },
    {
      "title": "Frame 6 — direction of delivery",
      "caption": "Describe the arrow showing where price is expected to travel next.",
      "reveal": 10,
      "add": [
        { "type": "arrow", "id": "arrow1", "from": {"at": 8, "price": 101.2}, "to": {"at": 10, "price": 103.4} }
      ]
    },
    {
      "title": "Frame 7 — a note on context",
      "caption": "Anything worth calling out on a specific candle (e.g. a session boundary).",
      "reveal": 11,
      "add": [
        { "type": "note", "id": "note1", "at": 9, "price": 103.6, "label": "Session high" }
      ]
    },
    {
      "title": "Frame 8 — entry, stop and target",
      "caption": "Describe the trade: where it enters, where it's invalidated, what it's aiming for.",
      "reveal": 12,
      "remove": ["liq1"],
      "add": [
        { "type": "zone",   "id": "ob",     "top": 101.6, "bottom": 101.2, "from": 5, "to": 11, "label": "Order block" },
        { "type": "entry",  "id": "entry1", "price": 101.4, "from": 8, "to": 11, "label": "Entry" },
        { "type": "stop",   "id": "stop1",  "price": 100.6, "from": 8, "to": 11, "label": "Stop" },
        { "type": "target", "id": "target1","price": 103.6, "from": 8, "to": 11, "label": "Target" }
      ]
    }
  ]
}
```

This skeleton is deliberately 8 frames and uses every annotation type at
least once (`fvg` is omitted only because it renders identically to
`zone` with a different default tone — swap `"type": "zone"` for
`"type": "fvg"` on the order-block frame above if your model is an FVG
setup). Delete whichever annotation types your model doesn't need; keep
the frame count inside 6-10.
