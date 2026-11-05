// STOCKS ENGINE (Owner order 2026-11-05: "add all stocks data from insightsentry to our website, if possible use same engine as futures").
// Every stock / ETF / fund / DR the provider lists (279 exchange entries, 67 countries) is searchable and chartable. Same shape as the
// futures tick engine (src/tick-engine.js): ONE store in the BookRecorder Durable Object, ONE candle source the chart reads (/sk-bars),
// the provider key only on the server, the 10-minute lane cut decided on the server from the verified token.
//
// Plan limits it is built to (measured 2026-11-05, handback reports/workers/stocks-engine.md):
//   REST 120,000 / month, 40 / min, 3 concurrent history calls (shared with the GEX / news / scanner feeders, which spend ~3,000 a weekday)
//   WebSocket: 5 symbol units per socket; 1 series stream = 1 unit, 10 QUOTE streams = 1 unit; 120 subscription messages / 3 h.
// So:
//   HISTORY  one REST /series call per (symbol, timeframe), stored (SQLite row skser) and re-used by every viewer; re-fetched only when
//            stale (ttlFor below) and only inside the stocks budget (StockBudget: SK_DAY_MAX a UTC day, SK_MIN_MAX a minute, 2 at once).
//   LIVE     quotes (not series) ride the site's ONE provider socket (src/is-hub.js), 10 symbols per unit, up to the units the futures
//            bridge leaves free (50 symbols with the bridge idle). Each quote moves a 1-second and a 1-minute "tail" kept in memory; a
//            /sk-bars read = the stored series + the tail folded onto the series' own bar grid. Symbols wanted = opened in the last
//            WANT_IDLE_MS (on demand) + the HOT list during US hours. A symbol with no quote slot is re-fetched on a short TTL instead.
//   SPEND    only a VERIFIED signed-in request (spend = true, decided in index.js) may cause a provider call; anyone else is served from
//            the store / memory only, so a script without an account cannot drain the budget.
//   Over budget: the stored series is served as it is (x-sk-stale), never a provider call. Futures / GEX / news feeders never starve:
//            stocks stop at their own cap, far below the plan.
// Tick charts (N-tick) are not offered for stocks: the plan streams trades for 5 symbols at most, all used by futures.
import { delayCut } from './tick-engine.js';

export const SK_REST = 'https://api.insightsentry.com/v3';
export const SK_DEF = {
  // DAY_MAX / MONTH_STOP: CoS budget rule 2026-11-05 (IS month at ~90 %, resets 9 Nov): at most ~1,500 stock calls a UTC day, and NO
  // provider call at all once the shared monthly REST counter (is-usage.js summary().used) passes MONTH_STOP; stored bars are served.
  DAY_MAX: 1500, MONTH_STOP: 115000, MIN_MAX: 10, CONC: 2, WANT_IDLE_MS: 2 * 3600000, MEM_SERIES: 40, SEC_KEEP: 900, MIN_KEEP: 480,
  FETCH_TIMEOUT_MS: 12000, SEARCH_TTL_MS: 86400000, INFO_TTL_MS: 7 * 86400000, QUOTE_FRESH_MS: 300000
};
// Hot list (Owner brief: SPY QQQ IWM DIA + the top US names). 30 = 3 quote units; checked against the provider 2026-11-05 (all OPEN, 0 s delay).
export const SK_HOT = ['AMEX:SPY', 'NASDAQ:QQQ', 'AMEX:IWM', 'AMEX:DIA', 'NASDAQ:AAPL', 'NASDAQ:MSFT', 'NASDAQ:NVDA', 'NASDAQ:AMZN', 'NASDAQ:GOOGL', 'NASDAQ:META',
  'NASDAQ:TSLA', 'NASDAQ:AVGO', 'NASDAQ:AMD', 'NASDAQ:NFLX', 'NASDAQ:COST', 'NYSE:JPM', 'NYSE:V', 'NYSE:MA', 'NYSE:UNH', 'NYSE:XOM',
  'NYSE:LLY', 'NYSE:WMT', 'NYSE:HD', 'NYSE:BAC', 'NYSE:ORCL', 'NYSE:CRM', 'NYSE:KO', 'NYSE:PG', 'NASDAQ:PLTR', 'NYSE:BRK.B'];
