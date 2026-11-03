// cTrader Open API relay core (pure, testable). DATA ONLY: view-only market data for a signed-in member.
// The browser cannot hold the app's client secret, and every Open API connection must send it, so the secret lives here.
// Stores NOTHING and logs NOTHING (no tokens, no prices, no env). Tested by tools/tests/ctrader.test.mjs.
//
// Client -> cTrader: each frame is parsed ONCE, checked against a per-type schema, and REBUILT from the parsed values
// (never forwarded raw: duplicate JSON keys cannot smuggle a second payloadType). Unknown type / key / shape = socket closed.
// cTrader -> client: only the matching responses/events; rebuilt too; anything holding the secret is dropped.

// payloadType -> { key: kind }. Kinds: i = integer, b = bool, ids = integer array, tok = access token, per = trendbar period 1..14, q = 1|2.
const P = 'ctidTraderAccountId';
export const CLIENT_ALLOW = {
  2102: { [P]: 'i!', accessToken: 'tok!' },                       // AccountAuth
  2149: { accessToken: 'tok!' },                                   // GetAccountListByAccessToken
  2114: { [P]: 'i!', includeArchivedSymbols: 'b' },                // SymbolsList
  2116: { [P]: 'i!', symbolId: 'ids!' },                           // SymbolById
  2137: { [P]: 'i!', fromTimestamp: 'i', toTimestamp: 'i', period: 'per!', symbolId: 'i!', count: 'i' },   // GetTrendbars
  2145: { [P]: 'i!', symbolId: 'i!', type: 'q!', fromTimestamp: 'i', toTimestamp: 'i' },                    // GetTickData
  2127: { [P]: 'i!', symbolId: 'ids!', subscribeToSpotTimestamp: 'b' },   // SubscribeSpots
  2129: { [P]: 'i!', symbolId: 'ids!' },                           // UnsubscribeSpots
  2135: { [P]: 'i!', period: 'per!', symbolId: 'i!' },             // SubscribeLiveTrendbar
  2136: { [P]: 'i!', period: 'per!', symbolId: 'i!' },             // UnsubscribeLiveTrendbar
  2156: { [P]: 'i!', symbolId: 'ids!' },                           // SubscribeDepthQuotes
  2158: { [P]: 'i!', symbolId: 'ids!' },                           // UnsubscribeDepthQuotes
  51: {}                                                           // Heartbeat
};
// Slow history calls (cTrader allows about 5 a second per connection).
const HISTORY = new Set([2137, 2145]);
// cTrader -> client. 2100/2101 (application auth) stay inside the relay.
export const SERVER_ALLOW = new Set([2103, 2150, 2115, 2117, 2138, 2146, 2128, 2130, 2131, 2165, 2166, 2157, 2159, 2155, 2142, 50, 51, 2147, 2148, 2164]);
// Every other Open API type the client might name, refused with a closed socket (the test names each one).
export const LIMITS = { frame: 16384, upFrame: 262144, msgsPerSec: 40, historyPerSec: 4, subs: 40, ids: 40, idle: 60000, session: 3600000, perIp: 4, perUid: 4, count: 5000, buffer: 20 };

const TOK = /^[A-Za-z0-9._~+\/=\-]{8,2048}$/;
const isInt = (v) => Number.isSafeInteger(v) && v >= 0;
const per = (v) => Number.isInteger(v) && v >= 1 && v <= 14;
function field(kind, v) {
  switch (kind.replace('!', '')) {
    case 'i': return isInt(v);
    case 'b': return typeof v === 'boolean';
    case 'ids': return Array.isArray(v) && v.length >= 1 && v.length <= LIMITS.ids && v.every(isInt);
    case 'tok': return typeof v === 'string' && TOK.test(v);
    case 'per': return per(v);
    case 'q': return v === 1 || v === 2;
    default: return false;
  }
}
// -> { ok, frame (rebuilt JSON string), type, payload } | { ok:false }
export function checkClientFrame(raw) {
  if (typeof raw !== 'string' || raw.length > LIMITS.frame) return { ok: false };
  let o; try { o = JSON.parse(raw); } catch (e) { return { ok: false }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false };
  const t = o.payloadType;
  if (!Number.isInteger(t) || !Object.prototype.hasOwnProperty.call(CLIENT_ALLOW, t)) return { ok: false };
  const id = o.clientMsgId;
  if (id !== undefined && !(typeof id === 'string' && /^[A-Za-z0-9_\-]{1,64}$/.test(id))) return { ok: false };
  for (const k of Object.keys(o)) if (k !== 'payloadType' && k !== 'clientMsgId' && k !== 'payload') return { ok: false };
  const schema = CLIENT_ALLOW[t], pl = o.payload === undefined ? {} : o.payload;
  if (!pl || typeof pl !== 'object' || Array.isArray(pl)) return { ok: false };
  const payload = {};
  for (const k of Object.keys(pl)) { if (!schema[k] || !field(schema[k], pl[k])) return { ok: false }; payload[k] = pl[k]; }
  for (const k of Object.keys(schema)) if (schema[k].endsWith('!') && payload[k] === undefined) return { ok: false };
  if (t === 2137 && payload.count !== undefined && payload.count > LIMITS.count) return { ok: false };
  const out = { payloadType: t, payload }; if (id !== undefined) out.clientMsgId = id;
  return { ok: true, type: t, payload, frame: JSON.stringify(out) };
}

