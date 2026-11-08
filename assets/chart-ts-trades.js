// TradeZoro — Charts: Tick-stream twins of the order-flow indicators (Owner order 2026-11-02: "update the big trades indicator to use
// the new data feed, I want to check the difference with tick stream"; "what about delta?"). Pro (same l1Visible() gate as the
// futures L2 tools), for a side-by-side check of the two trade feeds on one chart:
//   stk_ts_big    "Big Trades (Tick-stream)"        same schema as stk_of_big, outline-only bubbles, other default colours
//   stk_ts_delta  "Delta (Tick-stream)"             same schema as stk_of_delta
//   stk_ts_cvd    "Cumulative Delta (Tick-stream)"  same schema as stk_of_cvd (session reset 18:00 New York)
// Data: the book-recorder Worker's GET /ts-trades (history, 48 h, 6 h a read, gaps back-filled from Tick-stream's REST archive by the
// Worker) + the hub's live {type:'ticks'} frames over the ONE /ts-live socket that chart-futures-l2.js already shares (acquire()).
// Every indicator also shows a "Feed compare" readout (last 60 min): InsightSentry order flow (chart-footprint.js flowFor) vs Tick-stream.
// Threshold: the auto size is the recorder's 99.5th percentile for the symbol (the same number the InsightSentry bubbles use), so the
// two indicators ask the same question; a print below the Worker's per-symbol floor was never stored.
// Education only. Not financial advice.
import { liveVisible as l1Visible, l2Root, L2_TYPES, L2_TICK, acquire, rootState } from './chart-futures-l2.js?v=919';
import { registerFeed } from './chart-feeds.js?v=919';
import { rtReady, rtHeaders } from './rt-access.js?v=919';
import { bigPrints, bigThreshold } from './chart-of-pro-data.js?v=919';
import { cvdCandles } from './chart-footprint-data.js?v=919';
import * as BT from './chart-bigtrades.js?v=919';
import { aggregateMins, compareFeeds, MERGE_MS } from './chart-ts-data.js?v=919';

export const TS_TYPES = ['stk_ts_big', 'stk_ts_delta', 'stk_ts_cvd'];
const RECORDER = 'https://book-recorder.theelitegrey.workers.dev';
const WIN = 6 * 3600000, KEEP = 48 * 3600000;
const TS_UP = '#22d3ee', TS_DN = '#ff9f1c';   // cyan / amber: not the green / purple of the standard tools
const isLocal = () => { try { return /^(127\.0\.0\.1|localhost)$/.test(location.hostname); } catch (e) { return false; } };
const testBase = () => (isLocal() && window.__stkL2Test && window.__stkL2Test.base) || '';

