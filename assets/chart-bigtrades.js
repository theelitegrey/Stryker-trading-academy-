// TradeZoro — Charts: BIG TRADES v2, ONE detection + render module for "Big Trades" (standard feed, chart-footprint.js) and
// "Big Trades (L1)" (chart-ts-trades.js). The feed is the only difference: both hand in prints [[ms, priceTickIdx, size, side 1 buy|0 sell]..].
// Pure functions first (no DOM, unit-tested in tools/tests/bigtrades.test.mjs), then the canvas drawing.
//
// How it works (Owner 2026-11-03: "only impactful orders, not a bubbles carpet"):
//   1. AGGREGATE: consecutive same-side prints inside a short burst (gap <= burst ms, price walking <= N ticks from the last fill) = ONE parent
//      order: total size, VWAP, price range swept, fills. Opposite sides never merge.
//   1b. CLUSTER (optional, "Also count fills at one price over (s)", 0 = off): same-side orders that each stayed at ONE price are summed with the
//      later ones at the SAME price inside the window: a big passive wall filled by many small market orders becomes one marker.
//   2. FILTER: Automatic = a number of markers per 6.5 h of loaded data (Very low 40 / Low 25 / Medium 15 / Strong 8: the threshold is the n-th biggest
//      order), the same for every symbol and feed; or Manual min / max size.
//   3. IMPACT 0..1 = size vs normal (robust z-score on log size) + levels swept + follow-through (what price did in the next 60 s, in ATR units).
//      An order that was big but price did NOT follow (<= 0.2 ATR in its direction) is flagged ABSORPTION (hollow ring + "A").
//   4. CAP: at most one marker per N px per side (the highest impact wins).
// Follow-through uses the chart's own bars (resolution = the chart timeframe) and updates as new bars arrive.
// Education only. Not financial advice.

export const DEFAULTS = {
  aggregate: true, burstMs: 150, walkTicks: 4, clusterSec: 0,
  mode: 'Automatic', intensity: 'Medium', minSize: 0, maxSize: 0,
  shape: 'Circle', sizeScale: 1, minOpacity: 0.7, showSize: false, showFills: false, absorption: true, sweep: true, extend: 0
};
// markers per 6.5 h (one RTH session) of loaded data. Measured on real NQ / ES / CL days 2026-10-21 and 11-02: Medium gives 8-15 per RTH session.
export const RATE = { 'Very low': 40, Low: 25, Medium: 15, Strong: 8 };

// Old saved layouts (mult / minSize / labels / cluster) -> the new settings. Only when the new `mode` key is absent.
export function migrate(inp) {
  const i = Object.assign({}, inp || {});
  if (i.mode == null && (i.mult != null || i.labels != null || i.cluster != null || i.minSize != null)) {
    if (i.minSize > 0) i.mode = 'Manual'; else { i.mode = 'Automatic'; i.intensity = i.mult >= 2 ? 'Strong' : i.mult < 1 ? 'Low' : 'Medium'; }
    if (i.labels != null) i.showSize = !!i.labels;
    if (i.cluster === false) i.aggregate = false;
  }
  if (i.sellColor === '#9d4dff') i.sellColor = '#f23645';   // the old purple sellers -> red (Owner 2026-11-03)
  return i;
}

