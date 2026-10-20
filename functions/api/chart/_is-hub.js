// One shared InsightSentry WebSocket per Worker isolate, fanned out to every consumer (2026-10-20, "candles
// frozen 1020c"; CoS approved). Before this, EVERY chart socket (stream/[sym].js) and EVERY bars request
// (fetchInsightPage in _bars.js) opened its own upstream socket with our key. InsightSentry limits concurrent
// connections per account and evicts / refuses the extras, so under load an admin's live tail failed and
// the answer fell back to Yahoo rows ~10 min old.
//
// InsightSentry rules this is built around (docs/ws): ONE socket carries many subscriptions; sending a
// new subscription message REPLACES the set, so we always send the full set of legs in use, one request at
// a time (wait for subscription_status), debounced; <= 120 subscription messages / 3 h, so legs are kept
// ~2 min after their last user and the set is only re-sent when a NEW leg appears.
//
// Consumers: hubSubscribe({ key, url, leg, replay, onMessage, onEvent }) -> { close() } | null.
//   leg = { code, bar_type, bar_interval, dp, tz24 }.  onMessage gets series messages for that leg only
//   (same shape the upstream sends, so existing parsers work unchanged); onEvent gets everything else
//   (delivery_status, hub_down / hub_rejected). A new consumer first gets the cached rows of the leg
//   (last `replay`), later ones get the live rows. After a reconnect every consumer is re-primed so a gap
//   is refilled from the new history message.
// null = hub cannot take it (too many legs): the caller uses its own direct socket as before.
// hubHealthy() goes false for 2 min after a consumer waited for data and got none (callers then go direct).

const MAX_LEGS = 14, LEG_IDLE_MS = 120000, MAP_CAP = 1200;
const UNIT = { m: 'minute', min: 'minute', minute: 'minute', h: 'hour', hour: 'hour', s: 'second', sec: 'second', second: 'second', t: 'tick', tick: 'tick', d: 'day', day: 'day' };

const H = { ws: null, state: 'idle', key: '', url: '', legs: new Map(), dirty: false, pendingAt: 0, sendTimer: null, retryN: 0, retryTimer: null, pruneTimer: null, watchTimer: null, lastMsgAt: 0, staleN: 0, badUntil: 0, gen: 0, stats: { connects: 0, msgs: 0, rejected: 0, evicted: 0 } };

export const hubHealthy = () => Date.now() >= H.badUntil;
export const hubNoteTimeout = () => { H.badUntil = Date.now() + 120000; };
export const hubStats = () => ({ state: H.state, legs: [...H.legs.keys()], clients: [...H.legs.values()].reduce((n, l) => n + l.clients.size, 0), ...H.stats, healthy: hubHealthy() });
export function _hubResetForTests() {
  try { if (H.ws) H.ws.close(); } catch (e) {}
  for (const t of ['sendTimer', 'retryTimer', 'pruneTimer', 'watchTimer']) { if (H[t]) clearTimeout(H[t]); H[t] = null; }
  Object.assign(H, { ws: null, state: 'idle', key: '', url: '', legs: new Map(), dirty: false, pendingAt: 0, retryN: 0, lastMsgAt: 0, staleN: 0, badUntil: 0, gen: H.gen + 1 });
  H.stats = { connects: 0, msgs: 0, rejected: 0, evicted: 0 };
}

const legId = (s) => s.code + '|' + s.bar_type + '|' + s.bar_interval;

function matchLeg(msg) {
  const legs = [...H.legs.values()];
  const byCode = msg.code == null ? legs : legs.filter((l) => l.spec.code === msg.code);
  if (byCode.length === 1) return byCode[0];
  const m = /^(\d+)\s*([a-z]+)$/.exec(String(msg.bar_type || '').toLowerCase());
  if (m) { const u = UNIT[m[2]], n = Number(m[1]); const hit = byCode.find((l) => l.spec.bar_type === u && Number(l.spec.bar_interval) === n); if (hit) return hit; }
  return null;
}

function give(c, msg, rows, leg) {
  let out = rows;
  if (!leg.noCache) {
    if (!c.primed) out = rows.slice(-c.replay);
    else if (rows.length > 2) out = rows.slice(-2);   // a repeat of the history for a consumer that already has it
  }
  c.primed = true;
  try { c.onMessage(Object.assign({}, msg, { series: out })); } catch (e) { c.errors = (c.errors || 0) + 1; }
}

