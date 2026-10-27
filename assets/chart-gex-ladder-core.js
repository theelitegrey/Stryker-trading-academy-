// TradeZoro — GEX Ladder core (pure functions, no DOM, no network) — ES module
// Owner order 2026-10-16 ("build all 4": GEX Ladder panel, ranked top-10 strikes with role tags,
// previous days' big levels, Fit price / Latest). Our own design.
//
// Depends on: nothing. Used by assets/chart-gex-levels.js (ranked strikes + previous-day lines),
// assets/chart-gex-ladder.js (the ladder panel) and tools/tests/chart-gex-ladder.test.mjs.
//
// UNITS: ladder values are net GEX in dollars per 1% move, as the public GEX API publishes them
// (data.ladder[].gex). The recorded history stores the same figure in $M (snap.g), so
// ladderFromSnap() multiplies by 1e6.
//
// ROLES (plain words, education only; they describe where dealer hedging may lean, not a signal):
//   Magnet      the largest |GEX| strike near price (within NEAR_PCT of spot)
//   Support     big positive GEX below price
//   Resistance  big positive GEX above price
//   Accelerant  big negative GEX (price can speed through it)
//   Flip        the zero-gamma level
// Education only. Not financial advice.

export const NEAR_PCT = 0.01;       // "near price" for the magnet: within 1% of spot
export const TOP_N = 10;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// "+$185.1M", "−$170.0M", "+$1.24B", "−$89.5K" (true minus sign). sign=false drops the sign.
export function fmtMoney(v, sign) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '\u2212' : (sign === false ? '' : '+');
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1) + 'K';
  return s + '$' + Math.round(a);
}
// "10/15 · $1.6B" (no sign: the line colour carries the sign)
export function dayTag(day, g) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(day || ''));
  const md = m ? parseInt(m[1], 10) + '/' + parseInt(m[2], 10) : String(day || '');
  const a = Math.abs(g);
  const t = a >= 1e9 ? '$' + (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B' : a >= 1e6 ? '$' + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : '$' + Math.round(a / 1e3) + 'K';
  return md + ' \u00b7 ' + t;
}

// API response -> [{ k, g }] strikes high to low (finite values only)
export function ladderFromApi(data) {
  const L = data && Array.isArray(data.ladder) ? data.ladder : [];
  return L.filter((x) => x && isNum(x.strike) && isNum(x.gex)).map((x) => ({ k: x.strike, g: x.gex })).sort((a, b) => b.k - a.k);
}
// history snapshot { k: [strikes], g: [$M] } -> the same shape
export function ladderFromSnap(snap) {
  if (!snap || !Array.isArray(snap.k) || !Array.isArray(snap.g)) return [];
  const out = [];
  for (let i = 0; i < snap.k.length; i++) if (isNum(snap.k[i]) && isNum(snap.g[i])) out.push({ k: snap.k[i], g: snap.g[i] * 1e6 });
  return out.sort((a, b) => b.k - a.k);
}

// ONE colour scale for every column: the biggest |GEX| of any of them.
export function sharedScale(columns) {
  let m = 0;
  for (const rows of columns) for (const r of rows || []) if (isNum(r.g)) m = Math.max(m, Math.abs(r.g));
  return m || 1;
}
// 0..1 strength for one value on that scale (a power < 1 keeps mid-sized strikes visible)
export function strength(g, vmax) {
  if (!isNum(g) || !(vmax > 0)) return 0;
  return Math.pow(Math.min(1, Math.abs(g) / vmax), 0.6);
}
// index of the single biggest |GEX| row (first on ties), -1 when empty
export function biggestIndex(rows) {
  let bi = -1, bv = 0;
  (rows || []).forEach((r, i) => { const a = Math.abs(r.g); if (isNum(r.g) && a > bv) { bv = a; bi = i; } });
  return bi;
}
// index of the row nearest to spot (rows high to low), -1 when empty
export function spotIndex(rows, spot) {
  let bi = -1, bd = Infinity;
  (rows || []).forEach((r, i) => { const d = Math.abs(r.k - spot); if (d < bd) { bd = d; bi = i; } });
  return bi;
}
// Magnet: the largest |GEX| strike within NEAR_PCT of spot (else the largest overall).
export function magnet(rows, spot, nearPct) {
  const band = (nearPct == null ? NEAR_PCT : nearPct) * spot;
  let best = null;
  for (const r of rows || []) {
    if (!isNum(r.g) || !isNum(r.k) || Math.abs(r.k - spot) > band) continue;
    if (!best || Math.abs(r.g) > Math.abs(best.g)) best = r;
  }
  if (!best) { const i = biggestIndex(rows); best = i >= 0 ? rows[i] : null; }
  return best ? { strike: best.k, g: best.g, pct: isNum(spot) && spot > 0 ? (best.k - spot) / spot * 100 : null } : null;
}
export function netTotal(rows) { let s = 0; for (const r of rows || []) if (isNum(r.g)) s += r.g; return s; }

