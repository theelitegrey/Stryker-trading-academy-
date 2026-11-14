// Unit tests for assets/paper-hotkeys.js + the engine's saved hotkeys.  node tools/tests/paper-hotkeys.test.js
const assert = require('assert'), path = require('path');
const K = require('../../assets/paper-hotkeys.js'), PE = require('../../assets/paper-engine.js');
let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n  ' + (e.stack || e)); } };
const ev = (o) => Object.assign({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, target: { tagName: 'DIV' } }, o);
t('combo from event', () => { assert.strictEqual(K.comboFromEvent(ev({ key: 'b', code: 'KeyB', shiftKey: true })), 'Shift+B'); assert.strictEqual(K.comboFromEvent(ev({ key: '5', code: 'Digit5', ctrlKey: true, altKey: true })), 'Ctrl+Alt+5'); });
t('bare modifier is not a combo', () => assert.strictEqual(K.comboFromEvent(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true })), ''));
t('reserved: Esc, browser, chart keys', () => { assert(K.reserved('Escape')); assert(K.reserved('Ctrl+W')); assert(K.reserved('Alt+A')); assert(K.reserved('Shift+ArrowRight')); assert(K.reserved('Space')); assert.strictEqual(K.reserved('B'), null); assert.strictEqual(K.reserved('Shift+B'), null); });
t('conflict finds the other action', () => { const m = { buyMarket: 'B' }; assert.strictEqual(K.conflict(m, 'B', 'sellMarket'), 'buyMarket'); assert.strictEqual(K.conflict(m, 'B', 'buyMarket'), null); assert.strictEqual(K.conflict(m, 'S', 'x'), null); });
t('match: assigned key fires', () => assert.strictEqual(K.match({ cancelAll: 'Shift+C' }, ev({ key: 'C', code: 'KeyC', shiftKey: true })), 'cancelAll'));
t('match: nothing assigned = nothing happens (defaults unchanged)', () => assert.strictEqual(K.match({}, ev({ key: 'b', code: 'KeyB' })), null));
t('match: ignored while typing', () => { for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.strictEqual(K.match({ buyMarket: 'B' }, ev({ key: 'b', code: 'KeyB', target: { tagName: tag } })), null); assert.strictEqual(K.match({ buyMarket: 'B' }, ev({ key: 'b', code: 'KeyB', target: { tagName: 'DIV', isContentEditable: true } })), null); });
t('match: ignored on key repeat and IME', () => { assert.strictEqual(K.match({ buyMarket: 'B' }, ev({ key: 'b', code: 'KeyB', repeat: true })), null); assert.strictEqual(K.match({ buyMarket: 'B' }, ev({ key: 'b', code: 'KeyB', isComposing: true })), null); });
t('match: modifiers must match exactly', () => assert.strictEqual(K.match({ buyMarket: 'B' }, ev({ key: 'B', code: 'KeyB', shiftKey: true })), null));
t('clean drops unknown actions, junk and duplicate keys', () => { const c = K.clean({ buyMarket: 'B', sellMarket: 'B', nope: 'X', cancelAll: 5, closePos: 'Shift+C' }); assert.deepStrictEqual(c, { buyMarket: 'B', closePos: 'Shift+C' }); });
t('partQty: whole contracts for futures, 0 when too small', () => { assert.strictEqual(K.partQty(5, 0.5, true), 2); assert.strictEqual(K.partQty(1, 0.5, true), 0); assert.strictEqual(K.partQty(3, 0.25, true), 0); assert.strictEqual(K.partQty(0.5, 0.5, false), 0.25); });
t('every action has a unique id and plain label (no vendor names)', () => { assert.strictEqual(new Set(K.IDS).size, K.IDS.length); assert(!K.ACTIONS.some((a) => /tradingview|ninja|tradovate|rithmic|ib\b/i.test(a.label))); });
t('engine: default hotkeys empty, saved + round trip, junk dropped', () => {
  const a = new PE.PaperAccount(); assert.deepStrictEqual(a.settings.hotkeys, {});
  a.setSettings({ hotkeys: { buyMarket: 'B', bad: 7 } }); assert.deepStrictEqual(a.settings.hotkeys, { buyMarket: 'B' });
  const b = PE.sanitize(JSON.parse(JSON.stringify(a.state)), 1); assert.deepStrictEqual(b.settings.hotkeys, { buyMarket: 'B' });
  assert.deepStrictEqual(PE.sanitize({ v: PE.freshState().v, settings: {} }, 1).settings.hotkeys, {});
});

