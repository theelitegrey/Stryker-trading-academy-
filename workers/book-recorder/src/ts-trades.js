// Tick-stream TRADE record for the "Big Trades (Tick-stream)" / "Delta (Tick-stream)" / "Cumulative Delta (Tick-stream)" indicators
// (Owner order 2026-11-02: "update the big trades indicator to use new data feed, I want to check the difference with tick stream").
// Kept apart from ts-hub.js on purpose: the hub only calls tb.add() per trade, tb.flush() per timer tick and tb.prune() with the book prune.
//
// Two things are recorded per symbol, 48 h (the hub's KEEP_H), in SQLite:
//   tstrade  one row per BIG candidate: every trade with size >= TS_BIG_FLOOR[sym] -> (ts_ms, price, size, side 1|-1). The chart applies
//            its own threshold (auto size x multiplier, min size) on top, so the floor only has to sit below any sensible threshold.
//   tsdelta  one row per symbol per minute from EVERY trade: buy volume, sell volume, running-delta high and low (the CVD candle wicks).
// Live big trades and live delta need nothing new: the hub's existing {type:'ticks'} frames already carry every trade (the chart filters).
// Time stamps are the hub's receive time (the same clock the tick frames use), so a stored print and the same print seen live match.
//
// Read: GET /ts-trades?sym=&from=&to= (ts-hub.js tsHubFetch, same admin gate as /ts-book-history), at most 6 h per read.
// Backfill: minutes with no tsdelta row (recorder was not running) are filled from Tick-stream REST /v1/history/ticks (5 y on our plan),
// serial requests, one window once (an empty minute gets an empty row), at most FILL_MAX_MIN minutes / FILL_BUDGET_MS per call, same cap
// as the book backfill (KEEP_H back, FILL_SPAN_H wide). The caller repeats while `left` > 0.
export const TS_BIG_FLOOR = { NQ: 5, ES: 20, MNQ: 20, MES: 50, YM: 5, RTY: 5, CL: 10, GC: 5 };
export const READ_H = 6;