// provider types we serve (anything else, e.g. futures / crypto / forex / options, is refused: the budget is for stocks)
export const SK_TYPES = /^(STOCK|FUND|ETF|ETN|DR|PREFERRED|UNIT|TRUST|REIT)$/;
export const codeOk = (c) => /^[A-Z0-9_]{1,16}:[A-Z0-9][A-Z0-9._-]{0,23}$/.test(String(c || ''));
const MIN = 60000;

// chart timeframe -> provider bar spec. '5S' seconds, '1'..'1440' minutes, 'D' 'W' 'M' (and 1D/1W/1M). null = not served.
export function skSpec(tf) {
  const s = String(tf || '').toUpperCase();
  let m = /^(\d+)S$/.exec(s);
  if (m) { const n = +m[1]; return n >= 1 && n <= 59 ? { bt: 'second', n, ms: n * 1000, k: 's', dp: 5000 } : null; }
  m = /^(\d+)$/.exec(s);
  if (m) { const n = +m[1]; return n >= 1 && n <= 1440 ? { bt: 'minute', n, ms: n * MIN, k: 'm', dp: n < 5 ? 20000 : 10000 } : null; }
  if (/^1?D$/.test(s)) return { bt: 'day', n: 1, ms: 86400000, k: 'D', dp: 30000 };
  if (/^1?W$/.test(s)) return { bt: 'week', n: 1, ms: 7 * 86400000, k: 'W', dp: 5000 };
  if (/^1?M$/.test(s)) return { bt: 'month', n: 1, ms: 30 * 86400000, k: 'M', dp: 2000 };
  return null;
}
// US extended hours (04:00-20:00 New York, Mon-Fri): when the HOT list is subscribed
export function usExtOpen(ms) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(ms));
  const o = {}; for (const x of p) o[x.type] = x.value;
  if (o.weekday === 'Sat' || o.weekday === 'Sun') return false;
  const min = (+o.hour % 24) * 60 + (+o.minute);
  return min >= 240 && min < 1200;
}
// How long a stored series may be served before a re-fetch is wanted. live = the symbol's quotes are arriving (the tail keeps it current).
export function ttlFor(sp, live, closedGuess) {
  if (closedGuess) return sp.k === 's' || sp.k === 'm' ? 30 * MIN : 6 * 3600000;
  if (sp.k === 's') return live ? 20 * MIN : 60000;
  if (sp.k === 'm') return live ? 30 * MIN : (sp.n <= 5 ? 60000 : 3 * MIN);
  return live ? 2 * 3600000 : 30 * MIN;
}

