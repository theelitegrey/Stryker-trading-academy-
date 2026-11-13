// TradeZoro — "Connect your own data": cTrader adapter (ES module, BETA). DATA ONLY, view-only.
// Depends on: assets/byo-core.js. Registered by one import line in vela-chart.js (next to byo-tastytrade.js).
// One-tap sign-in: the member signs in on cTrader's own page with scope=accounts (VIEW-ONLY; we never ask for trading).
// Our function /connect/ctrader/token swaps the code (it holds the client secret). Prices come over our relay
// /connect/ctrader/ws (it adds the secret and lets only market-data messages through). Nothing is stored on our side;
// the member's tokens stay in the encrypted, user-bound device vault. Docs: help.ctrader.com/open-api.
import { ADAPTERS, ROUTERS, SOURCES, Hub, candleBuilder, normTf, saveSource, srcById } from './byo-core.js?v=968';

const MIN = 60000;
export const CT = {
  AUTH: 'https://id.ctrader.com/my/settings/openapi/grantingaccess/',
  REDIRECT: 'https://tradezoro.com/connect/ctrader/callback',
  SCOPE: 'accounts',           // view-only. A test fails if the other scope word ever appears in this file.
  TOKEN: '/connect/ctrader/token', WS: '/connect/ctrader/ws',
  STATE_KEY: 'tz-ctrader-state', REFRESH_BEFORE: 3 * 864e5
};
const HARD = { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };
const dep = (d) => ({ fetch: (d && d.fetch) || ((...a) => globalThis.fetch(...a)), WS: (d && d.WS) || globalThis.WebSocket });
const fail = (msg, o) => Object.assign(new Error(msg), o);

