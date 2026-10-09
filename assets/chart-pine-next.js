// Stryker Trading Academy — Charts: Pine "next" engine, page side (ES module)
// Imported by assets/chart-pine.js. The worker half is assets/chart-pine-next-worker.js;
// read its header for why this exists (newer pinets OFF the page thread).
//
// PineNextEngine implements the same engine interface Vela calls on vela-pinets'
// PineWorkerEngine (language, capabilities, prepare, execute -> handle with getContext,
// stop, update, setVisibleRange, notifyBars). It is registered per chart under the
// language id 'pine-next'. One module worker per chart cell.
//
// Bars: Vela hands execute() a getBars() function; a worker can't call it, so every
// non-backfill bar notification ships a fresh snapshot (same as vela-pinets' own worker).
// Bursts are coalesced on the worker side (one re-run after the in-flight one lands).

const WORKER_URL = new URL('./chart-pine-next-worker.js?v=482', import.meta.url);

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

export class PineNextEngine {
  constructor(opts = {}){
    this.language = 'pine-next';
    this.capabilities = { streaming: true, visibleRange: true, inputs: true, props: true };
    this.opts = opts;
    this.worker = null;
    this.reqId = 0;
    this.sessionId = 0;
    this.prepares = new Map();
    this.sessions = new Map();
    this.ctxWaits = new Map();
  }
  w(){
    if (!this.worker) {
      this.worker = new Worker(WORKER_URL, { type: 'module', name: 'stryker-pine-next' });
      this.worker.addEventListener('message', (e) => this.onMessage(e.data || {}));
      this.worker.addEventListener('error', (e) => {
        const msg = (e && e.message) || 'Pine engine failed to start';
        this.prepares.forEach((p) => p.reject(new Error(msg))); this.prepares.clear();
        this.sessions.forEach((s) => { try { s.handlers.onError && s.handlers.onError(new Error(msg)); } catch (x) {} });
      });
    }
    return this.worker;
  }
  post(m){ this.w().postMessage(m); }
  retire(){
    const w = this.worker; if (!w) return;
    this.worker = null;
    this.ctxWaits.forEach((r) => r(null)); this.ctxWaits.clear();
    try { w.terminate(); } catch (e) {}
  }
  prepare(source, instanceId){
    const reqId = ++this.reqId;
    return new Promise((resolve, reject) => {
      this.prepares.set(reqId, { resolve, reject });
      this.post({ kind: 'prepare', reqId, source, instanceId, defaultProps: this.opts.defaultProps, propsVisibility: this.opts.props || 'strategy' });
    });
  }
  execute(req, handlers){
    const sessionId = ++this.sessionId;
    const barsOf = () => (req.getBars ? req.getBars() : req.bars) || [];
    const s = { req, handlers, barsOf, live: req.mode === 'live', lastTime: 0 };
    this.sessions.set(sessionId, s);
    const bars = barsOf();
    s.lastTime = bars.length ? bars[bars.length - 1].time : 0;
    const plain = {
      prepared: req.prepared, market: req.market, bars, inputs: Object.assign({}, req.inputs || {}),
      props: req.props ? Object.assign({}, req.props) : undefined, visibleRange: req.visibleRange,
      mode: s.live ? 'live' : 'static', historyState: req.historyState
    };
    this.post({ kind: 'execute', sessionId, req: plain });
    return {
      getContext: (select) => new Promise((resolve) => {
        const reqId = ++this.reqId;
        this.ctxWaits.set(reqId, resolve);
        this.post({ kind: 'getContext', sessionId, reqId, select });
      }),
      stop: () => {
        this.post({ kind: 'stop', sessionId }); this.sessions.delete(sessionId);
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
        this.post({ kind: 'notifyBars', sessionId, reason, bars: barsOf() });
      }
    };
  }
  terminate(){ try { if (this.worker) this.worker.terminate(); } catch (e) {} this.worker = null; }
  onMessage(m){
    switch (m.kind) {
      case 'prepared': {
        const p = this.prepares.get(m.reqId); if (!p) return;
        this.prepares.delete(m.reqId);
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m.prepared);
        return;
      }
      case 'loadError': {
        const err = new Error(m.message || 'Pine engine did not load');
        this.prepares.forEach((p) => p.reject(err)); this.prepares.clear();
        return;
      }
      case 'model': { const s = this.sessions.get(m.sessionId); if (s) s.handlers.onModel(m.model); return; }
      case 'alert': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onAlert) s.handlers.onAlert(m.alert); return; }
      case 'warning': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onWarning) s.handlers.onWarning(m.warning); return; }
      case 'error': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onError) s.handlers.onError(new Error(m.message)); return; }
      case 'done': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onDone) s.handlers.onDone(); return; }
      case 'contextResult': { const w = this.ctxWaits.get(m.reqId); this.ctxWaits.delete(m.reqId); if (w) w(m.snapshot); return; }
      case 'fetchSeries': this.serveFetch(m); return;
    }
  }
  async serveFetch(m){
    const s = [...this.sessions.values()].find((x) => x.req.fetchSeries);
    if (!s) { this.post({ kind: 'fetchSeriesResult', reqId: m.reqId, bars: [] }); return; }
    try { this.post({ kind: 'fetchSeriesResult', reqId: m.reqId, bars: await s.req.fetchSeries(m.symbol, m.timeframe, clampRange(m.range, m.timeframe, s.barsOf())) }); }
    catch (e) { this.post({ kind: 'fetchSeriesResult', reqId: m.reqId, error: String((e && e.message) || e) }); }
  }
}
