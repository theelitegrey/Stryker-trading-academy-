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
//                   {type:'dispose', id}
//   worker -> page  {type:'ready'}
//                   {type:'result', id, out}            (compile: {ok, diagnostics, program, meta})
//                   {type:'error', id, message}
import { compile } from './compiler.js?v=895';
import { Exec } from './vm.js?v=895';

const post = self.postMessage.bind(self);
const MAX_OUT = 32 * 1024 * 1024;
const MAX_IN_SOURCE = 256 * 1024;

// ---- lock the worker down (before the first message is handled) ----
const DOORS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'importScripts', 'indexedDB',
  'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport', 'RTCPeerConnection', 'navigator', 'Request',
  'Notification', 'FileReader', 'FileReaderSync', 'open', 'close', 'storage', 'cookieStore', 'Atomics', 'SharedArrayBuffer',
  'MessageChannel', 'postMessage', 'eval', 'Function', 'WebAssembly', 'setTimeout', 'setInterval', 'queueMicrotask',
  'requestAnimationFrame', 'location', 'origin'];
for (const k of DOORS) {
  try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch (e) {
    try { delete self[k]; } catch (e2) { /* not deletable: covered by the CSP */ }
  }
}
// Function constructors reachable from any function value: close them as well.
try {
  const AsyncFn = (async () => {}).constructor, GenFn = (function* () {}).constructor;
  for (const F of [Function, AsyncFn, GenFn]) Object.defineProperty(F.prototype, 'constructor', { value: undefined, writable: false, configurable: false });
} catch (e) { /* best effort */ }
for (const o of [Object.prototype, Array.prototype, Function.prototype, Map.prototype, String.prototype, Number.prototype, Boolean.prototype]) Object.freeze(o);

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
function reply(id, out) {
  if (out && out.plots && size(out) > MAX_OUT) {
    post({ type: 'result', id, out: { ok: false, error: { code: 'E499', severity: 'error', line: 1, col: 1, message: 'The script output is too large (limit 32 MB).', hint: 'Plot fewer series or create fewer drawings.' }, plots: [], hlines: [], fills: [], labels: [], lines: [], boxes: [], tables: [], alerts: [], alertconditions: [], notices: [], bars: out.bars, ms: out.ms } });
    return;
  }
  post({ type: 'result', id, out }, transfers(out));
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
  const id = Number.isInteger(m.id) ? m.id : 0;
  try {
    switch (m.type) {
      case 'compile': {
        if (typeof m.source !== 'string' || m.source.length > MAX_IN_SOURCE) { post({ type: 'error', id, message: 'source must be text under 256 KB' }); return; }
        post({ type: 'result', id, out: compile(m.source) });
        return;
      }
      case 'run': {
        exec = new Exec(m.program, { symbol: m.symbol, timeframe: m.timeframe, inputs: m.inputs, allowed: m.allowed, data: m.data, securities: m.securities, lastBarClosed: m.lastBarClosed });
        reply(id, exec.run(m.bars));
        return;
      }
      case 'update': {
        if (!exec) { post({ type: 'error', id, message: 'update before run' }); return; }
        reply(id, exec.update(m.bar));
        return;
      }
      case 'dispose': exec = null; post({ type: 'result', id, out: { ok: true } }); return;
      default: post({ type: 'error', id, message: 'unknown message' });
    }
  } catch (e) {
    // Invalid program or input: report a plain message, never the stack.
    post({ type: 'error', id, message: e && e.code ? String(e.message) : 'The script could not run.' });
  }
};
post({ type: 'ready' });
