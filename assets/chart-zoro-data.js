// TradeZoro — ZoroOptions chart data layer (ES module). Stream 4 of the ZoroOptions build.
// Shared by the Zoro chart indicators: chart-gex-levels.js (Zoro Levels), chart-gex-heatmap.js (Gamma over time),
// chart-zoro-range.js (Zoro Range + Gamma Zone), chart-optflow.js (Fresh Volume / Volume Burst marks), chart-iv-rank.js.
//
// PAGE FLAG: everything new is OFF until the whole ZoroOptions release ships. zoroOn() is true only with
//   localStorage.stk_zoro_options === '1', ?zoro=1 in the URL, or window.STRYKER_ZORO === true.
// With the flag off, no new symbol maps, no new indicator is registered and no /api/zo call is made.
//
// DATA: GET /api/zo/<route> (Pages functions -> Worker, Pro gated server side; spec section 6). The browser never calls a vendor.
//   summary?u=SYM[&basis=close]   -> { u, t, spot, zone, levels:{call,put,flip,pin}, nodes:[{k,g}], ranges:[{k,x,lo,hi,em}], iv:{rank,pct,iv30,t:[],v:[]} }
//   history?u=SYM&dte=0|1&from=&to= and sessions?u=SYM&dte= (same packed shape as /gex-history, tier B rows are 15 min apart)
//   activity?u=SYM&kind=fresh|burst -> { u, t, items:[{ t, side:'C'|'P', k, x, vol, oi, add, prem }] }
// Field names follow the day-1 fixture (tools/fixtures/zoro/*.json); zsum() below accepts the spec names and the short ones.
// Wording: "updated X min ago" only. Never live / real-time / delayed. Education only. Not financial advice.
import { rtHeadersReady } from './rt-access.js?v=897';
import * as ProGate from './chart-pro-gate.js?v=897';

const API = '/api/zo/';
export const TIER_A = ['SPX', 'SPY', 'QQQ', 'IWM', 'GLD', 'USO'];
// future root -> underlying that carries its options (ES/NQ/GC are the existing maps; RTY and CL are new)
export const FUT_UNDER = { ES: 'SPX', MES: 'SPX', NQ: 'QQQ', MNQ: 'QQQ', RTY: 'IWM', M2K: 'IWM', GC: 'GLD', MGC: 'GLD', CL: 'USO', MCL: 'USO' };
const FUT_BASE = { ES: 'ES', MES: 'ES', NQ: 'NQ', MNQ: 'NQ', RTY: 'RTY', M2K: 'RTY', GC: 'GC', MGC: 'GC', CL: 'CL', MCL: 'CL' };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v, d) => (typeof v === 'string' && v !== '' ? v : d);

export function zoroOn() {
  try {
    if (typeof window === 'undefined') return false;
    if (window.STRYKER_ZORO === true) return true;
    if (/[?&]zoro=1(&|$)/.test(location.search)) return true;
    return localStorage.getItem('stk_zoro_options') === '1';
  } catch (e) { return false; }
}
export const replayOn = () => !!(window.__stkReplay && window.__stkReplay.on);
export const replayNowS = () => (replayOn() ? Math.floor(window.__stkReplay.E / 1000) : null);

// ---- symbol -> Zoro source (pure) ---------------------------------------------------------------
// { u, fut|null, label, tierB, zoro:true } or null. Futures map with ratio = future / underlying (see adaptSummary).
// Stocks (1-5 letters, any non-futures provider) are tier B (15-min steps). The server decides which ones it has.
export function zoroSource(symbol, provider, on) {
  if (on === undefined ? !zoroOn() : !on) return null;
  let ticker = String(symbol || ''), prov = String(provider || '');
  const m = /^([a-z_]+):(.+)$/i.exec(ticker);
  if (m) { if (!prov) prov = m[1].toLowerCase(); ticker = m[2]; }
  const root = ticker.toUpperCase().replace(/[0-9]?!$/, '').replace(/^\^/, '');
  if (FUT_UNDER[root]) return { u: FUT_UNDER[root], fut: FUT_BASE[root], root, label: root + ' (mapped from ' + FUT_UNDER[root] + ')', tierB: false, zoro: true };
  if (/^(futures|crypto|forex|fx|cfd)$/.test(prov)) return null;
  if (TIER_A.includes(root)) return { u: root, fut: null, root, label: root, tierB: false, zoro: true };
  if (root === 'SPXW') return { u: 'SPX', fut: null, root: 'SPX', label: 'SPX', tierB: false, zoro: true };
  if (/^[A-Z]{1,5}$/.test(root)) return { u: root, fut: null, root, label: root, tierB: true, zoro: true };
  return null;
}
// Underlyings the existing /gex-history already carries; everything else goes to /api/zo/history.
const OLD_HISTORY = ['SPX', 'SPY', 'QQQ', 'GLD'];

