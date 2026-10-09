// Stryker Trading Academy — Charts: price-axis "countdown to bar close" fix (ES module)
// Depends on: the Vela workspace from assets/vela-chart.js (ws), its per-cell renderer
// (cell.chart.renderer.renderer: .chrome = Vela's ChromeRenderer, .scene, .coords,
// .countdownTimer / .syncCountdownTimer) and globexOpen() from assets/chart-data-dot.js.
//
// Owner 2026-10-08: "countdown to candle close not showing". Vela draws the countdown under
// the last-price tag as formatCountdown(last.time + interval - Date.now()), clamped at 0. That
// assumes the newest bar on the chart is the bar forming right now. Our CME futures come from
// a delayed feed (/api/chart/bars, ~10 min behind), so on 1m/5m/15m the newest bar is already
// "closed" by the wall clock and the chip sat at 00:00 for good.
//
// Fix (no vendor patch: the chunk files are cached for a year with no ?v=, and a new vendor
// folder would have to move the Pine engine's import paths too): wrap ChromeRenderer's
// drawPriceLineAndCountdown once on its prototype and compute the close of the CURRENT
// wall-clock period instead:
//   intraday   next multiple of the interval after now, counted from the newest bar's open;
//              futures also stop at the 17:00 New York daily break.
//   1D         crypto: next bar boundary (00:00 UTC); futures: next 17:00 New York.
//   1W         crypto: next bar boundary; futures: Friday 17:00 New York.
//   1M         first day of next month (UTC); futures: 17:00 New York on the last weekday.
// Spot forex ("fx:" symbols) runs Sunday 17:00 to Friday 17:00 New York with NO daily break:
// intraday bars are not cut at 17:00, 1D closes at the next 17:00, 1W on Friday 17:00, and the
// countdown hides only over the weekend.
// While CME Globex is closed (weekend, daily 17:00-18:00 New York break) the countdown is not
// drawn at all (the price tag stays). Format (like TradingView): mm:ss under an hour,
// h:mm:ss under a day, "2d 5h" beyond that.
//
// Ticking: Vela already runs ONE 1 s timer per chart that repaints only the chrome layer
// (axes/labels, not candles). This module adds no timer; it pauses those timers while the
// tab is hidden and restarts them when it is visible again. The settings toggle
// ("Countdown to bar close" in the chart settings dialog) still decides: when it is off
// nothing is drawn and Vela's timer is stopped, as before.

import { globexOpen, fxOpen } from './chart-data-dot.js?v=474';

const FUT = /^futures:|^[A-Z0-9]+1!$/i;
const FX = /^fx:/i;
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

let nyFmt = null;
function nyParts(ms) {
  if (!nyFmt) nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
  const o = {};
  nyFmt.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
}
// Epoch ms of New York wall time y-mo-d hh:00 (DST-safe: fix up by the observed offset).
function nyWall(y, mo, d, hh) {
  let t = Date.UTC(y, mo - 1, d, hh) + 5 * HOUR;
  for (let i = 0; i < 2; i++) {
    const p = nyParts(t);
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    t += Date.UTC(y, mo - 1, d, hh) - seen;
  }
  return t;
}
// Next 17:00 New York strictly after `now`.
function next1700(now) {
  const p = nyParts(now);
  let t = nyWall(p.y, p.mo, p.d, 17);
  if (t <= now) { const n = new Date(Date.UTC(p.y, p.mo - 1, p.d) + DAY); t = nyWall(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), 17); }
  return t;
}

