// TradeZoro — indicator versions: the ONE manifest + the helpers the chart uses (ES module, no imports).
// Owner order 13 Nov 2026: "add versions to indicators, add option to choose version, do not auto force updates on
// indicators rather add update indicator icon and option ... to update to users. show changelog in indicators own page."
// How-to for workers: docs/INDICATOR-VERSIONS.md. Read by:
//   assets/chart-ind-versions.js       chart side: Version setting, update icon + popup, keeps settings on Update
//   assets/chart-l2-flow.js (etc.)     an indicator gates old behaviour with below(inputs, '1.1')
//   tools/gen-indicator-pages.js       the "Changelog" section of /indicators/<slug> (reads VERSIONS as text, keep it plain data
//                                      + migrate functions; no imports, no references to other names)
//
// VERSIONS[key]: key = the Indicators-window key ('b:<native type>', 'x:<built-in Pine id>', 'p:<drawing tool>', 'c:<chart type>').
//   base      the version an instance is on when its saved chart has no version stored (= the behaviour it had before versions
//             existed). NEVER change it once shipped: instances on base store nothing, so moving it would move them.
//   versions  oldest first: { v: '1.1', date: 'YYYY-MM-DD', notes: [member-facing lines, plain English], all?: true, migrate?: fn }
//             all: true  = the change reached every chart (bug fix or new options that change nothing until used). Shown in the
//                          changelog, not a choice in the Version setting, no update icon.
//             otherwise  = a behaviour switch: the indicator checks below(inputs, v) and keeps the old behaviour for older
//                          instances; the member picks it in Settings > Version and gets the update icon.
//             migrate(inputs) -> patch of inputs, run once when a member presses Update past this version (renamed settings).
//             src: true  = (built-in Pine 'x:' keys only) this version's source is kept as assets/pine-versions/<id>/<v>.pine, so a
//                          chart can stay on it. The latest version is always assets/pine/<id>.pine. tools/indver-bump.js
//                          writes both the file and the flag; a Pine version without src cannot be picked.
// EVERY indicator is listed (Owner 15 Nov 2026 "i want it on all indicators"): the ones with no history are v1.0 on their first
// release date (seeded by tools/indver-seed.js from tools/indicator-pages/first-release.json). Ship a new version with
// tools/indver-bump.js <key> <v> "<note>" (docs/INDICATOR-VERSIONS.md).

