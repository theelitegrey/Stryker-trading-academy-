// TradeZoro — "Connect your own data": Upstox and Fyers (India stocks, index futures, MCX). ES module. DATA ONLY.
// Neither broker has a view-only scope: the member's token could also trade. So this file only ever calls the URLs on the
// allow-list in byo-core.js (ALLOW.upstox / ALLOW.fyers: price history, instrument search, feed address, quotes). Nothing about the
// account is requested, kept or shown. The token swap is our own function (functions/connect/<id>/token.js); tokens live only in the
// encrypted, user-bound device vault. Docs: upstox.com/developer/api-documentation (v3 historical-candle, Market Data Feed V3),
// fyers.in/api-docs/v3 (history, quotes). The Upstox feed is protobuf (assets/vendor/upstox/MarketDataFeed.proto): decoded below, last price only.
import { ALLOW, ADAPTERS, ROUTERS, Hub, candleBuilder, guardUrl, guardWs, guardWsMessage, normTf } from './byo-core.js?v=934';

const HARD = { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };
const dep = (d) => ({ fetch: (d && d.fetch) || ((...a) => globalThis.fetch(...a)), WS: (d && d.WS) || globalThis.WebSocket, now: (d && d.now) || Date.now });
const fail = (msg, o) => Object.assign(new Error(msg), o);
const IST = 330 * 60000, DAY = 864e5;
const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ---------- symbols ----------
// Chart ticker -> our key. byo:NSE:RELIANCE-EQ (or NSE:RELIANCE), NSE:NIFTY-INDEX, NSE:NIFTY1! (front month), MCX:GOLD1!, NSE:NIFTY26NOVFUT. Anything else is refused.
const IDX = { NIFTY: 'NIFTY50', NIFTY50: 'NIFTY50', BANKNIFTY: 'NIFTYBANK', NIFTYBANK: 'NIFTYBANK', FINNIFTY: 'FINNIFTY', INDIAVIX: 'INDIAVIX', VIX: 'INDIAVIX' };
const UP_IDX = { NIFTY50: 'NSE_INDEX|Nifty 50', NIFTYBANK: 'NSE_INDEX|Nifty Bank', FINNIFTY: 'NSE_INDEX|Nifty Fin Service', INDIAVIX: 'NSE_INDEX|India VIX' };
export function symbolOf(t) {
  const m = /^(?:BYO:)?(NSE|MCX):([A-Z0-9&\-!]{1,30})$/.exec(String(t || '').toUpperCase());
  if (!m) return null;
  const [, ex, r] = m; let x;
  if ((x = /^([A-Z0-9&]{1,20})1!$/.exec(r))) return ex + ':' + x[1] + '1!';
  if (/^[A-Z0-9&]{1,20}\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT$/.test(r)) return ex + ':' + r;
  if (ex !== 'NSE') return null;
  if ((x = /^([A-Z0-9&]{1,20})-INDEX$/.exec(r))) return IDX[x[1]] ? 'NSE:' + IDX[x[1]] + '-INDEX' : null;
  if ((x = /^([A-Z0-9&\-]{1,20})-EQ$/.exec(r))) return 'NSE:' + x[1] + '-EQ';
  if (/^[A-Z0-9&\-]{1,20}$/.test(r) && !r.includes('!')) return IDX[r] ? 'NSE:' + IDX[r] + '-INDEX' : 'NSE:' + r + '-EQ';
  return null;
}
export const parts = (k) => { const m = /^(NSE|MCX):(.+?)(-EQ|-INDEX|1!)?$/.exec(k); const t = m[3] || (/FUT$/.test(m[2]) ? 'CON' : ''); return { ex: m[1], name: m[2], type: t === '-EQ' ? 'EQ' : t === '-INDEX' ? 'IDX' : t === '1!' ? 'FRONT' : 'CON' }; };
export const info = (k) => { const p = parts(k); return { ticker: k, tickerid: 'BYO:' + k, prefix: 'BYO', description: p.name + (p.type === 'FRONT' ? ' front month' : p.type === 'IDX' ? ' index' : ''), type: p.type === 'IDX' ? 'index' : p.type === 'EQ' ? 'stock' : 'futures', market: p.type === 'EQ' || p.type === 'IDX' ? 'equity' : 'futures', currency: 'INR', mintick: 0.05, pricescale: 100, minmove: 5, pointvalue: 1, timezone: 'Asia/Kolkata', session: p.ex === 'MCX' ? '0900-2330' : '0915-1530' }; };
// Month label of a front-month search: current month first, then the next five.
export function monthSyms(ex, name, now = Date.now()) {
  const d = new Date(now + IST); const out = [];
  for (let i = 0; i < 6; i++) { const m = (d.getUTCMonth() + i) % 12, y = d.getUTCFullYear() + Math.floor((d.getUTCMonth() + i) / 12); out.push(ex + ':' + name + String(y).slice(2) + MON[m] + 'FUT'); }
  return out;
}

