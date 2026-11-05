// TICK ENGINE feed core (Owner order 2026-11-05: "the websocket keeps open till the user charts remain open ... if user changes tabs").
// ONE /ts-live socket per browser, owned by assets/tick-feed-worker.js (a SharedWorker) or, where there is none, by the leader tab
// (assets/tick-feed.js). No DOM, no imports: runs in a worker or a window.
//
// Per symbol it keeps the epoch (e) and the newest seq delivered, plus a ring of the last RING trades, so a chart that joins late
// (join(sym, e, q)) gets every trade after ITS snapshot's q: from the ring, or, if q is older than the ring, by asking the server to
// replay (tsub since=q). Frames are de-duplicated by seq here, ONCE, for every tab. A seq jump or an epoch change = 'resync' to the
// charts of that symbol (they re-read their bars and join again). Reconnect: backoff 0.5 s doubling to 15 s (+ jitter), then tsub
// since=<last seq> for every symbol, so nothing is missed. Heartbeat: the hub pings every 5 s; 15 s of silence = dead, reconnect.
// Close: only when no chart is joined (after LINGER_MS, so a reload or a timeframe switch keeps the socket).
export const FEED_DEF = { RING: 20000, DEAD_MS: 15000, BACKOFF_MS: 500, BACKOFF_MAX_MS: 15000, LINGER_MS: 20000 };

