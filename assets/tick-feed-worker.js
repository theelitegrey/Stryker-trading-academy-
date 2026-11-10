// TICK ENGINE: the SharedWorker that owns the browser's ONE /ts-live socket for every TradeZoro chart tab (assets/tick-feed.js
// starts it; assets/tick-feed-core.js does the socket, seq and replay work). Lives while any tab is connected, background tabs
// included. A tab says 'bye' on pagehide; a tab that dies without it is noticed through its Web Lock (released when the tab goes),
// or after 150 s of silence where Web Locks are missing.
import { TickFeedCore } from './tick-feed-core.js?v=947';

const ports = new Map();   // port -> { joins: Map(id -> leave), seen, lock }
let token = '', url = '';
const all = (m) => { for (const p of ports.keys()) { try { p.postMessage(m); } catch (e) {} } };
const core = new TickFeedCore({ WebSocket, url: () => url, token: () => token, needToken: () => { token = ''; all({ type: 'needToken' }); }, onState: (s) => all(s) });

function drop(port) {
  const P = ports.get(port); if (!P) return;
  for (const leave of P.joins.values()) leave();
  ports.delete(port);
}
function handle(port, P, m) {
  P.seen = Date.now();
  if (!m || typeof m !== 'object') return;
  if (m.token) token = String(m.token);
  if (m.url) url = String(m.url);
  if (m.op === 'hello') { P.lock = m.lock || ''; port.postMessage({ type: 'hello', stats: core.stats() }); }
  else if (m.op === 'token') { if (core.retryH) { clearTimeout(core.retryH); core.retryH = null; } core.ensure(); }
  else if (m.op === 'join') { const old = P.joins.get(m.id); if (old) old(); P.joins.set(m.id, core.join(m.sym, m.e, m.q, (f) => { try { port.postMessage({ id: m.id, f }); } catch (e) {} })); }
  else if (m.op === 'leave') { const l = P.joins.get(m.id); if (l) { l(); P.joins.delete(m.id); } }
  else if (m.op === 'bye') drop(port);
  else if (m.op === 'stats') port.postMessage({ type: 'stats', rid: m.rid, stats: Object.assign(core.stats(), { ports: ports.size, mode: 'shared' }) });
}
self.onconnect = (e) => {
  const port = e.ports[0], P = { joins: new Map(), seen: Date.now(), lock: '' };
  ports.set(port, P);
  port.onmessage = (ev) => handle(port, P, ev.data);
  port.start();
};
setInterval(async () => {
  let held = null;
  try { if (self.navigator && navigator.locks && navigator.locks.query) { const q = await navigator.locks.query(); held = new Set((q.held || []).map((x) => x.name)); } } catch (e) { held = null; }
  const now = Date.now();
  for (const [port, P] of ports) if (held && P.lock ? !held.has(P.lock) : now - P.seen > 150000) drop(port);
}, 10000);