// ---------- Upstox ----------
const UP = 'https://api.upstox.com';
const UP_TF = { '1': ['minutes', 1, 28], '5': ['minutes', 5, 28], '15': ['minutes', 15, 28], '30': ['minutes', 30, 85], '60': ['hours', 1, 85], '120': ['hours', 2, 85], '240': ['hours', 4, 85], D: ['days', 1, 3000], W: ['weeks', 1, 7000], M: ['months', 1, 7000] };   // [unit, interval, days per request] from the v3 table
const reconnect = (name) => fail('Reconnect ' + name, { reconnect: true, status: 401 });
async function upGet(c, url, d) {
  if (c.exp && dep(d).now() >= c.exp) throw reconnect('Upstox');   // the sign-in ended: no call is made
  const r = await dep(d).fetch(guardUrl('upstox', url), { ...HARD, headers: { Authorization: 'Bearer ' + c.access, Accept: 'application/json' } });
  if (r.status === 401) throw reconnect('Upstox');
  if (!r.ok) throw fail('Upstox ' + r.status, { status: r.status });
  return r;
}
const keyPath = (k) => encodeURIComponent(k);   // "|" -> %7C, space -> %20: the only escapes the guard accepts
async function mcxList(d) {   // the small official MCX file (about 300 KB): kept for the tab as futures only
  if (upMcx) return upMcx;
  const r = await dep(d).fetch(guardUrl('upstox-master', 'https://assets.upstox.com/market-quote/instruments/exchange/MCX.json.gz'), { ...HARD });
  if (!r.ok) throw fail('Upstox contract list ' + r.status, { status: r.status });
  const txt = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
  return (upMcx = JSON.parse(txt).filter((x) => x.instrument_type === 'FUT' && x.instrument_key && x.underlying_symbol).map((x) => ({ key: x.instrument_key, und: x.underlying_symbol, exp: +x.expiry })));
}
let upMcx = null;
const upFut = new Map();   // "NSE:NIFTY" -> {key, until}
export async function upstoxKey(c, k, d) {
  const p = parts(k), now = dep(d).now();
  if (p.type === 'IDX') return UP_IDX[p.name];
  if (p.type === 'EQ') {
    const q = new URLSearchParams({ query: p.name, exchanges: 'NSE', segments: 'EQ', records: '30' });
    const j = await (await upGet(c, UP + '/v2/instruments/search?' + q, d)).json();
    const it = ((j && j.data) || []).find((x) => x.segment === 'NSE_EQ' && x.trading_symbol === p.name && x.instrument_type === 'EQ');
    return it ? it.instrument_key : null;
  }
  const ck = p.ex + ':' + p.name; let hit = upFut.get(ck);
  if (p.type === 'FRONT' && hit && hit.until > now) return hit.key;
  let list;
  if (p.ex === 'MCX') list = (await mcxList(d)).filter((x) => x.und === p.name).map((x) => ({ key: x.key, exp: x.exp }));
  else {
    const get = async (extra) => { const q = new URLSearchParams({ query: p.name.replace(/\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)FUT$/, ''), exchanges: 'NSE', segments: 'FO', instrument_types: 'FUT', records: '30', ...extra }); return ((await (await upGet(c, UP + '/v2/instruments/search?' + q, d)).json()).data || []); };
    let rows = await get({ expiry: 'current_month,next_month' }); if (!rows.length) rows = await get({});
    const base = p.name.replace(/\d{2}[A-Z]{3}FUT$/, '').replace(/1!$/, '');
    list = rows.filter((x) => x.instrument_type === 'FUT' && x.underlying_symbol === base).map((x) => ({ key: x.instrument_key, exp: +x.expiry }));
  }
  list = list.filter((x) => x.exp > now).sort((a, b) => a.exp - b.exp);
  let pick = list[0];
  if (p.type === 'CON') { const m = /(\d{2})([A-Z]{3})FUT$/.exec(p.name); pick = list.find((x) => { const e = new Date(x.exp + IST); return String(e.getUTCFullYear()).slice(2) === m[1] && MON[e.getUTCMonth()] === m[2]; }); }
  if (pick && p.type === 'FRONT') upFut.set(ck, { key: pick.key, until: Math.min(pick.exp, now + 12 * 36e5) });
  return pick ? pick.key : null;
}
// "2025-01-01T00:00:00+05:30" rows, newest first -> chart bars oldest first
const upBars = (j) => ((j && j.data && j.data.candles) || []).map((x) => ({ time: Date.parse(x[0]), open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +x[5] || 0 })).filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close)).reverse();