export class TradeBook {
  // store = { putTrades(rows[[sym,ts,price,size,side]..]), putDeltas(rows[[sym,t,buy,sell,hi,lo]..]), trades(sym,from,to), deltas(sym,t0,t1), prune(ms) } | null (memory only)
  constructor(store, o = {}) {
    this.store = store; this.floor = o.floor || TS_BIG_FLOOR; this.clock = o.now || (() => Date.now());
    this.keepH = o.KEEP_H || 48; this.cur = new Map(); this.pendT = []; this.pendD = []; this.lastCur = 0;
    this.fillSpanH = o.FILL_SPAN_H || 6; this.fillMax = o.FILL_MAX_MIN || 60; this.fillBudget = o.FILL_BUDGET_MS || 25000;
    this.fillLag = o.FILL_LAG_MS || 2 * 60000; this.fillPause = 0; this.filling = false;
    this.rest = o.REST || 'https://api.tick-stream.xyz/v1'; this.doFetch = o.fetch || ((u, i) => fetch(u, i));
    this.n = { big: 0, trades: 0, filledMin: 0, filledTicks: 0 }; this.lastError = '';
  }
  add(sym, price, size, side, now) {
    const t = Math.floor(now / 60000);
    let c = this.cur.get(sym);
    if (c && c.t !== t) { this.pendD.push([sym, c.t, c.buy, c.sell, c.hi, c.lo]); c = null; }
    if (!c) { c = { t, buy: 0, sell: 0, run: 0, hi: 0, lo: 0, dirty: true }; this.cur.set(sym, c); }
    if (side > 0) c.buy += size; else c.sell += size;
    c.run += side * size; if (c.run > c.hi) c.hi = c.run; if (c.run < c.lo) c.lo = c.run; c.dirty = true;
    this.n.trades++;
    if (size >= (this.floor[sym] || Infinity)) { this.pendT.push([sym, now, price, size, side]); this.n.big++; }
  }
  // write what is waiting; the open minute is upserted at most every 5 s so a restart loses little
  flush(now = this.clock()) {
    if (!this.store) { this.pendT = []; this.pendD = []; return; }
    try {
      if (this.pendT.length) { const r = this.pendT; this.pendT = []; this.store.putTrades(r); }
      if (this.pendD.length) { const r = this.pendD; this.pendD = []; this.store.putDeltas(r); }
      if (now - this.lastCur >= 5000) {
        this.lastCur = now; const r = [];
        for (const [sym, c] of this.cur) if (c.dirty) { r.push([sym, c.t, c.buy, c.sell, c.hi, c.lo]); c.dirty = false; }
        if (r.length) this.store.putDeltas(r);
      }
    } catch (e) { this.lastError = 'store failed'; }
  }
  prune(now = this.clock()) { try { if (this.store) this.store.prune(now - this.keepH * 3600000); } catch (e) {} }
  // { trades: [[ts_ms, price, size, side]..], delta: [[t_ms, buy, sell, hi, lo]..] } for from..to (ms), at most READ_H hours back from `to`
  read(sym, from, to) {
    this.flush(to > this.clock() ? to : this.clock());
    to = Math.min(to, this.clock() + 60000); from = Math.max(from, to - READ_H * 3600000);
    const trades = this.store ? this.store.trades(sym, from, to) : [];
    const rows = new Map();
    if (this.store) for (const r of this.store.deltas(sym, Math.floor(from / 60000), Math.floor(to / 60000))) rows.set(r[0], r);
    const c = this.cur.get(sym); if (c) rows.set(c.t, [c.t, c.buy, c.sell, c.hi, c.lo]);   // the open minute, newest numbers
    const delta = [...rows.values()].sort((a, b) => a[0] - b[0]).map((r) => [r[0] * 60000, r[1], r[2], r[3], r[4]]);
    return { trades, delta };
  }
  // Fill minutes in [from, to] that have no tsdelta row from the REST archive. -> { filled (minutes), left (minutes still missing) }
  async backfill(sym, from, to, key) {
    if (!key || !this.store || !(sym in this.floor)) return { filled: 0, left: 0 };
    const nowMin = Math.floor(this.clock() / 60000), t1 = Math.min(Math.floor(to / 60000), nowMin - Math.ceil(this.fillLag / 60000));
    const t0 = Math.max(Math.floor(from / 60000), t1 - this.fillSpanH * 60, nowMin - this.keepH * 60);
    if (!(t1 > t0)) return { filled: 0, left: 0 };
    const have = new Set(this.store.deltas(sym, t0, t1).map((r) => r[0]));
    const cur = this.cur.get(sym); if (cur) have.add(cur.t);
    const missing = []; for (let t = t1; t >= t0; t--) if (!have.has(t)) missing.push(t);
    if (!missing.length) return { filled: 0, left: 0 };
    if (this.filling || this.clock() < this.fillPause) return { filled: 0, left: missing.length };
    this.filling = true;
    const start = this.clock(); let filled = 0;
    try {
      const groups = new Map();   // 10-minute windows, newest first
      for (const t of missing) { const g = Math.floor(t / 10); (groups.get(g) || groups.set(g, []).get(g)).push(t); }
      for (const [, mins] of groups) {
        if (filled >= this.fillMax || this.clock() - start > this.fillBudget) break;
        mins.sort((x, y) => x - y);
        const want = new Set(mins), ticks = [];
        let s = mins[0] * 60;
        const e = mins[mins.length - 1] * 60 + 60;
        let ok = true;
        for (let page = 0; page < 8 && ok; page++) {
          let r;
          try { r = await this.doFetch(this.rest + '/history/ticks?symbol=' + sym + '&start=' + s + '&end=' + e + '&limit=100000', { headers: { authorization: 'Bearer ' + key } }); }
          catch (x) { this.fillPause = this.clock() + 60000; this.lastError = 'trade fill fetch'; ok = false; break; }
          if (r.status === 429 || r.status >= 500) { this.fillPause = this.clock() + 60000; this.lastError = 'trade fill http ' + r.status; ok = false; break; }
          if (r.status === 401 || r.status === 403) { this.fillPause = this.clock() + 300000; this.lastError = 'trade fill auth'; ok = false; break; }
          let j = null; try { j = await r.json(); } catch (x) {}
          const rows = j && Array.isArray(j.ticks) ? j.ticks : [];
          const last = ticks.length ? ticks[ticks.length - 1][0] : -1;
          for (const x of rows) if (x.ts > last) ticks.push([x.ts, Number(x.price), Number(x.size), x.side === 'buy' ? 1 : x.side === 'sell' ? -1 : 0]);   // shortcut: ties on a page edge (same microsecond) are dropped
          if (!(j && j.truncated && rows.length)) break;
          s = Math.floor(rows[rows.length - 1].ts / 1e6);
        }
        if (!ok) break;
        const acc = new Map(), big = [], fl = this.floor[sym];
        for (const [ts, price, size, side] of ticks) {
          if (!side || !(price > 0) || !(size > 0)) continue;
          const t = Math.floor(ts / 6e7);
          if (!want.has(t)) continue;
          let c = acc.get(t); if (!c) { c = { buy: 0, sell: 0, run: 0, hi: 0, lo: 0 }; acc.set(t, c); }
          if (side > 0) c.buy += size; else c.sell += size;
          c.run += side * size; if (c.run > c.hi) c.hi = c.run; if (c.run < c.lo) c.lo = c.run;
          if (size >= fl) big.push([sym, Math.floor(ts / 1000), price, size, side]);
        }
        try {
          if (big.length) this.store.putTrades(big);
          this.store.putDeltas(mins.map((t) => { const c = acc.get(t) || { buy: 0, sell: 0, hi: 0, lo: 0 }; return [sym, t, c.buy, c.sell, c.hi, c.lo]; }));   // an empty minute gets an empty row: asked once
        } catch (x) { this.lastError = 'store failed'; break; }
        filled += mins.length; this.n.filledMin += mins.length; this.n.filledTicks += ticks.length;
      }
    } finally { this.filling = false; }
    return { filled, left: Math.max(0, missing.length - filled) };
  }
}

