// OKX provider + core parsers against recorded fixtures.  node tools/tests/okx-core.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OkxProvider, parseTicker, rowToBar, rowsToBars, listFromInstruments } from '../../assets/vendor/vela-0.6.17-s1/providers/okx.js';
import * as C from '../../assets/okx-core.js';
const fx = (n) => JSON.parse(fs.readFileSync(new URL('./fixtures/' + n, import.meta.url)));
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };

assert.deepEqual(parseTicker('BTC-USDT-SWAP'), { instId: 'BTC-USDT-SWAP', isSwap: true });
assert.deepEqual(parseTicker('btcusdt.p'), { instId: 'BTC-USDT-SWAP', isSwap: true });
assert.deepEqual(parseTicker('ETH-USDT'), { instId: 'ETH-USDT', isSwap: false }); ok('ticker parsing');

// kline rows: newest first in, sorted oldest first out; swap volume = base coin (volCcy), spot = vol
const rows = fx('okx-candles.json').data;
const bars = rowsToBars(rows, true);
assert.equal(bars.length, rows.length);
assert.ok(bars[0].time < bars[bars.length - 1].time);
assert.deepEqual(rowToBar(rows[0], true), { time: +rows[0][0], open: +rows[0][1], high: +rows[0][2], low: +rows[0][3], close: +rows[0][4], volume: +rows[0][6] });
assert.equal(rowToBar(rows[0], false).volume, +rows[0][5]); ok('kline rows -> bars, swap volume in coins');

// symbol lists: spot USDT/USDC/USD live, swaps linear only
const list = listFromInstruments(fx('okx-instruments-spot.json'), fx('okx-instruments-swap.json'));
assert.ok(list.find((x) => x.ticker === 'BTC-USDT' && x.type === 'crypto'));
assert.ok(list.find((x) => x.ticker === 'BTC-USDT-SWAP' && x.type === 'futures' && /Perpetual/.test(x.description))); ok('symbol list');

// paging: latest 300 from /candles then older 100-row pages from /history-candles, trimmed to the limit
{
  const calls = []; let T0 = 1700000000000, step = 60000;
  const mk = (from, cnt) => Array.from({ length: cnt }, (_, i) => { const t = from - i * step; return [String(t), '1', '2', '0.5', '1.5', '10', '1', '1', '1']; });
  globalThis.fetch = async (u) => {
    calls.push(u); const q = new URL(u);
    const body = q.pathname.endsWith('/candles') ? mk(T0, 300) : mk(+q.searchParams.get('after') - step, 100);
    return { ok: true, status: 200, json: async () => ({ code: '0', data: body }) };
  };
  const b = await new OkxProvider().getBars('BTC-USDT', '1', { limit: 650 });
  assert.equal(b.length, 650); assert.equal(b[b.length - 1].time, T0); assert.equal(new Set(b.map((x) => x.time)).size, 650);
  assert.ok(calls[0].includes('/market/candles?') && calls[1].includes('/market/history-candles?') && calls[1].includes('after=' + (T0 - 299 * step)));
  ok('history paging (candles + history-candles, no gaps or dupes)');
  calls.length = 0; step = 900000;
  const b2 = await new OkxProvider().getBars('BTC-USDT', '45', { limit: 10 });   // 45m -> built from 15m
  assert.equal(b2.length, 10); assert.ok(calls[0].includes('bar=15m')); ok('non-native timeframe aggregated from a smaller one');
}

// books: recorded snapshot + updates must satisfy the OKX checksum on every message
{
  const msgs = fx('okx-ws-public.json').filter((m) => m.arg && m.arg.channel === 'books' && m.data);
  assert.equal(msgs[0].action, 'snapshot');
  const bk = new C.OkxBook(); let upd = 0;
  for (const m of msgs) { const r = bk.handle(m); assert.ok(r.ok, 'chain ' + m.action); if (!r.snapshot) upd++; }
  assert.ok(upd > 5); ok('book snapshot + ' + upd + ' updates chain by seqId');
  const bad = new C.OkxBook(); bad.handle(msgs[0]); const m2 = JSON.parse(JSON.stringify(msgs[1])); m2.data[0].prevSeqId = 1;
  assert.equal(bad.handle(m2).ok, false); ok('a sequence gap is detected');
  const bc = new C.OkxBook(); bc.handle(msgs[0]); const m3 = JSON.parse(JSON.stringify(msgs[1])); m3.data[0].checksum = 12345;
  assert.equal(bc.handle(m3).ok, false); ok('a wrong non-zero checksum is detected');
  const gd = new C.OkxBook(); gd.apply('b', [['1', '2']]); gd.apply('a', [['3', '4']]);
  const mm = { action: 'update', data: [{ bids: [], asks: [], checksum: gd.checksum() }] }; assert.equal(gd.handle(mm).ok, true); ok('a right checksum passes');
  assert.deepEqual(C.numRows([['100', '3']], 0.01), [[100, 0.03]]); ok('contracts -> base coin');
}
// trades: side is the taker
{
  const tr = fx('okx-ws-public.json').filter((m) => m.arg && m.arg.channel === 'trades' && m.data).flatMap((m) => m.data);
  assert.ok(tr.length); for (const r of tr) { const t = C.tradeOf(r, 0.01); assert.equal(t.side, r.side === 'sell' ? -1 : 1); assert.equal(t.s, +r.sz * 0.01); assert.equal(t.t, +r.ts); }
  ok('trade rows: taker side, size, time');
}
assert.deepEqual(C.instIds({ base: 'BTC', quote: 'USDT', perp: true }), ['BTC-USDT-SWAP', 'BTC-USDC-SWAP']);
assert.equal(C.crc32('123456789'), -873187034); ok('crc32 + instrument ids');
console.log(n + ' checks passed');
