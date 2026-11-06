// Zscript data: PURE frame builders (no DOM, no imports). The hub (hub.js) feeds them what the chart's own stores hold.
// Frame shape: see ops.js. Every builder answers "what was known AT asOf" (never later): this is the no-lookahead rule.
// Education only. Not financial advice.
export const CAPS = { bookLevels: 20, heatRows: 160, fpRows: 120, bigs: 20, nodes: 10, ranked: 10 };
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const r8 = (v) => Math.round(v * 1e8) / 1e8;

// newest item with item[key] <= x (binary search, rows ascending), or null; maxAge in the same unit as key
export function lastAtOrBefore(rows, x, key, maxAge) {
  let lo = 0, hi = rows.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m][key] <= x) { best = m; lo = m + 1; } else hi = m - 1; }
  if (best < 0) return null;
  return maxAge != null && x - rows[best][key] > maxAge ? null : rows[best];
}

// ---- book -----------------------------------------------------------------------------------------------------------------
// exact levels from a live book ({bids, asks}: Map price -> size)
export function mapLevels(bids, asks, n) {
  n = n || CAPS.bookLevels;
  const top = (m, dir) => [...m].filter((x) => x[1] > 0).sort((a, b) => dir * (a[0] - b[0])).slice(0, n).map((x) => [x[0], x[1]]);
  return { bb: top(bids, -1), ba: top(asks, 1) };
}
// levels from one recorded sample (v: row sizes, > 0 bid, < 0 ask; row k holds prices [(i0+k)*step, (i0+k+1)*step)); price = row centre
export function sampleLevels(s, n) {
  n = n || CAPS.bookLevels;
  const bb = [], ba = [];
  for (let k = s.v.length - 1; k >= 0 && bb.length < n; k--) if (s.v[k] > 0) bb.push([r8((s.i0 + k + 0.5) * s.step), s.v[k]]);
  for (let k = 0; k < s.v.length && ba.length < n; k++) if (s.v[k] < 0) ba.push([r8((s.i0 + k + 0.5) * s.step), -s.v[k]]);
  return { bb, ba };
}
// the rows around the mid (heat(price) reads these); capped
export function sampleHeat(s) {
  const mid = Math.floor(s.mid / s.step + 1e-9), half = CAPS.heatRows >> 1;
  const a = Math.max(s.i0, mid - half), b = Math.min(s.i0 + s.v.length - 1, mid + half - 1);
  if (b < a) return null;
  return { step: s.step, i0: a, v: Array.from(s.v.slice(a - s.i0, b - s.i0 + 1), (x) => Math.round(x * 1000) / 1000) };
}
// book frame at asOf from recorded samples ([{ts, mid, step, i0, v}] ascending). maxAge: older than this = na.
export function bookFrameAt(samples, asOfMs, maxAgeMs) {
  const s = lastAtOrBefore(samples, asOfMs, 'ts', maxAgeMs == null ? 10 * 60000 : maxAgeMs);
  if (!s || !s.v || !s.v.length) return null;
  const { bb, ba } = sampleLevels(s);
  return { ts: s.ts, mid: s.mid, bb, ba, heat: sampleHeat(s) };
}
// the forming bar: exact levels from the live book + the heat rows of the newest sample
export function bookFrameLive(book, lastSample, nowMs) {
  const { bb, ba } = mapLevels(book.bids, book.asks);
  if (!bb.length && !ba.length) return lastSample ? bookFrameAt([lastSample], nowMs, 60000) : null;
  const mid = bb.length && ba.length ? (bb[0][0] + ba[0][0]) / 2 : (bb[0] || ba[0])[0];
  return { ts: nowMs, mid, bb, ba, heat: lastSample && lastSample.v && lastSample.v.length ? sampleHeat(lastSample) : null };
}