// ---------------------------------------------------------------- aggregation
export function aggregate(prints, { burstMs = 150, walkTicks = 4, on = true } = {}) {
  const all = prints.slice().sort((a, b) => a[0] - b[0]);
  const mk = (p) => ({ ms: p[0], last: p[0], side: p[3] ? 1 : 0, size: p[2], pv: p[1] * p[2], vwap: p[1], hi: p[1], lo: p[1], n: 1, lastPi: p[1] });
  const out = [], open = [null, null];
  for (const p of all) {
    const s = p[3] ? 1 : 0, o = open[s];
    if (on && o && p[0] - o.last <= burstMs && Math.abs(p[1] - o.lastPi) <= walkTicks) {
      o.size += p[2]; o.pv += p[1] * p[2]; o.vwap = o.pv / o.size; o.hi = Math.max(o.hi, p[1]); o.lo = Math.min(o.lo, p[1]); o.n++; o.last = p[0]; o.lastPi = p[1];
    } else { const n = mk(p); out.push(n); open[s] = n; }
  }
  for (const o of out) o.ticks = o.hi - o.lo;
  return out;
}
// parents (time order) -> parents with the one-price ones summed per side + price over `sec` seconds from the first; orders = how many joined
export function clusterAtPrice(parents, sec) {
  if (!(sec > 0)) return parents;
  const win = sec * 1000, open = new Map(), out = [];
  for (const p of parents) {
    if (p.ticks !== 0) { out.push(p); continue; }
    const key = p.side + ':' + p.lo, c = open.get(key);
    if (c && p.ms - c.ms <= win) { c.size += p.size; c.pv += p.pv; c.vwap = c.pv / c.size; c.n += p.n; c.last = p.last; c.orders++; continue; }
    const n = Object.assign({}, p, { orders: 1 }); open.set(key, n); out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------- statistics + filter
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q + 1e-9))] : 0);
export function logStats(sizes) {
  const l = sizes.map((s) => Math.log(Math.max(1e-9, s))).sort((a, b) => a - b);
  const med = quantile(l, 0.5), dev = l.map((x) => Math.abs(x - med)).sort((a, b) => a - b), mad = quantile(dev, 0.5) * 1.4826;
  return { med, sd: mad > 0.05 ? mad : 0.5 };   // shortcut: floor on the spread so a one-size history does not divide by ~0
}
export function threshold(parents, I, floor = 0) {
  if (I.mode === 'Manual') return Math.max(I.minSize > 0 ? I.minSize : 0, 1e-9);
  const sizes = parents.map((p) => p.size).sort((a, b) => b - a);
  // "hours" = active hours only (hour buckets with at least half the order count of the busiest hour), so quiet overnight data does not inflate the budget
  const hb = new Map(); for (const p of parents) { const k = Math.floor(p.ms / 3600000); hb.set(k, (hb.get(k) || 0) + 1); }
  const peak = Math.max(...hb.values()); let hours = 0; for (const c of hb.values()) if (c >= peak / 2) hours++;
  const n = Math.max(2, Math.round(((RATE[I.intensity] || RATE.Medium) * clamp(hours, 1, 72)) / 6.5));
  return Math.max(sizes[Math.min(sizes.length, n) - 1], floor, 1e-9);
}

// bars: chart bars [{ time, high, low, close }] (any of high|h, low|l, close|c); tf ms. Returns the parents that pass, each with z, ft, absorbed, impact.
export function select(prints, I, { floor = 0, bars = [], tfMs = 60000, tick = 0.25, now = Date.now(), refSizes = null } = {}) {
  const P = Object.assign({}, DEFAULTS, I);
  const parents = clusterAtPrice(aggregate(prints, { burstMs: P.burstMs, walkTicks: P.walkTicks, on: P.aggregate }), P.clusterSec);
  if (!parents.length) return { list: [], thr: 0, all: 0 };
  const thr = threshold(parents, P, floor), st = logStats(refSizes || parents.map((p) => p.size));
  const hi = (b) => (b.high != null ? b.high : b.h), lo = (b) => (b.low != null ? b.low : b.l), cl = (b) => (b.close != null ? b.close : b.c);
  let atr = 0, an = 0; for (const b of bars) { const r = (hi(b) - lo(b)) / tick; if (r >= 0) { atr += r; an++; } }
  atr = an ? Math.max(1, atr / an) : 8;
  const idx = (ms) => { let a = 0, z = bars.length - 1, r = -1; while (a <= z) { const m = (a + z) >> 1; if (bars[m].time <= ms) { r = m; a = m + 1; } else z = m - 1; } return r; };
  const out = [];
  for (const p of parents) {
    if (p.size < thr || (P.maxSize > 0 && p.size > P.maxSize)) continue;
    p.z = (Math.log(p.size) - st.med) / st.sd;
    // follow-through: close of the bar holding (time + 60 s) vs the VWAP, in the aggressor's direction, in ATR units; pending while that bar is still forming
    let ft = null, pending = true;
    if (bars.length) {
      const j = idx(p.ms + 60000);
      if (j >= 0) { const b = bars[j]; pending = b.time + tfMs > now || p.ms + 60000 > now; ft = ((p.side ? 1 : -1) * (cl(b) / tick - p.vwap)) / atr; }
    }
    p.ft = ft; p.pending = pending;
    p.absorbed = !pending && ft != null && ft <= 0.2;
    const sz = clamp(p.z / 4, 0, 1), sw = clamp(p.ticks / 6, 0, 1), fo = ft == null ? 0 : clamp(ft / 1.5, 0, 1);   // an absorbed order scores 0 here: big, but price did not follow
    p.impact = clamp(0.55 * sz + 0.2 * sw + 0.25 * fo, 0.05, 1);
    out.push(p);
  }
  return { list: out, thr, all: parents.length, st, atr };
}
// at most one marker per `px` horizontally per side: sort by impact, keep a marker only if no kept same-side one is closer. xs = (p) => x px.
export function cap(list, px, xOf) {
  const kept = [[], []], out = [];
  for (const p of list.slice().sort((a, b) => b.impact - a.impact)) {
    const x = xOf(p); if (x == null) continue;
    if (kept[p.side].some((k) => Math.abs(k - x) < px)) continue;
    kept[p.side].push(x); out.push(p);
  }
  return out;
}

