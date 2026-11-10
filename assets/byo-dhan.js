// TradeZoro — "Connect your own data": Dhan (India stocks, index futures, MCX). ES module. DATA ONLY.
// The member pastes THEIR OWN Client ID + 24-hour access token (or, once a Dhan partner app exists, signs in: functions/connect/dhan/token.js). The token lives only in the
// encrypted, user-bound device vault (byo-core.js). Dhan's token could also trade, so this file only ever uses the allow-list in byo-core.js (ALLOW.dhan):
//  - live prices: Dhan's own feed socket (wss://api-feed.dhan.co), subscribe-to-quotes messages only; packets decoded by assets/dhan-feed.js;
//  - price history + the symbol list: our pass-through functions (/connect/dhan/data, /connect/dhan/master). Dhan's REST host refuses browser requests (CORS), see the report.
// Nothing about the account (orders, funds, positions, profile) is requested, kept or shown. Dhan's market data needs the Data plan on the member's own Dhan account.
import { ADAPTERS, ROUTERS, Hub, candleBuilder, guardUrl, guardWs, guardWsMessage, normTf, srcById } from './byo-core.js?v=944';
import { symbolOf as inSym, parts as inParts, info as inInfo, monthSyms } from './byo-india.js?v=944';
import { decodeFrame, SEG_CODE } from './dhan-feed.js?v=944';

const HARD = { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };
const dep = (d) => ({ fetch: (d && d.fetch) || ((...a) => globalThis.fetch(...a)), WS: (d && d.WS) || globalThis.WebSocket, now: (d && d.now) || Date.now });
const fail = (msg, o) => Object.assign(new Error(msg), o);
const IST = 330 * 60000, DAY = 864e5, MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const istStamp = (ms) => new Date(ms + IST).toISOString().slice(0, 19).replace('T', ' ');
const reconnect = () => fail('Reconnect Dhan', { reconnect: true, status: 401 });
const NO_PLAN = 'Your Dhan account has no Data plan. Turn it on in Dhan, then connect again.';
const shown = (msg, o) => fail(msg, { show: true, ...o });   // the connect form prints these as they are

// ---------- symbols ----------
// Same chart tickers as the other India sources, plus BSE: byo:NSE:RELIANCE-EQ, byo:BSE:RELIANCE-EQ, byo:NSE:NIFTY-INDEX, byo:NSE:BANKNIFTY-INDEX, byo:BSE:SENSEX-INDEX,
// byo:NSE:NIFTY1! (front month), byo:NSE:NIFTY26NOVFUT, byo:MCX:GOLD1!.
export function symbolOf(t) {
  const m = /^(?:BYO:)?BSE:([A-Z0-9&\-]{1,20})$/.exec(String(t || '').toUpperCase());
  if (!m) return inSym(t);
  let x;
  if ((x = /^([A-Z0-9&]{1,20})-INDEX$/.exec(m[1]))) return 'BSE:' + x[1] + '-INDEX';
  if ((x = /^([A-Z0-9&\-]{1,20}?)(?:-EQ)?$/.exec(m[1])) && !/-INDEX$/.test(m[1])) return 'BSE:' + x[1] + '-EQ';
  return null;
}
const keyParts = (k) => (/^BSE:/.test(k) ? { ex: 'BSE', name: k.slice(4).replace(/-(EQ|INDEX)$/, ''), type: /-INDEX$/.test(k) ? 'IDX' : 'EQ' } : inParts(k));
const info = (k) => { const x = inInfo(/^BSE:/.test(k) ? 'NSE:' + k.slice(4) : k); return /^BSE:/.test(k) ? { ...x, ticker: k, tickerid: 'BYO:' + k, mintick: 0.01, pricescale: 100, minmove: 1 } : x; };
const IDX = { NIFTY50: 'NIFTY', NIFTYBANK: 'BANKNIFTY', FINNIFTY: 'FINNIFTY', INDIAVIX: 'INDIA VIX' };   // our name -> Dhan UNDERLYING_SYMBOL

