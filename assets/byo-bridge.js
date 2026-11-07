// TradeZoro — "Connect your own data": Data Bridge adapter (ES module, BETA). DATA ONLY.
// Depends on: assets/byo-core.js (ALLOW, ADAPTERS, ROUTERS, SOURCES, Hub, candleBuilder, normTf). Registered by one import in vela-chart.js.
// A small helper the member runs on their own PC (MetaTrader 5, NinjaTrader, Interactive Brokers) serves market data on
// ws://127.0.0.1:<port>. All three speak ONE protocol (tools/bridge/protocol.json). Nothing goes through our servers.
// The protocol has NO order / account / position / balance message; guardSend/guardRecv below enforce the exact list in both
// directions and refuse everything else (tools/tests/byo-bridge.test.mjs proves it). Design + advisor review: stryker-notes/reports/workers/byo-bridge.md
import { ALLOW, ADAPTERS, ROUTERS, SOURCES, Hub, candleBuilder, normTf } from './byo-core.js?v=904';

export const PORTS = [48715, 48716, 48717, 48718, 48719];
const SYM = /^[A-Za-z0-9._\-/ ]{1,32}$/;
// Exact allow-list: type -> the only fields it may carry. Kept equal to tools/bridge/protocol.json by the unit test.
export const C2H = { pair: ['code', 'sn'], hello: ['sn', 'proof'], history: ['rid', 'sym', 'tf', 'count', 'from', 'to'], symbol: ['rid', 'sym'], subscribe: ['syms', 'depth'], unsubscribe: ['syms'], ping: [] };
export const H2C = { welcome: ['hn', 'v', 'paired', 'source'], paired: ['token'], ready: ['proof', 'source', 'caps'], bars: ['rid', 'sym', 'tf', 'bars'], tick: ['sym', 'price', 'ts', 'size'], depth: ['sym', 'bids', 'asks'], symbol: ['rid', 'sym', 'digits', 'desc'], error: ['code', 'msg', 'rid'], pong: [] };
ALLOW.bridge = { hosts: [], paths: [], ws: /^ws:\/\/127\.0\.0\.1:487(1[5-9])$/, wsSend: Object.keys(C2H) };

