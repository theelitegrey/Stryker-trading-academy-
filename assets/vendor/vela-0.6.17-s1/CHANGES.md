# Stryker changes to @luxalgo/vela 0.6.17 (Apache-2.0)

Upstream: https://github.com/LuxAlgo/Vela, npm @luxalgo/vela@0.6.17, dist/ folder.
LICENSE and NOTICE in this folder are the upstream files. Everything here is
unmodified except **chunk-YCD72KGK.js** (search "Stryker patch"):

- Stryker change: 1-device-pixel crisp wicks. `CANDLE_WICK_W` 1.5 -> 1;
  `wickWidth()` returns 1; `candleGeometry()` uses floor(dpr) device px for the
  wick and snaps it to the pixel grid (was round(1.5*dpr)).
- Body width: new `strykerTvBodyDev()` (TradingView's curve, same formula as
  lightweight-charts `optimalCandlestickWidth`: ~80% of bar spacing, 3 px floor
  between 2.5 and 4 px spacing, 1 px stick when far out). Was floor(0.7*spacing).
  `CANDLE_BODY_MIN_SPACING` 3 -> 2.5.
- Volume columns: `columnHalfWidth()` uses the same body curve.
- Themes (`DARK_THEME` / `LIGHT_THEME`): dark background #151619 -> #0f0f0f,
  grid #20222c -> #1c1c1c, border #2a2b30 -> #2a2a2a; light grid #cccccc ->
  #f0f3fa, border #d4dae3 -> #e0e3eb; font "sans-serif" -> TradingView-like
  system stack (`STRYKER_TV_FONT`).

Credit stays in the Charts toolbar (i) Credits popover ("Vela by LuxAlgo").
Any further patch goes into a new folder (vela-0.6.17-s2) because these
module files are imported without ?v= cache-busters.
