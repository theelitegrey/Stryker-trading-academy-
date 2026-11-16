// Charts WORKSPACES pure logic (assets/chart-workspaces-core.js).  node tools/tests/chart-workspaces.test.mjs
import assert from 'node:assert/strict';
import * as C from '../../assets/chart-workspaces-core.js';
const ok = (c, m) => { assert.ok(c, m); console.log('PASS ' + m); };

// fresh + sanitize round trip
const ix = C.fresh('NQ scalping', { id: 'abcdefghij0123456789', name: 'My NQ', shared: true });
ok(ix.items.length === 1 && ix.active === ix.items[0].id && ix.items[0].layoutId === 'abcdefghij0123456789' && ix.items[0].shared === true, 'fresh index takes the open layout');
const back = C.sanitize(C.serialize(ix));
ok(JSON.stringify(back.items) === JSON.stringify(ix.items) && back.active === ix.active, 'serialize / sanitize round trip');

// junk is dropped, never thrown
ok(C.sanitize('{not json') === null && C.sanitize(null) === null && C.sanitize({ items: [] }) === null && C.sanitize({ items: 'x' }) === null, 'unreadable index -> null');
const dirty = C.sanitize({ active: 'wnope1234', items: [
  { id: 'wgood1234', name: '  BTC   order\nflow ', layoutId: '../../etc', panels: { open: ['book', 'evil', 'book', 'watchlist'], w: { book: 99999, watchlist: 300, x: 5 } } },
  { id: 'wgood1234', name: 'dup' },
  { id: 'bad id', name: 'x' },
  { id: 'wnoname1', name: '   ' },
  { id: 'wgex12345', name: 'GEX swing', layoutId: 'ABCDEFGHIJ1234567890', layoutName: 'GEX', shared: 'yes' }
] });
ok(dirty.items.length === 2, 'duplicate ids, bad ids and empty names dropped');
ok(dirty.items[0].name === 'BTC order flow', 'name whitespace / control chars cleaned');
ok(dirty.items[0].layoutId === null, 'bad layout id dropped');
ok(JSON.stringify(dirty.items[0].panels) === JSON.stringify({ open: ['book', 'watchlist'], w: { watchlist: 300 } }), 'panels: known ids once, sane widths only');
ok(dirty.items[1].shared === false, 'shared must be literally true');
ok(dirty.active === 'wgood1234', 'unknown active -> first');
const many = { items: Array.from({ length: 30 }, (_, i) => ({ id: 'wmany' + String(i).padStart(4, '0'), name: 'W' + i })) };
ok(C.sanitize(many).items.length === C.MAX, 'capped at MAX');

// add / unique names / limit
const w = C.fresh('Workspace 1');
const a = C.add(w, 'Workspace 1');
ok(a && a.name === 'Workspace 1 2', 'add makes the name unique');
ok(C.add(w, 'NQ scalping').name === 'NQ scalping' && w.items.length === 3, 'add appends');
while (w.items.length < C.MAX) C.add(w, 'x');
ok(C.add(w, 'one more') === null, 'add refuses past MAX');
ok(new Set(w.items.map((x) => x.id)).size === w.items.length, 'ids are unique');

// rename
const r = C.fresh('A'); const rid = r.items[0].id;
ok(C.rename(r, rid, '  GEX   swing ') && r.items[0].name === 'GEX swing', 'rename cleans');
ok(!C.rename(r, rid, '   ') && r.items[0].name === 'GEX swing', 'rename to blank refused');
ok(C.cleanName('x'.repeat(80)).length === C.NAME_MAX, 'name capped');

// remove: never the last; active falls to the neighbour
const d = C.fresh('one'); C.add(d, 'two'); C.add(d, 'three');
const [i1, i2, i3] = d.items.map((x) => x.id);
d.active = i2;
ok(C.remove(d, i2) === i3 && d.active === i3, 'deleting the active one moves to the next');
ok(C.remove(d, i1) === null && d.active === i3, 'deleting another keeps the active one');
ok(C.remove(d, i3) === false && d.items.length === 1, 'the last workspace stays');
ok(C.remove(d, 'wnothere1') === false, 'unknown id');

// move (drag to reorder)
const m = C.fresh('a'); C.add(m, 'b'); C.add(m, 'c');
const ids = () => m.items.map((x) => x.name).join('');
C.move(m, m.items[0].id, 2); ok(ids() === 'bca', 'move first to last');
C.move(m, m.items[2].id, 0); ok(ids() === 'abc', 'move last to first');
C.move(m, m.items[1].id, 99); ok(ids() === 'acb', 'move clamps');

