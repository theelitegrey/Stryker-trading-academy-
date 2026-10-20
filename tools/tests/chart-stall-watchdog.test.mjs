// Frozen candles 2026-10-20: a bridge socket that stays OPEN but silent, and a tab that was hidden.
// The chart must reconnect AND re-read the REST tail within ~15 s.  node tools/tests/chart-stall-watchdog.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
globalThis.__TZ_CME_OPEN = true;
globalThis.location = { protocol: 'https:', host: 'tradezoro.com' };
const docL = {};
globalThis.document = { hidden: false, addEventListener(e, f) { (docL[e] = docL[e] || []).push(f); }, removeEventListener(e, f) { docL[e] = (docL[e] || []).filter((x) => x !== f); } };
const fire = (e) => (docL[e] || []).slice().forEach((f) => f());
let socks = [], mode = 'silent';   // silent: open, never a message | live: bars | pings: heartbeat only
globalThis.WebSocket = class {
  constructor(u) {
    this.url = u; this.readyState = 0; this._l = {}; socks.push(this);
    const my = mode;
    setTimeout(() => {
      if (this.readyState === 3) return;
      this.readyState = 1; this.onopen && this.onopen();
      if (my === 'live') this._iv = setInterval(() => this.onmessage && this.onmessage({ data: JSON.stringify({ event: 'bar', bar: [1700000000, 100, 101, 99, 100, 5] }) }), 100);
      if (my === 'pings') { this.onmessage({ data: JSON.stringify({ event: 'ping' }) }); }
    }, 2);
  }
  addEventListener(e, f) { (this._l[e] = this._l[e] || []).push(f); }
  _close(code) { if (this.readyState === 3) return; this.readyState = 3; clearInterval(this._iv); (this._l.close || []).forEach((f) => f({ code })); this.onclose && this.onclose({ code }); }
  close() { this._close(1005); }
};
const { FuturesProvider } = await import('../../assets/chart-futures-provider.js');
const rtV = /rt-access\.js\?v=(\d+)/.exec(fs.readFileSync(new URL('../../assets/chart-futures-provider.js', import.meta.url), 'utf8'))[1];
const { _rtSetForTests } = await import('../../assets/rt-access.js?v=' + rtV);
_rtSetForTests(true);
const p = new FuturesProvider();
p.pollSubscribe = () => () => {};
let tails = 0; p.getBars = async () => { tails++; return [{ time: 1700000000000, open: 1, high: 2, low: 0, close: 1, volume: 1 }]; };
const got = [];

// 1) silent-but-open socket: reconnects (and reads the tail) within 15 s, then bars flow
let t0 = Date.now();
const unsub = p.subscribe('MNQ1!', '5', (b) => got.push(b));
await sleep(100);
assert.equal(socks.length, 1);
mode = 'live';
while (socks.length < 2 && Date.now() - t0 < 15000) await sleep(100);
assert.ok(socks.length >= 2, 'a second socket was opened'); ok('silent open socket force-closed and re-opened in ' + (Date.now() - t0) + ' ms (< 15 s)');
assert.ok(Date.now() - t0 < 15000);
assert.equal(socks[0].readyState, 3); ok('the silent socket was closed');
assert.ok(tails >= 1); ok('REST tail fetched right after the stall (' + tails + ')');
await sleep(500);
assert.ok(got.length > 0); ok('bars flow on the new socket');
unsub();

// 2) heartbeat seen, then silence: dead after ~13 s
socks = []; tails = 0; mode = 'pings';
t0 = Date.now();
const u2 = p.subscribe('MNQ1!', '1', () => {});
await sleep(100);
mode = 'live';
while (socks.length < 2 && Date.now() - t0 < 16000) await sleep(100);
assert.ok(socks.length >= 2 && Date.now() - t0 < 15000, 'dead socket replaced in ' + (Date.now() - t0)); ok('pings then silence: replaced in ' + (Date.now() - t0) + ' ms');
u2();

// 3) hidden tab, then shown: re-open + tail at once (no 10 s wait)
socks = []; tails = 0; mode = 'live';
const u3 = p.subscribe('MNQ1!', '5', () => {});
await sleep(300);
const first = socks[0];
document.hidden = true; fire('visibilitychange');
await sleep(300);
document.hidden = false; t0 = Date.now(); fire('visibilitychange');
await sleep(400);
assert.ok(socks.length >= 2 && first.readyState === 3, 'old socket closed, new one opened'); ok('tab visible again: fresh socket within ' + (Date.now() - t0) + ' ms');
assert.ok(tails >= 1); ok('tab visible again: REST tail re-read at once');
u3();

// 4) market closed: no churn
socks = []; mode = 'silent'; globalThis.__TZ_CME_OPEN = false;
const u4 = p.subscribe('MNQ1!', '5', () => {});
await sleep(13000);
assert.equal(socks.length, 1); ok('CME closed: a quiet socket is left alone');
u4();
console.log(n + ' passed'); process.exit(0);
