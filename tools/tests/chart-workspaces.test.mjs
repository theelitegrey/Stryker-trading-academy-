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

// close / reopen (a closed workspace stays in the index, keeps its place, and comes back)
{
  const ix = C.fresh('A'); C.add(ix, 'B'); C.add(ix, 'C');
  const [a, b, c] = ix.items.map((x) => x.id);
  ix.active = b;
  ok(C.close(ix, b) === c && ix.active === c && ix.items.length === 3 && C.find(ix, b).closed === true, 'close keeps the item, moves active to the next open one');
  ok(C.openItems(ix).map((x) => x.id).join() === [a, c].join() && C.closedItems(ix).length === 1, 'open / closed views');
    ok(C.canStep(ix, a, 1) && C.step(ix, a, 1) && C.openItems(ix).map((x) => x.id).join() === [c, a].join(), 'move skips closed tabs');
  ok(C.othersOf(ix, c).join() === a && C.rightOf(ix, c).join() === a, 'close-others / right ignore closed ones');
  const back = C.sanitize(C.serialize(ix));
  ok(C.find(back, b).closed === true && C.find(back, a).closed === false, 'closed flag survives serialize / sanitize');
  ok(C.reopen(ix, b) && !C.find(ix, b).closed && C.reopen(ix, b) === false, 'reopen');
  const allShut = C.sanitize({ active: 'wzzzzz1', items: ['wzzzzz1', 'wzzzzz2'].map((id) => ({ id, name: id, closed: true })) });
  ok(allShut.items.filter((x) => !x.closed).length === 1 && !C.find(allShut, allShut.active).closed, 'an index with everything closed opens one');
  C.close(ix, b); ix.active = c;
  ok(C.remove(ix, b) === null && ix.items.length === 2, 'a closed workspace can be deleted');
  ok(C.close(ix, a) === null && C.close(ix, c) === false, 'cannot close the last open workspace');
  C.reopen(ix, a); C.reopen(ix, b); C.close(ix, b); ix.active = c; C.remove(ix, b);
  const solo = C.fresh('S'); C.add(solo, 'T'); C.close(solo, solo.items[1].id);
  ok(C.remove(solo, solo.active) === false, 'delete refuses the last open one');
}
// workspaces vs layouts (17 Nov): legacy own doc (layoutName === name) -> wsDoc; a real layout stays a layout
{
  const LEG = 'ABCDEFGHIJ0000000002', REAL = 'ABCDEFGHIJ00000000GA';
  const ix = C.sanitize({ items: [{ id: 'wleg00002', name: 'Workspace 2', layoutId: LEG, layoutName: 'Workspace 2' }, { id: 'wmain0001', name: 'Main', layoutId: REAL, layoutName: 'Gary' }] });
  ok(ix.items[0].wsDoc === LEG && ix.items[0].layoutId === null, 'legacy: own doc named after the workspace -> wsDoc');
  ok(ix.items[1].wsDoc === null && ix.items[1].layoutId === REAL && ix.items[1].layoutName === 'Gary', 'legacy: real layout stays a layout');
  const back = C.sanitize(C.serialize(ix));
  ok(back.items[0].wsDoc === LEG && back.items[1].layoutId === REAL, 'migration runs once (wsDoc key present after)');
  ok(C.wsDocIds(ix).join() === LEG, 'wsDocIds lists only workspace docs');
  C.add(ix, 'x'); ix.items[2].wsDoc = 'ZZZZZZZZZZ0000000003'; C.remove(ix, ix.items[2].id);
  ok(C.wsDocIds(ix).includes('ZZZZZZZZZZ0000000003') && C.sanitize(C.serialize(ix)).hid.includes('ZZZZZZZZZZ0000000003'), 'a deleted workspace doc stays hidden from layouts');
  ok(C.sanitize({ items: [{ id: 'wabcdef1', name: 'a' }], hid: ['../x', 'ABCDEFGHIJ0000000009'] }).hid.join() === 'ABCDEFGHIJ0000000009', 'hid: bad ids dropped');
}

