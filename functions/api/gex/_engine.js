import { maxPain } from '../../../assets/chart-gex-ladder-core.js';
const INSIGHTSENTRY_REST = 'https://api.insightsentry.com/v3';
const FETCH_TIMEOUT_MS = 4500;
const quoteMemo = new Map();
const candleMemo = new Map();

const MARKETS = {
  SPX: { cboe: '_SPX', fut: 'ES', mult: 1.0 },
  SPY: { cboe: 'SPY', fut: 'ES', mult: 10.0 },
  QQQ: { cboe: 'QQQ', fut: 'NQ', mult: 41.0 },
  GLD: { cboe: 'GLD', fut: 'GC', mult: 10.9 }
};

const INSIGHTSENTRY_OPTIONS = {
  SPX: 'CBOE:SPX',
  SPY: 'AMEX:SPY',
  QQQ: 'NASDAQ:QQQ',
  GLD: 'AMEX:GLD'
};

const FUTURES = {
  ES: ['ES=F', 50.0, 0.25, 12.50],
  MES: ['MES=F', 5.0, 0.25, 1.25],
  NQ: ['NQ=F', 20.0, 0.25, 5.00],
  MNQ: ['MNQ=F', 2.0, 0.25, 0.50],
  GC: ['GC=F', 100.0, 0.10, 10.00],
  MGC: ['MGC=F', 10.0, 0.10, 1.00]
};

const MAPPING = {
  SPX: { futs: ['ES', 'MES'], index: '^SPX', kFixed: 1.0 },
  SPY: { futs: ['ES', 'MES'], index: '^SPX', kIndex: '^SPX' },
  QQQ: { futs: ['NQ', 'MNQ'], index: '^NDX', kIndex: '^NDX' },
  GLD: { futs: ['GC', 'MGC'], index: null, kFixed: null }
};

