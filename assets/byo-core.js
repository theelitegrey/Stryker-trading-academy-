// TradeZoro — "Connect your own data" core (ES module). DATA ONLY.
// Depends on: nothing at load (WebCrypto + IndexedDB are used lazily). Used by assets/byo-provider.js (chart
// adapters) and assets/byo-ui.js (the Data source sheet). Research + terms: stryker-notes/reports/workers/byo-data.md.
//
// A member connects THEIR OWN broker/data account. The key/token is encrypted on this device (AES-GCM, a
// NON-extractable key kept in IndexedDB) and goes only to that broker. Market data flows broker -> this browser.
// Nothing here ever reaches our servers, Firestore or any log.
//
// HARD RULE (Owner): no order, account, position or balance feature. These brokers' keys are NOT read-only at the
// broker, so the protection is HERE: guardUrl()/guardWsMessage() allow only the market-data paths below and throw
// before any request is made for anything else (see assets/tests in tools/tests/byo-core.test.mjs).

// ---------- guard ----------
export const ALLOW = {
  alpaca: {
    hosts: ['data.alpaca.markets'],
    paths: [/^\/v2\/stocks\/[A-Z0-9.\-]{1,12}\/bars$/],
    ws: /^wss:\/\/stream\.data\.alpaca\.markets\/v2\/(iex|sip|test)$/,
    wsSend: ['auth', 'subscribe', 'unsubscribe']
  },
  ironbeam: {
    hosts: ['live.ironbeamapi.com', 'demo.ironbeamapi.com'],
    // Sign-in (POST), then a stream id and a quotes subscription. Nothing under /account, /order or /position.
    paths: [/^\/v2\/auth$/, /^\/v2\/stream\/create$/, /^\/v2\/market\/quotes\/subscribe\/[A-Za-z0-9\-]{6,64}$/],
    post: [/^\/v2\/auth$/],
    ws: /^wss:\/\/(live|demo)\.ironbeamapi\.com\/v2\/stream\/[A-Za-z0-9\-]{6,64}\?token=[A-Za-z0-9._\-]{8,2048}$/,
    wsSend: []
  },
  oanda: {
    hosts: ['api-fxpractice.oanda.com', 'api-fxtrade.oanda.com', 'stream-fxpractice.oanda.com', 'stream-fxtrade.oanda.com'],
    // Exactly two paths: candles and the price stream. The member types their own account id; we never list accounts.
    paths: [/^\/v3\/instruments\/[A-Z]{3}_[A-Z]{3}\/candles$/, /^\/v3\/accounts\/[0-9\-]{5,32}\/pricing\/stream$/]
  },
  schwab: {
    hosts: ['api.schwabapi.com'],
    // Price history, and userPreference (the ONE /trader path: read only for the streamer socket details, see streamerInfoOf).
    // Nothing under /accounts, /orders, /positions, and not the token endpoint (our own function swaps tokens).
    paths: [/^\/marketdata\/v1\/pricehistory$/, /^\/trader\/v1\/userPreference$/],
    ws: /^wss:\/\/streamer-api\.schwab\.com\/ws$/,
    services: ['LEVELONE_EQUITIES', 'LEVELONE_FUTURES', 'CHART_EQUITY', 'CHART_FUTURES'],
    commands: ['SUBS', 'ADD', 'UNSUBS']
  },
  // India. Upstox and Fyers tokens have NO view-only scope (the token can also trade), so this list is the only protection:
  // price history, the instrument search, and the price-feed address. NOT allowed (each has a unit test): /v2/order*, /v2/portfolio/*,
  // /v2/user/* (profile, funds, ip), /v2/charges, /v2/login/* (the token swap is our own function), the portfolio-stream feed.
  upstox: {
    hosts: ['api.upstox.com'],
    pct: true,   // only %20 and %7C are tolerated in the path (instrument keys look like NSE_INDEX|Nifty 50)
    paths: [/^\/v3\/historical-candle\/(NSE|BSE|MCX)_(EQ|INDEX|FO)\|[A-Za-z0-9 ]{1,40}\/(minutes|hours|days|weeks|months)\/\d{1,3}\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/,
      /^\/v3\/historical-candle\/intraday\/(NSE|BSE|MCX)_(EQ|INDEX|FO)\|[A-Za-z0-9 ]{1,40}\/(minutes|hours|days)\/\d{1,3}$/,
      /^\/v2\/instruments\/search$/, /^\/v3\/feed\/market-data-feed\/authorize$/],
    ws: /^wss:\/\/[a-z0-9\-]+(\.[a-z0-9\-]+)*\.upstox\.com\/market-data-feeder\/v3\/upstox-developer-api\/feeds\?requestId=[A-Za-z0-9\-]{8,64}&code=[A-Za-z0-9\-]{8,64}$/,
    wsSend: ['sub', 'unsub'],
    wsCheck: (o) => o.data && o.data.mode === 'ltpc' && Array.isArray(o.data.instrumentKeys) && o.data.instrumentKeys.length > 0 && o.data.instrumentKeys.length <= 100
      && o.data.instrumentKeys.every((k) => typeof k === 'string' && /^(NSE|BSE|MCX)_(EQ|INDEX|FO)\|[A-Za-z0-9 ]{1,40}$/.test(k))   // last price only
  },
  // Dhan (India). The member pastes their own 24-hour token. Prices only: the live feed socket (subscribe to ticker / quote requests) and the
  // two chart-history calls, which go through our own pass-through (/connect/dhan/data) because Dhan's REST host refuses browser requests.
  // NOT allowed (unit-tested): every other api.dhan.co path (orders, super/forever orders, funds, holdings, positions, profile, statement, kill switch, IP, RenewToken), auth.dhan.co.
  dhan: {
    hosts: [],   // our own site only (rule.self): the two pass-through functions below. The browser never calls api.dhan.co (it refuses browsers) or auth.dhan.co.
    self: true,
    paths: [/^\/connect\/dhan\/data$/, /^\/connect\/dhan\/master$/, /^\/connect\/dhan\/key$/],
    post: [/^\/connect\/dhan\/data$/, /^\/connect\/dhan\/key$/],
    ws: /^wss:\/\/api-feed\.dhan\.co\?version=2&token=[A-Za-z0-9._\-]{20,2048}&clientId=\d{4,20}&authType=2$/,
    wsSend: ['code15', 'code17'],   // 15 = ticker, 17 = quote. Never the full / depth modes, never the disconnect message.
    wsCheck: (o) => Array.isArray(o.InstrumentList) && o.InstrumentList.length > 0 && o.InstrumentList.length <= 100 && o.InstrumentCount === o.InstrumentList.length
      && o.InstrumentList.every((x) => x && ['NSE_EQ', 'BSE_EQ', 'IDX_I', 'NSE_FNO', 'MCX_COMM'].includes(x.ExchangeSegment) && /^\d{1,10}$/.test(x.SecurityId))
  },
  'upstox-master': { hosts: ['assets.upstox.com'], paths: [/^\/market-quote\/instruments\/exchange\/MCX\.json\.gz$/] },   // MCX futures list (small file)
  fyers: {
    hosts: ['api-t1.fyers.in'],
    // price history and quotes only. No /api/v3/* at all (profile, funds, holdings, positions, orders, validate-authcode) and no websocket (see byo-india.js).
    paths: [/^\/data\/history$/, /^\/data\/quotes$/]
  }
};
export function guardUrl(source, url, method = 'GET') {
  const rule = ALLOW[source];
  const u = new URL(url);
  const pn = rule && rule.pct ? u.pathname.replace(/%20/g, ' ').replace(/%7C/gi, '|') : u.pathname;   // decoded only for the listed escapes; any other % is refused below
  const dev = rule && rule.self && globalThis.location && /^(127\.0\.0\.1|localhost)$/.test(globalThis.location.hostname) && u.protocol === 'http:';   // our own function on a local preview only
  if (!rule || (u.protocol !== 'https:' && !dev) || !(String(method).toUpperCase() === 'GET' || (String(method).toUpperCase() === 'POST' && (rule.post || []).some((p) => p.test(u.pathname)))) || (u.port && !(rule.self && globalThis.location && u.port === globalThis.location.port)) || u.username || u.password || /[%\\;]|\/\//.test(pn) || !(rule.hosts.includes(u.hostname) || (rule.self && globalThis.location && u.hostname === globalThis.location.hostname))
    || !rule.paths.some((p) => p.test(pn))) throw new Error('byo-guard: blocked ' + source + ' request (data only)');
  return u.href;
}
export function guardWs(source, url) {
  const rule = ALLOW[source];
  if (!rule || !rule.ws || !rule.ws.test(url)) throw new Error('byo-guard: blocked ' + source + ' socket (data only)');
  return url;
}
export function guardWsMessage(source, msg) {
  const rule = ALLOW[source];
  if (rule && rule.services) {   // Schwab streamer: { requests: [{ service, command, ... }] }; LOGIN/LOGOUT on ADMIN only
    let reqs = null;
    try { reqs = (typeof msg === 'string' ? JSON.parse(msg) : msg).requests; } catch (e) { /* falls through */ }
    const ok = Array.isArray(reqs) && reqs.length > 0 && reqs.every((q) => q && ((q.service === 'ADMIN' && (q.command === 'LOGIN' || q.command === 'LOGOUT')) || (rule.services.includes(q.service) && rule.commands.includes(q.command))));
    if (!ok) throw new Error('byo-guard: blocked ' + source + ' message (data only)');
    return typeof msg === 'string' ? msg : JSON.stringify(msg);
  }
  let a = null;
  let o = null;
  try { o = typeof msg === 'string' ? JSON.parse(msg) : msg; a = o.action || o.type || o.method || (o.RequestCode != null ? 'code' + o.RequestCode : undefined); } catch (e) { /* falls through */ }
  if (!rule || !rule.wsSend || !rule.wsSend.includes(a) || (rule.wsCheck && !rule.wsCheck(o))) throw new Error('byo-guard: blocked ' + source + ' message (data only)');
  return typeof msg === 'string' ? msg : JSON.stringify(msg);
}

