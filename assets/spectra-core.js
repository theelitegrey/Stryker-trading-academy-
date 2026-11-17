// TradeZoro — Spectra core (pure functions, no DOM, no network) — ES module. Owner order 2026-11-17 (roadmap card "spectra").
// Spectra is a strike x expiry board of net dealer exposure: rows = strikes around spot, columns = the next expiries.
// DATA: GET /api/zo/board?u=<SPX|SPY|QQQ|GLD>&vs=<seconds> (book-recorder Worker, src/zoro.js; built by the options feeder
//   workers/book-recorder/zoro-feeder/zoro_feeder.py board_payload from the Cboe chain about every 2 minutes):
//   { t, spot, step, k:[strike...], x:[expiry...], tag:['0DTE'|'1DTE'|'Weekly'|'Monthly'|''...],
//     gex:[[$M per 1% move, one per strike] per expiry], vex:[[$M per vol point] per expiry], fut:{root, ratio}|null,
//     prev:{t, x, k, gex, vex}|null (the board `vs` seconds earlier, for the velocity view) }
//   Sign convention as the rest of Omega: calls +, puts - (dealer exposure as the GEX engine publishes it).
// Words: "Apex" = the single biggest |exposure| cell; "Floor" / "Ceiling" = the biggest cell below / above spot.
// Used by assets/spectra-board.js and tools/tests/spectra.test.mjs. Education only. Not financial advice.

export const TICKERS = [['SPX', 'S&P 500 index'], ['SPY', 'S&P 500 ETF'], ['QQQ', 'Nasdaq 100 ETF'], ['GLD', 'Gold ETF']];
export const TRIO = ['SPX', 'SPY', 'QQQ'];
export const VIEWS = { gex: { key: 'gex', short: 'GEX', name: 'Gamma exposure', unit: 'per 1% move', note: 'Gamma: where hedging may lean today.' },
  vex: { key: 'vex', short: 'VEX', name: 'Vanna exposure', unit: 'per vol point', note: 'Vanna: how hedging may shift as volatility moves, over several days.' } };
export const WINDOWS = [[60, '1m'], [300, '5m'], [900, '15m'], [3600, '1h'], [86400, '1d']];
// futures chart roots -> the market Spectra opens on (the GEX Ladder mapping)
export const FUT_MAP = { ES: 'SPX', MES: 'SPX', NQ: 'QQQ', MNQ: 'QQQ', GC: 'GLD', MGC: 'GLD' };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// chart symbol -> Spectra ticker (null when Spectra has no board for it). 'CME_MINI:NQ1!', 'futures:MNQZ6', 'NQ1!', 'QQQ', 'SPXW'.
export function tickerFor(sym) {
  let t = String(sym || '').trim().toUpperCase();
  const m = /^[A-Z_]+:(.+)$/.exec(t); if (m) t = m[1];
  t = t.replace(/^\^/, '').replace(/[0-9]?!$/, '');
  if (t === 'SPXW') return 'SPX';
  if (TICKERS.some(([u]) => u === t)) return t;
  const root = /^([A-Z]{2,3}?)[FGHJKMNQUVXZ]\d{1,2}$/.exec(t);   // dated contract: MNQZ6, ESH27
  if (root && FUT_MAP[root[1]]) return FUT_MAP[root[1]];
  return FUT_MAP[t] || null;
}

// API body -> board model or null. view: 'gex' | 'vex'. Rows high to low (as a price axis); cells in dollars.
export function boardModel(b, view) {
  if (!b || !Array.isArray(b.k) || !Array.isArray(b.x) || !b.k.length || !b.x.length) return null;
  const v = view === 'vex' ? 'vex' : 'gex';
  const grid = b[v];
  if (!Array.isArray(grid) || grid.length !== b.x.length) return null;
  const order = b.k.map((k, i) => i).sort((i, j) => b.k[j] - b.k[i]);
  const rows = order.map((i) => ({ k: b.k[i], cells: b.x.map((x, c) => { const m = (grid[c] || [])[i]; return isNum(m) ? m * 1e6 : 0; }) }));
  const cols = b.x.map((x, c) => ({ x, tag: (b.tag || [])[c] || '', label: colLabel(x, (b.tag || [])[c]) }));
  return { view: v, spot: isNum(b.spot) ? b.spot : null, step: isNum(b.step) ? b.step : null, t: isNum(b.t) ? b.t : null, rows, cols };
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function colLabel(x, tag) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x || ''));
  const d = m ? MON[+m[2] - 1] + ' ' + (+m[3]) : String(x || '');
  return { date: d, tag: tag || '' };
}

