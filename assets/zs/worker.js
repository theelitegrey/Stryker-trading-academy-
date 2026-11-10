// Zscript sandboxed runner (module Web Worker). Started by runner.js; never loaded by a page.
//
// Member scripts from other members run in here. The engine never evaluates member text as
// JavaScript, and this file removes every network / storage / messaging door the worker has
// before it answers a single message. It is also served with its own strict CSP (see
// _headers: connect-src 'none'), so even a bug in the engine cannot reach the network.
//
// PROTOCOL (structured clone):
//   page -> worker  {type:'compile', id, source}
//                   {type:'run', id, program, bars, symbol, timeframe, inputs, allowed, data, securities, lastBarClosed}
//                   {type:'update', id, bar}            (needs an earlier run in this worker)
//                   {type:'session', id}                 -> out {ok, pub}: key for a protected (sealed) script
//                   {type:'run', id, sealed, ...}         protected run: program opened here, never sent back
//                   {type:'open', id, sealed}             protected library script: opened + validated here and HELD; -> out {ok, meta}
//                                                         (meta = titles/inputs/overlay only, same as compile() meta; never the program)
//                   {type:'run', id, held:true, ...}      run the held program
//                   {kind:'zs.data.init'|'zs.data.frames'|'zs.data.live'|'zs.data.notice', ...}   data hub (S3)
//                   {type:'dispose', id}
//   worker -> page  {type:'ready'}
//                   {type:'live', out}                    result of a zs.data.live re-run of the last bar
//                   {type:'notice', ns, state, upgrade, text}
//                   {type:'result', id, out}            (compile: {ok, diagnostics, program, meta})
//                   {type:'error', id, message}
import { compile } from './compiler.js?v=943';
import { Exec, validateProgram } from './vm.js?v=943';
import { framesToData, liveData, rowsToBars } from './frames.js?v=943';
import { session, openSession } from '../creator-seal.js?v=943';

const post = self.postMessage.bind(self);
const MAX_OUT = 32 * 1024 * 1024;
const MAX_IN_SOURCE = 256 * 1024;

// ---- lock the worker down (before the first message is handled) ----
// capture what the lockdown itself needs before the globals are removed
const FnCtor = Function, AsyncFnCtor = (async () => {}).constructor, GenFnCtor = (function* () {}).constructor;
const hasOwn = Object.prototype.hasOwnProperty;
const DOORS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'importScripts', 'indexedDB',
  'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport', 'RTCPeerConnection', 'navigator', 'Request',
  'Notification', 'FileReader', 'FileReaderSync', 'open', 'close', 'storage', 'cookieStore', 'Atomics', 'SharedArrayBuffer',
  'MessageChannel', 'postMessage', 'eval', 'Function', 'WebAssembly', 'setTimeout', 'setInterval', 'queueMicrotask',
  'requestAnimationFrame', 'location', 'origin'];
// Shadow each door on the global AND on every prototype above it, so neither `self.fetch`
// nor `Object.getPrototypeOf(self).postMessage` reaches the real one.
for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
  for (const k of DOORS) {
    if (o !== self && !hasOwn.call(o, k)) continue;
    try { Object.defineProperty(o, k, { value: undefined, configurable: false, writable: false }); } catch (e) {
      try { delete o[k]; } catch (e2) { /* not deletable: covered by the CSP */ }
    }
  }
}
// Function constructors reachable from any function value: close them as well.
try {
  for (const F of [FnCtor, AsyncFnCtor, GenFnCtor]) Object.defineProperty(F.prototype, 'constructor', { value: undefined, writable: false, configurable: false });
} catch (e) { /* best effort */ }
for (const o of [Object.prototype, Array.prototype, FnCtor.prototype, Map.prototype, String.prototype, Number.prototype, Boolean.prototype]) Object.freeze(o);
for (const o of [FnCtor.prototype, AsyncFnCtor.prototype, GenFnCtor.prototype]) Object.freeze(o);

let exec = null;

function size(out) {
  let n = 0;
  for (const p of out.plots || []) n += (p.values ? p.values.length * 8 : 0) + (p.colors ? p.colors.length * 12 : 0) + (p.open ? p.open.length * 32 : 0);
  n += JSON.stringify([out.labels, out.lines, out.boxes, out.tables, out.alerts]).length * 2;
  return n;
}
function transfers(out) {
  const t = [];
  for (const p of out.plots || []) for (const k of ['values', 'open', 'high', 'low', 'close']) if (p[k] && p[k].buffer) t.push(p[k].buffer);
  for (const a of out.alertconditions || []) if (a.values && a.values.buffer) t.push(a.values.buffer);
  return t;
}
function reply(id, out, live) {
  if (out && out.plots && size(out) > MAX_OUT) {
    post({ type: 'result', id, out: { ok: false, error: { code: 'E499', severity: 'error', line: 1, col: 1, message: 'The script output is too large (limit 32 MB).', hint: 'Plot fewer series or create fewer drawings.' }, plots: [], hlines: [], fills: [], labels: [], lines: [], boxes: [], tables: [], alerts: [], alertconditions: [], notices: [], bars: out.bars, ms: out.ms } });
    return;
  }
  post(live ? { type: 'live', out } : { type: 'result', id, out }, transfers(out));
}