// Area of the overlap of two circles (px^2), for the "skip a bubble that sits more than half under a stronger one" rule.
export function lens(r1, r2, d) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)), b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  return a + b - 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
}
// Marker radius from the impact score: AREA grows with impact, diameter 8 px (weakest) to 28 px phone / 36 px desktop (strongest).
export function radius(impact, phone) {
  const t = clamp((impact - 0.25) / 0.7, 0, 1), dMax = phone ? 28 : 36, a0 = 8 * 8, a1 = dMax * dMax;
  return Math.sqrt(a0 + (a1 - a0) * t) / 2;
}
export function words(impact) { return impact >= 0.75 ? 'Very strong' : impact >= 0.5 ? 'Strong' : 'Moderate'; }

// ---------------------------------------------------------------- schema (grouped: Data · Filter · Plot)
export function schema(base) {
  const B = Object.assign({ buy: '#03c988', sell: '#f23645' }, base || {});
  return [
    { group: 'Data', key: 'aggregate', title: 'Aggregate fills into one order', type: 'bool', defval: true, tooltip: 'Consecutive same-side prints in a short burst count as ONE order.' },
    { group: 'Data', key: 'burstMs', title: 'Burst gap (ms)', type: 'int', defval: 150, min: 10, max: 2000, step: 10, tooltip: 'Largest pause between two fills of one order.' },
    { group: 'Data', key: 'walkTicks', title: 'Price walk (ticks)', type: 'int', defval: 4, min: 0, max: 40, step: 1, tooltip: 'A sweep through up to this many ticks counts as one order.' },
    { group: 'Data', key: 'clusterSec', title: 'Also count fills at one price over (s)', type: 'int', defval: 0, min: 0, max: 600, step: 5, tooltip: 'Adds up same-side fills at the same price over this many seconds, so a big order filled by many small ones shows. 0 = off.' },
    { group: 'Filter', key: 'mode', title: 'Filter', type: 'string', defval: 'Automatic', options: ['Automatic', 'Manual'] },
    { group: 'Filter', key: 'intensity', title: 'Intensity', type: 'string', defval: 'Medium', options: ['Very low', 'Low', 'Medium', 'Strong'], when: { key: 'mode', anyOf: ['Automatic'] }, tooltip: 'About 40 / 25 / 15 / 8 markers per session. Very low = more markers.' },
    { group: 'Filter', key: 'minSize', title: 'Min size (contracts)', type: 'float', defval: 0, min: 0, max: 100000, step: 1, when: { key: 'mode', anyOf: ['Manual'] } },
    { group: 'Filter', key: 'maxSize', title: 'Max size (0 = no limit)', type: 'float', defval: 0, min: 0, max: 1000000, step: 1, when: { key: 'mode', anyOf: ['Manual'] }, tooltip: 'Run two copies with different bands.' },
    { group: 'Plot', key: 'shape', title: 'Marker', type: 'string', defval: 'Circle', options: ['Circle', 'Square', 'Diamond', 'Text only'] },
    { group: 'Plot', key: 'sizeScale', title: 'Size scale (SD)', type: 'float', defval: 1, min: 0.3, max: 4, step: 0.1, tooltip: 'Higher = markers grow more slowly with impact.' },
    { group: 'Plot', key: 'minOpacity', title: 'Fill opacity', type: 'float', defval: 0.7, min: 0.1, max: 1, step: 0.05 },
    { group: 'Plot', key: 'buyColor', title: 'Buyers (hit the ask)', type: 'color', defval: B.buy },
    { group: 'Plot', key: 'sellColor', title: 'Sellers (hit the bid)', type: 'color', defval: B.sell },
    { group: 'Plot', key: 'showSize', title: 'Show size', type: 'bool', defval: false },
    { group: 'Plot', key: 'showFills', title: 'Show fills count', type: 'bool', defval: false },
    { group: 'Plot', key: 'absorption', title: 'Mark absorption (A)', type: 'bool', defval: true, tooltip: 'Big order, but price did not follow it in the next minute.' },
    { group: 'Plot', key: 'sweep', title: 'Show levels swept', type: 'bool', defval: true },
    { group: 'Plot', key: 'extend', title: 'Extend levels (bars, 0 = off)', type: 'int', defval: 0, min: 0, max: 200, step: 5, tooltip: 'A faint line from the biggest orders to the right.' }
  ];
}

