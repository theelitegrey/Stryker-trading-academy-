// TradeZoro — Charts: Pine "next" engine, page side (ES module)
// Imported by assets/chart-pine.js. The worker half is assets/chart-pine-next-worker.js;
// read its header for why this exists (newer pinets OFF the page thread).
//
// PineNextEngine implements the same engine interface Vela calls on vela-pinets'
// PineWorkerEngine (language, capabilities, prepare, execute -> handle with getContext,
// stop, update, setVisibleRange, notifyBars). It is registered per chart under the
// language id 'pine-next'. One module worker for the whole page (see ONE WORKER below).
//
// Bars: Vela hands execute() a getBars() function; a worker can't call it, so every
// non-backfill bar notification ships a fresh snapshot (same as vela-pinets' own worker).
// Bursts are coalesced on the worker side (one re-run after the in-flight one lands).

import { SeriesCache } from './chart-pine-series-cache.js?v=960';

const WORKER_URL = new URL('./chart-pine-next-worker.js?v=960' + (typeof window !== 'undefined' && window.__stkVela090 === true ? '&vela=090' : ''), import.meta.url);

// request.security ranges: the engine asks for a long warm-up before the chart's first bar
// (seen: 33 days of 1m bars, 48k bars / 15 s of downloads, for a 3.5-day 1m chart). Keep a
// warm-up of 300 bars of the requested timeframe (at least a quarter of the chart's span)
// before the chart's first bar. Exported for tests.
export function clampRange(range, timeframe, bars){
  if (!range || !(range.from > 0) || !bars || bars.length < 2) return range;
  const first = Number(bars[0].openTime != null ? bars[0].openTime : bars[0].time);
  const last = Number(bars[bars.length - 1].openTime != null ? bars[bars.length - 1].openTime : bars[bars.length - 1].time);
  if (!(first > 0) || !(last > first)) return range;
  const tfMs = tfToMs(timeframe);
  const warm = Math.max((last - first) / 4, tfMs ? tfMs * 300 : 0);
  let minFrom = first - warm;
  // A request for a timeframe LOWER than the chart's (e.g. a script's default "60" structure
  // timeframe on a daily chart) would download that small timeframe across the whole chart span
  // (seen: 39 x 1h pages on NQ 1D, 22 on BTCUSDT 1D, pushing a run past the 20 s cap). Fetch at
  // most LOWER_TF_MAX_BARS of it, ending at the chart's last bar. The script is not changed; older
  // chart bars just see na from that request.
  const chartMs = (last - first) / (bars.length - 1);
  if (tfMs && chartMs && tfMs < chartMs * 0.99) minFrom = Math.max(minFrom, last - tfMs * LOWER_TF_MAX_BARS);
  return range.from < minFrom ? Object.assign({}, range, { from: minFrom }) : range;
}
export const LOWER_TF_MAX_BARS = 3000;
function tfToMs(tf){
  const m = /^(\d*)([SDWM]?)$/i.exec(String(tf || '').trim());
  if (!m) return 0;
  const n = Number(m[1] || 1), u = (m[2] || '').toUpperCase();
  return n * (u === 'S' ? 1e3 : u === 'D' ? 864e5 : u === 'W' ? 6048e5 : u === 'M' ? 2592e6 : 6e4);
}

// While a Pine script computes in the worker, html gets .stk-pine-busy and style.css pauses the
// endless decorative animations (plan badge / role tags). Those made the page paint every frame,
// which on small machines (2 cores) took the CPU from the worker: Liquidity Master on a 1m chart
// went from ~40 s to under 15 s with them paused. Safety: the class never stays on > 90 s.
const busyEngines = new Set();
let busyGuard = 0;
function setBusy(eng, on){
  if (on) busyEngines.add(eng); else busyEngines.delete(eng);
  if (typeof document === 'undefined') return;
  const any = busyEngines.size > 0;
  document.documentElement.classList.toggle('stk-pine-busy', any);
  clearTimeout(busyGuard);
  if (any) busyGuard = setTimeout(() => { busyEngines.clear(); document.documentElement.classList.remove('stk-pine-busy'); }, 90000);
}

