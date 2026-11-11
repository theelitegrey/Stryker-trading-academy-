// Test-only probe: loads the real Zscript worker (so its lockdown runs first), then tries
// every way out of the sandbox and reports what it reached. Never shipped to a page.
import '../../../assets/zs/worker.js?v=954';

const tries = {
  fetch: () => self.fetch('/'),
  protoFetch: () => Object.getPrototypeOf(self).fetch.call(self, '/'),
  importScripts: () => self.importScripts('/x.js'),
  XMLHttpRequest: () => new self.XMLHttpRequest(),
  WebSocket: () => new self.WebSocket('wss://example.invalid'),
  EventSource: () => new self.EventSource('/'),
  indexedDB: () => self.indexedDB.open('x'),
  caches: () => self.caches.open('x'),
  BroadcastChannel: () => new self.BroadcastChannel('x'),
  nestedWorker: () => new self.Worker('/x.js'),
  eval: () => self.eval('1'),
  Function: () => self.Function('return 1')(),
  fnConstructor: () => (() => {}).constructor('return 1')(),
  asyncFnConstructor: () => (async () => {}).constructor('return 1'),
  protoPostMessage: () => Object.getPrototypeOf(Object.getPrototypeOf(self)).postMessage.call(self, { type: 'result', id: 1, out: 'forged' }),
  selfPostMessage: () => self.postMessage({ type: 'result', id: 1, out: 'forged' }),
  MessageChannel: () => new self.MessageChannel(),
  setTimeoutString: () => self.setTimeout('1', 0),
  WebAssembly: () => self.WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
  navigator: () => self.navigator.sendBeacon('/x'),
  protoPollution: () => { Object.prototype.zsPolluted = 1; if (({}).zsPolluted !== 1) throw new Error('blocked'); },
  arrayProtoPollution: () => { Array.prototype.push = () => 0; if ([].push !== Array.prototype.push || [1].push(2) !== 0) throw new Error('blocked'); },
};
const reached = [];
for (const [k, f] of Object.entries(tries)) {
  try { const r = f(); if (r && typeof r.catch === 'function') r.catch(() => {}); reached.push(k); } catch (e) { /* blocked: good */ }
}
// The only door left is the handler the engine installed. Report through the error channel.
throw new Error('ZSPROBE ' + JSON.stringify({ reached }));
