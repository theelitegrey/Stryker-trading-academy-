// TradeZoro — "Connect your own data": tastytrade adapter (ES module, BETA). DATA ONLY.
// Depends on: assets/byo-core.js (guard, Hub, candleBuilder, registry). Registered by one import line at the end of byo-core.js.
// The member makes THEIR OWN OAuth app at tastytrade, pastes client id + secret + refresh token. We exchange the refresh
// token for a 15-minute access token in this browser (api.tastyworks.com answers CORS), mint a 24 h quote token, and read
// market data over DXLink. Allowed requests: POST /oauth/token, GET /api-quote-tokens, GET /instruments/futures. Nothing
// else (no /accounts, /orders, /positions). Docs: developer.tastytrade.com/oauth, /streaming-market-data.
// Unverified until a real account tries it: the browser User-Agent rule, DXLink Origin policy, candle snapshot end flag.
import { freshOauth } from './byo-oauth.js?v=961';
import { ALLOW, ADAPTERS, ROUTERS, SOURCES, Hub, candleBuilder, guardUrl, guardWs, guardWsMessage, normTf } from './byo-core.js?v=961';

const API = 'https://api.tastyworks.com';
const HARD = { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };
const dep = (d) => ({ fetch: (d && d.fetch) || ((...a) => globalThis.fetch(...a)), WS: (d && d.WS) || globalThis.WebSocket });

// ---------- allow-list (exact) ----------
const EVENT_FIELDS = {
  Quote: ['eventType', 'eventSymbol', 'bidPrice', 'askPrice'],
  Trade: ['eventType', 'eventSymbol', 'price', 'size'],
  Candle: ['eventType', 'eventSymbol', 'eventFlags', 'time', 'open', 'high', 'low', 'close', 'volume']
};
ALLOW.tastytrade = {
  hosts: ['api.tastyworks.com'],
  paths: [/^\/oauth\/token$/, /^\/api-quote-tokens$/, /^\/instruments\/futures$/],
  post: [/^\/oauth\/token$/],
  // The DXLink url comes from the server's answer, so it is checked as strictly as a hard-coded one.
  ws: /^wss:\/\/tasty-[a-z0-9-]{1,40}\.dxfeed\.com\/(realtime|delayed)$/,
  wsSend: ['SETUP', 'AUTH', 'CHANNEL_REQUEST', 'FEED_SETUP', 'FEED_SUBSCRIPTION', 'KEEPALIVE']
};
const SYM = /^(\/[A-Z0-9]{1,4}:[A-Z]{4}|\/[A-Z0-9]{1,4}[FGHJKMNQUVXZ]\d{1,2}:[A-Z]{4}|[A-Z][A-Z0-9.\/\-]{0,9})(\{=[0-9]{1,2}(m|h|d|w|mo)\})?$/;
// Beyond the message type: only the three market-data event types, sane symbols, one FEED channel.
export function guardDx(msg) {
  const m = typeof msg === 'string' ? JSON.parse(msg) : msg;
  guardWsMessage('tastytrade', m);
  const ch = m.channel;
  if (!(ch === 0 || ch === 3)) throw new Error('byo-guard: blocked tastytrade channel (data only)');
  if (m.type === 'CHANNEL_REQUEST' && !(ch === 3 && m.service === 'FEED' && m.parameters && m.parameters.contract === 'AUTO')) throw new Error('byo-guard: blocked tastytrade service (data only)');
  if (m.type === 'FEED_SETUP' && !Object.keys(m.acceptEventFields || {}).every((k) => EVENT_FIELDS[k])) throw new Error('byo-guard: blocked tastytrade event type (data only)');
  if (m.type === 'FEED_SUBSCRIPTION') {
    const l = [].concat(m.add || [], m.remove || []);
    if (l.length > 100 || !l.every((x) => EVENT_FIELDS[x.type] && SYM.test(String(x.symbol)))) throw new Error('byo-guard: blocked tastytrade subscription (data only)');
  }
  return typeof msg === 'string' ? msg : JSON.stringify(m);
}