export function roleOf(g, strike, spot) {
  if (g < 0) return 'Accelerant';
  return strike < spot ? 'Support' : 'Resistance';
}
// The top n strikes by |GEX|, ranked 1..n, with a plain role. The magnet (largest |GEX| near
// price) takes the "Magnet" role whatever its sign. share = |GEX| / the biggest of the ranked.
export function rankStrikes(rows, spot, n) {
  n = n || TOP_N;
  const top = (rows || []).filter((r) => isNum(r.g) && isNum(r.k) && r.g !== 0)
    .sort((a, b) => Math.abs(b.g) - Math.abs(a.g) || a.k - b.k).slice(0, n);
  if (!top.length) return [];
  const mx = Math.abs(top[0].g), mag = magnet(top, spot);
  const out = top.map((r, i) => ({ rank: i + 1, strike: r.k, g: r.g, share: mx ? Math.abs(r.g) / mx : 0, role: roleOf(r.g, r.k, spot) }));
  if (mag && isNum(mag.pct) && Math.abs(mag.pct) <= NEAR_PCT * 100 + 1e-9) {
    const m = out.find((x) => x.strike === mag.strike);
    if (m) m.role = 'Magnet';
  }
  return out;
}

// ---- previous days ----------------------------------------------------------------------------
// Sessions (newest first, [{ day: 'YYYY-MM-DD' }, ...] from the history store) to use as "previous
// days" at time nowSec: only days STRICTLY BEFORE the Eastern-time day of nowSec, so bar replay
// never sees the replay day itself or anything after it. etDay(sec) -> 'YYYY-MM-DD'.
export function previousDays(sessions, nowSec, count, etDay) {
  const n = Math.max(0, Math.min(5, Math.floor(count)));
  if (!n || !Array.isArray(sessions)) return [];
  const today = etDay(nowSec);
  const days = [...new Set(sessions.map((s) => s && s.day).filter((d) => typeof d === 'string' && d < today))].sort().reverse();
  return days.slice(0, n);
}
// One session's big strikes: each strike's peak |GEX| across the session's snapshots (signed),
// then the top `top` strikes. rows = unpacked snapshots of ONE day [{ k:[], g:[$M] }].
export function dayTop(rows, top) {
  const peak = new Map();
  for (const r of rows || []) {
    if (!r || !Array.isArray(r.k)) continue;
    for (let i = 0; i < r.k.length; i++) {
      const g = r.g[i] * 1e6;
      if (!isNum(g) || !isNum(r.k[i])) continue;
      const p = peak.get(r.k[i]);
      if (p === undefined || Math.abs(g) > Math.abs(p)) peak.set(r.k[i], g);
    }
  }
  return [...peak.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0] - b[0]).slice(0, top || 2).map(([k, g]) => ({ strike: k, g }));
}