// ---------- allow-list (what this browser may send; the relay checks again) ----------
export const SEND_OK = new Set([2102, 2149, 2114, 2116, 2137, 2145, 2127, 2129, 2135, 2136, 2156, 2158, 51]);
export function guardCt(msg) {
  const o = typeof msg === 'string' ? JSON.parse(msg) : msg;
  if (!o || !SEND_OK.has(o.payloadType)) throw new Error('byo-guard: blocked ctrader message (data only)');
  return typeof msg === 'string' ? msg : JSON.stringify(msg);
}
export function wsUrl(env, loc = globalThis.location) {
  return (loc.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + loc.host + CT.WS + '?env=' + (env === 'demo' ? 'demo' : 'live');
}

// ---------- OAuth ----------
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function probeCtrader(d) {
  try {
    const r = await dep(d).fetch(CT.TOKEN + '?probe=1', { credentials: 'omit', cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    return j && j.configured === true && /^[A-Za-z0-9_\-]{6,80}$/.test(j.client_id || '') ? j.client_id : null;
  } catch (e) { return null; }
}
export async function enableCtraderIfConfigured(d) {
  const id = await probeCtrader(d); const row = srcById('ctrader');
  if (id && row) { row.state = 'ready'; row.clientId = id; }
  return !!id;
}
export function ctraderAuthUrl(clientId, userId, store = globalThis.sessionStorage) {
  if (!userId) throw new Error('Sign in to connect your own data');
  const rec = { state: b64url(globalThis.crypto.getRandomValues(new Uint8Array(16))), uid: userId, exp: Date.now() + 10 * MIN };
  store.setItem(CT.STATE_KEY, JSON.stringify(rec));
  return CT.AUTH + '?' + new URLSearchParams({ client_id: clientId, redirect_uri: CT.REDIRECT, scope: CT.SCOPE, product: 'web', state: rec.state });
}
export function takeCtraderState(state, userId, store = globalThis.sessionStorage) {
  let rec = null; try { rec = JSON.parse(store.getItem(CT.STATE_KEY) || 'null'); } catch (e) { /* none */ }
  store.removeItem(CT.STATE_KEY);
  return rec && state && rec.state === state && rec.uid === userId && rec.exp > Date.now() ? rec : null;
}
export async function ctraderTokenCall(body, idToken, d) {
  const r = await dep(d).fetch(CT.TOKEN, { method: 'POST', ...HARD, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify(body) });
  if (r.status === 503) throw fail('cTrader is coming soon', { status: 503 });
  const j = r.ok ? await r.json().catch(() => null) : null;
  if (!j || !j.access_token) throw fail('cTrader ' + r.status, { status: r.status });
  return j;
}
export const ctraderCreds = (j, prev, now = Date.now()) => ({ ...(prev || {}), access: j.access_token, refresh: j.refresh_token || (prev && prev.refresh), exp: now + (Number(j.expires_in) || 2628000) * 1000 });

// ---------- tokens ----------
const idToken = (d) => (d && d.idToken ? d.idToken() : globalThis.firebase.auth().currentUser.getIdToken());
// Refresh before expiry (one tab at a time). A refused refresh = "Reconnect cTrader".
export async function fresh(c, d) {
  if (c.exp - Date.now() > CT.REFRESH_BEFORE) return c.access;
  const run = async () => {
    if (c.exp - Date.now() > CT.REFRESH_BEFORE) return c.access;
    if (!c.refresh) throw fail('Reconnect cTrader', { reconnect: true });
    let idt; try { idt = await idToken(d); } catch (e) { throw fail('Sign in again', { status: 401 }); }
    let j; try { j = await ctraderTokenCall({ grant: 'refresh', refresh_token: c.refresh }, idt, d); }
    catch (e) { if (e.status === 400 || e.status === 401) throw fail('Reconnect cTrader', { reconnect: true }); throw e; }
    Object.assign(c, ctraderCreds(j, c));
    try { await saveSource('ctrader', c); } catch (e) { /* kept in memory */ }
    return c.access;
  };
  const L = globalThis.navigator && navigator.locks;
  return L ? L.request('tz-ctrader-refresh', run) : run();
}

// ---------- relay session: one socket per connected account, shared by history and live ----------
// send(type, payload) -> Promise of the matching response; on(type, fn) for events. Closes itself when idle.
class Session {
  constructor(c, d) {
    this.c = c; this.d = d; this.ws = null; this.ready = null; this.pending = new Map(); this.ev = new Map(); this.n = 0; this.users = 0; this.ka = null; this.idle = null; this.dead = false;
  }
  open() {
    if (this.ready) return this.ready;
    const { WS } = dep(this.d), c = this.c;
    this.ready = (async () => {
      const at = await fresh(c, this.d), idt = await idToken(this.d).catch(() => { throw fail('Sign in again', { status: 401 }); });
      await new Promise((res, rej) => {
        let ws; try { ws = new WS(wsUrl(c.isLive === false ? 'demo' : 'live', this.d && this.d.location), ['tz-auth', idt]); } catch (e) { return rej(fail('cTrader relay unavailable', { status: 0 })); }
        this.ws = ws;
        ws.onmessage = (ev) => this.onMsg(ev.data, res);
        ws.onclose = (ev) => { this.shut(fail(ev && ev.code === 1008 ? 'cTrader relay refused' : 'cTrader closed the link', { status: 0 })); rej(fail('cTrader relay closed', { status: 0 })); };
        ws.onerror = () => { try { ws.close(); } catch (e) { /* closed */ } };
      });
      this.ka = setInterval(() => { try { this.raw({ payloadType: 51, payload: {} }); } catch (e) { /* closed */ } }, 25000);
      // Account list with the member's token, then authorise the chosen account.
      await this.send(2149, { accessToken: at });
      const r = await this.send(2102, { ctidTraderAccountId: c.accountId, accessToken: at });
      if (r.payloadType === 2142 || r.payloadType === 50) throw fail('cTrader refused the sign-in', { status: 401, reconnect: true });
    })();
    this.ready.catch(() => this.shut());
    return this.ready;
  }
  onMsg(text, ready) {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (m.relay === 'ready') return ready();
    const id = m.clientMsgId, p = this.pending.get(id);
    if (p) { this.pending.delete(id); clearTimeout(p.t); p.res(m); return; }
    const f = this.ev.get(m.payloadType); if (f) f.forEach((fn) => { try { fn(m.payload || {}); } catch (e) { /* a chart error must not stop the feed */ } });
    if (m.payloadType === 2147 || m.payloadType === 2148 || m.payloadType === 2164) this.shut(fail('Reconnect cTrader', { reconnect: true }));
  }
  raw(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(guardCt(o)); else throw fail('cTrader closed the link', { status: 0 }); }
  send(type, payload) {
    return new Promise((res, rej) => {
      const id = 'm' + (++this.n);
      const t = setTimeout(() => { this.pending.delete(id); rej(fail('cTrader did not answer', { status: 0 })); }, 15000);
      this.pending.set(id, { res: (m) => (m.payloadType === 2142 || m.payloadType === 50) && type !== 2102 ? rej(fail('cTrader ' + ((m.payload && m.payload.errorCode) || 'error'), { status: 0, code: m.payload && m.payload.errorCode })) : res(m), t });
      try { this.raw({ clientMsgId: id, payloadType: type, payload }); } catch (e) { clearTimeout(t); this.pending.delete(id); rej(e); }
    });
  }
  async call(type, payload) { await this.open(); return this.send(type, { ctidTraderAccountId: this.c.accountId, ...payload }); }
  on(type, fn) { if (!this.ev.has(type)) this.ev.set(type, new Set()); this.ev.get(type).add(fn); return () => this.ev.get(type).delete(fn); }
  hold() { this.users++; clearTimeout(this.idle); return () => { if (--this.users <= 0) { this.idle = setTimeout(() => this.shut(), 20000); } }; }
  shut(err) {
    if (this.dead) return; this.dead = true; clearInterval(this.ka); clearTimeout(this.idle);
    for (const p of this.pending.values()) { clearTimeout(p.t); try { p.res({ payloadType: 2142, payload: { errorCode: 'CLOSED' } }); } catch (e) { /* settled */ } }
    this.pending.clear();
    const ws = this.ws; this.ws = null; if (ws) { ws.onclose = ws.onmessage = ws.onerror = null; try { ws.close(); } catch (e) { /* closed */ } }
    this.err = err; if (this.onDead) this.onDead(err);
  }
}
const sessions = new WeakMap();   // creds -> Session
function sessionOf(c, d) { let s = sessions.get(c); if (!s || s.dead) { s = new Session(c, d); sessions.set(c, s); } return s; }

// Account list for the callback page: opens a throwaway relay socket with the fresh token, no account yet.
export async function listAccounts(c, d) {
  const s = new Session({ ...c, accountId: 0 }, d);
  try {
    const { WS } = dep(d), idt = await idToken(d);
    await new Promise((res, rej) => {
      const ws = new WS(wsUrl('live', d && d.location), ['tz-auth', idt]); s.ws = ws;
      ws.onmessage = (ev) => s.onMsg(ev.data, res); ws.onclose = () => rej(fail('cTrader relay closed', { status: 0 })); ws.onerror = () => { try { ws.close(); } catch (e) { /* closed */ } };
    });
    const r = await s.send(2149, { accessToken: c.access });
    const list = (r.payload && r.payload.ctidTraderAccount) || [];
    return list.filter((a) => Number.isSafeInteger(a.ctidTraderAccountId)).map((a) => ({ id: a.ctidTraderAccountId, isLive: a.isLive !== false, login: a.traderLogin || null, broker: String(a.brokerTitleShort || '').slice(0, 40) }));
  } finally { s.shut(); }
}

// ---------- symbols and bars ----------
const CCY = 'USD EUR GBP JPY CHF AUD NZD CAD SEK NOK DKK PLN CZK HUF MXN ZAR TRY SGD HKD CNH ILS'.split(' ');
const CRYPTO = /^(BTC|ETH|LTC|XRP|SOL|DOGE|ADA|DOT|BNB|XAU|XAG)(USD|EUR|USDT|GBP|JPY)$/;
// Chart symbol -> our key (letters only, upper case): EURUSD, BTCUSD, XAUUSD. null when it does not look like forex/crypto/metals.
export function symbolOf(t) {
  const s = String(t || '').replace(/^[a-z]+:/i, '').replace(/[\/_\-]/g, '').toUpperCase();
  if (/^[A-Z]{6}$/.test(s) && CCY.includes(s.slice(0, 3)) && CCY.includes(s.slice(3))) return s;
  return CRYPTO.test(s) ? s : null;
}
const PERIOD = { '1': 1, '5': 5, '15': 7, '30': 8, '60': 9, '240': 10, D: 12, W: 13, M: 14 };
const SPAN = { '1': MIN, '5': 5 * MIN, '15': 15 * MIN, '30': 30 * MIN, '60': 60 * MIN, '240': 240 * MIN, D: 864e5, W: 7 * 864e5, M: 31 * 864e5 };
const PX = 1e5;   // cTrader prices are integers in 1/100000
const symCache = new WeakMap();   // creds -> Map(key -> { id, digits }); memory only, per account
async function symbolId(c, key, d) {
  let m = symCache.get(c);
  if (!m) {
    const r = await sessionOf(c, d).call(2114, {});
    m = new Map();
    for (const s of (r.payload && r.payload.symbol) || []) {
      const k = String(s.symbolName || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (k && s.enabled !== false && !m.has(k)) m.set(k, { id: s.symbolId });
    }
    symCache.set(c, m);
  }
  const hit = m.get(key);
  if (!hit) throw fail('Your cTrader account does not list ' + key, { status: 404 });
  return hit.id;
}
const round = (x) => Math.round(x * PX) / PX;
const barOf = (t) => {
  const low = +t.low, o = low + (+t.deltaOpen || 0), h = low + (+t.deltaHigh || 0), cl = low + (+t.deltaClose || 0);
  return { time: (+t.utcTimestampInMinutes) * MIN, open: round(o / PX), high: round(h / PX), low: round(low / PX), close: round(cl / PX), volume: +t.volume || 0 };
};

export const ctrader = {
  id: 'ctrader',
  symbolOf,
  info: (t) => {
    const s = symbolOf(t), crypto = !!s && CRYPTO.test(s);
    return s ? { ticker: s, tickerid: 'BYO:' + s, prefix: 'BYO', description: s, type: crypto ? 'crypto' : 'forex', market: crypto ? 'crypto' : 'forex', currency: s.slice(3), mintick: s.endsWith('JPY') ? 0.001 : 0.00001, pricescale: s.endsWith('JPY') ? 1000 : 100000, minmove: 1, pointvalue: 1, timezone: 'Etc/UTC', session: '24x7' } : undefined;
  },
  fresh,
  async check(c, d) { await fresh(c, d); if (!c.accountId) throw fail('Pick your cTrader account', { status: 0 }); const s = sessionOf(c, d); const rel = s.hold(); try { await s.open(); } finally { rel(); } },
  async getBars(c, ticker, timeframe, range = {}, d) {
    const key = symbolOf(ticker), tf = normTf(timeframe), per = PERIOD[tf];
    if (!key || !per) return [];
    const s = sessionOf(c, d), rel = s.hold();
    try {
      const id = await symbolId(c, key, d);
      const limit = Math.min(range.limit != null ? range.limit : 500, 5000);
      const to = range.to != null ? range.to : Date.now();
      const from = range.from != null ? range.from : to - limit * SPAN[tf] * (SPAN[tf] < 864e5 ? 3.5 : 1.5);
      const r = await s.call(2137, { symbolId: id, period: per, fromTimestamp: Math.max(0, Math.floor(from)), toTimestamp: Math.floor(to), count: limit });
      const out = ((r.payload && r.payload.trendbar) || []).map(barOf).filter((b) => Number.isFinite(b.time) && b.time <= to).sort((a, b) => a.time - b.time);
      return range.limit != null && out.length > range.limit ? out.slice(-range.limit) : out;
    } finally { rel(); }
  },
  hub(c, onStatus, d) {
    return new Hub({
      onStatus,
      open: (syms, onTick, ctl) => {
        const s = sessionOf(c, d), rel = s.hold(); let dead = false, off = [], subbed = [];
        (async () => {
          try {
            const ids = await Promise.all(syms.map(async (k) => [await symbolId(c, k, d), k]));
            if (dead) return;
            const back = new Map(ids), last = new Map();   // spots carry only the side that changed: keep the other
            off.push(s.on(2131, (e) => {
              const k = back.get(e.symbolId); if (!k) return;
              const l = last.get(k) || {}; if (e.bid != null) l.bid = e.bid; if (e.ask != null) l.ask = e.ask; last.set(k, l);
              if (l.bid == null) return;
              onTick(k, round(l.bid / PX), e.timestamp > 0 ? e.timestamp : Date.now(), 0);   // chart plots the bid, like a broker chart
            }));
            subbed = ids.map((x) => x[0]);
            await s.send(2127, { ctidTraderAccountId: c.accountId, symbolId: subbed, subscribeToSpotTimestamp: true });
            ctl.live();
            s.onDead = (err) => ctl.fail(!!(err && err.reconnect), err && err.reconnect ? 'Reconnect cTrader' : '');
          } catch (e) {
            if (dead) return;
            ctl.fail(!!(e && (e.reconnect || e.status === 401)), e && e.reconnect ? 'Reconnect cTrader' : e && e.status === 404 ? e.message : '');
          }
        })();
        return () => { dead = true; off.forEach((f) => f()); s.onDead = null; if (s.ws && !s.dead && subbed.length) s.send(2129, { ctidTraderAccountId: c.accountId, symbolId: subbed }).catch(() => {}); rel(); };
      }
    });
  },
  subscribe(hub, ticker, timeframe, seed, onBar) { return hub.add(symbolOf(ticker), candleBuilder(timeframe, seed, onBar)); }
};

// ---------- registration ----------
ADAPTERS.ctrader = ctrader;
ROUTERS.ctrader = (kind, ticker) => (kind === 'fx' || kind === 'byo') && !!symbolOf(ticker);
Object.assign(srcById('ctrader'), {
  state: 'soon', oauth: true, beta: true, covers: 'Forex, metals and crypto CFDs, live prices (beta)', cta: 'Sign in with cTrader',
  steps: ['Tap Sign in with cTrader.', 'Log in with your cTrader ID on cTrader\'s own page.', 'Pick the trading account you want prices from.', 'Choose Allow (view-only). You come back here, connected.'],
  relay: true, noteText: 'Prices stream through TradeZoro\'s secure relay; nothing is stored.',
  help: 'Beta. Sign in on cTrader\'s own page. Only market data is requested (view-only). Open a pair like EURUSD or a crypto like byo:BTCUSD.',
  manage: 'Open a forex pair, for example EURUSD, or byo:BTCUSD. It now plots your cTrader prices.'
});
void SOURCES;