// Minimal protobuf reader for Market Data Feed V3 (field numbers from MarketDataFeed.proto): last price only.
function* fields(u8) {
  let i = 0;
  const vi = () => { let r = 0, m = 1; for (;;) { if (i >= u8.length) throw new Error('short'); const b = u8[i++]; r += (b & 127) * m; m *= 128; if (b < 128) return r; } };
  while (i < u8.length) {
    const k = vi(), f = Math.floor(k / 8), w = k & 7;
    if (w === 0) yield [f, vi()];
    else if (w === 1) { if (i + 8 > u8.length) throw new Error('short'); yield [f, new DataView(u8.buffer, u8.byteOffset + i, 8)]; i += 8; }
    else if (w === 2) { const n = vi(); if (i + n > u8.length) throw new Error('short'); yield [f, u8.subarray(i, i + n)]; i += n; }
    else if (w === 5) { i += 4; } else throw new Error('wire');
  }
}
const ltpcOf = (b) => { const o = {}; for (const [f, v] of fields(b)) { if (f === 1) o.ltp = v.getFloat64(0, true); else if (f === 2) o.ltt = v; else if (f === 3) o.ltq = v; } return o; };
export function decodeFeed(buf) {
  const out = { type: 0, ticks: [] };
  for (const [f, v] of fields(new Uint8Array(buf))) {
    if (f === 1) out.type = v;
    else if (f === 2 && v.length) {   // map entry: 1 = instrument key, 2 = Feed
      let key = '', feed = null;
      for (const [ef, ev] of fields(v)) { if (ef === 1) key = new TextDecoder().decode(ev); else if (ef === 2) feed = ev; }
      if (!key || !feed) continue;
      let ltpc = null;
      for (const [ff, fv] of fields(feed)) {
        if (ff === 1) ltpc = fv;                                                       // ltpc mode
        else if (ff === 2) { for (const [uf, uv] of fields(fv)) if (uf === 1 || uf === 2) for (const [lf, lv] of fields(uv)) if (lf === 1) ltpc = lv; }   // full feed: marketFF / indexFF
        else if (ff === 3) { for (const [lf, lv] of fields(fv)) if (lf === 1) ltpc = lv; }  // first level + greeks
      }
      const q = ltpc && ltpcOf(ltpc);
      if (q && Number.isFinite(q.ltp) && q.ltp > 0) out.ticks.push({ key, ltp: q.ltp, ltt: q.ltt || 0, ltq: q.ltq || 0 });
    }
  }
  return out;
}