// ---------- symbols ----------
// Chart symbol -> our key. Stocks: AAPL. Futures: ES1! or /ES -> "/ES" (front month is looked up, never guessed).
export function symbolOf(t) {
  if (/^(byo:)?(NSE|BSE|MCX):/i.test(String(t || ''))) return null;   // India tickers belong to Upstox / Fyers
  const s = String(t || '').replace(/^[a-z]+:/i, '').toUpperCase();
  let m = /^([A-Z0-9]{1,4})1!$/.exec(s) || /^\/([A-Z0-9]{1,4})$/.exec(s);
  if (m) return '/' + m[1];
  return /^[A-Z][A-Z0-9.\-]{0,5}$/.test(s) ? s : null;
}
const isFut = (k) => k && k[0] === '/';
const PERIOD = { '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h', D: '1d', W: '1w', M: '1mo' };
const SPAN = { '1': 6e4, '5': 3e5, '15': 9e5, '30': 18e5, '60': 36e5, '120': 72e5, '240': 144e5, D: 864e5, W: 7 * 864e5, M: 31 * 864e5 };

// ---------- auth ----------
const state = new WeakMap(); // creds -> { at, exp, p (single flight), qt, qexp, syms }
const st = (c) => { let s = state.get(c); if (!s) { s = { syms: new Map() }; state.set(c, s); } return s; };
const fail = (msg, status) => Object.assign(new Error(msg), { status });
// Fixed messages only: response bodies from the token call are never shown or logged.
function httpErr(r) { return fail('tastytrade ' + (r.status === 400 ? 401 : r.status), r.status === 400 ? 401 : r.status); }
function scopeOf(j) {
  let s = [].concat(j.scope || []).join(' ');
  try { const p = JSON.parse(atob(String(j.access_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); s += ' ' + [].concat(p.scope || p.scopes || []).join(' '); } catch (e) { /* not a JWT */ }
  return s;
}
export async function accessToken(c, d) {
  const s = st(c);
  if (s.at && Date.now() < s.exp) return s.at;
  if (s.p) return s.p;
  const { fetch } = dep(d);
  s.p = (async () => {
    try {
      if (c.oauth) {   // one-tap sign-in: the access token comes from our token function (it holds the client secret); same refuse-trade rule
        const at = await freshOauth('tastytrade', c, d);
        s.at = at; s.exp = Math.max(Date.now() + 30000, c.exp - 60000);
        return at;
      }
      const r = await fetch(guardUrl('tastytrade', API + '/oauth/token', 'POST'), { ...HARD, method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'tradezoro-charts/1.0' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_secret: c.clientSecret, client_id: c.clientId }) });
      if (!r.ok) throw httpErr(r);
      const j = await r.json();
      if (!j || !j.access_token) throw fail('tastytrade refused the sign-in', 401);
      // A mistake-stopper, not a security boundary (the URL allow-list is): refuse a grant that can place trades.
      if (/\btrade\b/i.test(scopeOf(j))) throw fail('This token can place trades. Make a new grant with only the Read scope.', 0);
      s.at = j.access_token; s.exp = Date.now() + Math.max(60, (+j.expires_in || 900) - 60) * 1000;
      return s.at;
    } finally { s.p = null; }
  })();
  return s.p;
}
async function authed(c, path, d) {
  const { fetch } = dep(d);
  const r = await fetch(guardUrl('tastytrade', API + path), { ...HARD, headers: { Authorization: 'Bearer ' + await accessToken(c, d), Accept: 'application/json', 'User-Agent': 'tradezoro-charts/1.0' } });
  if (!r.ok) { if (r.status === 401) st(c).at = null; throw httpErr(r); }
  return (await r.json()).data || {};
}
async function quoteToken(c, d) {
  const s = st(c);
  if (s.qt && Date.now() < s.qexp) return s.qt;
  const j = await authed(c, '/api-quote-tokens', d);
  if (!j.token) throw fail('tastytrade has no data access for this login', 403);
  s.qt = { token: j.token, url: guardWs('tastytrade', String(j['dxlink-url'] || '')) }; s.qexp = Date.now() + 23 * 36e5;
  return s.qt;
}
// Streamer symbol: stocks are the ticker; a futures root is the nearest active contract from /instruments/futures.
async function streamerSym(c, key, d) {
  if (!isFut(key)) return key;
  const s = st(c);
  if (s.syms.has(key)) return s.syms.get(key);
  const j = await authed(c, '/instruments/futures?product-code[]=' + encodeURIComponent(key.slice(1)), d);
  const now = Date.now();
  const items = (j.items || []).filter((x) => x['streamer-symbol'] && Date.parse(x['expiration-date']) > now).sort((a, b) => Date.parse(a['expiration-date']) - Date.parse(b['expiration-date']));
  const pick = items.find((x) => x['active-month']) || items[0];
  if (!pick || !SYM.test(pick['streamer-symbol'])) throw fail('No active contract for ' + key, 404);
  s.syms.set(key, pick['streamer-symbol']);
  return pick['streamer-symbol'];
}