// ---- fetch cache + one timer for every Zoro indicator ----------------------------------------------
const cache = new Map();           // key -> { data, at, p, err }
const watchers = new Set();        // natives: { wants():[{kind,u,x}], refresh() }
function ckey(kind, u, x) { return kind + ':' + u + ':' + (x || ''); }
function ttl(kind, u) { return (kind === 'summary' || kind === 'activity' || kind === 'iv') ? (TIER_A.includes(u) ? 110000 : 290000) : 600000; }
export function zoCached(kind, u, x) { const e = cache.get(ckey(kind, u, x)); return e ? e.data : null; }
export function zoFetch(kind, u, x, force) {
  // Replay: only record-type data may load ('iv' = the summary's IV series, 'activity' = dated items); callers drop everything after the replay clock.
  if (replayOn() && !['history', 'sessions', 'iv', 'activity'].includes(kind)) return Promise.resolve(null);
  const k = ckey(kind, u, x), e = cache.get(k) || {};
  if (e.p) return e.p;
  if (!force && e.data && Date.now() - e.at < ttl(kind, u)) return Promise.resolve(e.data);
  const qs = new URLSearchParams(Object.assign({ u }, kind === 'summary' && x === 'close' ? { basis: 'close' } : {}, kind === 'activity' ? { kind: x || 'fresh' } : {}));
  const p = ProGate.tier().then(() => (ProGate.isFree() ? Promise.reject(new Error('zoro-pro')) : rtHeadersReady()))
    .then((hd) => fetch(API + (kind === 'iv' ? 'summary' : kind) + '?' + qs, { headers: Object.assign({ accept: 'application/json' }, hd) }))
    .then((r) => r.json().then((j) => (r.ok ? j : { error: (j && j.error) || ('HTTP ' + r.status) })))
    .catch((err) => ({ error: String(err && err.message || err) }))
    .then((j) => {
      const prev = cache.get(k) || {}, good = j && !j.error;
      if (cache.size > 120) cache.clear();
      cache.set(k, { data: good ? j : (prev.data || j), at: good ? Date.now() : (prev.at || 0), p: null });
      return good ? j : (prev.data || j);
    });
  cache.set(k, Object.assign({}, e, { p }));
  return p;
}
let timer = 0;
function tick() {
  if (document.visibilityState === 'hidden') return;
  const seen = new Set(), jobs = [];
  watchers.forEach((w) => (w.wants() || []).forEach((q) => { const k = ckey(q.kind, q.u, q.x); if (!seen.has(k)) { seen.add(k); jobs.push(zoFetch(q.kind, q.u, q.x)); } }));
  Promise.all(jobs).then(() => watchers.forEach((w) => w.refresh()));
  watchers.forEach((w) => w.refresh());
}
export function zoWatch(w) { watchers.add(w); if (!timer) timer = setInterval(tick, 60000); }
export function zoUnwatch(w) { watchers.delete(w); if (!watchers.size && timer) { clearInterval(timer); timer = 0; } }
// Fetch what a native wants right now, then let it repaint. Called from start(), setInputs(), symbol change.
export function zoLoad(w) {
  if (document.visibilityState === 'hidden') return;
  (w.wants() || []).forEach((q) => zoFetch(q.kind, q.u, q.x).then(() => w.refresh()));
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden' && watchers.size) tick(); });
}

