// TradeZoro — "IV Rank" chart indicator (stk_ivrank): lower pane, 30-day IV with its 1-year rank band. ES module.
// Stream 4 of the ZoroOptions build (spec section 3, item 6). Behind the page flag (chart-zoro-data.js zoroOn()).
//
// DATA: /api/zo/summary?u=SYM -> iv: { rank, pct, iv30, t:[epoch s], v:[iv30 %] }  (daily + intraday iv30 record; indices use VIX/VXN/RVX/GVZ/OVX).
// DRAWS: the iv30 line (step: each bar shows the last value recorded at or before it), the 1-year low and high as dashed lines,
//   and a small table "IV rank 34 · percentile 41 · 30-day IV 17.8%". Futures use the underlying's IV (ES -> SPX, RTY -> IWM ...).
// BAR REPLAY / NO LOOKAHEAD: a bar only ever sees values with t <= the bar's own time, and in replay the rank, percentile and the
//   1-year band are recomputed from the values up to the replay clock (never the current rank). ivAt() / rankFrom() are pure.
// Wording: "updated X min ago" only. Education only. Not financial advice.
import * as ZD from './chart-zoro-data.js?v=909';
import * as ProGate from './chart-pro-gate.js?v=909';

export const IVRANK_TYPE = 'stk_ivrank';
export const IVRANK_DESC = '30-day implied volatility in a lower pane with its 1-year low and high, plus IV rank and percentile. SPX, SPY, QQQ, IWM, GLD, USO and ES, NQ, RTY, GC, CL (from the underlying).';
const YEAR_S = 365 * 86400;
const SCHEMA = [
  { key: 'lineColor', title: 'IV line colour', type: 'color', defval: '#8b7cf6' },
  { key: 'bandColor', title: '1-year band colour', type: 'color', defval: '#f59e0b' },
  { key: 'lineWidth', title: 'Line width', type: 'number', defval: 2, min: 1, max: 4 },
  { key: 'showBand', title: '1-year low / high lines', type: 'bool', defval: true },
  { key: 'showStatus', title: 'Status', type: 'bool', defval: true }
];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- pure --------------------------------------------------------------------------------------
// t ascending (epoch s), v same length. Last index with t <= ts, else -1.
export function idxAt(t, ts) {
  let lo = 0, hi = t.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (t[m] <= ts) { best = m; lo = m + 1; } else hi = m - 1; }
  return best;
}
// Rank / percentile / band for the value at index i, using only values in (t[i] - 1 year, t[i]].
export function rankFrom(t, v, i) {
  if (i < 0 || !isNum(v[i])) return null;
  const from = t[i] - YEAR_S;
  let lo = Infinity, hi = -Infinity, n = 0, below = 0;
  for (let j = i; j >= 0 && t[j] > from; j--) {
    if (!isNum(v[j])) continue;
    n++; if (v[j] < lo) lo = v[j]; if (v[j] > hi) hi = v[j]; if (v[j] < v[i]) below++;
  }
  if (n < 2 || !(hi > lo)) return null;
  return { lo, hi, iv: v[i], rank: Math.round(100 * (v[i] - lo) / (hi - lo)), pct: Math.round(100 * below / n), n };
}
// One value per bar: the last record at or before the bar's time (a bar before the first record gets null).
// `until` (epoch s) cuts the series: nothing after it is used (replay clock).
export function perBar(t, v, bars, until) {
  const n = until == null ? t.length : idxAt(t, until) + 1;
  const tt = t.slice(0, n);
  return bars.map((b) => { const i = idxAt(tt, Math.floor(b.time / 1000)); return i >= 0 && isNum(v[i]) ? v[i] : null; });
}