// ---- flow -----------------------------------------------------------------------------------------------------------------
// items = [{ t (ms, any resolution), rows:[[price, sell, buy]..], n, top:[sizes]|null }]; tfMs = the chart bar length.
// -> Map(barOpenMs -> flow frame). cvd = running delta over the covered bars only (starts at the first covered bar).
export function aggregateFlow(items, tfMs) {
  const byBar = new Map();
  for (const it of items) {
    const bt = Math.floor(it.t / tfMs) * tfMs;
    let b = byBar.get(bt);
    if (!b) { b = { rows: new Map(), n: 0, top: [], hasTop: true }; byBar.set(bt, b); }
    for (const [p, s, u] of it.rows) { const k = r8(p), e = b.rows.get(k); if (e) { e[0] += s; e[1] += u; } else b.rows.set(k, [s, u]); }
    b.n += it.n || 0;
    if (it.top) for (const x of it.top) b.top.push(x); else b.hasTop = false;
  }
  const out = new Map();
  let cvd = 0;
  for (const bt of [...byBar.keys()].sort((a, b) => a - b)) {
    const b = byBar.get(bt);
    const rows = [...b.rows].map(([p, v]) => [p, v[0], v[1]]).sort((a, c) => a[0] - c[0]);
    let buy = 0, sell = 0;
    for (const r of rows) { sell += r[1]; buy += r[2]; }
    if (!(buy + sell > 0)) continue;
    cvd += buy - sell;
    const va = valueArea(rows, 0.7);
    b.top.sort((x, y) => y - x);
    out.set(bt, { buy, sell, n: b.n, cvd, top: b.hasTop ? b.top.slice(0, CAPS.bigs) : null, fp: capRows(rows, va.poc), poc: va.poc, vah: va.vah, val: va.val });
  }
  return out;
}
// keep at most fpRows rows: the busiest ones, ascending by price
function capRows(rows, poc) {
  if (rows.length <= CAPS.fpRows) return rows;
  return rows.slice().sort((a, b) => (b[1] + b[2]) - (a[1] + a[2])).slice(0, CAPS.fpRows).sort((a, b) => a[0] - b[0]);
}
// point of control + value area (share of the volume around the POC), standard expansion by the larger neighbour
export function valueArea(rows, share) {
  if (!rows.length) return { poc: null, vah: null, val: null };
  let pi = 0, total = 0;
  rows.forEach((r, i) => { const v = r[1] + r[2]; total += v; if (v > rows[pi][1] + rows[pi][2]) pi = i; });
  let lo = pi, hi = pi, acc = rows[pi][1] + rows[pi][2];
  const vol = (i) => (i >= 0 && i < rows.length ? rows[i][1] + rows[i][2] : -1);
  while (acc < total * share && (lo > 0 || hi < rows.length - 1)) {
    const up = vol(hi + 1), dn = vol(lo - 1);
    if (up >= dn) { hi++; acc += up; } else { lo--; acc += dn; }
  }
  return { poc: rows[pi][0], vah: rows[hi][0], val: rows[lo][0] };
}
// adapters from the chart's own stores
// crypto TradeFeed bar { time, levels: Map(rowPrice -> [sell, buy]), n, top }
export const itemFromTradeBar = (b) => ({ t: b.time, rows: [...b.levels].map(([p, v]) => [p, v[0], v[1]]), n: b.n || 0, top: b.top && b.top.length ? b.top : null });
// futures TickFeed minute { t, lo, hi, buy[], sell[], trades } (tick-index rows); bigsRing = ring of [ts, price, size, side] when it covers the minute
export function itemFromTickBar(b, tick, ringSizes) {
  const rows = [];
  for (let j = 0; j < b.buy.length; j++) if (b.buy[j] || b.sell[j]) rows.push([r8((b.lo + j) * tick), b.sell[j], b.buy[j]]);
  return { t: b.t, rows, n: b.trades || 0, top: ringSizes || null };
}

// ---- gex ------------------------------------------------------------------------------------------------------------------
// price conversion for one history snapshot (same rule as chart-gex-levels snapData): ES/SPX ratio 1, else ratio or close/spot.
export function futConv(spot, close, ratio) {
  if (!fin(close) || !fin(spot) || spot <= 0) return () => null;
  const k = fin(ratio) && ratio > 0 ? ratio : close / spot, basis = close - k * spot;
  return (v) => (fin(v) ? v * k + basis : null);
}
const rankedStrikes = (k, g) => k.map((x, i) => ({ k: x, g: g[i] })).filter((x) => fin(x.k) && fin(x.g) && x.g !== 0)
  .sort((a, b) => Math.abs(b.g) - Math.abs(a.g) || a.k - b.k);