export const VERSIONS = {
  'b:stk_l2f_fp': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-03', notes: ['First release: traded volume per price in each candle, with the resting book size at the candle close beside it, over the full depth of the book.'] },
    { v: '1.1', date: '2026-11-11', notes: [
      'Resting book bars now show only near each candle by default (its high to low plus 2 rows), so the chart stays readable.',
      'New setting "Resting book shown": Near the candle, Off or Full depth.',
      'New setting "Rows beyond the candle".',
      'Lighter colours for the resting book bars.'] },
    { v: '1.2', date: '2026-11-13', all: true, notes: ['New setting: Text size for the traded numbers.'] }
  ] },
  'b:stk_l2f_sw': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-10', notes: ['First release: an anchored VWAP and a volume profile with POC, VAH and VAL for every swing leg.'] },
    { v: '1.1', date: '2026-11-11', all: true, notes: [
      'New "Profile shows" option: Volume, or Volume + Delta.',
      'New "Rows" setting for a fixed number of price rows in each profile.',
      'Fix: POC, VAH and VAL now always sit inside the swing leg.'] }
  ] },
  'b:stk_l2f_dp': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-09', notes: ['First release: delta per price over the last few minutes, a picked range or the session.'] },
    { v: '1.1', date: '2026-11-11', all: true, notes: [
      'New window mode "Reset every interval": the profile fills from the start of each block of minutes, then starts again.',
      'Optional faint line at the previous block\'s POC.'] }
  ] },
  'b:stk_of_big': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-14', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: ['Fix: the automatic size threshold now uses a fixed 24 hour window, so marks no longer change when you drag the chart or reload.'] }
  ] },
  'b:stk_ts_big': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-02', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: ['Fix: the automatic size threshold now uses a fixed 24 hour window, so marks no longer change when you drag the chart or reload.'] },
    { v: '1.2', date: '2026-11-13', all: true, notes: ['Fix: the markers stay on the chart after you switch chart tabs and come back.'] }
  ] },
  'b:stk_l2f_big': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-03', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: ['Fix: the automatic size threshold now uses a fixed 24 hour window, so marks no longer change when you drag the chart or reload.'] },
    { v: '1.2', date: '2026-11-13', all: true, notes: ['Fix: older big trades now get their W, C and P tags straight away, without dragging the chart back first.'] }
  ] },
  'b:stk_fpat': { base: '1.0', versions: [
    { v: '1.0', date: '2026-11-10', notes: ['First release: marks absorption, exhaustion, stacked imbalances, unfinished auctions, delta divergence and trapped traders.'] }
  ] },
  'b:stk_fpat_l2': { base: '1.0', versions: [
    { v: '1.0', date: '2026-11-10', notes: ['First release: marks absorption, exhaustion, stacked imbalances, unfinished auctions, delta divergence and trapped traders.'] }
  ] },
  'b:stk_bk_walls': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-04', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: [
      'Works when the feed sends only one side of the book.',
      'A book side that stops updating is left out, and the chart says so.'] }
  ] },
  'b:stk_footprint': { base: '1.3', versions: [
    { v: '1.0', date: '2026-10-05', notes: ['First release of the Footprint chart type.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: [
      'New Style menu with two new looks: Delta boxes and Delta bars.',
      'Optional Bar stats table.'] },
    { v: '1.2', date: '2026-11-13', all: true, notes: [
      'New settings: Text size, Buy colour and Sell colour.',
      'The Bar stats table and the delta + volume strip can each sit at any corner of the chart.'] },
    { v: '1.3', date: '2026-11-13', all: true, notes: ['Fix: the Bar stats table now always stays on top of candles and other indicators.'] }
  ] },
  'p:frvp': { base: '1.4', versions: [
    { v: '1.0', date: '2026-10-05', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-11', all: true, notes: [
      'POC, VAH and VAL lines stop at the end of the range. New setting "Extend lines right".',
      'Clicks on candles inside the range reach the chart instead of moving the drawing.',
      'New setting "Show thin rows".',
      'Optional delta bars, and an anchored VWAP with bands.',
      'Drawings saved before this keep their old look.'] },
    { v: '1.2', date: '2026-11-13', all: true, notes: [
      'The value area stays the same when you change the number of rows.',
      'Corner handles to resize the range.',
      'Dashes instead of empty delta values where there is no order flow data.'] },
    { v: '1.3', date: '2026-11-13', all: true, notes: ['The value area is now the same on every timeframe: the profile is built from 1-minute bars when they are available.'] },
    { v: '1.4', date: '2026-11-16', all: true, notes: [
      'A profile stays inside its own start and end: it no longer grows to the newest candle on its own. New setting "Extend to now" (off by default) runs it on to the newest candle.',
      'Delta bars stay on screen and on every row that has order flow, also when the start of the range is off the left of the chart.'] }
  ] },
  'b:stk_svp': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-05', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-13', all: true, notes: [
      'Draws and updates live, including the session that is running now.',
      'Session now starts on "both" (day session and overnight, each with its own profile), so the current session is always shown. Pick "rth" in the settings for day session only.'] }
  ] },
  'b:stk_gex': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-07', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-13', all: true, notes: [
      'New optional live levels on futures charts: overnight high and low while the overnight session runs, and the current day high and low.',
      'They are off by default, so your chart looks the same until you turn them on.'] }
  ] },
  'x:htf-po3-lens-stryker': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-07', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: [
      'Fix: live updates no longer add flat stub candles, and the first partial period is not drawn as complete.',
      'Fix: the wick is drawn above and below the body, never across it.'] }
  ] },
  'x:liquidity-master-tradezoro': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-12', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: ['Fix: an Asia session that starts on the first loaded bar is partial and is no longer drawn, so the Asia high and low are the same on every timeframe.'] },
    { v: '1.2', date: '2026-11-18', all: true, notes: ['Fix: higher-timeframe fair value gaps show as soon as their third candle closes on a live chart, at the right place.', 'Fix: with Highest timeframe wins on, a gap inside a higher one now comes back when the higher gap is filled, and a gap that only touches a higher one is kept.'] }
  ] },
  'x:session-sweep-smt-ifvg': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-29', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: ['Fix: an Asia session that starts on the first loaded bar is partial and is no longer drawn, so the Asia high and low are the same on every timeframe.'] }
  ] },
  // ---- every other indicator: v1.0 on its first release (tools/indver-seed.js)
  'b:52-week-high-low': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:accumulation-distribution': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:aroon': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:average-directional-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:average-true-range': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:awesome-oscillator': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:balance-of-power': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:bandwidth': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:bollinger-bands': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:chaikin-money-flow': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:chaikin-oscillator': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:chaikin-volatility': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:chande-kroll-stop': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:chande-momentum-oscillator': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:chandelier-exit': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:choppiness-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:commodity-channel-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:connors-rsi': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:coppock-curve': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:detrended-price-oscillator': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:donchian-channels': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:ease-of-movement': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:elder-ray': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:ema': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:fisher-transform': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:force-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:gator-oscillator': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:historical-volatility': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:intraday-intensity': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:keltner-channels': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:klinger-oscillator': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:know-sure-thing': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:linear-regression-slope': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:lsma': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:ma-envelope': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:macd': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:mass-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:money-flow-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:moving-average': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:negative-volume-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:on-balance-volume': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:parabolic-sar': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:percent-b': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:pivot-points': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:positive-volume-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:ppo': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:price-volume-trend': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:pvo': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:rate-of-change': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:relative-vigor-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:relative-volatility-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:rma': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:rsi': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:schaff-trend-cycle': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:sma': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:smi-ergodic': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:standard-deviation': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:stk_avwap': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:stk_bk_bal': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_bk_large': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_bk_refill': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_bk_regime': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_bk_speed': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_bk_track': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_camarilla': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-05', notes: ['First release.'] }] },
  'b:stk_cex': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-08', notes: ['First release.'] }] },
  'b:stk_crypto_dom': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-10', notes: ['First release.'] }] },
  'b:stk_cvd': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:stk_darkpool': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-07', notes: ['First release.'] }] },
  'b:stk_delta': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:stk_depth_heat': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-06', notes: ['First release.'] }] },
  'b:stk_dex': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-08', notes: ['First release.'] }] },
  'b:stk_dpane': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-22', notes: ['First release.'] }] },
  'b:stk_dsuite': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-22', notes: ['First release.'] }] },
  'b:stk_earn': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_econ': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-14', notes: ['First release.'] }] },
  'b:stk_em': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-14', notes: ['First release.'] }] },
  'b:stk_estcvd': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:stk_funding': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-08', notes: ['First release.'] }] },
  'b:stk_fut_dom': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-02', notes: ['First release.'] }] },
  'b:stk_fut_imb': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-02', notes: ['First release.'] }] },
  'b:stk_fut_walls': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-02', notes: ['First release.'] }] },
  'b:stk_gexheat': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-14', notes: ['First release.'] }] },
  'b:stk_hlintel': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-08', notes: ['First release.'] }] },
  'b:stk_ivrank': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-06', notes: ['First release.'] }] },
  'b:stk_l2f_cvd': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_l2f_delta': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_l2f_lad': { base: '1.0', versions: [
    { v: '1.0', date: '2026-11-03', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-18', notes: ['New settings in groups: Delta bars, Second bar, Numbers, Highlights and Layout. Colours, opacity, which parts show, number format and size, side of the chart and row size.'] }
  ] },
  'b:stk_l2f_stop': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_l2f_vp': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_liq': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-08', notes: ['First release.'] }] },
  'b:stk_liq_bars': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-08', notes: ['First release.'] }] },
  'b:stk_liqmap': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-29', notes: ['First release.'] }] },
  'b:stk_lsr': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-08', notes: ['First release.'] }] },
  'b:stk_lth': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-10', notes: ['First release.'] }] },
  'b:stk_msess': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-28', notes: ['First release.'] }] },
  'b:stk_news': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-14', notes: ['First release.'] }] },
  'b:stk_of_abs': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-23', notes: ['First release.'] }] },
  'b:stk_of_cvd': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-14', notes: ['First release.'] }] },
  'b:stk_of_delta': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-14', notes: ['First release.'] }] },
  'b:stk_of_evr': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-23', notes: ['First release.'] }] },
  'b:stk_of_imb': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-23', notes: ['First release.'] }] },
  'b:stk_of_sweep': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-24', notes: ['First release.'] }] },
  'b:stk_of_tpo': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-23', notes: ['First release.'] }] },
  'b:stk_of_vp': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-14', notes: ['First release.'] }] },
  'b:stk_of_vwap': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-14', notes: ['First release.'] }] },
  'b:stk_offex': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_offex_lv': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_oi': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-08', notes: ['First release.'] }] },
  'b:stk_optflow': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_patterns': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_pdvp': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:stk_rvol': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:stk_tide': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-29', notes: ['First release.'] }] },
  'b:stk_ts_cvd': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-02', notes: ['First release.'] }] },
  'b:stk_ts_delta': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-02', notes: ['First release.'] }] },
  'b:stk_ts_dpane': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_ts_dsuite': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-03', notes: ['First release.'] }] },
  'b:stk_vbubble': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-09', notes: ['First release.'] }] },
  'b:stk_vex': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-08', notes: ['First release.'] }] },
  'b:stk_vheatmap': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-10', notes: ['First release.'] }] },
  'b:stk_zrange': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-06', notes: ['First release.'] }] },
  'b:stk_zvol': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-06', notes: ['First release.'] }] },
  'b:stk_zzone': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-06', notes: ['First release.'] }] },
  'b:stochastic': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:stochastic-rsi': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:supertrend': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:trix': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:true-strength-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:ttm-squeeze': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:ulcer-index': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:ultimate-oscillator': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:vidya': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:volume': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:volume-flow-indicator': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:volume-oscillator': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:vortex-indicator': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:vpvr': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:vwap': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:williams-alligator': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:williams-fractal': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:williams-percent-r': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:zigzag': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'b:zlema': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'p:avwap-click': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'p:dprange': { base: '1.0', versions: [{ v: '1.0', date: '2026-11-09', notes: ['First release.'] }] },
  'x:2022-model-pro-ictkesik': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['Added to ZoroCharts.'] }] },
  'x:algoalpha-smart-signals-2': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-11', notes: ['Added to ZoroCharts.'] }] },
  'x:cisd-model-plus-triton': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['Added to ZoroCharts.'] }] },
  'x:dynamic-liquidity-heatmap-profile-bigbeluga': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-15', notes: ['Added to ZoroCharts.'] }] },
  'x:ema-cross': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'x:forever-pro': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['Added to ZoroCharts.'] }] },
  'x:fvg-relay-stryker': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['First release.'] }] },
  'x:ict-pro-plus-timmynq': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['Added to ZoroCharts.'] }] },
  'x:ifvg-degree-pro-plus': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-09', notes: ['Added to ZoroCharts.'] }] },
  'x:ifvg-pro-stryker': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['First release.'] }, { v: '1.1', date: '2026-11-18', all: true, notes: ['Fix: the risk/reward box stays on the candle where the IFVG triggered, at its entry and stop, on a live chart without re-adding the indicator.'] }] },
  'x:ifvg-ultimate-deluxe-dodgysdd': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['Added to ZoroCharts.'] }] },
  'x:london-intraday-protraction': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['Added to ZoroCharts.'] }] },
  'x:manipulation-model-fb': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['Added to ZoroCharts.'] }] },
  'x:pdhl': { base: '1.0', versions: [{ v: '1.0', date: '2026-09-08', notes: ['First release.'] }] },
  'x:realtime-big-trades-bubbles-samet-lezki': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-14', notes: ['Added to ZoroCharts.'] }] },
  'x:session-vwap': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-05', notes: ['First release.'] }] },
  'x:smt-pro-stryker': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['First release.'] }] },
  'x:stoic-edge-compass': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['Added to ZoroCharts.'] }] },
  'x:trinity-atr-levels': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-09', notes: ['Added to ZoroCharts.'] }] },
  'x:tz-fractal-model': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-11', notes: ['First release.'] }] },
  'x:unicorn-model': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['Added to ZoroCharts.'] }] },
  'x:wcsmc-sp': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-07', notes: ['Added to ZoroCharts.'] }] },
  'x:zeiierman-trend-average': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-11', notes: ['Added to ZoroCharts.'] }] },
  'x:volume-bubbles-quantalgo': { base: '1.0', versions: [{ v: '1.0', date: '2026-10-14', notes: ['Added to ZoroCharts.'] }] }
};