// ---------- symbol list (Dhan's security-id master), through our function, cached ----------
const masters = new Map();   // seg -> Promise<rows>; the function answers with a 6-hour cache header too
export async function master(seg, d) {
  if (!masters.has(seg)) {
    const p = (async () => {
      const u = new URL('/connect/dhan/master?seg=' + seg, globalThis.location ? globalThis.location.origin : 'https://tradezoro.com').href;
      const r = await dep(d).fetch(guardUrl('dhan', u), { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!r.ok) throw fail('Dhan symbol list ' + r.status, { status: r.status });
      const j = await r.json(); if (!Array.isArray(j)) throw fail('Dhan symbol list', { status: 502 });
      return j;   // rows: [securityId, symbol, instrument, expiry yyyy-mm-dd | '']
    })();
    p.catch(() => masters.delete(seg));
    masters.set(seg, p);
  }
  return masters.get(seg);
}
export const resetMasters = () => masters.clear();
// our key -> { seg: Dhan segment name, id: security id string, ins: Dhan instrument type } or null
export async function resolve(k, d) {
  const p = keyParts(k), now = dep(d).now();
  if (p.type === 'IDX') {
    const want = p.ex === 'BSE' ? p.name : IDX[p.name] || p.name;
    const row = (await master('IDX_I', d)).find((r) => r[1] === want && r[4] === p.ex);
    return row ? { seg: 'IDX_I', id: String(row[0]), ins: 'INDEX' } : null;
  }
  if (p.type === 'EQ') {
    const seg = p.ex === 'BSE' ? 'BSE_EQ' : 'NSE_EQ';
    const row = (await master(seg, d)).find((r) => r[1] === p.name);
    return row ? { seg, id: String(row[0]), ins: 'EQUITY' } : null;
  }
  const seg = p.ex === 'MCX' ? 'MCX_COMM' : 'NSE_FNO', base = p.name.replace(/\d{2}[A-Z]{3}FUT$/, '').replace(/1!$/, '');
  const today = istDate(now);
  const rows = (await master(seg, d)).filter((r) => r[1] === base && r[3] >= today && /^FUT/.test(r[2])).sort((a, b) => (a[3] < b[3] ? -1 : 1));
  let pick = rows[0];
  if (p.type === 'CON') { const m = /(\d{2})([A-Z]{3})FUT$/.exec(p.name); pick = rows.find((r) => r[3].slice(2, 4) === m[1] && MON[+r[3].slice(5, 7) - 1] === m[2]); }
  return pick ? { seg, id: String(pick[0]), ins: pick[2] } : null;
}

// ---------- history, through our pass-through ----------
const idTokenOf = (d) => (d && d.idToken ? d.idToken() : globalThis.firebase.auth().currentUser.getIdToken());
async function call(c, body, d) {
  if (c.exp && dep(d).now() >= c.exp) throw reconnect();   // the token ended: no call is made
  let idt; try { idt = await idTokenOf(d); } catch (e) { throw fail('Sign in again', { status: 401 }); }
  const u = new URL('/connect/dhan/data', globalThis.location ? globalThis.location.origin : 'https://tradezoro.com').href;
  const r = await dep(d).fetch(guardUrl('dhan', u, 'POST'), { method: 'POST', ...HARD, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idt, 'x-dhan-token': c.access }, body: JSON.stringify(body) });
  if (r.status === 402) throw fail(NO_PLAN, { status: 402, noPlan: true, show: true });
  if (r.status === 401) { const j = await r.json().catch(() => ({})); throw /Dhan did not accept/.test((j && j.error) || '') ? reconnect() : fail('Sign in again', { status: 401 }); }
  if (r.status === 429) throw fail('Dhan is limiting requests', { status: 429 });
  if (!r.ok) throw fail('Dhan ' + r.status, { status: r.status });
  return r.json();
}
const rowsOf = (j) => { const t = (j && j.timestamp) || [], out = []; for (let i = 0; i < t.length; i++) { const b = { time: +t[i] * 1000, open: +j.open[i], high: +j.high[i], low: +j.low[i], close: +j.close[i], volume: +(j.volume && j.volume[i]) || 0 }; if (Number.isFinite(b.time) && Number.isFinite(b.close)) out.push(b); } return out; };
// Dhan has 1/5/15/25/60-minute and daily candles. Our 30/120/240-minute, weekly and monthly bars are built from those, anchored to each day's first bar.
const SRC = { '1': ['1', 1], '5': ['5', 1], '15': ['15', 1], '30': ['15', 2], '60': ['60', 1], '120': ['60', 2], '240': ['60', 4] };
const SPAN = { '1': 5, '5': 30, '15': 60, '60': 90 };   // days per request (Dhan allows 90)
export function aggregate(bars, n, bucketOf) {
  const out = []; let cur = null, key = null, day = null, base = 0;
  for (const b of bars) {
    let k;
    if (bucketOf) k = bucketOf(b.time);
    else { const dk = istDate(b.time); if (dk !== day) { day = dk; base = b.time; } k = dk + ':' + Math.floor((b.time - base) / (n.step)); }
    if (k !== key) { if (cur) out.push(cur); cur = { ...b }; key = k; } else { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += b.volume; }
  }
  if (cur) out.push(cur); return out;
}
const weekKey = (t) => { const d = new Date(t + IST), m = (d.getUTCDay() + 6) % 7; return Math.floor((t + IST) / DAY) - m; };
const monthKey = (t) => new Date(t + IST).toISOString().slice(0, 7);

