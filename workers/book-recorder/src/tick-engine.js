// TICK ENGINE (Owner order 2026-11-05: "save tick by tick, sec by sec trade data received from provider to a dedicated
// engine"). Every trade of every TE symbol is stored, the chart builds ALL its futures candles from this one record, and the
// browser gets the live trades with a per-symbol sequence number so a snapshot + the live stream join with no gap and no
// double count. Lives in the BookRecorder Durable Object next to the hub (src/ts-hub.js), because every trade already
// arrives there: a sibling DO would need a subrequest per batch and one more hop of latency for nothing. Storage stays far
// under the 10 GB per-DO limit (numbers in the handback / README).
//
// SQLite, one row per symbol per MINUTE (rows written are billed, so never a row per trade or per second):
//   tkraw (sym, t, ticks BLOB)                     every trade of the minute, packed (tick-codec.js)     KEEP_H (48 h)
//   tksec (sym, t, secs BLOB)                      the minute's 1-second OHLCV + buy volume, packed      SEC_DAYS (30 d)
//   tkm1  (sym, t, o, h, l, c, v, b, n, src)       the minute's OHLCV (src 1 live, 2 live partial, 3 archive)   M1_DAYS (400 d)
//   tkh1  (sym, t, o, h, l, c, v, b)               hour roll-up of tkm1, built lazily on read            M1_DAYS
//   tkspan(id, sym, t0, t1, kind)                  minutes [t0, t1) known complete: sym '*' = the live socket was up
//                                                  the whole minute (kind 1), else an archive fill of that sym (kind 3)
//   tkmeta(sym, rec)                               rec = first minute from which the record has no holes
// The forming minute is kept in memory and written once, when it closes (+ GRACE_MS for late prints). A Durable Object
// restart loses at most that minute; it is outside every live span, so the gap filler fetches it from the archive.
//
// GAP FILL: every FILL_EVERY_MS the engine lists, per symbol, the CME-hours minutes of the last KEEP_H that are in no span,
// and fetches them from the provider's REST tick archive, serial, at most FILL_BUDGET_MS per run, newest first, FILL_WIN_MIN
// minutes a request, never minutes younger than FILL_LAG_MS (the archive runs ~3 min behind). Each window becomes a kind-3 span,
// so an empty window (holiday, quiet contract) is asked once.
//
// SEQUENCE: seq counts the trades of one symbol since this Durable Object started (epoch). The bars read returns the seq of the
// newest trade it includes (q); the socket sends trades with their seq; the browser keeps only seq > q. A reconnect sends
// since=<last seq seen> and gets the missing trades from memory (the forming minute + REPLAY_MIN closed minutes). Anything
// older, or another epoch, is answered 'resync' and the browser re-reads the bars.
import { packTicks, unpackTicks, secsOf, packSecs, unpackSecs, tfSpec, aggregate, bucketOf, sessionOpen } from './tick-codec.js';

// Owner 2026-11-03 list minus the five trades-only roots the feed sends nothing for (SIL ZB HG MHG MCL: 0 trades in the archive on
// 2026-11-04 at 09:30, 10:30 and 14:00 ET and in the last 30 min of 2026-11-05). They stay on the old bars. Env TE_SYMBOLS overrides.
export const TE_SYMBOLS = ['NQ', 'ES', 'MNQ', 'MES', 'YM', 'RTY', 'CL', 'GC', 'SI', 'ZN', '6E', 'MGC', 'MYM', 'M2K'];
export const TE_DEF = {
  ON: true, KEEP_H: 48, SEC_DAYS: 30, M1_DAYS: 400, GRACE_MS: 3000, REPLAY_MIN: 5, FILL_LAG_MS: 10 * 60000, FILL_EVERY_MS: 30000, FILL_BUDGET_MS: 20000,
  FILL_WIN_MIN: 10, FILL_PAUSE_MS: 60000, AUTH_PAUSE_MS: 300000, PRUNE_MS: 3600000, PAGES: 12, PAGE_LIMIT: 100000,
  REST: 'https://api.tick-stream.xyz/v1', READ_SEC_MIN: 360, READ_M1_MIN: 15000, READ_H1: 20000, DELAY_MS: 600000,
  // ON-DEMAND HISTORY (Owner bug 2026-11-05 "on ticks and seconds, old candles not showing"): a live-lane read of seconds or tick bars
  // older than the record (or over a hole) first fetches those minutes from the archive (serial, ENSURE_BUDGET_MS a request,
  // ENSURE_WIN_MIN minutes a call, newest first) and stores them like the gap filler does; what is not done in time is answered `more`.
  ENSURE_BUDGET_MS: 8000, ENSURE_WIN_MIN: 60, TICK_MAX_TRADES: 600000
};
// tick timeframe '100T' -> 100 (1..5000), else 0
export const tickN = (tf) => { const m = /^(\d+)T$/i.exec(String(tf || '')); const n = m ? +m[1] : 0; return n >= 1 && n <= 5000 ? n : 0; };
const MIN = 60000;

