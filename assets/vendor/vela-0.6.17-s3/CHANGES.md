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
Any further patch goes into a new folder (vela-0.6.17-s4) because these
module files are imported without ?v= cache-busters.

## s2 (2026-10-06, web-temp-5, Charts settings window)
Everything from s1, plus (chunk-YCD72KGK.js, search "Stryker patch (s2)"). All are
off / unchanged unless the host sets `scene.stk` (assets/chart-settings.js does):
- Autoscale margins: `computePaneScale` takes an optional `stk` ({marginTop, marginBottom}
  as fractions of the data span) for the price pane; the old constants are now
  `MARGIN_TOP_DEFAULT` / `MARGIN_BOTTOM_DEFAULT` (2/7, 1/7) and are used when unset.
- 12-hour clock: new `stkClock()`; `timeTicks(..., h12)` and `formatTimeStamp(..., stk)`
  print "3:30 pm" when `scene.stk.h12`; the crosshair and external crosshair chips pass it.
- Weekday: `formatTimeStamp` drops the weekday when `scene.stk.noDow`.
- Colour bars based on previous close: new `stkIsUp(bars, i, prev)`; candles and OHLC
  bars (WebGL emit path and Canvas2D path) use close >= previous close when
  `scene.stk.prevClose`, else close >= open as before. Aggregated (far zoomed-out)
  columns keep open/close colouring.

## s3 (2026-10-06, web-temp-5, Charts smoothness)
Everything from s2, plus (chunk-YCD72KGK.js, search "Stryker patch (s3)"):
- `tzOffsetMs()` caches one `Intl.DateTimeFormat` per zone and the offset per 15-minute
  bucket (computed at the bucket start). Upstream built a new formatter on every call
  (crosshair time chip, time axis, grid), which cost ~200 ms of script per crosshair/pan
  sweep on any non-UTC chart timezone (the Settings window lets users pick one).