// ---------- DXLink ----------
// Runs the handshake, then calls onReady(send). onEvents(type, rows[]) gets decoded COMPACT rows. Returns close().
function dxlink(url, token, WS, types, onReady, onEvents, ctl) {
  const ws = new WS(guardWs('tastytrade', url));
  const send = (m) => { if (ws.readyState === 1 || ws.readyState === undefined) ws.send(guardDx(m)); };
  let ka = null;
  ws.onopen = () => send({ type: 'SETUP', channel: 0, version: '0.1-DXF-JS/0.3.0', keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 });
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === 'AUTH_STATE' && m.state === 'UNAUTHORIZED') send({ type: 'AUTH', channel: 0, token });
    else if (m.type === 'AUTH_STATE' && m.state === 'AUTHORIZED') send({ type: 'CHANNEL_REQUEST', channel: 3, service: 'FEED', parameters: { contract: 'AUTO' } });
    else if (m.type === 'CHANNEL_OPENED') send({ type: 'FEED_SETUP', channel: 3, acceptAggregationPeriod: 0.1, acceptDataFormat: 'COMPACT', acceptEventFields: Object.fromEntries(types.map((t) => [t, EVENT_FIELDS[t]])) });
    else if (m.type === 'FEED_CONFIG') { ka = ka || setInterval(() => send({ type: 'KEEPALIVE', channel: 0 }), 30000); onReady(send); }
    else if (m.type === 'FEED_DATA' && Array.isArray(m.data)) {
      for (let i = 0; i + 1 < m.data.length; i += 2) {
        const f = EVENT_FIELDS[m.data[i]], flat = m.data[i + 1];
        if (!f || !Array.isArray(flat)) continue;
        const rows = []; for (let k = 0; k + f.length <= flat.length; k += f.length) rows.push(Object.fromEntries(f.map((n, j) => [n, flat[k + j]])));
        onEvents(m.data[i], rows);
      }
    } else if (m.type === 'ERROR') ctl.fail(m.error === 'UNAUTHORIZED', m.error === 'UNAUTHORIZED' ? 'tastytrade refused the data token' : 'tastytrade data error');
  };
  ws.onclose = () => ctl.fail(false);
  ws.onerror = () => { try { ws.close(); } catch (e) { /* closed */ } };
  return () => { clearInterval(ka); ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null; try { ws.close(); } catch (e) { /* closed */ } };
}

let queue = Promise.resolve(); // tastytrade allows 5 DXLink sessions: history requests run one at a time
const num = (x) => (Number.isFinite(+x) ? +x : null);

