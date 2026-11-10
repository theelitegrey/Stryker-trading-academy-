// Unit tests for assets/byo-bridge.js (protocol allow-list, mutual proof, pairing, history, ticks). No network.
// Run: node tools/tests/byo-bridge.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { SOURCES, ADAPTERS } from '../../assets/byo-core.js?v=951';
import { C2H, H2C, guardSend, guardRecv, guardPort, pair, PORTS, proofOf } from '../../assets/byo-bridge.js?v=951';
const proto = JSON.parse(readFileSync(new URL('../bridge/protocol.json', import.meta.url)));
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const fixed = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.filter((x) => x !== undefined)]));

await t('site allow-list equals tools/bridge/protocol.json', () => {
  assert.deepEqual(fixed(C2H), fixed(proto.c2h)); assert.deepEqual(fixed(H2C), fixed(proto.h2c)); assert.deepEqual(PORTS, proto.ports);
});
await t('no order / account / position / balance type or field anywhere', () => {
  const names = new Set([...Object.keys(C2H), ...Object.keys(H2C), ...Object.values(C2H).flat(), ...Object.values(H2C).flat()]);
  for (const f of proto.forbiddenNames) assert.ok(!names.has(f), f);
});
await t('outgoing: order and account messages refused', () => {
  for (const ty of ['order', 'order_send', 'placeOrder', 'cancel', 'modify', 'positions', 'account', 'balance', 'trade', 'buy', 'sell', 'login', 'executions', '__proto__', 'toString', 'constructor'])
    assert.throws(() => guardSend({ t: ty, sym: 'EURUSD' }), /blocked/, ty);
  assert.throws(() => guardSend({ t: 'subscribe', syms: ['EURUSD'], volume: 1 }), /blocked/);   // extra field
  assert.throws(() => guardSend({ t: 'history', sym: '../etc;', tf: '1' }), /bad symbol/);
  assert.throws(() => guardSend({ t: 'subscribe', syms: Array(11).fill('A') }), /too many/);
  assert.throws(() => guardSend('{"t":"order"}'), /blocked/);
  assert.throws(() => guardSend('x'.repeat(5000)), /blocked|JSON/);
  assert.equal(guardSend({ t: 'subscribe', syms: ['EURUSD', 'ES 12-26'], depth: false }).t, 'subscribe');
});
await t('incoming: unknown types refused', () => {
  for (const ty of ['order', 'account', 'positions', 'balance', 'fill', 'toString']) assert.throws(() => guardRecv({ t: ty }), /blocked/, ty);
  assert.equal(guardRecv('{"t":"tick","sym":"A","price":1,"ts":2,"size":3}').t, 'tick');
});
await t('only 127.0.0.1:48715-48719 sockets', () => {
  for (const u of ['ws://127.0.0.1:48715', 'ws://127.0.0.1:48719']) assert.equal(guardPort(u), u);
  for (const u of ['ws://localhost:48715', 'wss://127.0.0.1:48715', 'ws://127.0.0.1:48720', 'ws://127.0.0.1:80', 'ws://evil.example:48715', 'ws://127.0.0.1:48715.evil.com']) assert.throws(() => guardPort(u), /blocked/, u);
});
await t('rows registered: mt5, ninja, ibkr, Beta, bridge', () => {
  for (const id of ['mt5', 'ninja', 'ibkr']) { const s = SOURCES.find((x) => x.id === id); assert.ok(s && s.beta && s.bridge && s.state === 'ready'); assert.ok(ADAPTERS[id]); }
});

