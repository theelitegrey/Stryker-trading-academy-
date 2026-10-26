// TradeZoro — Charts: Pine "next" engine, Web Worker side (module worker)
// Started by assets/chart-pine-next.js (PineNextEngine). Not loaded by any page directly.
//
// WHY: the Web Worker that ships inside @luxalgo/vela-pinets 0.2.11 inlines an older PineTS
// (0.9.3x) that fails on scripts the newer pinets (0.11.0, pinned in charts.html) runs fine,
// e.g. methods on user-defined types holding a box (`z.bx.set_top(...)`). The page-thread
// fallback (LANG_MAIN in chart-pine.js) runs the newer pinets but blocks the page while a
// heavy script computes. This worker runs vela-pinets' own exported, unmodified PineEngine
// class + pinets 0.11.0 OFF the page thread.
//
// LICENCE (AGPL-3.0): both packages are fetched from jsDelivr at the exact pinned versions
// and run unmodified. The worker cannot use the page's import map (module workers don't
// support import maps), so the two bare import specifiers in vela-pinets' dist/index.js
// ('pinets', '@luxalgo/vela/plugin') are resolved here to the SAME URLs the import map uses;
// that is the import map's job done by hand, nothing else in their code is touched.
//
// PROTOCOL (main <-> worker), all plain structured-clone messages:
//   main -> worker: prepare{reqId,source,instanceId,defaultProps,propsVisibility}
//                   execute{sessionId,req}  update{sessionId,inputs,props}
//                   setVisibleRange{sessionId,range}  notifyBars{sessionId,reason,bars?}
//                   getContext{sessionId,reqId,select}  stop{sessionId}
//                   fetchSeriesResult{reqId,bars|error}
//   worker -> main: ready | loadError{message} | prepared{reqId,prepared|error}
//                   model/alert/warning/error/done{sessionId,...}
//                   contextResult{reqId,snapshot}  fetchSeries{reqId,symbol,timeframe,range}
//
// Static-mode runs are COALESCED per session: while a run is in flight, further bar
// notifications only mark the session dirty, and one re-run happens when it lands (a heavy
// script never queues a backlog of full re-runs on every tick).

const PINETS = 'https://cdn.jsdelivr.net/npm/pinets@0.11.0/dist/pinets.min.browser.es.js';
const VELA_PINETS = 'https://cdn.jsdelivr.net/npm/@luxalgo/vela-pinets@0.2.11/dist/index.js';
// The page passes &vela=090 while the admin 0.9.0 trial is on (same folder as its import map).
const PLUGIN = new URL(/[?&]vela=090\b/.test(self.location.search) ? '/assets/vendor/vela-0.9.0-s4/plugin.js' : '/assets/vendor/vela-0.6.17-s3/plugin.js', self.location.href).href;

const post = (m) => self.postMessage(m);
// BUSY signal: tells the page when a script is computing here ({kind:'busy', on}), so the page
// can pause decorative CSS animations meanwhile (chart-pine-next.js). On a 2-core machine an
// infinite paint animation (header plan badge) made the page commit a frame 60x a second, every
// commit re-uploaded the chart canvases, and that starved this worker: Liquidity Master on 1m
// NQ took ~40 s on the chart page vs ~5 s alone.
const computing = new Set();
function busyOn(s){ const was = computing.size; computing.add(s.id); if (!was) post({ kind: 'busy', on: true }); }
function busyOff(s){ if (!computing.delete(s.id)) return; if (!computing.size) post({ kind: 'busy', on: false }); }
let engine = null;
const sessions = new Map();
const fetchWaits = new Map();
let fetchId = 0;