// hotkeys
ok(C.hotkeyIndex({ ctrlKey: true, key: '1', code: 'Digit1' }) === 0, 'Ctrl+1 -> 0');
ok(C.hotkeyIndex({ metaKey: true, key: '9', code: 'Digit9' }) === 8, 'Cmd+9 -> 8');
ok(C.hotkeyIndex({ ctrlKey: true, key: '!', code: 'Digit2' }) === 1, 'layout-independent (code)');
ok(C.hotkeyIndex({ ctrlKey: true, key: '0', code: 'Digit0' }) === -1, 'Ctrl+0 ignored');
ok(C.hotkeyIndex({ key: '2', code: 'Digit2' }) === -1, 'plain digit left to the interval typing');
ok(C.hotkeyIndex({ ctrlKey: true, shiftKey: true, key: '2', code: 'Digit2' }) === -1 && C.hotkeyIndex({ ctrlKey: true, altKey: true, key: '2', code: 'Digit2' }) === -1, 'Shift / Alt combos ignored');

// sub label
ok(C.subOf({ layout: '2h', activeCellId: 'b', charts: [{ id: 'a', symbol: 'futures:NQ1!', timeframe: '5' }, { id: 'b', symbol: 'crypto:BTCUSDT', timeframe: '60' }, { id: 'c' }] }) === 'BTCUSDT · 1h · 2 charts', 'sub: active chart, grid count (not pooled charts)');
ok(C.subOf({ layout: '1', charts: [{ id: 'A', symbol: 'futures:ES1!', timeframe: 'D' }] }) === 'ES1! · D', 'sub: single chart');
ok(C.subOf(null) === '' && C.subOf({}) === '', 'sub: nothing');

// newer copy wins
ok(C.pickNewer({ t: 5 }, { t: 9 }).t === 9 && C.pickNewer({ t: 9 }, { t: 5 }).t === 9 && C.pickNewer(null, { t: 1 }).t === 1 && C.pickNewer({ t: 1 }, null).t === 1, 'pickNewer');
ok(C.samePanels({ open: ['book'] }, { open: ['book'], w: {} }) && !C.samePanels({ open: ['book'] }, { open: [] }), 'samePanels');

// LRU of chart documents
const L = C.lru(3);
L.set('a', 1); L.set('b', 2); L.set('c', 3); L.get('a'); L.set('d', 4);
ok(L.has('a') && !L.has('b') && L.size === 3 && L.keys().join('') === 'cad', 'lru keeps the 3 most recently used');

// serialize refuses an oversized index
const big = C.fresh('x'); big.items[0].sub = ''; big.items.push(...Array.from({ length: 11 }, (_, i) => ({ id: 'wbig' + String(i).padStart(5, '0'), name: 'y'.repeat(40), layoutId: null, layoutName: '', shared: false, panels: { open: [], w: {} }, sub: 'z'.repeat(2000) })));
ok(C.serialize(big) === null, 'oversized index not serialized');
// tab menu logic: pin, step, bulk close, default
{
  const ix = C.fresh('a'); C.add(ix, 'b'); C.add(ix, 'c'); C.add(ix, 'd');
  const [a, b, c, d] = ix.items.map((x) => x.id);
  C.setPinned(ix, c, true);
  ok(ix.items.map((x) => x.name).join() === 'c,a,b,d', 'pinned tab sits left');
  ok(!C.canStep(ix, c, 1) && !C.canStep(ix, a, -1) && C.canStep(ix, a, 1), 'move never crosses the pin boundary');
  ok(C.othersOf(ix, b).join() === [a, d].join(), 'close others skips pinned and itself');
  ok(C.rightOf(ix, a).join() === [b, d].join() && C.rightOf(ix, b).join() === d, 'close to the right');
  C.setDefault(ix, d); ok(ix.def === d, 'default set');
  C.remove(ix, d); ok(ix.def === '', 'default cleared when its workspace goes');
  const back = C.sanitize(C.serialize(ix));
  ok(back.items[0].pinned === true && C.sanitize({ items: [{ id: 'wabcde', name: 'x', color: 'evil' }] }).items[0].color === '', 'pin persists; bad colour dropped');
}
console.log('ALL PASS');