export function teOpts(env) {
  const n = (v, d, lo, hi) => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x >= lo && x <= hi ? x : d; };
  const syms = String((env && env.TE_SYMBOLS) || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return { SYMBOLS: syms.length ? syms : TE_SYMBOLS, ON: !env || env.TE_RECORD !== '0', KEEP_H: n(env && env.TE_KEEP_HOURS, 48, 24, 96), SEC_DAYS: n(env && env.TE_SEC_DAYS, 30, 1, 60), M1_DAYS: n(env && env.TE_M1_DAYS, 400, 30, 1900) };
}

// The cut for a visitor without a live tier: nothing at or after the whole minute 10 min ago. The SERVER applies it.
export const delayCut = (now, delayMs = TE_DEF.DELAY_MS) => Math.floor((now - delayMs) / MIN) * MIN;

export class TickEngine {
  // store: teStore(sql) or a memory double with the same methods. o: TE_DEF overrides + { SYMBOLS, now, fetch, key, open(ms) }
  constructor(store, o = {}) {
    this.st = store; this.o = Object.assign({}, TE_DEF, o); this.clock = o.now || (() => Date.now());
    this.syms = new Set(this.o.SYMBOLS || TE_SYMBOLS); this.open = o.open || (() => true);
    this.epoch = this.clock(); this.S = new Map(); this.upAt = 0; this.spanId = 0; this.lastPrune = 0; this.nextFill = this.clock() + 5000;
    this.filling = false; this.fillPause = 0; this.lastError = ''; this.ensureWaiting = 0;
    this.n = { trades: 0, minutes: 0, partial: 0, filledMin: 0, filledTrades: 0, fillReq: 0, rows: 0, late: 0, ensureReq: 0, ensureMin: 0 };
    this.spans = []; this.rec = new Map();
    try { this.spans = store.spans(); for (const [s, r] of store.metas()) this.rec.set(s, r); } catch (e) { this.lastError = 'load failed'; }
  }
  has(sym) { return this.syms.has(sym); }
  symState(sym) {
    let s = this.S.get(sym);
    if (!s) { s = { seq: 0, lastTs: 0, cur: null, recent: [], closedT: -1 }; this.S.set(sym, s); }
    return s;
  }
  // ---- live input (the hub calls these)
  // upstream socket state: open + first data = up (live span starts at the next whole minute), any close = down
  up(now = this.clock()) { if (!this.upAt) { this.upAt = now; this.spanId = 0; } }
  down() { this.upAt = 0; this.spanId = 0; }
  // one trade. exchS = the provider's time stamp (unix seconds), recv = our receive time (ms). The stored time is the receive
  // time held inside the exchange second (the feed has no sub-second stamp), never going backwards for a symbol.
  add(sym, price, size, side, exchS, recv = this.clock()) {
    if (!this.o.ON || !this.syms.has(sym) || !(price > 0) || !(size > 0) || !side) return;
    const s = this.symState(sym);
    let ts = recv;
    if (Number.isFinite(exchS) && exchS > 1e9) { const a = exchS * 1000; ts = Math.min(Math.max(recv, a), a + 999); }
    if (ts < s.lastTs) ts = s.lastTs;   // never backwards: a print stamped before the last one joins the last one's time
    if (Math.floor(ts / MIN) <= s.closedT) { ts = (s.closedT + 1) * MIN; this.n.late++; }   // its minute is already written: it opens the next one
    if (s.cur && Math.floor(ts / MIN) !== s.cur.t) this.close(sym, s);
    if (!s.cur) s.cur = { t: Math.floor(ts / MIN), seq0: s.seq + 1, ticks: [], upAt: this.upAt };
    s.seq++; s.lastTs = ts; this.n.trades++;
    s.cur.ticks.push([ts, price, size, side > 0 ? 1 : -1]);
  }
  // timer (the hub's 250 ms tick): close minutes past their grace, keep the live span, fill, prune
  tick(now = this.clock()) {
    for (const [sym, s] of this.S) if (s.cur && now >= (s.cur.t + 1) * MIN + this.o.GRACE_MS) this.close(sym, s);
    if (this.upAt) this.liveSpan(now);
    if (now >= this.nextFill && !this.filling) {
      this.nextFill = now + this.o.FILL_EVERY_MS;
      this.refreshRec(now);
      if (this.o.key) this.fill().catch(() => { this.lastError = 'fill crashed'; });
    }
    if (now - this.lastPrune > this.o.PRUNE_MS) { this.lastPrune = now; this.prune(now); }
  }
  // live span: minutes [first whole minute after up, last whole minute before now - grace) were all seen live
  liveSpan(now) {
    const t0 = Math.ceil((this.upAt + 1000) / MIN), t1 = Math.floor((now - this.o.GRACE_MS) / MIN);
    if (t1 <= t0) return;
    if (this.spanId && this.spanT1 === t1) return;
    try {
      if (!this.spanId) { this.spanId = this.st.addSpan('*', t0, t1, 1); this.spans.push({ id: this.spanId, sym: '*', t0, t1, kind: 1 }); }
      else { this.st.setSpanEnd(this.spanId, t1); const sp = this.spans.find((x) => x.id === this.spanId); if (sp) sp.t1 = t1; }
      this.spanT1 = t1;
    } catch (e) { this.lastError = 'span write failed'; }
  }
  close(sym, s) {
    const c = s.cur; s.cur = null; if (!c || !c.ticks.length) return;
    s.closedT = c.t;
    const blob = packTicks(sym, c.t * MIN, c.ticks);
    s.recent.push({ t: c.t, seq0: c.seq0, n: c.ticks.length, blob });
    while (s.recent.length > this.o.REPLAY_MIN) s.recent.shift();
    const full = !!(c.upAt && this.upAt === c.upAt && c.upAt <= c.t * MIN - 1000);
    if (!full) this.n.partial++;
    this.writeMinute(sym, c.t, c.ticks, full ? 1 : 2, blob);
    this.n.minutes++;
  }
  writeMinute(sym, t, ticks, src, blob) {
    const secs = secsOf(ticks); let o = 0, h = -Infinity, l = Infinity, c = 0, v = 0, b = 0;
    for (const x of secs) { if (!v) o = x[1]; if (x[2] > h) h = x[2]; if (x[3] < l) l = x[3]; c = x[4]; v += x[5]; b += x[6]; }
    try { this.st.putMinute(sym, t, blob || packTicks(sym, t * MIN, ticks), packSecs(sym, t * MIN, secs), [o, h, l, c, v, b, ticks.length, src]); this.n.rows += 3; }
    catch (e) { this.lastError = 'store failed'; }
  }
  prune(now) {
    try { this.st.prune(sym0(now, this.o.KEEP_H * 60), sym0(now, this.o.SEC_DAYS * 1440), sym0(now, this.o.M1_DAYS * 1440)); } catch (e) { this.lastError = 'prune failed'; }
    const keep = sym0(now, Math.max(this.o.KEEP_H * 60, this.o.SEC_DAYS * 1440) + 120);   // spans live as long as the seconds rows: an older fill is asked once
    this.spans = this.spans.filter((x) => x.t1 >= keep || x.id === this.spanId);
    try { this.st.pruneSpans(keep, this.spanId || 0); } catch (e) {}
    for (const [s, r] of this.rec) { const lo = sym0(now, this.o.M1_DAYS * 1440); if (r < lo) { this.rec.set(s, lo); try { this.st.setRec(s, lo); } catch (e) {} } }
  }