const OCC = /^([A-Z^]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
const SQ2PI = Math.sqrt(2 * Math.PI);
const RTH_OPEN = 9 * 60 + 30;
const RTH_CLOSE = 16 * 60;

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', init.cache || 'public, max-age=45, stale-while-revalidate=120');
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS, extraHeaders = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 TradeZoroGEX/1.0', 'accept': 'application/json', ...extraHeaders }
    });
    if (!res.ok) throw new Error(`fetch ${res.status} ${url}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}


function dateFromYmd(n) {
  const s = String(n || '');
  if (!/^\d{8}$/.test(s)) return null;
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))));
}

function insightRangeForDte(dteMax) {
  if (dteMax === 0 || dteMax === 1) return 8;
  if (dteMax === 7) return 12;
  return 35;
}

// HYBRID inputs (GEX audit 2026-10-13, CoS/Owner): InsightSentry's chain is current but only
// carries open interest on ~100 strikes near the money, while Cboe's chain has every strike + OI
// but is ~15 minutes behind. The hybrid takes the chain + OI from Cboe and the LIVE spot and
// per-contract IV (and bid/ask for the straddle) from InsightSentry, then computes gamma itself.
// Returns { spot, ts, byKey: Map('C|745' -> { iv, bid, ask }) } for ONE expiry (YYYY-MM-DD).
// InsightSentry MONTHLY REST quota (2026-10-25): every IS request made by a Pages Function is added to the recorder's
// counter (book-recorder POST /is-note, src/is-usage.js). Auth = HMAC-SHA256(IS key, 'is-note|' + minute): the key this
// Function already holds, so no new secret; the key itself is never sent. Best effort, 1.5 s cap, never throws.
async function noteIs(env, n) {
  const key = env && (env.INSIGHTSENTRY_WEBSOCKET_API_KEY || env.INSIGHTSENTRY_API_KEY);
  if (!key || !(n > 0) || typeof crypto === 'undefined' || !crypto.subtle) return;
  try {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('is-note|' + Math.floor(Date.now() / 60000))))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const base = ((env && env.GEX_CHAIN_URL) || GEX_CHAIN_URL).replace(/\/gex-chain$/, '');
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort('timeout'), 1500);
    try { await fetch(base + '/is-note', { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', 'x-is-sig': sig }, body: JSON.stringify({ src: 'pages', n }) }); }
    finally { clearTimeout(t); }
  } catch (_) {}
}

async function fetchInsightQuotes(name, expIso, env = {}) {
  const apiKey = env.INSIGHTSENTRY_WEBSOCKET_API_KEY || env.INSIGHTSENTRY_API_KEY;
  const code = INSIGHTSENTRY_OPTIONS[name];
  if (!apiKey || !code) throw new Error('InsightSentry options not configured');
  // `expiration` is YYYY-MM-DD (InsightSentry docs, /v3/options/quotes). Build 530 sent YYYYMMDD,
  // which matched no rows, so the hybrid silently never engaged in production (2026-10-13).
  // range=12 keeps the reply to strikes within +-12% of spot, the same band as the Cboe feeder's.
  const qs = new URLSearchParams({ code, expiration: String(expIso), range: '12' });
  const q = await fetchJson(`${INSIGHTSENTRY_REST}/options/quotes?${qs}`, 6000, { authorization: `Bearer ${apiKey}` });
  return insightQuoteMap(q, expIso);
}
function insightQuoteMap(q, expIso) {
  const spot = Number(q.last_price || q.underlying_price || q.current_price || 0);
  if (!(spot > 0)) throw new Error('InsightSentry options missing spot');
  const byKey = new Map();
  for (const o of q.data || []) {
    const exp = dateFromYmd(String(o.expiration || '').replace(/-/g, ''));   // 20261013 or "2026-10-13"
    if (!exp || isoDate(exp) !== expIso) continue;
    const type = String(o.type || '').toUpperCase();
    const cp = type.startsWith('C') ? 'C' : (type.startsWith('P') ? 'P' : null);
    const k = Number(o.strike_price ?? o.strike);
    if (!cp || !(k > 0)) continue;
    // SPX lists the same strike under two roots on monthly days (SPX = AM-settled, SPXW = PM-settled) in a changing order;
    // last-wins made the result jump from call to call. Prefer the weekly root (code ...:SPXW...) every time (2026-10-16).
    const weekly = /:[A-Z]+W\d{6}[CP]/.test(String(o.code || ''));
    const key = cp + '|' + k;
    if (byKey.has(key) && byKey.get(key).weekly && !weekly) continue;
    byKey.set(key, { iv: Number(o.implied_volatility ?? o.iv ?? 0), bid: Number(o.bid_price ?? o.bid ?? 0), ask: Number(o.ask_price ?? o.ask ?? 0), weekly });
  }
  const tsMs = Number(q.last_update || q.updated_at || 0);
  return { spot, ts: tsMs ? tsMs / 1000 : null, byKey, rows: (q.data || []).length };
}
// A vendor IV is used only when it is sane: 0 < iv < 1.5 (annualised) and the contract has a
// two-sided quote. Otherwise the contract keeps Cboe's IV.
function saneIv(x) { return x && x.iv > 0 && x.iv < 1.5 && x.bid > 0 && x.ask >= x.bid; }
function mergeHybrid(contracts, live) {
  let used = 0;
  const out = contracts.map((c) => {
    const x = live.byKey.get(c.cp + '|' + c.strike);
    if (saneIv(x)) { used++; return { ...c, iv: x.iv, bid: x.bid, ask: x.ask, ivSrc: 'insightsentry' }; }
    return { ...c, ivSrc: 'cboe' };
  });
  return { contracts: out, used };
}
// Our own Black-Scholes gamma for every contract (vendor gamma fields are NOT used), at the given
// spot and the real time to the expiry's 16:00 ET close.
function ownGamma(contracts, spot, nowSec) {
  return contracts.map((c) => {
    let iv = c.iv; if (iv > 3) iv /= 100;
    const T = c.exp instanceof Date ? yearsToClose(c.exp, nowSec) : Math.max(c.dte / 252, 1 / (252 * 8));
    return { ...c, T, gamma: iv > 0 ? bsGamma(spot, c.strike, T, iv) : 0 };
  });
}

// ---- Compact Cboe chain (GEX audit 2026-10-13, after the build-528 error 1102) ----
// workers/book-recorder/gex-feeder/gex_feeder.py on our server downloads the full Cboe chain every
// 2 min, keeps only what this engine reads and POSTs it gzip'd to the book-recorder Worker; the
// API reads it back with ONE small fetch (QQQ ~10 KB, SPX ~17 KB for 0/1DTE).
// Rows: [strike, 'C'|'P', oi, iv, bid, ask, volume, delta]. Part 'near' = first 3 expiries +-12%;
// part 'term' = expiries up to 31 days, +-10%, OI > 0.
const GEX_CHAIN_URL = 'https://book-recorder.theelitegrey.workers.dev/gex-chain';
const COMPACT_MAX_AGE_OPEN = 30 * 60;           // cash session: older than 30 min -> InsightSentry path
const COMPACT_MAX_AGE_CLOSED = 4 * 86400;       // market shut: the post-close chain stays valid (weekend)
async function fetchCompact(name, dteMax, env = {}) {
  const base = env.GEX_CHAIN_URL || GEX_CHAIN_URL;
  const part = dteMax === 0 || dteMax === 1 ? 'near' : 'term';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), 4000);
  try {
    const res = await fetch(`${base}?sym=${encodeURIComponent(name)}&part=${part}`, { signal: ctrl.signal, headers: { 'user-agent': 'TradeZoroGEX/1.0' } });
    if (!res.ok) throw new Error(`compact chain ${res.status}`);
    const buf = await res.arrayBuffer();
    const text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}
function compactFresh(d, nowSec) {
  if (!d || !(d.fetched_at > 0)) return false;
  const age = nowSec - d.fetched_at;
  return age >= -120 && age <= (cashScheduleOpen(nowSec) ? COMPACT_MAX_AGE_OPEN : COMPACT_MAX_AGE_CLOSED);
}
// Compact chain -> { spot, contracts } with the same selection rules as parseOptions().
function compactToContracts(d, dteMax, nowSec) {
  const spot = Number(d.spot);
  const today = todayUtc(nowSec);
  const groups = [];
  for (const e of Object.keys(d.expiries || {}).sort()) {
    const exp = new Date(e + 'T00:00:00Z');
    const days = Math.round((exp - today) / 86400000);
    if (days < 0) continue;
    groups.push({ exp, days, rows: d.expiries[e] });
  }
  let pick;
  if (dteMax === 0 || dteMax === 1) { const g = groups[Math.min(dteMax, groups.length - 1)]; pick = g ? [g] : []; }
  else pick = groups.filter(g => g.days <= dteMax);
  const contracts = [];
  for (const g of pick) for (const r of g.rows) {
    contracts.push({ strike: r[0], cp: r[1], dte: g.days, exp: g.exp, oi: r[2], iv: r[3], bid: r[4], ask: r[5], vol: r[6], delta: r[7], gamma: 0 });
  }
  return { spot, contracts };
}

async function fetchInsightOptions(name, dteMax, env = {}) {
  const apiKey = env.INSIGHTSENTRY_WEBSOCKET_API_KEY || env.INSIGHTSENTRY_API_KEY;
  const code = INSIGHTSENTRY_OPTIONS[name];
  if (!apiKey || !code) throw new Error('InsightSentry options not configured');
  const qs = new URLSearchParams({ code, range: String(insightRangeForDte(dteMax)) });
  const headers = { authorization: `Bearer ${apiKey}` };
  const [quotes, contracts] = await Promise.all([
    fetchJson(`${INSIGHTSENTRY_REST}/options/quotes?${qs}`, 12000, headers),
    fetchJson(`${INSIGHTSENTRY_REST}/options/contracts?${qs}`, 12000, headers).catch(() => ({ data: [] }))
  ]);
  const byCode = new Map((contracts.data || []).map(o => [String(o.code || o.option || ''), o]));
  const rows = [];
  const expiries = new Map();
  for (const o of quotes.data || []) {
    const exp = dateFromYmd(o.expiration);
    if (!exp) continue;
    const days = dte(exp);
    if (days < 0) continue;
    const joined = byCode.get(String(o.code || '')) || {};
    const type = String(o.type || joined.type || '').toUpperCase();
    const cp = type.startsWith('C') ? 'C' : (type.startsWith('P') ? 'P' : null);
    const oi = Number(o.open_interest ?? joined.open_interest ?? joined.openInterest ?? 0);
    const gamma = Number(o.gamma ?? joined.gamma ?? 0);
    if (!cp || !Number.isFinite(oi) || oi <= 0) continue;
    rows.push({
      strike: Number(o.strike_price ?? joined.strike_price ?? joined.strike),
      cp,
      dte: days,
      exp,
      oi,
      vol: Number(o.volume ?? joined.volume ?? 0),
      gamma,
      delta: Number(o.delta ?? joined.delta ?? 0),
      iv: Number(o.implied_volatility ?? o.iv ?? joined.implied_volatility ?? joined.iv ?? 0),
      bid: Number(o.bid_price ?? o.bid ?? 0),
      ask: Number(o.ask_price ?? o.ask ?? 0),
      root: ((/:([A-Z]+)\d{6}[CP]/.exec(String(o.code || ''))) || [])[1]
    });
    expiries.set(isoDate(exp), exp);
  }
  dedupeRoots(rows);
  const spot = Number(quotes.last_price || quotes.underlying_price || quotes.current_price || 0);
  if (!Number.isFinite(spot) || spot <= 0) throw new Error('InsightSentry options missing spot');
  let contractsOut;
  if (dteMax === 0 || dteMax === 1) {
    const exps = [...expiries.values()].sort((a, b) => a - b);
    if (!exps.length) contractsOut = [];
    else {
      // InsightSentry's quotes are fresh for many expiries, but OI is currently usable only
      // on the closest listed expiry for some underlyings. Prefer the requested expiry, then
      // fall back to the nearest expiry that has enough OI-backed contracts so the GEX levels
      // remain updated instead of silently reverting to the older source.
      const requested = exps[Math.min(dteMax, exps.length - 1)];
      contractsOut = rows.filter(r => isoDate(r.exp) === isoDate(requested));
      if (contractsOut.length < 20) {
        for (const exp of exps) {
          const group = rows.filter(r => isoDate(r.exp) === isoDate(exp));
          if (group.length >= 20) { contractsOut = group; break; }
        }
      }
    }
  } else {
    contractsOut = rows.filter(r => r.dte <= dteMax);
    if (contractsOut.length < 20) contractsOut = rows;
  }
  if (contractsOut.length < 20) throw new Error(`InsightSentry options thin chain (${contractsOut.length})`);
  const tsMs = Number(quotes.last_update || quotes.updated_at || 0);
  const asof = tsMs ? new Date(tsMs).toISOString() : new Date().toISOString();
  const iv30 = atmIv(rows, spot);
  return { current_price: spot, options: contractsOut, iv30, last_trade_time: asof, options_ts: tsMs ? tsMs / 1000 : Date.now() / 1000, source: 'insightsentry_options' };
}

// IV30 for the InsightSentry chain (Cboe publishes its own iv30). Before the 2026-10-13 audit
// this was the median IV of EVERY contract in the selected expiry; on a 0DTE chain most of those
// are far out-of-the-money wings priced at 60-150% IV, so QQQ read 44.7% (Cboe iv30 18.3%) and
// the IV ±68% lines sat ±2.8% away. Now: the at-the-money IV (median of the calls and puts on
// the 2 listed strikes each side of spot, within 2% of spot) of the expiry nearest 30 days
// among the contracts fetched. Returned in percent; 0 when nothing qualifies.
function atmIv(rows, spot) {
  const pct = v => (v > 3 ? v : v * 100);
  const ok = (rows || []).filter(r => Number.isFinite(r.iv) && r.iv > 0 && Number.isFinite(r.strike) && Math.abs(r.strike - spot) / spot <= 0.02 && Number.isFinite(r.dte));
  if (!ok.length || !(spot > 0)) return 0;
  const dtes = [...new Set(ok.map(r => r.dte))];
  const best = dtes.reduce((a, b) => (Math.abs(b - 30) < Math.abs(a - 30) || (Math.abs(b - 30) === Math.abs(a - 30) && b > a) ? b : a));
  const grp = ok.filter(r => r.dte === best);
  const strikes = [...new Set(grp.map(r => r.strike))];
  const below = strikes.filter(k => k <= spot).sort((a, b) => b - a).slice(0, 2);
  const above = strikes.filter(k => k > spot).sort((a, b) => a - b).slice(0, 2);
  const pick = new Set([...below, ...above]);
  const ivs = grp.filter(r => pick.has(r.strike)).map(r => pct(r.iv)).sort((a, b) => a - b);
  if (!ivs.length) return 0;
  const m = ivs.length >> 1;
  return round(ivs.length % 2 ? ivs[m] : (ivs[m - 1] + ivs[m]) / 2, 3);
}

function parsedRowsToSource(rows, spot, iv30, asof) {
  return { current_price: spot, options: rows, iv30, last_trade_time: asof };
}

function todayUtc(nowSec) {
  const d = nowSec ? new Date(nowSec * 1000) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dateFromOcc(yy, mm, dd) {
  return new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd)));
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function dte(exp, nowSec) { return Math.round((exp - todayUtc(nowSec)) / 86400000); }
function round(n, d = 2) { return n == null || !Number.isFinite(n) ? null : Number(n.toFixed(d)); }

// Same strike/expiry listed under two roots (SPX and SPXW): keep the weekly root's rows for that expiry, the plain root only for
// expiries the weekly root does not have (CoS decision 2026-10-16: /api/gex/levels/SPX was jumping between calls).
function dedupeRoots(rows) {
  const weeklyExp = new Set(rows.filter(r => r.root && /W$/.test(r.root) && r.root.length > 1).map(r => isoDate(r.exp)));
  if (!weeklyExp.size) return rows;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (weeklyExp.has(isoDate(r.exp)) && !(r.root && /W$/.test(r.root) && r.root.length > 1)) rows.splice(i, 1);
  }
  return rows;
}
function parseOptions(data, dteMax, nowSec) {
  const spot = Number(data.current_price);
  if (data.source === 'insightsentry_options') return { spot, contracts: data.options || [] };
  const raw = [];
  const expiries = new Map();
  for (const o of data.options || []) {
    const m = OCC.exec(o.option || '');
    if (!m) continue;
    const [, , yy, mm, dd, cp, strikeRaw] = m;
    const exp = dateFromOcc(yy, mm, dd);
    const days = dte(exp, nowSec);
    if (days < 0) continue;
    const row = {
      strike: Number(strikeRaw) / 1000,
      cp,
      dte: days,
      exp,
      oi: Number(o.open_interest || 0),
      vol: Number(o.volume || 0),
      gamma: Number(o.gamma || 0),
      delta: Number(o.delta || 0),
      iv: Number(o.iv || 0),
      bid: Number(o.bid || 0),
      ask: Number(o.ask || 0)
    };
    row.root = m[1];
    raw.push(row);
    expiries.set(isoDate(exp), exp);
  }
  dedupeRoots(raw);
  if (dteMax === 0 || dteMax === 1) {
    const exps = [...expiries.values()].sort((a, b) => a - b);
    if (!exps.length) return { spot, contracts: [] };
    const target = exps[Math.min(dteMax, exps.length - 1)];
    return { spot, contracts: raw.filter(r => isoDate(r.exp) === isoDate(target)) };
  }
  return { spot, contracts: raw.filter(r => r.dte <= dteMax) };
}

function profile(spot, contracts) {
  const gex = new Map(), dex = new Map(), oi = new Map();
  const callGex = new Map(), putGex = new Map();   // per side: calls positive, puts negative
  for (const c of contracts) {
    const sign = c.cp === 'C' ? 1 : -1;
    const g = c.gamma * c.oi * 100 * spot * spot * 0.01;
    const d = c.delta * c.oi * 100 * spot;
    gex.set(c.strike, (gex.get(c.strike) || 0) + sign * g);
    if (Number.isFinite(g) && g > 0) {
      const side = c.cp === 'C' ? callGex : putGex;
      side.set(c.strike, (side.get(c.strike) || 0) + sign * g);
    }
    dex.set(c.strike, (dex.get(c.strike) || 0) + d);
    oi.set(c.strike, (oi.get(c.strike) || 0) + c.oi);
  }
  return { gex, dex, oi, callGex, putGex };
}

// Gamma walls (Owner decision 2026-10-13, "Yes gamma ofc"):
//   call wall = the strike at or above spot with the largest positive CALL gamma exposure,
//   put wall  = the strike at or below spot with the largest negative PUT gamma exposure,
// both within the near-spot band (6% of spot, the band net GEX and the old net walls use).
// Returns [callWall|null, putWall|null]; null when that side has no gamma data in the band.
function gammaWalls(spot, callGex, putGex, band = 0.06) {
  const near = k => Math.abs(k - spot) / spot < band;
  const calls = [...(callGex || new Map()).entries()].filter(([k, g]) => k >= spot && near(k) && g > 0);
  const puts = [...(putGex || new Map()).entries()].filter(([k, g]) => k <= spot && near(k) && g < 0);
  const cw = calls.length ? calls.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
  const pw = puts.length ? puts.reduce((a, b) => (b[1] < a[1] ? b : a))[0] : null;
  return [cw, pw];
}

function walls(spot, gex, band = 0.06) {
  const strikes = [...gex.keys()].sort((a, b) => a - b);
  const near = strikes.filter(k => Math.abs(k - spot) / spot < band);
  const pool = near.length ? near : strikes;
  const above = pool.filter(k => k >= spot);
  const below = pool.filter(k => k <= spot);
  let cw = above.length ? above.reduce((a, b) => gex.get(a) > gex.get(b) ? a : b) : null;
  let pw = below.length ? below.reduce((a, b) => gex.get(a) < gex.get(b) ? a : b) : null;
  if (cw == null && pool.length) cw = pool.reduce((a, b) => gex.get(a) > gex.get(b) ? a : b);
  if (pw == null && pool.length) pw = pool.reduce((a, b) => gex.get(a) < gex.get(b) ? a : b);
  return [cw, pw];
}

function bsGamma(S, K, T, sigma, r = 0.045, q = 0.0) {
  if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) return 0;
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / v;
  if (!Number.isFinite(d1) || Math.abs(d1) > 12) return 0;
  const nd1 = Math.exp(-0.5 * d1 * d1) / SQ2PI;
  return Math.exp(-q * T) * nd1 / (S * v);
}

// Time to expiry in CALENDAR years (the convention Cboe's IVs are quoted in), measured to 16:00 New
// York on the expiry day, never less than 15 minutes. Before the 2026-10-13 audit a 0DTE contract
// always used 1/(252*8) of a year (about 49 trading minutes) and multi-day ones dte/252.
const MIN_T_SEC = 15 * 60;
const closeMemo = new Map();
function yearsToClose(exp, nowSec) {
  const key = isoDate(exp);
  let close = closeMemo.get(key);
  if (close === undefined) { close = etEpoch(key + 'T16:00:00'); if (closeMemo.size > 200) closeMemo.clear(); closeMemo.set(key, close); }
  return Math.max(MIN_T_SEC, (close || 0) - nowSec) / (365 * 86400);
}
function netGexAt(spot, contracts, nowSec = Date.now() / 1000) {
  let total = 0;
  for (const c of contracts) {
    let iv = c.iv;
    if (!iv || iv <= 0) continue;
    if (iv > 3) iv /= 100;
    const T = c.T || (c.exp instanceof Date ? yearsToClose(c.exp, nowSec) : Math.max(c.dte / 252, 1 / (252 * 8)));
    const g = bsGamma(spot, c.strike, T, iv);
    if (!g) continue;
    const expo = g * c.oi * 100 * spot * spot * 0.01;
    total += c.cp === 'C' ? expo : -expo;
  }
  return total;
}

function gammaFlip(spot, contracts, loPct = 0.90, hiPct = 1.10, steps = 80, nowSec = Date.now() / 1000) {
  const lo = spot * loPct, hi = spot * hiPct;
  const xs = Array.from({ length: steps }, (_, i) => lo + (hi - lo) * i / (steps - 1));
  const ys = xs.map(x => netGexAt(x, contracts, nowSec));
  const crosses = [];
  for (let i = 1; i < xs.length; i++) {
    let a = xs[i - 1], b = xs[i], fa = ys[i - 1], fb = ys[i];
    if (fa === 0) crosses.push(a);
    else if (fa * fb < 0) {
      let m = a;
      for (let j = 0; j < 28; j++) {
        m = a + (b - a) * Math.abs(fa) / (Math.abs(fa) + Math.abs(fb));
        const fm = netGexAt(m, contracts, nowSec);
        if (fm === 0) break;
        if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
        if (Math.abs(b - a) < spot * 1e-6) break;
      }
      crosses.push(m);
    }
  }
  if (!crosses.length) return null;
  return crosses.reduce((a, b) => Math.abs(a - spot) < Math.abs(b - spot) ? a : b);
}

function activityWalls(spot, contracts, zeroGamma, band = 0.04) {
  const callScore = new Map(), putScore = new Map();
  const callFloor = Math.max(spot, zeroGamma || spot);
  const putCeiling = Math.min(spot, zeroGamma || spot);
  for (const c of contracts) {
    if (Math.abs(c.strike - spot) / spot > band) continue;
    const score = (c.vol || c.oi || 0) + 0.001 * (c.oi || 0);
    if (c.cp === 'C' && c.strike >= callFloor) callScore.set(c.strike, (callScore.get(c.strike) || 0) + score);
    if (c.cp === 'P' && c.strike <= putCeiling) putScore.set(c.strike, (putScore.get(c.strike) || 0) + score);
  }
  const cw = callScore.size ? [...callScore.keys()].reduce((a, b) => callScore.get(a) > callScore.get(b) ? a : b) : null;
  const pw = putScore.size ? [...putScore.keys()].reduce((a, b) => putScore.get(a) > putScore.get(b) ? a : b) : null;
  return [cw, pw, callScore, putScore];
}

// Walls: gamma first (gammaWalls). A side with no gamma data falls back to the old
// activity wall (volume, OI breaks ties, split by the flip), then to the net-GEX wall.
// wall_source: 'gamma' when both walls are gamma walls, else e.g.
// 'call:gamma,put:activity_fallback' so a fallback is visible in the API.
function levels(spot, gex, contracts, side, nowSec = Date.now() / 1000) {
  const near = [...gex.keys()].filter(k => Math.abs(k - spot) / spot < 0.06);
  const pool = near.length ? near : [...gex.keys()];
  const [nwC, nwP] = walls(spot, gex);
  const zeroGamma = contracts && contracts.length ? gammaFlip(spot, contracts, 0.90, 1.10, 80, nowSec) : null;
  const [gwC, gwP] = gammaWalls(spot, side && side.callGex, side && side.putGex);
  let awC = null, awP = null;
  if (gwC == null || gwP == null) [awC, awP] = activityWalls(spot, contracts || [], zeroGamma);
  const pick = (g, a, n) => (g != null ? [g, 'gamma'] : a != null ? [a, 'activity_fallback'] : [n, 'net_gex_fallback']);
  const [callWall, cSrc] = pick(gwC, awC, nwC);
  const [putWall, pSrc] = pick(gwP, awP, nwP);
  const wallSource = cSrc === pSrc ? cSrc : `call:${cSrc},put:${pSrc}`;
  const total = pool.reduce((s, k) => s + (gex.get(k) || 0), 0);
  return { call_wall: callWall, put_wall: putWall, zero_gamma: zeroGamma, net_gex: total, regime: total > 0 ? 'POSITIVE' : 'NEGATIVE', wall_source: wallSource };
}

// Session expected range (GEXLAB public method, Owner-approved 2026-10-13) for 0DTE / 1DTE:
// sigma = ATM straddle mid / sqrt(2/pi) (a straddle is worth about 0.798 sigma), from the selected
// expiry; if no two-sided ATM quote, sigma = ATM IV x sqrt(calendar years to that expiry's 16:00 ET)
// x spot. 68% = center ± sigma, 80% = center ± 1.2816 sigma. Held for the session by the caller.
const STRADDLE_TO_SIGMA = Math.sqrt(Math.PI / 2);
function straddleRange(spot, contracts, nowSec = Date.now() / 1000) {
  if (!(spot > 0) || !contracts || !contracts.length) return null;
  const strikes = [...new Set(contracts.map(c => c.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot));
  let sigma = null, method = null, atm = null, straddle = null;
  for (const k of strikes.slice(0, 3)) {
    const c = contracts.find(x => x.strike === k && x.cp === 'C'), pt = contracts.find(x => x.strike === k && x.cp === 'P');
    const mid = o => (o && o.bid > 0 && o.ask >= o.bid ? (o.bid + o.ask) / 2 : null);
    const mc = mid(c), mp = mid(pt);
    if (mc != null && mp != null) { atm = k; straddle = mc + mp; sigma = straddle * STRADDLE_TO_SIGMA; method = 'atm_straddle'; break; }
  }
  if (sigma == null) {
    const k = strikes[0];
    const ivs = contracts.filter(x => x.strike === k && x.iv > 0).map(x => (x.iv > 3 ? x.iv / 100 : x.iv));
    const exp = contracts.find(x => x.strike === k)?.exp;
    if (!ivs.length || !(exp instanceof Date)) return null;
    atm = k;
    sigma = ivs.reduce((a, b) => a + b, 0) / ivs.length * Math.sqrt(yearsToClose(exp, nowSec)) * spot;
    method = 'atm_iv';
  }
  if (!(sigma > 0)) return null;
  return { center: spot, sigma, method, atm_strike: atm, straddle: straddle == null ? null : round(straddle, 4), ts: nowSec };
}
function bands(em) {
  return { '68%': [em.center - em.sigma, em.center + em.sigma], '80%': [em.center - 1.2816 * em.sigma, em.center + 1.2816 * em.sigma] };
}
// A snapshot may be taken only from a chain printed during today's cash session (09:30-16:00 ET):
// never from the prior session's chain that Cboe still serves just after the open.
function snapshotAllowed(optTs, nowSec) {
  if (!optTs) return false;
  const o = etClock(optTs), n = etClock(nowSec);
  return o.y === n.y && o.mo === n.mo && o.d === n.d && o.min >= RTH_OPEN && o.min < RTH_CLOSE && cashScheduleOpen(nowSec);
}
function etDay(tsSec) { const c = etClock(tsSec); return `${c.y}-${String(c.mo).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`; }

function ivRange(spot, iv30, days = 1) {
  const s = (iv30 || 0) / 100 * Math.sqrt(days / 252);
  return { '68%': [spot * (1 - s), spot * (1 + s)], '80%': [spot * (1 - 1.282 * s), spot * (1 + 1.282 * s)] };
}

// Futures and index quotes: a 1-day window is empty over weekends and holidays, which left
// the futures conversion and the chart blank whenever the market was shut. Fall back to 5 days
// so the last real print (with its true age) is used instead.
async function quoteLast(symbol, interval = '5m', range = '1d') {
  try { return await quoteLastRange(symbol, interval, range); }
  catch (e) { if (range === '1d') return quoteLastRange(symbol, interval, '5d'); throw e; }
}

async function quoteLastRange(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  // Same 60 s TTL as candleMemo: a warm Worker must not serve an old spot quote.
  const memo = quoteMemo.get(url);
  let data;
  if (memo && Date.now() - memo.ts < 60000) {
    data = memo.data;
  } else {
    data = await fetchJson(url);
    if (quoteMemo.size > 40) quoteMemo.clear();
    quoteMemo.set(url, { ts: Date.now(), data });
  }
  const r = data.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  const ts = r?.timestamp || [];
  const close = q?.close || [];
  for (let i = close.length - 1; i >= 0; i--) {
    if (close[i] != null) return { price: Number(close[i]), age: Math.max(0, Date.now() / 1000 - ts[i]), ts: ts[i] };
  }
  throw new Error(`no data for ${symbol}`);
}

async function kFor(name, spot) {
  const m = MAPPING[name];
  if (m.kFixed != null) return [m.kFixed, 'fixed'];
  if (m.kIndex) {
    try {
      const q = await quoteLast(m.kIndex, '5m', '1d');
      return [q.price / spot, 'measured'];
    } catch (_) {}
  }
  return [null, 'unavailable'];
}

async function convertLevels(name, spot, rawLevels) {
  const m = MAPPING[name];
  const [k, kSource] = await kFor(name, spot);
  const res = {};
  for (const fut of m.futs) {
    const [yh, pointValue, tick, tickValue] = FUTURES[fut];
    try {
      const q = await quoteLast(yh, '5m', '1d');
      let ratio, basis, basisSource, mode;
      if (k != null && m.index) {
        basis = q.price - spot * k;
        ratio = k;
        basisSource = 'live-futures-anchor';
        mode = 'k+live_basis';
      } else {
        ratio = q.price / spot;
        basis = 0;
        basisSource = 'ratio-anchored';
        mode = 'ratio';
      }
      const conv = v => v == null ? null : round(v * ratio + basis, 2);
      res[fut] = {
        mode, ratio: round(ratio, 4), basis: round(basis, 2), basis_source: basisSource,
        basis_age_min: round(q.age / 60, 1), k_source: kSource, futures_price: round(q.price, 2),
        futures_age_min: round(q.age / 60, 1), futures_ts: q.ts, point_value: pointValue, tick, tick_value: tickValue,
        levels: Object.fromEntries(Object.entries(rawLevels).map(([kk, v]) => [kk, conv(v)]))
      };
    } catch (e) {
      res[fut] = { error: e.message };
    }
  }
  return res;
}

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
});

function nyParts(tsSec) {
  const parts = nyFormatter.formatToParts(new Date(tsSec * 1000));
  const get = t => parts.find(p => p.type === t)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, min: Number(get('hour')) * 60 + Number(get('minute')) };
}

async function yahooCandles(fut, interval = '5m') {
  fut = String(fut || '').toUpperCase();
  if (!FUTURES[fut]) throw new Error(`unknown futures symbol ${fut}`);
  const memoKey = `${fut}:${interval}`;
  const memo = candleMemo.get(memoKey);
  if (memo && Date.now() - memo.ts < 60000) return structuredClone(memo.data);
  const periods = { '1m': '2d', '2m': '5d', '5m': '5d', '15m': '1mo', '30m': '1mo', '1h': '3mo', '1d': '1y' };
  if (!periods[interval]) interval = '5m';
  const [yh] = FUTURES[fut];
  // A short window can be empty after a long weekend or holiday; widen it once so the last
  // session still draws instead of a blank chart.
  const wider = { '1m': '5d', '2m': '1mo', '5m': '1mo' };
  let out = await candleRows(yh, periods[interval], interval);
  if (!out.length && wider[interval]) out = await candleRows(yh, wider[interval], interval);
  if (!out.length) throw new Error(`no candle data for ${fut} ${interval}`);
  const data = { symbol: fut, interval, candles: out, last: out[out.length - 1].close, count: out.length };
  if (candleMemo.size > 20) candleMemo.clear();
  candleMemo.set(memoKey, { ts: Date.now(), data });
  return structuredClone(data);
}

async function candleRows(yh, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yh)}?range=${range}&interval=${interval}`;
  const data = await fetchJson(url);
  const r = data.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  const ts = r?.timestamp || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if ([q?.open?.[i], q?.high?.[i], q?.low?.[i], q?.close?.[i]].some(v => v == null)) continue;
    out.push({ time: ts[i], open: round(q.open[i], 2), high: round(q.high[i], 2), low: round(q.low[i], 2), close: round(q.close[i], 2), volume: Math.round(q.volume?.[i] || 0) });
  }
  return out;
}