// ---------- source catalogue (the Data source sheet reads this) ----------
// state: 'ready' (built, Connect works) | 'soon' (Coming soon, never a dead button).
// fields: the connect form. Names are used only in the sheet and in the one "Data feed: your <name>" label.
export const SOURCES = [
  { id: 'alpaca', name: 'Alpaca', cls: ['stocks'], covers: 'US stocks and ETFs, live prices', fee: 'free', feeNote: 'Free with your account (IEX feed). The paid SIP feed follows your Alpaca plan.', state: 'ready', steps: ['Log in at app.alpaca.markets. Pick your Paper account (it works for prices).', 'On the home page find the API Keys box on the right and tap Generate New Keys.', 'Copy the Key ID and the Secret now. The secret is shown only once.', 'Paste the Key ID and Secret in the two boxes here. Keep Feed on IEX unless you pay for SIP.', 'Tap Connect.'], signSteps: ['Tap Sign in with Alpaca.', 'Log in on Alpaca\'s page.', 'Tap Allow to share prices only.', 'You come back here, connected.'],
    fields: [{ k: 'key', label: 'API key ID', ph: 'PK…', secret: false }, { k: 'secret', label: 'API secret', ph: '', secret: true }, { k: 'feed', label: 'Feed', type: 'select', opts: [['iex', 'IEX (free plan)'], ['sip', 'SIP (paid plan)']] }],
    help: 'In your Alpaca dashboard create an API key. A paper key works for market data.' },
  { id: 'oanda', name: 'OANDA', cls: ['forex'], covers: 'Forex pairs, live bid/ask prices', fee: 'free', feeNote: 'Free with your account.', state: 'ready', steps: ['Log in at oanda.com to your account hub.', 'Open My Services, then Manage API Access, and tap Generate for a personal access token.', 'Copy the token and paste it in the first box here.', 'Pick Practice or Live to match your account, and paste your Account ID (like 101-001-1234567-001). It is shown on your account page.', 'Tap Connect.'],
    fields: [{ k: 'token', label: 'Personal access token', ph: '', secret: true }, { k: 'env', label: 'Account type', type: 'select', opts: [['practice', 'Practice'], ['live', 'Live']] }, { k: 'account', label: 'Account ID', ph: '101-001-1234567-001', secret: false }],
    help: 'In OANDA create a personal access token (Manage API Access).' },
  { id: 'ironbeam', name: 'Ironbeam', cls: ['futures'], covers: 'CME futures, live last price (beta)', fee: 'paid', feeNote: 'Your exchange data fees apply.', state: 'ready', beta: true, steps: ['Log in to your Ironbeam account and ask for an API key. If you can\'t find it, ask Ironbeam support.', 'Copy the API key when they give it to you.', 'Paste your Ironbeam username, password and the API key in the boxes here.', 'Pick Live or Demo to match your account.', 'Tap Connect.'],
    fields: [{ k: 'username', label: 'Ironbeam username', ph: '', secret: false }, { k: 'password', label: 'Ironbeam password', ph: '', secret: true }, { k: 'apiKey', label: 'API key', ph: '', secret: true }, { k: 'env', label: 'Account type', type: 'select', opts: [['live', 'Live'], ['demo', 'Demo']] }],
    help: 'Beta. Request an API key in your Ironbeam account. Open a contract by typing it like byo:XCME:ES.Z26. Live prices only for now: no history yet.' },
  { id: 'tastytrade', name: 'tastytrade', cls: ['futures', 'stocks'], covers: 'CME futures and US stocks', fee: 'paid', feeNote: 'Your data fees apply.', state: 'soon' },
  { id: 'schwab', name: 'Charles Schwab', cls: ['stocks', 'futures', 'options'], covers: 'Stocks, futures and options', fee: 'paid', feeNote: 'Your data fees apply.', state: 'soon', oauth: true, steps: ['Tap Sign in with Schwab (or Connect) when it is available.', 'Log in on Schwab\'s own page.', 'Choose Allow when Schwab asks to share market data.', 'You come back here, connected. Schwab asks you to sign in again about once a week.'],
    help: 'You sign in on Schwab\'s own page. Only market data is requested. Schwab asks you to sign in again about once a week.' },
  { id: 'upstox', name: 'Upstox', cls: ['stocks', 'futures'], covers: 'India stocks, index futures and MCX, live prices', fee: 'free', feeNote: 'Free with your Upstox account.', state: 'soon', oauth: true, steps: ['Tap Sign in with Upstox.', 'Log in on Upstox\'s own page.', 'Approve the request when Upstox asks.', 'You come back here, connected. Sign in again each day.'],
    help: 'Sign in on Upstox\'s own page. Upstox ends the sign-in every night, so you sign in again each day.',
    manage: 'Open a symbol like byo:NSE:RELIANCE-EQ, byo:NSE:NIFTY-INDEX, byo:NSE:NIFTY1! (front month) or byo:MCX:GOLD1!.' },
  { id: 'fyers', name: 'Fyers', cls: ['stocks', 'futures'], covers: 'India stocks, index futures and MCX, prices every few seconds', fee: 'free', feeNote: 'Free with your Fyers account (Standard plan).', state: 'soon', oauth: true, steps: ['Tap Sign in with Fyers.', 'Log in on Fyers\' own page.', 'Approve the request when Fyers asks.', 'You come back here, connected. Sign in again each day.'],
    help: 'Sign in on Fyers\' own page. Fyers ends the sign-in every morning, so you sign in again each day.',
    manage: 'Open a symbol like byo:NSE:RELIANCE-EQ, byo:NSE:NIFTY-INDEX, byo:NSE:NIFTY1! (front month) or byo:MCX:GOLD1!.' },
  { id: 'dhan', name: 'Dhan', cls: ['stocks', 'futures'], covers: 'India stocks, index futures and MCX. Needs the Data plan on your Dhan account.', fee: 'paid', feeNote: 'Needs the Data plan on your Dhan account.', state: 'ready',
    fields: [{ k: 'clientId', label: 'Dhan Client ID', ph: '1000000001', secret: false }, { k: 'token', label: 'Access token (24 hours)', ph: '', secret: true }],
    help: 'Paste your own Dhan Client ID and a 24-hour access token.', keyLogin: true,
    steps: ['Open web.dhan.co and sign in.', 'Tap My Profile, then Access DhanHQ APIs.', 'Choose Access Token and generate one (valid 24 hours).', 'Copy your Client ID and the token, and paste them here.'],
    docs: 'https://dhanhq.co/docs/v2/authentication/',
    noteText: 'Your token stays on this device. Live prices come from Dhan straight to your browser. Chart history passes through TradeZoro for that one call and is not stored.',
    manage: 'Open a symbol like byo:NSE:RELIANCE-EQ, byo:NSE:NIFTY-INDEX, byo:NSE:BANKNIFTY-INDEX, byo:NSE:NIFTY1! (front month) or byo:MCX:GOLD1!.' },
  { id: 'ctrader', name: 'cTrader', cls: ['forex', 'crypto'], covers: 'Forex and crypto CFDs', fee: 'free', feeNote: 'Free with your account.', state: 'soon' }   // details + sign-in: assets/byo-ctrader.js
];
// Flag: the function says it has its Schwab keys -> the row becomes ready (OAuth connect). Otherwise it stays Coming soon.
export async function enableSchwabIfConfigured(d) {
  const id = await probeSchwab(d); const row = srcById('schwab');
  if (id && row) { row.state = 'ready'; row.clientId = id; }
  return !!id;
}
export const srcById = (id) => SOURCES.find((s) => s.id === id) || null;