// zero-gamma crossings of the strike ladder: where the per-strike net GEX changes sign between two neighbouring strikes (linear in between).
// zu = the nearest crossing above `ref` (spot), zl = the nearest at or below it. net = the sum over the ladder ($M). Pure.
const ladderSums = (k, g, ref) => {
  const rows = k.map((x, i) => [x, g[i]]).filter((r) => fin(r[0]) && fin(r[1])).sort((a, b) => a[0] - b[0]);
  let zu = null, zl = null, net = 0;
  for (const r of rows) net += r[1];
  if (fin(ref)) {
    for (let i = 1; i < rows.length; i++) {
      const [k0, g0] = rows[i - 1], [k1, g1] = rows[i];
      if (g0 === 0 || g1 === 0 || (g0 > 0) === (g1 > 0)) continue;
      const x = k0 + (k1 - k0) * (Math.abs(g0) / (Math.abs(g0) + Math.abs(g1)));
      if (x > ref) { if (zu == null || x < zu) zu = x; } else if (zl == null || x > zl) zl = x;
    }
  }
  return { zu, zl, net: rows.length ? net : null };
};
// one history snapshot { t (s), s, cw, pw, zg, em:[centre,half], k:[strikes], g:[$M] } -> gex frame. conv: strike -> chart price.
export function gexFrameFromSnap(snap, conv) {
  const c = (v) => (fin(v) ? conv(v) : null), ls = ladderSums(snap.k || [], snap.g || [], fin(snap.s) ? snap.s : snap.zg);
  const lv = rankedStrikes(snap.k || [], snap.g || []).slice(0, CAPS.ranked).map((x) => c(x.k)).filter(fin);
  return { call: c(snap.cw), put: c(snap.pw), flip: c(snap.zg), zu: c(ls.zu), zl: c(ls.zl), net: ls.net, lv, ts: snap.t };
}
// the current API response ({call_wall, put_wall, zero_gamma, ladder:[{strike, gex ($)}]}) -> gex frame; tsSec = the data time
export function gexFrameFromApi(data, conv, tsSec) {   // spot: the API's own spot
  const L = (Array.isArray(data.ladder) ? data.ladder : []).filter((x) => x && fin(x.strike) && fin(x.gex));
  const k = L.map((x) => x.strike), g = L.map((x) => x.gex / 1e6);
  return gexFrameFromSnap({ t: tsSec, cw: data.call_wall, pw: data.put_wall, zg: data.zero_gamma, s: data.spot, k, g }, conv);
}

// ---- opt ------------------------------------------------------------------------------------------------------------------
// recorded bars carry only what the GEX history stores: nodes, the 0DTE range, the zone. No ivrank / pc / maxpain before now (na).
export function optFrameFromSnap(snap, conv) {
  const c = (v) => (fin(v) ? conv(v) : null);
  const nodes = rankedStrikes(snap.k || [], snap.g || []).slice(0, CAPS.nodes).map((x) => c(x.k)).filter(fin);
  const ranges = {};
  if (Array.isArray(snap.em) && fin(snap.em[0]) && fin(snap.em[1])) { const lo = c(snap.em[0] - snap.em[1]), hi = c(snap.em[0] + snap.em[1]); if (fin(lo) && fin(hi)) ranges['0DTE'] = [lo, hi]; }
  const zone = fin(snap.s) && fin(snap.zg) ? (snap.s >= snap.zg ? 'cushion' : 'swing') : null;
  return { nodes, ranges, ivrank: null, pc: null, maxpain: null, zone, ts: snap.t };
}
// the current ZoroOptions summary (chart-zoro-data zsum() shape) -> opt frame. conv: underlying price -> chart price.
export function optFrameFromSummary(zs, conv, maxpainRaw, pcVol) {
  const c = (v) => (fin(v) ? conv(v) : null);
  const ranges = {};
  for (const r of zs.ranges || []) { const lo = c(r.lo), hi = c(r.hi); if (fin(lo) && fin(hi) && hi > lo && !ranges[r.k]) ranges[r.k] = [lo, hi]; }
  const pc = fin(pcVol) ? pcVol : null;   // put / call volume ratio from the summary's raw pc.volume (zsum() drops it)
  return { nodes: (zs.nodes || []).slice(0, CAPS.nodes).map((n) => c(n.k)).filter(fin), ranges, ivrank: fin(zs.iv && zs.iv.rank) ? zs.iv.rank : null, pc,
    maxpain: c(maxpainRaw), zone: zs.zone || (fin(zs.spot) && fin(zs.flip) ? (zs.spot >= zs.flip ? 'cushion' : 'swing') : null), ts: zs.t };
}

// ---- caps -----------------------------------------------------------------------------------------------------------------
// frames for the newest `max` bars only (a script never sees more bars than the engine's own cap)
export function capFrames(frames, max) {
  if (frames.length <= max) return frames;
  return frames.slice(frames.length - max);
}
