const CBOE = 'https://cdn.cboe.com/api/global/delayed_quotes/options/';
const FETCH_TIMEOUT_MS = 4500;
const quoteMemo = new Map();
const candleMemo = new Map();

const MARKETS = {
  SPX: { cboe: '_SPX', fut: 'ES', mult: 1.0 },
  SPY: { cboe: 'SPY', fut: 'ES', mult: 10.0 },
  QQQ: { cboe: 'QQQ', fut: 'NQ', mult: 41.0 },
  GLD: { cboe: 'GLD', fut: 'GC', mult: 10.9 }
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

async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 StrykerGEX/1.0', 'accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`fetch ${res.status} ${url}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function todayUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dateFromOcc(yy, mm, dd) {
  return new Date(Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd)));
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function dte(exp) { return Math.round((exp - todayUtc()) / 86400000); }
function round(n, d = 2) { return n == null || !Number.isFinite(n) ? null : Number(n.toFixed(d)); }

function parseOptions(data, dteMax) {
  const spot = Number(data.current_price);
  const raw = [];
  const expiries = new Map();
  for (const o of data.options || []) {
    const m = OCC.exec(o.option || '');
    if (!m) continue;
    const [, , yy, mm, dd, cp, strikeRaw] = m;
    const exp = dateFromOcc(yy, mm, dd);
    const days = dte(exp);
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
      iv: Number(o.iv || 0)
    };
    raw.push(row);
    expiries.set(isoDate(exp), exp);
  }
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
  for (const c of contracts) {
    const sign = c.cp === 'C' ? 1 : -1;
    const g = c.gamma * c.oi * 100 * spot * spot * 0.01;
    const d = c.delta * c.oi * 100 * spot;
    gex.set(c.strike, (gex.get(c.strike) || 0) + sign * g);
    dex.set(c.strike, (dex.get(c.strike) || 0) + d);
    oi.set(c.strike, (oi.get(c.strike) || 0) + c.oi);
  }
  return { gex, dex, oi };
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

function netGexAt(spot, contracts) {
  let total = 0;
  for (const c of contracts) {
    let iv = c.iv;
    if (!iv || iv <= 0) continue;
    if (iv > 3) iv /= 100;
    const T = Math.max(c.dte / 252, 1 / (252 * 8));
    const g = bsGamma(spot, c.strike, T, iv);
    if (!g) continue;
    const expo = g * c.oi * 100 * spot * spot * 0.01;
    total += c.cp === 'C' ? expo : -expo;
  }
  return total;
}

function gammaFlip(spot, contracts, loPct = 0.90, hiPct = 1.10, steps = 80) {
  const lo = spot * loPct, hi = spot * hiPct;
  const xs = Array.from({ length: steps }, (_, i) => lo + (hi - lo) * i / (steps - 1));
  const ys = xs.map(x => netGexAt(x, contracts));
  const crosses = [];
  for (let i = 1; i < xs.length; i++) {
    let a = xs[i - 1], b = xs[i], fa = ys[i - 1], fb = ys[i];
    if (fa === 0) crosses.push(a);
    else if (fa * fb < 0) {
      let m = a;
      for (let j = 0; j < 28; j++) {
        m = a + (b - a) * Math.abs(fa) / (Math.abs(fa) + Math.abs(fb));
        const fm = netGexAt(m, contracts);
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

function levels(spot, gex, contracts) {
  const near = [...gex.keys()].filter(k => Math.abs(k - spot) / spot < 0.06);
  const pool = near.length ? near : [...gex.keys()];
  let [callWall, putWall] = walls(spot, gex);
  const zeroGamma = contracts && contracts.length ? gammaFlip(spot, contracts) : null;
  let wallSource = 'net_gex';
  const [awC, awP] = activityWalls(spot, contracts || [], zeroGamma);
  if (awC != null && awP != null) {
    callWall = awC; putWall = awP; wallSource = 'activity_volume_oi_split_by_flip';
  }
  const total = pool.reduce((s, k) => s + (gex.get(k) || 0), 0);
  return { call_wall: callWall, put_wall: putWall, zero_gamma: zeroGamma, net_gex: total, regime: total > 0 ? 'POSITIVE' : 'NEGATIVE', wall_source: wallSource };
}

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
  let data = quoteMemo.get(url);
  if (!data) {
    data = await fetchJson(url);
    if (quoteMemo.size > 40) quoteMemo.clear();
    quoteMemo.set(url, data);
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

// state: open | stale | cash_closed (futures trading, options chain from the last cash session) | closed | nodata
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
  else if (futures === 'stale' || options === 'stale') state = 'stale';
  else if (options === 'closed' || options === 'nodata') state = 'cash_closed';
  else state = 'open';
  return {
    state, futures, options, now,
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

async function buildLevels(name, dteMax = 1) {
  name = String(name || '').toUpperCase();
  if (!MARKETS[name]) throw new Error('unknown market');
  if (![0, 1, 7, 30].includes(dteMax)) dteMax = 1;
  const cfg = MARKETS[name];
  const cboe = await fetchJson(CBOE + encodeURIComponent(cfg.cboe) + '.json');
  const { spot, contracts } = parseOptions(cboe.data || cboe, dteMax);
  const p = profile(spot, contracts);
  const lv = levels(spot, p.gex, contracts);
  const expiries = [...new Set(contracts.map(c => isoDate(c.exp)))].sort();
  const data = {
    ...lv,
    underlying: name, spot, iv30: Number((cboe.data || cboe).iv30 || 0), contracts: contracts.length,
    fut: cfg.fut, mult: cfg.mult, expected: ivRange(spot, Number((cboe.data || cboe).iv30 || 0)),
    asof: (cboe.data || cboe).last_trade_time || null,
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
  data.market = marketStatus({ now: data.fetched_at, futTs, optTs: etEpoch(data.asof) });
  return data;
}

export { buildLevels, yahooCandles, json, MARKETS, FUTURES, MAPPING, marketStatus, etEpoch, futuresScheduleOpen, cashScheduleOpen };