export function tradeStore(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS tstrade (sym TEXT NOT NULL, ts INTEGER NOT NULL, price REAL NOT NULL, size REAL NOT NULL, side INTEGER NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS tstrade_ix ON tstrade (sym, ts)');
  sql.exec('CREATE TABLE IF NOT EXISTS tsdelta (sym TEXT NOT NULL, t INTEGER NOT NULL, buy REAL NOT NULL, sell REAL NOT NULL, hi REAL NOT NULL, lo REAL NOT NULL, PRIMARY KEY (sym, t)) WITHOUT ROWID');
  return {
    putTrades(rows) { for (const r of rows) sql.exec('INSERT INTO tstrade (sym, ts, price, size, side) VALUES (?, ?, ?, ?, ?)', ...r); },
    putDeltas(rows) { for (const r of rows) sql.exec('INSERT OR REPLACE INTO tsdelta (sym, t, buy, sell, hi, lo) VALUES (?, ?, ?, ?, ?, ?)', ...r); },
    trades(sym, from, to) { return sql.exec('SELECT ts, price, size, side FROM tstrade WHERE sym = ? AND ts >= ? AND ts <= ? ORDER BY ts', sym, from, to).toArray().map((r) => [r.ts, r.price, r.size, r.side]); },
    deltas(sym, t0, t1) { return sql.exec('SELECT t, buy, sell, hi, lo FROM tsdelta WHERE sym = ? AND t >= ? AND t <= ? ORDER BY t', sym, t0, t1).toArray().map((r) => [r.t, r.buy, r.sell, r.hi, r.lo]); },
    prune(ms) { sql.exec('DELETE FROM tstrade WHERE ts < ?', ms); sql.exec('DELETE FROM tsdelta WHERE t < ?', Math.floor(ms / 60000)); }
  };
}