  // ---- gap fill
  // CME-hours minutes of [lo, hi) for sym in no span, newest first
  missing(sym, lo, hi) {
    if (!(hi > lo)) return [];
    const cov = new Uint8Array(hi - lo);   // one byte a minute (30 d = 43 kB), linear in spans + minutes
    for (const x of this.spans) if ((x.sym === '*' || x.sym === sym) && x.t1 > lo && x.t0 < hi) cov.fill(1, Math.max(x.t0, lo) - lo, Math.min(x.t1, hi) - lo);
    const out = [];
    for (let t = hi - 1; t >= lo; t--) if (!cov[t - lo] && this.open(t * MIN)) out.push(t);
    return out;
  }
  async fill() {
    const o = this.o, now = this.clock();
    if (this.filling || now < this.fillPause || !o.key) return { filled: 0 };
    this.filling = true; const start = now; let filled = 0;
    const hi = Math.floor((now - o.FILL_LAG_MS) / MIN), lo = Math.floor(now / MIN) - o.KEEP_H * 60;
    try {
      for (const sym of this.syms) {
        const miss = this.missing(sym, lo, hi);
        // windows of contiguous minutes, at most FILL_WIN_MIN each, newest first
        let k = 0;
        while (k < miss.length) {
          if (this.ensureWaiting || this.clock() - start > o.FILL_BUDGET_MS || this.clock() < this.fillPause) return { filled };   // a chart read waiting: it goes first
          const top = miss[k]; let bot = top; k++;
          while (k < miss.length && miss[k] === bot - 1 && top - miss[k] < o.FILL_WIN_MIN) { bot = miss[k]; k++; }
          const ok = await this.fillWindow(sym, bot, top + 1);
          if (!ok) return { filled };
          filled += top + 1 - bot;
        }
      }
    } finally { this.filling = false; this.refreshRec(); }
    return { filled };
  }
  refreshRec(now = this.clock()) {
    const hi = Math.floor((now - this.o.GRACE_MS) / MIN), lo = Math.floor(now / MIN) - this.o.KEEP_H * 60;
    for (const sym of this.syms) this.updRec(sym, this.missing(sym, lo, hi), lo, hi);
  }
  // rec = the first minute of the hole-free record. While the record is younger than the fill window (first days after deploy) it
  // starts after the newest hole, and moves back as the filler closes holes. Once it reaches the window's far edge, a hole inside the
  // window is PENDING (the filler will close it) and does not move rec; only a hole that is about to leave the window unfilled does.
  updRec(sym, miss, lo, hi) {
    const prev = this.rec.get(sym);
    let r;
    if (prev == null || prev > lo) r = miss.length ? miss[0] + 1 : lo;
    else { const aged = miss.filter((t) => t < lo + 10); r = aged.length ? Math.max(prev, aged[0] + 1) : prev; }
    if (r !== prev) { this.rec.set(sym, r); try { this.st.setRec(sym, r); } catch (e) {} }
  }
  // [t0, t1) minutes from the archive. -> true when done (also when the archive had nothing), false = stop this run
  async fillWindow(sym, t0, t1) {
    const o = this.o, doFetch = o.fetch || ((u, i) => fetch(u, i)), ticks = [];
    let s = t0 * 60;
    const e = t1 * 60;
    for (let page = 0; page < o.PAGES; page++) {
      let r;
      this.n.fillReq++;
      try { r = await doFetch(o.REST + '/history/ticks?symbol=' + encodeURIComponent(sym) + '&start=' + s + '&end=' + e + '&limit=' + o.PAGE_LIMIT, { headers: { authorization: 'Bearer ' + o.key } }); }
      catch (x) { this.fillPause = this.clock() + o.FILL_PAUSE_MS; this.lastError = 'fill fetch'; return false; }
      if (r.status === 429 || r.status >= 500) { this.fillPause = this.clock() + o.FILL_PAUSE_MS; this.lastError = 'fill http ' + r.status; return false; }
      if (r.status === 401 || r.status === 403) { this.fillPause = this.clock() + o.AUTH_PAUSE_MS; this.lastError = 'fill auth'; return false; }
      let j = null; try { j = await r.json(); } catch (x) {}
      const rows = j && Array.isArray(j.ticks) ? j.ticks : [];
      const more = !!(j && j.truncated && rows.length);
      // a truncated page may end inside a second: drop that second and ask again from it (no tie lost at the page edge)
      const lastSec = more ? Math.floor(rows[rows.length - 1].ts / 1e6) : Infinity;
      for (const x of rows) {
        const sec = Math.floor(x.ts / 1e6); if (sec >= lastSec) break;
        const side = x.side === 'buy' ? 1 : x.side === 'sell' ? -1 : 0, px = Number(x.price), sz = Number(x.size);
        if (side && px > 0 && sz > 0) ticks.push([Math.floor(x.ts / 1000), px, sz, side]);
      }
      if (!more) break;
      if (lastSec <= s) { this.lastError = 'fill page stuck'; break; }
      s = lastSec;
    }
    ticks.sort((a, b) => a[0] - b[0]);
    const by = new Map();
    for (const x of ticks) { const t = Math.floor(x[0] / MIN); if (t >= t0 && t < t1) (by.get(t) || by.set(t, []).get(t)).push(x); }
    const cur = this.S.get(sym) && this.S.get(sym).cur;
    try {
      // a minute the archive has nothing for keeps what the live socket stored (the archive has holes too: 4 NQ minutes missing on 2026-11-05 08:30 UTC)
      for (const [t, list] of by) if (!(cur && cur.t === t)) this.writeMinute(sym, t, list, 3);
      this.st.dropHours(sym, Math.floor(t0 / 60), Math.floor((t1 - 1) / 60));
      const id = this.st.addSpan(sym, t0, t1, 3);
      this.spans.push({ id, sym, t0, t1, kind: 3 });
    } catch (x) { this.lastError = 'fill store failed'; return false; }
    this.n.filledMin += t1 - t0; this.n.filledTrades += ticks.length;
    return true;
  }