export const dhan = {
  id: 'dhan', symbolOf, info,
  // Called once when the member connects. Turns the pasted token into the stored shape and tests it with one harmless price call.
  async check(c, d) {
    const id = String(c.clientId || '').trim(), tok = String(c.access || c.token || '').trim();
    if (!/^\d{4,20}$/.test(id)) throw shown('Your Dhan Client ID is the number on your Dhan profile.', { status: 400 });
    if (!/^[A-Za-z0-9._\-]{20,2048}$/.test(tok)) throw shown('That does not look like a Dhan access token.', { status: 400 });
    c.clientId = id; c.access = tok; delete c.token; c.expires = true;
    if (!c.exp) { c.exp = jwtExp(tok) || dep(d).now() + 24 * 36e5; }   // the token is a JWT with its own end time; otherwise 24 hours from now
    const now = dep(d).now();
    try { await call(c, { kind: 'daily', securityId: '13', exchangeSegment: 'IDX_I', instrument: 'INDEX', fromDate: istDate(now - 7 * DAY), toDate: istDate(now + DAY) }, d); }
    catch (e) { throw e && e.reconnect ? shown('Dhan did not accept this token. It may have ended: make a new one and try again.', { status: 401 }) : e && e.noPlan ? shown(NO_PLAN, { status: 402 }) : e; }
  },
  async getBars(c, ticker, timeframe, range = {}, d) {
    const k = symbolOf(ticker), tf = normTf(timeframe); if (!k || !(SRC[tf] || ['D', 'W', 'M'].includes(tf))) return [];
    const ref = await resolve(k, d); if (!ref) return [];
    const limit = range.limit != null ? range.limit : 500, now = dep(d).now(), daily = ['D', 'W', 'M'].includes(tf);
    const base = { securityId: ref.id, exchangeSegment: ref.seg, instrument: ref.ins };
    let to = range.to != null ? range.to : now; const by = new Map();
    const src = daily ? null : SRC[tf], span = daily ? (tf === 'D' ? 1500 : tf === 'W' ? 3000 : 5000) : SPAN[src[0] === '15' ? '15' : src[0]] || 90;
    const need = daily ? limit * (tf === 'D' ? 1 : tf === 'W' ? 5 : 22) : limit * src[1];
    for (let n = 0; n < (daily ? 2 : 4) && by.size < need; n++) {
      const from = Math.max(range.from != null ? range.from : 0, to - span * DAY);
      const j = await call(c, daily ? { kind: 'daily', ...base, fromDate: istDate(from), toDate: istDate(to + DAY) } : { kind: 'intraday', ...base, interval: +src[0], fromDate: istStamp(from - (from + IST) % DAY), toDate: istStamp(to + DAY - (to + IST) % DAY) }, d);
      for (const b of rowsOf(j)) by.set(b.time, b);
      if (range.from != null && from <= range.from) break;
      to = from - DAY;
    }
    let out = [...by.values()].sort((a, b) => a.time - b.time);
    if (range.to != null) out = out.filter((b) => b.time <= range.to);
    if (tf === 'W') out = aggregate(out, 0, weekKey); else if (tf === 'M') out = aggregate(out, 0, monthKey);
    else if (src && src[1] > 1) out = aggregate(out, { step: src[1] * +src[0] * 60000 });
    return out.length > limit ? out.slice(-limit) : out;
  },
  hub(c, onStatus, d) {
    const { WS } = dep(d);
    return new Hub({ onStatus, open: (syms, onTick, ctl) => {
      let ws = null, dead = false;
      (async () => {
        try {
          if (c.exp && dep(d).now() >= c.exp) throw reconnect();
          const keys = new Map(), list = [];
          for (const s of syms) { const r = await resolve(s, d); if (r) { keys.set(SEG_CODE[r.seg] + ':' + r.id, s); list.push({ ExchangeSegment: r.seg, SecurityId: r.id }); } }
          if (dead) return;
          if (!list.length) return ctl.fail(true, 'Dhan has no such symbol');
          const url = 'wss://api-feed.dhan.co?version=2&token=' + c.access + '&clientId=' + c.clientId + '&authType=2';
          ws = new WS(guardWs('dhan', url)); ws.binaryType = 'arraybuffer';
          ws.onopen = () => {
            try { for (let i = 0; i < list.length; i += 100) { const b = list.slice(i, i + 100); ws.send(guardWsMessage('dhan', { RequestCode: 17, InstrumentCount: b.length, InstrumentList: b })); } ctl.live(); } catch (e) { ctl.fail(false); }
          };
          ws.onmessage = (ev) => {
            if (typeof ev.data === 'string') return;
            for (const p of decodeFrame(ev.data)) {
              if (p.type === 'disconnect') { const fatal = p.code !== 805; return ctl.fail(fatal, p.code === 807 ? 'Reconnect Dhan' : p.message); }
              if (p.type !== 'quote' && p.type !== 'ticker') continue;
              const s = keys.get(p.seg + ':' + p.id);
              if (s && p.ltp > 0) onTick(s, p.ltp, lttMs(p.ltt, dep(d).now()), p.ltq || 0);
            }
          };
          ws.onclose = () => ctl.fail(false);
          ws.onerror = () => { try { ws.close(); } catch (e) { /* closed */ } };
        } catch (e) { if (!dead) ctl.fail(!!(e && (e.reconnect || e.status === 402)), e && e.reconnect ? 'Reconnect Dhan' : e && e.noPlan ? NO_PLAN : ''); }
      })();
      return () => { dead = true; if (ws) { ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null; try { ws.close(); } catch (e) { /* closed */ } } };
    } });
  },
  subscribe(hub, ticker, timeframe, seed, onBar) { return hub.add(symbolOf(ticker), candleBuilder(timeframe, seed, onBar)); }
};