// ---------------------------------------------------------------- drawing
export const compact = (v) => { const a = Math.abs(v); return a >= 1e6 ? +(v / 1e6).toFixed(1) + 'M' : a >= 1000 ? +(v / 1000).toFixed(1) + 'k' : String(Math.round(v)); };
const istTime = (ms) => { try { return new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' IST'; } catch (e) { return ''; } };
export function tipRows(p, tick) {
  return [(p.side ? 'Buy' : 'Sell') + ' order · ' + words(p.impact) + ' impact', 'Size ' + compact(p.size) + ' @ ' + (p.vwap * tick).toFixed(2), p.n + ' fill' + (p.n === 1 ? '' : 's') + ' · ' + (p.orders > 1 ? p.orders + ' orders at one price over ' + Math.max(1, Math.round((p.last - p.ms) / 1000)) + 's' : p.ticks < 1 ? 'one price level' : p.ticks + ' tick' + (p.ticks === 1 ? '' : 's') + ' swept'),
    'Follow-through ' + (p.ft == null || p.pending ? 'pending' : (p.ft >= 0 ? '+' : '') + p.ft.toFixed(2) + ' ATR') + (p.absorbed ? ' · absorbed' : ''), istTime(p.ms)];
}
// hits[canvas] = markers drawn last frame, for the hover tooltip (installTip)
const hits = new WeakMap();
// H = { frame, idxOf, alpha, light, replayE, MONO }; a = layer args; sel = select() result; I = settings; tick = price per tick idx
export function draw(canvas, a, sel, I, tick, H) {
  const g = H.frame(canvas, a);
  if (!g) return;
  const P = Object.assign({}, DEFAULTS, I), co = a.coords, E = H.replayE(), phone = co.width < 520;
  const top = a.bounds.top, bot = top + a.bounds.height, ppb = co.pxPerBar ? co.pxPerBar() : 8;
  const vr = co.visibleLogicalRange(), t0 = a.bars[Math.max(0, Math.floor(vr.from))].time, t1 = a.bars[Math.min(a.bars.length - 1, Math.ceil(vr.to))].time + 86400000;
  const pos = new Map();
  const vis = sel.list.filter((p) => p.ms >= t0 && p.ms <= t1 && (E == null || p.ms <= E));
  const capped = cap(vis, phone ? 10 : 14, (p) => { const i = H.idxOf(a.bars, p.ms); if (i < 0) return null; pos.set(p, i); return co.logicalToX(i); });
  const buyC = P.buyColor || '#03c988', sellC = P.sellColor || '#f23645', day = H.light(), txt = day ? '#0f172a' : '#f5f5f5', sd = Math.max(0.3, P.sizeScale);
  g.save(); g.beginPath(); g.rect(0, top, co.width, a.bounds.height); g.clip();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const labels = [], shown = [], placed = [];
  const textOnly = P.shape === 'Text only', showSize = P.showSize || textOnly;
  // strongest first; a marker more than half under a stronger one is skipped
  const items = [];
  for (const p of capped.sort((x, y) => y.impact - x.impact)) {
    const x = co.logicalToX(pos.get(p)), y = co.priceToY(p.vwap * tick, a.scale, a.bounds);
    if (y < top - 30 || y > bot + 30) continue;
    const r = radius(p.impact, phone) / Math.sqrt(sd);
    if (placed.some((q) => lens(r, q.r, Math.hypot(x - q.x, y - q.y)) > 0.5 * Math.PI * Math.min(r, q.r) ** 2)) continue;
    placed.push({ x, y, r }); items.push({ p, x, y, r });
  }
  for (const { p, x, y, r } of items.slice().reverse()) {   // weakest drawn first, strongest on top
    const col = p.side ? buyC : sellC, op = P.minOpacity;
    if (P.sweep && p.ticks >= 2 && !textOnly) {
      const y1 = co.priceToY(p.hi * tick, a.scale, a.bounds), y2 = co.priceToY(p.lo * tick, a.scale, a.bounds);
      g.strokeStyle = H.alpha(col, 0.9); g.lineWidth = 1; g.beginPath(); g.moveTo(x, y1); g.lineTo(x, y2); g.stroke();
    }
    if (P.extend > 0 && p.impact >= 0.7) { g.strokeStyle = H.alpha(col, 0.28); g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(x, y); g.lineTo(x + P.extend * ppb, y); g.stroke(); g.setLineDash([]); }
    const abs = P.absorption && p.absorbed;
    if (!textOnly) {
      g.beginPath();
      if (P.shape === 'Square') g.rect(x - r, y - r, 2 * r, 2 * r);
      else if (P.shape === 'Diamond') { g.moveTo(x, y - r * 1.25); g.lineTo(x + r * 1.25, y); g.lineTo(x, y + r * 1.25); g.lineTo(x - r * 1.25, y); g.closePath(); }
      else g.arc(x, y, r, 0, Math.PI * 2);
      if (abs) { g.lineWidth = 2; g.strokeStyle = H.alpha(col, 1); g.stroke(); }
      else { g.fillStyle = H.alpha(col, op); g.fill(); g.lineWidth = 1; g.strokeStyle = H.alpha(col, 1); g.stroke(); }
      if (abs) { g.font = '700 ' + clamp(Math.round(r), 8, 12) + 'px ' + H.MONO; g.fillStyle = col; g.fillText('A', x, y + 0.5); }
    }
    shown.push({ x, y, r: Math.max(r, 10), p });
    if (showSize || P.showFills) {
      const lt = (showSize ? compact(p.size) : '') + (P.showFills ? (showSize ? ' ' : '') + '×' + p.n : '');
      labels.push({ x, y, r, s: lt, inside: !textOnly && r >= 10 && !P.showFills && !abs });
    }
  }
  // numbers: inside a big marker, else to its right; never overlapping another label
  const boxes = [];
  g.font = '600 ' + (phone ? 10 : 11) + 'px ' + H.MONO;
  for (const l of labels.sort((a2, b2) => b2.r - a2.r)) {
    const w = g.measureText(l.s).width + 4, h = 12, cx = l.inside || textOnly ? l.x : l.x + l.r + 3 + w / 2, bx = { x0: cx - w / 2, x1: cx + w / 2, y0: l.y - h / 2, y1: l.y + h / 2 };
    if (boxes.some((o) => bx.x0 < o.x1 && bx.x1 > o.x0 && bx.y0 < o.y1 && bx.y1 > o.y0)) continue;
    boxes.push(bx); g.fillStyle = txt; g.fillText(l.s, cx, l.y);
  }
  g.restore();
  hits.set(canvas, { shown, tick, top: a.bounds.top });
  if (typeof window !== 'undefined') window.__stkBigShown = () => ({ n: shown.length, d: shown.map((m) => ({ x: m.x, y: m.y, r: m.r, c: canvas.getBoundingClientRect().left, t: canvas.getBoundingClientRect().top })) });   // test hook
}