// ---- history source: old three/four stay on /gex-history, the rest use /api/zo/history -----------------
const zoHistCache = new Map();
function zoGetJson(path, qs) {
  const url = API + path + '?' + qs, hit = zoHistCache.get(url);
  if (hit && Date.now() - hit.at < 60000) return hit.p;
  const p = ProGate.tier().then(() => (ProGate.isFree() ? Promise.reject(new Error('zoro-pro')) : rtHeadersReady()))
    .then((hd) => fetch(url, { headers: Object.assign({ accept: 'application/json' }, hd) }))
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  p.catch(() => zoHistCache.delete(url));
  if (zoHistCache.size > 40) zoHistCache.clear();
  zoHistCache.set(url, { at: Date.now(), p });
  return p;
}
// Returns { history(u,dte,from,to), sessions(u,dte) } with the gex-heat-core row shape (oldest first).
export function histApi(u, core) {
  if (!zoroOn() || OLD_HISTORY.includes(u)) return core;
  return {
    // Asked of S1/S2 (contract-requests.md): /zo/history?u=&dte=&from=&to= in the packed /gex-history shape, tier B every 15 min.
    history: (uu, dte, from, to) => zoGetJson('history', 'u=' + encodeURIComponent(uu) + '&dte=' + (dte ? 1 : 0) + '&from=' + Math.floor(from) + (to ? '&to=' + Math.ceil(to) : '')).then(core.unpack),
    sessions: (uu, dte) => zoGetJson('history', 'u=' + encodeURIComponent(uu) + '&dte=' + (dte ? 1 : 0) + '&sessions=1')
  };
}
// Tier B rows are 15 min apart: a snapshot fills this many 2-min columns.
export const fillSlots = (src) => (src && src.tierB ? 8 : 3);

// ---- summary -> normalised object (pure) ------------------------------------------------------------
// ranges: array [{k,lo,hi,em}] or the object form { '0':[lo,hi], '1':.., w:.., m:.. } / { '0dte':.., weekly:.. } (S2/S5 summary).
const RKEY = { '0': '0DTE', '0dte': '0DTE', '1': '1DTE', '1dte': '1DTE', w: 'Weekly', weekly: 'Weekly', m: 'Monthly', monthly: 'Monthly' };
export function rangeList(r) {
  if (Array.isArray(r)) return r.map((x) => (x && RKEY[String(x.k).toLowerCase()] ? Object.assign({}, x, { k: RKEY[String(x.k).toLowerCase()] }) : x));
  if (!r || typeof r !== 'object') return [];
  return Object.keys(r).filter((k) => RKEY[k.toLowerCase()] && Array.isArray(r[k]) && isNum(r[k][0]) && isNum(r[k][1]))
    .map((k) => ({ k: RKEY[k.toLowerCase()], lo: r[k][0], hi: r[k][1], em: (r[k][1] - r[k][0]) / 2 }));
}
// Activity items from either shape: items[{t,side:'C'|'P',k,x,vol,oi,add,prem}] or rows[{strike,side:'call'|'put',exp,volume,oi,added,t}].
export function zitems(j) {
  const a = j && (Array.isArray(j.items) ? j.items : Array.isArray(j.rows) ? j.rows : []);
  return (a || []).map((r) => ({ t: isNum(r.t) ? r.t : (isNum(r.ts) ? r.ts : r.at), side: /^p/i.test(String(r.side)) ? 'P' : 'C', k: r.k != null ? r.k : r.strike, x: r.x || r.exp || '',
    vol: r.vol != null ? r.vol : r.volume, oi: r.oi, add: r.add != null ? r.add : r.added, prem: r.prem != null ? r.prem : r.premium })).filter((r) => isNum(r.t));
}
// Accepts spec names (call_ceiling / put_floor / flip_line / pin_strike) and short ones (call / put / flip / pin).
export function zsum(j) {
  if (!j || j.error) return null;
  const L = j.levels || {}, pick = (...ks) => { for (const k of ks) if (isNum(L[k])) return L[k]; for (const k of ks) if (isNum(j[k])) return j[k]; return null; };
  const nodes = (Array.isArray(j.nodes) ? j.nodes : []).map((n) => (Array.isArray(n) ? { k: n[0], g: n[1] } : { k: n.k != null ? n.k : n.strike, g: n.g != null ? n.g : n.gex }))
    .filter((n) => isNum(n.k) && isNum(n.g)).sort((a, b) => Math.abs(b.g) - Math.abs(a.g)).slice(0, 10);
  const ranges = rangeList(j.ranges).filter((r) => r && isNum(r.lo) && isNum(r.hi) && r.hi > r.lo).map((r) => ({ k: String(r.k), x: r.x || '', lo: r.lo, hi: r.hi, em: isNum(r.em) ? r.em : (r.hi - r.lo) / 2 }));
  const iv = j.iv || {};
  return {
    u: j.u, t: isNum(j.built) ? j.built : (isNum(j.t) ? j.t : null), spot: isNum(j.spot) ? j.spot : null, zone: j.zone === 'swing' || j.zone === 'cushion' ? j.zone : null,
    call: pick('call', 'call_ceiling'), put: pick('put', 'put_floor'), flip: pick('flip', 'flip_line', 'zero_gamma'), pin: pick('pin', 'pin_strike'),
    nodes, ranges, closeLabel: j.close && typeof j.close.label === 'string' ? j.close.label : '',
    iv: { rank: isNum(iv.rank) ? iv.rank : null, pct: isNum(iv.pct) ? iv.pct : null, iv30: isNum(iv.iv30) ? iv.iv30 : null,
      t: Array.isArray(iv.t) ? iv.t : [], v: Array.isArray(iv.v) ? iv.v : [] }
  };
}
// Which side of the flip is the price: Cushion above, Swing below (spec glossary).
export function zoneOf(spot, flip) { return isNum(spot) && isNum(flip) ? (spot >= flip ? 'cushion' : 'swing') : null; }