let rewrite = (src) => src;
const ready = (async () => {
  // O(n) ta.pivothigh/pivotlow (assets/chart-pine-next-patches.js) on pinets' Context.
  const [pinets, patches] = await Promise.all([import(PINETS), import('./chart-pine-next-patches.js?v=687')]);
  try { patches.install(pinets.Context, pinets, self); rewrite = patches.rewriteSource; } catch (e) { console.warn('TradeZoro: pine-next patches', e); }
  const res = await fetch(VELA_PINETS);
  if (!res.ok) throw new Error('Pine engine download failed (' + res.status + ')');
  const text = (await res.text())
    .replace(/from\s*(['"])pinets\1/g, "from '" + PINETS + "'")
    .replace(/from\s*(['"])@luxalgo\/vela\/plugin\1/g, "from '" + PLUGIN + "'");
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  try { return await import(url); } finally { URL.revokeObjectURL(url); }
})();

ready.then(() => post({ kind: 'ready' }), (e) => post({ kind: 'loadError', message: String(e && e.message || e) }));

function engineFor(msg){
  return ready.then((m) => {
    if (!engine) engine = new m.PineEngine({ props: msg.propsVisibility || 'strategy', defaultProps: msg.defaultProps });
    return engine;
  });
}

function fetchSeries(symbol, timeframe, range){
  return new Promise((resolve, reject) => {
    const reqId = ++fetchId;
    fetchWaits.set(reqId, { resolve, reject });
    post({ kind: 'fetchSeries', reqId, symbol, timeframe, range });
  });
}

// One run request for a static session; coalesces while busy.
//
// Settings changes (update{inputs,props}) are NOT ordinary pending jobs. Before build 515
// a change that arrived while a run was in flight was parked as `s.pending` and the next
// live bar tick overwrote it, so the new inputs never reached the engine and the member
// had to reload the page (Owner, 2026-10-12; on 1m futures a tick lands every second, so
// with a heavy script busy it happened on nearly every change). Now changes are merged
// into s.pendInputs/s.pendProps, which no tick can replace, and they run first when the
// in-flight run lands. That run's model was computed with the OLD inputs, so it is
// dropped (s.gen / s.runGen) instead of flashing stale drawings for a moment.
function kick(s, fn){
  if (s.stopped) return;
  if (!s.deferred && !s.busy) s.runStart = Date.now();
  // Still waiting for history: the engine only records the change and won't run (so no
  // done/error will come back); never mark the session busy for it.
  if (s.deferred) { if (fn) fn(); return; }
  if (s.busy) { s.dirty = true; if (fn) s.pending = fn; return; }
  const settings = !!(s.pendInputs || s.pendProps);
  // Another script on this worker has a settings change waiting or running: hold this
  // ordinary bar re-run until it lands, so the change is not stuck behind other scripts'
  // tick re-runs (one heavy script re-running every couple of seconds kept the worker busy).
  if (!settings && settingsBusy(s)) { s.dirty = true; if (fn) s.pending = fn; s.held = true; return; }
  s.busy = true;
  s.runGen = s.gen;
  s.settingsRun = settings;
  if (settings) {
    // A queued settings change wins over whatever else was queued: update() re-runs with
    // the new inputs on the latest bars, which also covers any bar refresh it replaces.
    const inputs = s.pendInputs || {}, props = s.pendProps;
    s.pendInputs = null; s.pendProps = null; s.pending = null; s.dirty = false;
    runStarted(s);
    s.handle.update(inputs, props);
    return;
  }
  runStarted(s);
  (fn || (() => s.handle.notifyBars('tick')))();
}
function settingsBusy(except){
  for (const x of sessions.values()) if (x !== except && !x.stopped && (x.pendInputs || x.pendProps || (x.busy && x.settingsRun))) return true;
  return false;
}
// After a settings run lands, start the bar re-runs that were held for it.
function releaseHeld(){
  if (settingsBusy(null)) return;
  for (const x of sessions.values()) if (x.held && !x.busy && !x.stopped) { x.held = false; const fn = x.pending; x.pending = null; x.dirty = false; kick(x, fn); }
}
function queueSettings(s, inputs, props){
  s.pendInputs = Object.assign(s.pendInputs || {}, inputs || {});
  if (props) s.pendProps = Object.assign(s.pendProps || {}, props);
  s.gen = (s.gen || 0) + 1;      // any run already in flight is now stale
  kick(s, null);
}
// Run counters (read by tools/tests/chart-indicator-settings-apply-browser.js through
// debugState): full (re)computes started vs finished per session. A gap that keeps growing
// means runs are stacking up.
const runs = { started: 0, finished: 0 };
function runStarted(s){ busyOn(s); runs.started++; s.started = (s.started || 0) + 1; }
function runFinished(s){ runs.finished++; s.finished = (s.finished || 0) + 1; }

// LIVE sessions (the normal case on a streaming chart). update() restarts the script's
// stream, i.e. a full recompute of the history that blocks this worker for the whole run
// (Liquidity Master ~3 s, SMT ~2 s on 1m NQ). A stopped stream cannot be interrupted
// mid-run, so every settings event used to queue one more full recompute: three quick
// toggles, a typed "12" ("1" then "12") or a colour drag stacked 3..50 runs, and the
// worker (shared by every script on the chart) stayed blocked for 20 s+; the change
// looked lost and the member reloaded the page (Owner, 2026-10-12). Now changes are
// merged and debounced, and at most ONE restart is in flight: changes that arrive during
// it are merged and applied as a single restart once it has drawn. The latest value
// always wins and is never dropped.
const LIVE_DEBOUNCE_MS = 120;
const RESTART_GUARD_MS = 15000;  // a restart that never draws (no bars yet) can't hold changes back for long
function queueLive(s, inputs, props){
  s.liveInputs = Object.assign(s.liveInputs || {}, inputs || {});
  if (props) s.liveProps = Object.assign(s.liveProps || {}, props);
  clearTimeout(s.liveTimer);
  s.liveTimer = setTimeout(() => applyLive(s), LIVE_DEBOUNCE_MS);
}
function applyLive(s){
  s.liveTimer = null;
  if (s.stopped || !(s.liveInputs || s.liveProps)) return;
  if (s.restarting && Date.now() - s.restarting < RESTART_GUARD_MS) return; // runs when the current restart draws
  const inputs = s.liveInputs || {}, props = s.liveProps;
  s.liveInputs = null; s.liveProps = null;
  s.restarting = Date.now();
  runStarted(s);
  s.handle.update(inputs, props);
}
function restartLanded(s){
  busyOff(s);
  if (!s.restarting) return;
  s.restarting = 0;
  runFinished(s);
  if (s.liveInputs || s.liveProps) applyLive(s);
}
function landed(s){
  busyOff(s);
  if (s.busy) runFinished(s);
  s.busy = false;
  const wasSettings = s.settingsRun; s.settingsRun = false;
  if (s.runStart) { s.runMs = Date.now() - s.runStart; s.doneAt = Date.now(); }
  if ((s.dirty || s.pendInputs || s.pendProps) && !s.stopped) {
    s.dirty = false;
    const fn = s.pending; s.pending = null;
    kick(s, fn);
  }
  if (wasSettings || !s.busy) releaseHeld();
}

// Live ticks on a static (full re-run) session: a heavy script re-running on every tick would
// keep this worker busy and starve the other scripts sharing it. Re-run at most once per
// max(2 s, 3x the last run time) after the previous run ended; ticks in between coalesce.
function tick(s){
  if (s.tickTimer || s.stopped) return;
  const gap = Math.max(2000, 3 * (s.runMs || 0));
  const wait = s.doneAt ? Math.max(0, s.doneAt + gap - Date.now()) : 0;
  const go = () => { s.tickTimer = null; kick(s, () => s.handle.notifyBars()); };
  if (!wait) go(); else s.tickTimer = setTimeout(go, wait);
}

// History grew under a live (streaming) script: 'complete' restarts the stream on the whole
// bar set. Since the scroll-back pager (613) and the Pine depth load (620) one load can
// report 'complete' more than once, and every restart threw away a run that was still
// computing (Liquidity Master on 4k 1m bars needs ~10 s), so the script kept showing its
// first 500-bar result and the session / previous-day levels never appeared. Now the
// 'complete' signals are coalesced (LIVE_COMPLETE_MS) and the stream restarts once, only when
// the bar set really changed (first bar time / count).
const LIVE_COMPLETE_MS = 400;
const barsKey = (b) => b && b.length ? b.length + '|' + b[0].time : '0';
function liveBars(s, reason){
  if (reason !== 'complete') { s.handle.notifyBars(reason); return; }
  clearTimeout(s.completeTimer);
  s.completeTimer = setTimeout(() => {
    s.completeTimer = null;
    if (s.stopped) return;
    const k = barsKey(s.bars);
    if (k === s.liveKey) return;          // same bars the stream already runs on
    s.liveKey = k;
    busyOn(s);
    s.handle.notifyBars('complete');
  }, LIVE_COMPLETE_MS);
}

self.addEventListener('message', async (ev) => {
  const msg = ev.data || {};
  switch (msg.kind) {
    case 'prepare': {
      try {
        const eng = await engineFor(msg);
        post({ kind: 'prepared', reqId: msg.reqId, prepared: await eng.prepare(rewrite(msg.source), msg.instanceId) });
      } catch (e) {
        post({ kind: 'prepared', reqId: msg.reqId, error: String(e && e.message || e) });
      }
      return;
    }
    case 'execute': {
      const id = msg.sessionId;
      const s = { id, bars: msg.req.bars || [], stopped: false, busy: false, dirty: false, pending: null, handle: null, live: msg.req.mode === 'live' };
      sessions.set(id, s);
      let eng;
      try { eng = await engineFor(msg); } catch (e) { post({ kind: 'error', sessionId: id, message: String(e && e.message || e) }); return; }
      if (s.stopped) return;
      const req = Object.assign({}, msg.req, { getBars: () => s.bars, fetchSeries });
      delete req.bars;
      const deferred = req.historyState === 'backfill';
      s.deferred = deferred;
      if (!s.live && !deferred) { s.busy = true; runStarted(s); }
      if (s.live && !deferred) { s.restarting = Date.now(); runStarted(s); s.liveKey = barsKey(s.bars); }
      s.handle = eng.execute(req, {
        // Static runs started before the latest settings change carry the old inputs: drop
        // their model, the queued re-run with the new inputs follows straight after.
        onModel: (model) => {
          if (s.stopped) return;
          if (s.live) { post({ kind: 'model', sessionId: id, model }); restartLanded(s); return; }
          if ((s.runGen || 0) === (s.gen || 0)) post({ kind: 'model', sessionId: id, model });
        },
        onAlert: (alert) => post({ kind: 'alert', sessionId: id, alert }),
        onWarning: (warning) => post({ kind: 'warning', sessionId: id, warning }),
        onError: (e) => { post({ kind: 'error', sessionId: id, message: String(e && e.message || e) }); if (!s.live) landed(s); else restartLanded(s); },
        onDone: () => { post({ kind: 'done', sessionId: id }); if (!s.live) landed(s); }
      });
      // A backfill that never reports 'complete' (feed at its history limit, live ticks only)
      // must not leave the script waiting forever: run on what is loaded after 4 s.
      if (deferred) setTimeout(() => { if (s.deferred && !s.stopped) { s.deferred = false; kick(s, () => s.handle.notifyBars('complete')); } }, 4000);
      return;
    }
    case 'update': {
      const s = sessions.get(msg.sessionId); if (!s || !s.handle) return;
      if (s.live) { queueLive(s, msg.inputs, msg.props); return; }
      else if (s.deferred) s.handle.update(msg.inputs || {}, msg.props); // recorded, runs on 'complete'
      else queueSettings(s, msg.inputs, msg.props);
      return;
    }
    case 'setVisibleRange': {
      const s = sessions.get(msg.sessionId); if (!s || !s.handle) return;
      if (s.live) s.handle.setVisibleRange(msg.range);
      else kick(s, () => s.handle.setVisibleRange(msg.range));
      return;
    }
    case 'notifyBars': {
      const s = sessions.get(msg.sessionId); if (!s || !s.handle) return;
      if (Array.isArray(msg.bars)) s.bars = msg.bars;
      if (msg.reason === 'backfill') return;
      if (s.live) { liveBars(s, msg.reason); return; }
      const reason = msg.reason;
      if (reason === 'complete') s.deferred = false;
      if (!reason) { tick(s); return; }
      kick(s, () => s.handle.notifyBars(reason));
      return;
    }
    case 'getContext': {
      const s = sessions.get(msg.sessionId);
      let snapshot = null;
      try { snapshot = s && s.handle ? await s.handle.getContext(msg.select) : null; } catch (e) {}
      try { post({ kind: 'contextResult', reqId: msg.reqId, snapshot }); }
      catch (e) { post({ kind: 'contextResult', reqId: msg.reqId, snapshot: null }); }
      return;
    }
    case 'stop': {
      const s = sessions.get(msg.sessionId);
      if (s) { busyOff(s); s.stopped = true; clearTimeout(s.tickTimer); clearTimeout(s.liveTimer); try { if (s.handle) s.handle.stop(); } catch (e) {} }
      sessions.delete(msg.sessionId);
      return;
    }
    case 'debugState': {
      // Test/diagnostic only: run counters and per-session scheduler state.
      post({ kind: 'debugState', runs: Object.assign({}, runs), fetches: fetchWaits.size, sessions: [...sessions.values()].map((s) => ({ id: s.id, live: s.live,
        started: s.started || 0, finished: s.finished || 0, busy: !!s.busy, restarting: !!s.restarting, queued: !!(s.pendInputs || s.pendProps || s.liveInputs || s.liveProps) })) });
      return;
    }
    case 'fetchSeriesResult': {
      const w = fetchWaits.get(msg.reqId); if (!w) return;
      fetchWaits.delete(msg.reqId);
      if (msg.error) w.reject(new Error(msg.error)); else w.resolve(msg.bars || []);
      return;
    }
  }
});
