// GEX "Daily close" levels (Owner order 2026-11-06: "show gex levels based on daily close, or real time update").
//
// The recorder keeps only the LATEST compact Cboe chain per symbol + part (table gex), so during the session the
// close chain is overwritten. On every /gex-ingest the DO also offers the chain to closeCandidate(): the chain whose
// Cboe time is nearest 16:00 ET (inside 16:00-16:15 ET) of the day it was fetched is frozen in table gexclose, one per
// symbol + part + ET day. A day with no chain in that window (half day, feeder gap) keeps the first chain fetched at or
// after 16:05 ET instead, flagged win = 0. Nothing new is fetched from any vendor: these are the chains the feeder
// already posts.
//
// /gex-close (server to server, same gate as /gex-chain) answers with the row pickClose() chooses: the close of the
// last COMPLETED regular session (16:00 ET on a weekday). Weekend -> Friday. The futures evening session that opens
// 18:00 ET uses that same day's 16:00 close (the "day before" its trade date). Holiday or a missing freeze -> the
// latest earlier close, flagged fallback; the note on the site always prints the date actually used.
// Pure (Intl only), shared by the Worker and the site's Pages Function (functions/api/gex/levels/[name].js).
// Education only. Not financial advice.
export const CLOSE_KEEP_DAYS = 10;
const CLOSE_MIN = 16 * 60, WIN_END_MIN = 16 * 60 + 15, LATE_FETCH_MIN = 16 * 60 + 5, DONE_MIN = 16 * 60 + 20;   // a session counts as completed once its close window is over

const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hour12: false });
export function etParts(tsSec) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(tsSec * 1000)).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  return { day: p.year + '-' + p.month + '-' + p.day, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), min: h * 60 + Number(p.minute), h, mi: Number(p.minute), s: Number(p.second) };
}
// Cboe's last_trade_time is New York wall time with no zone ("2026-11-05T16:14:59").
export function etEpoch(str) {
  if (!str) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(str)) { const t = Date.parse(str); return Number.isFinite(t) ? t / 1000 : null; }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(str);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
  let ts = wall;
  for (let i = 0; i < 2; i++) { const c = etParts(ts), [y, mo, d] = c.day.split('-').map(Number); ts += wall - Date.UTC(y, mo - 1, d, c.h, c.mi, c.s) / 1000; }
  return ts;
}
// epoch of hh:mm ET on ET day 'YYYY-MM-DD'
export function etAt(day, min) { return etEpoch(day + 'T' + String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0') + ':00'); }
function addDays(day, n) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dowOf(day) { return new Date(day + 'T12:00:00Z').getUTCDay(); }

// Should the incoming chain replace the frozen close of its day? inc = { ct: Cboe chain epoch, ts: fetched epoch },
// prev = the stored row for that day ({ ct, win }) or null. Returns null (keep prev) or { day, win }.
export function closeCandidate(prev, inc) {
  if (!(inc && inc.ct > 0 && inc.ts > 0)) return null;
  const c = etParts(inc.ct), f = etParts(inc.ts);
  if (c.day !== f.day || c.dow === 0 || c.dow === 6) return null;   // a chain still from an earlier day / weekend
  const win = c.min >= CLOSE_MIN && c.min <= WIN_END_MIN;
  if (win) {
    const c16 = etAt(c.day, CLOSE_MIN);
    if (!prev || !prev.win || Math.abs(inc.ct - c16) < Math.abs(prev.ct - c16)) return { day: c.day, win: true };
    return null;
  }
  return !prev && f.min >= LATE_FETCH_MIN ? { day: c.day, win: false } : null;
}

// The ET day of the last completed regular session at nowSec (weekday past 16:20 ET; no holiday table: a holiday has no
// stored close, so pickClose falls back to the latest earlier one).
export function lastSessionDay(nowSec) {
  const n = etParts(nowSec);
  let day = n.day;
  if (!(n.dow >= 1 && n.dow <= 5 && n.min >= DONE_MIN)) day = addDays(day, -1);
  while (dowOf(day) === 0 || dowOf(day) === 6) day = addDays(day, -1);
  return day;
}
// rows = [{ day, ct, ts, win }] for one symbol + part. Returns { row, expected, fallback } or null.
export function pickClose(rows, nowSec) {
  const expected = lastSessionDay(nowSec);
  const ok = (rows || []).filter((r) => r && r.day <= expected).sort((a, b) => (a.day < b.day ? 1 : -1));
  if (!ok.length) return null;
  return { row: ok[0], expected, fallback: ok[0].day !== expected };
}
// History fallback (no frozen chain for that day): gex-history snapshots { t, day, ... } -> per ET day the one nearest
// 16:00 ET inside 16:00-16:15 ET, as rows for pickClose ({ day, ct, snap }).
export function closeSnapRows(snaps) {
  const best = new Map();
  for (const s of snaps || []) {
    if (!s || !(s.t > 0)) continue;
    const c = etParts(s.t);
    if (c.min < CLOSE_MIN || c.min > WIN_END_MIN) continue;
    const d = Math.abs(s.t - etAt(c.day, CLOSE_MIN)), b = best.get(c.day);
    if (!b || d < b.dist) best.set(c.day, { day: c.day, ct: s.t, dist: d, snap: s });
  }
  return [...best.values()].map(({ dist, ...r }) => r);
}
// The next weekday's 09:30 ET after ET day `day`: the moment the close levels are for (expiry days counted from it).
export function nextOpen(day) {
  let d = addDays(day, 1);
  while (dowOf(d) === 0 || dowOf(d) === 6) d = addDays(d, 1);
  return etAt(d, 9 * 60 + 30);
}
// "Thu 5 Nov"
export function closeLabel(day) {
  const d = new Date(day + 'T12:00:00Z');
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
}
