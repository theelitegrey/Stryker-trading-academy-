// Zscript data hub (main thread). Turns what the chart ALREADY holds (book store, trade store, GEX history, ZoroOptions summary, the
// chart's bar provider) into plain-JSON data frames, one per chart bar, and keeps the forming bar's frame fresh. The worker (S1) only
// ever receives these frames: it has no network and never sees a socket. Protocol: reports/workers/zscript/contract.md, section S3.
//
//   const hub = getHub();                                       // one per page
//   const s = hub.open({ symbol, provider, ticker, timeframe, uses:['book','flow','gex','opt'], post, fetchSeries });
//   s.setBars(bars)        // chart bars [{time(ms), open, high, low, close, volume}], on every bars change (cheap: debounced)
//   s.security(req)        // worker -> main { reqId, sym, tf, from, to } -> posts zs.sec.res
//   s.close()
//
// SUBSCRIBE ON DEMAND: a namespace is only acquired when the script uses it, the plan allows it and the symbol has the data.
// NO NEW SOCKETS: acquireBookFeed / acquireTradeFeed / l2 acquire are the chart's own shared feeds (ref-counted, closed with the last user).
// NO LOOKAHEAD: a bar's frame is the state known at that bar's close (asOf = min(close - 1 ms, now, replay clock)); never later.
// Education only. Not financial advice.
import { ZS_DATA_FOLLOWS_PLAN } from '../../zs-config.js?v=981';
import * as GATE from './gate.js?v=981';
import * as ST from './stores.js?v=981';
import { SeriesCache, tfToMs } from '../../chart-pine-series-cache.js?v=981';
import { NAMESPACES } from './ops.js?v=981';

const MAX_FRAME_BARS = 5000;          // frames go out for the newest bars only (the engine's own bar cap is not above this)
const LIVE_MS = 250;                  // forming-bar frame: at most 4 pushes a second
const HIST_MS = 2000;                 // history re-send after a store grew (book history landed ...): at most every 2 s
const GEX_MAX_AGE_S = 6 * 3600;       // a GEX snapshot older than this at the bar = na
const GEX_BACK_S = 4 * 86400;         // same reach as chart replay
const BOOK_MAX_AGE_MS = 10 * 60000;
const SEC_MAX_BARS = 20000;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

let hubSingleton = null;
export function getHub(deps) { return hubSingleton || (hubSingleton = new Hub(deps || browserDeps())); }
export function resetHubForTests() { hubSingleton = null; }

// Everything the hub touches in the page, in one object, so tests can hand in fakes. Dynamic imports: this file loads in node too.
export function browserDeps() {
  let mods = null;
  const load = () => mods || (mods = Promise.all([
    import('../../chart-orderflow.js?v=981'), import('../../chart-futures-l2.js?v=981'), import('../../chart-gex-levels.js?v=981'),
    import('../../chart-zoro-data.js?v=981'), import('../../chart-pro-gate.js?v=981'), import('../../orderflow-venues.js?v=981'),
    import('../../gex-heat-core.js?v=981'),   // sets window.StrykerGexHeat (the GEX history reader); same module the heatmap loads
  ]).then(([of, l2, gx, zd, pg, vn]) => ({ of, l2, gx, zd, pg, vn })));
  return {
    load,
    now: () => Date.now(),
    replay: () => (window.__stkReplay && window.__stkReplay.on ? window.__stkReplay.E : null),   // replay clock (ms) or null
    heat: () => window.StrykerGexHeat || null,
    follows: ZS_DATA_FOLLOWS_PLAN,
  };
}

class Hub {
  constructor(deps) { this.deps = deps; this.sessions = new Set(); this.notices = new Set(); this.sec = new SeriesCache({ maxBars: 200000, maxInflight: 3 }); this.m = null; this.gexRows = new Map(); }
  async mods() { return this.m || (this.m = await this.deps.load()); }
  open(spec) { const s = new Session(this, spec); this.sessions.add(s); s.start(); return s; }
}

