// TradeZoro — Charts: STOCKS ENGINE provider ("stocks") — ES module
// Depends on: assets/rt-access.js (the member's sign-in token, sent as Bearer), the book recorder's /sk-bars + /sk-search
// (workers/book-recorder/src/stock-engine.js). Registered in assets/vela-chart.js as provider "stocks"; read by
// assets/chart-data-dot.js (stockStatus) for the data dot.
//
// WHAT (Owner 05 Nov: "add all stocks data ... use same engine as futures"): every stock / ETF / fund the data provider lists
// (100+ exchanges, worldwide) is searchable and chartable: seconds (5S..45S), every minute / hour timeframe, D, W, M.
// Symbols are "stocks:<EXCHANGE>:<TICKER>" (e.g. stocks:NASDAQ:AAPL, stocks:NSE:RELIANCE, stocks:XETR:SAP).
//   - History + the forming candle come from the SERVER (/sk-bars). The provider key never reaches the browser; the server decides
//     the lane from the verified token: live tiers see the newest bar, everyone else whole bars up to 10 minutes ago (same rule
//     as the futures engine). Signed-out visitors get only what the server already stored (it never calls the provider for them).
//   - Live: the chart re-reads the newest bars every POLL_MS (10 s live lane, 30 s delayed). The server moves the forming bar from
//     the provider's quote stream (up to 50 symbols at once), so a poll is a cheap memory read there.
//     shortcut: polling, not a socket per browser like the futures engine; upgrade when stocks get their own trade stream (plan add-on).
//   - Search: the picker's own list (Vela) + a server search as the member types (debounced), merged into this provider's index.
// Copy: "Updated N s ago" and the exchange's own delay; never "real-time". No vendor names.
import { rtHeadersReady } from './rt-access.js?v=913';

const RECORDER = () => (typeof window !== 'undefined' && window.__STK_BOOK_RECORDER) || 'https://book-recorder.theelitegrey.workers.dev';
export const STOCK_TFS = ['5S', '10S', '15S', '30S', '45S', '1', '2', '3', '5', '10', '15', '30', '45', '60', '120', '180', '240', 'D', 'W', 'M'];
const POLL_LIVE_MS = 10000, POLL_DELAYED_MS = 30000;
// Hot list (same as SK_HOT on the server): shown before any search.
export const STOCK_HOT = [
  ['AMEX:SPY', 'SPDR S&P 500 ETF', 'etf'], ['NASDAQ:QQQ', 'Invesco QQQ', 'etf'], ['AMEX:IWM', 'iShares Russell 2000 ETF', 'etf'], ['AMEX:DIA', 'SPDR Dow Jones ETF', 'etf'],
  ['NASDAQ:AAPL', 'Apple Inc.', 'stock'], ['NASDAQ:MSFT', 'Microsoft Corp.', 'stock'], ['NASDAQ:NVDA', 'NVIDIA Corp.', 'stock'], ['NASDAQ:AMZN', 'Amazon.com Inc.', 'stock'],
  ['NASDAQ:GOOGL', 'Alphabet Inc. Class A', 'stock'], ['NASDAQ:META', 'Meta Platforms Inc.', 'stock'], ['NASDAQ:TSLA', 'Tesla Inc.', 'stock'], ['NASDAQ:AVGO', 'Broadcom Inc.', 'stock'],
  ['NASDAQ:AMD', 'Advanced Micro Devices', 'stock'], ['NASDAQ:NFLX', 'Netflix Inc.', 'stock'], ['NASDAQ:COST', 'Costco Wholesale', 'stock'], ['NYSE:JPM', 'JPMorgan Chase & Co.', 'stock'],
  ['NYSE:V', 'Visa Inc.', 'stock'], ['NYSE:MA', 'Mastercard Inc.', 'stock'], ['NYSE:UNH', 'UnitedHealth Group', 'stock'], ['NYSE:XOM', 'Exxon Mobil Corp.', 'stock'],
  ['NYSE:LLY', 'Eli Lilly and Co.', 'stock'], ['NYSE:WMT', 'Walmart Inc.', 'stock'], ['NYSE:HD', 'Home Depot Inc.', 'stock'], ['NYSE:BAC', 'Bank of America', 'stock'],
  ['NYSE:ORCL', 'Oracle Corp.', 'stock'], ['NYSE:CRM', 'Salesforce Inc.', 'stock'], ['NYSE:KO', 'Coca-Cola Co.', 'stock'], ['NYSE:PG', 'Procter & Gamble', 'stock'],
  ['NASDAQ:PLTR', 'Palantir Technologies', 'stock'], ['NYSE:BRK.B', 'Berkshire Hathaway B', 'stock']
];
export const codeOk = (c) => /^[A-Z0-9_]{1,16}:[A-Z0-9][A-Z0-9._-]{0,23}$/.test(String(c || ''));
const norm = (t) => String(t || '').trim().toUpperCase().replace(/^STOCKS:/, '');
const tfOf = (tf) => { const s = String(tf || '').toUpperCase(); if (s === '1D') return 'D'; if (s === '1W') return 'W'; if (s === '1M') return 'M'; return s; };
const tfOk = (tf) => /^(\d+S|\d+|D|W|M)$/.test(tf) && (!/S$/.test(tf) || (+tf.slice(0, -1) >= 5 && +tf.slice(0, -1) <= 45 && +tf.slice(0, -1) % 5 === 0)) && (!/^\d+$/.test(tf) || (+tf >= 1 && +tf <= 1440));