// ---- fake helper (JS side of the protocol; the real Python helper is tested in tools/bridge/tests) ----
const TOKEN = 'a'.repeat(64), ORIGIN = 'https://tradezoro.com';
const mac = (...p) => createHmac('sha256', TOKEN).update(p.join('|')).digest('hex');
globalThis.location = { origin: ORIGIN };
class FakeWS {
  static log = []; static mode = 'good'; static open = new Set(); static current = null;
  constructor(url) { this.url = url; this.sent = []; FakeWS.log.push(url); FakeWS.current = this; this.hn = 'h'.repeat(32);
    setTimeout(() => { if (FakeWS.mode === 'down' || !PORTS.includes(+url.split(':')[2])) return this.onerror && this.onerror(); this.r({ t: 'welcome', hn: this.hn, v: 1, paired: true, source: FakeWS.src || 'mt5' }); }, 0); }
  r(o) { setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(o) }), 0); }
  close() { this.closed = true; }
  send(m) {
    const j = JSON.parse(m); this.sent.push(j); const port = +this.url.split(':')[2];
    if (j.t === 'pair') this.r(j.code === '12345678' ? { t: 'paired', token: TOKEN } : { t: 'error', code: 'bad-code', msg: 'That code is not right.' });
    if (j.t === 'hello') this.r({ t: 'ready', source: FakeWS.src || 'mt5', proof: FakeWS.mode === 'badproof' ? 'f'.repeat(64) : mac('helper', j.sn, this.hn, port, ORIGIN), caps: [] });
    if (j.t === 'history') this.r({ t: 'bars', rid: j.rid, sym: j.sym, tf: j.tf, bars: [{ time: 2000, open: 2, high: 3, low: 1, close: 2, volume: 5 }, { time: 1000, open: 1, high: 2, low: 1, close: 2, volume: 4 }, { time: 'x', open: 1, high: 1, low: 1, close: 1 }] });
    if (j.t === 'subscribe') { FakeWS.subs = j.syms; setTimeout(() => this.r({ t: 'tick', sym: j.syms[0], price: 1.5, ts: 61000, size: 2 }), 5); }
  }
}
const d = { WS: FakeWS };

await t('proofOf matches HMAC vector', async () => { assert.equal(await proofOf(TOKEN, 'site', 's', 'h', 48715, ORIGIN), mac('site', 's', 'h', 48715, ORIGIN)); });
await t('pair: bad code message, good code returns token + port; code must be 8 digits', async () => {
  await assert.rejects(pair('mt5', '123', d), /8-digit/);
  await assert.rejects(pair('mt5', '00000000', d), /not right/);
  const r = await pair('mt5', '1234 5678', d); assert.equal(r.token, TOKEN); assert.equal(r.port, 48715);
  assert.deepEqual(FakeWS.current.sent[0], { t: 'pair', code: '12345678', sn: FakeWS.current.sent[0].sn });
});
await t('pair rejects a helper for a different source', async () => { FakeWS.src = 'ibkr'; await assert.rejects(pair('mt5', '12345678', d), /different source/); FakeWS.src = null; });
await t('check(): mutual proof ok; wrong helper proof refused; helper down = unreachable', async () => {
  const ad = ADAPTERS.mt5; await ad.check({ token: TOKEN }, d);
  FakeWS.mode = 'badproof'; await assert.rejects(ad.check({ token: TOKEN }, d), /did not prove/);
  FakeWS.mode = 'down'; await assert.rejects(ad.check({ token: TOKEN }, d), /reach the helper/); FakeWS.mode = 'good';
});
await t('getBars: sorted, junk dropped, limit applied, every send is allow-listed', async () => {
  const c = { token: TOKEN, port: 48715 };
  const bars = await ADAPTERS.mt5.getBars(c, 'byo:EURUSD', '1m', { limit: 1 }, d);
  assert.deepEqual(bars, [{ time: 2000, open: 2, high: 3, low: 1, close: 2, volume: 5 }]);
  const h = FakeWS.current.sent.find((x) => x.t === 'history'); assert.equal(h.sym, 'EURUSD'); assert.equal(h.tf, '1');
  for (const s of FakeWS.current.sent) guardSend(s);
  assert.deepEqual(await ADAPTERS.mt5.getBars(c, 'bad;sym', '1', {}, d), []);
});
await t('live: tick becomes a candle', async () => {
  const c = { token: TOKEN, port: 48715 }; const got = [];
  const hub = ADAPTERS.mt5.hub(c, () => {}, d);
  const off = ADAPTERS.mt5.subscribe(hub, 'byo:EURUSD', '1', { time: 60000, open: 1, high: 1, low: 1, close: 1, volume: 0 }, (b) => got.push(b));
  await new Promise((r) => setTimeout(r, 700)); off(); hub.stop();
  assert.deepEqual(FakeWS.subs, ['EURUSD']); assert.ok(got.length >= 1 && got[0].close === 1.5 && got[0].time === 60000, JSON.stringify(got));
});
console.log(n + ' tests passed'); process.exit(0);
