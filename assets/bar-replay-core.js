/**
 * TradeZoro — Charts BAR REPLAY core (pure logic, no DOM, no network)
 *
 * Owner order 2026-10-12: "Add a full bar replay feature like tradingview", inside Charts.
 * The chart module (assets/chart-bar-replay.js) keeps the bars it fetched in memory (so
 * stepping is instant) and asks this file what may be SHOWN at the replay clock.
 *
 * THE CLOCK is one number, E (ms): the end of revealed time. A bar covers [time, end) where
 * end = time + interval for intraday bars, and the NEXT bar's open for daily and longer bars
 * (months and sessions differ in length, so a fixed span could reveal a bar a day early).
 * At clock E a chart bar is:
 *   - complete   when end <= E (served exactly as the provider delivered it);
 *   - forming    when time < E < end: rebuilt ONLY from the "update interval" bars (step bars)
 *                that are complete at E: open = first step's open, high/low = extremes, close =
 *                last close, volume summed. No complete step inside it yet = not shown;
 *   - hidden     when time >= E.
 * One step forward moves E to the END of the first step bar that is not complete yet, so gaps
 * (nights, weekends) are skipped. Indicators, Pine scripts, request.security() and paper fills
 * only ever see what is revealed at E: no lookahead.
 *
 * Runs in Node for tests (module.exports, tools/tests/bar-replay-core.test.js) and in the
 * browser (window.BarReplayCore). Bar shape: Vela's { time, open, high, low, close, volume }.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BarReplayCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MIN = 60000, DAY = 86400000;

  // Interval id -> ms. Same ids as Charts (assets/chart-intervals.js parseIv): '15' minutes,
  // 'D' 'W' 'M', '2D', '3M'. Seconds and tick bars return null (replay needs time bars).
  function tfMs(tf) {
    tf = String(tf == null ? '' : tf).trim();
    let m;
    if (/^\d+$/.test(tf)) return +tf * MIN;
    if (tf === 'D' || tf === '1D') return DAY;
    if (tf === 'W' || tf === '1W') return 7 * DAY;
    if (tf === 'M' || tf === '1M') return 30 * DAY;
    if ((m = /^(\d+)D$/.exec(tf))) return +m[1] * DAY;
    if ((m = /^(\d+)W$/.exec(tf))) return +m[1] * 7 * DAY;
    if ((m = /^(\d+)M$/.exec(tf))) return +m[1] * 30 * DAY;
    return null;
  }

  // First index whose time >= t (bars ascending by time). bars.length when none.
  function firstAtOrAfter(bars, t) {
    let lo = 0, hi = bars.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].time < t) lo = mid + 1; else hi = mid; }
    return lo;
  }
  // End of bar i (see header).
  function endAt(bars, i, ms) {
    return ms >= DAY && i + 1 < bars.length ? bars[i + 1].time : bars[i].time + ms;
  }
  const copy = (b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 });

  // The forming chart bar bars[i] rebuilt from the complete step bars inside it (null = none).
  function formingAt(bars, i, ms, steps, stepMs, E) {
    if (!steps || !steps.length) return null;
    const bar = bars[i], end = Math.min(endAt(bars, i, ms), E);
    let k = firstAtOrAfter(steps, bar.time), out = null;
    for (; k < steps.length; k++) {
      const s = steps[k];
      if (s.time >= end || endAt(steps, k, stepMs) > E) break;
      if (!out) { out = copy(s); out.time = bar.time; }
      else {
        if (s.high > out.high) out.high = s.high;
        if (s.low < out.low) out.low = s.low;
        out.close = s.close; out.volume += s.volume || 0;
      }
    }
    return out;
  }

  /**
   * What the chart may show at clock E: a NEW array of bars (copies, never the buffer's objects),
   * every bar opened before E, the last one rebuilt if it is still forming.
   * opts: { from, to, limit } as in a provider getBars range (from / to inclusive).
   */
  function reveal(bars, ms, steps, stepMs, E, opts) {
    opts = opts || {};
    let end = firstAtOrAfter(bars, E);
    if (opts.to != null) end = Math.min(end, firstAtOrAfter(bars, opts.to + 1));
    let start = opts.from != null ? firstAtOrAfter(bars, opts.from) : 0;
    if (opts.limit != null && opts.from == null) start = Math.max(start, end - opts.limit - 1);
    const out = [];
    for (let i = start; i < end; i++) {
      if (endAt(bars, i, ms) <= E) out.push(copy(bars[i]));
      else { const f = formingAt(bars, i, ms, steps, stepMs, E); if (f) out.push(f); }
    }
    return opts.limit != null && out.length > opts.limit ? out.slice(out.length - opts.limit) : out;
  }

  // Index of the last bar shown at E (complete or forming), -1 = none.
  function lastShown(bars, ms, steps, stepMs, E) {
    let i = firstAtOrAfter(bars, E) - 1;
    while (i >= 0 && !(endAt(bars, i, ms) <= E || formingAt(bars, i, ms, steps, stepMs, E))) i--;
    return i;
  }

  // The clock after one step forward: the end of the first step bar that is not complete at E.
  // null = no more step bars in this buffer.
  function nextE(steps, stepMs, E) {
    let k = Math.max(0, firstAtOrAfter(steps, E) - 2);
    for (; k < steps.length; k++) { const e = endAt(steps, k, stepMs); if (e > E) return e; }
    return null;
  }
  // Number of step bars that start at or after E (how much is buffered ahead of the clock).
  function aheadCount(steps, E) { return steps.length - firstAtOrAfter(steps, E); }
  // Number of bars that opened before E.
  function beforeCount(bars, E) { return firstAtOrAfter(bars, E); }

  // Merge `add` into the ascending `bars` (by time, `add` wins). Returns a new array.
  function merge(bars, add) {
    if (!add || !add.length) return bars;
    if (!bars.length) return add.slice().sort((a, b) => a.time - b.time);
    if (add[0].time > bars[bars.length - 1].time) return bars.concat(add);
    if (add[add.length - 1].time < bars[0].time) return add.concat(bars);
    const m = new Map();
    for (const b of bars) m.set(b.time, b);
    for (const b of add) m.set(b.time, b);
    return [...m.values()].sort((a, b) => a.time - b.time);
  }

  // Price segments a paper account must see when the clock moves E0 -> E1: every step bar that
  // became complete, in order (assets/chart-paper.js replayFeed -> PaperEngine.onSegment).
  function segments(steps, stepMs, E0, E1) {
    const out = [];
    for (let k = Math.max(0, firstAtOrAfter(steps, E0) - 2); k < steps.length; k++) {
      const s = steps[k], e = endAt(steps, k, stepMs);
      if (e <= E0) continue;
      if (e > E1) break;
      out.push({ t: s.time, o: s.open, h: s.high, l: s.low, c: s.close });
    }
    return out;
  }

  // "5m", "1h", "1D" for labels.
  function tfLabel(tf) {
    tf = String(tf || '');
    if (/^\d+$/.test(tf)) { const n = +tf; return n >= 60 && n % 60 === 0 ? (n / 60) + 'h' : n + 'm'; }
    return tf === 'D' ? '1D' : tf === 'W' ? '1W' : tf === 'M' ? '1M' : tf;
  }

  return { MIN, DAY, tfMs, firstAtOrAfter, endAt, formingAt, reveal, lastShown, nextE, aheadCount, beforeCount, merge, segments, tfLabel };
});
