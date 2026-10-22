#!/usr/bin/env python3
"""Apply the TradeZoro patches to a pristine @luxalgo/vela 0.9.0 dist copy.

Usage: python3 tools/vela-090-patch.py assets/vendor/vela-0.9.0-s3
Run it ONCE on the unmodified npm files (npm pack @luxalgo/vela@0.9.0, dist/*.js and
dist/providers/*.js). Every edit asserts its anchor text occurs exactly once, so a
different upstream build fails loudly instead of half-patching. See CHANGES.md there.
"""
import sys, os

D = sys.argv[1]
done = []


def edit(fname, old, new, count=1):
    p = os.path.join(D, fname)
    s = open(p, encoding='utf-8').read()
    n = s.count(old)
    if n != count:
        sys.exit(f'{fname}: anchor found {n}x (want {count}): {old[:80]!r}')
    s = s.replace(old, new)
    open(p, 'w', encoding='utf-8').write(s)
    done.append(old[:50].replace('\n', ' '))


C = 'chunk-XIRSR3D6.js'      # renderer, interaction, drawings
F = 'chunk-O6L27KRB.js'      # formatting / time zones

# ---------------- s1-s3 re-applied (from vela-0.6.17-s3) ----------------
# Theme: TradingView-like dark/light defaults + font stack.
edit(C, '// src/core/theme.ts\nvar DARK_THEME = {\n  background: "#151619",\n  textColor: "#b2b5be",\n  gridColor: "#20222c",\n  borderColor: "#2a2b30",',
     '// src/core/theme.ts\n// TradeZoro patch: TradingView-like theme defaults + font stack.\nvar STRYKER_TV_FONT = \'-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif\';\nvar DARK_THEME = {\n  background: "#0f0f0f",\n  textColor: "#b2b5be",\n  gridColor: "#1c1c1c",\n  borderColor: "#2a2a2a",')
edit(C, '  gridColor: "#cccccc",\n  borderColor: "#d4dae3",', '  gridColor: "#f0f3fa",\n  borderColor: "#e0e3eb",')
edit(C, '  downColor: BEARISH,\n  fontFamily: "sans-serif"\n};', '  downColor: BEARISH,\n  fontFamily: STRYKER_TV_FONT\n};', count=2)

# Candles: 1 device-px wick, TradingView body-width curve.
edit(C, '''var CANDLE_BODY_MIN_SPACING = 3;
var CANDLE_WICK_W = 1.5;''', '''// TradeZoro patch: 1 device-px wicks and TradingView body-width curve
// (same formula as lightweight-charts optimalCandlestickWidth). Was: wick 1.5, body 0.7x.
var CANDLE_BODY_MIN_SPACING = 2.5;
var CANDLE_WICK_W = 1;''')
edit(C, '''function wickWidth(spacing) {
  const halfBody = Math.max(0.5, Math.floor(spacing * 0.7) / 2);
  return Math.max(1, Math.min(CANDLE_WICK_W, halfBody));
}''', '''function wickWidth(spacing) {
  return CANDLE_WICK_W;
}
function strykerTvBodyDev(spacing, dpr) {
  if (spacing >= 2.5 && spacing <= 4) return Math.floor(3 * dpr);
  const coeff = 1 - 0.2 * Math.atan(Math.max(4, spacing) - 4) / (Math.PI * 0.5);
  const res = Math.floor(spacing * coeff * dpr);
  return Math.max(Math.floor(dpr), Math.min(res, Math.floor(spacing * dpr)));
}''')
edit(C, '''  const wickDev = Math.max(1, Math.round(wickWidth(spacing) * dpr));
  const wickLeftDev = Math.round(xCss * dpr - wickDev / 2);
  let bodyDev = Math.max(wickDev, Math.round(Math.floor(spacing * 0.7 * bodyScale) * dpr));
  if ((bodyDev - wickDev) % 2 !== 0) bodyDev += 1;''', '''  const wickDev = Math.max(1, Math.floor(dpr));
  const wickLeftDev = Math.round(xCss * dpr) - Math.floor(wickDev / 2);
  let bodyDev = Math.max(wickDev, strykerTvBodyDev(spacing * bodyScale, dpr));
  if ((bodyDev - wickDev) % 2 !== 0) bodyDev -= 1;
  bodyDev = Math.max(wickDev, bodyDev);''')
# Volume columns follow the same body curve.
edit(C, '''function columnHalfWidth(barSpacing) {
  return Math.max(0.5, Math.floor(barSpacing * 0.7) / 2);''', '''function columnHalfWidth(barSpacing) {
  return Math.max(0.5, strykerTvBodyDev(barSpacing, 1) / 2);''')

# Colour bars on previous close (scene.stk.prevClose), WebGL + Canvas2D paths.
edit(C, '    if (scene.basePainting === "none") return;\n', '    if (scene.basePainting === "none") return;\n    this.stkPrev = !!(scene.stk && scene.stk.prevClose);\n', count=2)
edit(C, '      const c = parseColor(barColors.get(bar.time) ?? (bar.close >= bar.open ? up : down));\n      const x = Math.round(coords.logicalToX(i));',
     '      const c = parseColor(barColors.get(bar.time) ?? (stkIsUp(bars, i, this.stkPrev) ? up : down));\n      const x = Math.round(coords.logicalToX(i));')