// ---- market of a chart symbol (same reading as chart-orderflow marketOf) ---------------------------------------------------
export function marketOf(symbol, provider) {
  let ticker = String(symbol || ''), prov = String(provider || '').toLowerCase();
  const m = /^([a-z_]+):(.+)$/i.exec(ticker);
  if (m) { if (!prov) prov = m[1].toLowerCase(); ticker = m[2]; }
  const root = ticker.toUpperCase().replace(/1!$/, '').replace(/[0-9]!$/, '');
  return { provider: prov, ticker, root, futures: prov === 'futures' };
}
export const tfMsOf = (tf) => tfToMs(tf) || 60000;

class Session {
  constructor(hub, spec) {
    this.hub = hub; this.spec = spec; this.uses = new Set((spec.uses || []).filter((n) => NAMESPACES.includes(n)));
    this.mk = marketOf(spec.symbol, spec.provider || (spec.ticker && ''));
    if (spec.ticker && spec.provider) this.mk = marketOf(spec.provider + ':' + spec.ticker, spec.provider);
    this.tfMs = tfMsOf(spec.timeframe);
    this.bars = []; this.src = {}; this.status = {}; this.handles = []; this.sent = new Map(); this.closed = false;
    this.liveTm = 0; this.histTm = 0; this.ready = false;
  }
  post(m) { if (!this.closed) try { this.spec.post(m); } catch (e) {} }
  async start() {
    const M = await this.hub.mods(), d = this.hub.deps;
    if (this.closed) return;
    this.M = M;
    try { await M.pg.tier(); } catch (e) {}
    const free = M.pg.isFree();
    const avail = this.availability(M);
    this.status = GATE.decide(d.follows, free, avail);
    for (const ns of NAMESPACES) {
      const st = this.status[ns];
      if (!this.uses.has(ns)) { st.state = 'unused'; continue; }
      const n = GATE.noticeOnce(this.hub.notices, ns, st);
      if (n) this.post(Object.assign({ sessionId: this.spec.sessionId }, n));
    }
    this.post({ kind: 'zs.data.init', sessionId: this.spec.sessionId, tfMs: this.tfMs, status: Object.fromEntries(NAMESPACES.map((ns) => [ns, this.status[ns].state])) });
    // acquire only what is used AND allowed
    if (this.on('book')) this.acquireBook(M);
    if (this.on('flow')) this.acquireFlow(M);
    if (this.on('gex') || this.on('opt')) this.acquireGex(M);
    this.ready = true;
    this.sendAll(true);
  }
  on(ns) { return this.status[ns] && this.status[ns].state === 'ok'; }
  replayMs() { return this.hub.deps.replay(); }

  // why a namespace has no data for this symbol ('' = it has)
  availability(M) {
    const { mk } = this, out = {};
    const bookVenue = mk.provider === 'binance' || (!mk.futures && M.vn.getVenue(mk.provider));
    out.book = mk.futures ? (M.l2.l2Root(mk.root) && !M.l2.isQuoteSym(mk.root) ? '' : 'There is no order book feed for ' + mk.root + '.') : (bookVenue ? '' : 'Order book data is available on futures (NQ, ES, ...) and crypto charts.');
    const flowTf = this.tfMs / 60000;
    out.flow = mk.futures ? (M.l2.l2Root(mk.root) && !M.l2.isQuoteSym(mk.root) ? '' : 'There is no order flow feed for ' + mk.root + '.')
      : (bookVenue ? (flowTf >= 1 && flowTf <= 15 ? '' : 'Order flow works on 1m to 15m charts.') : 'Order flow data is available on futures and crypto charts.');
    this.gexSrc = M.gx.gexSource(mk.provider + ':' + mk.ticker, mk.provider);
    out.gex = this.gexSrc ? '' : 'GEX data is available for SPX, SPY, QQQ, GLD and the ES, NQ and GC futures.';
    this.zoSrc = M.zd.zoroOn() ? M.zd.zoroSource(mk.provider + ':' + mk.ticker, mk.provider, true) : null;
    out.opt = !M.zd.zoroOn() ? 'ZoroOptions is not switched on yet.' : (this.zoSrc ? '' : 'ZoroOptions data is not available for this symbol.');
    return out;
  }