export const VER_KEY = 'ver';   // the input key every pinnable native gets

// '1.10' > '1.9'; a missing part counts as 0
export function cmp(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

// window.__stkIndVerTest: a test page's own manifest (tools/tests/indicator-versions-browser.js), set before the chart loads
let table = (typeof window !== 'undefined' && window.__stkIndVerTest) || VERSIONS;
// tests only: replace the manifest (a "new version ships" without a deploy)
export function setManifest(m) { table = m || VERSIONS; }
export const entry = (key) => table[key] || null;

// the versions a member can pick (behaviour switches), oldest first
// Built-in Pine (x:): only versions whose source is kept (src) + the latest (the current file).
export function pickable(key) {
  const e = entry(key);
  if (!e) return [];
  const n = e.versions.length;
  const out = /^x:/.test(key) ? e.versions.filter((x, i) => x.src || i === n - 1) : e.versions.filter((x, i) => i === 0 || !x.all);
  return out.length > 1 ? out : [];
}
export const pinnable = (key) => pickable(key).length > 1;
export function latest(key) { const p = pickable(key); return p.length ? p[p.length - 1].v : null; }
export function current(key) { const e = entry(key); return e ? e.versions[e.versions.length - 1].v : '1.0'; }
export function baseOf(key) { const e = entry(key); return e ? e.base : '1.0'; }
// What an instance shows as its version (header tag, Version row): the pinned one when pickable, else the current one.
export function shownVer(key, inputs) { return verOf(key, inputs) || current(key); }

// An instance's version: the stored value, else base. An unknown stored value (a chart saved by a newer page) is clamped
// to the newest known version not above it.
export function verOf(key, inputs) {
  const e = entry(key), p = pickable(key);
  if (!e || !p.length) return null;
  const v = inputs && inputs[VER_KEY] != null ? String(inputs[VER_KEY]) : e.base;
  let best = p[0].v;
  for (const x of p) if (cmp(x.v, v) <= 0) best = x.v;
  return best;
}
// For indicator code: is this instance older than version v? Instances with no version input (another page, a test) run the newest code.
export const below = (inputs, v) => !!(inputs && inputs[VER_KEY] != null && cmp(inputs[VER_KEY], v) < 0);
// `when` for a setting that exists from version v on (Vela hides it on older instances)
// (undefined in the list: where the Version setting is absent, e.g. a page without assets/chart-ind-versions.js, the setting shows)
export function since(key, v) { return { key: VER_KEY, anyOf: pickable(key).filter((x) => cmp(x.v, v) >= 0).map((x) => x.v).concat([undefined]) }; }

// the versions after `from`, up to the latest pickable one (what the update popup lists)
export function newer(key, from) {
  const e = entry(key), to = latest(key);
  return e && to ? e.versions.filter((x) => cmp(x.v, from) > 0 && cmp(x.v, to) <= 0) : [];
}
// inputs patch for moving an instance to version `to`: the new version + each passed version's migrate (forward only)
export function upgradePatch(key, inputs, to) {
  const from = verOf(key, inputs) || '0', patch = {};
  let cur = Object.assign({}, inputs);
  for (const x of newer(key, from)) {
    if (cmp(x.v, to) > 0) break;
    if (typeof x.migrate === 'function') { const p = x.migrate(cur) || {}; Object.assign(patch, p); Object.assign(cur, p); }
  }
  patch[VER_KEY] = to;
  return patch;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(d) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1] : String(d || ''); }