function volumeProfile(rows, tick, valueArea = 0.70) {
  if (!rows.length) return [null, null, null];
  const useVol = rows.reduce((s, r) => s + (r.volume || 0), 0) > 0;
  const step = tick * 4;
  const buckets = new Map();
  for (const r of rows) {
    const lo = Math.min(r.low, r.high), hi = Math.max(r.low, r.high);
    const n = Math.max(1, Math.round((hi - lo) / step) + 1);
    const w = (useVol ? (r.volume || 0) : 1) / n;
    for (let i = 0; i < n; i++) {
      const p = round(Math.round((lo + i * step) / step) * step, 4);
      buckets.set(p, (buckets.get(p) || 0) + w);
    }
  }
  if (!buckets.size) return [null, null, null];
  const prices = [...buckets.keys()].sort((a, b) => a - b);
  const poc = prices.reduce((a, b) => buckets.get(a) > buckets.get(b) ? a : b);
  const target = [...buckets.values()].reduce((a, b) => a + b, 0) * valueArea;
  let i = prices.indexOf(poc), lo = i, hi = i, acc = buckets.get(poc);
  while (acc < target && (lo > 0 || hi < prices.length - 1)) {
    const down = lo > 0 ? buckets.get(prices[lo - 1]) : -1;
    const up = hi < prices.length - 1 ? buckets.get(prices[hi + 1]) : -1;
    if (up >= down) { hi++; acc += up; } else { lo--; acc += down; }
  }
  return [poc, prices[hi], prices[lo], useVol];
}