// Last-trade time of a packet -> ms. Dhan's time field is whole seconds; the docs do not say whether it carries the India offset, so take whichever reading is closer to now
// (live ticks are never more than a few minutes old); if neither is within 6 hours, use now.
export function lttMs(ltt, now) {
  const a = ltt * 1000, b = a - IST;
  const best = Math.abs(a - now) <= Math.abs(b - now) ? a : b;
  return Math.abs(best - now) <= 6 * 36e5 ? best : now;
}
export function jwtExp(tok) {
  try { const p = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return Number.isFinite(p.exp) && p.exp > 1e9 ? p.exp * 1000 : 0; } catch (e) { return 0; }
}

ADAPTERS.dhan = dhan;
ROUTERS.dhan = (kind, ticker) => kind === 'byo' && !!symbolOf(ticker);

// ---------- partner one-tap (off until the function says it has its partner keys) ----------
const SKEY = 'tz-dhan-state', MIN = 60000;
const post = async (body, idt, d) => { const r = await dep(d).fetch('/connect/dhan/token', { method: 'POST', ...HARD, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idt }, body: JSON.stringify(body) }); const j = r.ok ? await r.json().catch(() => null) : null; if (!j) throw fail('Dhan ' + r.status, { status: r.status }); return j; };
export async function probeDhan(d) { try { const r = await dep(d).fetch('/connect/dhan/token?probe=1', { credentials: 'omit', cache: 'no-store' }); const j = r.ok ? await r.json() : null; return !!(j && j.configured === true); } catch (e) { return false; } }
export async function enableDhanIfConfigured(d) { const on = await probeDhan(d), row = srcById('dhan'); if (on && row) row.partner = true; return on; }
// Step 1 + 2: our function makes the consent; the browser goes to Dhan's own sign-in page. The Dhan page address must be auth.dhan.co.
export async function dhanStart(userId, idToken, d, store = globalThis.sessionStorage) {
  if (!userId) throw new Error('Sign in to connect your own data');
  const { url } = await post({ grant: 'start' }, idToken, d);
  if (!/^https:\/\/auth\.dhan\.co\/consent-login\?consentId=[A-Za-z0-9%\-]{8,100}$/.test(url || '')) throw fail('Dhan sign-in is not available', { status: 502 });
  store.setItem(SKEY, JSON.stringify({ uid: userId, exp: dep(d).now() + 10 * MIN }));
  return url;
}
// Step 3, on the return page: tokenId -> token. Must be the same signed-in user, within 10 minutes, once.
export async function dhanFinish(tokenId, userId, idToken, d, store = globalThis.sessionStorage) {
  let rec = null; try { rec = JSON.parse(store.getItem(SKEY) || 'null'); } catch (e) { /* none */ }
  store.removeItem(SKEY);
  if (!rec || rec.uid !== userId || rec.exp <= dep(d).now()) throw fail('The sign-in link expired', { status: 400 });
  const j = await post({ grant: 'code', code: tokenId }, idToken, d);
  if (typeof j.access_token !== 'string' || !/^\d{4,20}$/.test(j.client_id || '')) throw fail('Dhan did not accept this sign-in', { status: 400 });
  return { access: j.access_token, clientId: j.client_id, expires: true, exp: Number(j.expires_at) || jwtExp(j.access_token) || dep(d).now() + 24 * 36e5 };
}

