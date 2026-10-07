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

const WORKER_URL = new URL('./chart-pine-next-worker.js?v=455', import.meta.url);

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
      stop: () => { this.post({ kind: 'stop', sessionId }); this.sessions.delete(sessionId); },
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
    try { this.post({ kind: 'fetchSeriesResult', reqId: m.reqId, bars: await s.req.fetchSeries(m.symbol, m.timeframe, m.range) }); }
    catch (e) { this.post({ kind: 'fetchSeriesResult', reqId: m.reqId, error: String((e && e.message) || e) }); }
  }
}