// Hover / tap tooltip for the markers drawn on `canvas` (one shared little box). The layer canvas is below the chart's own handlers, so
// we listen on its parent and hit-test the last drawn markers.
let tipEl = null, tipOn = false;
const tipCanvases = new Set();
function tipMove(e) {   // one document listener for every Big Trades canvas (two indicators can be on one chart)
  let best = null, bd = 1e9, tick = 1;
  for (const canvas of tipCanvases) {
    const h = hits.get(canvas); if (!h || !h.shown.length || !canvas.isConnected) continue;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) continue;
    for (const m of h.shown) { const d = Math.hypot(m.x - x, m.y - y); if (d <= m.r + 4 && d < bd) { bd = d; best = m; tick = h.tick; } }
  }
  if (!best) { if (tipEl) tipEl.hidden = true; return; }
  const h = { tick };
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'stk-bigtip'; tipEl.setAttribute('role', 'tooltip'); tipEl.style.cssText = 'position:fixed;z-index:60;min-width:170px;max-width:240px;padding:10px 12px;border-radius:12px;font:12px/1.5 system-ui,sans-serif;pointer-events:none;background:rgba(17,17,20,.96);color:#f5f5f5;border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 20px rgba(0,0,0,.4)'; document.body.appendChild(tipEl); }
    tipEl.replaceChildren(...tipRows(best.p, h.tick).map((t, i) => { const d = document.createElement('div'); d.textContent = t; if (i === 0) d.style.cssText = 'font-weight:700;margin-bottom:2px;color:' + (best.p.side ? '#4fe3ac' : '#ff8a94'); else if (i === 4) d.style.opacity = '.7'; return d; }));
    tipEl.hidden = false;
    tipEl.style.left = clamp(e.clientX + 12, 4, innerWidth - 250) + 'px'; tipEl.style.top = clamp(e.clientY + 12, 4, innerHeight - 130) + 'px';
}
export function installTip(canvas) {
  if (!canvas) return;
  tipCanvases.add(canvas);
  if (tipOn) return; tipOn = true;
  // the chart's own overlay sits above this canvas, so listen on the document (capture) and hit-test by position
  document.addEventListener('pointermove', tipMove, true); document.addEventListener('pointerdown', tipMove, true);
}