// merge (bug 20 Nov: two windows on one account, Workspace-1 and Workspace-2 open at the same time)
{
  const D1 = 'AAAAAAAAAA0000000001', D2 = 'AAAAAAAAAA0000000002', D3 = 'AAAAAAAAAA0000000003', L2 = 'LLLLLLLLLL0000000002';
  const mk = (t, items, active) => C.sanitize({ t, active, items });
  const w1 = { id: 'wone00001', name: 'MNQ_01', wsDoc: D1, u: 10 }, w2 = { id: 'wtwo00002', name: 'MNQ_02', wsDoc: D2, u: 10 };
  // window X (older list) never saw workspace 3, window Y (newer) added it: X's copy must not drop it
  const X = mk(100, [w1, Object.assign({}, w2, { wsDoc: null })], 'wone00001');
  const Y = mk(200, [w1, Object.assign({}, w2, { layoutId: L2, layoutName: 'Two layout', u: 150 }), { id: 'wthree003', name: 'MNQ_03', wsDoc: D3, u: 190 }], 'wtwo00002');
  const m = C.merge(X, Y, 'wone00001');
  ok(m.items.map((x) => x.name).join() === 'MNQ_01,MNQ_02,MNQ_03', 'merge keeps a workspace only the other window has');
  ok(m.active === 'wone00001', 'merge keeps this window on its own workspace');
  ok(m.items[1].wsDoc === D2 && m.items[1].layoutId === L2, 'merge never drops a chart doc id; newer change wins');
  ok(C.sanitize(C.serialize(m)).items[2].u === 190, 'per-workspace change time survives a round trip');
  // this window's open workspace keeps ITS layout, even when the other copy is newer
  const X2 = mk(100, [Object.assign({}, w1, { layoutId: 'MMMMMMMMMM0000000001', layoutName: 'Mine' }), w2], 'wone00001');
  const Y2 = mk(300, [Object.assign({}, w1, { layoutId: null, name: 'Renamed', u: 250 }), w2], 'wtwo00002');
  const m2 = C.merge(X2, Y2, 'wone00001');
  ok(m2.items[0].name === 'Renamed' && m2.items[0].layoutId === 'MMMMMMMMMM0000000001', 'open workspace: newer rename taken, own layout kept');
  // a workspace changed later in the OLDER list still wins for that workspace
  const X3 = mk(100, [w1, Object.assign({}, w2, { name: 'Newest name', u: 400 })], 'wone00001');
  ok(C.merge(X3, mk(200, [w1, w2], 'wone00001'), 'wone00001').items[1].name === 'Newest name', 'per-workspace: the copy changed last wins');
  // deleted in one window -> stays deleted after merging the other's older list
  const d = C.sanitize({ t: 500, active: 'wone00001', items: [w1, w2, { id: 'wthree003', name: 'MNQ_03', wsDoc: D3 }] });
  C.remove(d, 'wthree003');
  const m4 = C.merge(d, Y, 'wone00001');
  ok(!C.find(m4, 'wthree003') && m4.gone.includes('wthree003') && C.sanitize(C.serialize(m4)).gone.includes('wthree003'), 'a deleted workspace does not come back from the other list');
  ok(C.merge(null, Y, 'x') === Y && C.merge(X, null, 'x') === X, 'merge with nothing');
  // this window's workspace was deleted elsewhere -> active moves to an open one
  const m5 = C.merge(mk(100, [w1, w2], 'wtwo00002'), Object.assign(mk(200, [w1], 'wone00001'), { gone: ['wtwo00002'] }), 'wtwo00002');
  ok(m5.active === 'wone00001' && m5.items.length === 1, 'own workspace deleted in another window -> an open one becomes active');
}
console.log('ALL PASS');
