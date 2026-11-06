// ZoroOptions end-to-end, consumer side: reads the local Worker (workers/book-recorder/test/zoro-local-server.mjs, fed by the
// real feeder run) through every GET route and checks that the S4 chart parsers get usable data out of it.
//   ZO_URL=http://127.0.0.1:8788 ZO_KEY_FILE=<file with the local ingest key> node tools/tests/zoro-e2e-consumers.mjs
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { search: '', hostname: 'x' };
globalThis.document = { documentElement: { getAttribute: () => null }, addEventListener() {}, visibilityState: 'visible' };
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ZD = await import('../../assets/chart-zoro-data.js');
// gex-heat-core.js is a classic script that sets window.StrykerGexHeat
vm.runInThisContext(fs.readFileSync(new URL('../../assets/gex-heat-core.js', import.meta.url), 'utf8'));
const core = globalThis.StrykerGexHeat;
const B = process.env.ZO_URL || 'http://127.0.0.1:8788', K = fs.readFileSync(process.env.ZO_KEY_FILE, 'utf8').trim();
const get = async (p) => { const r = await fetch(B + p, { headers: { 'x-ingest-key': K } }); return [r.status, r.status === 200 ? await r.json() : null]; };
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };

for (const u of ['SPX', 'SPY', 'QQQ', 'IWM', 'GLD', 'USO']) {
  const [st, j] = await get('/zo/summary?u=' + u);
  ok(st === 200, u + ' summary 200');
  const zs = ZD.zsum(j);
  ok(zs && zs.nodes.length === 10 && zs.call > 0 && zs.put > 0 && zs.flip > 0 && zs.spot > 0, u + ' S4 zsum: 10 nodes + levels');
  ok(zs.ranges.length === 4 && zs.ranges.every((r) => r.hi > r.lo), u + ' S4 zsum: 4 Zoro Ranges');
  ok(zs.iv.v.length >= 200 && zs.iv.t.length === zs.iv.v.length, u + ' S4 IV rank pane: 1-year iv series (' + zs.iv.v.length + ')');
  const lines = ZD.zoroLines(zs, (v) => v, { nodeCount: 10 }, () => true);
  ok(lines.length === 10 + 8 + (zs.pin ? 1 : 0), u + ' S4 Zoro Levels lines: ' + lines.length);
  const [sa, act] = await get('/zo/activity?u=' + u + '&kind=fresh');
  const items = ZD.zitems(sa === 200 ? Object.assign({}, act, { rows: undefined }) : null);
  ok(sa === 200 && items.length > 0 && items.every((r) => r.k > 0 && (r.side === 'C' || r.side === 'P')), u + ' S4 Fresh Volume marks from items: ' + items.length);
  const [sb] = await get('/zo/activity?u=' + u + '&kind=burst');
  ok(sb === 200, u + ' burst route 200');
  // Gamma over time: the histApi path (packed /gex-history shape) for symbols outside the old /gex-history
  const [sh, h] = await get('/zo/history?u=' + u + '&dte=0&from=' + (Math.floor(Date.now() / 1000) - 6 * 3600));
  const rows = sh === 200 ? core.unpack(h) : [];
  ok(rows.length >= 1 && rows[0].k.length > 5 && rows[0].s > 0, u + ' S4 Gamma over time: unpack -> ' + rows.length + ' snapshot(s), ' + (rows[0] || { k: [] }).k.length + ' strikes');
  const [ss, sess] = await get('/zo/history?u=' + u + '&dte=0&sessions=1');
  ok(ss === 200 && Array.isArray(sess) && sess[0].n >= 1 && sess[0].t0 > 0, u + ' sessions list');
  for (const x of ['0', '1', 'w', 'm', 'all']) { const [sp, p] = await get('/zo/profile?u=' + u + '&x=' + x); ok(sp === 200 && p.rows.length > 3 && p.cols.length === 9, u + ' profile x=' + x); }
}
for (const p of ['/zo/screen', '/zo/activity?u=all&kind=fresh', '/zo/activity?u=all&kind=active', '/zo/activity?u=all&kind=burst', '/zo/note?kind=morning']) {
  const [st, j] = await get(p);
  ok(st === 200 && j, p + ' 200');
}
const [, note] = await get('/zo/note?kind=morning');
ok(note.ok && note.sections.length >= 5 && note.teaser.length === 3 && /Education only/.test(note.footer), 'note: sections + teaser + footer');
// Free (no key): teaser only, Pro routes refused
const free = async (p) => (await fetch(B + p)).status;
ok((await free('/zo/summary?u=SPX')) === 200 && (await free('/zo/summary?u=QQQ')) === 403 && (await free('/zo/screen')) === 403, 'no key: SPX teaser 200, others 403');
const tz = await (await fetch(B + '/zo/note')).json();
ok(tz.teaser.length === 3 && !tz.sections, 'no key: note teaser only');
console.log('\n' + n + ' checks passed');