// The bars the worker already has (s.sent) plus at most 2 new or changed bars at the end -> { from, tail }; anything else -> null (send all).
export function tailOf(s, b, reason){
  const k = s && s.sent;
  if (!k || reason || !b || b.length < k.n || b.length - k.n > 2 || !b.length || b[0].time !== k.first) return null;
  const i = k.n - 1;
  if (!b[i] || b[i].time !== k.last) return null;
  return { from: i, tail: b.slice(i) };
}

// ONE WORKER FOR ALL CHART CELLS (RAM round 2, member GK 11 Nov: "one chart tab ~4 GB"). Each worker holds
// its own copy of pinets + vela-pinets (~57 MB of JS heap before any script runs), and a 2-chart layout had
// two. Now every cell's engine talks to one shared worker. The worker already keeps scripts apart by
// session (and its scheduler shares the thread fairly), so routing is by id: request and session ids
// are unique across the page (one counter here) and every reply goes to the engine that owns that id.
// A script's error reaches only its own session. The worker is dropped once no engine has a script
// left (as before for one cell). A cell reset after a runaway run (terminate) restarts the worker only
// when no other cell has scripts on it; otherwise only that cell's scripts are stopped.
const hub = { worker: null, engines: new Set(), owner: new Map(), seq: 0, sealed: false };
function hubWorker(){
  if (!hub.worker) {
    const w = hub.worker = new Worker(WORKER_URL, { type: 'module', name: 'stryker-pine-next' });
    w.addEventListener('message', (e) => hubMessage(e.data || {}));
    w.addEventListener('error', (e) => {
      const msg = (e && e.message) || 'Pine engine failed to start';
      hub.engines.forEach((eng) => eng.workerFailed(msg));
    });
  }
  return hub.worker;
}
function hubMessage(m){
  switch (m.kind) {
    case 'busy': setBusy(hub, !!m.on); return;
    case 'started': case 'own': { try { const f = typeof window !== 'undefined' && window.__stkPineClockHook; if (f) f(m); } catch (e) {} return; }
    case 'loadError': hub.engines.forEach((eng) => eng.onMessage(m)); return;
  }
  const eng = (m.sessionId != null && hub.owner.get('s' + m.sessionId)) || (m.reqId != null && hub.owner.get('r' + m.reqId));
  if (eng) eng.onMessage(m);
}
function hubKill(){
  const w = hub.worker; if (!w) return;
  hub.worker = null; hub.owner.clear(); hub.sealed = false; setBusy(hub, false);
  try { w.terminate(); } catch (e) {}
}
export function sharedWorkerState(){ return { worker: !!hub.worker, engines: hub.engines.size, sessions: [...hub.engines].reduce((n, e) => n + e.sessions.size, 0) }; }   // tests

