// roadmap-merge.test.js: the database roadmap doc must not hide cards added in assets/roadmap-data.js,
// and a file card can move a status forward (planned -> progress -> shipped) but never back.
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'roadmap-data.js'), 'utf8');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function run(doc) {
  const win = {};
  const db = { collection: () => ({ doc: () => ({ get: () => Promise.resolve({ exists: !!doc, data: () => doc }) }), where: () => ({ limit: () => ({ get: () => Promise.resolve({ forEach() {} }) }) }) }) };
  const ctx = { window: win, db, setTimeout, clearTimeout, Promise, console, fetch: undefined, document: undefined };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx); vm.runInContext(src, ctx);
  const api = Object.values(win).find((v) => v && typeof v.load === 'function') || Object.values(ctx).find((v) => v && typeof v === 'object' && typeof v.load === 'function');
  if (!api) throw new Error('roadmap api not found on window');
  return api.load();
}
(async () => {
  const file = await run(null);
  const fileIds = file.items.map((i) => i.id);
  ok(fileIds.includes('chart-order-panel-v2'), 'file has the order panel card');
  const doc = { items: [{ id: 'connection-latency', title: 'DB title', status: 'progress', progress: 10 }, { id: 'db-only', title: 'Only in DB', status: 'planned' }, { id: 'chart-order-panel-v2', title: 'x', status: 'shipped', date: '2026-12-01' }] };
  const m = await run(doc);
  const by = Object.fromEntries(m.items.map((i) => [i.id, i]));
  ok(m.items[0].id === 'connection-latency' && m.items[1].id === 'db-only', 'database order kept first');
  ok(by['db-only'], 'database-only card kept');
  ok(by['connection-latency'].title === 'DB title', 'database text kept');
  ok(by['connection-latency'].status === 'shipped' && by['connection-latency'].progress === undefined, 'file moves progress -> shipped');
  ok(by['chart-order-panel-v2'].status === 'shipped', 'file never moves a status back');
  ok(by['workspace-close-reopen'] || by['chart-trade-menu-v2'] || fileIds.every((id) => by[id]), 'file-only cards added');
  ok(fileIds.every((id) => by[id]), 'every file card present after merge (' + fileIds.length + ')');
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
