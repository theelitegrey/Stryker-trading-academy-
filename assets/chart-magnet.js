// TradeZoro — stronger "weak" drawing magnet on the Vela 0.9.0 engine (ES module, charts.html only).
// Owner ask (2026-10-22): a stronger magnet, like TradingView.
//
// Vela's weak magnet snaps only to ONE candle (the bar nearest the cursor's time, rounded) and its
// OHLC value nearest in PRICE, and then only if that point is within WEAK_SNAP_PX (20) of the
// cursor. Between two candles the rounding often picks the far one, so the magnet "misses" a high
// or low that sits right under the cursor. Here the weak mode instead looks at the candles within
// the radius on both sides and snaps to the OHLC point nearest the cursor in PIXELS, with a
// 28 px radius. Strong and off modes, sub-panes and the 0.6.17 engine are unchanged.
// Patched once on the renderer prototype (no vendor-chunk edit: those files are cached a year).
// Depends on: the Vela workspace from assets/vela-chart.js (ws), the per-cell renderer
// (cell.chart.renderer.renderer: .bars, .coords.timeToLogical, .drawingProjector(), .snapToCandle).

export const WEAK_RADIUS_PX = 28;

export function nearestOhlc(bars, i0, i1, xOf, yOf, cursor){
  let best = null, bestD = Infinity;
  for (let i = Math.max(0, i0); i <= Math.min(bars.length - 1, i1); i++) {
    const b = bars[i]; if (!b) continue;
    const x = xOf(b.time); if (!Number.isFinite(x)) continue;
    for (const v of [b.open, b.high, b.low, b.close]) {
      const y = yOf(v); if (!Number.isFinite(y)) continue;
      const d = Math.hypot(x - cursor.x, y - cursor.y);
      if (d < bestD) { bestD = d; best = { time: b.time, price: v }; }
    }
  }
  return best ? { point: best, dist: bestD } : null;
}

export function installMagnet(ws){
  const patch = () => {
    let R = null;
    try { R = ws.cell(ws.active.id).chart.renderer.renderer; } catch (e) { return false; }
    if (!R || typeof R.snapToCandle !== 'function') return false;
    const proto = Object.getPrototypeOf(R);
    if (!proto || proto.__stkMagnet) return true;
    const orig = proto.snapToCandle;
    proto.snapToCandle = function (point, paneId, mode = 'strong', cursorPx) {
      if (mode !== 'weak' || !cursorPx || paneId !== 'price') return orig.call(this, point, paneId, mode, cursorPx);
      try {
        const bars = this.bars, n = bars ? bars.length : 0;
        if (!n) return point;
        const proj = this.drawingProjector();
        const c = this.coords.timeToLogical(point.time);
        // candles whose centre is within the radius (bar spacing from two neighbouring centres)
        const i = Math.max(0, Math.min(n - 1, Math.round(c)));
        const x0 = proj.xOf(bars[i].time), x1 = proj.xOf(bars[Math.min(n - 1, i + 1)].time);
        const sp = Math.max(1, Math.abs(x1 - x0) || 6);
        const k = Math.max(1, Math.ceil(WEAK_RADIUS_PX / sp));
        const hit = nearestOhlc(bars, Math.floor(c) - k, Math.ceil(c) + k, (t) => proj.xOf(t), (v) => proj.yOf(v, paneId), cursorPx);
        return hit && hit.dist <= WEAK_RADIUS_PX ? hit.point : point;
      } catch (e) {
        return orig.call(this, point, paneId, mode, cursorPx);
      }
    };
    proto.__stkMagnet = true;
    return true;
  };
  if (patch()) return;
  let tries = 0;
  const t = setInterval(() => { if (patch() || ++tries > 60) clearInterval(t); }, 500);
}