function leaks(text, secrets) {
  if (!secrets.length) return false;
  return secrets.some((s) => s && (text.includes(s) || text.includes(JSON.stringify(s).slice(1, -1)) || text.includes(btoa(s))));
}

// One browser socket <-> one upstream socket. client/up: { send(str), close(code, reason) }; feed with onClient(raw)/onUp(raw)/onClientClose()/onUpClose().
// ctx: { env: 'live'|'demo', secrets: [clientSecret], clientId, clientSecret, now() }
export function createRelay({ client, up, clientId, clientSecret, now = () => Date.now() }) {
  const secrets = [clientSecret];
  let appReady = false, closed = false, queue = [], tokenSeen = null, known = new Set(), authed = new Set(), authCalls = 0, subs = 0;
  let win = { s: Math.floor(now() / 1000), n: 0, h: 0 }, last = now(), born = now();
  const end = (code, reason) => {   // fixed reasons only: nothing from upstream or the client ever goes into a close frame
    if (closed) return; closed = true;
    try { client.close(code, reason); } catch (e) { /* closed */ }
    try { up.close(1000, 'bye'); } catch (e) { /* closed */ }
  };
  const toUp = (frame) => { try { up.send(frame); } catch (e) { end(1011, 'upstream'); } };
  const state = {
    start() { toUp(JSON.stringify({ payloadType: 2100, payload: { clientId, clientSecret } })); },
    // idle / session limits; call from a timer
    tick() { const t = now(); if (t - last > LIMITS.idle) end(1001, 'idle'); else if (t - born > LIMITS.session) end(1001, 'session'); },
    onClient(raw) {
      if (closed) return;
      last = now();
      const sec = Math.floor(last / 1000);
      if (win.s !== sec) win = { s: sec, n: 0, h: 0 };
      const c = checkClientFrame(raw);
      if (!c.ok) return end(1008, 'not allowed');
      const p = c.payload;
      if (++win.n > LIMITS.msgsPerSec || (HISTORY.has(c.type) && ++win.h > LIMITS.historyPerSec)) return end(1008, 'too fast');
      if (c.type === 2149) { if (tokenSeen && tokenSeen !== p.accessToken) return end(1008, 'not allowed'); tokenSeen = p.accessToken; }
      if (c.type === 2102) {
        // Same token as the account list call, an account that list named, at most twice.
        if (!tokenSeen || p.accessToken !== tokenSeen || !known.has(p.ctidTraderAccountId) || ++authCalls > 2) return end(1008, 'not allowed');
      } else if (p.ctidTraderAccountId !== undefined && !authed.has(p.ctidTraderAccountId)) return end(1008, 'not allowed');   // only accounts this socket authorised
      if (c.type === 2129 || c.type === 2158) subs = Math.max(0, subs - p.symbolId.length);
      if (c.type === 2127 || c.type === 2156 || c.type === 2135) { subs += c.type === 2135 ? 1 : p.symbolId.length; if (subs > LIMITS.subs) return end(1008, 'too many'); }
      if (!appReady) { if (queue.length >= LIMITS.buffer) return end(1008, 'too fast'); queue.push(c.frame); } else toUp(c.frame);
    },
    onUp(raw) {
      if (closed) return;
      if (typeof raw !== 'string' || raw.length > LIMITS.upFrame) return;
      let o; try { o = JSON.parse(raw); } catch (e) { return; }
      if (!o || typeof o !== 'object') return;
      const t = o.payloadType;
      if (t === 2101) { appReady = true; queue.forEach(toUp); queue = []; try { client.send(JSON.stringify({ relay: 'ready' })); } catch (e) { /* closed */ } return; }
      if (!appReady) return end(1011, 'upstream');   // anything but 2101 before app auth (error 2142 / 50 included): the relay itself failed
      if (!SERVER_ALLOW.has(t)) return;
      const text = JSON.stringify(o);
      if (leaks(text, secrets)) return;
      if (t === 2150 && o.payload && Array.isArray(o.payload.ctidTraderAccount)) for (const a of o.payload.ctidTraderAccount) if (a && isInt(a.ctidTraderAccountId)) known.add(a.ctidTraderAccountId);
      if (t === 2103 && o.payload && isInt(o.payload.ctidTraderAccountId)) authed.add(o.payload.ctidTraderAccountId);
      try { client.send(text); } catch (e) { end(1011, 'client'); }
    },
    onClientClose() { end(1000, 'bye'); },
    onUpClose() { end(1011, 'upstream'); },
    get closed() { return closed; }
  };
  return state;
}
