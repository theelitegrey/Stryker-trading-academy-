// Futures stream bridge: an early close (open -> 1011 before any bar) is transient (frozen candles 2026-10-16).
//   node tools/tests/chart-stream-retry.test.mjs
import assert from 'node:assert/strict';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
globalThis.location = { protocol: 'https:', host: 'tradezoro.com' };
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
let socks = [], failFirst = 4, live = 0, maxLive = 0;
globalThis.WebSocket = class {
  constructor(u) {
    this.url = u; this.readyState = 0; this._l = {}; socks.push(this); live++; maxLive = Math.max(maxLive, live);
    const idx = socks.length;
    setTimeout(() => {
      this.readyState = 1; this.onopen && this.onopen();
      if (idx <= failFirst) setTimeout(() => this._close(1011), 5);
      else { let t = 1000; this._iv = setInterval(() => this.onmessage && this.onmessage({ data: JSON.stringify({ event: 'bar', bar: [1700000000, 100, 101, 99, 100 + (t++ % 7), 5] }) }), 20); }
    }, 2);
  }
  addEventListener(e, f) { (this._l[e] = this._l[e] || []).push(f); }
  _close(code) { if (this.readyState === 3) return; this.readyState = 3; clearInterval(this._iv); live--; (this._l.close || []).forEach((f) => f({ code })); this.onclose && this.onclose({ code }); }
  close() { this._close(1005); }
};
const { FuturesProvider } = await import('../../assets/chart-futures-provider.js');
const { _rtSetForTests } = await import('../../assets/rt-access.js?v=578');
_rtSetForTests(true);   // the stream is admin only (2026-10-16)
const p = new FuturesProvider();
let polls = 0; p.pollSubscribe = () => { polls++; return () => {}; };
const got = [];
const t0 = Date.now();
const unsub = p.subscribe('MNQ1!', '1', (b) => got.push(b));
while (!got.length && Date.now() - t0 < 12000) await sleep(50);
assert.ok(got.length > 0, 'bars arrive after 4 early 1011 closes'); ok('bars flow after 4 early closes (' + (Date.now() - t0) + ' ms)');
assert.ok(Date.now() - t0 < 10000, 'recovered within ~10 s'); ok('recovered in < 10 s (old shared backoff: 5-90 s)');
assert.ok(polls >= 1, 'REST poll covered meanwhile'); ok('poll fallback was started meanwhile');
assert.ok(socks.slice(1).some((s) => !/ticks=1/.test(s.url)) || socks.length > 1, 'retried'); ok('retried (' + socks.length + ' sockets)');
unsub();
await sleep(20);
// a second subscription on the same key is not held back by earlier failures
failFirst = 0; socks = []; got.length = 0;
const u2 = p.subscribe('MNQ1!', '1', (b) => got.push(b));
await sleep(300);
assert.ok(got.length > 0); ok('a new subscription connects at once');
u2();
// socket cap
socks = []; const subs = [];
for (let i = 0; i < 20; i++) subs.push(p.subscribe('MNQ1!', String([1, 5, 15, 60][i % 4]), () => {}));
await sleep(100);
assert.ok(maxLive <= 8, 'max live ' + maxLive); ok('at most 8 bridge sockets open at once (max ' + maxLive + ')');
subs.forEach((u) => u());
console.log(n + ' passed'); process.exit(0);