function check(list, msg, what) {
  const o = typeof msg === 'string' ? (msg.length > 4096 ? null : JSON.parse(msg)) : msg;
  const f = o && typeof o === 'object' && typeof o.t === 'string' && Object.prototype.hasOwnProperty.call(list, o.t) && list[o.t];
  if (!f || !Object.keys(o).every((k) => k === 't' || f.includes(k))) throw new Error('byo-bridge: blocked ' + what + ' message (data only)');
  for (const s of [o.sym, ...(Array.isArray(o.syms) ? o.syms : [])]) if (s !== undefined && !(typeof s === 'string' && SYM.test(s))) throw new Error('byo-bridge: bad symbol');
  if (o.syms !== undefined && (!Array.isArray(o.syms) || o.syms.length > 10)) throw new Error('byo-bridge: too many symbols');
  return o;
}
export const guardSend = (msg) => check(C2H, msg, 'outgoing');
export const guardRecv = (msg) => check(H2C, msg, 'incoming');
export const guardPort = (url) => { if (!ALLOW.bridge.ws.test(url)) throw new Error('byo-bridge: blocked socket (data only)'); return url; };

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const rnd = () => hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
export async function proofOf(token, dir, sn, hn, port, origin) {
  const k = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await globalThis.crypto.subtle.sign('HMAC', k, new TextEncoder().encode([dir, sn, hn, port, origin].join('|'))));
}
const same = (a, b) => typeof a === 'string' && a.length === b.length && [...a].reduce((x, c, i) => x | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;
const fail = (m, code) => Object.assign(new Error(m), { code });
const originOf = () => (globalThis.location && location.origin) || 'https://tradezoro.com';

// One authenticated socket per source id, shared by history and live.
class Link {
  constructor(id, creds, d) { this.id = id; this.c = creds; this.WS = (d && d.WS) || globalThis.WebSocket; this.ws = null; this.ready = null; this.pend = new Map(); this.onTick = null; this.onClose = null; this.n = 1; this.idle = null; }
  open(port, pairCode) {
    return new Promise((res, rej) => {
      const ws = new this.WS(guardPort('ws://127.0.0.1:' + port)); const sn = rnd(); let hn = null, step = 'welcome';
      const to = setTimeout(() => { try { ws.close(); } catch (e) { /* closed */ } rej(fail('The helper did not answer', 'unreachable')); }, 4000);
      const bad = (e) => { clearTimeout(to); try { ws.close(); } catch (x) { /* closed */ } rej(e); };
      ws.onerror = () => bad(fail('Could not reach the helper', 'unreachable'));
      ws.onclose = () => { if (step !== 'done') bad(fail('Could not reach the helper', 'unreachable')); else this.drop(); };
      ws.onmessage = async (ev) => {
        let m; try { m = guardRecv(ev.data); } catch (e) { return bad(fail('The helper sent something unexpected', 'protocol')); }
        try {
          if (m.t === 'error' && step !== 'done') return bad(fail(m.msg || 'Helper refused', m.code || 'refused'));
          if (step === 'welcome' && m.t === 'welcome') {
            if (m.source && m.source !== this.id) return bad(fail('That helper serves a different source', 'source'));
            hn = m.hn; if (typeof hn !== 'string' || hn.length < 16) return bad(fail('Bad helper hello', 'protocol'));
            if (pairCode) { step = 'paired'; ws.send(JSON.stringify(guardSend({ t: 'pair', code: pairCode, sn }))); } else {
              if (!this.c.token) return bad(fail('Pair the helper first', 'unpaired'));
              step = 'ready'; ws.send(JSON.stringify(guardSend({ t: 'hello', sn, proof: await proofOf(this.c.token, 'site', sn, hn, port, originOf()) })));
            }
          } else if (step === 'paired' && m.t === 'paired') { clearTimeout(to); step = 'done'; res({ ws, token: m.token }); }
          else if (step === 'ready' && m.t === 'ready') {
            // The helper must prove it knows the token too: a program that merely grabbed the port cannot.
            if (!same(m.proof, await proofOf(this.c.token, 'helper', sn, hn, port, originOf()))) return bad(fail('The helper did not prove who it is. Forget and pair again.', 'proof'));
            if (m.source !== this.id) return bad(fail('That helper serves a different source', 'source'));
            clearTimeout(to); step = 'done'; ws.onmessage = (e) => this.msg(e.data); res({ ws });
          }
        } catch (e) { bad(e); }
      };
    });
  }
  async connect(pairCode) {
    const ports = this.c.port ? [this.c.port] : PORTS; let last = fail('Could not reach the helper', 'unreachable');
    for (const p of ports) {
      try { const r = await this.open(p, pairCode); this.ws = r.ws; this.port = p; return r; }
      catch (e) { last = e; if (e.code !== 'unreachable') break; }
    }
    throw last;
  }
  ensure() { if (!this.ready) this.ready = this.connect().catch((e) => { this.ready = null; throw e; }); clearTimeout(this.idle); return this.ready; }
  drop() { this.ws = null; this.ready = null; for (const [, p] of this.pend) p.rej(fail('Helper disconnected', 'unreachable')); this.pend.clear(); if (this.onClose) this.onClose(); }
  msg(data) {
    let m; try { m = guardRecv(data); } catch (e) { return; }
    if (m.t === 'tick' && this.onTick && Number.isFinite(m.price) && Number.isFinite(m.ts)) this.onTick(m.sym, m.price, m.ts, Number(m.size) || 0);
    else if (m.rid != null && this.pend.has(m.rid)) { const p = this.pend.get(m.rid); this.pend.delete(m.rid); if (m.t === 'error') p.rej(fail(m.msg || 'Helper error', m.code || 'error')); else p.res(m); }
    else if (m.t === 'ping') this.send({ t: 'pong' });
  }
  send(o) { this.ws.send(JSON.stringify(guardSend(o))); }
  async ask(o, ms = 15000) {
    await this.ensure(); const rid = this.n++;
    return new Promise((res, rej) => { const to = setTimeout(() => { this.pend.delete(rid); rej(fail('The helper took too long', 'timeout')); }, ms); this.pend.set(rid, { res: (m) => { clearTimeout(to); res(m); }, rej: (e) => { clearTimeout(to); rej(e); } }); try { this.send({ ...o, rid }); } catch (e) { this.pend.delete(rid); clearTimeout(to); rej(e); } });
  }
  closeSoon() { clearTimeout(this.idle); this.idle = setTimeout(() => { if (!this.onTick && !this.pend.size && this.ws) { const w = this.ws; this.ws = null; this.ready = null; try { w.close(); } catch (e) { /* closed */ } } }, 4000); }
}
const links = new Map();
const linkOf = (id, c, d) => { let l = links.get(c); if (!l) { l = new Link(id, c, d); links.set(c, l); } return l; };

// First pairing: the member types the one-time code shown in the helper window. Returns the token to store (encrypted, by connect()).
export async function pair(id, code, d) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{8}$/.test(code)) throw fail('Enter the 8-digit code from the helper window.', 'code');
  const l = new Link(id, {}, d); const r = await l.connect(code);
  try { r.ws.onclose = r.ws.onmessage = null; r.ws.close(); } catch (e) { /* closed */ }
  return { token: r.token, port: l.port };
}
// Permission state of the browser's "apps on this device" prompt (Chrome 145+). Unknown name or no API -> "prompt".
export async function loopbackState() {
  try { return (await navigator.permissions.query({ name: 'loopback-network' })).state; } catch (e) { return 'prompt'; }
}