async function sessionLevels(fut) {
  const [,, tick] = FUTURES[fut];
  const c = await yahooCandles(fut, '5m');
  const rows = c.candles.map(r => ({ ...r, ny: nyParts(r.time) }));
  const days = [...new Set(rows.map(r => r.ny.date))].sort();
  if (days.length < 2) throw new Error('not enough session history');
  const rth = day => rows.filter(r => r.ny.date === day && r.ny.min >= RTH_OPEN && r.ny.min < RTH_CLOSE);
  const today = days[days.length - 1];
  let prior = days.slice(0, -1).reverse().find(d => rth(d).length > 10) || days[days.length - 2];
  const pdf = rth(prior);
  const [poc, vah, val, volumeBased] = volumeProfile(pdf, tick);
  const on = rows.filter(r => (r.ny.date === prior && r.ny.min >= RTH_CLOSE) || (r.ny.date === today && r.ny.min < RTH_OPEN));
  const tdf = rth(today);
  const hi = arr => arr.length ? round(Math.max(...arr.map(r => r.high)), 2) : null;
  const lo = arr => arr.length ? round(Math.min(...arr.map(r => r.low)), 2) : null;
  return {
    symbol: fut, prior_session: prior, today,
    prior_poc: round(poc, 2), prior_vah: round(vah, 2), prior_val: round(val, 2),
    prior_rth_high: hi(pdf), prior_rth_low: lo(pdf), prior_close: pdf.length ? round(pdf[pdf.length - 1].close, 2) : null,
    volume_based: !!volumeBased,
    overnight_high: hi(on), overnight_low: lo(on),
    rth_high: hi(tdf), rth_low: lo(tdf), rth_open: tdf.length ? round(tdf[0].open, 2) : null
  };
}