// ---- native ------------------------------------------------------------------------------------
function msgTable(id, text) {
  const day = ZD.lightTheme();
  return { id, paneId: '', position: 'bottom_center', columns: 1, rows: 1, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)', frameWidth: 0, borderWidth: 0,
    cells: [[{ text, textColor: day ? '#334155' : '#a3a9b6', hAlign: 'center', vAlign: 'center', textSize: 'small', fontFamily: 'monospace', bold: false, italic: false }]], merges: [] };
}
class IvNative {
  constructor() { this.inputs = {}; this.ctx = null; this.sig = ''; }
  defaults() { return Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(this.defaults(), inputs); ZD.zoWatch(this); ProGate.tier().then(() => this.load()); this.load(); }
  wants() {
    if (!this.ctx || ProGate.isFree()) return [];
    const s = ZD.srcOfCtx(this.ctx);
    return s ? [{ kind: 'iv', u: s.u, x: '' }] : [];
  }
  load() { this.render(); ZD.zoLoad(this); }
  refresh() { this.render(); }
  onBars() { const s = String(this.ctx && this.ctx.symbol) + '|' + (ZD.replayNowS() || ''); if (s !== this.lastSym) { this.lastSym = s; this.load(); } else this.render(); }
  onViewport() {}
  setInputs(i) { this.inputs = Object.assign(this.defaults(), i); this.sig = ''; this.render(); }
  suspend() {}
  resume() { this.sig = ''; this.load(); }
  stop() { ZD.zoUnwatch(this); try { this.ctx.emit({ series: [], tables: [] }); } catch (e) {} }
  note(text) {
    const k = 'n|' + text;
    if (k === this.sig) return;
    this.sig = k;
    this.ctx.setStatus('idle');
    const nul = (this.ctx.bars() || []).map((b) => ({ time: b.time, value: null }));
    this.ctx.emit({ series: [{ id: 'ivr-iv', title: '30-day IV', paneId: '', kind: 'line', points: nul, style: { color: this.inputs.lineColor, width: 2, lineStyle: 'solid' } }], tables: [msgTable('ivr-msg', text)] });
  }
  render() {
    if (!this.ctx) return;
    const I = this.inputs, ctx = this.ctx, src = ZD.srcOfCtx(ctx);
    if (!ZD.zoroOn() || !src) return this.note('IV Rank: SPX, SPY, QQQ, IWM, GLD, USO, ES, NQ, RTY, GC, CL and top stocks');
    if (ProGate.isFree()) return this.note('IV Rank is part of Pro');
    const zs = ZD.zsum(ZD.zoCached('iv', src.u, ''));
    if (!zs) return this.note('Loading IV Rank…');
    const t = zs.iv.t, v = zs.iv.v;
    if (t.length < 2 || t.length !== v.length) return this.note('No IV history for ' + src.root + ' yet');
    const until = ZD.replayNowS();
    const bars = ctx.bars() || [];
    const pts = perBar(t, v, bars, until).map((x, i) => ({ time: bars[i].time, value: x }));
    // headline number: now (rank from the summary), or as of the replay clock (recomputed from older values only)
    const last = until == null ? t.length - 1 : idxAt(t, until);
    const rk = rankFrom(t, v, last);
    if (!rk) return this.note(until == null ? 'Not enough IV history for ' + src.root + ' yet' : 'No IV history for this time');
    const rank = until == null && isNum(zs.iv.rank) ? Math.round(zs.iv.rank) : rk.rank;
    const pct = until == null && isNum(zs.iv.pct) ? Math.round(zs.iv.pct) : rk.pct;
    const when = until == null ? ZD.agoText(zs.t || t[t.length - 1]) : 'as of replay time';
    const status = 'IV rank ' + rank + ' · pct ' + pct + ' · IV30 ' + rk.iv.toFixed(1) + '% · ' + src.u + ' · ' + when.replace('updated ', '');
    const sig = ['d', src.u, bars.length, bars.length ? bars[0].time + '|' + bars[bars.length - 1].time : '', last, status, JSON.stringify(I)].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    ctx.setStatus('idle');
    const w = Math.min(4, Math.max(1, Number(I.lineWidth) || 2));
    const lines = I.showBand === false ? [] : [
      { id: 'ivr-hi', paneId: '', price: rk.hi, color: ZD.hexA(I.bandColor, 0.8), lineStyle: 'dashed', width: 1, title: '1y high ' + rk.hi.toFixed(1) },
      { id: 'ivr-lo', paneId: '', price: rk.lo, color: ZD.hexA(I.bandColor, 0.8), lineStyle: 'dashed', width: 1, title: '1y low ' + rk.lo.toFixed(1) }];
    try { window.__stkIvRank = { u: src.u, rank, pct, iv: rk.iv, lo: rk.lo, hi: rk.hi, n: pts.filter((p) => p.value != null).length, until }; } catch (e) {}   // test hook
    ctx.emit({ series: [{ id: 'ivr-iv', title: '30-day IV', paneId: '', kind: 'line', points: pts, style: { color: I.lineColor, width: w, lineStyle: 'solid' } }],
      priceLines: lines, tables: I.showStatus === false ? [] : [msgTable('ivr-msg', status)] });
  }
}

let installed = false;
export function installIvRank(Core) {
  if (installed || !ZD.zoroOn()) return;
  installed = true;
  Core.registerNativeIndicator({
    type: IVRANK_TYPE, title: 'IV Rank (30-day IV with 1-year band)', shortTitle: 'IV Rank', paneHint: 'new', overlay: false,
    inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new IvNative()
  });
  ZD.persist(Core, 'stryker.ivrank', IVRANK_TYPE, SCHEMA, 1);
}