// last answer per code: { info, live, qAt, delay, status, lane, stale, at, now, gotAt } (the data dot reads it)
const META = new Map();
export const stockMeta = (code) => META.get(norm(code)) || null;
const metaSubs = new Set();
export const onStockMeta = (f) => { metaSubs.add(f); return () => metaSubs.delete(f); };

const inflight = new Map();
async function skGet(path) {
  if (inflight.has(path)) return inflight.get(path);
  const p = (async () => {
    const r = await fetch(RECORDER() + path, { headers: await rtHeadersReady(), cache: 'no-store' });
    if (!r.ok) { const e = new Error('stocks ' + r.status); e.status = r.status; throw e; }
    return r.json();
  })();
  inflight.set(path, p);
  try { return await p; } finally { inflight.delete(path); }
}
async function fetchBars(code, tf, { to = 0, limit = 500 } = {}) {
  const q = new URLSearchParams({ code, tf, limit: String(Math.min(5000, Math.max(1, limit))) });
  if (to) q.set('to', String(Math.floor(to)));
  const j = await skGet('/sk-bars?' + q);
  META.set(code, { info: j.info, live: !!j.live, qAt: j.qAt || 0, delay: j.delay, status: j.status || '', lane: j.lane, stale: !!j.stale, at: j.at, now: j.now, gotAt: Date.now() });
  metaSubs.forEach((f) => { try { f(code); } catch (e) {} });
  const tick = j.info && j.info.mintick > 0 ? j.info.mintick : 0.01;
  return (j.b || []).map((r) => ({ time: r[0], open: snap(r[1], tick), high: snap(r[2], tick), low: snap(r[3], tick), close: snap(r[4], tick), volume: r[5] }));
}
const decimals = (x) => { const s = String(x); const i = s.indexOf('.'); return i < 0 ? (/e-(\d+)/.test(s) ? +RegExp.$1 : 0) : s.length - i - 1; };
const snap = (v, tick) => { const d = Math.min(10, decimals(tick)); return Number(v.toFixed(d)); };