// ---------- vault: AES-GCM, non-extractable key in IndexedDB ----------
function idbStore() {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('tz-byo', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const run = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => { db.close(); res(q && q.result); }; t.onerror = () => { db.close(); rej(t.error); }; }); };
  return { get: (k) => run('readonly', (s) => s.get(k)), put: (k, v) => run('readwrite', (s) => s.put(v, k)), del: (k) => run('readwrite', (s) => s.delete(k)), keys: () => run('readonly', (s) => s.getAllKeys()) };
}
// store/subtle are injectable so the unit test runs in Node.
export function makeVault(store, subtle, uidOf = () => '') {
  store = store || idbStore();
  subtle = subtle || globalThis.crypto.subtle;
  const rnd = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  // The signed-in user id is bound into every record: another account on this device cannot decrypt it.
  const aad = () => new TextEncoder().encode('tz-byo|' + id0(uidOf()));
  const id0 = (u) => { if (!u) throw new Error('Sign in to connect your own data'); return u; };
  async function key() {
    let k = await store.get('master');
    if (!k) { k = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); await store.put('master', k); }
    return k;
  }
  return {
    async save(id, obj) {
      const iv = rnd(12);
      const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad() }, await key(), new TextEncoder().encode(JSON.stringify(obj))));
      await store.put('c:' + id, { iv: b64(iv), ct: b64(ct) });
    },
    async load(id) {
      const rec = await store.get('c:' + id);
      if (!rec) return null;
      try { return JSON.parse(new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv), additionalData: aad() }, await key(), unb64(rec.ct)))); }
      catch (e) { return null; }
    },
    async forget(id) { await store.del('c:' + id); },
    owner: () => store.get('owner'),
    setOwner: (u) => store.put('owner', u),
    async wipe() { for (const k of (await store.keys()) || []) await store.del(k); },
    async ids() { return ((await store.keys()) || []).filter((k) => String(k).startsWith('c:')).map((k) => String(k).slice(2)); }
  };
}