// ---- Market status (display only; never feeds any level calculation) ----
// CME equity/metal futures: Sunday 18:00 ET to Friday 17:00 ET, daily break 17:00-18:00 ET.
// Cboe delayed options chain: weekdays 09:30-16:15 ET. Holidays are not in a table: they are
// detected from the data itself (no futures prints for a long time inside scheduled hours, or an
// options chain from a previous day during cash hours).
const FRESH_SEC = 30 * 60;      // same 30-minute freshness limit the page already used
const GONE_SEC = 90 * 60;       // no futures print for this long inside scheduled hours = closed (holiday/halt)
const PRIOR_DAY_SEC = 18 * 3600; // options chain this old during cash hours = cash holiday
const OPENING_GAP_MIN = 45;       // after 09:30 ET a prior-session chain is the Cboe delay, not a holiday, for this long

function etClock(tsSec) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hour12: false
  }).formatToParts(new Date(tsSec * 1000));
  const get = t => parts.find(p => p.type === t)?.value;
  const hour = Number(get('hour')) % 24;
  return {
    y: Number(get('year')), mo: Number(get('month')), d: Number(get('day')),
    h: hour, mi: Number(get('minute')), s: Number(get('second')),
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    min: hour * 60 + Number(get('minute'))
  };
}

// Cboe returns last_trade_time as New York wall time without a zone, e.g. "2026-10-02T16:14:59".
function etEpoch(str) {
  if (!str) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(str)) { const t = Date.parse(str); return Number.isFinite(t) ? t / 1000 : null; }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(str);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
  let ts = wall;
  for (let i = 0; i < 2; i++) {
    const c = etClock(ts);
    const shown = Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s) / 1000;
    ts += wall - shown;
  }
  return ts;
}