// Budget: at most dayMax provider calls a UTC day and minMax in any 60 s, conc at once. Pure (clock injected), unit-tested.
export class StockBudget {
  // o.monthUsed(): the shared monthly REST counter now (all sources); null / unknown = no month stop
  constructor(o = {}) { this.dayMax = o.dayMax ?? SK_DEF.DAY_MAX; this.minMax = o.minMax ?? SK_DEF.MIN_MAX; this.conc = o.conc ?? SK_DEF.CONC; this.monthStop = o.monthStop ?? SK_DEF.MONTH_STOP; this.monthUsed = o.monthUsed || (() => null); this.now = o.now || (() => Date.now()); this.day = ''; this.dayN = 0; this.win = []; this.busy = 0; this.refused = 0; }
  roll() { const t = this.now(), d = new Date(t).toISOString().slice(0, 10); if (d !== this.day) { this.day = d; this.dayN = 0; } while (this.win.length && t - this.win[0] >= 60000) this.win.shift(); return t; }
  monthOver() { let u = null; try { u = this.monthUsed(); } catch (e) {} return Number.isFinite(u) && u >= this.monthStop; }
  can() { this.roll(); return this.dayN < this.dayMax && this.win.length < this.minMax && this.busy < this.conc && !this.monthOver(); }
  take() { const t = this.roll(); if (!(this.dayN < this.dayMax && this.win.length < this.minMax && this.busy < this.conc) || this.monthOver()) { this.refused++; return false; } this.dayN++; this.win.push(t); this.busy++; return true; }
  done() { this.busy = Math.max(0, this.busy - 1); }
  stats() { this.roll(); let mu = null; try { mu = this.monthUsed(); } catch (e) {} return { day: this.day, used: this.dayN, dayMax: this.dayMax, lastMin: this.win.length, minMax: this.minMax, busy: this.busy, refused: this.refused, monthUsed: Number.isFinite(mu) ? mu : null, monthStop: this.monthStop, monthStopped: this.monthOver() }; }
}

// Live tail of one symbol from quote updates: 1-second and 1-minute bars [t_ms, o, h, l, c, v], newest last, plus the latest quote.
export class Tail {
  constructor(o = {}) { this.secKeep = o.secKeep || SK_DEF.SEC_KEEP; this.minKeep = o.minKeep || SK_DEF.MIN_KEEP; this.s = []; this.m = []; this.q = null; this.vol = null; this.at = 0; }
  // q = a (sparse) quote update; fields merge into the snapshot. recv = our receive time (ms).
  add(u, recv) {
    const q = this.q = Object.assign(this.q || {}, u);
    this.at = recv;
    const px = Number(u.last_price), t = Number(u.lp_time) > 0 ? Number(u.lp_time) * 1000 : recv;
    let dv = 0;
    if (u.volume != null && Number.isFinite(+u.volume)) { const v = +u.volume; if (this.vol != null && v >= this.vol) dv = v - this.vol; this.vol = v; }
    const p = px > 0 ? px : Number(q.last_price);
    if (!(p > 0)) return;
    if (!(px > 0) && !dv) return;   // nothing traded (bid/ask only)
    this.fold(this.s, Math.floor(t / 1000) * 1000, p, dv, this.secKeep);
    this.fold(this.m, Math.floor(t / MIN) * MIN, p, dv, this.minKeep);
  }
  fold(arr, b, p, dv, keep) {
    const last = arr[arr.length - 1];
    if (last && last[0] === b) { if (p > last[2]) last[2] = p; if (p < last[3]) last[3] = p; last[4] = p; last[5] += dv; return; }
    if (last && b < last[0]) { last[5] += dv; return; }   // late, out of order: volume only
    arr.push([b, p, p, p, p, dv]);
    if (arr.length > keep) arr.splice(0, arr.length - keep);
  }
}

