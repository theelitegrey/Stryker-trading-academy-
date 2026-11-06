// Every crypto venue adapter registers through assets/orderflow-venues.js and comes out in its interface:
// side 'buy' | 'sell', footprint row never finer than autoTick. node tools/tests/orderflow-venues-all.test.mjs
import assert from 'node:assert/strict';
const V = '?v=889';
const R = await import('../../assets/orderflow-venues.js' + V);
for (const v of ['hyperliquid', 'bybit', 'okx', 'bitget', 'kraken']) await import('../../assets/orderflow-venue-' + v + '.js' + V);
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };

for (const id of ['hyperliquid', 'bybit', 'okx', 'bitget', 'kraken']) {
  const v = R.getVenue(id);
  assert.ok(v && typeof v.bookStream === 'function' && typeof v.tradeStream === 'function' && typeof v.tick === 'function', id);
}
ok('5 venues registered with bookStream / tradeStream / tick');

// side mapping, through a fake short-form adapter
R.registerVenue('fakevenue', { bookStream: () => () => {}, tradeStream: (p, cb) => { cb.trade({ t: 1, p: 100, s: 2, side: 1 }); cb.trade({ t: 2, p: 100, s: 3, side: -1 }); cb.trade({ t: 3, p: 100, s: 1, side: 'sell' }); return () => {}; }, tick: () => 0.01 });
const got = []; R.getVenue('fakevenue').tradeStream('X', { trade: (x) => got.push(x.side), status: () => {} });
assert.deepEqual(got, ['buy', 'sell', 'sell']);
ok('numeric side 1 / -1 -> buy / sell; string side kept');

// tick: the exchange step is a floor, the shared autoTick rule wins above it (BTC 80k -> $1 rows)
assert.equal(R.getVenue('fakevenue').tick('X', 80000), R.autoTick(80000));
R.registerVenue('coarse', { bookStream: () => () => {}, tradeStream: () => () => {}, tick: () => 5 });
assert.equal(R.getVenue('coarse').tick('X', 80000), 5);
assert.equal(R.getVenue('fakevenue').tick('X', 0), 0.01);
ok('tick = max(exchange tick, autoTick(price))');

// the bridge into the chart's trade shape
const out = []; R.venueTradeSource(R.getVenue('fakevenue'))('X', (l) => out.push(...l), () => {});
assert.equal(out.length, 0);   // buffered until 'live'
ok('venueTradeSource buffers the backfill until live');

console.log(n + ' passed');
