/**
 * Stryker Trading Academy — market analysis engine
 *
 * Pure functions: candles in, readings out. No network, no firebase, no
 * globals — so this file can be unit-tested on its own and reused by anything
 * that has OHLC data (the bots today, a backtest tomorrow).
 *
 * WHY DETERMINISTIC ANALYSIS AND NOT A LANGUAGE MODEL. The bots publish price
 * levels students may act on. A model that writes fluent prose around numbers
 * it half-remembers is the wrong tool for that: every level here is computed
 * from the candles and can be checked against the chart. The write-up is
 * templated around those numbers, in the same spirit as the journal's AI
 * coach (assets/journal-ai.js), which analyses trades arithmetically and
 * explains the result in plain English.
 *
 * The setups it looks for are the ones the curriculum teaches:
 *   - ICT 2022:  liquidity sweep -> market structure shift -> FVG entry
 *   - Judas:     session-open sweep that reverses through the open
 *   - Sweep:     prior-day high/low taken and rejected back inside the range
 *
 * A candle is { t: msTimestamp, o, h, l, c }.
 */

// ---------------------------------------------------------------------------
// Candle maths
// ---------------------------------------------------------------------------

function trueRange(prev, c) {
  if (!prev) return c.h - c.l;
  return Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
}

function atr(candles, period) {
  const n = period || 14;
  if (!candles || candles.length < 2) return 0;
  const slice = candles.slice(-(n + 1));
  let sum = 0, count = 0;
  for (let i = 1; i < slice.length; i++) { sum += trueRange(slice[i - 1], slice[i]); count++; }
  return count ? sum / count : 0;
}

function ema(values, period) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/**
 * Pivot swings: a high is a swing when it is the highest of the k bars either
 * side of it. k bars to the RIGHT means the most recent k bars can never
 * produce a swing — that is the point. A "swing" confirmed by the bar that
 * just printed is not a swing, it is a guess, and building an entry on it is
 * how a scanner ends up drawing structure that disappears next candle.
 */
function swings(candles, k) {
  const kk = k || 3;
  const highs = [], lows = [];
  for (let i = kk; i < candles.length - kk; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - kk; j <= i + kk; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
    }
    if (isHigh) highs.push({ i, price: candles[i].h, t: candles[i].t });
    if (isLow) lows.push({ i, price: candles[i].l, t: candles[i].t });
  }
  return { highs, lows };
}

function lastBefore(list, i) {
  let out = null;
  for (const s of list) { if (s.i < i) out = s; else break; }
  return out;
}

/**
 * Fair value gaps in [from, to]: a three-candle imbalance where the wicks of
 * the outer candles do not overlap. Returned newest first, because an entry
 * belongs at the most recent unmitigated gap, not the oldest one in the leg.
 */
function findFVGs(candles, from, to, dir) {
  const out = [];
  const lo = Math.max(1, from), hi = Math.min(candles.length - 2, to);
  for (let i = lo; i <= hi; i++) {
    const a = candles[i - 1], c = candles[i + 1];
    if (dir === 'long' && c.l > a.h) out.push({ i, top: c.l, bottom: a.h, mid: (c.l + a.h) / 2 });
    if (dir === 'short' && c.h < a.l) out.push({ i, top: a.l, bottom: c.h, mid: (a.l + c.h) / 2 });
  }
  return out.reverse();
}

// ---------------------------------------------------------------------------
// Sessions (UTC). Rough but conventional windows — the killzones the
// curriculum works in, not exchange hours.
// ---------------------------------------------------------------------------

const SESSIONS = {
  asia:   { label: 'Asia',    startH: 0,  endH: 6 },
  london: { label: 'London',  startH: 7,  endH: 12 },
  ny:     { label: 'New York', startH: 13, endH: 20 }
};

function utcHour(ms) { return new Date(ms).getUTCHours(); }
function utcDayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }

function sessionOf(ms) {
  const h = utcHour(ms);
  for (const key of Object.keys(SESSIONS)) {
    const s = SESSIONS[key];
    if (h >= s.startH && h < s.endH) return key;
  }
  return null;
}

function candlesInSession(candles, dayKey, sessionKey) {
  return candles.filter((c) => utcDayKey(c.t) === dayKey && sessionOf(c.t) === sessionKey);
}