function onUpstream(ev) {
  let msg;
  try { msg = JSON.parse(ev.data); } catch (e) { return; }
  H.lastMsgAt = Date.now(); H.staleN = 0; H.retryN = 0; H.stats.msgs++;
  const rows = msg && (Array.isArray(msg.series) ? msg.series : Array.isArray(msg.data) ? msg.data : Array.isArray(msg.bars) ? msg.bars : null);
  if (!rows) {
    const ev2 = String(msg && msg.event || '');
    if (ev2 === 'subscription_status' || /error|reject/i.test(ev2)) { H.pendingAt = 0; }
    const text = JSON.stringify(msg).toLowerCase();
    if (ev2 === 'connection_evicted') { H.stats.evicted++; dropConn('evicted', 20000); return; }
    if (/invalid|unauthori[sz]ed|expired|subscription_expired|websocket_access_required/.test(text)) { H.stats.rejected++; broadcastEvent({ event: 'hub_rejected' }); dropConn('rejected', 60000); return; }
    if (ev2 === 'connection_status') return;
    broadcastEvent(msg);
    if (ev2 === 'subscription_status') trySend();
    return;
  }
  const leg = matchLeg(msg);
  if (!leg) return;
  leg.lastAt = Date.now();
  const clean = [];
  for (const x of rows) {
    if (!x || typeof x !== 'object') continue;
    clean.push(x);
    if (!leg.noCache) { const t = Number(x.time ?? x.t ?? x.timestamp ?? x.bar_time ?? x.start); if (Number.isFinite(t)) leg.rows.set(t, x); }
  }
  if (!leg.noCache && leg.rows.size > MAP_CAP) { const ks = [...leg.rows.keys()].sort((a, b) => a - b); for (let i = 0; i < ks.length - MAP_CAP; i++) leg.rows.delete(ks[i]); }
  leg.meta = Object.assign({}, msg); delete leg.meta.series; delete leg.meta.data; delete leg.meta.bars;
  for (const c of [...leg.clients]) { give(c, msg, clean, leg); if (c.errors > 5) leg.clients.delete(c); }
}

function broadcastEvent(msg) {
  for (const l of H.legs.values()) for (const c of l.clients) { if (c.onEvent) { try { c.onEvent(msg); } catch (e) {} } }
}

function activeSpecs() {
  const out = [];
  for (const l of H.legs.values()) {
    if (l.clients.size || Date.now() - l.idleSince < LEG_IDLE_MS) {
      const s = l.spec;
      out.push({ code: s.code, type: 'series', bar_type: s.bar_type, bar_interval: s.bar_interval, dp: s.dp, '24h': s.tz24 !== false });
    }
  }
  return out;
}

function trySend() {
  if (H.sendTimer) return;
  if (!H.dirty || H.state !== 'open' || !H.ws) return;
  if (H.pendingAt && Date.now() - H.pendingAt < 6000) { H.sendTimer = setTimeout(() => { H.sendTimer = null; trySend(); }, 1000); return; }
  H.sendTimer = setTimeout(() => {
    H.sendTimer = null;
    if (!H.dirty || H.state !== 'open' || !H.ws) return;
    const subs = activeSpecs();
    if (!subs.length) { H.dirty = false; return; }
    H.dirty = false; H.pendingAt = Date.now();
    try { H.ws.send(JSON.stringify({ api_key: H.key, slow_consumer_policy: 'adaptive', subscriptions: subs })); } catch (e) { dropConn('send failed', 2000); }
  }, 150);
}

function connect() {
  if (H.ws) return;
  const myGen = H.gen;
  let ws;
  try { ws = new WebSocket(H.url); } catch (e) { retryLater(1000); return; }
  H.ws = ws; H.state = 'connecting'; H.stats.connects++;
  ws.onopen = () => { if (H.ws !== ws) return; H.state = 'open'; H.lastMsgAt = Date.now(); H.dirty = true; H.pendingAt = 0; trySend(); };
  ws.onmessage = (ev) => { if (H.ws === ws && myGen === H.gen) onUpstream(ev); };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
  ws.onclose = () => {
    if (H.ws !== ws) return;
    H.ws = null; H.state = 'idle'; H.pendingAt = 0;
    for (const l of H.legs.values()) for (const c of l.clients) c.primed = false;   // refill the gap from the next history
    broadcastEvent({ event: 'hub_down' });
    if ([...H.legs.values()].some((l) => l.clients.size)) retryLater();
  };
  startWatch();
}

