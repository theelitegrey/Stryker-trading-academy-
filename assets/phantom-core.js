// TradeZoro Phantom: pure maths for the options money flow page (phantom.html) and the Charts panel (assets/chart-phantom.js).
// Tests: tools/tests/phantom-core.test.mjs. No DOM here.
//
// DATA (all estimates, nothing is a single trade): the recorder's /phantom/* routes, built by gex-feeder/phantom.py from the
// option chain snapshots we already pull once a minute. Per contract: new volume between two snapshots x the option price x 100
// = estimated premium for that minute; above the mid = bought (+), below = sold (-). /tide (ZoroTide) gives the session's
// per-minute totals with the underlying price.
// COPY RULES: say "estimated from options volume and quotes", "per minute", "Updated X min ago". Never trade / print / sweep /
// block / live / real-time / delayed for options.

export const PH_SYMS = ['SPX', 'SPY', 'QQQ', 'GLD'];
export const TIDE_SYMS = ['SPX', 'SPY', 'QQQ'];
export const BOARD_COLS = ['k', 'x', 's', 'c', 'v', 'oi', 'p', 'n', 'px', 'doi', 'pv'];
export const MOVE_COLS = ['t', 'k', 'dv', 'p', 'px', 'v', 'oi'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const OCC = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

// chart symbol -> Phantom underlying, or null. Futures: ES/MES -> SPX, NQ/MNQ -> QQQ, GC/MGC -> GLD.
export function phantomSource(symbol) {
  let t = String(symbol || '').split(':').pop().trim().toUpperCase();
  t = t.replace(/^\^/, '').replace(/[0-9]?!$/, '');
  const fut = /^(MES|ES|MNQ|NQ|MGC|GC)(?:[FGHJKMNQUVXZ]\d{1,2})?$/.exec(t);
  if (fut) return { ES: 'SPX', MES: 'SPX', NQ: 'QQQ', MNQ: 'QQQ', GC: 'GLD', MGC: 'GLD' }[fut[1]];
  if (t === 'SPXW') return 'SPX';
  return PH_SYMS.includes(t) ? t : null;
}

// 'SPXW261120C07000000' -> { root, exp: '2026-11-20', cp: 'C', strike: 7000 } or null
export function parseOcc(k) {
  const m = OCC.exec(String(k || ''));
  if (!m) return null;
  return { root: m[1], exp: '20' + m[2] + '-' + m[3] + '-' + m[4], cp: m[5], strike: +m[6] / 1000 };
}
// calendar days from `day` (YYYY-MM-DD) to `exp`
export function dte(exp, day) {
  const a = Date.parse(exp + 'T12:00:00Z'), b = Date.parse(day + 'T12:00:00Z');
  return isNum(a) && isNum(b) ? Math.round((a - b) / 864e5) : null;
}
export const volOi = (v, oi) => (isNum(v) && isNum(oi) && oi > 0 ? v / oi : (v > 0 ? Infinity : 0));

// "calls minus puts": a bought call adds, a bought put subtracts. n = net premium (+ bought, - sold) from the feeder.
export const netImpactOf = (tot) => (tot ? (tot.cn || 0) - (tot.pn || 0) : 0);

// /phantom/summary -> [{ u, net, cn, pn, cp, pp, t }] best first (only symbols that have data; never padded)
export function netImpact(summary) {
  const out = [];
  for (const u of PH_SYMS) {
    const x = summary && summary.u && summary.u[u];
    if (!x || !x.tot) continue;
    out.push({ u, net: netImpactOf(x.tot), cn: x.tot.cn || 0, pn: x.tot.pn || 0, cp: x.tot.cp || 0, pp: x.tot.pp || 0, t: x.t });
  }
  return out.sort((a, b) => b.net - a.net);
}

// board (gunzipped /phantom/board) -> row objects with parsed contract, Vol/OI and DTE
export function boardRows(b) {
  if (!b || !Array.isArray(b.rows)) return [];
  const cols = b.cols || BOARD_COLS, at = (name) => cols.indexOf(name);
  const I = { k: at('k'), x: at('x'), s: at('s'), c: at('c'), v: at('v'), oi: at('oi'), p: at('p'), n: at('n'), px: at('px'), doi: at('doi'), pv: at('pv') };
  return b.rows.map((r) => {
    const exp = b.exps[r[I.x]];
    return { k: r[I.k], exp, strike: r[I.s], cp: r[I.c], v: r[I.v], oi: r[I.oi], p: r[I.p], n: r[I.n], px: r[I.px], doi: r[I.doi], pv: r[I.pv],
      vo: volOi(r[I.v], r[I.oi]), dte: dte(exp, b.day) };
  });
}

// premium at or above this is in the day's top `pct`% of contracts that had premium
export function topCut(rows, pct) {
  const ps = rows.map((r) => r.p).filter((p) => p > 0).sort((a, b) => b - a);
  if (!ps.length) return Infinity;
  return ps[Math.max(0, Math.ceil(ps.length * pct / 100) - 1)];
}
// unusual: volume today above open interest (Vol/OI > 1, with some size so 3 lots on 1 OI do not count), or premium in the top pct%
export const MIN_UNUSUAL_VOL = 100;
export function flagsOf(r, cut) {
  return { vo: r.vo > 1 && r.v >= MIN_UNUSUAL_VOL, top: r.p > 0 && r.p >= cut };
}

// Strike Flow board: strikes (rows, high to low) x expiries (cols), premium for side 'C' | 'P' | 'all' (calls + puts) or
// 'net' (calls minus puts, signed). Keeps the `maxExp` nearest expiries with premium and the `maxStrikes` strikes with the most
// premium, then shows them in strike order. Each cell: { p, n, vo, flags, keys: [contract keys] }.
export function strikeGrid(rows, opts) {
  const o = Object.assign({ side: 'all', maxExp: 8, maxStrikes: 24, topPct: 5 }, opts);
  const cut = topCut(rows, o.topPct);
  const useRow = (r) => o.side === 'all' || o.side === 'net' || r.cp === o.side;
  const expP = new Map();
  for (const r of rows) if (useRow(r) && r.p > 0) expP.set(r.exp, (expP.get(r.exp) || 0) + r.p);
  const exps = [...expP.keys()].sort().slice(0, o.maxExp);
  const ex = new Set(exps), strikeP = new Map();
  for (const r of rows) if (ex.has(r.exp) && useRow(r) && r.p > 0) strikeP.set(r.strike, (strikeP.get(r.strike) || 0) + r.p);
  const strikes = [...strikeP.entries()].sort((a, b) => b[1] - a[1]).slice(0, o.maxStrikes).map((e) => e[0]).sort((a, b) => b - a);
  const si = new Map(strikes.map((s, i) => [s, i])), xi = new Map(exps.map((e, i) => [e, i]));
  const cells = strikes.map(() => exps.map(() => null));
  let max = 0;
  for (const r of rows) {
    if (!useRow(r) || !si.has(r.strike) || !xi.has(r.exp)) continue;
    const c = cells[si.get(r.strike)][xi.get(r.exp)] || (cells[si.get(r.strike)][xi.get(r.exp)] = { p: 0, n: 0, v: 0, oi: 0, vo: 0, flags: { vo: false, top: false }, keys: [] });
    const sign = r.cp === 'P' ? -1 : 1;
    c.p += o.side === 'net' ? sign * r.n : r.p;
    c.n += r.n; c.v += r.v; c.oi += r.oi; c.keys.push(r.k);
    const f = flagsOf(r, cut);
    c.flags.vo = c.flags.vo || f.vo; c.flags.top = c.flags.top || f.top;
    c.vo = Math.max(c.vo, isFinite(r.vo) ? r.vo : 0);
  }
  for (const row of cells) for (const c of row) if (c) max = Math.max(max, Math.abs(c.p));
  return { strikes, exps, cells, max, cut };
}
// heat 0..1 for a cell value against the grid max (square root so mid-size cells still show)
export const heat = (v, max) => (max > 0 && isNum(v) ? Math.min(1, Math.sqrt(Math.abs(v) / max)) : 0);

// Whale moves: the day's biggest per-minute premium jumps -> objects, filtered.
// f = { u?: sym (summary has several), side: 'all'|'C'|'P', maxDte: number|null, minPrem: number }
export function whaleRows(moves, cols, u, day) {
  const C = cols || MOVE_COLS, at = (n) => C.indexOf(n);
  return (moves || []).map((m) => {
    const c = parseOcc(m[at('k')]);
    if (!c) return null;
    const v = m[at('v')], oi = m[at('oi')];
    return { u, t: m[at('t')], k: m[at('k')], exp: c.exp, strike: c.strike, cp: c.cp, dv: m[at('dv')], p: m[at('p')], px: m[at('px')], v, oi, vo: volOi(v, oi), dte: dte(c.exp, day) };
  }).filter(Boolean);
}
export function filterWhales(list, f) {
  const o = Object.assign({ u: 'all', side: 'all', maxDte: null, minPrem: 0 }, f);
  return list.filter((w) => (o.u === 'all' || w.u === o.u) && (o.side === 'all' || w.cp === o.side) && (o.maxDte == null || (w.dte != null && w.dte <= o.maxDte)) && w.p >= (o.minPrem || 0))
    .sort((a, b) => b.p - a.p || a.t - b.t);
}
// all symbols of a summary -> one whale list
export function summaryWhales(summary) {
  const out = [];
  if (!summary || !summary.u) return out;
  for (const u of PH_SYMS) { const x = summary.u[u]; if (x) out.push(...whaleRows(x.moves, x.mcols, u, summary.day)); }
  return out;
}

// Drilldown: /phantom/contract reply + board row -> per contract { k, t[], dv[], p[], cumV[], total, oi, vo, next }
// next: the next session's OI change -> { doi, label } ("Position likely opened" when OI rose, "likely closed" when it fell).
export function drillSeries(reply, rowsByKey) {
  if (!reply || !Array.isArray(reply.k)) return [];
  return reply.k.map((k, i) => {
    const s = (reply.s && reply.s[i]) || [];
    const dv = s.map((x) => (x ? x[0] : 0)), p = s.map((x) => (x ? x[1] : 0));
    let run = 0; const cumV = dv.map((v) => (run += v));
    const row = rowsByKey && rowsByKey.get(k);
    const doi = reply.next && reply.next.doi ? reply.next.doi[i] : null;
    return { k, c: parseOcc(k), t: (reply.t || []).map((x) => x * 1000), dv, p, cumV, prem: p.reduce((a, b) => a + b, 0),
      v: row ? row.v : run, oi: row ? row.oi : null, vo: row ? row.vo : null,
      next: reply.next && isNum(doi) ? { day: reply.next.day, doi, label: oiLabel(doi) } : null };
  });
}
export function oiLabel(doi) {
  if (!isNum(doi)) return '';
  if (doi > 0) return 'Position likely opened';
  if (doi < 0) return 'Position likely closed';
  return 'No change in open interest';
}

// Market Tide: /tide day (columns) -> running net call / net put premium + price, times in ms
export function tideSeries(d) {
  if (!d || !Array.isArray(d.t)) return null;
  let a = 0, b = 0;
  const cn = [], pn = [];
  for (let i = 0; i < d.t.length; i++) { a += d.cn[i] || 0; b += d.pn[i] || 0; cn.push(a); pn.push(b); }
  return { day: d.day, t: d.t.map((x) => x * 1000), cn, pn, s: (d.s || []).slice(), last: d.t.length ? d.t[d.t.length - 1] : null };
}

// ---- formatting ----
export function usd(v, signed) {
  if (!isNum(v)) return '–';
  const a = Math.abs(v), s = v < 0 ? '−' : signed && v > 0 ? '+' : '';
  return s + '$' + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(0));
}
export const fmtStrike = (k) => (isNum(k) ? (Math.abs(k - Math.round(k)) < 0.005 ? Math.round(k).toLocaleString('en-US') : k.toFixed(2)) : '–');
export const fmtVo = (v) => (v === Infinity ? 'new' : isNum(v) ? (v >= 10 ? v.toFixed(0) : v.toFixed(2)) : '–');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtExp = (e) => (e ? MON[+e.slice(5, 7) - 1] + ' ' + +e.slice(8, 10) : '–');
export function fmtTime(ms) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)); } catch (e) { return ''; }
}
export function agoText(tSec, nowMs) {
  if (!isNum(tSec)) return '';
  const s = Math.max(0, Math.floor((nowMs || Date.now()) / 1000 - tSec));
  if (s < 60) return 'Updated ' + s + ' s ago';
  const m = Math.floor(s / 60);
  if (m < 60) return 'Updated ' + m + ' min ago';
  const h = Math.floor(m / 60);
  return h < 48 ? 'Updated ' + h + ' h ago' : 'Updated ' + Math.floor(h / 24) + ' days ago';
}
export const contractName = (c) => (c ? fmtExp(c.exp) + ' ' + fmtStrike(c.strike) + ' ' + (c.cp === 'C' ? 'call' : 'put') : '');