  // ---- book: the chart's BookFeed (heatmap store: 1 s samples + recorder history) ---------------------------------------------
  acquireBook(M) {
    const poke = () => this.pokeLive(), mk = this.mk;
    if (mk.futures) { const root = M.l2.l2Root(mk.root); this.bk = M.of.acquireBookFeed('tsl2', root, poke, M.l2.l2Source(root)); }
    else this.bk = M.of.acquireBookFeed(mk.provider, mk.ticker, poke);
    this.handles.push(() => this.bk.release());
  }
  bookFrame(asOf, live) {
    const f = this.bk && this.bk.feed; if (!f) return null;
    const samples = f.allHistory();
    if (live) return ST.bookFrameLive(f.book, samples[samples.length - 1], this.hub.deps.now());
    return ST.bookFrameAt(samples, asOf, BOOK_MAX_AGE_MS);
  }

  // ---- flow: the chart's trade stores (crypto TradeFeed per timeframe; futures TickFeed minutes from the hub socket) -----------
  acquireFlow(M) {
    const poke = () => this.pokeLive(), mk = this.mk;
    if (mk.futures) {
      const root = M.l2.l2Root(mk.root);
      this.fl = { kind: 'fut', root, h: M.l2.acquire(root, poke, 20) };
      this.handles.push(() => this.fl.h.release());
    } else {
      this.fl = { kind: 'crypto', h: M.of.acquireTradeFeed(mk.provider, mk.ticker, this.tfMs, poke) };
      this.handles.push(() => this.fl.h.release());
    }
  }
  flowMap() {   // Map(barOpenMs -> flow frame) over all bars the store covers
    const fl = this.fl; if (!fl) return new Map();
    if (fl.kind === 'crypto') {
      const f = fl.h.feed;
      return ST.aggregateFlow(f.order.filter((t) => t >= f.coverFrom).map((t) => ST.itemFromTradeBar(f.bars.get(t))), this.tfMs);
    }
    const r = this.M.l2.rootState(fl.root), tf = r.trades; if (!tf) return new Map();
    const sizes = new Map();   // minute -> sizes of the prints this page saw (ring); older minutes have none
    for (const x of tf.ring) { const m = Math.floor(x[0] / 60000) * 60000; (sizes.get(m) || sizes.set(m, []).get(m)).push(x[2]); }
    const items = tf.bars().filter((b) => b.t >= tf.coverFrom).map((b) => ST.itemFromTickBar(b, tf.tick, sizes.has(b.t) ? sizes.get(b.t).sort((a, c) => c - a).slice(0, ST.CAPS.bigs) : null));
    return ST.aggregateFlow(items, this.tfMs);
  }

