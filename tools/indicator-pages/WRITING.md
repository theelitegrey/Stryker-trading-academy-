# Indicator page write-ups: brief for writers

One JSON file per indicator: `tools/indicator-pages/content/<slug>.json`. The page generator
(`tools/gen-indicator-pages.js`) merges it with the catalogue (name, author, group, Free/Pro, settings table
parsed from code). Settings tables are built from code: do NOT write them.

## Shape (all strings plain text, no HTML, no markdown)

```json
{
  "slug": "big-trades",
  "summary": "One plain sentence, 90-160 characters, says what it draws. Used on cards and as the meta description.",
  "overview": ["1-2 short paragraphs: what it is and what you see on the chart."],
  "how": ["1-3 short paragraphs: how it is calculated / what data it reads, from the source code."],
  "use": ["3-5 bullets: ways traders read it. Education framing: 'Some traders watch...', 'Use it to see...'."],
  "alerts": "One sentence on alerts, ONLY if the code supports them (see below). Omit the key otherwise.",
  "notes": ["1-4 bullets: data needs, markets it works on, limits, what it does not do."],
  "learn": "optional: one of fair-value-gap | order-blocks | liquidity-sweeps | bos-vs-choch | smt-divergence | volume-profile | order-flow"
}
```

Length: about 180-380 words in total per indicator. Short sentences. Plain, simple English.

## How to write it

1. Open the source file listed for the indicator and READ what it actually does (its header comment, its
   inputs, what it draws, what data it fetches). Describe only that. Never invent features, numbers, symbols,
   or markets that the code does not show. If unsure, leave it out.
2. Classic indicators (RSI, MACD...): the standard textbook formula is fine, matched against the settings
   listed in the batch file (defaults come from the code).
3. Alerts: Pine scripts list their `alertcondition` titles in the batch (`alerts.conditions`); `anyAlert` = the
   script calls `alert()`. For those, say members can create an alert on those conditions from the chart's
   alert dialog (alerts from indicators run while ZoroCharts is open in the browser). Classic built-ins
   (`alerts.plot: true`) support plot alerts: "Alerts: you can alert on its line crossing a value or the
   candle close (from the chart's + menu); checked while ZoroCharts is open." TradeZoro natives: only if
   the source has alert support; otherwise omit `alerts`.
4. `learn`: set it only if the indicator is clearly about that concept.

## Hard rules (a write-up that breaks one is rejected)

- No trading-result, win-rate, accuracy, profit or return claims. Never "wins", "profitable", "high
  probability", "accurate signals", "never repaints", "guaranteed". Use "helps you see", "marks", "shows".
- No hype words: powerful, ultimate, revolutionary, game-changer, best, secret, institutional-grade, etc.
  (A script's own name may contain such a word; that is fine as the name only.)
- No competitor or vendor names (no TradingView, no data vendors, no exchange-feed vendor names, never
  "Vela", never "LuxAlgo"). Say "Data feed L1" / "Data feed L2" for futures data. For third-party scripts do
  not name the site they came from; the page credits the author and links the original itself.
- No prices, plans or money amounts. Do not write "Pro" or "Free" claims; the page shows the plan chip.
- GEX / options copy: never "live", "real-time", "delayed" or "behind". Say "updated every few minutes" only
  if the code says so, or "shows when it was last updated (for example 'updated 3 min ago')".
- Third-party (Community) scripts: describe what the script draws, in your own words; do not quote or
  paste any of its code; do not say TradeZoro made it.
- No emoji. No ALL-CAPS sentences. Second person ("you") is fine.
- Do not mention "Education only. Not financial advice."; the page adds it.

## Data notes you can rely on (from the code and current product rules)

- Order-flow tools (Order flow group) and GEX/Expected Move/Options Flow are Pro tools.
- "(L1)" tools use the futures trade stream (Data feed L1); futures L1 data is free for members who sign the
  market data agreement. "(L2)" tools need the order book (Data feed L2), which is Pro.
- "(trades)" tools build from recorded futures trades (per-trade data, not candles).
- Crypto order-book tools read the exchange's public order book for crypto symbols.
