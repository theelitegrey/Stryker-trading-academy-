// Guard: renderStudentsTable() must not throw a ReferenceError (liveNote/liveWhy were once closure-only).
// Run: node tools/tests/students-admin-render.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '../../assets/students-admin.js'), 'utf8');
const mkEl = () => { const e = { innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, classList: { toggle() { return true; }, add() {}, remove() {}, contains() { return false; } },
  addEventListener() {}, setAttribute() {}, appendChild() {}, remove() {}, querySelector() { return mkEl(); }, querySelectorAll() { return []; } }; return e; };
const body = mkEl();
const doc = { getElementById: (id) => id === 'students-table-body' ? body : mkEl(), createElement: mkEl, addEventListener() {}, querySelector: () => mkEl(), querySelectorAll: () => [] };
const ctx = { document: doc, window: {}, console, Date, Set, Number, setTimeout, stkEsc: (s) => String(s), CURRENT_ADMIN_UIDS: new Set(['adm']), CURRENT_MODERATOR_UIDS: new Set(), CURRENT_STAFF_UIDS: new Set(),
  guardAdminPage() {}, loadStudents() {}, rankOf: (p) => ({ Starter: 0, Pro: 1, Elite: 2 }[p] || 0), roleTagHtml: () => '', planOptionsForStudent: undefined };
ctx.window = ctx; vm.createContext(ctx);
// Fire DOMContentLoaded handlers so closure helpers get exported.
const handlers = [];
doc.addEventListener = (n, f) => handlers.push([n, f]);
vm.runInContext(src, ctx);
handlers.filter((h) => h[0] === 'DOMContentLoaded').forEach(([, f]) => { try { f(); } catch (e) { console.log('handler err:', e.message); } });
const future = Date.now() + 30 * 864e5;
const list = [
  { uid: 'st', displayName: 'Normal', email: 'n@x.com', plan: 'Starter' },
  { uid: 'pro', displayName: 'Pro', email: 'p@x.com', plan: 'Pro', paidThroughMillis: future },
  { uid: 'gf', displayName: 'Grand', email: 'g@x.com', plan: 'Pro', liveFeed: true, liveFeedGrandfathered: true, paidThroughMillis: future },
  { uid: 'ao', displayName: 'Addon', email: 'a@x.com', plan: 'Starter', liveData: { active: true, paidThroughMillis: future } },
  { uid: 'adm', displayName: 'Admin', email: 'ad@x.com', plan: 'Elite' },
  { uid: 'dm', displayName: 'Demo', email: 'd@x.com', plan: 'Elite', demo: true },
];
ctx.__list = list;
vm.runInContext('ALL_STUDENTS = __list; renderStudentsTable(ALL_STUDENTS)', ctx);
console.log('PASS: rendered', list.length, 'students without ReferenceError');