  // ---- gex + opt: GEX history (recorder, 2-min snapshots) for the past, the chart's cached API response / Zoro summary for now -----
  acquireGex(M) {
    const need = this.on('gex') ? this.gexSrc : this.zoSrc;
    if (!need) return;
    this.gx = { api: need.api || need.u, fut: need.fut || null };
    this.gxTimer = setInterval(() => this.pullGex(), 60000);
    this.handles.push(() => clearInterval(this.gxTimer));
    this.pullGex();
  }
  pullGex() {
    const M = this.M, g = this.gx; if (!g || document.visibilityState === 'hidden') return;
    if (this.replayMs() == null) {   // replay: history only (a fetch of today's levels would be lookahead)
      if (this.on('gex') && this.gexSrc && !this.gexSrc.zoro) M.gx.gexFetch(g.api, 0, false, '').then(() => this.pokeLive());
      if ((this.on('opt') || (this.on('gex') && this.gexSrc && this.gexSrc.zoro)) && this.zoSrc) M.zd.zoFetch('summary', this.zoSrc.u, '', false).then(() => this.pokeLive());
    }
    this.loadHistory();
  }
  loadHistory() {   // GEX history rows for the chart's time span (max 4 days, one request, cached per api in the hub)
    const M = this.M, g = this.gx, core0 = this.hub.deps.heat(); if (!g || !core0 || !this.bars.length) return;
    const core = M.zd.histApi(g.api, core0);
    const from = Math.max(Math.floor(this.bars[0].time / 1000) - 3600, Math.floor(this.hub.deps.now() / 1000) - GEX_BACK_S);
    const key = g.api + ':0', e = this.hub.gexRows.get(key);
    if (e && (e.p || (e.from <= from + 60 && this.hub.deps.now() - e.at < 120000))) return;
    const rec = { from, at: this.hub.deps.now(), rows: e ? e.rows : [], p: null };
    this.hub.gexRows.set(key, rec);
    rec.p = core.history(g.api, 0, from, Math.floor(this.hub.deps.now() / 1000) + 60).then((rows) => { rec.rows = rows || []; }, () => {}).then(() => { rec.p = null; this.pokeHist(); });
  }
  // price conversion for one snapshot (ES/MES: ratio 1; others: last ratio seen on this device or close / spot), basis = chart close at the snapshot
  convAt(snap) {
    const g = this.gx; if (!g.fut) return (v) => v;
    const close = this.hub.m.zd.closeAt(this.bars, snap.t, 1800);
    let k = null;
    if (g.fut === 'ES' || g.fut === 'MES') k = 1;
    else { try { const o = JSON.parse(localStorage.getItem('stryker_gex_heat_k') || '{}'); k = isNum(o[g.fut]) ? o[g.fut] : null; } catch (e) {} }
    return ST.futConv(snap.s, close, k);
  }
  gexOptHistory(ns, asOfSec) {
    const e = this.hub.gexRows.get(this.gx.api + ':0'); if (!e || !e.rows.length) return null;
    const snap = this.hub.m.gx.snapAt(e.rows, asOfSec, GEX_MAX_AGE_S); if (!snap) return null;
    const conv = this.convAt(snap);
    return ns === 'gex' ? ST.gexFrameFromSnap(snap, conv) : ST.optFrameFromSnap(snap, conv);
  }
  gexLive() {
    const M = this.hub.m, g = this.gx, data = M.gx.gexCached(g.api, 0, '');
    if (!data || data.error) return null;
    const shift = g.fut ? M.gx.gexAnchor(g.fut, data) : null, conv = M.gx.convOf(data, this.gexSrc, shift);
    return ST.gexFrameFromApi(data, conv, isNum(data.fetched_at) ? data.fetched_at : (data.market && data.market.data_ts) || null);
  }
  optLive() {
    const M = this.hub.m, g = this.gx, u = this.zoSrc ? this.zoSrc.u : g.api, j = M.zd.zoCached('summary', u, ''), zs = M.zd.zsum(j);
    if (!zs) return null;
    const conv = M.zd.convFor(zs, this.zoSrc, this.bars);
    const data = M.gx.gexCached(g.api, 0, '');
    const mp = data && isNum(data.max_pain) ? data.max_pain : null;
    return ST.optFrameFromSummary(zs, conv, mp, j && j.pc && isNum(j.pc.volume) ? j.pc.volume : null);
  }

