// TradeZoro — Charts: Pine "next" engine, page side (ES module)
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

const WORKER_URL = new URL('./chart-pine-next-worker.js?v=740' + (typeof window !== 'undefined' && window.__stkVela090 === true ? '&vela=090' : ''), import.meta.url);

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

// LANES (job "indicator engine speed 1030"). Before, ONE worker served every script on the chart: a new
// script's first run queued behind the other scripts' first runs and their re-runs, and that wait counted
// against its 20 s limit. Now every script gets its own worker ("lane") while lanes are below LANE_CAP;
// beyond the cap a script shares the least-loaded lane. A slow script can then only ever stall its own lane.
//   cap = hardwareConcurrency - 1, at least 2, at most 6 on desktop and 4 on phones.
// window.__stkPineLanes (a number) overrides the cap (tests / support).
export function laneCap(){
  try {
    if (typeof window !== 'undefined' && Number(window.__stkPineLanes) > 0) return Math.floor(Number(window.__stkPineLanes));
    const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    const phone = typeof window !== 'undefined' && (window.innerWidth < 700 || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches));
    return Math.max(2, Math.min(phone ? 4 : 6, hw - 1));
  } catch (e) { return 2; }
}
// Bars budget: a script is handed at most this many of the newest bars (a phone has less memory and CPU).
// The chart keeps all its bars; only the script's input is trimmed. Exported for tests.
export function barsBudget(){
  try {
    const phone = typeof window !== 'undefined' && (window.innerWidth < 700 || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches));
    if (typeof window !== 'undefined' && Number(window.__stkPineBars) > 0) return Math.floor(Number(window.__stkPineBars));
    return phone ? 2000 : 5000;
  } catch (e) { return 5000; }
}
export const FIRST_START_LIMIT_MS = 45000;   // worker boot + script download/compile + queue, before its run begins
export const FIRST_RUN_LIMIT_MS = 40000;     // the script's OWN compute time for its first draw (clock starts at 'started')

