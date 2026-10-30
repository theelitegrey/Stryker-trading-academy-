// TradeZoro — Charts: per-chart cache for Pine request.security series (ES module, no DOM).
// Job "indicator engine speed r2 1030". Before: every script's every request.security call was a separate
// network fetch, one after another (Triton alone: dozens, first draw ~25 s). Now, per chart:
//   1. DEDUPE   same (symbol, timeframe) with a range already held or in flight -> no new fetch.
//   2. PARALLEL at most `maxInflight` fetches run at once (queue beyond that), across all scripts.
//   3. FROM BASE a higher intraday timeframe of the chart's own symbol is built from the chart's bars
//               when they cover the range (no network).
//   4. TAIL     a request that extends a held series to a later end fetches only the new tail.
//   5. LRU      total bars held are capped (phone lower); oldest-used series are dropped first.
// Bars are {time|openTime, open, high, low, close, volume}; times in ms.

const tOf = (b) => Number(b.openTime != null ? b.openTime : b.time);

export function tfToMs(tf){
  const m = /^(\d*)([SDWM]?)$/i.exec(String(tf == null ? '' : tf).trim());
  if (!m) return 0;
  const n = Number(m[1] || 1), u = (m[2] || '').toUpperCase();
  return n * (u === 'S' ? 1e3 : u === 'D' ? 864e5 : u === 'W' ? 6048e5 : u === 'M' ? 2592e6 : 6e4);
}
const isIntradayMinutes = (tf) => /^\d+$/.test(String(tf).trim()) && Number(tf) <= 240;

// Aggregate base bars into `tf` buckets aligned to the epoch (same as exchanges' intraday hours).
// Returns null when the base can't cover [from,to] (caller then fetches). Exported for tests.
export function aggregateBars(base, baseTf, tf, range){
  if (!base || !base.length || !isIntradayMinutes(tf)) return null;
  const bMs = tfToMs(baseTf), tMs = tfToMs(tf);
  if (!bMs || !tMs || tMs <= bMs || tMs % bMs !== 0) return null;
  const first = tOf(base[0]), last = tOf(base[base.length - 1]);
  const from = range && range.from > 0 ? range.from : null;
  if (from == null || first > from + bMs) return null;           // base starts after the ask: network
  const to = range && range.to > 0 ? range.to : Infinity;
  if (last + bMs < Math.min(to, Date.now()) - bMs) return null;  // base stops short of the ask
  const out = [];
  let cur = null, curKey = null;
  for (let i = 0; i < base.length; i++) {
    const b = base[i], t = tOf(b);
    if (t < from - tMs || t > to) continue;
    const key = Math.floor(t / tMs) * tMs;
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { open: b.open, high: b.high, low: b.low, close: b.close, volume: Number(b.volume) || 0, _start: t, _key: key };
      if (b.openTime != null) cur.openTime = key;
      if (b.time != null) cur.time = key;
      curKey = key;
    } else {
      if (b.high > cur.high) cur.high = b.high;
      if (b.low < cur.low) cur.low = b.low;
      cur.close = b.close; cur.volume += Number(b.volume) || 0;
    }
  }
  if (cur) out.push(cur);
  // the first bucket is partial when base started inside it: drop it (the network would give the full bar)
  if (out.length && out[0]._start > out[0]._key) out.shift();
  out.forEach((b) => { delete b._start; delete b._key; });
  return out.filter((b) => tOf(b) >= from - tMs);
}