// ---------------------------------------------------------------------------------------------- per-root store
const stores = new Map();
function getStore(root) {
  let s = stores.get(root);
  if (!s) {
    s = { root, tick: L2_TICK[root] || 0.25, floor: 1, hist: new Map(), live: new Map(), trades: [], pending: [], at: 0, loading: true, started: false, wasDown: false,
      loadedFrom: Infinity, need: 0, err: '', v: 0, refs: 0, ls: new Set(), handle: null, gen: 0, pumping: false, mm: null, mmV: -1 };
    stores.set(root, s);
  }
  return s;
}
const bump = (s) => { s.v++; s.ls.forEach((f) => { try { f(); } catch (e) {} }); };
async function get(url) {
  const h = testBase() ? {} : (await rtReady(), rtHeaders());
  let r = await fetch(url, { headers: h, credentials: 'omit' });
  if (r.status === 429) { await new Promise((x) => setTimeout(x, 6000)); r = await fetch(url, { headers: h, credentials: 'omit' }); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
// walk back in 6 h reads (newest first) until s.need is covered; the Worker back-fills its gaps (x-ts-fill-left) so repeat while left > 0
async function pump(s) {
  if (s.pumping) return;
  s.pumping = true; const gen = s.gen;
  try {
    while (s.gen === gen && s.refs > 0) {
      const first = s.loadedFrom === Infinity, to = first ? Date.now() : s.loadedFrom - 1;
      const from = Math.max(s.need, to - WIN, Date.now() - KEEP);
      if (!first && !(to > from && s.need < s.loadedFrom)) break;
      let j = null;
      for (let k = 0; k < 12; k++) {
        j = await get((testBase() || RECORDER) + '/ts-trades?sym=' + s.root + '&from=' + from + '&to=' + to);
        if (s.gen !== gen) return;
        if (!(j.left > 0)) break;
      }
      if (first) { s.at = j.at || Date.now(); s.floor = j.floor || s.floor; s.trades = []; s.hist.clear(); }
      for (const x of j.delta || []) s.hist.set(x[0], { t: x[0], buy: x[1], sell: x[2], hi: x[3], lo: x[4] });
      s.trades = j.trades.concat(s.trades); s.err = '';
      s.loadedFrom = from;
      if (first) { s.loading = false; const p = s.pending; s.pending = []; for (const x of p) fold(s, x); }
      bump(s);
      if (from <= s.need || from <= Date.now() - KEEP) break;
    }
  } catch (e) { if (s.gen === gen) { s.err = 'L1 trades unavailable right now'; if (s.loading) { s.loading = false; s.at = 0; const p = s.pending; s.pending = []; for (const x of p) fold(s, x); } bump(s); } }
  finally { if (s.gen === gen) s.pumping = false; }
}
// a live trade (hub tick frame: [price, size, 1|-1, ts_ms]); history already holds everything up to s.at
function fold(s, x) {
  const [px, sz, side, ts] = x;
  if (!(ts > s.at) || !(sz > 0) || !side) return;
  const t = Math.floor(ts / 60000) * 60000;
  let c = s.live.get(t); if (!c) { c = { t, buy: 0, sell: 0, run: 0, hi: 0, lo: 0 }; s.live.set(t, c); }
  if (side > 0) c.buy += sz; else c.sell += sz;
  c.run += side * sz; if (c.run > c.hi) c.hi = c.run; if (c.run < c.lo) c.lo = c.run;
  // fills of one order arrive as separate ticks: merge same side + price within MERGE_MS, then apply the floor (same rule as the Worker's store)
  const o = s.open;
  if (o && o.side === side && o.px === px && ts - o.last <= MERGE_MS) { o.size += sz; o.last = ts; if (o.row) o.row[2] = o.size; }
  else s.open = { ts, last: ts, px, side, size: sz, row: null };
  const q = s.open;
  if (!q.row && q.size >= s.floor) { q.row = [q.ts, px, q.size, side]; s.trades.push(q.row); }
}
function onFrame(s, m) {
  const r = rootState(s.root);
  if (!m) {   // state change: first time live -> load; back live after a drop -> reload (ticks in the gap were not delivered)
    if (r.status !== 'live') { if (s.started) s.wasDown = true; return; }
    if (!s.started || s.wasDown) { s.started = true; s.wasDown = false; reset(s); pump(s); }
    return;
  }
  if (m.type === 'ticks' && m.symbol === s.root) {
    if (s.loading) { for (const x of m.t || []) s.pending.push(x); return; }
    for (const x of m.t || []) fold(s, x);
    bump(s);
  }
}
function reset(s) { s.gen++; s.pumping = false; s.hist.clear(); s.live.clear(); s.trades = []; s.pending = []; s.open = null; s.loadedFrom = Infinity; s.loading = true; s.at = 0; s.mm = null; }
function acquireStore(root, listener) {
  const s = getStore(root);
  s.refs++; s.ls.add(listener);
  if (!s.handle) { s.handle = acquire(root, (m) => onFrame(s, m), 20); }
  if (rootState(root).status === 'live' && !s.started) onFrame(s, null);
  return { s, release() { s.ls.delete(listener); if (--s.refs <= 0) { s.gen++; s.pumping = false; if (s.handle) s.handle.release(); stores.delete(root); } } };
}
// shared handle for assets/chart-l2-flow.js: the same store the L1 tools use (no second fetch). need(t) asks for history back to t.
export function tsOpen(root, firstT, listener) {
  const h = acquireStore(root, listener), need = (t) => { const s = h.s; s.need = Math.min(s.need || Infinity, t); if (s.started && s.need < s.loadedFrom) pump(s); };
  need(firstT);
  return { s: h.s, release: h.release, need, mins: () => minutes(h.s) };
}
// merged 1-minute rows { t, buy, sell, hi, lo }, sorted (history + live adds on top of the open history minute)
function minutes(s) {
  if (s.mm && s.mmV === s.v) return s.mm;
  const out = new Map();
  for (const h of s.hist.values()) out.set(h.t, h);
  for (const l of s.live.values()) {
    const h = out.get(l.t);
    if (!h) { out.set(l.t, l); continue; }
    const hd = h.buy - h.sell;
    out.set(l.t, { t: l.t, buy: h.buy + l.buy, sell: h.sell + l.sell, hi: Math.max(h.hi, hd + l.hi), lo: Math.min(h.lo, hd + l.lo) });
  }
  s.mm = [...out.values()].sort((a, b) => a.t - b.t); s.mmV = s.v;
  return s.mm;
}

// ---------------------------------------------------------------------------------------------- schemas (same keys / titles as the InsightSentry tools)
let H = null;
const IND = () => ({
  stk_ts_big: { title: 'Big Trades (L1)', short: 'Big Trades L1', pane: 'price', overlay: true, schema: BT.schema() },
  stk_ts_delta: { title: 'Delta (L1)', short: 'Delta L1', pane: 'new', overlay: false, schema: [
    { key: 'upColor', title: 'Positive', type: 'color', defval: TS_UP }, { key: 'downColor', title: 'Negative', type: 'color', defval: TS_DN }] },
  stk_ts_cvd: { title: 'Cumulative Delta (L1)', short: 'CVD L1', pane: 'new', overlay: false, schema: [
    { key: 'style', title: 'Show as', type: 'string', defval: 'candles', options: ['candles', 'line'] },
    { key: 'reset', title: 'Reset', type: 'string', defval: 'session', options: ['session', 'day', 'none'], tooltip: 'session = the CME day (18:00 New York).' },
    { key: 'upColor', title: 'Up', type: 'color', defval: TS_UP }, { key: 'downColor', title: 'Down', type: 'color', defval: TS_DN }] }
});
const defaults = (schema) => Object.fromEntries(schema.map((i) => [i.key, i.defval]));

// ---------------------------------------------------------------------------------------------- feed compare readout (last 60 min)
const lag = (v) => (v == null ? 'n/a' : (v >= 0 ? '+' : '-') + Math.abs(Math.round(v)) + ' ms');
function readout(type, s, f, thr, same) {
  const now = Date.now(), from = (Math.floor(now / 60000) - 60) * 60000, F = H.fmt, G = H.sgn;
  if (!f || !f.mins || !f.mins.length) return ['Standard vs L1, last 60 min', 'Standard feed not available for this chart'];
  if (s.loading || s.loadedFrom > from) return ['Standard vs L1, last 60 min', 'Loading L1 history…'];
  if (!same) return ['Standard vs L1, last 60 min', 'n/a on a micro: the standard order flow is the mini\'s'];
  const tt = Math.max(thr, s.floor);
  const r = compareFeeds({ isBars: f.mins, tsMins: minutes(s), tsTrades: s.trades, thr: tt, tick: s.tick, from, to: now + 60000 });
  const d = 'Δ Std ' + G(r.is.delta) + ' · L1 ' + G(r.ts.delta) + (r.corr != null ? ' · r ' + r.corr.toFixed(2) : '');
  const head = 'Standard vs L1, last 60 min';
  if (type === 'stk_ts_big') return [head, 'Big trades Std ' + r.is.bubbles + ' · L1 ' + r.ts.bubbles, 'Volume Std ' + F(r.is.vol) + ' · L1 ' + F(r.ts.vol), 'Lag p50 ' + lag(r.lagP50) + (r.matchedPct == null ? '' : ' · ' + Math.round(r.matchedPct) + '% matched'), d];
  return [head, d, 'Buy Std ' + F(r.is.buy) + ' · L1 ' + F(r.ts.buy) + ' | Sell Std ' + F(r.is.sell) + ' · L1 ' + F(r.ts.sell)];
}
function table(id, rows, accent, t0) {
  const day = H.light();
  return { id, paneId: '', position: t0 ? 'top_right' : 'bottom_center', columns: 1, rows: rows.length, bgColor: day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.9)', frameWidth: 0, borderWidth: 0,
    cells: rows.map((t, i) => [{ text: t, textColor: i === 0 || accent ? '#00adb5' : (day ? '#334155' : '#a3a9b6'), hAlign: t0 ? 'right' : 'center', vAlign: 'center', textSize: 'small', fontFamily: 'monospace', bold: false, italic: false }]), merges: [] };
}

// ---------------------------------------------------------------------------------------------- indicator
class TsNative {
  constructor(type) { this.type = type; this.inputs = {}; this.tm = 0; this.root = null; this.h = null; this.onAny = () => this.later(); }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = Object.assign(defaults(IND()[this.type].schema), this.type === 'stk_ts_big' ? BT.migrate(inputs) : inputs); H.use(); H.subscribe(this.onAny); this.render(); }
  later() { if (!this.tm) this.tm = setTimeout(() => { this.tm = 0; this.render(); }, 250); }
  onBars() { this.later(); }
  onViewport() { if (this.type === 'stk_ts_big') this.render(); }
  setInputs(i) { this.inputs = Object.assign(defaults(IND()[this.type].schema), this.type === 'stk_ts_big' ? BT.migrate(i) : i); this.render(); }
  suspend() { H.unsubscribe(this.onAny); }
  resume() { H.subscribe(this.onAny); this.render(); }
  stop() { H.unsubscribe(this.onAny); clearTimeout(this.tm); H.unuse(); this.off = true; this.unbind(); try { if (this.ctx) this.ctx.pushData({ owner: this, off: true }); } catch (e) {} }
  unbind() { if (this.h) { this.h.release(); this.h = null; this.root = null; } }
  bind(root) { if (this.root === root) return; this.unbind(); this.h = acquireStore(root, this.onAny); this.root = root; }
  render() {
    if (!this.ctx || this.off) return;
    const ctx = this.ctx, I = this.inputs, t = this.type, bars = ctx.bars();
    const note = (txt) => { this.unbind(); ctx.setStatus('idle'); ctx.emit({ tables: [table(t + '-msg', [txt], true)] }); try { ctx.pushData({ owner: this, off: true }); } catch (e) {} };
    if (!l1Visible()) { this.unbind(); ctx.setStatus('idle'); ctx.emit({ tables: [] }); try { ctx.pushData({ owner: this, off: true }); } catch (e) {} return; }   // lock text lives in the chip row note only
    const root = l2Root(ctx.symbol);
    if (!root) return note('L1 trades: NQ, ES, MNQ, MES, YM, RTY, CL and GC futures.');
    const tf = H.tfMin(ctx.timeframe);
    if (tf == null || tf < 1 || tf > 240) return note('L1 trades work on 1-minute to 4-hour charts.');
    this.bind(root);
    const s = this.h.s;
    if (bars.length) s.need = Math.min(s.need || Infinity, bars[0].time);
    if (s.started && s.need < s.loadedFrom) pump(s);
    const E = H.replayE();
    let mins = minutes(s);
    if (E != null) mins = mins.filter((m) => m.t + 60000 <= E);
    const isRoot = H.rootOf(ctx), same = isRoot === root;   // a micro chart: standard order flow is the mini's, so no like-for-like
    const isF = H.flowFor({ root: isRoot, timeframe: ctx.timeframe, bars, owner: this });
    ctx.setStatus(s.loading ? 'loading' : 'idle');
    const msg = s.loading && !mins.length ? 'Loading L1 trades…' : s.err && !mins.length ? s.err : !mins.length ? 'Waiting for L1 trades…' : '';
    const thr = same && isF.thr ? isF.thr : s.floor;   // the readout compares the feeds at the recorder's own big-print size
    const cmp = msg || E != null ? null : readout(t, s, isF, t === 'stk_ts_big' ? thr : 0, same);
    (window.__tsReadout || (window.__tsReadout = {}))[t] = cmp || [msg];   // read by tools/tests/ts-bigtrades-browser.js (the table itself is drawn on the canvas)
    const showCmp = (() => { try { return localStorage.getItem('tz_feedcheck') === '1'; } catch (e) { return false; } })();   // internal feed check: hidden from members unless turned on
    const tables = msg ? [table(t + '-msg', [msg], true)] : cmp && showCmp ? [table(t + '-cmp', cmp, false, t === 'stk_ts_big')] : [];
    if (t === 'stk_ts_big') { ctx.emit({ tables }); ctx.pushData({ owner: this, root, isRoot: same ? isRoot : null, timeframe: ctx.timeframe, inputs: I, v: s.v, vr: bars.length }); return; }
    const agg = aggregateMins(mins, tf * 60000), map = new Map(agg.map((b) => [b.t, b]));
    if (t === 'stk_ts_delta') {
      const pts = bars.map((b) => { const x = map.get(b.time); return x ? { time: b.time, value: x.delta, color: x.delta >= 0 ? I.upColor : I.downColor } : { time: b.time, value: null }; });
      ctx.emit({ series: [{ id: 'ts-delta', title: 'Delta L1', paneId: '', kind: 'histogram', points: pts, style: { color: I.upColor, width: 1, lineStyle: 'solid', base: 0 } }], tables });
      return;
    }
    const cc = cvdCandles(agg, I.reset, H.sessionOf), byT = new Map(cc.map((c) => [c.t, c]));
    if (I.style === 'line') {
      const pts = bars.map((b) => { const c = byT.get(b.time); return c ? { time: b.time, value: c.c } : { time: b.time, value: null }; });
      ctx.emit({ series: [{ id: 'ts-cvd', title: 'CVD L1', paneId: '', kind: 'line', points: pts, style: { color: I.upColor, width: 2, lineStyle: 'solid' } }], tables });
    } else {
      const cb = bars.map((b) => { const c = byT.get(b.time); return c ? { time: b.time, open: c.o, high: c.h, low: c.l, close: c.c } : null; }).filter(Boolean);
      if (!cb.length) { ctx.emit({ tables }); return; }
      ctx.emit({ series: [{ id: 'ts-cvd', title: 'CVD L1', paneId: '', kind: 'candle', bars: cb, style: { up: I.upColor, down: I.downColor } }], tables });
    }
  }
}