/** Close time (epoch ms) of the bar forming at `now`, or null when unknown. */
// futures: true (CME), 'fx' (spot forex: 17:00 New York day, no intraday cut) or false (crypto).
export function barCloseMs(now, lastTime, intervalMs, futures) {
  if (!(intervalMs > 0) || !Number.isFinite(lastTime)) return null;
  if (intervalMs >= 27 * DAY) {                       // monthly
    const p = nyParts(now);
    if (!futures) { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
    // Last weekday of the New York month, 17:00.
    let day = new Date(Date.UTC(p.y, p.mo, 0));
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day = new Date(day.getTime() - DAY);
    return nyWall(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 17);
  }
  if (futures && intervalMs >= 7 * DAY) {             // weekly futures: Friday 17:00 New York
    const p = nyParts(now);
    const fri = new Date(Date.UTC(p.y, p.mo - 1, p.d) + ((5 - p.dow + 7) % 7) * DAY);
    return nyWall(fri.getUTCFullYear(), fri.getUTCMonth() + 1, fri.getUTCDate(), 17);
  }
  if (futures && intervalMs >= DAY) return next1700(now);
  let close = lastTime + intervalMs;
  if (close <= now) close = lastTime + Math.floor((now - lastTime) / intervalMs + 1) * intervalMs;
  if (futures && futures !== 'fx') close = Math.min(close, next1700(now));
  return close;
}

/** TradingView-style text: mm:ss, h:mm:ss, or "2d 5h" when a day or more is left.
 *  Rounded UP, so the last second reads 00:01 and the chip never sits on 00:00. */
export function fmtCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const pad = (v) => String(v).padStart(2, '0');
  if (total >= 86400) { const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600); return h ? `${d}d ${h}h` : `${d}d`; }
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
// Vela's own formatter (copied) — used only to recognise the string it is about to draw.
function velaFmt(ms) {
  const total = Math.max(0, Math.floor(ms / 1e3));
  const s = total % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
  const pad = (v) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** What the chip should show for this scene now: { text } or null (draw no countdown). */
export function countdownFor(now, lastTime, intervalMs, futures) {
  if (futures === 'fx' ? !fxOpen(now) : (futures && !globexOpen(now))) return null;
  const close = barCloseMs(now, lastTime, intervalMs, futures);
  if (close == null || close <= now) return null;
  return { close, left: close - now, text: fmtCountdown(close - now) };
}

function patchChrome(chrome) {
  const proto = Object.getPrototypeOf(chrome);
  if (!proto || proto.__stkCd || typeof proto.drawPriceLineAndCountdown !== 'function') return;
  proto.__stkCd = true;
  const orig = proto.drawPriceLineAndCountdown;
  proto.drawPriceLineAndCountdown = function (ctx, scene, coords, theme, dataW, pricePane) {
    const n = scene && scene.bars ? scene.bars.length : 0;
    if (!scene || !scene.showCountdown || !n || !(coords.barInterval > 0)) return orig.apply(this, arguments);
    const last = scene.bars[n - 1];
    const now = Date.now();
    const cd = countdownFor(now, last.time, coords.barInterval, scene.__stkCdFut || false);
    scene.__stkCdText = cd ? cd.text : '';          // read by tools/tests/chart-countdown-browser.js
    if (!cd) {                                      // market closed / unknown: price tag only
      scene.showCountdown = false;
      try { return orig.apply(this, arguments); } finally { scene.showCountdown = true; }
    }
    // Vela computes last.time + barInterval - Date.now(): shadow both for this one call so it
    // lands on our close, then swap its text for ours where the formats differ (>= 1 day).
    const realNow = Date.now;
    Date.now = () => now;
    Object.defineProperty(coords, 'barInterval', { value: cd.close - last.time, configurable: true });
    const want = velaFmt(cd.left);
    let mt = null, ft = null;
    if (want !== cd.text) {
      mt = ctx.measureText; ft = ctx.fillText;
      ctx.measureText = function (t) { return mt.call(this, t === want ? cd.text : t); };
      ctx.fillText = function (t, ...r) { return ft.call(this, t === want ? cd.text : t, ...r); };
    }
    try { return orig.apply(this, arguments); }
    finally {
      Date.now = realNow;
      delete coords.barInterval;
      if (mt) { delete ctx.measureText; delete ctx.fillText; }
    }
  };
}

const inner = (cell) => { try { return cell.chart.renderer.renderer; } catch (e) { return null; } };

export function installCountdown(ws) {
  const sweep = () => {
    let cells = [];
    try { cells = ws.context().cells || []; } catch (e) { return; }
    cells.forEach((c) => {
      let cell = null;
      try { cell = ws.cell(c.id); } catch (e) {}
      const R = cell && inner(cell);
      if (!R || !R.scene) return;
      if (R.chrome) patchChrome(R.chrome);
      const sym = String(c.symbol || '');
      R.scene.__stkCdFut = FX.test(sym) ? 'fx' : FUT.test(sym);
    });
  };
  sweep();
  try { ws.on('layout:changed', () => setTimeout(sweep, 0)); } catch (e) {}
  try { ws.on('state:changed', () => setTimeout(sweep, 0)); } catch (e) {}
  // Pause Vela's 1 s chrome repaint while the tab is hidden; restart it when visible.
  document.addEventListener('visibilitychange', () => {
    let cells = [];
    try { cells = ws.context().cells || []; } catch (e) { return; }
    cells.forEach((c) => {
      let R = null;
      try { R = inner(ws.cell(c.id)); } catch (e) {}
      if (!R) return;
      if (document.hidden) {
        if (R.countdownTimer != null) { clearInterval(R.countdownTimer); R.countdownTimer = null; }
      } else {
        try { R.syncCountdownTimer(); R.scheduler && R.scheduler.invalidate(2); } catch (e) {}
      }
    });
  });
  window.__stkCountdown = { sweep, barCloseMs, fmtCountdown, countdownFor };
}
