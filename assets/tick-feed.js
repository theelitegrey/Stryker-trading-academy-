// TICK ENGINE: the page side of the ONE socket per browser (Owner order 2026-11-05). feedJoin(sym, e, q, fn) delivers every trade of sym
// after the chart's bars snapshot (e = epoch, q = seq of its newest trade), exactly once, in order: {type:'tt', symbol, e, q, t:[[px, size,
// side, ts_ms]..]}; or {type:'resync'} (re-read the bars, join again). Who owns the socket, best first:
//   'shared'  a SharedWorker (assets/tick-feed-worker.js), shared by every TradeZoro tab of this browser
//   'leader'  no SharedWorker: the tab holding the Web Lock 'tz-tickfeed' runs the socket; the others talk to it over BroadcastChannel.
//             When the leader tab closes, the next tab takes the lock and every tab joins again from its own last seq.
//   'tab'     neither: this tab's own socket
// Every mode runs the same core (assets/tick-feed-core.js). The page only decodes and draws; a hidden tab keeps receiving (it may skip drawing).
import { TickFeedCore } from './tick-feed-core.js?v=888';

const V = '881';
let mode = '', worker = null, chan = null, core = null, me = Math.random().toString(36).slice(2), seq = 0;
let tokenFn = () => '', urlFn = () => '';
const joins = new Map();   // id -> { sym, e, last, fn, leave }
const lat = [];            // receive - trade time, ms (the last 2000)
const forced = () => { try { return new URLSearchParams(location.search).get('feed') || ''; } catch (e) { return ''; } };   // ?feed=tab|leader|shared (tests)

function onFrame(id, f) {
  const j = joins.get(id); if (!j) return;
  if (f.type === 'tt') {
    const skip = Math.max(0, j.last + 1 - f.q);   // a re-join after a leader change can overlap what this tab already has
    if (skip >= f.t.length) return;
    if (f.q + skip > j.last + 1) { j.last = Infinity; j.fn({ type: 'resync', symbol: j.sym, e: f.e }); return; }
    const t = skip ? f.t.slice(skip) : f.t, now = Date.now();
    for (const x of t) { lat.push(now - x[3]); } if (lat.length > 2000) lat.splice(0, lat.length - 2000);
    j.last = f.q + skip + t.length - 1;
    j.fn(skip ? { type: 'tt', symbol: f.symbol, e: f.e, q: f.q + skip, t } : f);
  } else { if (f.type === 'resync') j.last = Infinity; j.fn(f); }
}
const coreOpts = (state) => ({ WebSocket, url: () => urlFn(), token: () => tokenFn(), onState: state });