// stored series (ascending [t,o,h,l,c,v]) + the tail, folded onto the series' grid. Returns a NEW array (the stored one is not touched).
export function mergeTail(bars, at, sp, tail) {
  const out = bars.map((b) => b.slice());
  if (!tail) return out;
  if (sp.k === 'D' || sp.k === 'W' || sp.k === 'M') {
    const q = tail.q, last = out[out.length - 1];
    if (!q || !last || !(Number(q.last_price) > 0)) return out;
    const lt = Number(q.lp_time) * 1000;
    if (!(lt >= last[0])) return out;
    if (sp.k === 'D' && lt - last[0] >= 86400000) return out;   // a new session the store has not seen yet: the next re-fetch adds it
    const hi = Number(q.high_price), lo = Number(q.low_price);
    if (hi > 0) last[2] = Math.max(last[2], hi); if (lo > 0) last[3] = Math.min(last[3], lo);
    last[2] = Math.max(last[2], +q.last_price); last[3] = Math.min(last[3], +q.last_price); last[4] = +q.last_price;
    if (sp.k === 'D' && Number(q.volume) > last[5]) last[5] = +q.volume;
    return out;
  }
  const src = sp.k === 's' ? tail.s : tail.m, unit = sp.k === 's' ? 1000 : MIN;
  const fu = Math.floor(at / unit) * unit;   // the unit the fetch landed in: already in the series (high / low / close merged, volume NOT re-added)
  const anchor = out.length ? out[out.length - 1][0] : 0;
  for (const e0 of src) {
    if (e0[0] < fu) continue;
    const e = e0[0] === fu ? [e0[0], e0[1], e0[2], e0[3], tail.at > at ? e0[4] : null, 0] : e0;
    if (e[4] == null) { const l = out[out.length - 1]; if (l && e[0] >= l[0]) { if (e[2] > l[2]) l[2] = e[2]; if (e[3] < l[3]) l[3] = e[3]; } continue; }
    const b = anchor ? anchor + Math.floor((e[0] - anchor) / sp.ms) * sp.ms : Math.floor(e[0] / sp.ms) * sp.ms;
    const last = out[out.length - 1];
    if (last && last[0] === b) { if (e[2] > last[2]) last[2] = e[2]; if (e[3] < last[3]) last[3] = e[3]; last[4] = e[4]; last[5] += e[5]; }
    else if (!last || b > last[0]) out.push([b, e[1], e[2], e[3], e[4], e[5]]);
  }
  return out;
}

// SQLite store: one row per (code, tf) with the packed series. Float64 [t, o, h, l, c, v] x n.
export function skStore(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS skser (code TEXT NOT NULL, tf TEXT NOT NULL, at INTEGER NOT NULL, b BLOB NOT NULL, PRIMARY KEY (code, tf)) WITHOUT ROWID');
  sql.exec('CREATE TABLE IF NOT EXISTS skinfo (code TEXT PRIMARY KEY, at INTEGER NOT NULL, j TEXT NOT NULL) WITHOUT ROWID');
  return {
    get(code, tf) { const r = sql.exec('SELECT at, b FROM skser WHERE code = ? AND tf = ?', code, tf).toArray()[0]; return r ? { at: r.at, f: f64(new Uint8Array(r.b)) } : null; },
    put(code, tf, at, f) { sql.exec('INSERT OR REPLACE INTO skser (code, tf, at, b) VALUES (?, ?, ?, ?)', code, tf, at, new Uint8Array(f.buffer, f.byteOffset, f.byteLength)); },
    info(code) { const r = sql.exec('SELECT at, j FROM skinfo WHERE code = ?', code).toArray()[0]; return r ? { at: r.at, j: JSON.parse(r.j) } : null; },
    putInfo(code, at, j) { sql.exec('INSERT OR REPLACE INTO skinfo (code, at, j) VALUES (?, ?, ?)', code, at, JSON.stringify(j)); },
    count() { const r = sql.exec('SELECT COUNT(*) AS n FROM skser').toArray()[0]; return r ? r.n : 0; },
    prune(cut) { sql.exec('DELETE FROM skser WHERE at < ?', cut); }
  };
}
// Series are held PACKED (Float64Array, 6 values a bar) in memory and in SQLite: 20,000 bars = 960 KB, not ~2.4 MB of JS arrays, so the
// memory cache stays far under the Durable Object's 128 MB. A read unpacks only the bars it returns (binary search on time).
export function pack(bars) { const f = new Float64Array(bars.length * 6); bars.forEach((b, i) => { for (let k = 0; k < 6; k++) f[i * 6 + k] = b[k]; }); return f; }
export const f64 = (u8) => new Float64Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
export const nBars = (f) => Math.floor(f.length / 6);
export const tAt = (f, i) => f[i * 6];
// index of the first bar with time >= t
export function lowerIdx(f, t) { let lo = 0, hi = nBars(f); while (lo < hi) { const m = (lo + hi) >> 1; if (f[m * 6] < t) lo = m + 1; else hi = m; } return lo; }
export function sliceBars(f, i0, i1) { const out = []; for (let i = i0; i < i1; i++) { const j = i * 6; out.push([f[j], f[j + 1], f[j + 2], f[j + 3], f[j + 4], f[j + 5]]); } return out; }