// ---------- Mode C: sign in with the member's OWN Dhan API key (recommended) ----------
// Setup once: Client ID + API key + API secret go into the device vault ('dhan-key'), never to our server except inside the one pass-through call below.
// Daily: step 1 (consent) and step 3 (tokenId -> token) go through /connect/dhan/key; step 2 is the browser on Dhan's own login page.
export const DHAN_REDIRECT = 'https://tradezoro.com/connect/dhan/callback';
export const keyShape = (k) => !!k && /^\d{4,20}$/.test(String(k.clientId || '')) && /^[A-Za-z0-9._\-]{6,200}$/.test(String(k.appId || '')) && /^[A-Za-z0-9._\-]{6,200}$/.test(String(k.appSecret || ''));
const keyPost = async (body, idt, d) => { const u = new URL('/connect/dhan/key', globalThis.location ? globalThis.location.origin : 'https://tradezoro.com').href; const r = await dep(d).fetch(guardUrl('dhan', u, 'POST'), { method: 'POST', ...HARD, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idt }, body: JSON.stringify(body) }); const j = r.ok ? await r.json().catch(() => null) : null; if (!j) throw fail(r.status === 429 ? 'Too many tries. Wait a minute.' : r.status === 401 ? 'Sign in again' : 'Dhan did not accept this API key. Check the key and secret.', { status: r.status, show: true }); return j; };
export async function dhanKeyStart(keys, userId, idToken, d, store = globalThis.sessionStorage) {
  if (!userId) throw new Error('Sign in to connect your own data');
  if (!keyShape(keys)) throw shown('Enter your Dhan Client ID, API key and API secret.', { status: 400 });
  const { url } = await keyPost({ grant: 'start', clientId: keys.clientId, appId: keys.appId, appSecret: keys.appSecret }, idToken, d);
  if (!/^https:\/\/auth\.dhan\.co\/login\/consentApp-login\?consentAppId=[A-Za-z0-9%\-]{8,100}$/.test(url || '')) throw shown('Dhan sign-in is not available right now.', { status: 502 });
  store.setItem(SKEY, JSON.stringify({ uid: userId, mode: 'key', exp: dep(d).now() + 10 * MIN }));
  return url;
}
export async function dhanKeyFinish(tokenId, keys, userId, idToken, d, store = globalThis.sessionStorage) {
  let rec = null; try { rec = JSON.parse(store.getItem(SKEY) || 'null'); } catch (e) { /* none */ }
  store.removeItem(SKEY);
  if (!rec || rec.mode !== 'key' || rec.uid !== userId || rec.exp <= dep(d).now()) throw fail('The sign-in link expired', { status: 400 });
  if (!keyShape(keys)) throw fail('Dhan keys are not saved on this device', { status: 400 });
  const j = await keyPost({ grant: 'code', code: tokenId, appId: keys.appId, appSecret: keys.appSecret }, idToken, d);
  if (typeof j.access_token !== 'string' || !/^\d{4,20}$/.test(j.client_id || '')) throw fail('Dhan did not accept this sign-in', { status: 400 });
  return { access: j.access_token, clientId: j.client_id, expires: true, exp: Number(j.expires_at) || jwtExp(j.access_token) || dep(d).now() + 24 * 36e5 };
}
