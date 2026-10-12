// Node unit tests for assets/paper-engine.js (Charts paper trading, Owner order 2026-10-12).
//   node tools/tests/paper-engine.test.js
// Fills (market + slippage, limit touch, gap fills, stop entries), OCO brackets, SL-first on an
// ambiguous segment, P&L with contract point values, commission, net positions (add / reduce /
// flip), reset, closed-market rules, persistence round trip and load-time hardening.
const assert = require('assert');
const path = require('path');
const PE = require(path.join(__dirname, '..', '..', 'assets', 'paper-engine.js'));

let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n   ' + (e && e.stack || e)); } }

let clock = Date.parse('2026-10-07T14:00:00Z');
let open = true;
const deps = () => ({ now: () => clock, isOpen: () => open, tickOf: () => 0.01 });
const acct = (bal) => { open = true; return PE.PaperAccount.fresh(bal == null ? 100000 : bal, deps()); };
const seg = (o, h, l, c) => ({ t: clock, o, h, l, c });

t('default balance $100,000 USD, custom balance honoured, silly balance falls back', () => {
  assert.strictEqual(acct().summary().balance, 100000);
  assert.strictEqual(acct().summary().currency, 'USD');
  assert.strictEqual(acct(25000).summary().balance, 25000);
  assert.strictEqual(acct(-5).summary().balance, 100000);
});

t('point values per the brief', () => {
  const pv = (s) => PE.specOf('futures:' + s + '1!').pointValue;
  assert.deepStrictEqual(['NQ', 'MNQ', 'ES', 'MES', 'YM', 'MYM', 'GC', 'MGC', 'SI', 'SIL', 'CL', 'MCL', 'RTY', 'M2K'].map(pv), [20, 2, 50, 5, 5, 0.5, 100, 10, 5000, 1000, 1000, 100, 50, 5]);
  assert.strictEqual(PE.specOf('binance:BTCUSDT', 0.01).pointValue, 1);
  assert.strictEqual(PE.specOf('fx:EURUSD').ok, false);
  assert.strictEqual(PE.specOf('binance:ETHBTC').ok, false);
});

t('market buy fills at last price, P&L uses NQ $20/point', () => {
  const a = acct();
  a.setLast('futures:NQ1!', 21000);
  const ev = a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 2 }).events;
  assert.strictEqual(ev[0].type, 'open'); assert.strictEqual(ev[0].price, 21000);
  a.setLast('futures:NQ1!', 21010);
  assert.strictEqual(a.summary().unrealized, 10 * 2 * 20);   // +$400
  const cl = a.closePosition('futures:NQ1!');
  assert.strictEqual(cl[0].type, 'close'); assert.strictEqual(cl[0].trade.pnl, 400);
  assert.strictEqual(a.summary().balance, 100400);
  assert.strictEqual(a.summary().realized, 400);
});

t('market fill adds slippage ticks against you; commission per contract per side', () => {
  const a = acct();
  a.setSettings({ slippage: 2, commission: 2.5 });
  a.setLast('futures:ES1!', 5000);
  const ev = a.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 1 }).events;
  assert.strictEqual(ev[0].price, 5000.5);                    // 2 ticks x 0.25
  a.setLast('futures:ES1!', 5010);
  const cl = a.closePosition('futures:ES1!');
  assert.strictEqual(cl[0].price, 5009.5);                    // sell side slips down
  assert.strictEqual(cl[0].trade.gross, (5009.5 - 5000.5) * 50);
  assert.strictEqual(cl[0].trade.fees, 5);
  assert.strictEqual(cl[0].trade.pnl, 450 - 5);
  assert.strictEqual(a.summary().balance, 100000 + 445);
});

t('buy limit waits, fills on touch at the limit price, gap fills at the (better) open', () => {
  const a = acct();
  a.setLast('futures:NQ1!', 21000);
  const { order } = a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20990 });
  assert.ok(order && order.id);
  assert.strictEqual(a.onSegment('futures:NQ1!', seg(21000, 21002, 20995, 20996)).length, 0);
  const ev = a.onSegment('futures:NQ1!', seg(20996, 20997, 20989, 20992));
  assert.strictEqual(ev[0].type, 'open'); assert.strictEqual(ev[0].price, 20990);
  assert.strictEqual(a.state.orders.length, 0);
  // gap: sell limit above, next segment opens above it -> fills at the open
  const b = acct(); b.setLast('futures:NQ1!', 21000);
  b.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'limit', qty: 1, price: 21010 });
  const g = b.onSegment('futures:NQ1!', seg(21020, 21025, 21015, 21018));
  assert.strictEqual(g[0].price, 21020);
});