export class PineNextEngine {
  constructor(opts = {}){
    this.language = 'pine-next';
    this.capabilities = { streaming: true, visibleRange: true, inputs: true, props: true };
    this.opts = opts;
    this.prepares = new Map();
    this.sessions = new Map();
    this.ctxWaits = new Map();
    // one request.security cache per chart, shared by all its scripts (dedupe, parallel cap, HTF from base, tail only)
    const phone = typeof window !== 'undefined' && (window.innerWidth < 700 || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches));
    this.seriesCache = new SeriesCache({ maxBars: phone ? 150000 : 500000, maxInflight: phone ? 4 : 6 });
  }
  get worker(){ return hub.engines.has(this) ? hub.worker : null; }
  get reqId(){ return hub.seq; }
  get hasSealed(){ return hub.sealed; }
  set hasSealed(v){ if (v) hub.sealed = true; }
  nextId(kind){ const id = ++hub.seq; hub.owner.set(kind + id, this); return id; }
  w(){ hub.engines.add(this); return hubWorker(); }
  post(m){ this.w().postMessage(m); }
  workerFailed(msg){
    this.prepares.forEach((p) => p.reject(new Error(msg))); this.prepares.clear();
    this.sessions.forEach((s) => { try { s.handlers.onError && s.handlers.onError(new Error(msg)); } catch (x) {} });
  }
  busyElsewhere(){ for (const e of hub.engines) if (e !== this && (e.sessions.size || e.prepares.size)) return true; return false; }
  forget(){
    for (const [k, e] of hub.owner) if (e === this) hub.owner.delete(k);
    this.ctxWaits.forEach((r) => r(null)); this.ctxWaits.clear();
    hub.engines.delete(this);
  }
  retire(){
    // A worker holding decrypted community indicators stays up: retiring it would lose them (and the session key),
    // and the chart's stub sources would then fail to run until re-added.
    if (this.hasSealed) return;
    if (!hub.engines.has(this)) return;
    this.forget();
    if (!this.busyElsewhere() && ![...hub.engines].some((e) => e.sessions.size || e.prepares.size)) hubKill();
  }
  prepare(source, instanceId){
    const reqId = this.nextId('r');
    return new Promise((resolve, reject) => {
      this.prepares.set(reqId, { resolve, reject });
      this.post({ kind: 'prepare', reqId, source, instanceId, defaultProps: this.opts.defaultProps, propsVisibility: this.opts.props || 'strategy' });
    });
  }
  // Sealed community indicators (see the worker's SEALED block): the page only ever sees ciphertext.
  ask(kind, extra){
    const reqId = this.nextId('r');
    return new Promise((resolve, reject) => {
      this.prepares.set(reqId, { resolve, reject });
      this.post(Object.assign({ kind, reqId }, extra || {}));
    });
  }
  sealKey(){ this.hasSealed = true; return this.ask('sealKey'); }
  unseal(ref, sealedMsg){ return this.ask('unseal', { ref, sealed: sealedMsg }).then((v) => { this.hasSealed = true; return v; }); }
  execute(req, handlers){
    const sessionId = this.nextId('s');
    const barsOf = () => (req.getBars ? req.getBars() : req.bars) || [];
    const s = { req, handlers, barsOf, live: req.mode === 'live', lastTime: 0 };
    this.sessions.set(sessionId, s);
    const bars = barsOf();
    s.lastTime = bars.length ? bars[bars.length - 1].time : 0;
    s.sent = bars.length ? { n: bars.length, first: bars[0].time, last: bars[bars.length - 1].time } : null;
    const plain = {
      prepared: req.prepared, market: req.market, bars, inputs: Object.assign({}, req.inputs || {}),
      props: req.props ? Object.assign({}, req.props) : undefined, visibleRange: req.visibleRange,
      mode: s.live ? 'live' : 'static', historyState: req.historyState
    };
    this.post({ kind: 'execute', sessionId, req: plain, sentAt: Date.now() });
    return {
      getContext: (select) => new Promise((resolve) => {
        const reqId = this.nextId('r');
        this.ctxWaits.set(reqId, resolve);
        this.post({ kind: 'getContext', sessionId, reqId, select });
      }),
      stop: () => {
        this.post({ kind: 'stop', sessionId }); this.sessions.delete(sessionId); hub.owner.delete('s' + sessionId);
        // A run already in progress cannot be interrupted inside the worker; it would finish
        // in the background and delay the next script on this chart (a 5k-bar WCSMC run left
        // behind pushed the next add past the time limit). With no scripts left, drop the
        // worker; the next add starts a fresh one (pinets comes from the HTTP cache).
        if (!this.sessions.size && !this.prepares.size) this.retire();
      },
      update: (inputs, props) => this.post({ kind: 'update', sessionId, inputs: Object.assign({}, inputs || {}), props: props ? Object.assign({}, props) : undefined }),
      setVisibleRange: (range) => this.post({ kind: 'setVisibleRange', sessionId, range }),
      notifyBars: (reason) => {
        if (reason === 'backfill') return;
        const b = barsOf(), t = tailOf(s, b, reason);
        // A live tick only changes the last bar or adds one: send just those, not a copy of the whole history
        // (a 1m chart sent ~6k bar objects a second to the worker; at 17k bars after a scroll-back it ran out of memory on phones).
        if (t) this.post({ kind: 'notifyBars', sessionId, reason, tail: t.tail, from: t.from });
        else this.post({ kind: 'notifyBars', sessionId, reason, bars: b });
        s.sent = b.length ? { n: b.length, first: b[0].time, last: b[b.length - 1].time } : null;
      }
    };
  }
  // Cell reset (chart-pine.js resetCell, after a run went over the time limit): its scripts were removed just before.
  // Restart the worker only if no other cell has scripts on it; a run still in progress then finishes in the background.
  terminate(){
    const others = this.busyElsewhere();
    this.forget();
    if (!others) hubKill();
  }
  onMessage(m){
    switch (m.kind) {
      case 'prepared': {
        const p = this.prepares.get(m.reqId); if (!p) return;
        this.prepares.delete(m.reqId); hub.owner.delete('r' + m.reqId);
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m.prepared);
        return;
      }
      case 'sealKey':
      case 'unsealed': {
        const p = this.prepares.get(m.reqId); if (!p) return;
        this.prepares.delete(m.reqId);
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m.kind === 'sealKey' ? m.pub : m.version);
        return;
      }
      case 'loadError': {
        const err = new Error(m.message || 'Pine engine did not load');
        this.prepares.forEach((p) => p.reject(err)); this.prepares.clear();
        return;
      }
      case 'model': { const s = this.sessions.get(m.sessionId); if (s) s.handlers.onModel(m.model); return; }
      case 'alert': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onAlert) s.handlers.onAlert(m.alert); try { if (this.opts.onAlert) this.opts.onAlert(m.alert, s); } catch (e) {} return; }
      case 'warning': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onWarning) s.handlers.onWarning(m.warning); return; }
      case 'error': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onError) s.handlers.onError(new Error(m.message)); return; }
      // own-compute clock for the page's time limit (chart-pine.js runOnChartInner): 'started' = the worker
      // picked the run up (queue wait ends), 'own' = ms other scripts' runs overlapped it.
      case 'done': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onDone) s.handlers.onDone(); return; }
      case 'contextResult': { const w = this.ctxWaits.get(m.reqId); this.ctxWaits.delete(m.reqId); hub.owner.delete('r' + m.reqId); if (w) w(m.snapshot); return; }
      case 'fetchSeries': this.serveFetch(m); return;
    }
  }
  cachedFetch(s, m){
    const range = clampRange(m.range, m.timeframe, s.barsOf());
    const mk = s.req.market || {};
    const all = s.req.getBars ? s.req.getBars() : s.req.bars;
    const base = mk.symbol && mk.timeframe && all && all.length ? { symbol: mk.symbol, timeframe: mk.timeframe, bars: all } : null;
    return this.seriesCache.get(m.symbol, m.timeframe, range, (sy, tf, r) => s.req.fetchSeries(sy, tf, r), base);
  }
  async serveFetch(m){
    const own = this.sessions.get(m.sessionId), s = own && own.req.fetchSeries ? own : [...this.sessions.values()].find((x) => x.req.fetchSeries);
    if (!s) { this.post({ kind: 'fetchSeriesResult', reqId: m.reqId, bars: [] }); return; }
    try { this.post({ kind: 'fetchSeriesResult', reqId: m.reqId, bars: await this.cachedFetch(s, m) }); }
    catch (e) { this.post({ kind: 'fetchSeriesResult', reqId: m.reqId, error: String((e && e.message) || e) }); }
  }
}