// ---------- shared helpers ----------
const MIN = 60000;
export const TF_MS = { '1': MIN, '5': 5 * MIN, '15': 15 * MIN, '30': 30 * MIN, '60': 60 * MIN, '120': 120 * MIN, '240': 240 * MIN };
const norm = (tf) => ({ '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '60m': '60', '2h': '120', '4h': '240', '4H': '240', '1d': 'D', '1D': 'D', d: 'D', '1w': 'W', '1W': 'W', w: 'W', '1M': 'M', '1mo': 'M' }[String(tf)] || String(tf));
export const normTf = norm;

// Turns ticks into the forming candle for ONE chart subscription. seed = newest history bar (keeps the source's own
// bar alignment, e.g. 4-hour bars); D/W/M keep the seed's bucket while the tick is inside it.
export function candleBuilder(tf, seed, emit) {
  tf = norm(tf);
  const step = TF_MS[tf] || 0;
  let cur = seed ? { ...seed } : null;
  return (price, ts, size = 0) => {
    if (!Number.isFinite(price) || !Number.isFinite(ts)) return;
    let t;
    if (step) t = seed && ts >= seed.time ? seed.time + Math.floor((ts - seed.time) / step) * step : Math.floor(ts / step) * step;
    else {
      const span = tf === 'W' ? 7 * 864e5 : tf === 'M' ? 31 * 864e5 : 864e5;
      t = cur && ts >= cur.time && ts < cur.time + span ? cur.time : Math.floor(ts / 864e5) * 864e5;
    }
    if (cur && t < cur.time) return;
    if (cur && cur.time === t) { cur.high = Math.max(cur.high, price); cur.low = Math.min(cur.low, price); cur.close = price; cur.volume = (cur.volume || 0) + size; }
    else cur = { time: t, open: price, high: price, low: price, close: price, volume: size };
    emit({ ...cur });
  };
}

// ---------- connection hub: one live connection per source, shared by every chart ----------
// Reconnects with backoff, closes while the tab is hidden, re-opens (and re-subscribes) when it returns.
export class Hub {
  constructor(opts) {
    this.o = opts;               // { open(syms, onTick, onStatus) -> close }
    this.subs = new Map();       // sym -> Set(fn)
    this.close = null; this.timer = null; this.fails = 0; this.status = 'idle'; this.msg = '';
    this.hidden = false; this.kick = null;
    this.onStatus = opts.onStatus || (() => {});
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { this.hidden = true; this.stop(); } else if (this.hidden) { this.hidden = false; this.fails = 0; this.start(); }
      });
    }
  }
  set(status, msg = '') { if (status !== this.status || msg !== this.msg) { this.status = status; this.msg = msg; this.onStatus(status, msg); } }
  add(sym, fn) {
    let s = this.subs.get(sym);
    if (!s) { s = new Set(); this.subs.set(sym, s); }
    s.add(fn);
    this.restartSoon();
    return () => { s.delete(fn); if (!s.size) this.subs.delete(sym); this.restartSoon(); };
  }
  restartSoon() { clearTimeout(this.kick); this.kick = setTimeout(() => { this.stop(); this.start(); }, 250); }
  tick(sym, price, ts, size) { const s = this.subs.get(sym); if (s) s.forEach((f) => { try { f(price, ts, size); } catch (e) { /* a chart error must not stop the feed */ } }); }
  stop() { clearTimeout(this.timer); this.timer = null; const c = this.close; this.close = null; try { if (c) c(); } catch (e) { /* closed */ } }
  start() {
    if (this.hidden || this.close || !this.subs.size) { if (!this.subs.size) this.set('idle'); return; }
    this.set('connecting');
    let got = false, done = false;
    const retry = (fatal, msg) => {
      if (done) return; done = true;
      this.stop();
      if (fatal) { this.set('error', msg || 'Connection refused'); return; }
      this.fails++;
      const wait = Math.min(30000, 1000 * 2 ** Math.min(this.fails - 1, 5)) * (0.75 + Math.random() * 0.5);
      this.set('connecting', msg || '');
      this.timer = setTimeout(() => this.start(), wait);
    };
    this.close = this.o.open([...this.subs.keys()], (sym, p, ts, sz) => { if (!got) { got = true; this.fails = 0; this.set('live'); } this.tick(sym, p, ts, sz); },
      { live: () => { this.set('live'); }, fail: retry, resetFails: () => { this.fails = 0; } }) || (() => {});
  }
}

// ---------- adapters ----------
// Each: { id, classes, symbolOf(ourTicker)->theirs|null, getBars(creds, ticker, tf, range), hub(creds, onStatus) -> Hub, check(creds) }
// Deps (fetch / WebSocket) are injected so tests run on recorded fixtures.
// Advisor: a redirect must never carry our key headers to another host; no cookies, no referrer.
const HARD = { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };
const dep = (d) => ({ fetch: (d && d.fetch) || ((...a) => globalThis.fetch(...a)), WS: (d && d.WS) || globalThis.WebSocket });