  // ---- on-demand history (live lane reads only; ts-hub.js calls it before bars())
  // fetch the missing minutes of [lo, hi) (minute numbers) from the archive, newest first, within budgetMs.
  // -> { left: minutes still missing } (the caller answers `more` and the chart's scroll-back asks again)
  async ensure(sym, lo, hi, budgetMs = this.o.ENSURE_BUDGET_MS) {
    const o = this.o, start = this.clock();
    hi = Math.min(hi, Math.floor((start - o.FILL_LAG_MS) / MIN));   // younger minutes: live span or the archive is not there yet
    if (!o.key || !this.syms.has(sym) || !(hi > lo)) return { left: 0 };
    let miss = this.missing(sym, lo, hi);
    if (!miss.length) return { left: 0 };
    this.n.ensureReq++;
    this.ensureWaiting++;
    try {
      while (this.filling) { if (this.clock() - start > budgetMs) return { left: miss.length }; await new Promise((r) => setTimeout(r, 50)); }
      this.filling = true;
      try {
        let k = 0;
        while (k < miss.length) {
          if (this.clock() - start > budgetMs || this.clock() < this.fillPause) break;
          const top = miss[k]; let bot = top; k++;
          while (k < miss.length && miss[k] === bot - 1 && top - miss[k] < o.ENSURE_WIN_MIN) { bot = miss[k]; k++; }
          if (!(await this.fillWindow(sym, bot, top + 1))) break;
          this.n.ensureMin += top + 1 - bot;
        }
      } finally { this.filling = false; }
      miss = this.missing(sym, lo, hi);
      return { left: miss.length };
    } finally { this.ensureWaiting--; }
  }
  // first minute from which [lo, recMin) has no hole (the record reaches back to it, archive fills included)
  coveredFrom(sym, lo, recMin) {
    if (!(lo < recMin)) return recMin;
    const miss = this.missing(sym, lo, recMin);
    return miss.length ? miss[0] + 1 : lo;
  }
  recOf(sym, now) { if (!this.rec.has(sym)) this.refreshRec(now); const r = this.rec.get(sym); return r == null ? Math.floor(now / MIN) : r; }
  // the minutes a read of tf over [from, to) needs, for ensure(): seconds = the range (not older than SEC_DAYS), ticks = back to the
  // session open of the oldest bar wanted (the anchor, see tickBars), not older than KEEP_H (raw trades are kept that long)
  async ensureFor(sym, tf, from, to, limit, cut = Infinity) {
    const now = this.clock(), nowMin = Math.floor(now / MIN), end = Math.min(to, cut, now + MIN), endMin = Math.floor((end - 1) / MIN) + 1;
    const n = tickN(tf), budgetEnd = now + this.o.ENSURE_BUDGET_MS;
    if (!n) {
      const sp = tfSpec(tf); if (!sp || sp.k !== 's') return { left: 0 };
      return this.ensure(sym, Math.max(Math.floor(from / MIN), nowMin - this.o.SEC_DAYS * 1440), endMin);
    }
    // ticks: grow the window back from `to` (1 h, 2 h, 4 h ..) until it holds limit+2 bars of trades, then fill back to the session
    // open of the oldest one (the count anchor). Never fetches more than the bars need.
    const keepLo = nowMin - this.o.KEEP_H * 60 + 1;
    let left = 0, step = 60;
    for (;;) {
      const lo = Math.max(endMin - step, keepLo), budget = Math.max(0, budgetEnd - this.clock());
      left = (await this.ensure(sym, lo, endMin, budget)).left;
      if (left) return { left };
      const t0 = this.tickStart(sym, n, limit, endMin, keepLo);
      if (t0 >= lo || lo === keepLo) { const so = Math.max(Math.ceil(sessionOpen(t0 * MIN) / MIN), keepLo); if (so < lo) left = (await this.ensure(sym, so, lo, Math.max(0, budgetEnd - this.clock()))).left; break; }
      step *= 2;
    }
    return { left };
  }
  // counts: minute -> trades, over [lo, endMin) from tkm1 + the open minute
  counts(sym, lo, endMin) {
    const m = new Map(); for (const r of this.st.counts(sym, lo, endMin - 1)) m.set(r.t, r.n || 0);
    const s = this.S.get(sym); if (s && s.cur && s.cur.t >= lo && s.cur.t < endMin) m.set(s.cur.t, s.cur.ticks.length);
    return m;
  }
  // the minute to start reading from so that limit+2 bars of n trades fit before endMin (stops at lo)
  tickStart(sym, n, limit, endMin, lo, m) {
    const c = m instanceof Map ? m : this.counts(sym, lo, endMin), want = (limit + 2) * n;
    let sum = 0, t = endMin - 1;
    for (; t > lo; t--) { sum += c.get(t) || 0; if (sum >= want || sum >= this.o.TICK_MAX_TRADES) break; }
    return Math.max(t, lo);
  }
  // N-TICK BARS of the stored trades before `to` (ms): the newest `limit` bars. Deterministic: each bar is n trades counted from the
  // SESSION OPEN (18:00 New York, tick-codec.js sessionOpen), so trade k of the session (k = 0, 1, ..) opens a bar when k % n == 0 and
  // the same trades give the same bars on every read; a session's last bar may hold fewer than n. Bar time = its first trade's time,
  // +1 ms when that would not be after the previous bar (bursts: many bars in one ms). Only sessions whose open is inside the raw
  // window (KEEP_H) are served. ensureFor() fills holes first; a hole younger than the archive lag (~10 min, a socket drop) is filled by
  // the gap filler later and the bars after it are re-counted on the next read. -> { b, rec, e, q, c: trades in the last bar, cut }
  tickBars(sym, n, to, limit, cut = Infinity) {
    if (!this.syms.has(sym) || !n) return null;
    const now = this.clock(), nowMin = Math.floor(now / MIN), end = Math.min(to, cut, now + MIN), endMin = Math.floor((end - 1) / MIN) + 1;
    const covFrom = nowMin - this.o.KEEP_H * 60 + 1;   // raw trades exist KEEP_H back only
    const q = cut === Infinity ? (this.S.get(sym) ? this.S.get(sym).seq : 0) : null;
    const none = { b: [], rec: covFrom * MIN, e: this.epoch, q, c: 0, cut: cut !== Infinity };
    if (!(endMin > covFrom)) return none;
    const cnt = this.counts(sym, covFrom, endMin);
    let t0 = this.tickStart(sym, n, limit, endMin, covFrom, cnt);
    let so = sessionOpen(t0 * MIN);
    if (so < covFrom * MIN) {   // the session holding t0 is not in the record from its open: start at the next session
      so = sessionOpen(sessionOpen(covFrom * MIN) + 25 * 3600000);
      if (so >= end) return none;
      t0 = Math.ceil(so / MIN);
    }
    t0 = Math.max(t0 - 1, Math.ceil(so / MIN));   // one minute early: the first bar's +1 ms rule sees the bar before it (bursts)
    let idx = 0; for (let t = Math.ceil(so / MIN); t < t0; t++) idx += cnt.get(t) || 0;
    const trades = [];
    for (const r of this.st.raw(sym, t0, endMin - 1)) for (const x of unpackTicks(r.ticks, r.t * MIN)) if (x[0] < end) trades.push(x);
    const s = this.S.get(sym);
    if (s && s.cur && s.cur.t >= t0 && s.cur.t < endMin) for (const x of s.cur.ticks) if (x[0] < end) trades.push(x);
    const out = []; let cur = null, k = 0, next = sessionOpen(so + 25 * 3600000), last = -Infinity;
    for (const [ts, px, sz, side] of trades) {
      if (ts >= next) { so = sessionOpen(ts); next = sessionOpen(so + 25 * 3600000); idx = 0; }
      if (idx % n === 0) { const tm = Math.max(ts, last + 1); cur = [tm, px, px, px, px, 0, 0]; out.push(cur); last = tm; k = 0; }
      idx++;
      if (!cur) continue;   // the tail of a bar that opened before t0
      if (px > cur[2]) cur[2] = px; if (px < cur[3]) cur[3] = px; cur[4] = px; cur[5] += sz; if (side > 0) cur[6] += sz; k++;
    }
    return { b: out.slice(-limit), rec: covFrom * MIN, e: this.epoch, q, c: out.length ? k : 0, cut: cut !== Infinity };
  }