// provider rows ({time s, open..} objects or abbr arrays) -> [t_ms, o, h, l, c, v]
export function rowsOf(j) {
  const s = j && Array.isArray(j.series) ? j.series : [];
  const keys = Array.isArray(j && j.series_keys) ? j.series_keys : null;
  const out = []; let last = -1;
  for (const r of s) {
    const o = keys && Array.isArray(r) ? Object.fromEntries(keys.map((k, i) => [k, r[i]])) : r;
    const t = Number(o && o.time) * 1000;
    if (!(t > last) || !(Number(o.close) > 0)) continue;
    out.push([t, +o.open, +o.high, +o.low, +o.close, +o.volume || 0]); last = t;
  }
  return out;
}
// session answer -> the symbol info the chart needs (no vendor fields passed through)
export function infoOf(code, s) {
  const tick = String(s.tick_size || '').trim().split(/\s+/).map(Number);
  const regular = (s.details || []).find((d) => /regular/i.test(d.description || '')) || null;
  const sess = regular ? String(regular.session).split('#')[0] : (s.start_hour && s.end_hour ? s.start_hour + '-' + s.end_hour : '');
  return {
    code, type: String(s.type || '').toUpperCase(), description: String(s.description || code).slice(0, 120), currency: String(s.currency_code || ''),
    timezone: String(s.timezone || 'UTC'), session: sess, ext: s.start_hour && s.end_hour ? s.start_hour + '-' + s.end_hour : sess,
    mintick: tick[0] > 0 ? tick[0] : 0.01, pricescale: Number(s.price_scale) > 0 ? Number(s.price_scale) : 100
  };
}
// search answer -> descriptors, stock-like types only
export function searchRows(j) {
  const out = [];
  for (const s of (j && j.symbols) || []) {
    const ty = String(s.type || '').toUpperCase();
    if (!SK_TYPES.test(ty) || !codeOk(s.code)) continue;
    out.push({ code: s.code, name: String(s.name || '').slice(0, 24), type: /FUND|ETF|ETN|TRUST/.test(ty) ? 'etf' : 'stock', exchange: String(s.exchange || s.code.split(':')[0]).slice(0, 16), country: String(s.country || '').slice(0, 4), currency: String(s.currency_code || '').slice(0, 6), description: String(s.description || '').slice(0, 120) });
  }
  return out;
}