t('stop entry fills when traded through, gap = worse open, slippage applied', () => {
  const a = acct(); a.setSettings({ slippage: 1 }); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'stop', qty: 1, price: 21010 });
  const ev = a.onSegment('futures:NQ1!', seg(21012, 21015, 21011, 21014));   // gap above the stop
  assert.strictEqual(ev[0].price, 21012.25);
});

t('wrong-side limit / stop and bad brackets are rejected with a message', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 21010 }), /below the current price/);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'stop', qty: 1, price: 21010 }), /below the current price/);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, sl: 21005 }), /stop loss must be below/);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'market', qty: 1, tp: 21005 }), /take profit must be below/);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 0 }), /greater than zero/);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 0.4 }), /smallest size is 1 contract/);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1.6 });
  assert.strictEqual(a.position('futures:NQ1!').qty, 2, 'futures quantity rounds to whole contracts');
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 501 }), /largest paper order/);
});

t('bracket is OCO: TP fills, SL leg is gone; P&L at TP', () => {
  const a = acct(); a.setLast('futures:MNQ1!', 21000);
  a.placeOrder({ symbol: 'futures:MNQ1!', side: 'buy', type: 'market', qty: 3, tp: 21020, sl: 20990 });
  const p = a.position('futures:MNQ1!'); assert.strictEqual(p.tp, 21020); assert.strictEqual(p.sl, 20990);
  const ev = a.onSegment('futures:MNQ1!', seg(21010, 21021, 21008, 21019));
  assert.strictEqual(ev[0].type, 'tp'); assert.strictEqual(ev[0].price, 21020);
  assert.strictEqual(ev[0].trade.pnl, 20 * 3 * 2);
  assert.strictEqual(a.position('futures:MNQ1!'), null);
  assert.strictEqual(a.onSegment('futures:MNQ1!', seg(21000, 21000, 20980, 20985)).length, 0, 'SL leg cancelled with the TP');
});

t('segment touching both TP and SL -> stop loss assumed first; SL gap fills at the open', () => {
  const a = acct(); a.setLast('futures:GC1!', 2400);
  a.placeOrder({ symbol: 'futures:GC1!', side: 'buy', type: 'market', qty: 1, tp: 2410, sl: 2395 });
  const ev = a.onSegment('futures:GC1!', seg(2400, 2411, 2394, 2402));
  assert.strictEqual(ev[0].type, 'sl'); assert.strictEqual(ev[0].trade.pnl, -5 * 100);
  const b = acct(); b.setLast('futures:CL1!', 70);
  b.placeOrder({ symbol: 'futures:CL1!', side: 'sell', type: 'market', qty: 1, sl: 70.5 });
  const g = b.onSegment('futures:CL1!', seg(70.8, 71, 70.7, 70.9));   // gaps above the stop
  assert.strictEqual(g[0].price, 70.8); assert.strictEqual(g[0].trade.pnl, -0.8 * 1000);
});

t('limit with bracket fills and the same segment can hit its stop (conservative)', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20990, sl: 20980, tp: 21020 });
  const ev = a.onSegment('futures:NQ1!', seg(20995, 20996, 20975, 20978));
  assert.deepStrictEqual(ev.map((e) => e.type), ['open', 'sl']);
  assert.strictEqual(ev[1].trade.pnl, -10 * 20);
});

t('net position: add averages, opposite reduces, flip opens the other side', () => {
  const a = acct(); a.setLast('futures:ES1!', 5000);
  a.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 1 });
  a.setLast('futures:ES1!', 5010);
  a.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 1 });
  assert.strictEqual(a.position('futures:ES1!').qty, 2); assert.strictEqual(a.position('futures:ES1!').avg, 5005);
  const r = a.placeOrder({ symbol: 'futures:ES1!', side: 'sell', type: 'market', qty: 1 }).events;
  assert.strictEqual(r[0].type, 'reduce'); assert.strictEqual(r[0].trade.pnl, 5 * 50);
  a.setLast('futures:ES1!', 5020);
  const f = a.reversePosition('futures:ES1!');
  assert.deepStrictEqual(f.map((e) => e.type), ['close', 'open']);
  assert.strictEqual(a.position('futures:ES1!').side, 'sell'); assert.strictEqual(a.position('futures:ES1!').qty, 1);
});