  // ---- reads
  // the open minute as 1 s rows, cut before `cut` (ms)
  openSecs(sym, cut) {
    const s = this.S.get(sym); if (!s || !s.cur) return { secs: [], q: s ? s.seq : 0 };
    const tk = s.cur.ticks; let n = tk.length;
    if (cut < Infinity) { n = 0; while (n < tk.length && tk[n][0] < cut) n++; }
    return { secs: secsOf(n === tk.length ? tk : tk.slice(0, n)), q: s.cur.seq0 + n - 1, t: s.cur.t };
  }
  // bars of timeframe tf over [from, to) ms. cut: nothing at or after it (Infinity = live). -> { b, rec, e, q, cut }
  bars(sym, tf, from, to, cut = Infinity) {
    const sp = tfSpec(tf); if (!sp || !this.syms.has(sym)) return null;
    const now = this.clock(), end = Math.min(to, cut, now + MIN), q0 = this.S.get(sym) ? this.S.get(sym).seq : 0;
    if (!this.rec.has(sym)) this.refreshRec(now);
    let recMin = this.rec.get(sym); if (recMin == null) recMin = Math.floor(now / MIN);
    if (sp.k === 's') { const lo = Math.max(Math.floor(from / MIN), Math.floor(now / MIN) - this.o.SEC_DAYS * 1440); recMin = Math.max(this.coveredFrom(sym, lo, recMin), lo); }   // seconds: archive fills older than rec count (on-demand history)
    const recMs = recMin * MIN;
    from = Math.max(from, recMs);
    let rows = [], q = q0;
    if (from < end) {
      if (sp.k === 's') {
        const t0 = Math.max(Math.floor(from / MIN), Math.floor(end / MIN) - this.o.READ_SEC_MIN);
        for (const r of this.st.secs(sym, t0, Math.floor((end - 1) / MIN))) for (const x of unpackSecs(r.secs, r.t * MIN)) if (x[0] < end) rows.push(x);
        const os = this.openSecs(sym, cut); q = os.q;
        if (os.t != null && os.t * MIN < end && os.t * MIN >= t0 * MIN) for (const x of os.secs) if (x[0] < end) rows.push(x);
      } else {
        const big = sp.k === 'D' || sp.n >= 60;
        const lim = big ? this.o.READ_H1 * 60 : this.o.READ_M1_MIN;
        const t0 = Math.max(Math.floor(bucketOf(from, sp) / MIN), Math.floor(end / MIN) - lim), t1 = Math.floor((end - 1) / MIN);
        rows = big ? this.hourRows(sym, t0, t1, cut) : this.st.m1(sym, t0, t1).map(m1Row);
        const os = this.openSecs(sym, cut); q = os.q;
        if (os.t != null && os.secs.length && os.t >= t0 && os.t <= t1) rows.push(minuteOf(os.t * MIN, os.secs));
      }
      rows.sort((a, b) => a[0] - b[0]);
    }
    // only whole buckets of the record: a bucket that starts before rec is the old source's (stitched at that boundary by the page)
    const b = aggregate(rows, sp).filter((x) => x[0] >= recMs && x[0] >= bucketOf(from, sp) && x[0] < to);
    return { b, rec: firstBucketFrom(recMs, sp), e: this.epoch, q: cut === Infinity ? q : null, cut: cut !== Infinity };
  }
  // minute rows of [t0, t1] with every whole, closed hour replaced by its tkh1 roll-up (built from tkm1 and stored on first read).
  // An hour is used only when it ended before both the cut and now - 10 s (its last minute is written 3 s after it ends).
  hourRows(sym, t0, t1, cut) {
    const lim = Math.min(this.clock() - 10000, cut), h0 = Math.ceil(t0 / 60), h1 = Math.min(Math.floor((t1 + 1) / 60), Math.floor(lim / 3600000)) - 1;
    if (h1 < h0) return this.st.m1(sym, t0, t1).map(m1Row);
    const out = this.st.m1(sym, t0, h0 * 60 - 1).map(m1Row).concat(this.st.m1(sym, (h1 + 1) * 60, t1).map(m1Row));
    const have = new Map(this.st.h1(sym, h0, h1).map((r) => [r.t, r]));
    let lo = -1; for (let h = h0; h <= h1; h++) if (!have.has(h)) { lo = h; break; }
    if (lo >= 0) {
      const byH = new Map();
      for (const r of this.st.m1(sym, lo * 60, h1 * 60 + 59)) { const h = Math.floor(r.t / 60); if (!have.has(h)) (byH.get(h) || byH.set(h, []).get(h)).push(m1Row(r)); }
      for (const [h, list] of byH) { const bar = aggregate(list, { k: 'm', n: 60, ms: 3600000 })[0]; out.push(bar); try { this.st.putHour(sym, h, bar); } catch (e) {} }
    }
    for (const [h, r] of have) out.push([h * 3600000, r.o, r.h, r.l, r.c, r.v, r.b]);
    return out;
  }
  // stored trades of [from, to) ms (+ the open minute), at most 15 min a read -> [[ts, px, size, side], ..]
  ticks(sym, from, to, cut = Infinity) {
    if (!this.syms.has(sym)) return null;
    to = Math.min(to, cut, from + 15 * MIN);
    const out = [];
    for (const r of this.st.raw(sym, Math.floor(from / MIN), Math.floor((to - 1) / MIN))) for (const x of unpackTicks(r.ticks, r.t * MIN)) if (x[0] >= from && x[0] < to) out.push(x);
    const s = this.S.get(sym);
    if (s && s.cur) for (const x of s.cur.ticks) if (x[0] >= from && x[0] < to) out.push(x);
    return out;
  }
  // trades with seq > since for the socket: { q: seq of the first, t: [[px, sz, side, ts], ..] } | 'resync'
  since(sym, since, max = 5000) {
    const s = this.S.get(sym);
    if (!s) return since === 0 ? { q: 1, t: [] } : 'resync';
    if (since >= s.seq) return { q: s.seq + 1, t: [] };
    const out = []; let q = since + 1;
    const oldest = s.recent.length ? s.recent[0].seq0 : (s.cur ? s.cur.seq0 : s.seq + 1);
    if (since + 1 < oldest || since < 0) return 'resync';
    for (const m of s.recent) {
      if (m.seq0 + m.n - 1 < q) continue;
      const list = unpackTicks(m.blob, m.t * MIN);
      for (let k = Math.max(0, q + out.length - m.seq0); k < list.length && out.length < max; k++) { const x = list[k]; out.push([x[1], x[2], x[3], x[0]]); }
      if (out.length >= max) return { q, t: out };
    }
    if (s.cur) for (let k = Math.max(0, q + out.length - s.cur.seq0); k < s.cur.ticks.length && out.length < max; k++) { const x = s.cur.ticks[k]; out.push([x[1], x[2], x[3], x[0]]); }
    return { q, t: out };
  }
  stats() {
    const rec = {}; for (const [s, r] of this.rec) rec[s] = new Date(r * MIN).toISOString();
    return { epoch: this.epoch, up: !!this.upAt, symbols: [...this.syms], rec, filling: this.filling, fillPausedMs: Math.max(0, this.fillPause - this.clock()), lastError: this.lastError, spans: this.spans.length, ...this.n };
  }
}
const sym0 = (now, mins) => Math.floor(now / MIN) - mins;
const m1Row = (r) => [r.t * MIN, r.o, r.h, r.l, r.c, r.v, r.b];
function minuteOf(t, secs) { let o = 0, h = -Infinity, l = Infinity, c = 0, v = 0, b = 0; for (const x of secs) { if (!v) o = x[1]; if (x[2] > h) h = x[2]; if (x[3] < l) l = x[3]; c = x[4]; v += x[5]; b += x[6]; } return [t, o, h, l, c, v, b]; }
// first bucket start at or after ms
function firstBucketFrom(ms, sp) { const b = bucketOf(ms, sp); return b >= ms ? b : bucketOf(b + sp.ms + (sp.k === 'D' ? 4 * 3600000 : 0), sp); }