// the single biggest |value| cell (first on ties, rows high to low then columns left to right); null when all zero
export function topNode(m) {
  let best = null;
  if (!m) return null;
  m.rows.forEach((r, ri) => r.cells.forEach((v, ci) => { if (Math.abs(v) > (best ? Math.abs(best.v) : 0)) best = { ri, ci, k: r.k, x: m.cols[ci].x, v }; }));
  return best;
}
// biggest |value| cell strictly below spot (floor) and strictly above spot (ceiling)
export function floorCeiling(m) {
  const out = { floor: null, ceiling: null };
  if (!m || !isNum(m.spot)) return out;
  m.rows.forEach((r, ri) => r.cells.forEach((v, ci) => {
    if (!v) return;
    const side = r.k < m.spot ? 'floor' : r.k > m.spot ? 'ceiling' : null;
    if (side && (!out[side] || Math.abs(v) > Math.abs(out[side].v))) out[side] = { ri, ci, k: r.k, x: m.cols[ci].x, v };
  }));
  return out;
}
// index of the row nearest spot (-1 when no spot)
export function spotRow(m) {
  if (!m || !isNum(m.spot) || !m.rows.length) return -1;
  let bi = 0;
  m.rows.forEach((r, i) => { if (Math.abs(r.k - m.spot) < Math.abs(m.rows[bi].k - m.spot)) bi = i; });
  return bi;
}
export function maxAbs(m) { let a = 0; if (m) for (const r of m.rows) for (const v of r.cells) a = Math.max(a, Math.abs(v)); return a || 1; }

// Velocity: per cell, growing / shrinking against the board `vs` seconds earlier (same strike + expiry).
// Returns a rows x cols array of { d: change in dollars, dir: 1 grow | -1 shrink | 0 flat | null no earlier value }.
// "Grow" = |value| got bigger by more than `minRel` of the earlier |value| AND by more than `minAbs` of the board's biggest cell.
export function velocity(m, prevBody, view, minRel = 0.05, minAbs = 0.01) {
  if (!m) return [];
  const pm = boardModel(prevBody, view);
  const by = new Map();
  if (pm) pm.rows.forEach((r) => r.cells.forEach((v, ci) => by.set(pm.cols[ci].x + '|' + r.k, v)));
  const floorAbs = maxAbs(m) * minAbs;
  return m.rows.map((r) => r.cells.map((v, ci) => {
    const key = m.cols[ci].x + '|' + r.k;
    if (!by.has(key)) return { d: null, dir: null };
    const p = by.get(key), d = v - p, ch = Math.abs(v) - Math.abs(p);
    const dir = Math.abs(ch) > Math.max(Math.abs(p) * minRel, floorAbs) ? Math.sign(ch) : 0;
    return { d, dir, pct: p ? ch / Math.abs(p) * 100 : null };
  }));
}

// Lean of one market: where its Apex sits against spot. 'up' | 'down' | 'flat' (Apex on the spot row) | null.
export function leanOf(m) {
  const tn = topNode(m), si = spotRow(m);
  if (!tn || si < 0) return null;
  if (tn.ri === si) return 'flat';
  return tn.k > m.spot ? 'up' : 'down';
}
// Agreement of several markets' leans: 'agree' (all the same), 'mixed' (a majority), 'disagree' (no majority), null (< 2 known).
export function agreement(leans) {
  const ls = (leans || []).filter(Boolean);
  if (ls.length < 2) return null;
  const n = {}; ls.forEach((l) => { n[l] = (n[l] || 0) + 1; });
  const top = Math.max(...Object.values(n));
  if (top === ls.length) return 'agree';
  return top * 2 > ls.length ? 'mixed' : 'disagree';
}
export const AGREE_TEXT = { agree: 'Agree', mixed: 'Mixed', disagree: 'Disagree' };