export const alpaca = {
  id: 'alpaca',
  symbolOf: (t) => { if (/^(byo:)?(NSE|BSE|MCX):/i.test(String(t || ''))) return null; const s = String(t || '').replace(/^[a-z]+:/i, '').toUpperCase(); return /^[A-Z][A-Z0-9.\-]{0,11}$/.test(s) ? s : null; },   // India tickers belong to Upstox / Fyers
  frame: { '1': '1Min', '5': '5Min', '15': '15Min', '30': '30Min', '60': '1Hour', '120': '2Hour', '240': '4Hour', D: '1Day', W: '1Week', M: '1Month' },
  headers: (c) => (c.oauth ? { Authorization: 'Bearer ' + c.access } : { 'APCA-API-KEY-ID': c.key, 'APCA-API-SECRET-KEY': c.secret }),   // sign-in (scope data) or pasted key
  async getBars(c, ticker, timeframe, range = {}, d) {
    const { fetch } = dep(d); const tf = norm(timeframe); const sym = this.symbolOf(ticker);
    const frame = this.frame[tf]; if (!sym || !frame) return [];
    const limit = Math.min(range.limit != null ? range.limit : 500, 10000);
    const asc = range.from != null;
    const qs = new URLSearchParams({ timeframe: frame, limit: String(asc ? 10000 : limit), adjustment: 'raw', feed: c.feed === 'sip' ? 'sip' : 'iex', sort: asc ? 'asc' : 'desc' });
    if (asc) qs.set('start', new Date(range.from).toISOString());
    if (range.to != null) qs.set('end', new Date(range.to).toISOString());
    let out = [], token = null;
    for (let page = 0; page < 3; page++) {
      if (token) qs.set('page_token', token);
      const url = guardUrl('alpaca', 'https://data.alpaca.markets/v2/stocks/' + sym + '/bars?' + qs);
      const r = await fetch(url, { ...HARD, headers: this.headers(c) });
      if (!r.ok) throw Object.assign(new Error('Alpaca ' + r.status), { status: r.status });
      const j = await r.json();
      out = out.concat((j.bars || []).map((b) => ({ time: Date.parse(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v || 0 })));
      token = j.next_page_token;
      if (!token || !asc) break;
    }
    if (!asc) out.reverse();
    return range.limit != null && out.length > range.limit ? out.slice(-range.limit) : out;
  },
  async check(c, d) { await this.getBars(c, 'SPY', '1D', { limit: 1 }, d); },
  hub(c, onStatus, d) {
    const { WS } = dep(d);
    const h = new Hub({
      onStatus,
      open: (syms, onTick, ctl) => {
        const ws = new WS(guardWs('alpaca', 'wss://stream.data.alpaca.markets/v2/' + (c.feed === 'sip' ? 'sip' : 'iex')));
        const send = (m) => ws.send(guardWsMessage('alpaca', m));
        ws.onmessage = (ev) => {
          let arr; try { arr = JSON.parse(ev.data); } catch (e) { return; }
          for (const m of Array.isArray(arr) ? arr : [arr]) {
            if (m.T === 'success' && m.msg === 'connected') send(c.oauth ? { action: 'auth', key: 'oauth', secret: c.access } : { action: 'auth', key: c.key, secret: c.secret });
            else if (m.T === 'success' && m.msg === 'authenticated') send({ action: 'subscribe', trades: syms });
            else if (m.T === 't') onTick(m.S, m.p, Date.parse(m.t), m.s || 0);
            else if (m.T === 'error') {
              if (m.code === 402 || m.code === 401) ctl.fail(true, c.oauth ? 'Reconnect Alpaca' : 'Alpaca refused the key');
              else if (m.code === 406) ctl.fail(false, 'Another app is using your Alpaca stream (one connection per account)');
              else if (m.code === 409) ctl.fail(true, 'Your Alpaca plan has no access to this feed');
              else if (m.code === 405) ctl.fail(true, 'Alpaca symbol limit reached');
              else ctl.fail(false, 'Alpaca error ' + m.code);
            }
          }
        };
        ws.onclose = () => ctl.fail(false);
        ws.onerror = () => { try { ws.close(); } catch (e) { /* closed */ } };
        return () => { ws.onclose = ws.onmessage = ws.onerror = null; try { ws.close(); } catch (e) { /* closed */ } };
      }
    });
    return h;
  },
  subscribe(hub, ticker, timeframe, seed, onBar) {
    const sym = this.symbolOf(ticker);
    return hub.add(sym, (() => { const b = candleBuilder(timeframe, seed, onBar); return (p, ts, sz) => b(p, ts, sz); })());
  }
};

export const oanda = {
  id: 'oanda',
  symbolOf: (t) => { const s = String(t || '').replace(/^[a-z]+:/i, '').toUpperCase().replace('_', ''); return /^[A-Z]{6}$/.test(s) ? s.slice(0, 3) + '_' + s.slice(3) : null; },
  gran: { '1': 'M1', '5': 'M5', '15': 'M15', '30': 'M30', '60': 'H1', '120': 'H2', '240': 'H4', D: 'D', W: 'W', M: 'M' },
  host: (c, stream) => (stream ? 'stream-' : 'api-') + (c.env === 'live' ? 'fxtrade' : 'fxpractice') + '.oanda.com',
  headers: (c) => ({ Authorization: 'Bearer ' + c.token, 'Accept-Datetime-Format': 'UNIX' }),
  accountId: async (c) => { if (!/^[0-9\-]{5,32}$/.test(String(c.account || ''))) throw new Error('Enter your OANDA account ID (like 101-001-1234567-001).'); return c.account; },
  async getBars(c, ticker, timeframe, range = {}, d) {
    const { fetch } = dep(d); const tf = norm(timeframe); const ins = this.symbolOf(ticker);
    const g = this.gran[tf]; if (!ins || !g) return [];
    const qs = new URLSearchParams({ granularity: g, price: 'M' });
    const sec = (ms) => (ms / 1000).toFixed(3);
    if (range.from != null) { qs.set('from', sec(range.from)); if (range.to != null) qs.set('to', sec(range.to)); else qs.set('count', '5000'); }
    else { qs.set('count', String(Math.min(range.limit != null ? range.limit : 500, 5000))); if (range.to != null) qs.set('to', sec(range.to)); }
    const r = await fetch(guardUrl('oanda', 'https://' + this.host(c) + '/v3/instruments/' + ins + '/candles?' + qs), { ...HARD, headers: this.headers(c) });
    if (!r.ok) throw Object.assign(new Error('OANDA ' + r.status), { status: r.status });
    const j = await r.json();
    const out = (j.candles || []).filter((x) => x.mid).map((x) => ({ time: Math.round(Number(x.time) * 1000), open: +x.mid.o, high: +x.mid.h, low: +x.mid.l, close: +x.mid.c, volume: x.volume || 0 }));
    return range.limit != null && out.length > range.limit ? out.slice(-range.limit) : out;
  },
  async check(c, d) { await this.accountId(c); await this.getBars(c, 'EURUSD', '1D', { limit: 1 }, d); },
  hub(c, onStatus, d) {
    const { fetch } = dep(d);
    const h = new Hub({
      onStatus,
      open: (syms, onTick, ctl) => {
        const ac = new AbortController();
        (async () => {
          try {
            const acct = await oanda.accountId(c, d);
            const url = guardUrl('oanda', 'https://' + oanda.host(c, true) + '/v3/accounts/' + acct + '/pricing/stream?instruments=' + syms.join(','));
            const r = await fetch(url, { ...HARD, headers: oanda.headers(c), signal: ac.signal });
            if (r.status === 401 || r.status === 403) return ctl.fail(true, 'OANDA refused the token');
            if (!r.ok || !r.body) return ctl.fail(false, 'OANDA ' + r.status);
            ctl.live();
            const rd = r.body.getReader(), dec = new TextDecoder();
            let buf = '';
            for (;;) {
              const { value, done } = await rd.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              let i;
              while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
                if (!line) continue;
                let m; try { m = JSON.parse(line); } catch (e) { continue; }
                if (m.type === 'PRICE' && m.bids && m.bids[0] && m.asks && m.asks[0]) onTick(m.instrument, (+m.bids[0].price + +m.asks[0].price) / 2, Math.round(Number(m.time) * 1000), 0);
              }
            }
            ctl.fail(false);
          } catch (e) { if (!ac.signal.aborted) ctl.fail(false); }
        })();
        return () => ac.abort();
      }
    });
    return h;
  },
  subscribe(hub, ticker, timeframe, seed, onBar) {
    return hub.add(this.symbolOf(ticker), candleBuilder(timeframe, seed, onBar));
  }
};
export const ironbeam = {
  id: 'ironbeam',
  symbolOf: (t) => { const s = String(t || '').replace(/^byo:/i, '').toUpperCase(); return /^X[A-Z]{3}:[A-Z0-9]{1,6}\.[A-Z]\d{2}$/.test(s) ? s : null; },
  base: (c) => 'https://' + (c.env === 'demo' ? 'demo' : 'live') + '.ironbeamapi.com/v2',
  // shortcut: bar shapes (time-bar frames) are unconfirmed without a real account, so no history yet; live prices only.
  async getBars() { return []; },
  async token(c, d) {
    const { fetch } = dep(d);
    const r = await fetch(guardUrl('ironbeam', this.base(c) + '/auth', 'POST'), { ...HARD, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: c.username, password: c.password, apiKey: c.apiKey }) });
    if (!r.ok) throw Object.assign(new Error('Ironbeam ' + r.status), { status: r.status });
    const j = await r.json(); if (!j || !j.token) throw Object.assign(new Error('Ironbeam refused the sign-in'), { status: 401 });
    return j.token;
  },
  async check(c, d) { await this.token(c, d); },
  hub(c, onStatus, d) {
    const { fetch, WS } = dep(d);
    return new Hub({
      onStatus,
      open: (syms, onTick, ctl) => {
        let ws = null, dead = false;
        (async () => {
          try {
            const tok = await ironbeam.token(c, d);
            const auth = { ...HARD, headers: { Authorization: 'Bearer ' + tok } };
            const sr = await fetch(guardUrl('ironbeam', ironbeam.base(c) + '/stream/create'), auth);
            if (!sr.ok) return ctl.fail(sr.status === 401 || sr.status === 403, 'Ironbeam ' + sr.status);
            const id = (await sr.json()).streamId; if (dead) return;
            ws = new WS(guardWs('ironbeam', ironbeam.base(c).replace('https', 'wss') + '/stream/' + id + '?token=' + tok));
            ws.onopen = async () => { try { await fetch(guardUrl('ironbeam', ironbeam.base(c) + '/market/quotes/subscribe/' + id + '?symbols=' + encodeURIComponent(syms.slice(0, 10).join(','))), auth); ctl.live(); } catch (e) { ctl.fail(false); } };
            ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } for (const q of (m && m.q) || []) if (q && q.s && Number.isFinite(+q.l)) onTick(q.s, +q.l, Date.now(), 0); };
            ws.onclose = () => ctl.fail(false);
            ws.onerror = () => { try { ws.close(); } catch (e) { /* closed */ } };
          } catch (e) { if (!dead) ctl.fail(!!(e && (e.status === 401 || e.status === 403)), e && e.status ? 'Ironbeam refused the sign-in' : ''); }
        })();
        return () => { dead = true; if (ws) { ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null; try { ws.close(); } catch (e) { /* closed */ } } };
      }
    });
  },
  subscribe(hub, ticker, timeframe, seed, onBar) { return hub.add(this.symbolOf(ticker), candleBuilder(timeframe, seed, onBar)); }
};