// The descriptor a pinnable native is registered with: + the Version setting (first row; default = base, so saved charts without
// it load as before), and new adds start on the latest version. Everything else is the original descriptor.
export function withVersion(desc) {
  const key = 'b:' + (desc && desc.type);
  if (!desc || !pinnable(key) || typeof desc.inputsSchema !== 'function') return desc;
  const p = pickable(key), e = entry(key), last = p[p.length - 1].v;
  const input = { key: VER_KEY, title: 'Version', type: 'string', defval: e.base, options: p.map((x) => x.v),
    display: { options: Object.fromEntries(p.map((x) => ['' + x.v, 'v' + x.v + ' · ' + fmtDate(x.date) + (x.v === last ? ' (latest)' : '')])) },
    tooltip: 'Your chart stays on the version it was added with. Pick an older version to go back, or the latest to update.' };
  let src = null, out = null;
  const schema = () => { const s = desc.inputsSchema() || []; if (s !== src) { src = s; out = [input].concat(s.filter((i) => i.key !== VER_KEY)); } return out; };
  const defs = () => Object.assign(desc.defaultInputs ? desc.defaultInputs() : Object.fromEntries((desc.inputsSchema() || []).map((i) => [i.key, i.defval])), { [VER_KEY]: last });
  return Object.assign({}, desc, { inputsSchema: schema, defaultInputs: defs, __stkVer: input });
}