// ---- 4 new actions (breakeven, trailing, close winners/losers, custom partial close)
const NQ = 'CME_MINI:NQ1!', ES = 'CME_MINI:ES1!';
const mk = () => { const o = { clock: 1e12 }; const a = PE.PaperAccount.fresh(100000, { now: () => o.clock, isOpen: () => true, tickOf: () => 0.25 }); return a; };
const seg = (c, h, l, t) => ({ t: t || 1e12, o: c, h: h == null ? c : h, l: l == null ? c : l, c });
t('new actions are listed and conflict-checked like the others', () => {
  for (const id of ['moveBE', 'trailToggle', 'closeWin', 'closeLoss', 'closeCustom']) assert(K.IDS.includes(id));
  assert.strictEqual(K.conflict({ moveBE: 'Shift+K' }, 'Shift+K', 'closeLoss'), 'moveBE');
  assert.deepStrictEqual(K.clean({ closeCustom: 'Shift+Q', closeWin: 'Shift+Q' }), { closeWin: 'Shift+Q' });
});
t('breakeven: moves stop to entry once in profit (long)', () => {
  const a = mk(); a.setLast(NQ, 21000); a.placeOrder({ symbol: NQ, side: 'buy', type: 'market', qty: 2, sl: 20950 });
  assert.throws(() => a.moveToBreakeven(NQ), /not past your entry/);
  a.setLast(NQ, 21010); a.moveToBreakeven(NQ); assert.strictEqual(a.position(NQ).sl, 21000);
  assert.throws(() => a.moveToBreakeven(NQ), /already at or past/);
});
t('breakeven: short, no stop set yet, and no position', () => {
  const a = mk(); a.setLast(NQ, 21000); a.placeOrder({ symbol: NQ, side: 'sell', type: 'market', qty: 1 });
  a.setLast(NQ, 20990); a.moveToBreakeven(NQ); assert.strictEqual(a.position(NQ).sl, 21000);
  assert.throws(() => a.moveToBreakeven(ES), /closed/);
});
t('trailing: needs a stop, trails up behind new highs, never back, toggles off', () => {
  const a = mk(); a.setLast(NQ, 21000); a.placeOrder({ symbol: NQ, side: 'buy', type: 'market', qty: 1 });
  assert.throws(() => a.setTrailing(NQ, true), /Set a stop loss first/);
  a.modifyPosition(NQ, { sl: 20990 }); a.setTrailing(NQ, true); assert.strictEqual(a.position(NQ).trail, 10);
  a.onSegment(NQ, seg(21020, 21030, 21015)); assert.strictEqual(a.position(NQ).sl, 21020);
  a.onSegment(NQ, seg(21023, 21025, 21021)); assert.strictEqual(a.position(NQ).sl, 21020);
  const ev = a.onSegment(NQ, seg(21019, 21022, 21018)); assert(ev.length && !a.position(NQ), 'stop at trailed level fills');
  const b = mk(); b.setLast(NQ, 21000); b.placeOrder({ symbol: NQ, side: 'buy', type: 'market', qty: 1, sl: 20990 }); b.setTrailing(NQ, true); b.setTrailing(NQ, false);
  b.onSegment(NQ, seg(21030, 21040, 21025)); assert.strictEqual(b.position(NQ).sl, 20990); assert.strictEqual(b.position(NQ).trail, null);
});
t('trailing: short trails down; trail survives save/load', () => {
  const a = mk(); a.setLast(NQ, 21000); a.placeOrder({ symbol: NQ, side: 'sell', type: 'market', qty: 1, sl: 21010 }); a.setTrailing(NQ, true);
  a.onSegment(NQ, seg(20980, 20985, 20975)); assert.strictEqual(a.position(NQ).sl, 20985);
  const s = PE.sanitize(JSON.parse(JSON.stringify(a.state)), 1); assert.strictEqual(s.positions[Object.keys(s.positions)[0]].trail, 10);
});
t('close winners / losers only closes the right ones', () => {
  const a = mk(); a.setLast(NQ, 21000); a.placeOrder({ symbol: NQ, side: 'buy', type: 'market', qty: 1 });
  a.setLast(ES, 5000); a.placeOrder({ symbol: ES, side: 'buy', type: 'market', qty: 1 });
  a.setLast(NQ, 21010); a.setLast(ES, 4990);
  a.closeByResult('loss'); assert(a.position(NQ) && !a.position(ES));
  a.closeByResult('loss'); assert(a.position(NQ), 'no losers left: winner untouched');
  a.closeByResult('profit'); assert(!a.position(NQ));
});
t('validQty: empty, junk, zero, over max, step, ok', () => {
  assert(!K.validQty('', 5, 1).ok); assert(!K.validQty('abc', 5, 1).ok); assert(!K.validQty('-2', 5, 1).ok); assert(!K.validQty('0', 5, 1).ok);
  assert(/only hold 5/.test(K.validQty('6', 5, 1).msg)); assert(/whole/.test(K.validQty('1.5', 5, 1).msg));
  assert.deepStrictEqual(K.validQty(' 3 ', 5, 1), { ok: true, qty: 3 }); assert.deepStrictEqual(K.validQty('5', 5, 1), { ok: true, qty: 5 });
  assert.deepStrictEqual(K.validQty('0,25', 1, 0.0001), { ok: true, qty: 0.25 });
  assert(!K.validQty('0.00001', 1, 0.0001).ok);
});
t('custom partial close via engine leaves the rest', () => {
  const a = mk(); a.setLast(NQ, 21000); a.placeOrder({ symbol: NQ, side: 'buy', type: 'market', qty: 5 });
  a.closePosition(NQ, K.validQty('2', 5, 1).qty); assert.strictEqual(a.position(NQ).qty, 3);
});
console.log(fail ? 'FAILED ' + fail + '/' + n : 'ALL PASS ' + n); process.exit(fail ? 1 : 0);