// ---------- Charles Schwab (OAuth; tokens swapped by our tiny function, data goes browser <-> Schwab) ----------
// Flag: the row turns on only when GET /connect/schwab/token?probe=1 says configured (see probeSchwab). Until then: "Coming soon".
// shortcut: PKCE is OFF (Schwab does not document it; unknown params could be refused). Flip PKCE to true after one real test.
export const SCHWAB = { PKCE: false, AUTH: 'https://api.schwabapi.com/v1/oauth/authorize', REDIRECT: 'https://tradezoro.com/connect/schwab/callback', TOKEN: '/connect/schwab/token', REFRESH_EVERY: 25 * MIN, RT_LIFE: 7 * 864e5, STATE_KEY: 'tz-schwab-state' };
const SW_FUT = new Set(['ES', 'NQ', 'YM', 'RTY', 'MES', 'MNQ', 'MYM', 'M2K', 'CL', 'MCL', 'GC', 'MGC', 'SI', 'NG', 'ZB', 'ZN', 'ZF', 'ZT', 'ZC', 'ZS', 'ZW', '6E', '6B', '6J']);
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function probeSchwab(d) {
  try {
    const r = await dep(d).fetch(SCHWAB.TOKEN + '?probe=1', { credentials: 'omit', cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    return j && j.configured === true && /^[A-Za-z0-9]{8,64}$/.test(j.client_id || '') ? j.client_id : null;
  } catch (e) { return null; }
}
// Builds the Schwab sign-in URL and keeps {state, uid, exp[, verifier]} (single use) in sessionStorage.
export async function schwabAuthUrl(clientId, userId, store = globalThis.sessionStorage) {
  if (!userId) throw new Error('Sign in to connect your own data');
  const rnd = (n) => b64url(globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const rec = { state: rnd(16), uid: userId, exp: Date.now() + 10 * MIN };
  const q = { response_type: 'code', client_id: clientId, redirect_uri: SCHWAB.REDIRECT, state: rec.state };
  if (SCHWAB.PKCE) {
    rec.verifier = rnd(32);
    q.code_challenge = b64url(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(rec.verifier)))); q.code_challenge_method = 'S256';
  }
  store.setItem(SCHWAB.STATE_KEY, JSON.stringify(rec));
  return SCHWAB.AUTH + '?' + new URLSearchParams(q);
}
// Callback side: returns the stored record only if state matches, same user, not expired. Always deletes it first (single use).
export function takeSchwabState(state, userId, store = globalThis.sessionStorage) {
  let rec = null; try { rec = JSON.parse(store.getItem(SCHWAB.STATE_KEY) || 'null'); } catch (e) { /* none */ }
  store.removeItem(SCHWAB.STATE_KEY);
  return rec && state && rec.state === state && rec.uid === userId && rec.exp > Date.now() ? rec : null;
}
// Asks our function to swap a code / refresh a token. Origin is the page's own; the Firebase ID token proves a signed-in member.
export async function schwabTokenCall(body, idToken, d) {
  const r = await dep(d).fetch(SCHWAB.TOKEN, { method: 'POST', ...HARD, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify(body) });
  if (r.status === 503) throw Object.assign(new Error('Schwab is coming soon'), { status: 503 });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.access_token) throw Object.assign(new Error('Schwab ' + r.status), { status: r.status });
  return j;
}
export const schwabCreds = (j, prev, now = Date.now()) => ({ access: j.access_token, refresh: j.refresh_token || (prev && prev.refresh), exp: now + (Number(j.expires_in) || 1800) * 1000,
  rexp: j.refresh_token ? now + SCHWAB.RT_LIFE : (prev && prev.rexp) || now + SCHWAB.RT_LIFE });
