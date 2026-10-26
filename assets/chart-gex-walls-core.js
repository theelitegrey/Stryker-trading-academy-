// TradeZoro — Charts GEX walls over time (pure functions, no DOM, no network) — ES module.
// Used by assets/chart-gex-levels.js; unit-tested by tools/tests/chart-gex-walls.test.mjs on real
// recorded QQQ 0DTE sessions (tools/tests/fixtures/gex/hist-QQQ-*.json).
//
// WHY (Owner report 2026-10-26, MNQ 3m): "the call wall was there but as price approached it moved to
// the next strike ... call wall should have been visible while price was there, not before or after."
// Two causes, both fixed here:
//  1. One flat line at TODAY's value was drawn across the whole chart. Now each wall is a STEP line
//     over time from the recorded GEX history (2-min snapshots): every segment sits where the wall
//     was during that period, with a vertical step where it changed.
//  2. The engine's rule (biggest call gamma AT OR ABOVE spot, biggest put gamma AT OR BELOW spot)
//     drops the wall strike the moment price trades through it, and 0DTE gamma near spot flickers
//     between neighbouring strikes. On 2026-10-23 the raw call/put walls changed 34 times in one
//     session (710 <-> 706 every few minutes). holdWalls() below keeps a wall on its strike while
//     price is testing it. The engine and the API are NOT changed (the API still publishes the raw
//     wall); this is how the chart draws it.
//
// HOLD RULE (per side, per session; a new ET day starts fresh from the raw wall):
//   band   = HOLD_BAND x spot (0.3 %: about 2.1 QQQ points / 87 NQ points / 20 SPX points)
//   - price within the band of the held wall          -> keep it (price is testing it)
//   - price beyond it by more than the band (call: above, put: below) and the new raw wall has
//     been the same strike for BROKEN_CONFIRM snapshots in a row  -> move to the new wall
//   - otherwise (price away from the held wall) the new raw wall must be the same strike for
//     MOVE_CONFIRM snapshots in a row (about 6 min) before the line moves
// Zero gamma (a computed level, not a strike): median of the last ZG_WIN snapshots, and the step
// moves only when that median moves by ZG_MIN_MOVE x spot or more.
// The snapshots carry net GEX per strike only (not the call-only / put-only gamma the wall is picked
// by), so the rule confirms by persistence, not by a gamma-size margin.
// Education only. Not financial advice.

export const HOLD_BAND = 0.003;
export const BROKEN_CONFIRM = 2;
export const MOVE_CONFIRM = 3;
export const ZG_WIN = 5;               // zero gamma: median of the last 5 snapshots (it is a computed root, not a strike,
export const ZG_MIN_MOVE = 0.002;      // and jumps by several points between snapshots); a move under 0.2 % of spot keeps the step
export const BASIS_WIN = 7;            // futures basis: median of the last 7 snapshots (about 14 min)

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function stepSide(st, raw, s, side, day) {
  if (st.held == null || st.day !== day) { st.held = isNum(raw) ? raw : null; st.day = day; st.cand = null; st.n = 0; return; }
  if (!isNum(raw) || raw === st.held) { st.cand = null; st.n = 0; return; }
  if (raw === st.cand) st.n++; else { st.cand = raw; st.n = 1; }
  const band = HOLD_BAND * s;
  const near = Math.abs(s - st.held) <= band;
  const broken = side === 'C' ? s > st.held + band : s < st.held - band;
  if ((broken && st.n >= BROKEN_CONFIRM) || (!near && !broken && st.n >= MOVE_CONFIRM)) { st.held = raw; st.cand = null; st.n = 0; }
}

// rows: snapshots of ONE underlying + expiry mode, oldest first ({ t, day, x, s, cw, pw, zg }).
// live (optional): one more observation after the last row (the API's current raw walls).
// A new session (ET day or expiry x changes) starts from its own raw walls.
// Returns one point per row (+ the live one): { t, day, key, s, cw, pw, zg, rawCw, rawPw, live }.
export function holdWalls(rows, live) {
  const C = { held: null }, P = { held: null };
  let zg = null, zkey = null;
  const zwin = [];
  const all = live ? rows.concat([live]) : rows;
  const out = [];
  for (const r of all) {
    if (!r || !isNum(r.s) || r.s <= 0) continue;
    const key = r.day + '|' + (r.x || '');
    stepSide(C, r.cw, r.s, 'C', key);
    stepSide(P, r.pw, r.s, 'P', key);
    if (zkey !== key) { zwin.length = 0; zg = null; }
    if (isNum(r.zg)) { zwin.push(r.zg); if (zwin.length > ZG_WIN) zwin.shift(); }
    if (zwin.length) {
      const m = zwin.slice().sort((a, b) => a - b)[zwin.length >> 1];
      if (!isNum(zg) || Math.abs(m - zg) >= ZG_MIN_MOVE * r.s) zg = m;
    }
    zkey = key;
    out.push({ t: r.t, day: r.day, key, s: r.s, cw: C.held, pw: P.held, zg, rawCw: r.cw, rawPw: r.pw, live: r === live });
  }
  return out;
}