// Exchange session open now? ('0930-1600' in its timezone, Mon-Fri; no holiday calendar.)
export function sessionOpen(info, ms = Date.now()) {
  if (!info || !info.timezone) return null;
  const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(info.ext || info.session || '');
  if (!m) return null;
  let o; try { o = {}; new Intl.DateTimeFormat('en-US', { timeZone: info.timezone, hourCycle: 'h23', weekday: 'short', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; }); } catch (e) { return null; }
  if (o.weekday === 'Sat' || o.weekday === 'Sun') return false;
  const min = (+o.hour % 24) * 60 + (+o.minute), a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
  return a <= b ? min >= a && min < b : min >= a || min < b;
}
// The data dot's line for a stocks: symbol. -> { s: 'rt'|'delayed'|'closed'|'wait', text, tag }
export function stockStatus(sym, now = Date.now()) {
  const code = norm(sym), m = META.get(code);
  if (!m) return { s: 'wait', text: 'Loading stock data', tag: 'Loading' };
  const tz = m.info && m.info.timezone ? ' · ' + m.info.timezone.replace(/_/g, ' ') + ' time' : '';
  const open = sessionOpen(m.info, now);
  if (open === false) return { s: 'closed', text: 'Market closed' + tz, tag: 'Closed' };
  const ex = m.delay > 0 ? Math.round(m.delay / 60) : 0;
  if (m.lane !== 'live') return { s: 'delayed', text: 'Stock data up to 10 minutes delayed' + (ex > 10 ? ' (this exchange: ' + ex + ' min)' : '') + tz, tag: 'Delayed' };
  if (m.live && m.qAt) {
    const ago = Math.max(0, Math.round((m.now - m.qAt + (now - m.gotAt)) / 1000));   // server clock for the quote age, ours since the answer
    if (ex > 0) return { s: 'delayed', text: 'Exchange data ' + ex + ' min delayed · updated ' + fmtAgo(ago) + ' ago' + tz, tag: ex + ' min delayed' };
    return { s: 'rt', text: 'Updated ' + fmtAgo(ago) + ' ago' + tz, tag: 'Updated ' + fmtAgo(ago) };
  }
  const age = m.at ? Math.round((m.now - m.at) / 1000) : null;
  return { s: 'delayed', text: (ex > 0 ? 'Exchange data ' + ex + ' min delayed · ' : '') + (age != null ? 'Updated ' + fmtAgo(age) + ' ago' : 'Updating') + tz, tag: age != null ? 'Updated ' + fmtAgo(age) : 'Updating' };
}
const fmtAgo = (s) => (s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h');

export class StocksProvider {
  constructor() {
    this.known = new Map(STOCK_HOT.map(([code, d, type]) => [code, desc(code, d, type)]));
    try { (JSON.parse(localStorage.getItem('tz_stocks_seen') || '[]') || []).slice(0, 60).forEach((d) => { if (d && codeOk(d.ticker) && !this.known.has(d.ticker)) this.known.set(d.ticker, desc(d.ticker, d.description, d.type)); }); } catch (e) {}
  }
  info() { return { name: 'stocks', displayName: 'Stocks & ETFs', requiresApiKey: false, supportedTimeframes: STOCK_TFS, capabilities: { enumerate: true, stream: true, symbolInfo: true } }; }
  async listSymbols() { return [...this.known.values()]; }
  // merge server search rows; -> true when something new was added
  addRows(rows) {
    let n = 0;
    for (const r of rows || []) if (codeOk(r.code) && !this.known.has(r.code)) { this.known.set(r.code, desc(r.code, r.description || r.name, r.type, r.exchange, r.country)); n++; }
    return n > 0;
  }
  remember(code) {
    const d = this.known.get(code); if (!d) return;
    try { const L = (JSON.parse(localStorage.getItem('tz_stocks_seen') || '[]') || []).filter((x) => x && x.ticker !== code); L.unshift({ ticker: code, description: d.description, type: d.type }); localStorage.setItem('tz_stocks_seen', JSON.stringify(L.slice(0, 60))); } catch (e) {}
  }
  async getSymbolInfo(ticker) {
    const code = norm(ticker);
    if (!codeOk(code)) return undefined;
    let m = META.get(code);
    if (!m) { try { await fetchBars(code, 'D', { limit: 1 }); } catch (e) {} m = META.get(code); }
    const i = (m && m.info) || {}, d = this.known.get(code);
    const tick = i.mintick > 0 ? i.mintick : 0.01, dec = Math.min(10, decimals(tick));
    if (i.description && !d) this.known.set(code, desc(code, i.description, /FUND|ETF|ETN|TRUST/.test(i.type || '') ? 'etf' : 'stock'));
    this.remember(code);
    return {
      ticker: code, tickerid: 'stocks:' + code, prefix: 'stocks', description: i.description || (d && d.description) || code,
      type: /FUND|ETF|ETN|TRUST/.test(i.type || '') ? 'etf' : (d && d.type) || 'stock', market: 'equity', exchange: code.split(':')[0], currency: i.currency || 'USD',
      mintick: tick, pricescale: Math.round(Math.pow(10, dec)), minmove: Math.max(1, Math.round(tick * Math.pow(10, dec))), pointvalue: 1,
      timezone: i.timezone || 'America/New_York', session: i.session || '0930-1600', session_extended: i.ext || i.session || '0930-1600'
    };
  }
  resolveSymbolIcon() { return undefined; }
  async getBars(ticker, timeframe, range = {}) {
    const code = norm(ticker), tf = tfOf(timeframe);
    if (!codeOk(code) || !tfOk(tf)) return [];
    const limit = range.from != null ? 5000 : (range.limit != null ? range.limit : 500);
    let bars;
    try { bars = await fetchBars(code, tf, { to: range.to != null ? range.to + 1 : 0, limit }); }
    catch (e) { if (e && e.status === 401) { notice('Sign in to load this stock chart.'); return []; } if (e && e.status === 429) { notice('Stock data is busy. Try again in a minute.'); } return []; }
    if (range.to != null) bars = bars.filter((b) => b.time <= range.to);
    if (range.from != null) bars = bars.filter((b) => b.time >= range.from);
    return bars;
  }
  subscribe(ticker, timeframe, onBar) {
    const code = norm(ticker), tf = tfOf(timeframe);
    if (!codeOk(code) || !tfOk(tf)) return () => {};
    let stopped = false, timer = null, last = 0;
    const tick = async () => {
      timer = null; if (stopped) return;
      if (typeof document === 'undefined' || !document.hidden) {
        try { const bs = await fetchBars(code, tf, { limit: 3 }); if (!stopped) for (const b of bs) if (b.time >= last) { last = b.time; onBar(b); } } catch (e) { /* next poll */ }
      }
      const m = META.get(code);
      if (!stopped) timer = setTimeout(tick, m && m.lane === 'live' ? POLL_LIVE_MS : POLL_DELAYED_MS);
    };
    timer = setTimeout(tick, 2000);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }
}
function desc(code, description, type, exchange, country) {
  return { ticker: code, description: String(description || code.split(':')[1]).slice(0, 80), type: type === 'etf' ? 'etf' : 'stock', prefix: 'stocks', market: 'equity', exchange: exchange || code.split(':')[0], country: country || '', mintick: 0.01, pointvalue: 1 };
}
let lastNotice = 0;
function notice(m) { if (Date.now() - lastNotice < 30000) return; lastNotice = Date.now(); try { if (window.showToast) window.showToast('info', m); } catch (e) {} }

// Server search as the member types in ANY symbol picker (header, watchlist, indicator inputs): results are merged into the
// "stocks" index, the provider is re-registered (same instance, same order) and the picker re-filters.
export function installStockSearch(ws) {
  if (typeof document === 'undefined' || !ws || !ws.feed) return () => {};
  const seen = new Map(); let timer = null, again = false;
  const onInput = (e) => {
    const el = e.target;
    if (again || !el || !el.classList || !el.classList.contains('vela-sp-input')) return;
    clearTimeout(timer);
    const q = String(el.value || '').trim().toUpperCase().replace(/^STOCKS:/, '').replace(/[^A-Z0-9 .&:_-]/g, '').slice(0, 24);
    if (q.length < 1) return;
    timer = setTimeout(async () => {
      if (seen.has(q)) return;
      seen.set(q, 1);
      let rows = [];
      try { rows = (await skGet('/sk-search?q=' + encodeURIComponent(q))).r || []; } catch (err) { seen.delete(q); return; }
      const p = ws.feed.providerInstance('stocks');
      if (!p || !p.addRows) return;
      p.addRows(rows);
      // re-index when a row is missing from the picker's index (a stock opened by URL is in `known` but was never indexed)
      let idx; try { idx = new Set((ws.feed.symbols('stocks') || []).map((d) => d.ticker)); } catch (err) { idx = new Set(); }
      if (!rows.some((r) => codeOk(r.code) && !idx.has(r.code))) return;
      try { await ws.feed.registerProvider('stocks', p); } catch (err) { return; }
      if (!el.isConnected) return;
      again = true; try { el.dispatchEvent(new Event('input', { bubbles: true })); } finally { again = false; }
    }, 300);
  };
  document.addEventListener('input', onInput, true);
  return () => document.removeEventListener('input', onInput, true);
}