  // ---- frames --------------------------------------------------------------------------------------------------------------
  setBars(bars) {
    this.bars = bars || [];
    if (!this.ready) return;
    if (this.gx) this.loadHistory();
    this.sendAll(false);
  }
  asOfFor(t) {   // the moment a bar's frame is read at: just before its close, never after now / the replay clock
    const rep = this.replayMs(), cap = rep != null ? rep : this.hub.deps.now();
    return Math.min(t + this.tfMs - 1, cap);
  }
  isLiveBar(i) {
    return this.replayMs() == null && i === this.bars.length - 1 && this.hub.deps.now() < this.bars[i].time + this.tfMs;
  }
  frameFor(i, flowMap) {
    const t = this.bars[i].time, asOf = this.asOfFor(t), live = this.isLiveBar(i), f = {};
    const rep = this.replayMs(); if (rep != null && t > rep) return null;
    if (this.on('book')) { const b = this.bookFrame(asOf, live); if (b) f.book = b; }
    if (this.on('flow') && flowMapHas(flowMap, t)) f.flow = flowMap.get(t);
    if (this.on('gex')) { const g = live ? (this.gexSrc.zoro ? null : this.gexLive()) || this.gexOptHistory('gex', asOf / 1000) : this.gexOptHistory('gex', asOf / 1000); if (g) f.gex = g; }
    if (this.on('opt')) { const o = live && this.zoSrc ? this.optLive() || this.gexOptHistory('opt', asOf / 1000) : this.gexOptHistory('opt', asOf / 1000); if (o) f.opt = o; }
    return Object.keys(f).length ? f : null;
  }
  // all frames for the newest bars; only the bars whose frame changed since the last send go out
  sendAll(reset) {
    if (this.closed || !this.ready) return;
    const n = this.bars.length, from = Math.max(0, n - MAX_FRAME_BARS), flowMap = this.on('flow') ? this.flowMap() : null, out = [];
    if (reset) this.sent.clear();
    for (let i = from; i < n; i++) {
      const fr = this.frameFor(i, flowMap), sig = fr ? JSON.stringify(fr) : '', t = this.bars[i].time;
      if (this.sent.get(t) === sig) continue;
      this.sent.set(t, sig); out.push([t, fr]);
    }
    if (this.sent.size > MAX_FRAME_BARS * 2) for (const k of [...this.sent.keys()].slice(0, this.sent.size - MAX_FRAME_BARS)) this.sent.delete(k);
    if (out.length) this.post({ kind: 'zs.data.frames', sessionId: this.spec.sessionId, reset: !!reset, tfMs: this.tfMs, frames: out });
  }
  // the forming bar, fast path
  pokeLive() {
    if (this.closed || !this.ready || this.liveTm) return;
    this.liveTm = setTimeout(() => {
      this.liveTm = 0; if (this.closed || !this.bars.length) return;
      const i = this.bars.length - 1, t = this.bars[i].time, fr = this.frameFor(i, this.on('flow') ? this.flowMap() : null), sig = fr ? JSON.stringify(fr) : '';
      if (this.sent.get(t) === sig) return;
      this.sent.set(t, sig);
      this.post({ kind: 'zs.data.live', sessionId: this.spec.sessionId, t, frame: fr });
    }, LIVE_MS);
  }
  // history grew (book history landed, GEX rows arrived)
  pokeHist() {   // leading edge: the first arrival goes out at once, later ones at most every HIST_MS
    if (this.closed || !this.ready || this.histTm) return;
    const wait = Math.max(0, (this.lastHist || 0) + HIST_MS - this.hub.deps.now());
    this.histTm = setTimeout(() => { this.histTm = 0; this.lastHist = this.hub.deps.now(); this.sendAll(false); }, wait);
  }

  // ---- request.security ---------------------------------------------------------------------------------------------------
  // req = { reqId, sym, tf, from, to } (ms). Replies zs.sec.res { reqId, bars:[[t,o,h,l,c,v]..] ascending, tfMs } or { reqId, error }.
  // The worker aligns with ops.htfIndexAt() (closed HTF bars only for history, the forming one on the live bar). The chart's own series is
  // used as the base for a higher intraday timeframe of the SAME symbol (no fetch); everything else goes through the chart's bar provider.
  async security(req) {
    const send = (m) => this.post(Object.assign({ kind: 'zs.sec.res', sessionId: this.spec.sessionId, reqId: req.reqId }, m));
    try {
      if (typeof this.spec.fetchSeries !== 'function') return send({ error: 'request.security is not available here.' });
      const tfMs = tfMsOf(req.tf), rep = this.replayMs();
      const to = Math.min(req.to > 0 ? req.to : Infinity, rep != null ? rep : Infinity);
      const range = { from: Math.max(1, req.from || 1), to: Number.isFinite(to) ? to : undefined };
      const base = this.bars.length ? { symbol: this.spec.symbol, timeframe: this.spec.timeframe, bars: this.bars } : null;
      let bars = await this.hub.sec.get(req.sym || this.spec.symbol, req.tf, range, (s, tf, r) => this.spec.fetchSeries(s, tf, r), base);
      bars = (bars || []).map((b) => [Number(b.openTime != null ? b.openTime : b.time), b.open, b.high, b.low, b.close, Number(b.volume) || 0]);
      if (rep != null) bars = bars.filter((b) => b[0] <= rep);   // replay: nothing opened after the replay clock
      if (bars.length > SEC_MAX_BARS) bars = bars.slice(bars.length - SEC_MAX_BARS);
      send({ bars, tfMs });
    } catch (e) { send({ error: 'Could not load ' + (req.sym || 'that symbol') + ' ' + req.tf + '. request.security works for symbols this chart can load.' }); }
  }

  close() {
    this.closed = true; clearTimeout(this.liveTm); clearTimeout(this.histTm);
    this.handles.splice(0).forEach((f) => { try { f(); } catch (e) {} });
    this.hub.sessions.delete(this);
  }
}
const flowMapHas = (m, t) => !!m && m.has(t);