edit(C, '      const g = candleGeometry(coords.logicalToX(i), spacing, coords.dpr, this.candleBodyScale);\n      const isUp = bar.close >= bar.open;',
     '      const g = candleGeometry(coords.logicalToX(i), spacing, coords.dpr, this.candleBodyScale);\n      const isUp = stkIsUp(bars, i, this.stkPrev);')
edit(C, '      const color = barColors.get(b.time) ?? (b.close >= b.open ? up : down);\n      const hY',
     '      const color = barColors.get(b.time) ?? (stkIsUp(bars, i, this.stkPrev) ? up : down);\n      const hY')
edit(C, '      const x = g.center;\n      const up = b.close >= b.open;', '      const x = g.center;\n      const up = stkIsUp(bars, i, this.stkPrev);')

# 12-hour clock / no weekday (scene.stk.h12 / scene.stk.noDow): 0.9.0 formats through
# scene.format, so the axis and crosshair get a thin wrapper of it.
edit(C, '''function formatTimeStamp(ms, timeZone, barIntervalMs, fmt = ENGLISH_FORMAT, surface = "crosshair") {''', '''// TradeZoro patch (s2 on 0.9.0): "Color bars based on previous close" (TradingView).
function stkIsUp(bars, i, prev) {
  const bar = bars[i];
  if (prev && i > 0 && bars[i - 1]) return bar.close >= bars[i - 1].close;
  return bar.close >= bar.open;
}
// TradeZoro patch (s2 on 0.9.0): optional 12-hour clock and weekday on/off, wrapping the
// chart's formatter (scene.format) for the time axis and the crosshair chips.
function stkH12(t) {
  return t.replace(/\\b(\\d{2}):(\\d{2})\\b/, (m, h, mm) => {
    const H = Number(h);
    return `${H % 12 === 0 ? 12 : H % 12}:${mm} ${H < 12 ? "am" : "pm"}`;
  });
}
function stkFmt(scene) {
  const f = scene.format;
  const s = scene.stk;
  if (!f || !s || !s.h12 && !s.noDow) return f;
  const key = (s.h12 ? 1 : 0) + (s.noDow ? 2 : 0);
  if (scene.__stkFmtSrc === f && scene.__stkFmtKey === key) return scene.__stkFmt;
  const w = Object.create(f);
  w.timeTick = (ms, o) => {
    const t = f.timeTick(ms, o);
    return s.h12 && o && (o.unit === "hour" || o.unit === "minute") ? stkH12(t) : t;
  };
  w.timeStamp = (ms, o) => {
    let t = f.timeStamp(ms, o);
    if (s.noDow) t = t.replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) /, "");
    return s.h12 ? stkH12(t) : t;
  };
  scene.__stkFmtSrc = f;
  scene.__stkFmtKey = key;
  scene.__stkFmt = w;
  return w;
}
function formatTimeStamp(ms, timeZone, barIntervalMs, fmt = ENGLISH_FORMAT, surface = "crosshair") {''')
edit(C, 'timeTicks(tr.from, tr.to, target, offset, scene.format)', 'timeTicks(tr.from, tr.to, target, offset, stkFmt(scene))')
edit(C, 'formatTimeStamp(coords.logicalToTime(logical), scene.timezone, coords.barInterval, scene.format)', 'formatTimeStamp(coords.logicalToTime(logical), scene.timezone, coords.barInterval, stkFmt(scene))')
edit(C, 'formatTimeStamp(ext.time, scene.timezone, coords.barInterval, scene.format)', 'formatTimeStamp(ext.time, scene.timezone, coords.barInterval, stkFmt(scene))')

# Time-zone offset cache (s3): 0.9.0 caches the formatter but still runs formatToParts on
# every call; cache the offset per zone and 15-minute bucket like s3 did.
edit(F, '''var zoneParsers = /* @__PURE__ */ new Map();
function zoneOffsetMs(ms, timeZone) {
  if (!timeZone || timeZone === "UTC") return 0;''', '''var zoneParsers = /* @__PURE__ */ new Map();
// TradeZoro patch (s3 on 0.9.0): offset cached per zone and 15-minute bucket (computed at the
// bucket start; real zone offsets only change on those boundaries).
var stkTzOff = /* @__PURE__ */ new Map();
function zoneOffsetMs(ms, timeZone) {
  if (!timeZone || timeZone === "UTC") return 0;
  const q = Math.floor(ms / 9e5);
  const hk = timeZone + "|" + q;
  const hit = stkTzOff.get(hk);
  if (hit !== void 0) return hit;
  const v = stkZoneOffsetCalc(q * 9e5, timeZone);
  if (stkTzOff.size > 5e4) stkTzOff.clear();
  stkTzOff.set(hk, v);
  return v;
}
function stkZoneOffsetCalc(ms, timeZone) {''')