// colours: ONE scale per board. Positive = mint/green, negative = magenta/purple, small = near the background.
const STOPS = {
  dark: { pos: [[20, 27, 31], [16, 92, 74], [3, 201, 136]], neg: [[24, 23, 38], [92, 40, 132], [214, 51, 140]] },
  light: { pos: [[241, 244, 246], [150, 222, 196], [2, 160, 108]], neg: [[243, 241, 247], [214, 168, 226], [184, 30, 120]] }
};
export function strength(v, vmax) { return isNum(v) && vmax > 0 ? Math.pow(Math.min(1, Math.abs(v) / vmax), 0.55) : 0; }
export function cellColor(v, vmax, theme) {
  const st = (STOPS[theme] || STOPS.dark)[v < 0 ? 'neg' : 'pos'];
  const t = strength(v, vmax) * 2, i = t >= 2 ? 1 : Math.floor(t), f = t - i, a = st[i], b = st[i + 1] || st[i];
  return [0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * f));
}
// text colour with enough contrast on a cell colour (WCAG relative luminance)
export function inkOn(rgb) {
  const L = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = 0.2126 * L(rgb[0]) + 0.7152 * L(rgb[1]) + 0.0722 * L(rgb[2]);
  return lum > 0.36 ? '#07130e' : '#f2f5f8';
}

// "+$1.7B", "−$240M", "+$85K", "$0" (true minus sign)
export function fmtMoney(v) {
  if (!isNum(v)) return '\u2014';
  const a = Math.abs(v), s = v < 0 ? '\u2212' : v > 0 ? '+' : '';
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(0) + 'K';
  return a < 0.5 ? '$0' : s + '$' + Math.round(a);
}
export const fmtK = (k) => (Math.abs(k - Math.round(k)) < 1e-9 ? Math.round(k).toLocaleString('en-US') : String(+k.toFixed(2)));
export const fmtPct = (p) => (isNum(p) ? (p >= 0 ? '+' : '\u2212') + Math.abs(p).toFixed(2) + '%' : '');
// "Updated 45 s ago" / "Updated 3 min ago" (the options copy rule: only "updated")
export function updatedText(tSec, nowMs) {
  if (!isNum(tSec)) return 'Update time unknown';
  const s = Math.max(0, Math.round((nowMs == null ? Date.now() : nowMs) / 1000 - tSec));
  if (s < 90) return 'Updated ' + s + ' s ago';
  const min = Math.round(s / 60);
  if (min < 120) return 'Updated ' + min + ' min ago';
  const h = Math.round(min / 60);
  return h < 48 ? 'Updated ' + h + ' h ago' : 'Updated ' + Math.round(h / 24) + ' days ago';
}

// Alerts on a cell (right-click / long-press menu). Price alerts are normal chart price alerts (chartAlerts) on the mapped futures
// market, checked by our server; the node alert is an options alert (zoroAlerts type node_change), checked on each board update.
// near: the alert sits one board row (step) before the strike, on the side price comes from.
export function priceAlertFor(kind, strike, spot, step, conv) {
  if (!isNum(strike) || !isNum(spot)) return null;
  const toFut = typeof conv === 'function' ? conv : (v) => v;
  if (kind === 'touch') { const p = toFut(strike); return isNum(p) ? { cond: 'crossing', price: round2(p) } : null; }
  const d = isNum(step) && step > 0 ? step : Math.abs(strike) * 0.001;
  const up = strike > spot;
  const at = up ? strike - d : strike + d;
  const p = toFut(at);
  return isNum(p) ? { cond: up ? 'crossing_up' : 'crossing_down', price: round2(p), at } : null;
}
const round2 = (v) => Math.round(v * 100) / 100;
// node_change alert doc (no timestamps). dir 'grow' | 'shrink', pct > 0. base = the cell now, in $M (the engine compares |value|).
export function nodeAlertDoc(u, view, x, k, base, dir, pct) {
  const p = Number(pct);
  if (!TICKERS.some(([t]) => t === u) || !/^\d{4}-\d{2}-\d{2}$/.test(x) || !isNum(k) || !isNum(base) || !(p > 0 && p <= 1000)) return null;
  return { type: 'node_change', symbol: u, p: { k, x, view: view === 'vex' ? 'vex' : 'gex', dir: dir === 'shrink' ? 'shrink' : 'grow', pct: p, base: Math.round(base / 1e6 * 1e4) / 1e4 }, message: '', freq: 'once', active: true };
}
