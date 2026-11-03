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
  }
};
export function guardUrl(source, url, method = 'GET') {
  const rule = ALLOW[source];
  const u = new URL(url);
  if (!rule || u.protocol !== 'https:' || !(String(method).toUpperCase() === 'GET' || (String(method).toUpperCase() === 'POST' && (rule.post || []).some((p) => p.test(u.pathname)))) || u.port || u.username || u.password || /[%\\;]|\/\//.test(u.pathname) || !rule.hosts.includes(u.hostname)
    || !rule.paths.some((p) => p.test(u.pathname))) throw new Error('byo-guard: blocked ' + source + ' request (data only)');
  return u.href;
}
export function guardWs(source, url) {
  const rule = ALLOW[source];
  if (!rule || !rule.ws || !rule.ws.test(url)) throw new Error('byo-guard: blocked ' + source + ' socket (data only)');
  return url;
}
export function guardWsMessage(source, msg) {
  const rule = ALLOW[source];
  let a = null;
  try { const o = typeof msg === 'string' ? JSON.parse(msg) : msg; a = o.action || o.type; } catch (e) { /* falls through */ }
  if (!rule || !rule.wsSend || !rule.wsSend.includes(a)) throw new Error('byo-guard: blocked ' + source + ' message (data only)');
  return typeof msg === 'string' ? msg : JSON.stringify(msg);
}

// ---------- source catalogue (the Data source sheet reads this) ----------
// state: 'ready' (built, Connect works) | 'soon' (Coming soon, never a dead button).
// fields: the connect form. Names are used only in the sheet and in the one "Data feed: your <name>" label.
export const SOURCES = [
  { id: 'alpaca', name: 'Alpaca', cls: ['stocks'], covers: 'US stocks and ETFs, live prices', fee: 'free', feeNote: 'Free with your account (IEX feed). The paid SIP feed follows your Alpaca plan.', state: 'ready',
    fields: [{ k: 'key', label: 'API key ID', ph: 'PK…', secret: false }, { k: 'secret', label: 'API secret', ph: '', secret: true }, { k: 'feed', label: 'Feed', type: 'select', opts: [['iex', 'IEX (free plan)'], ['sip', 'SIP (paid plan)']] }],
    help: 'In your Alpaca dashboard create an API key. A paper key works for market data.' },
  { id: 'oanda', name: 'OANDA', cls: ['forex'], covers: 'Forex pairs, live bid/ask prices', fee: 'free', feeNote: 'Free with your account.', state: 'ready',
    fields: [{ k: 'token', label: 'Personal access token', ph: '', secret: true }, { k: 'env', label: 'Account type', type: 'select', opts: [['practice', 'Practice'], ['live', 'Live']] }, { k: 'account', label: 'Account ID', ph: '101-001-1234567-001', secret: false }],
    help: 'In OANDA create a personal access token (Manage API Access).' },
  { id: 'ironbeam', name: 'Ironbeam', cls: ['futures'], covers: 'CME futures, live last price (beta)', fee: 'paid', feeNote: 'Your exchange data fees apply.', state: 'ready', beta: true,
    fields: [{ k: 'username', label: 'Ironbeam username', ph: '', secret: false }, { k: 'password', label: 'Ironbeam password', ph: '', secret: true }, { k: 'apiKey', label: 'API key', ph: '', secret: true }, { k: 'env', label: 'Account type', type: 'select', opts: [['live', 'Live'], ['demo', 'Demo']] }],
    help: 'Beta. Request an API key in your Ironbeam account. Open a contract by typing it like byo:XCME:ES.Z26. Live prices only for now: no history yet.' },
  { id: 'tastytrade', name: 'tastytrade', cls: ['futures', 'stocks'], covers: 'CME futures and US stocks', fee: 'paid', feeNote: 'Your data fees apply.', state: 'soon' },
  { id: 'schwab', name: 'Charles Schwab', cls: ['stocks', 'futures', 'options'], covers: 'Stocks, futures and options', fee: 'paid', feeNote: 'Your data fees apply.', state: 'soon' },
  { id: 'ctrader', name: 'cTrader', cls: ['forex', 'crypto'], covers: 'Forex and crypto CFDs', fee: 'free', feeNote: 'Free with your account.', state: 'soon' }
];
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
  symbolOf: (t) => { const s = String(t || '').replace(/^[a-z]+:/i, '').toUpperCase(); return /^[A-Z][A-Z0-9.\-]{0,11}$/.test(s) ? s : null; },
  frame: { '1': '1Min', '5': '5Min', '15': '15Min', '30': '30Min', '60': '1Hour', '120': '2Hour', '240': '4Hour', D: '1Day', W: '1Week', M: '1Month' },
  headers: (c) => ({ 'APCA-API-KEY-ID': c.key, 'APCA-API-SECRET-KEY': c.secret }),
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
            if (m.T === 'success' && m.msg === 'connected') send({ action: 'auth', key: c.key, secret: c.secret });
            else if (m.T === 'success' && m.msg === 'authenticated') send({ action: 'subscribe', trades: syms });
            else if (m.T === 't') onTick(m.S, m.p, Date.parse(m.t), m.s || 0);
            else if (m.T === 'error') {
              if (m.code === 402 || m.code === 401) ctl.fail(true, 'Alpaca refused the key');
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
export const ADAPTERS = { alpaca, oanda, ironbeam };

// ---------- runtime registry: connected sources on this device ----------
// Listeners get { id, status, msg }. Credentials live in memory only after decrypt; they are never logged or exposed on window.
const live = new Map(); // id -> { creds, hub, status, msg }
const listeners = new Set();
let vault = null;
export const onByoChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (id) => { listeners.forEach((f) => { try { f(id); } catch (e) { /* ui error */ } }); try { window.dispatchEvent(new CustomEvent('tz:byo', { detail: { id } })); } catch (e) { /* node */ } };
let uid = null;
const V = () => vault || (vault = makeVault(null, null, () => uid));
function dropLive() { for (const r of live.values()) { try { r.hub && r.hub.stop(); } catch (e) { /* closed */ } r.creds = null; } live.clear(); }
// Sign-in state changed: on sign-out or another account, stop every stream, drop keys from memory, wipe the vault.
export async function bindUser(next, deps) {
  next = next || null;
  if (next === uid) return;
  const had = uid; uid = null; dropLive();
  try { if (had || next) await V().wipe(); } catch (e) { /* no IndexedDB */ }
  uid = next; emit('*');
}
export function activate(id, creds, deps) {
  const ad = ADAPTERS[id]; if (!ad) return;
  const prev = live.get(id); if (prev && prev.hub) prev.hub.stop();
  const rec = { creds, status: 'ready', msg: '', hub: null };
  rec.hub = ad.hub(creds, (st, msg) => { rec.status = st === 'idle' ? 'ready' : st; rec.msg = msg; emit(id); }, deps);
  live.set(id, rec); emit(id);
}
export async function connect(id, creds, deps) {
  const ad = ADAPTERS[id]; if (!ad) throw new Error('Unknown source');
  const c = { ...creds }; await ad.check(c, deps);   // throws on a bad key; nothing is stored before it passes
  if (!uid) throw new Error('Sign in to connect your own data');
  if (c.keep !== 'no') await V().save(id, c);   // keep:'no' = this tab only, nothing written to the vault
  activate(id, c, deps);
}
export async function forget(id) { const r = live.get(id); if (r && r.hub) r.hub.stop(); live.delete(id); await V().forget(id); emit(id); }
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