// ---- dense ladder helpers (Owner order 2026-10-16: denser rows, one colour scale, per-second refresh) ----
// Cell colour on the ONE shared scale: small = dark muted blue, big positive = green, big negative =
// purple/magenta. s = strength(g, vmax) in 0..1. Returns 'rgb(r,g,b)'.
const POS_STOPS = [[30, 50, 92], [26, 104, 122], [30, 158, 96]];
const NEG_STOPS = [[36, 48, 96], [98, 50, 148], [196, 34, 98]];
export const MAX_FILL = 'rgb(236,196,48)';      // the single biggest |GEX| cell of a column: bright yellow
export function cellColor(g, s) {
  const st = g < 0 ? NEG_STOPS : POS_STOPS, t = Math.max(0, Math.min(1, s || 0)) * 2, i = t >= 2 ? 1 : Math.floor(t), f = t - i;
  const a = st[i], b = st[i + 1] || st[i];
  return 'rgb(' + [0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * f)).join(',') + ')';
}
// "updated 12s ago" / "updated 3 min ago" (never "live" / "real-time" / "delayed")
export function updatedText(tsSec, nowMs) {
  if (!isNum(tsSec)) return 'GEX updated time unknown';
  const sec = Math.max(0, Math.floor((nowMs == null ? Date.now() : nowMs) / 1000 - tsSec));
  if (sec < 90) return 'GEX updated ' + sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 120) return 'GEX updated ' + min + ' min ago';
  const h = Math.floor(min / 60);
  return h < 48 ? 'GEX updated ' + h + ' h ago' : 'GEX updated ' + Math.floor(h / 24) + ' days ago';
}
// Where the spot sits in a strikes-high-to-low list, as a fractional row position: 0 = centre of row 0,
// 1 = centre of row 1 ... (clamped to the list). -1 when empty.
export function spotPos(rows, spot) {
  const n = (rows || []).length;
  if (!n || !isNum(spot)) return -1;
  if (spot >= rows[0].k) return 0;
  if (spot <= rows[n - 1].k) return n - 1;
  for (let i = 0; i < n - 1; i++) if (rows[i].k >= spot && spot > rows[i + 1].k) return i + (rows[i].k - spot) / (rows[i].k - rows[i + 1].k);
  return n - 1;
}