export const upstox = {
  id: 'upstox', symbolOf, info,
  async check(c, d) { const t = istDate(dep(d).now()); await upGet(c, UP + '/v3/historical-candle/' + keyPath(UP_IDX.NIFTY50) + '/days/1/' + t + '/' + istDate(dep(d).now() - 7 * DAY), d); },
  async getBars(c, ticker, timeframe, range = {}, d) {
    const sym = symbolOf(ticker), tf = normTf(timeframe), f = UP_TF[tf]; if (!sym || !f) return [];
    const key = await upstoxKey(c, sym, d); if (!key) return [];
    const now = dep(d).now(), to = range.to != null ? range.to : now, from = Math.max(range.from != null ? range.from : 0, to - f[2] * DAY);
    const hist = await (await upGet(c, `${UP}/v3/historical-candle/${keyPath(key)}/${f[0]}/${f[1]}/${istDate(to)}/${istDate(from)}`, d)).json();
    let out = upBars(hist);
    if (range.to == null && tf !== 'W' && tf !== 'M') {   // today's candles come from the intraday endpoint
      try { const j = await (await upGet(c, `${UP}/v3/historical-candle/intraday/${keyPath(key)}/${f[0]}/${f[1]}`, d)).json(); const by = new Map(out.map((b) => [b.time, b])); for (const b of upBars(j)) by.set(b.time, b); out = [...by.values()].sort((a, b) => a.time - b.time); }
      catch (e) { if (e && e.reconnect) throw e; /* history still shows */ }
    }
    const limit = range.limit != null ? range.limit : 500;
    return out.length > limit ? out.slice(-limit) : out;
  },
  hub(c, onStatus, d) {
    const { WS } = dep(d);
    return new Hub({ onStatus, open: (syms, onTick, ctl) => {
      let ws = null, dead = false;
      (async () => {
        try {
          const keys = new Map();
          for (const s of syms) { const k = await upstoxKey(c, s, d); if (k) keys.set(k, s); }
          if (dead) return;
          if (!keys.size) return ctl.fail(true, 'Upstox has no such symbol');
          const j = await (await upGet(c, UP + '/v3/feed/market-data-feed/authorize', d)).json();
          const url = j && j.data && j.data.authorized_redirect_uri; if (dead) return;
          ws = new WS(guardWs('upstox', url)); ws.binaryType = 'arraybuffer';
          ws.onopen = () => { try { ws.send(new TextEncoder().encode(guardWsMessage('upstox', { guid: 'tz' + dep(d).now(), method: 'sub', data: { mode: 'ltpc', instrumentKeys: [...keys.keys()] } })))   ; ctl.live(); } catch (e) { ctl.fail(false); } };
          ws.onmessage = (ev) => {
            if (typeof ev.data === 'string') return;
            let m; try { m = decodeFeed(ev.data); } catch (e) { return; }
            for (const t of m.ticks) { const s = keys.get(t.key); if (s) onTick(s, t.ltp, t.ltt || dep(d).now(), t.ltq || 0); }
          };
          ws.onclose = () => ctl.fail(false);
          ws.onerror = () => { try { ws.close(); } catch (e) { /* closed */ } };
        } catch (e) { if (!dead) ctl.fail(!!(e && (e.reconnect || e.status === 400)), e && e.reconnect ? 'Reconnect Upstox' : ''); }
      })();
      return () => { dead = true; if (ws) { ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null; try { ws.close(); } catch (e) { /* closed */ } } };
    } });
  },
  subscribe(hub, ticker, timeframe, seed, onBar) { return hub.add(symbolOf(ticker), candleBuilder(timeframe, seed, onBar)); }
};

