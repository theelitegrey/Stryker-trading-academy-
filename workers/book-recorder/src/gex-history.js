// GEX history (heatmap + replay, Owner-approved 2026-10-14).
//
// The GEX feeder (gex-feeder/gex_feeder.py snapshot()) computes, on every 2-min run, one small
// snapshot per underlying (SPX, QQQ, SPY) and expiry mode (0DTE, 1DTE) and POSTs them together,
// gzip'd, to /gex-snap. The Durable Object keeps 90 days (table gexsnap) plus a per-day summary
// (table gexday) so the session list never scans the snapshots.
//
// Snapshot (one row): { u, d, day, t, fa, x, s, cw, pw, zg, n, em: [center, sigma] | null, k: [], g: [] }
//   t   = Cboe chain time (epoch s): the market moment the numbers describe. Replay looks up the
//         latest t <= replay time, so it never shows a later snapshot (no lookahead).
//   fa  = when our feeder fetched the chain; x = the expiry priced; s = Cboe spot.
//   k/g = strikes within +-5% of spot and the net GEX at each ($M per 1% move; calls +, puts -).
//   cw / pw / zg = call wall / put wall / zero gamma; n = net GEX within +-6% ($M).
//   em  = the session expected range: center +- sigma (68%), +- 1.2816 sigma (80%).
//
// /gex-history reply (packHistory): column arrays over one shared strike axis, so a full session of
// SPX (~200 snapshots x ~150 strikes) is ~60 KB of JSON before gzip.
export const HIST_SYMBOLS = ['SPX', 'QQQ', 'SPY'];
export const KEEP_DAYS = 90;
export const SNAP_MAX_BODY = 64 * 1024;
const MAX_STRIKES = 400;

async function gunzipJson(buf) {
  const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
  const text = await ds.text();
  if (text.length > 1024 * 1024) throw new Error('too big unpacked');
  return JSON.parse(text);
}
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const finOrNull = (x) => x === null || fin(x);

// Returns { snaps } when every snapshot is valid, else { error }.
export async function validateSnaps(buf, nowMs) {
  if (!buf || buf.byteLength < 20 || buf.byteLength > SNAP_MAX_BODY) return { error: 'bad size' };
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return { error: 'not gzip' };
  let d;
  try { d = await gunzipJson(buf); } catch (e) { return { error: 'bad gzip/json' }; }
  if (!d || d.v !== 1 || !Array.isArray(d.snaps) || !d.snaps.length || d.snaps.length > 12) return { error: 'bad header' };
  const now = nowMs / 1000, seen = new Set();
  for (const s of d.snaps) {
    const tag = (s && s.u) + ':' + (s && s.d);
    if (!s || !HIST_SYMBOLS.includes(s.u)) return { error: 'bad u ' + tag };
    if (s.d !== 0 && s.d !== 1) return { error: 'bad d ' + tag };
    if (seen.has(tag)) return { error: 'duplicate' };
    seen.add(tag);
    // chain time: not in the future, not older than a day (Cboe's delayed chain is ~15 min behind)
    if (!Number.isInteger(s.t) || s.t > now + 60 || now - s.t > 86400) return { error: 'bad t ' + tag };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.day)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.x))) return { error: 'bad day ' + tag };
    if (!(fin(s.s) && s.s > 0)) return { error: 'bad spot ' + tag };
    if (![s.cw, s.pw, s.zg, s.n].every(finOrNull)) return { error: 'bad levels ' + tag };
    if (s.em !== null && !(Array.isArray(s.em) && s.em.length === 2 && s.em.every(fin))) return { error: 'bad em ' + tag };
    const k = s.k, g = s.g;
    if (!Array.isArray(k) || !Array.isArray(g) || k.length !== g.length || k.length > MAX_STRIKES) return { error: 'bad strikes ' + tag };
    for (let i = 0; i < k.length; i++) {
      if (!fin(k[i]) || (i && k[i] <= k[i - 1]) || Math.abs(k[i] - s.s) / s.s > 0.0501 || !finOrNull(g[i])) return { error: 'bad strikes ' + tag };
    }
  }
  return { snaps: d.snaps };
}

// Rows (snapshots of ONE underlying + mode, sorted by t) -> compact columns over a shared strike axis.
export function packHistory(u, d, rows) {
  const axis = [...new Set(rows.flatMap((r) => r.k))].sort((a, b) => a - b);
  const idx = new Map(axis.map((k, i) => [k, i]));
  const col = (f) => rows.map(f);
  return {
    v: 1, u, d, k: axis,
    t: col((r) => r.t), fa: col((r) => r.fa), day: col((r) => r.day), x: col((r) => r.x), s: col((r) => r.s),
    cw: col((r) => r.cw), pw: col((r) => r.pw), zg: col((r) => r.zg), n: col((r) => r.n), em: col((r) => r.em),
    // per snapshot: [first axis index, value, value, ...] (strikes are contiguous on the axis; a
    // strike missing inside the run is null)
    g: rows.map((r) => {
      if (!r.k.length) return [0];
      const i0 = idx.get(r.k[0]), out = [i0];
      const i1 = idx.get(r.k[r.k.length - 1]);
      const vals = new Array(i1 - i0 + 1).fill(null);
      r.k.forEach((k, j) => { vals[idx.get(k) - i0] = r.g[j]; });
      return out.concat(vals);
    })
  };
}

// The inverse (used by the tests and mirrored in the site's client code).
export function unpackHistory(p) {
  return p.t.map((t, i) => {
    const row = p.g[i], i0 = row[0], k = [], g = [];
    for (let j = 1; j < row.length; j++) if (row[j] !== null) { k.push(p.k[i0 + j - 1]); g.push(row[j]); }
    return { u: p.u, d: p.d, t, fa: p.fa ? p.fa[i] : null, day: p.day[i], x: p.x[i], s: p.s[i], cw: p.cw[i], pw: p.pw[i], zg: p.zg[i], n: p.n[i], em: p.em[i], k, g };
  });
}

// No-lookahead lookup: the latest snapshot with t <= ts (binary search on sorted rows); null before
// the history begins, or when the latest one is older than maxAgeSec.
export function snapAt(rows, ts, maxAgeSec = Infinity) {
  let lo = 0, hi = rows.length - 1, best = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (rows[m].t <= ts) { best = m; lo = m + 1; } else hi = m - 1;
  }
  if (best < 0) return null;
  return ts - rows[best].t > maxAgeSec ? null : rows[best];
}
