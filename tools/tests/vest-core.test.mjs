// Vest helpers + the /api/vest pass-through, on real captured data (tools/tests/fixtures/vest). Run: node tools/tests/vest-core.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSymbols, parseKlines, parseTrades, parseWsTrades, parseDepth, pickTicks, symbolFor, aggregate, monthOf } from '../../assets/vest-core.js';
import { buildUrl } from '../../functions/api/vest/[[path]].js';
const fx = (n) => JSON.parse(readFileSync(new URL('./fixtures/vest/' + n, import.meta.url), 'utf8'));

const syms = parseSymbols(fx('exchangeInfo.json'));
const by = Object.fromEntries(syms.map((s) => [s.ticker, s]));
assert.equal(by['BTC-PERP'].type, 'crypto');
assert.equal(by['AMD-USD-PERP'].type, 'stock');
assert.equal(by['NDX-USD-PERP'].type, 'futures');
assert.equal(by['BTC-PERP'].mintick, 0.01);
assert.equal(by['BTC-PERP'].description, 'Bitcoin');
assert.ok(/\(halted\)$/.test(by['CMCSA-USD-PERP'].description) && by['CMCSA-USD-PERP'].halted);
assert.deepEqual(pickTicks(by['BTC-PERP'].ticks), ['0.01', '1', '100']);
assert.equal(symbolFor(syms, 'vest:btc-perp'), 'BTC-PERP');
assert.equal(symbolFor(syms, { base: 'AMD' }), 'AMD-USD-PERP');
assert.equal(symbolFor(syms, 'NOPE-PERP'), '');

const bars = parseKlines(fx('k_btc.json'));
assert.ok(bars.length > 50);
assert.ok(bars.every((b, i) => i === 0 || b.time > bars[i - 1].time), 'oldest first');
assert.ok(bars.every((b) => b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close)));
const h4 = aggregate(bars, (t) => Math.floor(t / 144e5) * 144e5);
assert.ok(h4.length < bars.length / 3);
assert.equal(h4[1].open, bars.find((b) => b.time === h4[1].time).open);
assert.equal(monthOf(Date.UTC(2026, 10, 8, 5)), Date.UTC(2026, 10, 1));

const rows = fx('trades_btc.json'), tr = parseTrades(rows);
assert.equal(tr.length, rows.length);
assert.ok(tr.every((t, i) => i === 0 || t.t >= tr[i - 1].t));
for (const r of rows) { const t = tr.find((x) => x.id === r.id); assert.equal(t.side, Number(r.qty) > 0 ? 1 : -1); assert.equal(t.s, Math.abs(Number(r.qty))); }
assert.deepEqual(parseWsTrades({ channel: 'BTC-PERP@trades', data: [{ id: 'a', price: '100', qty: '-2', time: 5 }] }), [{ id: 'a', t: 5, p: 100, s: 2, side: -1 }]);
assert.deepEqual(parseWsTrades({ channel: 'BTC-PERP@depth', data: {} }), []);

const d = fx('ws_depth.json');
for (const ch of Object.keys(d)) {
  const b = parseDepth(d[ch]);
  assert.equal(b.bids.length, 20); assert.equal(b.asks.length, 20);
  assert.ok(b.bids[0][0] < b.asks[0][0], ch + ' not crossed');
}
// the proxy: allow-list only
assert.equal(buildUrl(['klines'], '?symbol=BTC-PERP&interval=1h').url, 'https://server-prod.hz.vestmarkets.com/v2/klines?symbol=BTC-PERP&interval=1h');
assert.equal(buildUrl(['account'], '').status, 404);
assert.equal(buildUrl(['klines'], '?symbol=../x').status, 400);
assert.equal(buildUrl(['klines'], '?apiKey=1').status, 400);
console.log('vest-core ok');