function futuresScheduleOpen(tsSec) {
  const c = etClock(tsSec);
  if (c.dow === 6) return false;
  if (c.dow === 0) return c.min >= 18 * 60;
  if (c.dow === 5) return c.min < 17 * 60;
  return !(c.min >= 17 * 60 && c.min < 18 * 60);
}

function cashScheduleOpen(tsSec) {
  const c = etClock(tsSec);
  return c.dow >= 1 && c.dow <= 5 && c.min >= RTH_OPEN && c.min < RTH_CLOSE + 15;
}

// Seconds until the cash session next opens by schedule, looked ahead up to maxSec (minute steps).
// Used to stop a long closed-market cache entry from outliving 09:30 ET.
function secsToCashOpen(tsSec, maxSec) {
  for (let t = 60; t <= maxSec; t += 60) if (cashScheduleOpen(tsSec + t)) return t;
  return Infinity;
}

// True when the cash session is open by schedule, inside its first OPENING_GAP_MIN minutes, and the
// options chain is still from an earlier session (Cboe's delayed feed has not printed today yet).
function openingGap(now, optTs) {
  if (!optTs || !cashScheduleOpen(now)) return false;
  const c = etClock(now), o = etClock(optTs);
  const sinceOpen = c.min - RTH_OPEN;
  const priorSession = o.y !== c.y || o.mo !== c.mo || o.d !== c.d || o.min < RTH_OPEN;
  return priorSession && sinceOpen >= 0 && sinceOpen < OPENING_GAP_MIN;
}