function start() {
  if (mode) return;
  const want = forced();
  if ((!want || want === 'shared') && typeof SharedWorker === 'function') {
    try {
      worker = new SharedWorker('/assets/tick-feed-worker.js?v=' + V, { type: 'module', name: 'tz-tickfeed' });
      worker.port.onmessage = (ev) => { const m = ev.data || {}; if (m.id) onFrame(m.id, m.f); else if (m.type === 'needToken') sendToken(true); else if (m.type === 'stats' && statWait.has(m.rid)) { statWait.get(m.rid)(m.stats); statWait.delete(m.rid); } };
      worker.onerror = () => { if (mode === 'shared') fallback(); };
      worker.port.start();
      mode = 'shared';
      // a lock this tab holds until it goes, so the worker can tell a dead tab from a quiet one
      const lock = 'tz-tab-' + me;
      if (navigator.locks) navigator.locks.request(lock, () => new Promise(() => {})).catch(() => {});
      worker.port.postMessage({ op: 'hello', lock: navigator.locks ? lock : '', url: urlFn(), token: tokenFn() });
      setInterval(() => { try { worker.port.postMessage({ op: 'ping', token: tokenFn() }); } catch (e) {} }, 30000);
      addEventListener('pagehide', (e) => { if (!e.persisted) { try { worker.port.postMessage({ op: 'bye' }); } catch (x) {} } });
      return;
    } catch (e) { worker = null; }
  }
  fallback(want);
}
function fallback(want) {
  worker = null;
  if (want !== 'tab' && typeof BroadcastChannel === 'function' && typeof navigator !== 'undefined' && navigator.locks) { mode = 'leader'; leaderMode(); }
  else { mode = 'tab'; core = new TickFeedCore(coreOpts(() => {})); }
  for (const [id, j] of joins) attach(id, j);
}
// ---- 'leader': BroadcastChannel + Web Locks
let leading = false;
function leaderMode() {
  chan = new BroadcastChannel('tz-tickfeed');
  const remote = new Map();   // from|id -> leave
  chan.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.to === me && m.id) { onFrame(m.id, m.f); return; }
    if (m.op === 'leader' && m.from !== me) { for (const [id, j] of joins) attach(id, j); return; }   // a new leader: join again from our own last seq
    if (!leading) return;
    if (m.token && !tokenFn()) pendingToken = m.token;
    const k = m.from + '|' + m.id;
    if (m.op === 'join') { const old = remote.get(k); if (old) old(); remote.set(k, core.join(m.sym, m.e, m.q, (f) => chan.postMessage({ to: m.from, id: m.id, f }))); }
    else if (m.op === 'leave') { const l = remote.get(k); if (l) { l(); remote.delete(k); } }
    else if (m.op === 'bye') { for (const [kk, l] of remote) if (kk.startsWith(m.from + '|')) { l(); remote.delete(kk); } }
    else if (m.op === 'stats' && m.rid) chan.postMessage({ to: m.from, rid: m.rid, stats: Object.assign(core.stats(), { mode: 'leader' }) });
  };
  chan.addEventListener('message', (ev) => { const m = ev.data || {}; if (m.to === me && m.rid && statWait.has(m.rid)) { statWait.get(m.rid)(m.stats); statWait.delete(m.rid); } });
  navigator.locks.request('tz-tickfeed', () => new Promise(() => {
    leading = true;
    core = new TickFeedCore(coreOpts(() => {}));
    for (const [id, j] of joins) attach(id, j);
    chan.postMessage({ op: 'leader', from: me });
  })).catch(() => {});
  addEventListener('pagehide', (e) => { if (!e.persisted) { try { chan.postMessage({ op: 'bye', from: me }); } catch (x) {} } });
}
let pendingToken = '';
function attach(id, j) {
  const q = j.last === Infinity ? null : j.last;
  if (q == null) return;
  if (mode === 'shared') worker.port.postMessage({ op: 'join', id, sym: j.sym, e: j.e, q, token: tokenFn(), url: urlFn() });
  else if (mode === 'leader' && !leading) chan.postMessage({ op: 'join', from: me, id, sym: j.sym, e: j.e, q, token: tokenFn() });
  else if (core) { if (j.leave) j.leave(); j.leave = core.join(j.sym, j.e, q, (f) => onFrame(id, f)); }
}
function sendToken(force) {
  const t = tokenFn();
  if (mode === 'shared' && worker) worker.port.postMessage({ op: 'token', token: t, url: urlFn() });
  if (core && force && t) core.ensure();
}
const statWait = new Map();

// tokenFn(): the member's current ID token ('' = none: no socket), urlFn(): wss://<recorder>/ts-live
export function feedConfig(tok, url) { tokenFn = () => tok() || pendingToken; urlFn = url; }
export function feedJoin(sym, e, q, fn) {
  start();
  const id = me + ':' + (++seq), j = { sym, e, last: q, fn, leave: null };
  joins.set(id, j);
  attach(id, j);
  return () => {
    joins.delete(id);
    if (mode === 'shared' && worker) worker.port.postMessage({ op: 'leave', id });
    else if (mode === 'leader' && !leading) chan.postMessage({ op: 'leave', from: me, id });
    else if (j.leave) j.leave();
  };
}
export const feedTokenChanged = () => sendToken(true);
export function feedStats() {
  const s = lat.slice().sort((a, b) => a - b), pct = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null);
  const local = { mode, leading, joins: joins.size, latency: { n: s.length, p50: pct(0.5), p95: pct(0.95) } };
  const rid = me + '-' + (++seq);
  if (mode === 'shared' && worker) return new Promise((r) => { statWait.set(rid, (st) => r(Object.assign(local, { feed: st }))); worker.port.postMessage({ op: 'stats', rid }); setTimeout(() => { if (statWait.delete(rid)) r(local); }, 1500); });
  if (mode === 'leader' && !leading) return new Promise((r) => { statWait.set(rid, (st) => r(Object.assign(local, { feed: st }))); chan.postMessage({ op: 'stats', from: me, rid }); setTimeout(() => { if (statWait.delete(rid)) r(local); }, 1500); });
  return Promise.resolve(Object.assign(local, { feed: core ? core.stats() : null }));
}