function rangeOf(candles) {
  if (!candles || !candles.length) return null;
  let hi = -Infinity, lo = Infinity;
  for (const c of candles) { if (c.h > hi) hi = c.h; if (c.l < lo) lo = c.l; }
  return { high: hi, low: lo, mid: (hi + lo) / 2, size: hi - lo };
}

function dayGroups(candles) {
  const map = new Map();
  for (const c of candles) {
    const k = utcDayKey(c.t);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Setup detection
// ---------------------------------------------------------------------------

function round(v, digits) {
  const d = digits == null ? 2 : digits;
  return +(+v).toFixed(d);
}

/** Sensible decimals for the instrument's own scale. */
function digitsFor(price) {
  if (price >= 1000) return 2;
  if (price >= 100) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  return 5;
}

function buildSetup(o) {
  const risk = Math.abs(o.entry - o.stop);
  const reward = Math.abs(o.target - o.entry);
  if (!(risk > 0)) return null;
  const rr = reward / risk;
  const d = digitsFor(o.entry);
  return {
    symbol: o.symbol, label: o.label, model: o.model, modelName: o.modelName,
    direction: o.direction,
    entry: round(o.entry, d), zoneTop: round(o.zoneTop, d), zoneBottom: round(o.zoneBottom, d),
    stop: round(o.stop, d), target: round(o.target, d),
    rr: round(rr, 2),
    sweptLevel: o.sweptLevel || null,
    displacementAtr: round(o.displacementAtr || 0, 2),
    htfAligned: !!o.htfAligned,
    at: o.at,
    key: o.key,
    reasons: o.reasons || []
  };
}

/**
 * Grade is a score, not a verdict. Four things separate a setup worth showing
 * a student from one worth trading: reward against risk, how hard price moved
 * on the shift, whether the liquidity taken was a level anyone was watching,
 * and whether the trade runs with the higher-timeframe read rather than
 * against it.
 */
function gradeSetup(s) {
  let score = 0;
  if (s.rr >= 3) score += 2; else if (s.rr >= 2) score += 1;
  if (s.displacementAtr >= 2) score += 1; else if (s.displacementAtr >= 1.4) score += 0.5;
  if (s.sweptLevel) score += 1;
  if (s.htfAligned) score += 1;
  return score >= 4 ? 'A' : (score >= 2 ? 'B' : 'C');
}

const GRADE_RANK = { A: 3, B: 2, C: 1 };

/**
 * ICT 2022: liquidity taken, structure shifted with displacement, entry in the
 * fair value gap the shift left behind.
 */
function detectSweepMSS(candles, ctx) {
  const cfg = Object.assign({ swingK: 3, minDisplacementAtr: 1.3, maxBarsToShift: 10,
                              scanBars: 45, minRR: 1.5 }, ctx || {});
  if (candles.length < 40) return null;

  const a = atr(candles, 14);
  if (!(a > 0)) return null;
  const sw = swings(candles, cfg.swingK);
  const last = candles.length - 1;
  const from = Math.max(cfg.swingK + 1, last - cfg.scanBars);

  // Newest first: the freshest valid sweep is the one still tradeable.
  for (let i = last - 1; i >= from; i--) {
    const c = candles[i];

    for (const dir of ['long', 'short']) {
      const ref = dir === 'long' ? lastBefore(sw.lows, i) : lastBefore(sw.highs, i);
      if (!ref) continue;

      const swept = dir === 'long' ? (c.l < ref.price && c.c > ref.price)
                                   : (c.h > ref.price && c.c < ref.price);
      if (!swept) continue;

      // The shift: a close through the opposing structure, carried by a
      // candle that actually moved. A close a tick beyond on a doji is not a
      // shift, it is noise wearing the same shape.
      const opposing = dir === 'long' ? lastBefore(sw.highs, i) : lastBefore(sw.lows, i);
      if (!opposing) continue;

      let shiftIdx = -1, displacement = 0;
      for (let j = i + 1; j <= Math.min(last, i + cfg.maxBarsToShift); j++) {
        const broke = dir === 'long' ? candles[j].c > opposing.price : candles[j].c < opposing.price;
        if (!broke) continue;
        const legStart = Math.min(i, j - 1);
        const legHigh = Math.max(...candles.slice(legStart, j + 1).map((x) => x.h));
        const legLow = Math.min(...candles.slice(legStart, j + 1).map((x) => x.l));
        displacement = (legHigh - legLow) / a;
        if (displacement >= cfg.minDisplacementAtr) { shiftIdx = j; break; }
      }
      if (shiftIdx < 0) continue;

      const gaps = findFVGs(candles, i, shiftIdx, dir);
      if (!gaps.length) continue;
      const gap = gaps[0];

      // Still valid only while price has not already run the gap through: an
      // entry zone price has closed past is a chart annotation, not a trade.
      if (dir === 'long' && candles[last].c < gap.bottom) continue;
      if (dir === 'short' && candles[last].c > gap.top) continue;

      const stop = dir === 'long'
        ? Math.min(c.l, gap.bottom - a * 0.15)
        : Math.max(c.h, gap.top + a * 0.15);

      // Target the opposing liquidity the move is reaching for. It has to sit
      // beyond BOTH the current price and the level the shift just broke —
      // the nearest swing above the entry is often inside the range price has
      // already delivered through, which would hand out a target that was hit
      // before the setup existed. When nothing qualifies, fall back to a fixed
      // 2.5R rather than inventing a level.
      const now0 = candles[last].c;
      const beyond = dir === 'long'
        ? Math.max(now0, opposing.price)
        : Math.min(now0, opposing.price);
      const entry = gap.mid;
      const risk = Math.abs(entry - stop);

      // …and it has to be at least 1R away. Minor pivots sit a few ticks above
      // price all the time; taking the nearest one as the objective produces a
      // "target" inside the trade's own risk, which is not a trade at all. So
      // walk outward and take the first pool worth reaching for.
      const pools = dir === 'long'
        ? sw.highs.filter((h) => h.price > beyond).sort((x, y) => x.price - y.price)
        : sw.lows.filter((l) => l.price < beyond).sort((x, y) => y.price - x.price);
      const liq = pools.find((p) => Math.abs(p.price - entry) >= risk);
      const target = liq ? liq.price : (dir === 'long' ? entry + risk * 2.5 : entry - risk * 2.5);

      const closes = candles.map((x) => x.c);
      const e20 = ema(closes.slice(-60), 20), e50 = ema(closes.slice(-60), 50);
      const htfAligned = e20 != null && e50 != null &&
        (dir === 'long' ? e20 > e50 : e20 < e50);

      const setup = buildSetup({
        symbol: cfg.symbol, label: cfg.label,
        model: 'ict2022', modelName: 'Sweep → MSS → FVG (ICT 2022)',
        direction: dir, entry, zoneTop: gap.top, zoneBottom: gap.bottom,
        stop, target,
        sweptLevel: cfg.levelNameFor ? cfg.levelNameFor(ref.price, dir) : null,
        displacementAtr: displacement, htfAligned,
        at: candles[shiftIdx].t,
        key: 'ict2022:' + candles[i].t,
        reasons: [
          (dir === 'long' ? 'Sellside' : 'Buyside') + ' liquidity taken at ' +
            round(ref.price, digitsFor(ref.price)) + ' and reclaimed on the same candle',
          'Structure shifted through ' + round(opposing.price, digitsFor(opposing.price)) +
            ' with ' + round(displacement, 1) + '× ATR of displacement',
          'Entry is the fair value gap the shift left behind'
        ]
      });
      if (setup && setup.rr >= cfg.minRR) return setup;
    }
  }
  return null;
}

/**
 * Judas swing: the first move after a session open is the false one. Sweep of
 * the opening range, reclaimed, then delivery through the other side.
 */
function detectJudas(candles, ctx) {
  const cfg = Object.assign({ session: 'london', openBars: 4, windowBars: 20, minRR: 1.5 }, ctx || {});
  if (candles.length < 30) return null;

  const last = candles.length - 1;
  const dayKey = utcDayKey(candles[last].t);
  const inSession = candlesInSession(candles, dayKey, cfg.session);
  if (inSession.length < cfg.openBars + 3) return null;

  const openBars = inSession.slice(0, cfg.openBars);
  const openRange = rangeOf(openBars);
  if (!openRange || !(openRange.size > 0)) return null;

  const a = atr(candles, 14);
  if (!(a > 0)) return null;

  const after = inSession.slice(cfg.openBars, cfg.openBars + cfg.windowBars);
  if (!after.length) return null;

  // Which side got taken first — that is the Judas leg.
  let sweepIdx = -1, dir = null;
  for (let i = 0; i < after.length; i++) {
    if (after[i].h > openRange.high && after[i].c < openRange.high) { sweepIdx = i; dir = 'short'; break; }
    if (after[i].l < openRange.low && after[i].c > openRange.low) { sweepIdx = i; dir = 'long'; break; }
  }
  if (sweepIdx < 0) return null;

  // Confirmation: price has to deliver back through the opposite side of the
  // opening range. A sweep that just sits there is not a Judas swing yet.
  const rest = after.slice(sweepIdx + 1);
  const confirmed = rest.some((c) => dir === 'long' ? c.c > openRange.high : c.c < openRange.low);
  if (!confirmed) return null;

  const globalIdx = candles.findIndex((c) => c.t === after[sweepIdx].t);
  const gaps = findFVGs(candles, globalIdx, Math.min(candles.length - 2, globalIdx + rest.length), dir);
  const gap = gaps[0] || {
    top: dir === 'long' ? openRange.mid + a * 0.1 : openRange.mid + a * 0.1,
    bottom: dir === 'long' ? openRange.mid - a * 0.1 : openRange.mid - a * 0.1,
    mid: openRange.mid
  };

  const sweepCandle = after[sweepIdx];
  const stop = dir === 'long' ? Math.min(sweepCandle.l, gap.bottom) - a * 0.1
                              : Math.max(sweepCandle.h, gap.top) + a * 0.1;
  const entry = gap.mid;
  const risk = Math.abs(entry - stop);
  const target = dir === 'long' ? entry + risk * 2.5 : entry - risk * 2.5;
  const displacement = rangeOf(rest.length ? rest : after).size / a;

  const closes = candles.map((x) => x.c);
  const e20 = ema(closes.slice(-60), 20), e50 = ema(closes.slice(-60), 50);

  const setup = buildSetup({
    symbol: cfg.symbol, label: cfg.label,
    model: 'judas', modelName: 'Judas swing (' + (SESSIONS[cfg.session] || {}).label + ' open)',
    direction: dir, entry, zoneTop: gap.top, zoneBottom: gap.bottom, stop, target,
    sweptLevel: (SESSIONS[cfg.session] || {}).label + ' opening range ' + (dir === 'long' ? 'low' : 'high'),
    displacementAtr: displacement,
    htfAligned: e20 != null && e50 != null && (dir === 'long' ? e20 > e50 : e20 < e50),
    at: sweepCandle.t,
    key: 'judas:' + dayKey + ':' + cfg.session,
    reasons: [
      'Opening range ' + round(openRange.low, digitsFor(openRange.low)) + ' – ' +
        round(openRange.high, digitsFor(openRange.high)) + ' set in the first ' + cfg.openBars + ' candles',
      'The ' + (dir === 'long' ? 'low' : 'high') + ' was swept and immediately reclaimed — the false move',
      'Price then delivered back through the opposite side of the range'
    ]
  });
  return setup && setup.rr >= cfg.minRR ? setup : null;
}

/**
 * Prior-day liquidity: yesterday's high or low taken and rejected. The
 * simplest of the three and the one that needs the least confirmation, so it
 * is graded hardest by the RR requirement.
 */
function detectPriorDaySweep(candles, ctx) {
  const cfg = Object.assign({ minRR: 2, maxBarsSince: 6 }, ctx || {});
  if (candles.length < 40) return null;

  const days = [...dayGroups(candles).entries()];
  if (days.length < 2) return null;
  const today = days[days.length - 1];
  const prior = days[days.length - 2];
  const pd = rangeOf(prior[1]);
  const a = atr(candles, 14);
  if (!pd || !(a > 0)) return null;

  const todays = today[1];
  const last = candles.length - 1;

  for (let i = todays.length - 1; i >= Math.max(0, todays.length - cfg.maxBarsSince); i--) {
    const c = todays[i];
    let dir = null, level = null, levelName = null;
    if (c.h > pd.high && c.c < pd.high) { dir = 'short'; level = pd.high; levelName = 'Prior day high'; }
    if (c.l < pd.low && c.c > pd.low)   { dir = 'long';  level = pd.low;  levelName = 'Prior day low'; }
    if (!dir) continue;

    const entry = dir === 'long' ? Math.min(c.c, level + a * 0.2) : Math.max(c.c, level - a * 0.2);
    const stop = dir === 'long' ? c.l - a * 0.15 : c.h + a * 0.15;
    const target = dir === 'long' ? pd.mid + (pd.high - pd.mid) * 0.8 : pd.mid - (pd.mid - pd.low) * 0.8;

    const closes = candles.map((x) => x.c);
    const e20 = ema(closes.slice(-60), 20), e50 = ema(closes.slice(-60), 50);

    const setup = buildSetup({
      symbol: cfg.symbol, label: cfg.label,
      model: 'pdsweep', modelName: 'Prior-day liquidity sweep',
      direction: dir, entry, zoneTop: entry + a * 0.15, zoneBottom: entry - a * 0.15,
      stop, target,
      sweptLevel: levelName + ' at ' + round(level, digitsFor(level)),
      displacementAtr: (c.h - c.l) / a,
      htfAligned: e20 != null && e50 != null && (dir === 'long' ? e20 > e50 : e20 < e50),
      at: c.t,
      key: 'pdsweep:' + utcDayKey(c.t) + ':' + dir,
      reasons: [
        levelName + ' at ' + round(level, digitsFor(level)) + ' was taken and rejected on the same candle',
        'Rejection candle spanned ' + round((c.h - c.l) / a, 1) + '× ATR',
        'Target is the middle of yesterday’s range — where the liquidity was drawn from'
      ]
    });
    if (setup && setup.rr >= cfg.minRR) return setup;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Instrument briefing (the analyst bot)
// ---------------------------------------------------------------------------

function briefInstrument(candles, daily, meta) {
  if (!candles || candles.length < 20) return null;
  const last = candles[candles.length - 1];
  const d = digitsFor(last.c);

  const days = [...dayGroups(candles).entries()];
  const today = days[days.length - 1];
  const prior = days.length > 1 ? days[days.length - 2] : null;
  const todayRange = rangeOf(today[1]);
  const pd = prior ? rangeOf(prior[1]) : null;

  const dayAtr = daily && daily.length > 15 ? atr(daily, 14) : null;
  const expansion = dayAtr && todayRange ? todayRange.size / dayAtr : null;

  const prevClose = prior ? prior[1][prior[1].length - 1].c : (daily && daily.length > 1 ? daily[daily.length - 2].c : null);
  const chgPct = prevClose ? ((last.c / prevClose) - 1) * 100 : null;

  // Which session did the work — the day's extremes usually belong to one.
  let highSession = null, lowSession = null;
  if (todayRange) {
    for (const c of today[1]) {
      if (c.h === todayRange.high) highSession = sessionOf(c.t);
      if (c.l === todayRange.low) lowSession = sessionOf(c.t);
    }
  }

  const sweeps = [];
  if (pd) {
    if (todayRange.high > pd.high) sweeps.push('took prior day high (' + round(pd.high, d) + ')');
    if (todayRange.low < pd.low) sweeps.push('took prior day low (' + round(pd.low, d) + ')');
  }

  const closes = candles.map((c) => c.c);
  const e20 = ema(closes.slice(-80), 20), e50 = ema(closes.slice(-80), 50);
  const bias = (e20 != null && e50 != null)
    ? (e20 > e50 ? 'bullish' : 'bearish')
    : 'neutral';

  return {
    symbol: meta.symbol, label: meta.label,
    price: round(last.c, d), chgPct: chgPct == null ? null : round(chgPct, 2),
    dayHigh: todayRange ? round(todayRange.high, d) : null,
    dayLow: todayRange ? round(todayRange.low, d) : null,
    pdh: pd ? round(pd.high, d) : null,
    pdl: pd ? round(pd.low, d) : null,
    expansion: expansion == null ? null : round(expansion, 2),
    volatility: expansion == null ? 'unknown'
      : (expansion > 1.25 ? 'expanded' : (expansion < 0.6 ? 'compressed' : 'average')),
    highSession, lowSession, sweeps, bias
  };
}

module.exports = {
  trueRange, atr, ema, swings, findFVGs, sessionOf, SESSIONS,
  candlesInSession, rangeOf, dayGroups, utcDayKey, digitsFor, round,
  buildSetup, gradeSetup, GRADE_RANK,
  detectSweepMSS, detectJudas, detectPriorDaySweep,
  briefInstrument
};