export class SeriesCache {
  // opts: { maxBars, maxInflight, now }
  constructor(opts = {}){
    this.maxBars = opts.maxBars || 400000;
    this.maxInflight = opts.maxInflight || 5;
    this.now = opts.now || (() => Date.now());
    this.map = new Map();        // key sym|tf -> { from, to, bars, promise, fetchedAt }
    this.inflight = 0; this.queue = [];
    this.stats = { requests: 0, fetches: 0, hits: 0, fromBase: 0, tails: 0, maxParallel: 0 };
  }
  _total(){ let n = 0; this.map.forEach((e) => { n += e.bars ? e.bars.length : 0; }); return n; }
  _evict(keep){
    let total = this._total();
    for (const [k, e] of this.map) {
      if (total <= this.maxBars) break;
      if (k === keep || !e.bars) continue;
      total -= e.bars.length; this.map.delete(k);
    }
  }
  _run(fn){
    return new Promise((resolve, reject) => {
      const go = () => {
        this.inflight++; this.stats.maxParallel = Math.max(this.stats.maxParallel, this.inflight);
        Promise.resolve().then(fn).then(resolve, reject).finally(() => {
          this.inflight--; const nx = this.queue.shift(); if (nx) nx();
        });
      };
      if (this.inflight < this.maxInflight) go(); else this.queue.push(go);
    });
  }
  static slice(bars, range){
    if (!range || !(range.from > 0)) return bars;
    const to = range.to > 0 ? range.to : Infinity;
    return bars.filter((b) => { const t = tOf(b); return t >= range.from && t <= to; });
  }
  // base: { symbol, timeframe, bars } = the chart's own series (optional)
  // fetcher(symbol, timeframe, range) -> Promise<bars>
  async get(symbol, timeframe, range, fetcher, base){
    this.stats.requests++;
    const key = String(symbol).toLowerCase() + '|' + String(timeframe);
    const hasRange = range && range.from > 0;
    const e = this.map.get(key);
    if (e && hasRange && e.from <= range.from) {
      const tMs = tfToMs(timeframe) || 6e4;
      const reqTo = Math.min(range.to > 0 ? range.to : Infinity, this.now());
      const fresh = this.now() - (e.fetchedAt || 0) < 1500;
      if (reqTo <= e.to || fresh || (e.bars && e.bars.length && reqTo - tOf(e.bars[e.bars.length - 1]) < tMs)) {
        this.stats.hits++; this.map.delete(key); this.map.set(key, e);   // LRU touch
        const bars = e.bars || await e.promise;
        return SeriesCache.slice(bars, range);
      }
      if (e.bars) {   // held but ends earlier than asked: fetch only the new tail
        this.stats.tails++; this.stats.fetches++;
        const lastT = tOf(e.bars[e.bars.length - 1]);
        const prev = e;
        const tail = await this._run(() => fetcher(symbol, timeframe, Object.assign({}, range, { from: lastT })));
        const merged = prev.bars.filter((b) => tOf(b) < lastT).concat(tail || []);
        const ne = { from: prev.from, to: reqTo, bars: merged, fetchedAt: this.now() };
        this.map.delete(key); this.map.set(key, ne); this._evict(key);
        return SeriesCache.slice(merged, range);
      }
      this.stats.hits++;
      return SeriesCache.slice(await e.promise, range);   // in flight (covers it)
    }
    // futures 2h/4h bars follow the session open, not the epoch: only crypto-style symbols build those from base
    const alignOk = Number(timeframe) <= 60 || !/!|:/.test(String(symbol).replace(/^(binance|bybit|crypto):/i, ''));
    if (base && base.bars && hasRange && alignOk && String(base.symbol).toLowerCase() === String(symbol).toLowerCase()) {
      const agg = aggregateBars(base.bars, base.timeframe, timeframe, range);
      if (agg) {
        this.stats.fromBase++;
        this.map.delete(key); this.map.set(key, { from: range.from, to: Math.min(range.to > 0 ? range.to : Infinity, this.now()), bars: agg, fetchedAt: this.now() });
        this._evict(key);
        return agg;
      }
    }
    this.stats.fetches++;
    const entry = { from: hasRange ? range.from : Infinity, to: Math.min(range && range.to > 0 ? range.to : Infinity, this.now()), bars: null, fetchedAt: 0 };
    entry.promise = this._run(() => fetcher(symbol, timeframe, range)).then((bars) => {
      entry.bars = bars || []; entry.fetchedAt = this.now();
      if (!hasRange) this.map.delete(key);         // limit-only asks are not reusable
      else this._evict(key);
      return entry.bars;
    }, (err) => { if (this.map.get(key) === entry) this.map.delete(key); throw err; });
    if (hasRange) { this.map.delete(key); this.map.set(key, entry); }
    return entry.promise;
  }
}
