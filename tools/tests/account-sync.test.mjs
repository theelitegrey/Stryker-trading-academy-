// assets/account-sync.js: merge / echo / migration / write-storm rules. Pure Node, no browser, no network.
//   node tools/tests/account-sync.test.mjs
import { createRequire } from 'module';
import assert from 'assert';
const require = createRequire(import.meta.url);
const AS = require('../../assets/account-sync.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---------------- pure core
const { reconcile, hash, norm, mergeIn, isEmpty, makeMap, REGISTRY } = AS;
ok(new Set(REGISTRY.map((r) => r[1])).size === REGISTRY.length, 'sync ids unique');
ok(new Set(REGISTRY.map((r) => r[0])).size === REGISTRY.length, 'keys unique');
ok(REGISTRY.every((r) => AS.GROUPS.includes(r[2])), 'groups known');
['app', 'chart', 'trade'].forEach((g) => ok(REGISTRY.filter((r) => r[2] === g).length <= 80, g + ' fits the 80-key rule'));
ok(!REGISTRY.some((r) => /auth|token|nav_signed|consent|oauth|dhan|rithmic|broker|reloaded|_cache|perfMode|zo_preview|tabid/i.test(r[0])), 'no per-device / secret keys registered');
// first sign-in on a device (seen undefined)
ok(reconcile('{"a":1}', { has: false }, undefined, 0) === 'push', 'account lacks it -> upload');
ok(reconcile(null, { has: false }, undefined, 0) === 'none', 'neither has it -> nothing');
ok(reconcile('[]', { has: false }, undefined, 0) === 'none', 'empty local is not uploaded');
ok(reconcile('x', { has: true, value: 'x' }, undefined, 0) === 'same', 'same value');
ok(reconcile(null, { has: true, value: 'r' }, undefined, 0) === 'apply', 'new device with nothing takes the account');
ok(reconcile('l', { has: true, value: 'r', ms: 5 }, undefined, 0) === 'apply', 'both differ, unknown local time -> account wins');
ok(reconcile('l', { has: true, value: 'r', ms: 5 }, undefined, 9) === 'push', 'local edited later -> local wins');
ok(reconcile('l', { has: true, value: 'r', ms: 9 }, undefined, 5) === 'apply', 'account newer -> account wins');
ok(reconcile('["a"]', { has: true, value: '[]', ms: 99 }, undefined, 1) === 'push', 'empty account value never wipes a device');
ok(reconcile('["a"]', { has: true, value: null, ms: 99 }, undefined, 1) === 'push', 'null account value never wipes a device');
// later sessions (seen = hash at last sync)
ok(reconcile('l2', { has: true, value: 'r' }, hash('r'), 0) === 'push', 'only local changed -> push');
ok(reconcile('l', { has: true, value: 'r2' }, hash('l'), 0) === 'apply', 'only account changed -> apply');
ok(reconcile(null, { has: true, value: 'r' }, hash('r'), 0) === 'push', 'deleted locally since -> push the delete');
ok(AS.shouldApply('a', 'b', false) && !AS.shouldApply('a', 'b', true) && !AS.shouldApply('a', 'a', false), 'live apply skips dirty + equal');
ok(isEmpty('{}') && isEmpty('') && isEmpty(null) && !isEmpty('0'), 'isEmpty');
// device-only fields
const op = makeMap('u1').get('stryker_op_u1');
ok(op && op.id === 'orderPanel', '{uid} keys resolve');
ok(!makeMap('u1', ['stryker_theme']).has('stryker_theme') && makeMap('u1').has('stryker_theme'), 'host-owned keys (__tzAcctLocal) skipped');
const loc = JSON.stringify({ x: 10, y: 20, w: 300, tab: 'dom', hk: true });
ok(norm(loc, op) === JSON.stringify({ tab: 'dom', hk: true }), 'window position/size never leaves the device');
ok(JSON.parse(mergeIn(loc, JSON.stringify({ tab: 'scalp', hk: false, x: 999 }), op)).x === 10, 'incoming keeps this device position');
ok(JSON.parse(mergeIn(loc, JSON.stringify({ tab: 'scalp', hk: false }), op)).tab === 'scalp', 'incoming setting applied');

// ---------------- browser half against a fake window + Firestore
class Storage { constructor() { this._m = new Map(); } getItem(k) { return this._m.has(k) ? this._m.get(k) : null; } setItem(k, v) { this._m.set(k, String(v)); } removeItem(k) { this._m.delete(k); } }
globalThis.Storage = Storage;
const server = new Map(); let writes = 0;
const subs = []; let fsDoc;
const deep = (a, b) => { const o = Object.assign({}, a); for (const k in b) o[k] = b[k] && typeof b[k] === 'object' && !b[k].__ts && a && typeof a[k] === 'object' ? deep(a[k], b[k]) : b[k]; return o; };
const stamp = (v, t) => { if (v && v.__ts) return t; if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = stamp(v[k], t); return o; } return v; };
function makeWin(uid) {
  const events = [], authCbs = [];
  const fsApi = { collection: (c) => ({ doc: (u) => ({ collection: () => ({ doc: (g) => {
    const path = c + '/' + u + '/prefs/' + g;
    return {
      set: async (d, o) => { writes++; const t = { toMillis: () => Date.now() }; server.set(path, o && o.merge ? deep(server.get(path) || {}, stamp(d, t)) : stamp(d, t)); subs.filter((s) => s.path === path).forEach((s) => s.fire()); },
      onSnapshot: (cb) => { const s = { path, fire: () => setTimeout(() => cb({ exists: server.has(path), data: () => JSON.parse(JSON.stringify(server.get(path) || {}), (k, v) => v), metadata: { hasPendingWrites: false } }), 5) }; subs.push(s); s.fire(); return () => subs.splice(subs.indexOf(s), 1); }
    };
  } }) }) }) };
  fsDoc = (p) => { const [c, u, , g] = p.split('/'); return fsApi.collection(c).doc(u).collection('prefs').doc(g); };
  const firestore = () => fsApi; firestore.FieldValue = { serverTimestamp: () => ({ __ts: 1 }) };
  const win = { localStorage: new Storage(), location: { href: 'x' }, addEventListener() {}, dispatchEvent: (e) => events.push(e),
    firebase: { apps: [1], firestore, auth: () => ({ onAuthStateChanged: (cb) => { authCbs.push(cb); setTimeout(() => cb(uid ? { uid } : null), 1); } }) } };
  return { win, events };
}
// Storage.prototype is patched per boot; give each "device" its own prototype copy
function device(uid, seed) {
  globalThis.Storage = class extends Storage {};
  const d = makeWin(uid);
  d.win.localStorage = new globalThis.Storage();
  Object.entries(seed || {}).forEach(([k, v]) => d.win.localStorage.setItem(k, v));
  d.api = AS.boot(d.win);
  return d;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// device A already has settings (before this feature): migration uploads them
const A = device('u1', { stryker_theme: 'day', stryker_ctype_favs: '["candles"]', stryker_op_u1: loc, tz_test_user: 'zz' });
await sleep(1300);
ok(A.api.ready, 'A ready');
const chart = server.get('users/u1/prefs/chart'), app = server.get('users/u1/prefs/app'), trade = server.get('users/u1/prefs/trade');
ok(app && app.v.theme === 'day', 'migration uploaded theme');
ok(chart && chart.v.chartTypeFavs === '["candles"]', 'migration uploaded chart type favs');
ok(trade && JSON.parse(trade.v.orderPanel).x === undefined && JSON.parse(trade.v.orderPanel).tab === 'dom', 'order panel uploaded without its window position');
ok(!JSON.stringify([...server.values()]).includes('zz'), 'unregistered keys never leave the device');
const w0 = writes;
ok(w0 <= 3, 'one write per group at migration (' + w0 + ')');

// device B (new phone/browser) with an old local theme and nothing else: account wins, empty never wipes
const B = device('u1', { stryker_theme: 'night', stryker_wl_width: '420' });
await sleep(1300);
ok(B.win.localStorage.getItem('stryker_theme') === 'day', 'B adopted the account theme');
ok(B.win.localStorage.getItem('stryker_ctype_favs') === '["candles"]', 'B got chart type favs');
ok(JSON.parse(B.win.localStorage.getItem('stryker_op_u1')).x === undefined, 'B has no foreign window position');
ok(server.get('users/u1/prefs/chart').v.watchlistWidth === '420', "B's own extra key uploaded (merge, nothing wiped)");
ok(server.get('users/u1/prefs/chart').v.chartTypeFavs === '["candles"]', "B's upload did not wipe A's keys");

// live: change on B lands on A; no echo writes
const w1 = writes;
B.win.localStorage.setItem('stryker_ctype_favs', '["candles","bars"]');
B.win.localStorage.setItem('stryker_ctype_favs', '["candles","bars","line"]');   // two edits inside the debounce -> one write
await sleep(1400);
ok(writes - w1 === 1, 'debounced: two edits, one write (' + (writes - w1) + ')');
ok(A.win.localStorage.getItem('stryker_ctype_favs') === '["candles","bars","line"]', 'A got B\'s change live');
ok(A.events.some((e) => e.type === 'stk:acct-pref' && e.detail.id === 'chartTypeFavs'), 'A modules told to re-render');
await sleep(1400);
ok(writes - w1 === 1, 'no echo write from A or B (' + (writes - w1) + ')');
// same value re-saved: no write
B.win.localStorage.setItem('stryker_ctype_favs', '["candles","bars","line"]');
await sleep(1300);
ok(writes - w1 === 1, 'unchanged value never written');
// removal syncs as null and removes on the other device
A.win.localStorage.removeItem('stryker_ctype_favs');
await sleep(1400);
ok(B.win.localStorage.getItem('stryker_ctype_favs') === null, 'removal synced');
// device position change alone never writes
const w2 = writes;
A.win.localStorage.setItem('stryker_op_u1', JSON.stringify(Object.assign(JSON.parse(A.win.localStorage.getItem('stryker_op_u1')), { x: 77 })));
await sleep(1300);
ok(writes === w2, 'moving a window writes nothing');
// write storm: 60 changes in a burst stay bounded
const w3 = writes;
for (let i = 0; i < 60; i++) { A.win.localStorage.setItem('stryker_gm_tab', 't' + i); await sleep(i % 10 ? 0 : 1100); }
await sleep(1500);
ok(writes - w3 <= 8, 'burst of 60 edits -> ' + (writes - w3) + ' writes');
ok(B.win.localStorage.getItem('stryker_gm_tab') === 't59', 'last value wins');
// the Android app writes natively (AccountPrefs.kt): a merge of one id, plus app-only ids the site does not know
const appDoc = () => fsDoc('users/u1/prefs/app');
const w5 = writes;
await appDoc().set({ v: { theme: 'night', mobileDefaultTf: 'M15' }, t: { theme: { __ts: 1 }, mobileDefaultTf: { __ts: 1 } }, updatedAt: { __ts: 1 } }, { merge: true });
await sleep(300);
ok(A.win.localStorage.getItem('stryker_theme') === 'night' && B.win.localStorage.getItem('stryker_theme') === 'night', 'phone theme change applied live on both browsers');
A.win.localStorage.setItem('stryker_gm_tab', 'after-phone'); await sleep(1400);
ok(server.get('users/u1/prefs/app').v.mobileDefaultTf === 'M15', "site writes keep the phone's own ids");
ok(writes - w5 === 2, 'phone write caused no echo write (' + (writes - w5 - 1) + ' site writes)');
// signed out: nothing synced
const G = device(null, {}); await sleep(200);
const w4 = writes; G.win.localStorage.setItem('stryker_theme', 'night'); await sleep(1300);
ok(writes === w4 && !G.api.ready, 'signed out: local only');
// the doc shape the Android app reads (fixture for AccountPrefsTest on hermes/w-android)
if (process.env.ACCT_FIXTURE) (await import('fs')).writeFileSync(process.env.ACCT_FIXTURE, JSON.stringify(server.get('users/u1/prefs/app'), (k, v) => (v && v.toMillis ? v.toMillis() : v), 1));
console.log('account-sync: ' + n + ' checks passed');
process.exit(0);