# rightOffset renderer feature (s3; assets/chart-pine.js asks for it for indicators that
# draw past the last bar). Also lifts the right-space clamp floor to that offset (see #5).
edit(C, '"baselinePrice", "settings", "attribution",', '"baselinePrice", "rightOffset", "settings", "attribution",')
edit(C, '''      // affects the next gesture only — clearHover repaints what it drops
      case "priceAxisTicks":''', '''      // affects the next gesture only — clearHover repaints what it drops
      case "rightOffset": {
        const current = this.coords.getViewport();
        const ro = Number(value);
        this.stkRoFloor = Number.isFinite(ro) ? ro : 0;
        this.coords.setViewport(this.clampViewport(current.barSpacing, Number.isFinite(ro) ? ro : current.rightOffset));
        this.targetBarSpacing = this.coords.getViewport().barSpacing;
        this.scheduler?.invalidate(4 /* Full */);
        return;
      }
      case "priceAxisTicks":''')
edit(C, '''      case "drawingsInteractive":
        return this.drawingsInteractive;''', '''      case "drawingsInteractive":
        return this.drawingsInteractive;
      case "rightOffset":
        return this.coords.getViewport().rightOffset;''')

# ---------------- s1 feel fixes (tv-feel-gap-analysis.md Top 15) ----------------
# #2 wheel zoom: one notch (deltaY 100) = x1.10 like TradingView (was x1.49).
# #7 time-axis drag: 100 px = x1.16 (was x1.49).
edit(C, 'var TIME_SCALE_K = 4e-3;\nvar WHEEL_ZOOM_K = 4e-3;',
     '// TradeZoro patch (s1): TradingView feel. ln(1.16)/100 and ln(1.10)/100.\nvar TIME_SCALE_K = 1.484e-3;\nvar WHEEL_ZOOM_K = 9.53e-4;')
# #6 price-axis drag: 100 px = range x0.85 (was x0.67); wheel on the axis follows (~x0.96).
edit(C, 'var PRICE_SCALE_K = 4e-3;', '// TradeZoro patch (s1): ln(1/0.85)/100, TradingView price-axis drag feel.\nvar PRICE_SCALE_K = 1.625e-3;')
# #15 horizontal wheel moves 80 % of the delta; Shift+wheel pans the TradingView way round.
edit(C, '''function wheelPanDelta(deltaX, deltaY, shift2) {
  if (isHorizontalWheel(deltaX, deltaY)) return deltaX;
  if (shift2) return deltaY;''', '''function wheelPanDelta(deltaX, deltaY, shift2) {
  if (isHorizontalWheel(deltaX, deltaY)) return shift2 ? -deltaX * 0.8 : deltaX * 0.8;
  if (shift2) return -deltaY * 0.8;''')
# #3 zoom steps instantly (no 70 ms ease, which took ~700 ms to settle).
edit(C, 'var ZOOM_EASE_DEFAULT_MS = 70;', '// TradeZoro patch (s1): instant zoom like TradingView (was a 70 ms ease).\nvar ZOOM_EASE_DEFAULT_MS = 0;')
# #11 max zoom-in keeps ~9 bars on screen (was 2).
edit(C, 'var MIN_VISIBLE_BARS = 2;', 'var MIN_VISIBLE_BARS = 9;')
# #9 weak magnet radius 8 -> 20 px (strong already snaps to exact bar time + OHLC).
edit(C, 'var WEAK_SNAP_PX = 8;', 'var WEAK_SNAP_PX = 20;')
# #5 empty space right of the last bar: at most about half the plot (TradingView ~52 %),
# or an indicator's requested right offset when that is larger.
edit(C, '''    const maxRo = visBars - (minVisible - 1);
    const minRo = minVisible - n;''', '''    const maxRo = Math.min(visBars - (minVisible - 1), Math.max(visBars * 0.5, this.stkRoFloor || 0, this.scene?.style?.margins?.right ?? 0));
    const minRo = minVisible - n;''')
# #8 press-drag-release places a two-point drawing (trend line, box, ...); click-click stays.
edit(C, '''      applyToolDefaults(draft, this.deps.toolDefaults());
      this.state = { kind: "placing", draft, need: draft.anchorSchema().max, cursor: null };''', '''      applyToolDefaults(draft, this.deps.toolDefaults());
      this.state = { kind: "placing", draft, need: draft.anchorSchema().max, cursor: null, stkPress: { x, y } };''')
edit(C, '''    if (this.state.kind === "placing") {
      const mode = this.state.draft.placementMode();
      if (mode === "drag") {''', '''    if (this.state.kind === "placing") {
      const mode = this.state.draft.placementMode();
      const press = this.state.stkPress;
      this.state.stkPress = null;
      if (mode === "click" && press && this.state.need === 2 && this.state.draft.anchors.length === 1 && this.state.cursor && Math.hypot(x - press.x, y - press.y) > 6) {
        this.state.draft.anchors.push(this.placementAnchor(this.state.draft, this.state.cursor));
        this.finalize();
        return;
      }
      if (mode === "drag") {''')

print(f'{len(done)} edits OK')