export class TickFeedCore {
  constructor(o) {
    this.o = Object.assign({}, FEED_DEF, o);   // o: { WebSocket, now, setTimeout, clearTimeout, url(): string, token(): string, onState(s), needToken() }
    this.WS = this.o.WebSocket; this.now = this.o.now || (() => Date.now());
    this.T = this.o.setTimeout || ((f, ms) => setTimeout(f, ms)); this.CT = this.o.clearTimeout || ((h) => clearTimeout(h));
    this.ws = null; this.open = false; this.fails = 0; this.retryH = null; this.lingerH = null; this.lastMsg = 0;
    this.S = new Map();      // sym -> { e, seq, ring: [[seq, px, sz, side, ts]...], joins: Set }
    this.joins = new Set();  // { sym, e, q, fn }
    this.n = { opens: 0, closes: 0, frames: 0, dupes: 0, resyncs: 0, gaps: 0 };
    this.tier = null; this.attachedE = null;
  }
  // a chart wants every trade of sym after its snapshot (e, q). fn(frame): {type:'tt', symbol, e, q, t} | {type:'resync', symbol, e} | {type:'state', ...}
  join(sym, e, q, fn) {
    const j = { sym, e, q, fn, last: q };
    this.joins.add(j);
    if (this.lingerH) { this.CT(this.lingerH); this.lingerH = null; }
    let s = this.S.get(sym);
    if (!s) { s = { e, seq: q, ring: [], joins: new Set() }; this.S.set(sym, s); s.joins.add(j); this.ensure(); this.tsub(sym, q, e); return () => this.leave(j); }
    s.joins.add(j);
    if (s.e !== e) { this.T(() => this.deliver(j, { type: 'resync', symbol: sym, e: s.e }), 0); return () => this.leave(j); }
    if (q < s.seq) {
      const first = s.ring.length ? s.ring[0][0] : s.seq + 1;
      if (q + 1 >= first) {   // the ring has everything after q
        const t = []; for (const r of s.ring) if (r[0] > q) t.push([r[1], r[2], r[3], r[4]]);
        if (t.length) this.T(() => this.deliver(j, { type: 'tt', symbol: sym, e: s.e, q: q + 1, t }), 0);
      } else { this.T(() => this.deliver(j, { type: 'resync', symbol: sym, e: s.e }), 0); }
    }
    this.ensure();
    return () => this.leave(j);
  }
  leave(j) {
    if (!this.joins.delete(j)) return;
    const s = this.S.get(j.sym);
    if (s) { s.joins.delete(j); if (!s.joins.size) { this.S.delete(j.sym); this.sendOp({ op: 'tunsub', symbol: j.sym }); } }
    if (!this.joins.size && !this.lingerH) this.lingerH = this.T(() => { this.lingerH = null; if (!this.joins.size) this.close('no charts'); }, this.o.LINGER_MS);
  }
  // per-join filter: a join only gets seq > its own last (its snapshot q, then what it already got)
  deliver(j, f) {
    if (!this.joins.has(j)) return;
    if (f.type === 'tt') {
      const skip = Math.max(0, j.last + 1 - f.q);
      if (skip >= f.t.length) return;
      if (f.q + skip > j.last + 1) { j.fn({ type: 'resync', symbol: j.sym, e: f.e }); return; }   // never a hole
      const t = skip ? f.t.slice(skip) : f.t;
      j.last = f.q + skip + t.length - 1;
      j.fn(skip ? { type: 'tt', symbol: f.symbol, e: f.e, q: f.q + skip, t } : f);
      return;
    }
    if (f.type === 'resync') j.last = Infinity;   // nothing more until the chart joins again
    j.fn(f);
  }
  ensure() {
    if (this.ws || this.retryH || !this.joins.size) return;
    const tok = this.o.token ? this.o.token() : '';
    if (!tok) { if (this.o.needToken) this.o.needToken(); this.retry(); return; }
    let ws;
    try { ws = new this.WS(this.o.url(), ['tz-auth', tok]); } catch (e) { this.retry(); return; }
    this.ws = ws; this.n.opens++; this.lastMsg = this.now();
    ws.onopen = () => { this.open = true; this.lastMsg = this.now(); for (const [sym, s] of this.S) this.tsub(sym, s.seq, s.e); this.state(); this.watch(); };
    ws.onmessage = (ev) => { this.lastMsg = this.now(); this.onFrame(ev.data); };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null; this.open = false; this.n.closes++;
      if (ev && ev.code === 4401 && this.o.needToken) this.o.needToken();   // the hub closes sockets at token age: reconnect with a fresh one, no backoff
      if (ev && ev.code === 4401) this.fails = 0;
      this.state(ev && ev.code); if (this.joins.size) this.retry(ev && (ev.code === 4401 ? 50 : 0));
    };
    ws.onerror = () => {};
  }
  retry(ms) {
    if (this.retryH) return;
    const wait = ms || Math.min(this.o.BACKOFF_MAX_MS, this.o.BACKOFF_MS * Math.pow(2, this.fails++)) * (0.75 + Math.random() * 0.5);
    this.retryH = this.T(() => { this.retryH = null; this.ensure(); }, wait);
  }
  watch() {
    if (this.watchH) return;
    const tick = () => {
      this.watchH = null;
      if (!this.ws) return;
      if (this.now() - this.lastMsg > this.o.DEAD_MS) { this.kill('silent'); return; }
      this.watchH = this.T(tick, 2500);
    };
    this.watchH = this.T(tick, 2500);
  }
  kill(why) { const ws = this.ws; if (!ws) return; this.ws = null; this.open = false; this.n.closes++; try { ws.close(4000, why); } catch (e) {} this.state(); if (this.joins.size) this.retry(); }
  close(why) { if (this.retryH) { this.CT(this.retryH); this.retryH = null; } const ws = this.ws; this.ws = null; this.open = false; if (ws) { this.n.closes++; try { ws.close(1000, why); } catch (e) {} } this.state(); }
  tsub(sym, since, e) { this.sendOp(since != null && e != null ? { op: 'tsub', symbol: sym, since, e } : { op: 'tsub', symbol: sym }); }
  sendOp(m) { if (this.ws && this.open) { try { this.ws.send(JSON.stringify(m)); } catch (e) {} } }
  onFrame(data) {
    let f; try { f = JSON.parse(data); } catch (e) { return; }
    if (!f) return;
    if (f.event === 'hub_attached') { this.tier = f.tier || null; this.fails = 0; if (f.te && f.te.e != null) this.attachedE = f.te.e; this.state(); return; }
    if (f.event === 'ping') return;
    if (f.type === 'resync') { const s = this.S.get(f.symbol); if (!s) return; this.n.resyncs++; this.resync(s, f.symbol, f.e); return; }
    if (f.type !== 'tt') return;
    const s = this.S.get(f.symbol); if (!s) return;
    this.n.frames++;
    if (f.e !== s.e) { this.resync(s, f.symbol, f.e); return; }
    const skip = Math.max(0, s.seq + 1 - f.q);
    if (skip >= f.t.length) { this.n.dupes += f.t.length; return; }
    if (f.q + skip > s.seq + 1) { this.n.gaps++; this.resync(s, f.symbol, f.e); return; }   // a hole: never draw over it
    if (skip) { this.n.dupes += skip; f = { type: 'tt', symbol: f.symbol, e: f.e, q: f.q + skip, t: f.t.slice(skip) }; }
    for (let k = 0; k < f.t.length; k++) { const x = f.t[k]; s.ring.push([f.q + k, x[0], x[1], x[2], x[3]]); }
    if (s.ring.length > this.o.RING) s.ring.splice(0, s.ring.length - this.o.RING);
    s.seq = f.q + f.t.length - 1;
    for (const j of [...s.joins]) this.deliver(j, f);
  }
  // another epoch (the Durable Object restarted) or a hole: every chart of sym re-reads its bars; the ring starts over
  resync(s, sym, e) {
    for (const j of [...s.joins]) { this.deliver(j, { type: 'resync', symbol: sym, e }); this.joins.delete(j); }
    this.S.delete(sym); this.sendOp({ op: 'tunsub', symbol: sym });
    if (!this.joins.size && !this.lingerH) this.lingerH = this.T(() => { this.lingerH = null; if (!this.joins.size) this.close('no charts'); }, this.o.LINGER_MS);
  }
  state(code) { if (this.o.onState) this.o.onState({ type: 'state', up: !!(this.ws && this.open), tier: this.tier, code: code || 0, joins: this.joins.size, n: this.n }); }
  stats() { return { up: !!(this.ws && this.open), tier: this.tier, joins: this.joins.size, syms: [...this.S.keys()], ...this.n }; }
}