// An API-shaped object for buildLevels() from a Zoro summary: index/ETF as is, futures mapped by
// ratio = chart price at the summary time / underlying spot at that time (basis 0). close = that chart price.
export function adaptSummary(zs, src, close) {
  if (!zs) return { error: 'no summary' };
  const d = { call_wall: zs.call, put_wall: zs.put, zero_gamma: zs.flip, spot: zs.spot, fetched_at: zs.t, market: { data_ts: zs.t, state: 'zoro' },
    ladder: zs.nodes.map((n) => ({ strike: n.k, gex: n.g })), expected: {}, session: {} };
  if (src.fut) {
    if (!isNum(close) || !isNum(zs.spot) || zs.spot <= 0) return { error: 'no ' + src.fut + ' bar at the options time' };
    const k = close / zs.spot, cv = (v) => (isNum(v) ? v * k : null);
    d.futures = { [src.fut]: { ratio: k, basis: 0, levels: { spot: close, call_wall: cv(zs.call), put_wall: cv(zs.put), zero_gamma: cv(zs.flip) } } };
  }
  return d;
}
// Lines for Gamma Nodes / Zoro Range edges / Pin Strike, from a normalised summary. conv: strike -> chart price (null when unmapped).
export const NODE_RGB = { pos: '#03c988', neg: '#ee4276' };
export const RANGE_RGB = { '0DTE': '#00adb5', '1DTE': '#4fe3ac', Weekly: '#8b7cf6', Monthly: '#f59e0b' };
export function zoroLines(zs, conv, opts, on) {
  const out = [], r2 = (v) => Math.round(v * 100) / 100;
  if (!zs) return out;
  if (on('showNodes')) {
    const n = Math.max(1, Math.min(10, Math.round(Number(opts.nodeCount) || 10)));
    const top = Math.abs((zs.nodes[0] || { g: 0 }).g) || 1;
    zs.nodes.slice(0, n).forEach((x, i) => {
      const p = conv(x.k);
      if (isNum(p)) out.push({ id: 'zn' + (i + 1), label: 'Node ' + (i + 1), price: r2(p), note: '', rgb: x.g < 0 ? NODE_RGB.neg : NODE_RGB.pos, dash: 'dotted', w: i === 0 ? 2 : 1, alpha: 0.35 + 0.55 * Math.abs(x.g) / top, ranked: true, rank: i + 1, share: Math.abs(x.g) / top });
    });
  }
  if (on('showRanges')) {
    const which = str(opts.rangeKeys, 'All');
    zs.ranges.filter((r) => which === 'All' || r.k === which).forEach((r) => {
      const a = conv(r.lo), b = conv(r.hi), rgb = RANGE_RGB[r.k] || RANGE_RGB['0DTE'];
      if (isNum(a) && isNum(b)) {
        out.push({ id: 'zr' + r.k + 'h', label: 'Range ' + r.k + ' upper', price: r2(b), note: '', rgb, dash: 'dashed', w: 1, alpha: 0.9, faint: true });
        out.push({ id: 'zr' + r.k + 'l', label: 'Range ' + r.k + ' lower', price: r2(a), note: '', rgb, dash: 'dashed', w: 1, alpha: 0.9, faint: true });
      }
    });
  }
  if (on('showPin') && isNum(zs.pin)) {
    const p = conv(zs.pin);
    if (isNum(p)) out.push({ id: 'zpin', label: 'Pin Strike', price: r2(p), note: '', rgb: '#f4f6fa', dash: 'dotted', w: 1, alpha: 0.8, faint: true });
  }
  return out;
}