// state: open | opening (cash just opened, delayed chain still from the prior session) | stale |
//        cash_closed (futures trading, options chain from the last cash session) | closed | nodata
function marketStatus({ now, futTs, optTs }) {
  now = now == null ? Date.now() / 1000 : now;
  const futAge = futTs ? now - futTs : null;
  const optAge = optTs ? now - optTs : null;
  let futures;
  if (!futTs) futures = 'nodata';
  else if (!futuresScheduleOpen(now) || futAge > GONE_SEC) futures = 'closed';
  else if (futAge > FRESH_SEC) futures = 'stale';
  else futures = 'open';
  let options;
  if (!optTs) options = 'nodata';
  else if (!cashScheduleOpen(now) || futures === 'closed' || optAge > PRIOR_DAY_SEC) options = 'closed';
  else if (optAge > FRESH_SEC) options = 'stale';
  else options = 'open';
  let state;
  if (futures === 'nodata' && options === 'nodata') state = 'nodata';
  else if (futures === 'closed' || futures === 'nodata') state = 'closed';
  else if (futures !== 'stale' && openingGap(now, optTs)) state = 'opening';
  else if (futures === 'stale' || options === 'stale') state = 'stale';
  else if (options === 'closed' || options === 'nodata') state = 'cash_closed';
  else state = 'open';
  return {
    state, futures, options, now, cash_schedule_open: cashScheduleOpen(now),
    futures_ts: futTs || null, options_ts: optTs || null,
    futures_age_min: futAge == null ? null : round(futAge / 60, 1),
    options_age_min: optAge == null ? null : round(optAge / 60, 1),
    data_ts: futTs || optTs || null
  };
}

function migrationStub(name, dte) {
  return { underlying: name, dte, samples: 1, msg: 'Migration history starts from live website requests.' };
}

function warnings(data) {
  const out = [];
  if (!data.zero_gamma) out.push({ level: 'info', kind: 'no_flip', msg: 'No zero-gamma crossing found inside the current scan range.' });
  if (data.contracts < 50) out.push({ level: 'warn', kind: 'thin_chain', msg: 'Few contracts matched this expiry filter; treat walls as lower confidence.' });
  return out;
}