// Only these fields of the userPreference reply are kept; the rest of the body (account numbers) is dropped at once.
export function streamerInfoOf(j) {
  const s = j && Array.isArray(j.streamerInfo) && j.streamerInfo[0];
  if (!s || !guardWsSafe(s.streamerSocketUrl)) return null;
  const f = (v) => (typeof v === 'string' && v.length > 0 && v.length < 200 ? v : null);
  const o = { url: s.streamerSocketUrl, customer: f(s.schwabClientCustomerId), correl: f(s.schwabClientCorrelId), channel: f(s.schwabClientChannel), fn: f(s.schwabClientFunctionId) };
  return o.customer && o.correl && o.channel && o.fn ? o : null;
}
const guardWsSafe = (u) => { try { guardWs('schwab', u); return true; } catch (e) { return false; } };
let rid = 1;
export const schwab = {
  id: 'schwab',
  // AAPL -> AAPL; ES1! or /ES or /ESZ26 -> /ES-style futures key. Anything else is refused.
  symbolOf: (t) => {
    const s = String(t || '').replace(/^byo:/i, '').toUpperCase();
    let m;
    if ((m = /^([A-Z0-9]{1,3})1!$/.exec(s)) && SW_FUT.has(m[1])) return '/' + m[1];
    if ((m = /^\/([A-Z0-9]{1,3})([FGHJKMNQUVXZ]\d{2})?$/.exec(s)) && SW_FUT.has(m[1])) return '/' + m[1] + (m[2] || '');
    return /^[A-Z][A-Z0-9.\-]{0,11}$/.test(s) ? s : null;
  },
  isFut: (sym) => sym.startsWith('/'),
  // Schwab minute frequencies are 1/5/10/15/30; 1h/2h/4h are built from 30-minute bars.
  freq: { '1': ['minute', 1, 1], '5': ['minute', 5, 1], '15': ['minute', 15, 1], '30': ['minute', 30, 1], '60': ['minute', 30, 2], '120': ['minute', 30, 4], '240': ['minute', 30, 8], D: ['daily', 1, 1], W: ['weekly', 1, 1], M: ['monthly', 1, 1] },
  // Refreshes the access token when it is close to expiry. One tab at a time (navigator.locks); creds are updated in place and re-saved.
  async fresh(c, d) {
    if (c.exp - Date.now() > 5 * MIN) return c.access;
    if (c.rexp <= Date.now()) throw Object.assign(new Error('Reconnect Schwab'), { reconnect: true });
    const run = async () => {
      if (c.exp - Date.now() > 5 * MIN) return c.access;
      let idt; try { idt = await (d && d.idToken ? d.idToken() : globalThis.firebase.auth().currentUser.getIdToken()); } catch (e) { throw Object.assign(new Error('Sign in again'), { status: 401 }); }
      let j; try { j = await schwabTokenCall({ grant: 'refresh', refresh_token: c.refresh }, idt, d); }
      catch (e) { if (e.status === 400 || e.status === 401) throw Object.assign(new Error('Reconnect Schwab'), { reconnect: true }); throw e; }
      Object.assign(c, schwabCreds(j, c));
      try { await V().save('schwab', c); } catch (e) { /* kept in memory */ }
      return c.access;
    };
    const L = globalThis.navigator && navigator.locks;
    return L ? L.request('tz-schwab-refresh', run) : run();
  },
  async get(c, path, qs, d) {
    const tok = await this.fresh(c, d);
    const r = await dep(d).fetch(guardUrl('schwab', 'https://api.schwabapi.com' + path + (qs ? '?' + qs : '')), { ...HARD, headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' } });
    if (r.status === 401) throw Object.assign(new Error('Reconnect Schwab'), { reconnect: true, status: 401 });
    if (!r.ok) throw Object.assign(new Error('Schwab ' + r.status), { status: r.status });
    return r;
  },
  async getBars(c, ticker, timeframe, range = {}, d) {
    const tf = norm(timeframe); const sym = this.symbolOf(ticker); const f = this.freq[tf];
    if (!sym || !f) return [];
    const [ft, fq, group] = f;
    const limit = range.limit != null ? range.limit : 500;
    const qs = new URLSearchParams({ symbol: sym, frequencyType: ft, frequency: String(fq), needExtendedHoursData: 'true' });
    if (range.from != null) qs.set('startDate', String(Math.floor(range.from)));
    if (range.to != null) qs.set('endDate', String(Math.floor(range.to)));
    if (range.from == null) {   // newest bars: periodType follows the frequency
      const per = ft === 'minute' ? ['day', 10] : ft === 'daily' ? ['year', 2] : ['year', 10];
      if (range.to == null) { qs.set('periodType', per[0]); qs.set('period', String(per[1])); }
      else qs.set('startDate', String(Math.floor(range.to - Math.max(limit * group, 1) * (ft === 'minute' ? fq * MIN * 3 : ft === 'daily' ? 864e5 * 2 : 864e5 * 14))));
    }
    const j = await (await this.get(c, '/marketdata/v1/pricehistory', qs.toString(), d)).json();
    let out = ((j && j.candles) || []).filter((x) => Number.isFinite(x.datetime) && Number.isFinite(x.close)).map((x) => ({ time: x.datetime, open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume || 0 }));
    if (group > 1) {   // build 1h/2h/4h from 30-minute bars on a fixed grid
      const step = group * 30 * MIN, m = new Map();
      for (const b of out) { const t = Math.floor(b.time / step) * step, a = m.get(t); if (!a) m.set(t, { ...b, time: t }); else { a.high = Math.max(a.high, b.high); a.low = Math.min(a.low, b.low); a.close = b.close; a.volume += b.volume; } }
      out = [...m.values()];
    }
    return out.length > limit ? out.slice(-limit) : out;
  },
  async check(c, d) { await this.getBars(c, 'SPY', '1D', { limit: 1 }, d); },
  // The ONE allowed /trader call: userPreference, read only for the streamer socket fields (see streamerInfoOf).
  async streamer(c, d) { return streamerInfoOf(await (await this.get(c, '/trader/v1/userPreference', '', d)).json()); },
  hub(c, onStatus, d) {
    const { WS } = dep(d);
    return new Hub({
      onStatus,
      open: (syms, onTick, ctl) => {
        let ws = null, dead = false;
        (async () => {
          try {
            const info = await schwab.streamer(c, d); if (dead) return;
            if (!info) return ctl.fail(true, 'Schwab did not give a streaming address');
            const tok = await schwab.fresh(c, d);
            ws = new WS(guardWs('schwab', info.url));
            const send = (service, command, parameters) => ws.send(guardWsMessage('schwab', { requests: [{ service, command, requestid: String(rid++), SchwabClientCustomerId: info.customer, SchwabClientCorrelId: info.correl, parameters }] }));
            ws.onopen = () => { try { send('ADMIN', 'LOGIN', { Authorization: tok, SchwabClientChannel: info.channel, SchwabClientFunctionId: info.fn }); } catch (e) { ctl.fail(false); } };
            ws.onmessage = (ev) => {
              let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
              for (const r of m.response || []) if (r.service === 'ADMIN' && r.command === 'LOGIN') {
                const code = r.content && r.content.code;
                if (code === 0) {
                  const eq = syms.filter((x) => !x.startsWith('/')), fu = syms.filter((x) => x.startsWith('/'));
                  if (eq.length) { send('LEVELONE_EQUITIES', 'SUBS', { keys: eq.join(','), fields: '0,3,9' }); send('CHART_EQUITY', 'SUBS', { keys: eq.join(','), fields: '0,5' }); }
                  if (fu.length) { send('LEVELONE_FUTURES', 'SUBS', { keys: fu.join(','), fields: '0,3,9' }); send('CHART_FUTURES', 'SUBS', { keys: fu.join(','), fields: '0,4' }); }
                  ctl.live();
                } else ctl.fail(code === 3, code === 3 ? 'Reconnect Schwab' : 'Schwab sign-in failed');
              }
              for (const dd of m.data || []) {
                const lvl = dd.service === 'LEVELONE_EQUITIES' || dd.service === 'LEVELONE_FUTURES';
                const chart = dd.service === 'CHART_EQUITY' || dd.service === 'CHART_FUTURES';
                if (!lvl && !chart) continue;
                for (const q of dd.content || []) {   // updates carry only the changed fields
                  const p = lvl ? q['3'] : q[dd.service === 'CHART_EQUITY' ? '5' : '4'];
                  if (q.key && Number.isFinite(+p) && p !== null) onTick(q.key, +p, Date.now(), lvl && Number.isFinite(+q['9']) ? +q['9'] : 0);
                }
              }
            };
            ws.onclose = () => ctl.fail(false);
            ws.onerror = () => { try { ws.close(); } catch (e) { /* closed */ } };
          } catch (e) { if (!dead) ctl.fail(!!(e && e.reconnect), e && e.reconnect ? 'Reconnect Schwab' : ''); }
        })();
        return () => { dead = true; if (ws) { ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null; try { ws.close(); } catch (e) { /* closed */ } } };
      }
    });
  },
  subscribe(hub, ticker, timeframe, seed, onBar) { return hub.add(this.symbolOf(ticker), candleBuilder(timeframe, seed, onBar)); }
};
export const ADAPTERS = { alpaca, oanda, ironbeam, schwab };

// ---------- runtime registry: connected sources on this device ----------
// Listeners get { id, status, msg }. Credentials live in memory only after decrypt; they are never logged or exposed on window.
const live = new Map(); // id -> { creds, hub, status, msg }
const listeners = new Set();
let vault = null;
export const onByoChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (id) => { listeners.forEach((f) => { try { f(id); } catch (e) { /* ui error */ } }); try { window.dispatchEvent(new CustomEvent('tz:byo', { detail: { id } })); } catch (e) { /* node */ } };
let uid = null;
const V = () => vault || (vault = makeVault(null, null, () => uid));
function dropLive() { for (const r of live.values()) { clearInterval(r.timer); try { r.hub && r.hub.stop(); } catch (e) { /* closed */ } r.creds = null; } live.clear(); }
// Sign-in state changed: on sign-out or another account, stop every stream, drop keys from memory, wipe the vault.
export async function bindUser(next, deps) {
  next = next || null;
  if (next === uid) return;
  const had = uid; uid = null; dropLive();
  try {
    const owner = await V().owner();
    if (had || (owner && owner !== next) || (!next && owner)) { await V().wipe(); if (next) await V().setOwner(next); }   // sign-out or another account
    else if (next && !owner) await V().setOwner(next);
  } catch (e) { /* no IndexedDB */ }
  uid = next; emit('*');
}
export function activate(id, creds, deps) {
  const ad = ADAPTERS[id]; if (!ad) return;
  const prev = live.get(id); if (prev && prev.hub) prev.hub.stop();
  if (prev && prev.timer) clearInterval(prev.timer);
  const rec = { creds, status: 'ready', msg: '', hub: null, timer: null };
  if (id === 'schwab') {   // keep the access token fresh; when the 7-day refresh token is gone the row says Reconnect
    const tick = () => schwab.fresh(creds, deps).catch((e) => { if (e && e.reconnect) { rec.status = 'error'; rec.msg = 'Reconnect Schwab'; rec.reconnect = true; if (rec.hub) rec.hub.stop(); emit(id); } });
    rec.timer = setInterval(tick, SCHWAB.REFRESH_EVERY); tick();
  }
  if (id === 'ctrader') {   // refresh long before the token expires; a refused refresh says Reconnect
    const tick = () => ad.fresh(creds, deps).catch((e) => { if (e && e.reconnect) { rec.status = 'error'; rec.msg = 'Reconnect cTrader'; rec.reconnect = true; if (rec.hub) rec.hub.stop(); emit(id); } });
    rec.timer = setInterval(tick, 6 * 36e5); tick();
  }
  if ((id === 'tastytrade') && creds.oauth) {   // 15-minute access token: refresh shortly before it ends; a refused refresh says Reconnect
    const tick = () => import('./byo-oauth.js?v=874').then((m) => m.freshOauth(id, creds, deps)).catch((e) => { if (e && e.reconnect) { rec.status = 'error'; rec.msg = e.message; rec.reconnect = true; if (rec.hub) rec.hub.stop(); emit(id); } });
    rec.timer = setInterval(tick, 5 * 60000);
  }
  rec.hub = ad.hub(creds, (st, msg) => { rec.status = st === 'idle' ? 'ready' : st; rec.msg = msg; emit(id); }, deps);
  live.set(id, rec); emit(id);
  if ((creds.oauth && creds.daily) || creds.expires) {   // Upstox / Fyers: the sign-in ends once a day and cannot be refreshed; Dhan (creds.expires): a 24-hour token. At that time the row says Reconnect.
    const gone = () => { if (Date.now() < creds.exp || rec.reconnect) return; rec.status = 'error'; rec.msg = 'Reconnect ' + srcById(id).name; rec.reconnect = true; if (rec.hub) rec.hub.stop(); emit(id); };
    rec.timer = setInterval(gone, 60000); gone();
  }
}
export async function connect(id, creds, deps) {
  const ad = ADAPTERS[id]; if (!ad) throw new Error('Unknown source');
  const c = { ...creds }; await ad.check(c, deps);   // throws on a bad key; nothing is stored before it passes
  if (!uid) throw new Error('Sign in to connect your own data');
  if (c.keep !== 'no') await V().save(id, c);   // keep:'no' = this tab only, nothing written to the vault
  activate(id, c, deps);
}
// Callback page: tokens just swapped for a code. Bound to the signed-in user and stored encrypted like every other key.
export async function saveSchwab(j, deps) {
  if (!uid) throw new Error('Sign in to connect your own data');
  const c = schwabCreds(j); await V().save('schwab', c); activate('schwab', c, deps);
}
// Adapters outside this file (byo-ctrader.js) keep refreshed / new tokens in the same encrypted vault.
// Dhan own-key setup (Client ID, API key, API secret): same encrypted, user-bound vault, under its own name. Never sent anywhere except the one pass-through call.
export const saveKeys = (id, o) => V().save(id, o);
export const loadKeys = (id) => V().load(id);
export const forgetKeys = (id) => V().forget(id);
export async function saveSource(id, creds, deps, start) {
  if (!uid) throw new Error('Sign in to connect your own data');
  await V().save(id, creds); if (start) activate(id, creds, deps);
}
export const statusRec = (id) => live.get(id) || null;
export async function forget(id) { if (id === 'dhan') await V().forget('dhan-key'); const r = live.get(id); if (r) clearInterval(r.timer); if (r && r.hub) r.hub.stop(); live.delete(id); await V().forget(id); emit(id); }
export async function restore(deps) { if (!uid) return; try { for (const id of await V().ids()) { const c = await V().load(id); if (c && ADAPTERS[id]) activate(id, c, deps); } } catch (e) { /* no IndexedDB: nothing saved */ } }
export const connectedIds = () => [...live.keys()];
export const statusOf = (id) => { const r = live.get(id); return r ? { status: r.status, msg: r.msg } : null; };
// Which connected source serves a chart provider kind + ticker? kind: 'fx' | 'idx' | 'byo'.
export const ROUTERS = {};
const IDX_OK = new Set(['SPY', 'QQQ', 'IWM', 'DIA']);
export function route(kind, ticker) {
  for (const [id, r] of live) {
    if (r.status === 'error') continue;
    const ad = ADAPTERS[id];
    if (id === 'oanda' && kind === 'fx' && ad.symbolOf(ticker)) return { id, ad, rec: r };
    if (ROUTERS[id] && ROUTERS[id](kind, ticker, ad)) return { id, ad, rec: r };   // adapters in their own files (byo-tastytrade.js)
    if (id === 'schwab' && ((kind === 'idx' && IDX_OK.has(String(ticker).replace(/^[a-z]+:/i, '').toUpperCase())) || (kind === 'byo' && ad.symbolOf(ticker)))) return { id, ad, rec: r };
    if (id === 'ironbeam' && kind === 'byo' && ad.symbolOf(ticker)) return { id, ad, rec: r };
    if (id === 'alpaca' && ((kind === 'idx' && IDX_OK.has(String(ticker).replace(/^[a-z]+:/i, '').toUpperCase())) || (kind === 'byo' && ad.symbolOf(ticker)))) return { id, ad, rec: r };
  }
  return null;
}
// For the chart's data label / dot: the source name for a chart symbol like "fx:EURUSD", "idx:SPY", "byo:AAPL".
export function labelFor(sym) {
  const m = /^(fx|idx|byo):(.+)$/i.exec(String(sym || ''));
  const r = m && route(m[1].toLowerCase(), m[2]);
  return r ? { id: r.id, name: srcById(r.id).name, status: r.rec.status } : null;
}