t('crypto per unit: 0.5 BTC +$100 move = +$50', () => {
  const a = acct(); a.setLast('binance:BTCUSDT', 64000);
  a.placeOrder({ symbol: 'binance:BTCUSDT', side: 'buy', type: 'market', qty: 0.5 });
  a.setLast('binance:BTCUSDT', 64100);
  assert.strictEqual(a.summary().unrealized, 50);
});

t('closed market: market orders rejected (and logged), limits wait and do not fill', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  const { order } = a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20990 });
  open = false;
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 }), /Market closed/);
  assert.strictEqual(a.state.history[a.state.history.length - 1].kind, 'reject');
  assert.throws(() => a.closePosition('futures:NQ1!'), /already closed/);
  assert.strictEqual(a.onSegment('futures:NQ1!', seg(20990, 20991, 20980, 20985)).length, 0, 'no fill while closed');
  assert.ok(a.state.orders.find((o) => o.id === order.id), 'limit still working');
  open = true;
  assert.strictEqual(a.onSegment('futures:NQ1!', seg(20990, 20991, 20980, 20985))[0].type, 'open');
});

t('modify: drag TP / SL validates the side; moving an order drags its bracket', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, tp: 21020, sl: 20980 });
  a.modifyPosition('futures:NQ1!', { tp: 21030.1 });
  assert.strictEqual(a.position('futures:NQ1!').tp, 21030);
  assert.throws(() => a.modifyPosition('futures:NQ1!', { tp: 20990 }), /above the current price/);
  assert.throws(() => a.modifyPosition('futures:NQ1!', { sl: 21010 }), /below the current price/);
  const { order } = a.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'limit', qty: 1, price: 21050, sl: 21060, tp: 21040 });
  a.modifyOrder(order.id, { price: 21055 });
  assert.deepStrictEqual([order.price, order.sl, order.tp], [21055, 21065, 21045]);
  assert.throws(() => a.modifyOrder(order.id, { price: 20990 }), /stay above/);
  a.cancelOrder(order.id);
  assert.strictEqual(a.state.orders.length, 0);
  assert.strictEqual(a.state.history[a.state.history.length - 1].kind, 'cancel');
});

t('flatten all closes every position and cancels every order', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000); a.setLast('binance:BTCUSDT', 64000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 });
  a.placeOrder({ symbol: 'binance:BTCUSDT', side: 'sell', type: 'market', qty: 1 });
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20900 });
  const r = a.flattenAll();
  assert.strictEqual(r.events.length, 2); assert.strictEqual(Object.keys(a.state.positions).length, 0); assert.strictEqual(a.state.orders.length, 0);
});

t('reset: new balance, positions/orders/trades cleared, settings kept', () => {
  const a = acct(); a.setSettings({ commission: 1.2 }); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 });
  a.reset(50000);
  const s = a.summary();
  assert.deepStrictEqual([s.balance, s.equity, s.positions, s.orders, s.trades], [50000, 50000, 0, 0, 0]);
  assert.strictEqual(a.settings.commission, 1.2);
});

t('JSON round trip keeps the account; tampered state is hardened', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 2, tp: 21050 });
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20950 });
  const b = new PE.PaperAccount(JSON.parse(JSON.stringify(a)), deps());
  assert.strictEqual(b.position('futures:NQ1!').qty, 2); assert.strictEqual(b.state.orders.length, 1);
  assert.ok(b.state.nextId > a.state.orders[0].id);
  const bad = new PE.PaperAccount({ v: 1, startBalance: 'x', balance: null, positions: { 'evil:X': { qty: 1, avg: 1 }, 'futures:NQ1!': { side: 'buy', qty: -1, avg: 1 } }, orders: [{ symbol: 'futures:NQ1!', type: 'market' }], settings: { commission: 1e9 } }, deps());
  assert.strictEqual(Object.keys(bad.state.positions).length, 0); assert.strictEqual(bad.state.orders.length, 0); assert.strictEqual(bad.settings.commission, 100);
  assert.strictEqual(new PE.PaperAccount('garbage', deps()).summary().balance, 100000);
});

t('day P&L counts trades closed since the day start', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 });
  a.setLast('futures:NQ1!', 21005); a.closePosition('futures:NQ1!');
  assert.strictEqual(a.summary(clock - 1000).dayPnl, 100);
  assert.strictEqual(a.summary(clock + 1000).dayPnl, 0);
});

t('the engine has no network or broker surface', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', '..', 'assets', 'paper-engine.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|rithmic|tradovate|import\(/i.test(src));
});

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