function make(id) {
  const ad = {
    id,
    symbolOf: (t) => { const s = String(t || '').replace(/^byo:/i, ''); return SYM.test(s) ? s : null; },
    async info(t, c) {
      const d = { ticker: t, tickerid: 'BYO:' + t, prefix: 'BYO', description: t, type: 'other', market: 'other', currency: 'USD', mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1, timezone: 'Etc/UTC', session: '24x7' };
      try { const m = await linkOf(id, c).ask({ t: 'symbol', sym: t }, 5000); const dg = Math.max(0, Math.min(8, Number(m.digits) | 0)); return { ...d, description: m.desc || t, pricescale: 10 ** dg, mintick: 10 ** -dg }; } catch (e) { return d; }
    },
    async check(c, d) { const l = new Link(id, c, d); const r = await l.connect(); try { r.ws.close(); } catch (e) { /* closed */ } },
    async getBars(c, ticker, timeframe, range = {}, d) {
      const sym = this.symbolOf(ticker); if (!sym) return [];
      const q = { t: 'history', sym, tf: normTf(timeframe) };
      if (range.from != null) { q.from = Math.floor(range.from); if (range.to != null) q.to = Math.floor(range.to); } else { q.count = Math.min(range.limit != null ? range.limit : 500, 5000); if (range.to != null) q.to = Math.floor(range.to); }
      const m = await linkOf(id, c, d).ask(q);
      const out = (Array.isArray(m.bars) ? m.bars : []).filter((b) => b && [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite)).map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: Number(b.volume) || 0 })).sort((a, b) => a.time - b.time);
      return range.limit != null && out.length > range.limit ? out.slice(-range.limit) : out;
    },
    hub(c, onStatus, d) {
      const l = linkOf(id, c, d);
      return new Hub({
        onStatus,
        open: (syms, onTick, ctl) => {
          let dead = false; const list = syms.slice(0, 10);
          l.onTick = onTick; l.onClose = () => { if (!dead) ctl.fail(false); };
          l.ensure().then(() => { if (dead) return; l.send({ t: 'subscribe', syms: list, depth: false }); ctl.live(); })
            .catch((e) => { if (!dead) ctl.fail(e.code === 'proof' || e.code === 'source' || e.code === 'unpaired', e.code === 'unreachable' ? 'Helper not running' : e.message); });
          return () => { dead = true; l.onTick = null; l.onClose = null; try { if (l.ws) l.send({ t: 'unsubscribe', syms: list }); } catch (e) { /* closed */ } l.closeSoon(); };
        }
      });
    },
    subscribe(hub, ticker, timeframe, seed, onBar) { return hub.add(this.symbolOf(ticker), candleBuilder(timeframe, seed, onBar)); }
  };
  return ad;
}