// Options source (GEX audit round 3, 2026-10-13): Cboe's chain is PRIMARY again, as before build
// 483. The InsightSentry chain (build 483) moved zero gamma (QQQ 755 vs spot 742) and inflated IV;
// it is now only the fallback when Cboe fails. opts.emStore = { get(key), put(key, value) } holds
// the session expected-range snapshot (functions/api/gex/levels/[name].js, edge cache).
async function buildLevels(name, dteMax = 1, env = {}, opts = {}) {
  name = String(name || '').toUpperCase();
  if (!MARKETS[name]) throw new Error('unknown market');
  if (![0, 1, 7, 30].includes(dteMax)) dteMax = 1;
  const cfg = MARKETS[name];
  // Options source: the compact Cboe chain from our feeder (never the 5-13 MB raw Cboe file: that
  // blew the Function's CPU limit, error 1102, build 528). Missing or stale -> InsightSentry.
  const nowSec = opts.now || Date.now() / 1000;
  let source = 'cboe';
  let optData, parsed, compactNote = null, isCalls = 0;
  try {
    const d = opts.compact !== undefined ? (typeof opts.compact === 'function' ? await opts.compact(name, dteMax) : opts.compact) : await fetchCompact(name, dteMax, env);
    if (!d) throw new Error('compact chain missing');
    if (!compactFresh(d, nowSec)) throw new Error('compact chain stale (' + Math.round((nowSec - d.fetched_at) / 60) + ' min)');
    parsed = compactToContracts(d, dteMax, nowSec);
    if (parsed.contracts.length < 20) throw new Error('compact chain thin');
    optData = { current_price: d.spot, iv30: d.iv30, last_trade_time: d.chain_time, chain_fetched_at: d.fetched_at };
  } catch (e) {
    compactNote = String(e && e.message || e).slice(0, 120);
    isCalls += 2;   // quotes + contracts
    optData = await fetchInsightOptions(name, dteMax, env);
    source = 'insightsentry_options';
    parsed = parseOptions(optData, dteMax, nowSec);
  }
  let spot = parsed.spot, contracts = parsed.contracts;
  const expiries = [...new Set(contracts.map(c => isoDate(c.exp)))].sort();
  let optTs = optData.options_ts || etEpoch(optData.last_trade_time || null);
  const sources = { fallback_reason: compactNote, hybrid_skip_reason: null, chain: source === 'cboe' ? 'cboe' : 'insightsentry', oi: source === 'cboe' ? 'cboe' : 'insightsentry', iv: source === 'cboe' ? 'cboe' : 'insightsentry', spot: source === 'cboe' ? 'cboe' : 'insightsentry', gamma: 'black_scholes' };
  let cboeOnly = null;
  if (source === 'cboe' && expiries.length === 1 && opts.hybrid !== false) {
    try {
      if (!opts.insightQuotes) isCalls += 1;
      const live = await (opts.insightQuotes ? opts.insightQuotes(name, expiries[0]) : fetchInsightQuotes(name, expiries[0], env));
      const m = mergeHybrid(contracts, live);
      if (!live.byKey.size) sources.hybrid_skip_reason = `InsightSentry returned no rows for ${expiries[0]} (${live.rows || 0} rows in reply)`;
      else if (!(m.used > 0)) sources.hybrid_skip_reason = `no sane InsightSentry IV (${live.byKey.size} rows, 0 matched with 0<iv<1.5 and a two-sided quote)`;
      else if (Math.abs(live.spot / spot - 1) > 0.05) sources.hybrid_skip_reason = `InsightSentry spot ${live.spot} is >5% from Cboe ${spot}`;
      else {
        cboeOnly = { spot, contracts };
        spot = live.spot; contracts = m.contracts;
        // "updated X min ago" = the LIVE inputs' age (market.options_ts); the chain's own time
        // stays in asof / market.chain_ts.
        optTs = live.ts || nowSec;
        sources.iv = 'insightsentry'; sources.spot = 'insightsentry';
        sources.iv_contracts = { insightsentry: m.used, cboe: contracts.length - m.used };
        sources.live_ts = round(optTs, 0);
      }
    } catch (e) {
      // InsightSentry down / not configured / timed out: pure Cboe. Never includes the key.
      sources.hybrid_skip_reason = String(e && e.message || e).replace(/https?:\/\/\S+/g, (u) => u.split('?')[0]).slice(0, 140);
    }
  } else if (source === 'cboe') {
    sources.hybrid_skip_reason = opts.hybrid === false ? 'disabled' : `chain has ${expiries.length} expiries (hybrid runs for 0DTE/1DTE only)`;
  }
  if (isCalls) await noteIs(env, isCalls);
  contracts = ownGamma(contracts, spot, nowSec);
  const p = profile(spot, contracts);
  const lv = levels(spot, p.gex, contracts, p, nowSec);
  // Side-by-side for the audit: the same chain priced with Cboe's spot + IV only.
  let compare = null;
  if (cboeOnly) {
    const cc = ownGamma(cboeOnly.contracts, cboeOnly.spot, nowSec), cp = profile(cboeOnly.spot, cc), cl = levels(cboeOnly.spot, cp.gex, cc, cp, nowSec);
    compare = { cboe_only: { spot: cboeOnly.spot, call_wall: cl.call_wall, put_wall: cl.put_wall, zero_gamma: cl.zero_gamma == null ? null : round(cl.zero_gamma, 2) } };
  }
  let expected = ivRange(spot, Number(optData.iv30 || 0));
  let expectedInfo = { method: 'iv30_1day', held: false };
  if ((dteMax === 0 || dteMax === 1) && expiries.length === 1) {
    const live = straddleRange(spot, contracts, nowSec);
    if (live) {
      let em = live, held = false, phase = 'pre-open';
      const key = `${name}:${dteMax}:${expiries[0]}:${etDay(nowSec)}`;
      if (opts.emStore) {
        try {
          const snap = await opts.emStore.get(key);
          if (snap && snap.sigma > 0) { em = snap; held = true; phase = 'session'; }
          else if (snapshotAllowed(optTs, nowSec)) { await opts.emStore.put(key, live); held = true; phase = 'session'; }
        } catch (_) {}
      }
      if (!held && snapshotAllowed(optTs, nowSec)) phase = 'session_unheld';
      expected = bands(em);
      expectedInfo = { method: em.method, held, phase, center: round(em.center, 2), sigma: round(em.sigma, 4), atm_strike: em.atm_strike, straddle: em.straddle, snapshot_ts: held ? em.ts : null };
    }
  }
  const data = {
    ...lv,
    max_pain: maxPain(contracts.map(c => ({ strike: c.strike, cp: c.cp, oi: c.oi })), spot),
    underlying: name, spot, iv30: Number(optData.iv30 || 0), contracts: contracts.length, source, sources, compare,
    fut: cfg.fut, mult: cfg.mult, expected, expected_info: expectedInfo,
    asof: optData.last_trade_time || null,
    expiry: expiries.length === 1 ? expiries[0] : (expiries.length ? `${expiries[0]}–${expiries[expiries.length - 1]}` : null),
    expiry_dte: contracts.length && expiries.length === 1 ? contracts[0].dte : null,
    ladder: [...p.gex.keys()].filter(k => Math.abs(k - spot) / spot < 0.04).sort((a, b) => b - a).map(k => ({ strike: k, gex: p.gex.get(k), dex: p.dex.get(k) || 0, oi: p.oi.get(k) || 0 }))
  };
  const raw = { call_wall: data.call_wall, zero_gamma: data.zero_gamma, spot: data.spot, put_wall: data.put_wall, iv68_lo: data.expected['68%'][0], iv68_hi: data.expected['68%'][1], iv80_lo: data.expected['80%'][0], iv80_hi: data.expected['80%'][1] };
  data.futures = await convertLevels(name, spot, raw);
  data.session = {};
  for (const fut of Object.keys(data.futures)) {
    if (data.futures[fut].error) continue;
    try { data.session[fut] = await sessionLevels(fut); }
    catch (e) { data.session[fut] = { error: e.message }; }
  }
  data.migration = migrationStub(name, dteMax);
  data.warnings = warnings(data);
  data.fetched_at = Date.now() / 1000;
  const futTs = Object.values(data.futures).map(f => f && f.futures_ts).filter(Boolean).sort((a, b) => b - a)[0] || null;
  data.market = marketStatus({ now: data.fetched_at, futTs, optTs: optTs || etEpoch(data.asof) });
  data.market.chain_ts = etEpoch(data.asof) || null;
  return data;
}

export { dedupeRoots, fetchInsightQuotes, insightQuoteMap, mergeHybrid, ownGamma, saneIv, bsGamma, compactToContracts, compactFresh, fetchCompact };
export { atmIv, walls, gammaWalls, activityWalls, levels, ivRange, profile, gammaFlip, parseOptions, straddleRange, bands, snapshotAllowed, yearsToClose, netGexAt };
export { buildLevels, yahooCandles, json, MARKETS, FUTURES, MAPPING, marketStatus, etEpoch, futuresScheduleOpen, cashScheduleOpen, secsToCashOpen };