// Futures basis per snapshot: median, over the last BASIS_WIN snapshots of the same day, of
// (chart futures close at the snapshot time - k x spot). closeAt(t) -> number|null. Index charts: k = 1, closeAt = null -> 0.
export function basisSeries(rows, closeAt, k) {
  const out = [], win = [];
  let day = null;
  for (const r of rows) {
    const sk = r.key || r.day;
    if (sk !== day) { win.length = 0; day = sk; }
    const c = closeAt ? closeAt(r.t) : null;
    if (isNum(c) && isNum(r.s)) { win.push(c - k * r.s); if (win.length > BASIS_WIN) win.shift(); }
    if (!win.length) { out.push(null); continue; }
    const a = win.slice().sort((x, y) => x - y), m = a.length >> 1;
    out.push(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2);
  }
  return out;
}

// points [{ t, v, key }] (v = a strike / level or null; key = session), oldest first -> step
// segments [{ t0, t1, v, i0, i1 }]: equal consecutive values of one session merge; a null ends the
// line; t1 = the next point's time (same session), or the session's last point + SESSION_TAIL_S
// (sessions are not joined across the overnight gap: the next one is a different chain/expiry);
// the very last segment gets t1 = null (the renderer runs it to the right edge).
// i0..i1 = the point indexes the segment covers (inclusive).
export const SESSION_TAIL_S = 120;
export function stepSegments(points) {
  const segs = [];
  let cur = null;
  points.forEach((p, i) => {
    if (cur && isNum(p.v) && p.v === cur.v && p.key === cur.key) { cur.i1 = i; return; }
    if (cur) { cur.t1 = p.key === cur.key ? p.t : Math.min(p.t, points[i - 1].t + SESSION_TAIL_S); segs.push(cur); cur = null; }
    if (isNum(p.v)) cur = { t0: p.t, t1: null, v: p.v, key: p.key, i0: i, i1: i };
  });
  if (cur) segs.push(cur);
  return segs;
}

// Drawable steps for one level. pts = holdWalls() output; field 'cw' | 'pw' | 'zg';
// basis = basisSeries() over the same points (null entries allowed); k = futures ratio (null on an
// index/ETF chart: the strike is the chart price); finalPrice = the chart price of the segment that
// runs to the right edge (the label's price), or null to convert it like the others.
// Returns [{ a, b, p }] (epoch s; b null = to the right edge; p = chart price), oldest first. A
// segment whose futures basis is unknown (no chart bars that far back) is left out.
export function stepsFor(pts, field, basis, k, finalPrice) {
  const segs = stepSegments(pts.map((p) => ({ t: p.t, v: p[field], key: p.key })));
  const out = [];
  for (const s of segs) {
    let p = null;
    if (s.t1 == null && isNum(finalPrice)) p = finalPrice;
    else if (!isNum(k)) p = s.v;
    else {
      const b = [];
      for (let i = Math.max(s.i0, s.i1 - 29); i <= s.i1; i++) if (basis && isNum(basis[i])) b.push(basis[i]);
      if (b.length) { b.sort((x, y) => x - y); const m = b.length >> 1; p = s.v * k + (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2); }
    }
    if (isNum(p)) out.push({ a: s.t0, b: s.t1, p: Math.round(p * 100) / 100 });
  }
  return out;
}

// The wall the line held before its last change today (for the faded "prev CW" line), or null.
// pts = holdWalls() output; key 'cw' | 'pw'.
export function previousWall(pts, key) {
  if (!pts.length) return null;
  const sk = pts[pts.length - 1].key, cur = pts[pts.length - 1][key];
  for (let i = pts.length - 2; i >= 0 && pts[i].key === sk; i--) {
    if (isNum(pts[i][key]) && pts[i][key] !== cur) return { strike: pts[i][key], until: pts[i + 1].t };
  }
  return null;
}

// Futures basis of the LAST session in pts (median of its last BASIS_WIN known values), or null.
export function lastSessionBasis(pts, basis) {
  if (!pts.length || !basis) return null;
  const sk = pts[pts.length - 1].key, b = [];
  for (let i = pts.length - 1; i >= 0 && pts[i].key === sk && b.length < BASIS_WIN; i--) if (isNum(basis[i])) b.push(basis[i]);
  if (!b.length) return null;
  b.sort((x, y) => x - y); const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

// How many times a series changes value (test / report helper).
export function changes(arr) { let n = 0; for (let i = 1; i < arr.length; i++) if (arr[i] !== arr[i - 1]) n++; return n; }
