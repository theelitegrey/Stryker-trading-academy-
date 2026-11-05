// TradeZoro — Camarilla Pivots maths (pure, no DOM; unit-tested in tools/tests/chart-camarilla.test.mjs).
// Levels come from the PRIOR session's High, Low, Close (Range = High - Low):
//   R5 = High / Low * Close      R4..R1 = Close + Range * 1.1 / (2, 4, 6, 12)      S1..S4 = Close - Range * 1.1 / (12, 6, 4, 2)
//   S5 = Close - (R5 - Close)    RB3 / SB3 = midpoint of R3-R4 / S3-S4             Pivot (Y-Close) = prior close; Y-High / Y-Low.
// "Session": futures use the CME day (18:00 -> 17:00 New York, the same rule as the volume tools in chart-orderflow.js);
// stocks, crypto and forex use the UTC day. Weekly / Monthly group those sessions (a session belongs to the week / month of the
// day it ends on). Education only. Not financial advice.

const NY_TZ = 'America/New_York';
const ETH_OPEN = 18 * 60;   // 18:00 New York: the CME session opens
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: NY_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const nyOff = new Map();
function nyOffsetMin(ms) {
  const h = Math.floor(ms / 3600000);
  let o = nyOff.get(h);
  if (o === undefined) {
    const p = {};
    nyFmt.formatToParts(new Date(h * 3600000)).forEach((x) => { p[x.type] = x.value; });
    o = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - h * 3600000) / 60000);
    if (nyOff.size > 5000) nyOff.clear();
    nyOff.set(h, o);
  }
  return o;
}
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// The trading day a bar belongs to, as 'YYYY-MM-DD'. Futures: bars from 18:00 NY belong to the NEXT calendar day.
export function sessionDay(ms, futures) {
  if (!futures) return new Date(ms).toISOString().slice(0, 10);
  const d = new Date(ms + nyOffsetMin(ms) * 60000);
  const day = d.toISOString().slice(0, 10);
  return d.getUTCHours() * 60 + d.getUTCMinutes() >= ETH_OPEN ? addDays(day, 1) : day;
}

// Period key of a bar: 'D' = the session day, 'W' = the Monday of its week, 'M' = 'YYYY-MM'.
export function periodKey(ms, period, futures) {
  const day = sessionDay(ms, futures);
  if (period === 'M') return day.slice(0, 7);
  if (period === 'W') { const dw = new Date(day + 'T00:00:00Z').getUTCDay(); return addDays(day, -((dw + 6) % 7)); }
  return day;
}

export function camarilla(high, low, close) {
  if (![high, low, close].every(Number.isFinite) || !(low > 0) || high < low) return null;
  const r = (high - low) * 1.1, R5 = high / low * close;
  const R4 = close + r / 2, R3 = close + r / 4, R2 = close + r / 6, R1 = close + r / 12;
  const S1 = close - r / 12, S2 = close - r / 6, S3 = close - r / 4, S4 = close - r / 2;
  return { R5, R4, RB3: (R3 + R4) / 2, R3, R2, R1, YH: high, YC: close, YL: low, S1, S2, S3, SB3: (S3 + S4) / 2, S4, S5: close - (R5 - close) };
}

// Chart bars (time in ms, ascending) -> one group per period with its high / low / close and time span.
// The first group is dropped as a source when the chart's history starts inside it (its high / low would be partial).
export function groupBars(bars, period, futures, tfMs) {
  const out = [];
  for (const b of bars) {
    const k = periodKey(b.time, period, futures), g = out[out.length - 1];
    if (g && g.key === k) { if (b.high > g.high) g.high = b.high; if (b.low < g.low) g.low = b.low; g.close = b.close; g.end = b.time + tfMs; }
    else out.push({ key: k, start: b.time, end: b.time + tfMs, high: b.high, low: b.low, close: b.close, partial: false });
  }
  if (out.length) {
    const first = out[0], t0 = first.start;
    // complete when the first bar sits at the very start of the period (within one bar)
    const prevEdge = bars.length ? periodKey(t0 - tfMs, period, futures) !== first.key : true;
    first.partial = !prevEdge;
  }
  return out;
}

// Level sets to draw: one per group that has a complete previous group. Newest last. `days` = how many sets at most.
export function levelSets(bars, period, futures, tfMs, days) {
  const gs = groupBars(bars, period, futures, tfMs), sets = [];
  for (let i = 1; i < gs.length; i++) {
    if (gs[i - 1].partial) continue;
    const L = camarilla(gs[i - 1].high, gs[i - 1].low, gs[i - 1].close);
    if (L) sets.push({ key: gs[i].key, start: gs[i].start, end: gs[i].end, levels: L, last: i === gs.length - 1 });
  }
  return sets.slice(-Math.max(1, days | 0));
}

export const LEVEL_ORDER = ['R5', 'R4', 'RB3', 'R3', 'R2', 'R1', 'YH', 'YC', 'YL', 'S1', 'S2', 'S3', 'SB3', 'S4', 'S5'];
export const LEVEL_LABEL = { R5: 'R5', R4: 'R4', RB3: 'RB3', R3: 'R3', R2: 'R2', R1: 'R1', YH: 'Y-High', YC: 'Y-Close', YL: 'Y-Low', S1: 'S1', S2: 'S2', S3: 'S3', SB3: 'SB3', S4: 'S4', S5: 'S5' };
// Which input group switches each level on.
export const LEVEL_GROUP = { R5: 'g5', S5: 'g5', R4: 'g4', S4: 'g4', RB3: 'g3', SB3: 'g3', R3: 'g3', S3: 'g3', R2: 'g2', S2: 'g2', R1: 'g1', S1: 'g1', YH: 'yh', YL: 'yl', YC: 'yc' };

// Round a price to the symbol's tick (mintick = minmove / pricescale). Exact ties go down (the reference shows RB3 15309.625 as 15309.50). No tick known -> unchanged.
export function roundTick(p, tick) { return tick > 0 && Number.isFinite(p) ? Math.ceil(p / tick - 0.5 - 1e-9) * tick : p; }
// Decimals a tick needs (0.25 -> 2, 1 -> 0, 0.00001 -> 5).
export function tickDecimals(tick) { let d = 0; while (d < 10 && Math.abs(tick * 10 ** d - Math.round(tick * 10 ** d)) > 1e-9) d++; return d; }