function dropConn(why, minWait) {
  const ws = H.ws; H.ws = null; H.state = 'idle'; H.pendingAt = 0;
  try { if (ws) { ws.onclose = null; ws.close(); } } catch (e) {}
  for (const l of H.legs.values()) for (const c of l.clients) c.primed = false;
  if ([...H.legs.values()].some((l) => l.clients.size)) retryLater(minWait);
}

function retryLater(minWait = 0) {
  if (H.retryTimer) return;
  H.retryN++;
  const wait = Math.max(minWait, Math.min(30000, 1000 * Math.pow(2, Math.min(H.retryN - 1, 5)))) * (0.8 + Math.random() * 0.4);
  H.retryTimer = setTimeout(() => { H.retryTimer = null; if ([...H.legs.values()].some((l) => l.clients.size)) connect(); }, wait);
}

// No message at all for 2 min (doubling to 15 min while it stays quiet: a closed market) -> new socket.
function startWatch() {
  if (H.watchTimer) return;
  const tick = () => {
    H.watchTimer = null;
    const has = [...H.legs.values()].some((l) => l.clients.size);
    if (!has) return;
    const limit = Math.min(900000, 120000 * Math.pow(2, H.staleN));
    if (H.state === 'open' && Date.now() - H.lastMsgAt > limit) { H.staleN++; H.lastMsgAt = Date.now(); dropConn('stale', 1000); }
    H.watchTimer = setTimeout(tick, 15000);
  };
  H.watchTimer = setTimeout(tick, 15000);
}

function schedulePrune() {
  if (H.pruneTimer) return;
  H.pruneTimer = setTimeout(() => {
    H.pruneTimer = null;
    const now = Date.now();
    for (const [id, l] of H.legs) if (!l.clients.size && now - l.idleSince > LEG_IDLE_MS) H.legs.delete(id);
    if (![...H.legs.values()].some((l) => l.clients.size)) {
      if (!H.legs.size) { const ws = H.ws; H.ws = null; H.state = 'idle'; try { if (ws) { ws.onclose = null; ws.close(); } } catch (e) {} if (H.watchTimer) { clearTimeout(H.watchTimer); H.watchTimer = null; } }
      else schedulePrune();
    } else if ([...H.legs.values()].some((l) => !l.clients.size)) schedulePrune();
  }, LEG_IDLE_MS + 5000);
}

export function hubSubscribe({ key, url, leg, replay = 200, onMessage, onEvent }) {
  if (!key || typeof WebSocket !== 'function') return null;
  if (H.key && H.key !== key) return null;
  H.key = key; H.url = url;
  const id = legId(leg);
  let L = H.legs.get(id);
  if (!L) {
    if (H.legs.size >= MAX_LEGS) {
      const now = Date.now();
      for (const [i, l] of H.legs) if (!l.clients.size && now - l.idleSince > 10000) H.legs.delete(i);
      if (H.legs.size >= MAX_LEGS) return null;
    }
    L = { spec: Object.assign({ tz24: true }, leg), clients: new Set(), rows: new Map(), meta: null, idleSince: Date.now(), lastAt: 0, noCache: leg.bar_type === 'tick' };
    H.legs.set(id, L);
    H.dirty = true;
  }
  const c = { onMessage, onEvent, replay, primed: false, errors: 0 };
  L.clients.add(c);
  // cached rows first (asynchronously, so the caller has its handle)
  if (!L.noCache && L.rows.size && L.meta) {
    const rows = [...L.rows.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    const meta = L.meta;
    Promise.resolve().then(() => { if (L.clients.has(c) && !c.primed) give(c, meta, rows, L); });
  }
  if (!H.ws && !H.retryTimer) connect();
  if (H.dirty) trySend();
  return {
    close() {
      if (!L.clients.delete(c)) return;
      if (!L.clients.size) { L.idleSince = Date.now(); schedulePrune(); }
    }
  };
}