// ---- shared small helpers ------------------------------------------------------------------------------
export function agoText(tsSec, nowMs, what) {
  const w = what ? what + ' ' : '';
  if (!isNum(tsSec)) return w + 'updated time unknown';
  const m = Math.max(0, Math.floor(((nowMs || Date.now()) / 1000 - tsSec) / 60));
  if (m < 1) return w + 'updated just now';
  if (m < 120) return w + 'updated ' + m + ' min ago';
  const h = Math.floor(m / 60);
  return h < 48 ? w + 'updated ' + h + ' h ago' : w + 'updated ' + Math.floor(h / 24) + ' days ago';
}
export function srcOfCtx(ctx) {
  let provider = '';
  try { const r = ctx.data.resolve(ctx.symbol); if (r) provider = r.provider; } catch (e) {}
  return zoroSource(ctx.symbol, provider);
}
// close of the last bar opened at or before tSec (bars sorted, time in ms), within gapS; else null
export function closeAt(bars, tSec, gapS) {
  let lo = 0, hi = bars.length - 1, best = -1;
  const tm = tSec * 1000;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= tm) { best = m; lo = m + 1; } else hi = m - 1; }
  if (best < 0 || (tm - bars[best].time) / 1000 > gapS) return null;
  return isNum(bars[best].close) ? bars[best].close : null;
}
// Strike -> chart price for a source from its summary: index/ETF identity, futures ratio = close/spot (null if no bar).
export function convFor(zs, src, bars) {
  if (!src.fut) return (v) => v;
  const close = zs && zs.t && bars && bars.length ? closeAt(bars, zs.t, 1800) : null;
  if (!isNum(close) || !zs || !isNum(zs.spot) || zs.spot <= 0) return () => null;
  const k = close / zs.spot;
  return (v) => (isNum(v) ? v * k : null);
}
export const hexA = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
};
export const lightTheme = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
// Standard persistence block, same behaviour as the other natives.
export function persist(Core, key, type, schema, max) {
  Core.registerStatePersistence({
    key, scope: 'cell',
    serialize(ctx) {
      const out = [];
      try { ctx.chart.indicators().forEach((h) => { if (h.nativeType === type) out.push(h.inputValues()); }); } catch (e) {}
      return out.length ? out : undefined;
    },
    restore(payload, ctx) {
      if (!Array.isArray(payload)) return;
      let hs = [];
      try { hs = ctx.chart.indicators().filter((h) => h.nativeType === type); } catch (e) { return; }
      payload.slice(0, max || 2).forEach((vals, i) => {
        if (!hs[i] || !vals || typeof vals !== 'object') return;
        const clean = {};
        schema.forEach((s) => { const v = vals[s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
        try { hs[i].setInputs(clean); } catch (e) {}
      });
    }
  });
}