// ---- KEY LEVELS (Owner order 2026-10-16: max pain, spot, flip, walls, expected move, put/call, IV, regime) ----
// Max pain: the strike where the total payout to option holders at expiry is smallest.
//   payout(S) = sum over calls of OI x max(S - K, 0) + sum over puts of OI x max(K - S, 0), tried at every listed strike.
// contracts: [{ strike, cp: 'C'|'P', oi }] of ONE expiry. Ties go to the strike nearest `spot` (or the lower one).
// Used by the Pages engine (functions/api/gex/_engine.js) on the Cboe open interest, and by the unit test.
export function maxPain(contracts, spot) {
  const rows = (contracts || []).filter((c) => c && isNum(c.strike) && isNum(c.oi) && c.oi > 0 && (c.cp === 'C' || c.cp === 'P'));
  if (!rows.length) return null;
  const ks = [...new Set(rows.map((c) => c.strike))].sort((a, b) => a - b);
  let best = null, bv = Infinity;
  for (const s of ks) {
    let pay = 0;
    for (const c of rows) pay += c.oi * (c.cp === 'C' ? Math.max(s - c.strike, 0) : Math.max(c.strike - s, 0));
    const closer = best != null && isNum(spot) && pay === bv && Math.abs(s - spot) < Math.abs(best - spot);
    if (pay < bv || closer) { bv = pay; best = s; }
  }
  return best;
}
export function regimeOf(net) {
  if (!isNum(net)) return null;
  return net >= 0 ? { id: 'pos', text: 'Positive gamma (calmer)', tip: 'Net GEX is positive at the current price: dealer hedging tends to dampen moves, so price is often calmer.' }
    : { id: 'neg', text: 'Negative gamma (bigger moves)', tip: 'Net GEX is negative at the current price: dealer hedging can add to moves, so swings can be bigger.' };
}
const pctFrom = (v, spot) => (isNum(v) && isNum(spot) && spot > 0 ? (v - spot) / spot * 100 : null);
export const fmtPct = (p) => (p == null ? '' : (p >= 0 ? '+' : '\u2212') + Math.abs(p).toFixed(1) + '%');
const EM_KEY = { 0: '0DTE', 1: '1DTE', 7: 'Weekly', 30: 'Monthly' };
// The levels of one column. data = the ladder/levels JSON (spot, call_wall, put_wall, zero_gamma, max_pain, net_gex),
// mg = magnet {strike}, opt = /opt-analytics reply or null. Returns { chips: [...], tags: [{ id, price, short, faint }], regime, nums }.
// chip = { id, label, value, price?, pct?, tip }.   Education only. Not financial advice.
export function keyLevels(data, spot, mg, opt, dte) {
  if (!data || !isNum(spot)) return null;
  const chips = [], tags = [];
  const add = (id, label, short, price, tip, extra) => {
    if (!isNum(price)) return;
    const p = pctFrom(price, spot);
    chips.push({ id, label, price, pct: p, tip });
    tags.push(Object.assign({ id, short, price }, extra || {}));
  };
  add('mp', 'Max Pain', 'MP', data.max_pain, 'Max Pain: the price where most option buyers lose; price is often pulled toward it near expiry.');
  add('flip', 'Flip', 'FLIP', data.zero_gamma, 'Zero Gamma / Flip: the price where net GEX crosses zero. Above it dealer hedging tends to calm moves, below it can add to them.');
  add('cw', 'Call Wall', 'CW', data.call_wall, 'Call Wall: the strike above price with the biggest call gamma, from all expiries up to about 30 days (not only today). It can act like a ceiling.');
  add('pw', 'Put Wall', 'PW', data.put_wall, 'Put Wall: the strike below price with the biggest put gamma, from all expiries up to about 30 days (not only today). It can act like a floor.');
  if (mg && isNum(mg.strike)) add('mag', 'Magnet', 'MAG', mg.strike, 'Magnet: the largest |GEX| strike near price. Price is often drawn toward it.');
  const k = EM_KEY[dte == null ? 0 : dte];
  const em = opt && Array.isArray(opt.em) ? opt.em.find((e) => e.k === k) : null;
  let emRange = null;
  if (em && isNum(em.lo) && isNum(em.hi)) {
    emRange = { lo: em.lo, hi: em.hi, em: em.em, pct: em.pct, iv: em.iv };
    chips.push({ id: 'em', label: 'Exp. move', value: '\u00b1' + (isNum(em.em) ? em.em.toFixed(em.em >= 100 ? 0 : 2) : '') + (isNum(em.pct) ? ' (' + em.pct.toFixed(2) + '%)' : ''), price: null, pct: null,
      tip: 'Expected Move: the range the options market prices for this expiry (about one standard deviation, from the at-the-money straddle). Not a forecast.' });
    tags.push({ id: 'emlo', short: 'EM\u2193', price: em.lo, faint: true }, { id: 'emhi', short: 'EM\u2191', price: em.hi, faint: true });
  }
  const pc = opt && opt.pc, first = dte === 0 || dte === 1;
  const pcOi = pc ? (first && isNum(pc.oi_first) ? pc.oi_first : pc.oi) : null, pcVol = pc ? (first && isNum(pc.vol_first) ? pc.vol_first : pc.vol) : null;
  if (isNum(pcOi)) chips.push({ id: 'pcoi', label: 'P/C OI', value: pcOi.toFixed(2), tip: 'Put/Call ratio by open interest: puts divided by calls. Above 1 means more puts are open than calls.' });
  if (isNum(pcVol)) chips.push({ id: 'pcvol', label: 'P/C Vol', value: pcVol.toFixed(2), tip: 'Put/Call ratio by volume today: puts traded divided by calls traded.' });
  const iv = em && isNum(em.iv) ? em.iv : (opt && isNum(opt.atm30) ? opt.atm30 : null);
  if (isNum(iv)) chips.push({ id: 'iv', label: 'ATM IV', value: (iv * 100).toFixed(1) + '%', tip: 'At-the-money implied volatility: how big a move the options market is pricing, as a yearly percentage.' });
  return { chips, tags, regime: regimeOf(data.net_gex), emRange };
}
// Index of the row whose strike is nearest to `price` (rows high to low), -1 when empty or price is more than one
// row spacing outside the list.
export function rowNearest(rows, price) {
  const n = (rows || []).length;
  if (!n || !isNum(price)) return -1;
  const step = n > 1 ? Math.abs(rows[0].k - rows[n - 1].k) / (n - 1) : 1;
  if (price > rows[0].k + step || price < rows[n - 1].k - step) return -1;
  let bi = 0, bd = Infinity;
  rows.forEach((r, i) => { const d = Math.abs(r.k - price); if (d < bd) { bd = d; bi = i; } });
  return bi;
}