// ---------- Fyers ----------
// Prices come from the quotes call every POLL_MS (the data socket speaks Fyers' own binary protocol; not built, see the report). The Standard plan
// allows 50 data calls a minute and 5,000 a day, so the poll is slow on purpose and stops while the tab is hidden (Hub).
export const POLL_MS = 15000;
const FY = 'https://api-t1.fyers.in';
const FY_RES = { '1': '1', '5': '5', '15': '15', '30': '30', '60': '60', '120': '120', '240': '240', D: 'D', W: '1W', M: '1M' };
const FY_SPAN = { '1': 95, '5': 95, '15': 95, '30': 95, '60': 95, '120': 95, '240': 95, D: 360, W: 360, M: 360 };   // days per request (limits: 100 / 366)
async function fyGet(c, path, params, d) {
  if (c.exp && dep(d).now() >= c.exp) throw reconnect('Fyers');
  const r = await dep(d).fetch(guardUrl('fyers', FY + path + '?' + new URLSearchParams(params)), { ...HARD, headers: { Authorization: c.appId + ':' + c.access, Accept: 'application/json' } });
  const j = await r.json().catch(() => null);
  const code = j && j.code;
  if (r.status === 401 || [-8, -15, -16, -17].includes(code)) throw reconnect('Fyers');
  if (r.status === 429 || code === -429) throw fail('Fyers is limiting requests', { status: 429 });
  if (!r.ok || !j || (j.s && j.s !== 'ok' && !Array.isArray(j.d))) throw fail('Fyers ' + (r.status || code), { status: r.status || 400 });
  return j;
}
const fyFront = new Map();
export async function fyersSym(c, k, d) {
  const p = parts(k), now = dep(d).now();
  if (p.type !== 'FRONT') return k;
  const hit = fyFront.get(k); if (hit && hit.until > now) return hit.sym;
  const cands = monthSyms(p.ex, p.name, now);
  let ok = null;
  const j = await fyGet(c, '/data/quotes', { symbols: cands.join(',') }, d).catch((e) => { if (e.reconnect || e.status === 429) throw e; return null; });
  for (const x of (j && j.d) || []) if (x.s === 'ok' && cands.includes(x.n) && (!ok || cands.indexOf(x.n) < cands.indexOf(ok))) ok = x.n;
  if (!ok) for (const s of cands) { const jj = await fyGet(c, '/data/quotes', { symbols: s }, d).catch((e) => { if (e.reconnect || e.status === 429) throw e; return null; }); if (jj && (jj.d || []).some((x) => x.s === 'ok')) { ok = s; break; } }
  if (ok) fyFront.set(k, { sym: ok, until: now + 6 * 36e5 });
  return ok;
}
export const fyers = {
  id: 'fyers', symbolOf, info,
  async check(c, d) { await fyGet(c, '/data/quotes', { symbols: 'NSE:NIFTY50-INDEX' }, d); },
  async getBars(c, ticker, timeframe, range = {}, d) {
    const k = symbolOf(ticker), tf = normTf(timeframe), res = FY_RES[tf]; if (!k || !res) return [];
    const sym = await fyersSym(c, k, d); if (!sym) return [];
    const limit = range.limit != null ? range.limit : 500, step = FY_SPAN[tf] * DAY, by = new Map();
    let to = range.to != null ? range.to : dep(d).now();
    for (let n = 0; n < 4 && by.size < limit; n++) {   // walk back in allowed windows until there are enough bars
      const from = Math.max(range.from != null ? range.from : 0, to - step);
      const j = await fyGet(c, '/data/history', { symbol: sym, resolution: res, date_format: '1', range_from: istDate(from), range_to: istDate(to), cont_flag: '1' }, d);
      for (const x of j.candles || []) { const t = +x[0] * 1000; if (Number.isFinite(t) && Number.isFinite(+x[4])) by.set(t, { time: t, open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +x[5] || 0 }); }
      if (range.from != null && from <= range.from) break;
      to = from - DAY;
    }
    const out = [...by.values()].sort((a, b) => a.time - b.time);
    return out.length > limit ? out.slice(-limit) : out;
  },
  hub(c, onStatus, d) {
    return new Hub({ onStatus, open: (syms, onTick, ctl) => {
      let timer = null, dead = false, map = null;
      const tick = async () => {
        try {
          if (!map) { map = new Map(); for (const s of syms) { const f = await fyersSym(c, s, d); if (f) map.set(f, s); } }
          if (dead) return;
          const all = [...map.keys()];
          for (let i = 0; i < all.length; i += 50) {
            const j = await fyGet(c, '/data/quotes', { symbols: all.slice(i, i + 50).join(',') }, d); if (dead) return;
            for (const x of j.d || []) { const lp = x.v && +x.v.lp, s = map.get(x.n); if (x.s === 'ok' && s && Number.isFinite(lp) && lp > 0) onTick(s, lp, dep(d).now(), 0); }
          }
          ctl.live();
        } catch (e) { if (dead) return; clearInterval(timer); ctl.fail(!!(e && e.reconnect), e && e.reconnect ? 'Reconnect Fyers' : e && e.status === 429 ? 'Fyers is limiting requests' : ''); }
      };
      timer = setInterval(tick, POLL_MS); tick();
      return () => { dead = true; clearInterval(timer); };
    } });
  },
  subscribe(hub, ticker, timeframe, seed, onBar) { return hub.add(symbolOf(ticker), candleBuilder(timeframe, seed, onBar)); }
};

ADAPTERS.upstox = upstox; ADAPTERS.fyers = fyers;
ROUTERS.upstox = (kind, ticker) => kind === 'byo' && !!symbolOf(ticker);
ROUTERS.fyers = ROUTERS.upstox;