// ---------- registration ----------
// Download links stay empty until the Owner approves hosting the built helpers (then: { mt5: 'https://…', … }).
export const HELPER_DOWNLOADS = { mt5: 'https://github.com/theelitegrey/Stryker-trading-academy-/releases/download/bridge-v1.0.0/TradeZoroBridge.exe', ibkr: 'https://github.com/theelitegrey/Stryker-trading-academy-/releases/download/bridge-v1.0.0/TradeZoroBridge.exe', ninja: 'https://github.com/theelitegrey/Stryker-trading-academy-/releases/download/bridge-v1.0.0/TradeZoroBridge-NT8.zip' };
export const HOWTO_URL = '/help/desktop-bridge';
const NOTE = 'Beta. Runs a small helper on your Windows PC. Prices go from your platform to the helper to this browser tab, never through TradeZoro.';
const defs = [
  { id: 'mt5', name: 'MetaTrader 5', cls: ['forex', 'futures', 'stocks'], covers: 'Prices from your MetaTrader 5 terminal', help: 'Open MetaTrader 5 and log in (an investor password is enough). Then start the TradeZoro Data Bridge.',
    steps: ['Tap Download below to get TradeZoroBridge.exe.', 'Open the file. If Windows warns you, tap More info, then Run anyway.', 'Open MetaTrader 5 and log in (an investor password is enough). The helper shows an 8-digit code.', 'Copy the 8-digit code into the box below.', 'Tap Pair.'] },
  { id: 'ninja', name: 'NinjaTrader', cls: ['futures'], covers: 'Prices from your NinjaTrader 8 data connection (Tradovate accounts too)', help: 'Import the add-on in NinjaTrader 8, then turn it on from the New menu. Tradovate account (prop firms too)? Log in to NinjaTrader 8 with it first.',
    steps: ['Tap Download below to get the add-on file. Do not unzip it.', 'In NinjaTrader 8 go to Tools, then Import, then NinjaScript Add-On, and pick the file. If Windows warns you, tap More info, then Run anyway.', 'Make sure NinjaTrader 8 is connected to your data, then turn the add-on on from the New menu. It shows an 8-digit code.', 'Copy the 8-digit code into the box below.', 'Tap Pair.'] },
  { id: 'ibkr', name: 'Interactive Brokers', cls: ['stocks', 'futures', 'forex', 'options'], covers: 'Prices from Trader Workstation or IB Gateway', help: 'Open Trader Workstation (or IB Gateway), turn on Read-Only API, then start the TradeZoro Data Bridge.',
    steps: ['Tap Download below to get TradeZoroBridge.exe.', 'Open the file. If Windows warns you, tap More info, then Run anyway.', 'Open Trader Workstation (or IB Gateway) and log in. In Settings, API, turn on the socket API, tick Read-Only API, and note the port number. The helper shows an 8-digit code.', 'Copy the 8-digit code into the box below.', 'Tap Pair.'] }
];
for (const x of defs) {
  ADAPTERS[x.id] = make(x.id);
  ROUTERS[x.id] = (kind, ticker, ad) => kind === 'byo' && !!ad.symbolOf(ticker);
  SOURCES.push({ ...x, fee: 'paid', feeNote: 'Your data fees apply.', state: 'ready', beta: true, bridge: true, fields: [], note: NOTE });
}
