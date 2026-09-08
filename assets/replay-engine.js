/**
 * Stryker Trading Academy — Backtest replay engine (pure logic, no DOM)
 *
 * Everything the replay page needs that is NOT drawing pixels: timeframe
 * resampling with a forming last candle, an order simulator (market / limit /
 * stop entries, stop-loss and take-profit exits, commission and slippage),
 * an account with balance / equity / equity curve, and trade statistics.
 *
 * The same file runs in Node for tests (module.exports) and in the browser
 * (window.ReplayEngine). Keep it free of browser globals.
 *
 * Bar shape everywhere: { t: openTimeMs, o, h, l, c, v }
 *
 * FILL MODEL (deliberately conservative — a backtest that flatters you is
 * worse than none):
 *   - Market orders fill at the last visible close, plus `slippage` ticks
 *     against you.
 *   - Limit / stop orders fill on the first later bar whose range touches the
 *     price; if the bar GAPS through the price, the fill is the bar's open
 *     (worse than the order price), never the order price.
 *   - Stop-loss / take-profit are checked on every new bar against its high
 *     and low. If the same bar touches both, the stop-loss is assumed to have
 *     hit first (`ambiguous: 'sl'`), because intra-bar order is unknown.
 *   - A position opened by a pending order is checked against that same bar's
 *     stop / target too.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ReplayEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const TF = {
    '1m': MIN, '3m': 3 * MIN, '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN,
    '1h': HOUR, '2h': 2 * HOUR, '4h': 4 * HOUR, '1D': DAY, '1W': 7 * DAY
  };
  const TF_ORDER = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W'];

  // Bucket start for a timestamp. Weeks are aligned to Monday 00:00 UTC
  // (the epoch was a Thursday, so plain floor() would start weeks on Thursday).
  function bucketOf(t, tfMs) {
    if (tfMs === 7 * DAY) return Math.floor((t + 3 * DAY) / tfMs) * tfMs - 3 * DAY;
    return Math.floor(t / tfMs) * tfMs;
  }

  // Full resample of a base series into tfMs candles, plus the bookkeeping the
  // replay needs to show a FORMING last candle: which base index each candle
  // starts at, and which candle each base bar belongs to.
  function resampleAll(base, tfMs) {
    const agg = [], startIdx = [], aggIndexOfBase = new Int32Array(base.length);
    let cur = null, bucket = NaN;
    for (let i = 0; i < base.length; i++) {
      const b = base[i];
      const bk = bucketOf(b.t, tfMs);
      if (bk !== bucket) {
        bucket = bk;
        cur = { t: bk, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 };
        agg.push(cur); startIdx.push(i);
      } else {
        if (b.h > cur.h) cur.h = b.h;
        if (b.l < cur.l) cur.l = b.l;
        cur.c = b.c; cur.v += b.v || 0;
      }
      aggIndexOfBase[i] = agg.length - 1;
    }
    return { agg, startIdx, aggIndexOfBase };
  }

  // A Series wraps the base bars and hands out timeframe "views" for a cursor
  // (the index of the last visible base bar). A view is { n, bars, last }:
  // bars[0..n-2] are complete candles, `last` is the forming one.
  class Series {
    constructor(base, baseTf) {
      if (!Array.isArray(base) || !base.length) throw new Error('Series needs at least one bar');
      this.base = base;
      this.baseTf = baseTf;
      this.baseTfMs = TF[baseTf] || inferTfMs(base);
      this.cache = {};
    }
    get length() { return this.base.length; }
    availableTimeframes() {
      return TF_ORDER.filter((tf) => TF[tf] >= this.baseTfMs && TF[tf] % this.baseTfMs === 0);
    }
    view(tf, cursor) {
      const tfMs = TF[tf];
      if (!tfMs) throw new Error('Unknown timeframe ' + tf);
      cursor = Math.max(0, Math.min(this.base.length - 1, cursor | 0));
      const r = this.cache[tf] || (this.cache[tf] = resampleAll(this.base, tfMs));
      const k = r.aggIndexOfBase[cursor];
      const s = r.startIdx[k];
      const first = this.base[s];
      const last = { t: r.agg[k].t, o: first.o, h: first.h, l: first.l, c: first.c, v: 0 };
      for (let i = s; i <= cursor; i++) {
        const b = this.base[i];
        if (b.h > last.h) last.h = b.h;
        if (b.l < last.l) last.l = b.l;
        last.c = b.c; last.v += b.v || 0;
      }
      return { n: k + 1, bars: r.agg, last, tfMs, tf, complete: cursor === this.base.length - 1 || r.aggIndexOfBase[cursor + 1] !== k };
    }
    // Largest base index whose open time <= t (binary search).
    indexAt(t) {
      const b = this.base; let lo = 0, hi = b.length - 1;
      if (t < b[0].t) return -1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b[mid].t <= t) lo = mid; else hi = mid - 1; }
      return lo;
    }
  }

  function inferTfMs(base) {
    const gaps = {};
    for (let i = 1; i < Math.min(base.length, 400); i++) {
      const g = base[i].t - base[i - 1].t; if (g > 0) gaps[g] = (gaps[g] || 0) + 1;
    }
    let best = MIN, n = -1;
    for (const g in gaps) if (gaps[g] > n) { n = gaps[g]; best = Number(g); }
    return best;
  }

  // ---- order simulator -------------------------------------------------------

  function roundTick(p, tick) {
    if (!tick) return p;
    const inv = 1 / tick;
    return Math.round(p * inv) / inv;
  }

  class Simulator {
    /**
     * spec: { symbol, pointValue, tick, decimals, commission (per unit per side, $), slippage (ticks), lotStep }
     * opts: { balance, ambiguous: 'sl'|'tp' }
     */
    constructor(spec, opts) {
      opts = opts || {};
      this.spec = Object.assign({ pointValue: 1, tick: 0.01, decimals: 2, commission: 0, slippage: 0, lotStep: 1 }, spec || {});
      this.startBalance = Number(opts.balance) > 0 ? Number(opts.balance) : 100000;
      this.balance = this.startBalance;
      this.ambiguous = opts.ambiguous === 'tp' ? 'tp' : 'sl';
      this.positions = [];
      this.pending = [];
      this.trades = [];
      this.equity = [];      // { t, equity, balance }
      this.log = [];         // human-readable event log
      this.nextId = 1;
      this.bar = null; this.idx = -1;
    }

    // ---- state helpers ----
    setBar(bar, idx) { this.bar = bar; this.idx = idx; }
    price() { return this.bar ? this.bar.c : NaN; }
    openPnl(p, price) {
      const px = price == null ? this.price() : price;
      return (px - p.entry) * p.size * this.spec.pointValue * (p.side === 'buy' ? 1 : -1);
    }
    equityValue(price) {
      let e = this.balance;
      for (const p of this.positions) e += this.openPnl(p, price);
      return e;
    }
    snapshot() {
      return {
        balance: this.balance, startBalance: this.startBalance, ambiguous: this.ambiguous,
        positions: this.positions, pending: this.pending, trades: this.trades,
        equity: this.equity, nextId: this.nextId, log: this.log.slice(-200)
      };
    }
    static fromSnapshot(spec, snap) {
      const s = new Simulator(spec, { balance: snap.startBalance, ambiguous: snap.ambiguous });
      s.balance = snap.balance;
      s.positions = snap.positions || []; s.pending = snap.pending || [];
      s.trades = snap.trades || []; s.equity = snap.equity || []; s.nextId = snap.nextId || (s.trades.length + s.positions.length + s.pending.length + 1);
      s.log = snap.log || [];
      return s;
    }

    // ---- orders ----
    /**
     * o: { side: 'buy'|'sell', type: 'market'|'limit'|'stop', price, size, sl, tp, comment }
     * Returns the position (market) or pending order (limit/stop). Throws on invalid input.
     */
    submit(o) {
      if (!this.bar) throw new Error('No market data yet');
      const side = o.side === 'sell' ? 'sell' : 'buy';
      const type = o.type === 'limit' || o.type === 'stop' ? o.type : 'market';
      const size = Number(o.size);
      if (!(size > 0)) throw new Error('Size must be greater than zero');
      const sl = o.sl != null && o.sl !== '' ? Number(o.sl) : null;
      const tp = o.tp != null && o.tp !== '' ? Number(o.tp) : null;
      const dir = side === 'buy' ? 1 : -1;
      const ref = type === 'market' ? this.price() : Number(o.price);
      if (type !== 'market' && !(ref > 0)) throw new Error('Enter an order price');
      if (sl != null && !((sl - ref) * dir < 0)) throw new Error(side === 'buy' ? 'Stop-loss must be below the entry' : 'Stop-loss must be above the entry');
      if (tp != null && !((tp - ref) * dir > 0)) throw new Error(side === 'buy' ? 'Take-profit must be above the entry' : 'Take-profit must be below the entry');
      if (type === 'limit' && !((ref - this.price()) * dir < 0)) throw new Error(side === 'buy' ? 'A buy limit must sit below the current price' : 'A sell limit must sit above the current price');
      if (type === 'stop' && !((ref - this.price()) * dir > 0)) throw new Error(side === 'buy' ? 'A buy stop must sit above the current price' : 'A sell stop must sit below the current price');

      if (type === 'market') {
        const fill = roundTick(this.price() + dir * this.spec.slippage * this.spec.tick, this.spec.tick);
        return this._open({ side, size, sl, tp, comment: o.comment || '', type }, fill, this.bar.t, this.idx);
      }
      const order = { id: this.nextId++, side, type, price: roundTick(ref, this.spec.tick), size, sl, tp, comment: o.comment || '', t: this.bar.t, idx: this.idx };
      this.pending.push(order);
      this._log(order.t, `${side.toUpperCase()} ${type} ${size} @ ${order.price} placed`);
      return order;
    }
    cancel(orderId) {
      const i = this.pending.findIndex((o) => o.id === orderId);
      if (i < 0) return false;
      const o = this.pending.splice(i, 1)[0];
      this._log(this.bar ? this.bar.t : o.t, `Order #${o.id} cancelled`);
      return true;
    }
    modifyOrder(orderId, changes) {
      const o = this.pending.find((x) => x.id === orderId);
      if (!o) return null;
      if (changes.price != null) o.price = roundTick(Number(changes.price), this.spec.tick);
      if ('sl' in changes) o.sl = changes.sl === null || changes.sl === '' ? null : Number(changes.sl);
      if ('tp' in changes) o.tp = changes.tp === null || changes.tp === '' ? null : Number(changes.tp);
      return o;
    }
    modifyPosition(posId, changes) {
      const p = this.positions.find((x) => x.id === posId);
      if (!p) return null;
      const dir = p.side === 'buy' ? 1 : -1;
      if ('sl' in changes) {
        const sl = changes.sl === null || changes.sl === '' ? null : roundTick(Number(changes.sl), this.spec.tick);
        if (sl != null && !((sl - this.price()) * dir < 0)) throw new Error('Stop-loss must be on the losing side of the current price');
        p.sl = sl;
      }
      if ('tp' in changes) {
        const tp = changes.tp === null || changes.tp === '' ? null : roundTick(Number(changes.tp), this.spec.tick);
        if (tp != null && !((tp - this.price()) * dir > 0)) throw new Error('Take-profit must be on the winning side of the current price');
        p.tp = tp;
      }
      return p;
    }
    close(posId, sizePart) {
      const p = this.positions.find((x) => x.id === posId);
      if (!p) return null;
      const dir = p.side === 'buy' ? 1 : -1;
      const fill = roundTick(this.price() - dir * this.spec.slippage * this.spec.tick, this.spec.tick);
      const part = sizePart != null && Number(sizePart) > 0 && Number(sizePart) < p.size ? Number(sizePart) : null;
      return this._close(p, fill, this.bar.t, this.idx, 'manual', part);
    }
    closeAll() { for (const p of this.positions.slice()) this.close(p.id); }
    reverse(posId) {
      const p = this.positions.find((x) => x.id === posId);
      if (!p) return null;
      const side = p.side === 'buy' ? 'sell' : 'buy'; const size = p.size;
      this.close(posId);
      return this.submit({ side, type: 'market', size });
    }

    // ---- bar advance ----
    onBar(bar, idx) {
      this.bar = bar; this.idx = idx;
      // 1) pending entries
      for (const o of this.pending.slice()) {
        const fp = this._fillPrice(o, bar);
        if (fp == null) continue;
        this.pending.splice(this.pending.indexOf(o), 1);
        this._open(o, fp, bar.t, idx, true);
      }
      // 2) exits (includes positions just opened above — same bar can hit the stop)
      for (const p of this.positions.slice()) {
        const ex = this._exitCheck(p, bar);
        if (ex) { this._close(p, ex.price, bar.t, idx, ex.reason); continue; }
        const dir = p.side === 'buy' ? 1 : -1;
        const fav = (dir > 0 ? bar.h - p.entry : p.entry - bar.l) * p.size * this.spec.pointValue;
        const adv = (dir > 0 ? p.entry - bar.l : bar.h - p.entry) * p.size * this.spec.pointValue;
        if (fav > p.mfe) p.mfe = fav;
        if (adv > p.mae) p.mae = adv;
        p.bars++;
      }
      // 3) equity point
      this.equity.push({ t: bar.t, equity: round2(this.equityValue()), balance: round2(this.balance) });
    }

    _fillPrice(o, bar) {
      const p = o.price;
      if (o.type === 'limit') {
        if (o.side === 'buy') { if (bar.l <= p) return bar.o < p ? bar.o : p; }
        else { if (bar.h >= p) return bar.o > p ? bar.o : p; }
      } else if (o.type === 'stop') {
        if (o.side === 'buy') { if (bar.h >= p) return bar.o > p ? bar.o : p; }
        else { if (bar.l <= p) return bar.o < p ? bar.o : p; }
      }
      return null;
    }
    _exitCheck(p, bar) {
      const dir = p.side === 'buy' ? 1 : -1;
      const slHit = p.sl != null && (dir > 0 ? bar.l <= p.sl : bar.h >= p.sl);
      const tpHit = p.tp != null && (dir > 0 ? bar.h >= p.tp : bar.l <= p.tp);
      if (!slHit && !tpHit) return null;
      const useSl = slHit && (!tpHit || this.ambiguous === 'sl');
      if (useSl) {
        // gap through the stop → fill at the open, not the stop
        const gapped = dir > 0 ? bar.o < p.sl : bar.o > p.sl;
        return { price: gapped ? bar.o : p.sl, reason: 'sl' };
      }
      const gapped = dir > 0 ? bar.o > p.tp : bar.o < p.tp;
      return { price: gapped ? bar.o : p.tp, reason: 'tp' };
    }
    _open(o, fill, t, idx, fromPending) {
      const pos = {
        id: fromPending ? o.id : this.nextId++, side: o.side, size: o.size, entry: fill, entryT: t, entryIdx: idx,
        sl: o.sl != null ? roundTick(o.sl, this.spec.tick) : null, tp: o.tp != null ? roundTick(o.tp, this.spec.tick) : null,
        sl0: o.sl != null ? o.sl : null, comment: o.comment || '', type: o.type || 'market', mfe: 0, mae: 0, bars: 0
      };
      const fee = this.spec.commission * o.size;
      this.balance -= fee; pos.fees = fee;
      this.positions.push(pos);
      this._log(t, `${pos.side.toUpperCase()} ${pos.size} filled @ ${fill}${pos.type !== 'market' ? ' (' + pos.type + ')' : ''}`);
      return pos;
    }
    _close(p, fill, t, idx, reason, partSize) {
      const size = partSize || p.size;
      const dir = p.side === 'buy' ? 1 : -1;
      const gross = (fill - p.entry) * size * this.spec.pointValue * dir;
      const fee = this.spec.commission * size;
      const feesIn = partSize ? p.fees * (size / p.size) : p.fees;
      const pnl = gross - fee - feesIn;
      this.balance += gross - fee;
      const risk = p.sl0 != null ? Math.abs(p.entry - p.sl0) * size * this.spec.pointValue : 0;
      const trade = {
        id: this.nextId++, posId: p.id, symbol: this.spec.symbol || '', side: p.side, size, entry: p.entry, entryT: p.entryT, entryIdx: p.entryIdx,
        exit: fill, exitT: t, exitIdx: idx, gross: round2(gross), fees: round2(fee + feesIn), pnl: round2(pnl),
        r: risk > 0 ? round2(pnl / risk) : null, risk: round2(risk), mfe: round2(p.mfe), mae: round2(p.mae), bars: p.bars, reason, comment: p.comment, sl: p.sl0, tp: p.tp
      };
      this.trades.push(trade);
      if (partSize) { p.size -= size; p.fees -= feesIn; }
      else this.positions.splice(this.positions.indexOf(p), 1);
      this._log(t, `${p.side.toUpperCase()} ${size} closed @ ${fill} (${reason}) ${pnl >= 0 ? '+' : ''}${round2(pnl)}`);
      return trade;
    }
    _log(t, msg) { this.log.push({ t, msg }); if (this.log.length > 500) this.log.splice(0, this.log.length - 500); }
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // ---- statistics ------------------------------------------------------------

  function stats(trades, equity, startBalance) {
    const s = {
      count: trades.length, wins: 0, losses: 0, breakeven: 0, winRate: 0, net: 0, grossProfit: 0, grossLoss: 0, fees: 0,
      profitFactor: null, avgWin: 0, avgLoss: 0, expectancy: 0, avgR: null, best: 0, worst: 0, maxDD: 0, maxDDPct: 0,
      maxWinStreak: 0, maxLossStreak: 0, avgBars: 0, longs: 0, shorts: 0, longNet: 0, shortNet: 0, returnPct: 0
    };
    let wsum = 0, lsum = 0, rsum = 0, rn = 0, bars = 0, ws = 0, ls = 0;
    for (const t of trades) {
      s.net += t.pnl; s.fees += t.fees || 0; bars += t.bars || 0;
      if (t.side === 'buy') { s.longs++; s.longNet += t.pnl; } else { s.shorts++; s.shortNet += t.pnl; }
      if (t.pnl > 0) { s.wins++; wsum += t.pnl; s.grossProfit += t.pnl; ws++; ls = 0; if (ws > s.maxWinStreak) s.maxWinStreak = ws; }
      else if (t.pnl < 0) { s.losses++; lsum += t.pnl; s.grossLoss += -t.pnl; ls++; ws = 0; if (ls > s.maxLossStreak) s.maxLossStreak = ls; }
      else { s.breakeven++; ws = 0; ls = 0; }
      if (t.pnl > s.best) s.best = t.pnl;
      if (t.pnl < s.worst) s.worst = t.pnl;
      if (t.r != null) { rsum += t.r; rn++; }
    }
    if (s.count) {
      s.winRate = round2(100 * s.wins / s.count);
      s.expectancy = round2(s.net / s.count);
      s.avgBars = Math.round(bars / s.count);
    }
    if (s.wins) s.avgWin = round2(wsum / s.wins);
    if (s.losses) s.avgLoss = round2(lsum / s.losses);
    if (s.grossLoss > 0) s.profitFactor = round2(s.grossProfit / s.grossLoss);
    else if (s.grossProfit > 0) s.profitFactor = Infinity;
    if (rn) s.avgR = round2(rsum / rn);
    // max drawdown on the equity curve (falls back to closed-trade balance path)
    let peak = startBalance || 0, dd = 0, ddPct = 0;
    const path = (equity && equity.length) ? equity.map((e) => e.equity) : (function () {
      let b = startBalance || 0; return trades.map((t) => (b += t.pnl));
    })();
    for (const v of path) {
      if (v > peak) peak = v;
      const d = peak - v;
      if (d > dd) { dd = d; ddPct = peak > 0 ? 100 * d / peak : 0; }
    }
    s.maxDD = round2(dd); s.maxDDPct = round2(ddPct);
    s.net = round2(s.net); s.grossProfit = round2(s.grossProfit); s.grossLoss = round2(s.grossLoss);
    s.longNet = round2(s.longNet); s.shortNet = round2(s.shortNet); s.fees = round2(s.fees);
    if (startBalance > 0) s.returnPct = round2(100 * s.net / startBalance);
    return s;
  }

  // Position size from a risk budget. Returns 0 when the stop distance is zero.
  function riskSize(opts) {
    const dist = Math.abs(Number(opts.entry) - Number(opts.sl));
    const pv = Number(opts.pointValue) || 1;
    const step = Number(opts.lotStep) || 1;
    const riskCash = opts.riskCash != null ? Number(opts.riskCash) : Number(opts.balance) * Number(opts.riskPct) / 100;
    if (!(dist > 0) || !(riskCash > 0)) return 0;
    const raw = riskCash / (dist * pv);
    const size = Math.floor(raw / step + 1e-9) * step;
    return Number(size.toFixed(6));
  }

  return { TF, TF_ORDER, bucketOf, resampleAll, Series, Simulator, stats, riskSize, roundTick };
});
