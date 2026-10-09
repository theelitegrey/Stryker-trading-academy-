// Stryker Trading Academy — Charts: Pine "next" engine, Web Worker side (module worker)
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
const PLUGIN = new URL('/assets/vendor/vela-0.6.17-s3/plugin.js', self.location.href).href;

const post = (m) => self.postMessage(m);
let engine = null;
const sessions = new Map();
const fetchWaits = new Map();
let fetchId = 0;

let rewrite = (src) => src;
const ready = (async () => {
  // O(n) ta.pivothigh/pivotlow (assets/chart-pine-next-patches.js) on pinets' Context.
  const [pinets, patches] = await Promise.all([import(PINETS), import('./chart-pine-next-patches.js?v=481')]);
  try { patches.install(pinets.Context, pinets, self); rewrite = patches.rewriteSource; } catch (e) { console.warn('Stryker: pine-next patches', e); }
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
function kick(s, fn){
  if (s.stopped) return;
  if (!s.deferred && !s.busy) s.runStart = Date.now();
  // Still waiting for history: the engine only records the change and won't run (so no
  // done/error will come back); never mark the session busy for it.
  if (s.deferred) { if (fn) fn(); return; }
  if (s.busy) { s.dirty = true; if (fn) s.pending = fn; return; }
  s.busy = true;
  (fn || (() => s.handle.notifyBars('tick')))();
}
function landed(s){
  s.busy = false;
  if (s.runStart) { s.runMs = Date.now() - s.runStart; s.doneAt = Date.now(); }
  if (s.dirty && !s.stopped) {
    s.dirty = false;
    const fn = s.pending; s.pending = null;
    kick(s, fn);
  }
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
      if (!s.live && !deferred) s.busy = true;
      s.handle = eng.execute(req, {
        onModel: (model) => { if (!s.stopped) post({ kind: 'model', sessionId: id, model }); },
        onAlert: (alert) => post({ kind: 'alert', sessionId: id, alert }),
        onWarning: (warning) => post({ kind: 'warning', sessionId: id, warning }),
        onError: (e) => { post({ kind: 'error', sessionId: id, message: String(e && e.message || e) }); if (!s.live) landed(s); },
        onDone: () => { post({ kind: 'done', sessionId: id }); if (!s.live) landed(s); }
      });
      // A backfill that never reports 'complete' (feed at its history limit, live ticks only)
      // must not leave the script waiting forever: run on what is loaded after 4 s.
      if (deferred) setTimeout(() => { if (s.deferred && !s.stopped) { s.deferred = false; kick(s, () => s.handle.notifyBars('complete')); } }, 4000);
      return;
    }
    case 'update': {
      const s = sessions.get(msg.sessionId); if (!s || !s.handle) return;
      if (s.live) s.handle.update(msg.inputs || {}, msg.props);
      else kick(s, () => s.handle.update(msg.inputs || {}, msg.props));
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
      if (s.live) { s.handle.notifyBars(msg.reason); return; }
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
      if (s) { s.stopped = true; clearTimeout(s.tickTimer); try { if (s.handle) s.handle.stop(); } catch (e) {} }
      sessions.delete(msg.sessionId);
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
