// Hyperliquid order-flow adapter parsers + the venue registry. node tools/tests/orderflow-venue-hyperliquid.test.mjs
// Fixture: tests/fixtures/hyperliquid-orderflow.json (recorded from wss://api.hyperliquid.xyz/ws, 2026-11-06).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTrades, parseBook, mergeBooks, sigOf } from '../../assets/orderflow-venue-hyperliquid.js';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
// the registry instance the adapter registered into (same ?v= specifier as the adapter's import)
const spec = /from '\.\/(orderflow-venues\.js[^']*)'/.exec(fs.readFileSync(new URL('../../assets/orderflow-venue-hyperliquid.js', import.meta.url), 'utf8'))[1];
const { getVenue, venueIds, venueBookSource, venueTradeSource } = await import('../../assets/' + spec);
const fx = JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/hyperliquid-orderflow.json', import.meta.url)));

// trades: side B = taker bought, A = taker sold; numbers parsed
{
  const raw = fx.trades.flat();
  const t = parseTrades(raw);
  assert.equal(t.length, raw.length);
  raw.forEach((x, i) => { assert.equal(t[i].side, x.side === 'B' ? 'buy' : 'sell'); assert.equal(t[i].p, Number(x.px)); assert.equal(t[i].s, Number(x.sz)); assert.equal(t[i].t, x.time); });
  assert.deepEqual(parseTrades([{ px: '1', sz: '0', side: 'B', time: 1 }, { px: 'x', sz: '1', side: 'A', time: 1 }]), []);
  assert.deepEqual(parseTrades(null), []);
  ok('trade side + numbers (' + t.length + ' recorded trades)');
}
// book: bids desc, asks asc, numbers; precision detection
const books = Object.values(fx.books).map((b) => ({ sig: sigOf(b), b: parseBook(b) }));
{
  for (const { b } of books) {
    assert.ok(b.bids.length > 0 && b.asks.length > 0);
    for (let i = 1; i < b.bids.length; i++) assert.ok(b.bids[i][0] < b.bids[i - 1][0]);
    for (let i = 1; i < b.asks.length; i++) assert.ok(b.asks[i][0] > b.asks[i - 1][0]);
    assert.ok(b.bids[0][0] < b.asks[0][0]);
  }
  const sigs = new Set(books.map((x) => x.sig));
  assert.ok(sigs.has(0) && sigs.has(4) && sigs.has(3), [...sigs].join());
  assert.equal(sigOf({ levels: [[{ px: '75623.0' }], [{ px: '75624.0' }]] }), 0);
  assert.equal(sigOf({ levels: [[{ px: '75620.0' }], [{ px: '75630.0' }]] }), 4);
  assert.equal(sigOf({ levels: [[{ px: '75600.0' }], [{ px: '75700.0' }]] }), 3);
  ok('book parse + precision detection ' + books.map((x) => x.sig).join(','));
}
// merge: finest first, coarse rows only beyond the fine span, no double counting, sorted sides
{
  const L = [0, 4, 3].map((s) => books.find((x) => x.sig === s).b);
  const m = mergeBooks(L);
  assert.ok(m.bids.length > L[0].bids.length && m.asks.length > L[0].asks.length);
  assert.deepEqual(m.bids.slice(0, L[0].bids.length), L[0].bids);
  for (let i = 1; i < m.bids.length; i++) assert.ok(m.bids[i][0] < m.bids[i - 1][0], 'bids sorted');
  for (let i = 1; i < m.asks.length; i++) assert.ok(m.asks[i][0] > m.asks[i - 1][0], 'asks sorted');
  // synthetic: fine 100..98 step 1, coarse 100,90,80 step 10 -> 100 dropped (straddles), 90 dropped (its row 90..100 overlaps 98), 80 kept
  const s = mergeBooks([{ bids: [[100, 1], [99, 1], [98, 1]], asks: [[101, 1]] }, { bids: [[100, 5], [90, 5], [80, 5]], asks: [[110, 5], [120, 5]] }]);
  assert.deepEqual(s.bids.map((r) => r[0]), [100, 99, 98, 80]);
  assert.deepEqual(s.asks.map((r) => r[0]), [101, 120]);
  ok('merged precisions: ' + m.bids.length + ' bids / ' + m.asks.length + ' asks, deepest bid ' + m.bids[m.bids.length - 1][0]);
}
// registry + generic book / trade bridges (fake venue)
{
  assert.ok(venueIds().includes('hyperliquid') && getVenue('HYPERLIQUID'));
  assert.equal(getVenue('nope'), null);
  let cbB, cbT, books2 = [], st = [], got = [];
  const fake = { bookStream: (p, cb) => { cbB = cb; return () => {}; }, tradeStream: (p, cb) => { cbT = cb; return () => {}; } };
  venueBookSource(fake, 'X', (b) => books2.push({ bb: b.bestBid, ba: b.bestAsk, n: b.bids.size + b.asks.size }), (s) => st.push(s));
  cbB.diff([[1, 1]], []);                       // before the first snapshot: ignored
  assert.equal(books2.length, 0);
  cbB.snapshot([[10, 1], [9, 2]], [[11, 1], [12, 3]]);
  cbB.diff([[10, 0], [9.5, 4]], [[10.5, 1]]);
  assert.deepEqual(books2[1], { bb: 9.5, ba: 10.5, n: 5 });
  assert.deepEqual(st, ['live']);
  const src = venueTradeSource(fake);
  src('X', (ts, back) => got.push([ts.map((t) => t.side + t.price), back]), () => {});
  cbT.trade({ t: 1, p: 5, s: 1, side: 'buy' }); cbT.status('live'); cbT.trade({ t: 2, p: 6, s: 1, side: 'sell' });
  assert.deepEqual(got, [[['buy5'], true], [['sell6'], false]]);
  ok('registry + book (snapshot, diff, best) and trade (backfill then live) bridges');
}
console.log(n + ' passed');
