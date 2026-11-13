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
console.log(fail ? 'FAILED ' + fail + '/' + n : 'ALL PASS ' + n); process.exit(fail ? 1 : 0);