export class PineNextEngine {
  constructor(opts = {}){
    this.language = 'pine-next';
    this.capabilities = { streaming: true, visibleRange: true, inputs: true, props: true };
    this.opts = opts;
    this.lanes = [];            // [{ id, worker, sessions:Set, prepares:Map }]
    this.laneSeq = 0;
    this.reqId = 0;
    this.sessionId = 0;
    this.sessions = new Map();  // sessionId -> { req, handlers, barsOf, live, lastTime, lane, instanceId }
    this.ctxWaits = new Map();
    this.claims = [];           // watchers waiting for their script's prepare()
    this.stats = { started: 0, models: 0, lanesMade: 0 };
  }
  // A lane = one module Worker. spawn() starts it; message / error handlers are bound to the lane.
  spawn(){
    const lane = { id: ++this.laneSeq, worker: null, sessions: new Set(), prepares: new Map(), spawnedAt: Date.now() };
    const w = new Worker(WORKER_URL, { type: 'module', name: 'stryker-pine-next-' + lane.id });
    lane.worker = w;
    w.addEventListener('message', (e) => this.onMessage(e.data || {}, lane));
    w.addEventListener('error', (e) => {
      const msg = (e && e.message) || 'Pine engine failed to start';
      lane.prepares.forEach((p) => p.reject(new Error(msg))); lane.prepares.clear();
      lane.sessions.forEach((id) => { const s = this.sessions.get(id); try { s && s.handlers.onError && s.handlers.onError(new Error(msg)); } catch (x) {} });
    });
    this.lanes.push(lane);
    this.stats.lanesMade++;
    return lane;
  }
  // Pick the lane for a NEW script: its own lane while below the cap, else the least-loaded one.
  pickLane(){
    const idle = this.lanes.find((l) => !l.sessions.size && !l.prepares.size);
    if (idle) return idle;
    if (this.lanes.length < laneCap()) return this.spawn();
    return this.lanes.slice().sort((a, b) => (a.sessions.size + a.prepares.size) - (b.sessions.size + b.prepares.size))[0];
  }
  lanePost(lane, m){ if (lane.worker) lane.worker.postMessage(m); }
  killLane(lane){
    setBusy(lane, false);
    this.lanes = this.lanes.filter((l) => l !== lane);
    const w = lane.worker; lane.worker = null;
    try { w && w.terminate(); } catch (e) {}
  }
  retire(){   // drop every worker (no scripts left)
    this.lanes.slice().forEach((l) => this.killLane(l));
    this.ctxWaits.forEach((r) => r(null)); this.ctxWaits.clear();
  }
  // Time limits measured on the script's OWN compute (see chart-pine.js): watch(source, cb) arms a claim that
  // prepare() binds to the script's indicator id; the 'started' message from its worker starts the run clock.
  watch(source, onTimeout, limits){
    const c = { source, onTimeout, instanceId: null, startLimit: (limits && limits.start) || FIRST_START_LIMIT_MS, runLimit: (limits && limits.run) || FIRST_RUN_LIMIT_MS,
      t0: Date.now(), runStartedAt: 0, done: false, timer: 0, lane: null };
    const fire = (reason) => { if (c.done) return; c.done = true; clearTimeout(c.timer); this.claims = this.claims.filter((x) => x !== c);
      try { c.onTimeout({ reason, waitedMs: (c.runStartedAt || Date.now()) - c.t0, ranMs: c.runStartedAt ? Date.now() - c.runStartedAt : 0 }); } catch (e) {} };
    c.fire = fire;
    c.timer = setTimeout(() => fire('start'), c.startLimit);
    this.claims.push(c);
    return {
      cancel: () => { c.done = true; clearTimeout(c.timer); this.claims = this.claims.filter((x) => x !== c); },
      info: () => ({ waitedMs: (c.runStartedAt || Date.now()) - c.t0, ranMs: c.runStartedAt ? Date.now() - c.runStartedAt : 0, instanceId: c.instanceId }),
      kill: () => this.killFor(c)
    };
  }
  claimOf(sessionId){ const s = this.sessions.get(sessionId); return s ? this.claims.find((c) => c.instanceId && c.instanceId === s.instanceId) : null; }
  // Stop ONLY the lane this claim's script runs on. Returns the ids of OTHER scripts that shared the lane
  // (they lost their worker; the caller re-adds just those), [] when the script had a lane to itself.
  killFor(c){
    const lane = c.lane || (this.lanes.find((l) => [...l.sessions].some((id) => (this.sessions.get(id) || {}).instanceId === c.instanceId)));
    if (!lane) return [];
    const others = [];
    lane.sessions.forEach((id) => { const s = this.sessions.get(id); if (s && s.instanceId !== c.instanceId) others.push(s.instanceId); this.sessions.delete(id); });
    lane.prepares.forEach((p) => { try { p.reject(new Error('stopped')); } catch (e) {} });
    this.killLane(lane);
    this.holdOthers(false);
    return others;
  }
  // While a newly added script draws for the first time, the other lanes pause their periodic re-runs (they
  // keep what they already show); they resume as soon as that first draw lands or after HOLD_GUARD_MS.
  holdOthers(on, except){
    this.lanes.forEach((l) => { if (l !== except) this.lanePost(l, { kind: 'hold', on: !!on }); });
    clearTimeout(this.holdTimer);
    if (on) this.holdTimer = setTimeout(() => this.holdOthers(false), 50000);
  }
  prepare(source, instanceId){
    const reqId = ++this.reqId;
    const lane = this.pickLane();
    const claim = this.claims.find((c) => !c.instanceId && c.source === source);
    if (claim) { claim.instanceId = instanceId; claim.lane = lane; }
    this.pendingLane = { instanceId, lane };
    return new Promise((resolve, reject) => {
      lane.prepares.set(reqId, { resolve, reject });
      this.lanePost(lane, { kind: 'prepare', reqId, source, instanceId, defaultProps: this.opts.defaultProps, propsVisibility: this.opts.props || 'strategy' });
    });
  }
  execute(req, handlers){
    const sessionId = ++this.sessionId;
    const cap = barsBudget();
    const barsOfAll = () => (req.getBars ? req.getBars() : req.bars) || [];
    const barsOf = () => { const b = barsOfAll(); return b.length > cap ? b.slice(b.length - cap) : b; };
    const instanceId = req.prepared && req.prepared.token && req.prepared.token.instanceId;
    // the lane the script was prepared on (prepare() chose it); a restored script prepared earlier keeps it
    let lane = this.pendingLane && this.pendingLane.instanceId === instanceId ? this.pendingLane.lane : null;
    if (!lane || !this.lanes.includes(lane)) lane = this.pickLane();
    const s = { req, handlers, barsOf, live: req.mode === 'live', lastTime: 0, lane, instanceId, first: true };
    this.sessions.set(sessionId, s);
    lane.sessions.add(sessionId);
    if (req.historyState !== 'backfill' && this.lanes.length > 1) this.holdOthers(true, lane);
    const bars = barsOf();
    s.lastTime = bars.length ? bars[bars.length - 1].time : 0;
    const plain = {
      prepared: req.prepared, market: req.market, bars, inputs: Object.assign({}, req.inputs || {}),
      props: req.props ? Object.assign({}, req.props) : undefined, visibleRange: req.visibleRange,
      mode: s.live ? 'live' : 'static', historyState: req.historyState
    };
    this.lanePost(lane, { kind: 'execute', sessionId, req: plain });
    return {
      getContext: (select) => new Promise((resolve) => {
        const reqId = ++this.reqId;
        this.ctxWaits.set(reqId, resolve);
        this.lanePost(lane, { kind: 'getContext', sessionId, reqId, select });
      }),
      stop: () => {
        this.lanePost(lane, { kind: 'stop', sessionId }); this.sessions.delete(sessionId); lane.sessions.delete(sessionId);
        // A run already in progress cannot be interrupted inside the worker; it would finish in the
        // background and delay the next script on that lane. A lane with no scripts left is dropped; the
        // next add starts a fresh one (pinets comes from the HTTP cache).
        if (!lane.sessions.size && !lane.prepares.size) this.killLane(lane);
        if (s.first) { s.first = false; if (![...this.sessions.values()].some((x) => x.first)) this.holdOthers(false); }
      },
      update: (inputs, props) => this.lanePost(lane, { kind: 'update', sessionId, inputs: Object.assign({}, inputs || {}), props: props ? Object.assign({}, props) : undefined }),
      setVisibleRange: (range) => this.lanePost(lane, { kind: 'setVisibleRange', sessionId, range }),
      notifyBars: (reason) => {
        if (reason === 'backfill') return;
        this.lanePost(lane, { kind: 'notifyBars', sessionId, reason, bars: barsOf() });
      }
    };
  }
  terminate(){ this.lanes.slice().forEach((l) => this.killLane(l)); this.sessions.clear(); }
  firstDone(s){
    if (!s || !s.first) return;
    s.first = false;
    if (![...this.sessions.values()].some((x) => x.first)) this.holdOthers(false);
  }
  onMessage(m, lane){
    switch (m.kind) {
      case 'prepared': {
        const p = lane.prepares.get(m.reqId); if (!p) return;
        lane.prepares.delete(m.reqId);
        if (m.error) { p.reject(new Error(m.error)); if (!lane.sessions.size && !lane.prepares.size && this.lanes.length > 1) this.killLane(lane); }
        else p.resolve(m.prepared);
        return;
      }
      case 'loadError': {
        const err = new Error(m.message || 'Pine engine did not load');
        lane.prepares.forEach((p) => p.reject(err)); lane.prepares.clear();
        return;
      }
      case 'started': {   // the script's own run began in its worker: start the run clock
        const c = this.claimOf(m.sessionId); this.stats.started++;
        if (c && !c.runStartedAt) { c.runStartedAt = Date.now(); clearTimeout(c.timer); c.timer = setTimeout(() => c.fire('run'), c.runLimit); }
        return;
      }
      case 'model': {
        const s = this.sessions.get(m.sessionId); if (!s) return;
        this.stats.models++;
        const c = this.claimOf(m.sessionId); if (c) { c.done = true; clearTimeout(c.timer); this.claims = this.claims.filter((x) => x !== c); }
        s.handlers.onModel(m.model); this.firstDone(s); return;
      }
      case 'alert': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onAlert) s.handlers.onAlert(m.alert); try { if (this.opts.onAlert) this.opts.onAlert(m.alert, s); } catch (e) {} return; }
      case 'warning': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onWarning) s.handlers.onWarning(m.warning); return; }
      case 'error': { const s = this.sessions.get(m.sessionId); this.firstDone(s); if (s && s.handlers.onError) s.handlers.onError(new Error(m.message)); return; }
      case 'busy': setBusy(lane, !!m.on); return;
      case 'done': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onDone) s.handlers.onDone(); return; }
      case 'contextResult': { const w = this.ctxWaits.get(m.reqId); this.ctxWaits.delete(m.reqId); if (w) w(m.snapshot); return; }
      case 'fetchSeries': this.serveFetch(m, lane); return;
    }
  }
  async serveFetch(m, lane){
    const s = [...this.sessions.values()].find((x) => x.lane === lane && x.req.fetchSeries) || [...this.sessions.values()].find((x) => x.req.fetchSeries);
    if (!s) { this.lanePost(lane, { kind: 'fetchSeriesResult', reqId: m.reqId, bars: [] }); return; }
    try { this.lanePost(lane, { kind: 'fetchSeriesResult', reqId: m.reqId, bars: await s.req.fetchSeries(m.symbol, m.timeframe, clampRange(m.range, m.timeframe, s.barsOf())) }); }
    catch (e) { this.lanePost(lane, { kind: 'fetchSeriesResult', reqId: m.reqId, error: String((e && e.message) || e) }); }
  }
}