export const tastytrade = {
  id: 'tastytrade',
  symbolOf,
  info: (t) => (isFut(t) ? { ticker: t, tickerid: 'BYO:' + t, prefix: 'BYO', description: t.slice(1) + ' front month', type: 'futures', market: 'futures', currency: 'USD', mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1, timezone: 'America/Chicago', session: '1700-1600' } : undefined),
  async check(c, d) { await quoteToken(c, d); },
  getBars(c, ticker, timeframe, range = {}, d) {
    const run = () => this._bars(c, ticker, timeframe, range, d);
    const p = queue.then(run, run); queue = p.catch(() => {}); return p;
  },
  async _bars(c, ticker, timeframe, range, d) {
    const key = symbolOf(ticker), tf = normTf(timeframe), per = PERIOD[tf];
    if (!key || !per) return [];
    const { WS } = dep(d);
    const limit = Math.min(range.limit != null ? range.limit : 500, 5000);
    const to = range.to != null ? range.to : Date.now();
    const from = range.from != null ? range.from : to - limit * SPAN[tf] * (SPAN[tf] < 864e5 ? 3.5 : 1.5);
    const sym = await streamerSym(c, key, d);
    const qt = await quoteToken(c, d);
    return new Promise((res, rej) => {
      const by = new Map(); let done = false, close = () => {};
      const finish = (err) => {
        if (done) return; done = true; clearTimeout(timer); close();
        if (err && !by.size) return rej(err);
        const out = [...by.values()].sort((a, b) => a.time - b.time).filter((b) => b.time <= to);
        res(range.limit != null && out.length > range.limit ? out.slice(-range.limit) : out);
      };
      const timer = setTimeout(() => finish(null), 10000);
      close = dxlink(qt.url, qt.token, WS, ['Candle'], (send) => send({ type: 'FEED_SUBSCRIPTION', channel: 3, reset: true, add: [{ type: 'Candle', symbol: sym + '{=' + per + '}', fromTime: from }] }),
        (type, rows) => {
          for (const r of rows) {
            const o = num(r.open), h = num(r.high), l = num(r.low), cl = num(r.close), t = num(r.time);
            if ([o, h, l, cl, t].some((x) => x === null)) continue;
            by.set(t, { time: t, open: o, high: h, low: l, close: cl, volume: num(r.volume) || 0 });
            if ((+r.eventFlags || 0) & 24) finish(null);   // SNAPSHOT_END / SNIP: history is complete
          }
        }, { fail: (fatal) => finish(fail(fatal ? 'tastytrade refused the data token' : 'tastytrade closed the data link', fatal ? 401 : 0)) });
    });
  },
  hub(c, onStatus, d) {
    const { WS } = dep(d);
    return new Hub({
      onStatus,
      open: (syms, onTick, ctl) => {
        let close = null, dead = false;
        (async () => {
          try {
            const pairs = await Promise.all(syms.map(async (k) => [await streamerSym(c, k, d), k]));
            const back = new Map(pairs);
            const qt = await quoteToken(c, d); if (dead) return;
            close = dxlink(qt.url, qt.token, WS, ['Trade'], (send) => { send({ type: 'FEED_SUBSCRIPTION', channel: 3, reset: true, add: pairs.slice(0, 100).map(([s]) => ({ type: 'Trade', symbol: s })) }); ctl.live(); },
              (type, rows) => { for (const r of rows) { const k = back.get(r.eventSymbol), p = num(r.price); if (k && p !== null) onTick(k, p, Date.now(), num(r.size) || 0); } }, ctl);
          } catch (e) {
            if (dead) return;
            const s = e && e.status;
            ctl.fail(s === 401 || s === 403 || s === 0, s === 401 || s === 403 ? 'tastytrade refused the login' : s === 0 ? e.message : '');
          }
        })();
        return () => { dead = true; if (close) close(); };
      }
    });
  },
  subscribe(hub, ticker, timeframe, seed, onBar) { return hub.add(symbolOf(ticker), candleBuilder(timeframe, seed, onBar)); }
};

// ---------- registration ----------
ADAPTERS.tastytrade = tastytrade;
ROUTERS.tastytrade = (kind, ticker) => kind === 'byo' && !!symbolOf(ticker);
Object.assign(SOURCES.find((s) => s.id === 'tastytrade'), {
  state: 'ready', beta: true, covers: 'CME futures and US stocks, live prices (beta)',
  help: 'Beta. Connect your own tastytrade OAuth app for prices only. Open a symbol by typing it like byo:AAPL or byo:ES1! (futures use the front month).',
  manage: 'Open a stock like byo:AAPL or a future like byo:ES1! (front month, or /ES). It now plots your tastytrade prices.',
  docs: 'https://developer.tastytrade.com/oauth/',
  steps: ['On my.tastytrade.com open Manage, My Profile, API, OAuth Applications and press New OAuth client.',
    'Tick only the Read scope. Any redirect address works, we do not use it. Copy the Client ID and Client Secret (shown once).',
    'Press Manage on your new app, then Create Grant, and copy the Refresh token.',
    'Paste the three values in the boxes here. They stay encrypted on this device and go only to tastytrade.',
    'Tap Connect.'],
  signSteps: ['Tap Sign in with tastytrade.', 'Log in on tastytrade\'s page and finish the two-step check.', 'Tap Allow to share prices only.', 'You come back here, connected.'],
  fields: [{ k: 'clientId', label: 'Client ID', ph: '', secret: false }, { k: 'clientSecret', label: 'Client secret', ph: '', secret: true }, { k: 'refreshToken', label: 'Refresh token', ph: '', secret: true },
    { k: 'keep', label: 'Keep this connection', type: 'select', opts: [['yes', 'Remember on this device (encrypted)'], ['no', 'This tab only']] }]
});