// ---- SQLite glue (Durable Object ctx.storage.sql)
export function teStore(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS tkraw (sym TEXT NOT NULL, t INTEGER NOT NULL, ticks BLOB NOT NULL, PRIMARY KEY (sym, t)) WITHOUT ROWID');
  sql.exec('CREATE TABLE IF NOT EXISTS tksec (sym TEXT NOT NULL, t INTEGER NOT NULL, secs BLOB NOT NULL, PRIMARY KEY (sym, t)) WITHOUT ROWID');
  sql.exec('CREATE TABLE IF NOT EXISTS tkm1 (sym TEXT NOT NULL, t INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v REAL, b REAL, n INTEGER, src INTEGER, PRIMARY KEY (sym, t)) WITHOUT ROWID');
  sql.exec('CREATE TABLE IF NOT EXISTS tkh1 (sym TEXT NOT NULL, t INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v REAL, b REAL, PRIMARY KEY (sym, t)) WITHOUT ROWID');
  sql.exec('CREATE TABLE IF NOT EXISTS tkspan (id INTEGER PRIMARY KEY, sym TEXT NOT NULL, t0 INTEGER NOT NULL, t1 INTEGER NOT NULL, kind INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS tkmeta (sym TEXT PRIMARY KEY, rec INTEGER)');
  const all = (q, ...a) => sql.exec(q, ...a).toArray();
  return {
    putMinute(sym, t, ticks, secs, m) {
      sql.exec('INSERT OR REPLACE INTO tkraw (sym, t, ticks) VALUES (?, ?, ?)', sym, t, ticks);
      sql.exec('INSERT OR REPLACE INTO tksec (sym, t, secs) VALUES (?, ?, ?)', sym, t, secs);
      sql.exec('INSERT OR REPLACE INTO tkm1 (sym, t, o, h, l, c, v, b, n, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', sym, t, ...m);
    },
    clearMinutes(sym, t0, t1) { for (const tb of ['tkraw', 'tksec', 'tkm1']) sql.exec('DELETE FROM ' + tb + ' WHERE sym = ? AND t >= ? AND t < ?', sym, t0, t1); },
    dropHours(sym, h0, h1) { sql.exec('DELETE FROM tkh1 WHERE sym = ? AND t >= ? AND t <= ?', sym, h0, h1); },
    putHour(sym, h, r) { sql.exec('INSERT OR REPLACE INTO tkh1 (sym, t, o, h, l, c, v, b) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', sym, h, r[1], r[2], r[3], r[4], r[5], r[6]); },
    raw(sym, t0, t1) { return all('SELECT t, ticks FROM tkraw WHERE sym = ? AND t >= ? AND t <= ? ORDER BY t', sym, t0, t1); },
    secs(sym, t0, t1) { return all('SELECT t, secs FROM tksec WHERE sym = ? AND t >= ? AND t <= ? ORDER BY t', sym, t0, t1); },
    m1(sym, t0, t1) { return all('SELECT t, o, h, l, c, v, b FROM tkm1 WHERE sym = ? AND t >= ? AND t <= ? ORDER BY t', sym, t0, t1); },
    counts(sym, t0, t1) { return all('SELECT t, n FROM tkm1 WHERE sym = ? AND t >= ? AND t <= ? ORDER BY t', sym, t0, t1); },
    h1(sym, h0, h1) { return all('SELECT t, o, h, l, c, v, b FROM tkh1 WHERE sym = ? AND t >= ? AND t <= ? ORDER BY t', sym, h0, h1); },
    spans() { return all('SELECT id, sym, t0, t1, kind FROM tkspan'); },
    addSpan(sym, t0, t1, kind) { return all('INSERT INTO tkspan (sym, t0, t1, kind) VALUES (?, ?, ?, ?) RETURNING id', sym, t0, t1, kind)[0].id; },
    setSpanEnd(id, t1) { sql.exec('UPDATE tkspan SET t1 = ? WHERE id = ?', t1, id); },
    pruneSpans(t, keepId) { sql.exec('DELETE FROM tkspan WHERE t1 < ? AND id != ?', t, keepId); },
    metas() { return all('SELECT sym, rec FROM tkmeta').map((r) => [r.sym, r.rec]); },
    setRec(sym, rec) { sql.exec('INSERT OR REPLACE INTO tkmeta (sym, rec) VALUES (?, ?)', sym, rec); },
    prune(tRaw, tSec, tM1) {
      sql.exec('DELETE FROM tkraw WHERE t < ?', tRaw); sql.exec('DELETE FROM tksec WHERE t < ?', tSec);
      sql.exec('DELETE FROM tkm1 WHERE t < ?', tM1); sql.exec('DELETE FROM tkh1 WHERE t < ?', Math.floor(tM1 / 60));
    }
  };
}
