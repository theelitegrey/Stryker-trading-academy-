// InsightSentry MONTHLY REST quota counter (2026-10-25, CoS order "is monthly quota 1026").
//
// WHY: the plan (Growth) allows 120,000 REST requests per billing period (Oct 9 - Nov 8, then the 9th to the 8th).
// WebSocket data is unmetered (insightsentry.com/llms.txt: "Unmetered real-time WebSocket data"); the WS limit that
// matters is the 120 subscription messages / 3 h the IS hub already counts (src/is-hub.js). Nothing counted the monthly
// REST quota, and on 2026-10-25 the Owner's dashboard read 75,441 of 120,000 with the server feeders spending
// ~13,500 a weekday. IS has no usage endpoint (openapi.json has none), so we count our own calls:
//   - every server feeder POSTs /is-note {src, n} with the ingest secret after the calls it made;
//   - the site's Pages Functions (GEX hybrid / fallback chain) POST /is-note with an HMAC of the minute keyed with the
//     InsightSentry key they already hold (no new secret); see functions/api/gex/_engine.js noteIs().
// A baseline {at, used} copied from the IS dashboard anchors the period total; everything counted after `at` is added.
// GET /is-health shows the result under `month` (counts only, no secrets) and scripts/site_health.py alerts when the
// projected period total passes 90 % of the quota.
//
// Storage: one DO storage value 'isUse' = { days: {YYYY-MM-DD: {src: n}}, base: {at, used, period} | null, since: n }.
// Days are UTC. 45 days kept. Pure functions below (unit-tested in test/is-usage.test.mjs).

export const QUOTA = 120000;
export const PERIOD_DAY = 9;                    // the billing period starts on the 9th (Oct 9 - Nov 8)
export const ALERT_PCT = 0.9;
// Planned spend after the 2026-10-25 cuts, used for the projection until real full days have been counted.
export const PLAN_RATE = { wk: 2300, we: 350 };   // feeders ~2,150 + Pages GEX margin; weekend ~320
export const SOURCES = ['gexfast', 'opt', 'scan', 'news', 'newscal', 'brief', 'info', 'of', 'pages', 'other'];
const KEEP_DAYS = 45;
const DAY = 86400000;

export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (k) => Date.parse(k + 'T00:00:00Z');
const isWeekend = (k) => { const d = new Date(dayMs(k)).getUTCDay(); return d === 0 || d === 6; };

// Billing period holding `ms`: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' (last day, inclusive) }.
export function periodOf(ms, pday = PERIOD_DAY) {
  const d = new Date(ms);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (d.getUTCDate() < pday) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  const start = Date.UTC(y, m, pday);
  const next = Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, pday);
  return { start: dayKey(start), end: dayKey(next - DAY) };
}

export function emptyUse() { return { days: {}, base: null, since: 0, first: null }; }

// Add n requests from src at time ms. Mutates and returns use.
export function addNote(use, src, n, ms) {
  use = use && use.days ? use : emptyUse();
  src = SOURCES.includes(src) ? src : 'other';
  n = Math.max(0, Math.min(100000, Math.floor(Number(n) || 0)));
  if (!n) return use;
  const k = dayKey(ms);
  const d = use.days[k] || (use.days[k] = {});
  d[src] = (d[src] || 0) + n;
  if (!use.first) use.first = ms;
  if (use.base && use.base.period === periodOf(ms).start && ms >= use.base.at) use.since = (use.since || 0) + n;
  const cut = dayKey(ms - KEEP_DAYS * DAY);
  for (const key of Object.keys(use.days)) if (key < cut) delete use.days[key];
  return use;
}

// Dashboard baseline: `used` requests at time `at` (ms). Counting after `at` is added on top.
export function setBase(use, at, used) {
  use = use && use.days ? use : emptyUse();
  use.base = { at, used: Math.floor(used), period: periodOf(at).start };
  use.since = 0;
  return use;
}

const sumDay = (d) => Object.values(d || {}).reduce((a, b) => a + b, 0);

// -> the `month` block of /is-health.
export function summary(use, now, plan = PLAN_RATE) {
  use = use && use.days ? use : emptyUse();
  const p = periodOf(now), today = dayKey(now);
  const inPeriod = Object.keys(use.days).filter((k) => k >= p.start && k <= p.end).sort();
  const counted = inPeriod.reduce((a, k) => a + sumDay(use.days[k]), 0);
  const baseOk = use.base && use.base.period === p.start;
  const used = baseOk ? use.base.used + (use.since || 0) : counted;
  // run rate from FULL counted days: not today, not the (partial) first day of counting
  const firstDay = use.first ? dayKey(use.first) : today;
  const full = Object.keys(use.days).filter((k) => k > firstDay && k < today).sort();
  const avg = (ks) => (ks.length ? Math.round(ks.reduce((a, k) => a + sumDay(use.days[k]), 0) / ks.length) : null);
  const wkDays = full.filter((k) => !isWeekend(k)).slice(-7), weDays = full.filter(isWeekend).slice(-4);
  const rate = { wk: avg(wkDays), we: avg(weDays) };
  const basis = { wk: rate.wk == null ? 'plan' : wkDays.length + ' days', we: rate.we == null ? 'plan' : weDays.length + ' days' };
  if (rate.wk == null) rate.wk = plan.wk;
  if (rate.we == null) rate.we = plan.we;
  const rateOf = (k) => (isWeekend(k) ? rate.we : rate.wk);
  const todayN = sumDay(use.days[today]);
  let projected = used + Math.max(0, rateOf(today) - todayN), runsOut = null, acc = projected;
  if (acc > QUOTA) runsOut = today;
  for (let t = dayMs(today) + DAY; dayKey(t) <= p.end; t += DAY) {
    const k = dayKey(t);
    acc += rateOf(k);
    if (!runsOut && acc > QUOTA) runsOut = k;
  }
  projected = acc;
  const perDay = inPeriod.slice(-14).map((k) => ({ day: k, n: sumDay(use.days[k]), by: use.days[k] }));
  return {
    quota: QUOTA, period: p, used, usedBasis: baseOk ? 'dashboard ' + new Date(use.base.at).toISOString().slice(0, 16) + 'Z + counted' : 'counted only (no dashboard baseline this period)',
    base: baseOk ? { at: use.base.at, used: use.base.used } : null, countedSinceBase: baseOk ? use.since || 0 : null,
    today: todayN, todayBy: use.days[today] || {}, rate, rateBasis: basis,
    projected: Math.round(projected), projectedPct: Math.round((projected / QUOTA) * 1000) / 10,
    alert: projected > QUOTA * ALERT_PCT, alertAtPct: ALERT_PCT * 100, runsOutOn: runsOut, perDay
  };
}

// HMAC-SHA256(key, 'is-note|' + minute) as hex: lets the Pages Functions (which hold the IS key) post notes without a
// second secret. Accepts the current and the previous minute.
export async function noteSig(key, minute) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('is-note|' + minute));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function sigOk(key, sig, now = Date.now()) {
  if (!key || !sig || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const m = Math.floor(now / 60000);
  for (const mm of [m, m - 1, m + 1]) if ((await noteSig(key, mm)) === sig) return true;
  return false;
}