// ---- data from the chart's data hub (S3): plain JSON frames pushed in, never fetched ----
const hub = { status: null, frames: new Map() };
const MAX_FRAMES = 5000;
function hubData(times) {
  if (!hub.frames.size || !Array.isArray(times)) return null;
  return framesToData(hub.frames, times);
}
function hubAllowed() {
  const s = hub.status || {};
  return { book: s.book === 'ok', flow: s.flow === 'ok', gex: s.gex === 'ok', opt: s.opt === 'ok' };
}
// the last bar again (a live data frame re-runs only the forming bar)
function lastBar() {
  const B = exec && exec.B; if (!B || !B.n) return null;
  const i = B.n - 1;
  return { time: B.time[i], open: B.open[i], high: B.high[i], low: B.low[i], close: B.close[i], volume: B.volume[i] };
}

// ---- protected scripts (S4): the program arrives sealed to a key that lives only here ----
let sessionKey = null;
let held = null;   // an opened protected program (type 'open'); lives only in this worker
const META_KEYS = ['title', 'shorttitle', 'overlay', 'precision', 'inputs', 'needs', 'securities', 'plots', 'alertconditions'];
async function openSealed(sealed) {
  if (!sessionKey) throw Object.assign(new Error('no session key'), { code: 'E499' });
  const text = await openSession(sessionKey, sealed);
  const obj = JSON.parse(text);
  // {kind:'zsbin', sid?, program} (S4) or {v, program}; the program is never posted back to the page
  if (!obj || typeof obj !== 'object' || !obj.program) throw Object.assign(new Error('The protected script could not be opened.'), { code: 'E499' });
  return obj.program;
}

async function handle(m, id) {
  switch (m.type) {
    case 'compile': {
      if (typeof m.source !== 'string' || m.source.length > MAX_IN_SOURCE) { post({ type: 'error', id, message: 'source must be text under 256 KB' }); return; }
      post({ type: 'result', id, out: compile(m.source) });
      return;
    }
    case 'session': {
      const s = await session();
      sessionKey = s.privateKey;     // non-extractable; never leaves the worker
      post({ type: 'result', id, out: { ok: true, pub: s.pub } });
      return;
    }
    case 'open': {
      const p = validateProgram(await openSealed(m.sealed));
      held = p;
      const meta = {}; for (const k of META_KEYS) if (p.meta && p.meta[k] !== undefined) meta[k] = p.meta[k];
      post({ type: 'result', id, out: { ok: true, meta: JSON.parse(JSON.stringify(meta)) } });
      return;
    }
    case 'run': {
      if (m.held && !held) { post({ type: 'error', id, message: 'The protected script is not open.' }); return; }
      const program = m.held ? held : m.sealed ? await openSealed(m.sealed) : m.program;
      const times = m.bars && Array.isArray(m.bars.time) ? m.bars.time : null;
      const data = m.data && Object.keys(m.data).length ? m.data : (hubData(times) || {});
      const allowed = m.allowed && Object.keys(m.allowed).length ? m.allowed : hubAllowed();
      const securities = {};
      if (m.securities && typeof m.securities === 'object') for (const k of Object.keys(m.securities)) { const v = m.securities[k]; if (v && v.bars) securities[k] = { bars: Array.isArray(v.bars) ? rowsToBars(v.bars) : v.bars }; }
      exec = new Exec(program, { symbol: m.symbol, timeframe: m.timeframe, inputs: m.inputs, allowed, data, securities, lastBarClosed: m.lastBarClosed });
      reply(id, exec.run(m.bars));
      return;
    }
    case 'update': {
      if (!exec) { post({ type: 'error', id, message: 'update before run' }); return; }
      reply(id, exec.update(m.bar));
      return;
    }
    case 'zs.data.init': hub.status = m.status && typeof m.status === 'object' ? m.status : null; if (m.reset !== false) hub.frames.clear(); return;
    case 'zs.data.frames': {
      if (m.reset) hub.frames.clear();
      if (Array.isArray(m.frames)) for (const r of m.frames) if (Array.isArray(r) && typeof r[0] === 'number') hub.frames.set(r[0], r[1] || null);
      while (hub.frames.size > MAX_FRAMES) hub.frames.delete(hub.frames.keys().next().value);
      return;
    }
    case 'zs.data.live': {
      // the forming bar's frame: re-run the last bar only, and push the result as a live result
      if (typeof m.t === 'number') hub.frames.set(m.t, m.frame || null);
      const bar = lastBar();
      if (!bar || bar.time !== m.t) return;
      const d = liveData(m.frame);
      reply(0, exec.update(d ? Object.assign(bar, { data: d }) : bar), true);
      return;
    }
    case 'zs.data.notice': if (typeof m.text === 'string') post({ type: 'notice', ns: String(m.ns || ''), state: String(m.state || ''), upgrade: m.upgrade || null, text: m.text.slice(0, 300) }); return;
    case 'dispose': exec = null; sessionKey = null; held = null; hub.frames.clear(); hub.status = null; post({ type: 'result', id, out: { ok: true } }); return;
    default: post({ type: 'error', id, message: 'unknown message' });
  }
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (!m || typeof m !== 'object') return;
  if (typeof m.type !== 'string' && typeof m.kind === 'string') m.type = m.kind;   // S3 hub messages use `kind`
  if (typeof m.type !== 'string') return;
  const id = Number.isInteger(m.id) ? m.id : 0;
  handle(m, id).catch((e) => {
    // Invalid program or input: report a plain message, never the stack.
    post({ type: 'error', id, message: e && e.code ? String(e.message) : 'The script could not run.' });
  });
};
post({ type: 'ready' });