export class StockEngine {
  // store: skStore(sql) or a memory double. o: { key, fetch, now, note(n) (monthly counter), monthUsed() (the counter's period total), hub (ISHub) } + SK_DEF overrides
  constructor(store, o = {}) {
    this.st = store; this.o = Object.assign({}, SK_DEF, o); this.now = o.now || (() => Date.now()); this.fetch = o.fetch || ((...a) => fetch(...a));
    this.key = o.key || ''; this.note = o.note || (() => {});
    this.budget = new StockBudget({ dayMax: this.o.DAY_MAX, monthStop: this.o.MONTH_STOP, monthUsed: o.monthUsed, minMax: this.o.MIN_MAX, conc: this.o.CONC, now: this.now });
    this.mem = new Map(); this.inflight = new Map(); this.tails = new Map(); this.want = new Map(); this.infoMem = new Map(); this.searchMem = new Map();
    this.n = { fetch: 0, fail: 0, stale: 0, quotes: 0, search: 0, info: 0 }; this.lastError = '';
    this.hub = o.hub || null;
    if (this.hub) { this.hub.quotesFn = () => this.quoteCodes(); this.hub.onQuote = (q) => this.onQuote(q); }
  }
  // ---- live quotes
  onQuote(q) {
    const code = String(q && q.code || ''); if (!codeOk(code)) return;
    let t = this.tails.get(code); if (!t) { t = new Tail(this.o); this.tails.set(code, t); }
    t.add(q, this.now()); this.n.quotes++;
  }
  // codes the hub should stream, best first: opened recently (newest first), then the HOT list in US hours. The hub caps by its free units.
  quoteCodes(now = this.now()) {
    const out = [], seen = new Set();
    for (const [c, at] of [...this.want.entries()].sort((a, b) => b[1] - a[1])) { if (now - at > this.o.WANT_IDLE_MS) { this.want.delete(c); continue; } out.push(c); seen.add(c); }
    if (usExtOpen(now)) for (const c of SK_HOT) if (!seen.has(c)) out.push(c);
    return out;
  }
  markWanted(code) {
    const had = this.want.has(code); this.want.set(code, this.now());
    if (!had && this.hub && this.hub.quotesChanged) { try { this.hub.quotesChanged(); } catch (e) {} }
  }
  isLive(code) { const t = this.tails.get(code); return !!(t && this.now() - t.at < this.o.QUOTE_FRESH_MS); }
  // ---- provider calls (budgeted, counted, de-duplicated)
  async call(path) {
    if (!this.key) throw new Error('no key');
    if (!this.budget.take()) throw Object.assign(new Error('budget'), { budget: true });
    this.note(1);
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const to = ac ? setTimeout(() => ac.abort(), this.o.FETCH_TIMEOUT_MS) : null;
    try {
      const r = await this.fetch(SK_REST + path, { headers: { authorization: 'Bearer ' + this.key, accept: 'application/json' }, signal: ac ? ac.signal : undefined });
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.json();
    } finally { if (to) clearTimeout(to); this.budget.done(); }
  }
  async info(code, spend = true) {
    if (!codeOk(code)) return null;
    const now = this.now(), m = this.infoMem.get(code);
    if (m && now - m.at < this.o.INFO_TTL_MS) return m.j;
    let s = null; try { s = this.st.info(code); } catch (e) {}
    if (s && now - s.at < this.o.INFO_TTL_MS) { this.infoMem.set(code, s); return s.j; }
    if (!spend) { if (s) return s.j; throw Object.assign(new Error('signin'), { signin: true }); }
    const k = 'i|' + code;
    if (!this.inflight.has(k)) this.inflight.set(k, (async () => {
      try {
        const j = infoOf(code, await this.call('/symbols/' + encodeURIComponent(code) + '/session'));
        this.n.info++; this.infoMem.set(code, { at: now, j }); try { this.st.putInfo(code, now, j); } catch (e) {}
        return j;
      } catch (e) { if (s) return s.j; throw e; } finally { this.inflight.delete(k); }
    })());
    return this.inflight.get(k);
  }
  async search(q, spend = true) {
    q = String(q || '').trim().toUpperCase().replace(/[^A-Z0-9 .&:_-]/g, '').slice(0, 24);
    if (q.length < 1) return [];
    const now = this.now(), m = this.searchMem.get(q);
    if (m && now - m.at < this.o.SEARCH_TTL_MS) return m.r;
    if (!spend) throw Object.assign(new Error('signin'), { signin: true });
    const r = searchRows(await this.call('/symbols/search?query=' + encodeURIComponent(q.includes(':') ? q.split(':')[1] : q)));
    this.n.search++;
    this.searchMem.set(q, { at: now, r }); if (this.searchMem.size > 500) this.searchMem.delete(this.searchMem.keys().next().value);
    return r;
  }
  // the stored series of (code, tf), re-fetched when stale and the budget allows. -> { at, bars, stale }
  async series(code, tf, sp, spend = true) {
    const k = code + '|' + tf, now = this.now();
    let s = this.mem.get(k);
    if (!s) { try { s = this.st.get(code, tf); } catch (e) { s = null; } if (s) this.memPut(k, s); }
    const lastT = s && nBars(s.f) ? tAt(s.f, nBars(s.f) - 1) : 0;
    const closedGuess = !!(s && lastT && s.at - lastT > 30 * MIN + sp.ms);
    if (s && now - s.at < ttlFor(sp, this.isLive(code), closedGuess)) return s;
    if (this.inflight.has(k)) { const p = this.inflight.get(k); return s ? s : p; }
    if (!spend) { if (s) return Object.assign({}, s, { stale: true }); throw Object.assign(new Error('signin'), { signin: true }); }
    if (s && !this.budget.can()) { this.n.stale++; return Object.assign({}, s, { stale: true }); }
    const p = (async () => {
      try {
        const j = await this.call('/symbols/' + encodeURIComponent(code) + '/series?bar_type=' + sp.bt + '&bar_interval=' + sp.n + '&dp=' + sp.dp + '&abbr=true&extended=true');
        const f = pack(rowsOf(j));
        const got = { at: now, f };
        this.n.fetch++; this.memPut(k, got);
        if (f.length) { try { this.st.put(code, tf, now, f); } catch (e) { this.lastError = 'store'; } }
        return got;
      } catch (e) {
        this.n.fail++; this.lastError = String(e && e.message || e).slice(0, 40);
        if (s) return Object.assign({}, s, { stale: true });
        throw e;
      } finally { this.inflight.delete(k); }
    })();
    this.inflight.set(k, p);
    return s ? s : p;   // a stale copy answers now; the fetch lands for the next read
  }
  memPut(k, s) { this.mem.delete(k); this.mem.set(k, s); while (this.mem.size > this.o.MEM_SERIES) this.mem.delete(this.mem.keys().next().value); }
  // bars for the chart: [{t..}] newest `limit` before `to`, cut at `cut` (the delayed lane). live = the caller is a live tier.
  async bars(code, tf, { to, limit = 500, from, cut = Infinity, spend = true } = {}) {
    const sp = skSpec(tf);
    if (!sp || !codeOk(code)) return null;
    const inf = await this.info(code, spend);
    if (!inf || !SK_TYPES.test(inf.type)) return { refused: true };
    if (spend) this.markWanted(code);
    const s = await this.series(code, tf, sp, spend);
    const f = s.f, N = nBars(f);
    // delayed lane: no live tail, and only whole bars that closed before the cut (a daily chart then ends at the last closed session)
    const end = Math.min(to || Infinity, cut === Infinity ? Infinity : cut - sp.ms + 1);
    let i1 = end === Infinity ? N : lowerIdx(f, end);
    let i0 = from != null ? lowerIdx(f, from) : Math.max(0, i1 - limit);
    if (i1 - i0 > limit) i0 = i1 - limit;
    let b = sliceBars(f, i0, i1);
    if (cut === Infinity && i1 === N) { b = mergeTail(b, s.at, sp, this.tails.get(code)); if (to) b = b.filter((x) => x[0] < to); if (from == null && b.length > limit) b = b.slice(-limit); }
    const first = N ? tAt(f, 0) : 0;
    const t = this.tails.get(code), q = t && t.q;
    return { code, tf, b, first, at: s.at, stale: !!s.stale, live: this.isLive(code), qAt: t ? t.at : 0, delay: q && Number.isFinite(+q.delay_seconds) ? +q.delay_seconds : null, status: q ? String(q.status || '') : '', info: inf };
  }
  stats() {
    return { budget: this.budget.stats(), n: this.n, mem: this.mem.size, tails: this.tails.size, wanted: this.want.size, quoting: this.hub && this.hub.quoteSent ? this.hub.quoteSent.length : 0, lastError: this.lastError };
  }
}

// the delayed lane's cut (same rule as the futures engine: nothing at or after the whole minute 10 min ago)
export const skCut = (lane, now) => (lane === 'live' ? Infinity : delayCut(now));