// ---------------------------------------------------------------------------------------------- bubbles: outline-only rings, same sizing as stk_of_big
function tsBigLayer() {
  let canvas = null, memo = null;
  return {
    mount(c) { canvas = c; BT.installTip(c); },
    render(a) {
      if (!H.frame(canvas, a)) return;
      const d = a.data, I = d.inputs, s = stores.get(d.root);
      if (!s || !s.trades.length) return;
      const tf = (H.tfMin(d.timeframe) || 1) * 60000, lb = a.bars[a.bars.length - 1];
      const key = s.v + '|' + s.trades.length + '|' + JSON.stringify(I) + '|' + a.bars.length + '|' + (lb && lb.close);
      if (!memo || memo.key !== key || memo.s !== s) {
        const raw = s.trades.map((x) => [x[0], Math.round(x[1] / s.tick), x[2], x[3] > 0 ? 1 : 0]);
        memo = { key, s, sel: BT.select(raw, I, { floor: s.floor, bars: a.bars, tfMs: tf, tick: s.tick }) };
      }
      BT.draw(canvas, a, memo.sel, I, s.tick, H);
    },
    destroy() { canvas = null; }
  };
}

// hooks from chart-footprint.js installFootprint(): the helpers that file already owns (no second copy)
export function installTsTrades(Core, hooks) {
  if (H) return;
  H = Object.assign({ bigThreshold }, hooks);
  for (const t of TS_TYPES) if (!L2_TYPES.includes(t)) L2_TYPES.push(t);   // chart-orderflow.js hides L2_TYPES from the picker until l1Visible()
  for (const type of TS_TYPES) registerFeed(type, { needs: 'L1', title: IND()[type].title, mkt: 'futures' });   // trades only: L1, not the book
  Core.registerRendererLayer({ id: 'stk_ts_big', placement: 'above-data', create: tsBigLayer });
  const ind = IND();
  for (const type of TS_TYPES) {
    const d = ind[type];
    Core.registerNativeIndicator({ type, title: d.title, shortTitle: d.short, paneHint: d.pane, overlay: d.overlay, reactsToViewport: type === 'stk_ts_big',
      inputsSchema: () => d.schema, defaultInputs: () => defaults(d.schema), create: () => new TsNative(type) });
  }
}
