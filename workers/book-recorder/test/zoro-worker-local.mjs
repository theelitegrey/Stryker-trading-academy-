// ZoroOptions Worker tests: ingest validation, storage + trims, the 8 GET routes, the Pro gate (fail closed), levels download.
// Real src/index.js + BookRecorder DO on node:sqlite, fake caches/env. node workers/book-recorder/test/zoro-worker-local.mjs
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import worker, { BookRecorder } from '../src/index.js';
import { zoGetRoute, zoExportRoute, exportParams, pickSteps, zoTeaser, teaserEligible, zoTrim } from '../src/zoro.js';
import { writeUv } from '../src/orderflow.js';
import { etAt, etParts } from '../src/gex-close.js';

crypto.subtle.timingSafeEqual = (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...a) { const st = db.prepare(q); const isSel = /^\s*SELECT/i.test(q); const rows = isSel ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; }, get databaseSize() { return 0; } };
const SECRET = 'x'.repeat(40);
const env = { INGEST_SECRET: SECRET, SYMBOLS: 'BTCUSDT,ETHUSDT' };
const doObj = new BookRecorder({ storage: { sql, deleteAlarm: async () => {} } }, env);
env.RECORDER = { idFromName: () => 'id', get: () => ({ fetch: (u, init) => doObj.fetch(new Request(u, init)) }) };
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
const wctx = { waitUntil: (p) => p };
const W = (path, init) => worker.fetch(new Request('https://w.dev' + path, init), env, wctx);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const now = Math.floor(Date.now() / 1000);
const post = (qs, obj, key = SECRET, raw) => W('/zo-ingest?' + qs, { method: 'POST', body: raw || gzipSync(JSON.stringify(obj)), headers: key ? { 'x-ingest-key': key } : {} });

// ---- ingest ----
// the feeder's own sample (S1 fixture = the contract), re-timed to now
import { readFileSync } from 'node:fs';
const FX = (f) => JSON.parse(readFileSync(new URL('../../../tools/fixtures/zoro/' + f, import.meta.url)));
const summ = Object.assign(FX('summary.json'), { built: now - 30, t: now - 30, dex: 5 });
summ.snap = Object.assign({}, summ.snap, { t: now - 30 });
summ.iv = Object.assign({}, summ.iv, { secret_pro: 1 });
let r = await post('route=summary&u=SPX', summ, '');
ok(r.status === 401, 'ingest without key -> 401');
r = await post('route=summary&u=SPX', summ, 'y'.repeat(40));
ok(r.status === 401, 'ingest wrong key -> 401');
r = await W('/zo-ingest?route=summary&u=SPX', { method: 'GET', headers: { 'x-ingest-key': SECRET } });
ok(r.status === 405, 'ingest GET -> 405');
r = await post('route=summary&u=SPX', summ);
ok(r.status === 200, 'ingest summary ok: ' + await r.text());
r = await post('route=summary&u=SPX', null, SECRET, Buffer.from('not gzip not gzip not gzip'));
ok(r.status === 400, 'non-gzip -> 400');
r = await post('route=summary&u=SPX', Object.assign({}, summ, { built: now - 90000 }));
ok(r.status === 400, 'stale built -> 400');
r = await post('route=summary&u=SPX', Object.assign({}, summ, { built: now + 600 }));
ok(r.status === 400, 'future built -> 400');
r = await post('route=summary&u=SPX', Object.assign({}, summ, { v: 2 }));
ok(r.status === 400, 'bad version -> 400');
r = await post('route=summary&u=QQQ', summ);
ok(r.status === 400, 'symbol mismatch -> 400');
r = await post('route=summary&u=../x', summ);
ok(r.status === 400, 'bad symbol -> 400');
r = await post('route=bogus&u=SPX', summ);
ok(r.status === 400, 'bad route -> 400');
r = await post('route=profile&u=SPX&x=7', summ);
ok(r.status === 400, 'bad profile x -> 400');
r = await W('/zo-ingest?route=summary&u=SPX', { method: 'POST', body: gzipSync(JSON.stringify(summ)), headers: { 'x-ingest-key': SECRET, 'content-length': String(1e6) } });
ok(r.status === 413, 'oversize content-length -> 413');
r = await post('route=summary&u=SPX', null, SECRET, gzipSync(nodeCrypto.randomBytes(100 * 1024)));
ok(r.status === 413, 'oversize body -> 413');
r = await post('route=summary&u=SPX', null, SECRET, gzipSync(Buffer.alloc(4 * 1024 * 1024, 'a')));
ok([400, 413].includes(r.status), 'gzip bomb -> refused');
const prof = Object.assign(FX('profile.json'), { built: now - 30, t: now - 30 });
ok((await post('route=profile&u=SPX&x=0', prof)).status === 200, 'ingest profile 0');
ok((await post('route=profile&u=SPX&x=all', Object.assign({}, prof, { x: 'all' }))).status === 200, 'ingest profile all');
ok((await post('route=profile&u=QQQ&x=0', Object.assign({}, prof, { u: 'QQQ' }))).status === 200, 'ingest profile QQQ');
ok((await post('route=surface&u=SPX&kind=gamma', { v: 1, u: 'SPX', built: now, z: [[1]] })).status === 200, 'ingest surface gamma');
ok((await post('route=activity&u=ALL&kind=burst', { v: 1, built: now, items: [] })).status === 200, 'ingest activity ALL');
ok((await post('route=screen', { v: 1, built: now, rows: [] })).status === 200, 'ingest screen');
ok((await post('route=cme&root=ES', { v: 1, built: now, u: 'ES' })).status === 200, 'ingest cme ES');
const day = etParts(now).day;
const note = { v: 1, built: now, day, kind: 'morning', ok: true, title: 'Zoro Morning Note', footer: 'Education only. Not financial advice.', teaser: ['a', 'b', 'c'],
  sections: [{ sym: 'SPX', title: 'SPX', lines: ['a', 'b', 'c', 'd'] }, { sym: 'QQQ', title: 'QQQ', lines: ['q1'] }], figures: { SPX: { call_ceiling: 1 } } };
ok((await post('route=note&day=' + day + '&kind=morning', note)).status === 200, 'ingest note (route=note)');
ok((await post('name=note&day=' + day + '&kind=close', Object.assign({}, note, { kind: 'close', built: now + 1, title: 'Zoro Close Note' }))).status === 200, 'ingest note (S5 spelling name=note, kind=close)');
ok((await post('route=note&day=' + day + '&kind=noon', note)).status === 400, 'ingest note bad kind -> 400');

// ---- gate: no token / garbage token fail closed ----
const G = (path, tok) => W(path, { headers: tok ? { authorization: 'Bearer ' + tok } : {} });
for (const p of ['/zo/surface?u=SPX', '/zo/history?u=SPX', '/zo/activity?u=ALL&kind=burst', '/zo/screen', '/zo/cme?root=ES', '/zo/profile?u=QQQ', '/zo/profile?u=SPX&x=all', '/zo/summary?u=QQQ', '/zo/levels-export?u=SPX']) {
  r = await G(p);
  ok(r.status === 403 && (await r.json()).error === 'pro_required', 'no token -> 403 pro_required ' + p);
  r = await G(p, 'garbage.token.value');
  ok(r.status === 403, 'garbage token -> 403 ' + p);
  ok(r.headers.get('cache-control') === 'no-store', '403 is no-store ' + p);
}
// ---- teaser (SPX, no token) ----
r = await G('/zo/summary?u=SPX');
let j = await r.json();
ok(r.status === 200 && j.teaser === true, 'SPX summary teaser without token');
ok(!('dex' in j) && !('nodes' in j) && !('secret_pro' in (j.iv || {})) && !j.ranges.m && !j.ranges['1'] && j.ranges.w && j.ranges['0'], 'teaser drops Pro fields, keeps 0DTE + weekly');
ok(Array.isArray(j.pin) && j.pin.length === 1, 'teaser pin = next expiry only');
ok(j.iv.v.length === summ.iv.v.length && j.iv.t.length === j.iv.v.length && j.iv.rank === summ.iv.rank, 'teaser IV keeps the 1-year sparkline (t, v)');
ok(j.day === summ.day && j.range_info && j.range_info['0'] && !j.range_info.m, 'teaser has day + range_info for 0DTE/weekly');
ok(!('fresh_top' in j) && !('fut' in j) && !('snap' in j) && !('levels_full' in j), 'teaser drops activity, futures, snap, levels_full');
ok(/private/.test(r.headers.get('cache-control')) && !/public|s-maxage/.test(r.headers.get('cache-control')), 'teaser response is private');
ok(/Authorization/.test(r.headers.get('vary')), 'vary: Authorization');
ok(j.notice === 'Education only. Not financial advice.', 'notice present');
r = await G('/zo/profile?u=SPX'); j = await r.json();
ok(r.status === 200 && j.teaser && j.gex && !j.dex && !j.vanna && !j.charm && !j.oi && !j.nodes, 'SPX 0DTE profile teaser: gex + vol only');
ok(j.cols.join() === 'k,gex,cvol,pvol' && j.rows.length === prof.rows.length && j.rows[0].length === 4, 'profile teaser rows = k, gex, call vol, put vol only');
r = await G('/zo/note?kind=morning'); j = await r.json();
ok(r.status === 200 && j.teaser.length === 3 && !j.sections && !j.figures && j.title === 'Zoro Morning Note' && j.footer, 'note teaser = head + 3 SPX lines only');
r = await G('/zo/note'); j = await r.json();
ok(r.status === 200 && j.kind === 'close', 'note without kind -> newest of the day (close)');
r = await G('/zo/note?day=1999-01-01');
ok(r.status === 404, 'note unknown day -> 404');
r = await G('/zo/summary?u=BAD!!');
ok(r.status === 400, 'bad symbol on GET -> 400');
r = await G('/zo/nothing');
ok(r.status === 404, 'unknown zo route -> 404');

// ---- Pro path via the route functions with a stub gate ----
const deps = (pro) => ({ isPro: async () => pro, bearer: () => 't', stub: (e) => e.RECORDER.get(), now: () => Date.now() });
const U = (p) => new URL('https://w.dev' + p);
const ZG = (p, pro = true) => zoGetRoute(new Request('https://w.dev' + p), U(p), env, wctx, {}, deps(pro));
r = await ZG('/zo/summary?u=SPX'); j = await r.json();
ok(r.status === 200 && !j.teaser && j.dex === 5 && j.nodes.length === 10 && j.ranges.m && j.iv.v.length > 200 && j.iv.t.length === j.iv.v.length, 'Pro summary has all fields (top-10 nodes, 1-year IV series)');
ok(/^private/.test(r.headers.get('cache-control')) && !/s-maxage|public/.test(r.headers.get('cache-control')), 'Pro response private');
r = await ZG('/zo/profile?u=SPX&x=all'); j = await r.json(); ok(r.status === 200 && j.cols.includes('vanna') && j.rows[0].length === 9, 'Pro profile x=all (all columns)');
r = await ZG('/zo/profile?u=QQQ'); ok(r.status === 200, 'Pro profile QQQ');
r = await ZG('/zo/surface?u=SPX&kind=gamma'); ok(r.status === 200, 'Pro surface');
r = await ZG('/zo/surface?u=SPX&kind=iv'); ok(r.status === 404, 'surface not stored -> 404');
r = await ZG('/zo/activity?u=ALL&kind=burst'); ok(r.status === 200, 'Pro activity');
const act = Object.assign(FX('activity.json'), { built: now - 20, t: now - 20 }); act.rows = act.rows.map((x, i) => Object.assign({}, x, { t: now - 600 + i }));
ok((await post('route=activity&u=SPX&kind=burst', act)).status === 200, 'ingest SPX bursts');
ok((await post('route=activity&u=SPX&kind=burst', act)).status === 200, 'same bursts again (no duplicates)');
r = await ZG('/zo/activity?u=SPX&kind=burst'); j = await r.json();
ok(r.status === 200 && j.rows.length === act.rows.length && j.items.length === new Set(act.rows.map((x) => [x.t, x.side, x.k, x.x].join())).size, 'activity u=SPX: latest rows + 5-session items, deduped');
r = await ZG('/zo/screen'); ok(r.status === 200, 'Pro screen');
r = await ZG('/zo/cme?root=ES'); ok(r.status === 200, 'Pro cme');
r = await ZG('/zo/cme?root=XX'); ok(r.status === 400, 'cme bad root -> 400');
r = await ZG('/zo/note?day=' + day + '&kind=morning'); j = await r.json(); ok(r.status === 200 && j.sections[0].lines.length === 4 && j.figures, 'Pro note full');
r = await ZG('/zo/note?day=' + day + '&kind=close'); j = await r.json(); ok(r.status === 200 && j.kind === 'close', 'note ?kind=close');
r = await ZG('/zo/history?u=SPX'); j = await r.json();
ok(r.status === 200 && j.snaps.length === 1 && j.snaps[0].s === summ.snap.s && j.tier === 'A' && j.step_s === 120, 'history ?day = fixture shape (packed snaps)');
r = await ZG('/zo/history?u=SPX&dte=0&from=' + (now - 3600)); j = await r.json();
ok(r.status === 200 && j.t.length === 1 && j.k.length && j.g[0].length > 1 && j.s[0] === summ.snap.s, 'history ?from = /gex-history packed shape');
r = await ZG('/zo/history?u=SPX&dte=0&sessions=1'); j = await r.json();
ok(r.status === 200 && Array.isArray(j) && j[0].day === summ.snap.day && j[0].n === 1, 'history ?sessions=1 = /gex-sessions list');
r = await ZG('/zo/history?u=SPX&from=1&to=99999999'); ok(r.status === 400, 'history span > 31 d -> 400');
const hrow = sql.exec('SELECT j FROM zohist WHERE u = ?', 'SPX').toArray()[0].j;
ok(hrow.length < 8192 && !/fresh_top|levels_full|range_info/.test(hrow) && !('t' in JSON.parse(hrow).iv), 'history copy is slimmed (' + hrow.length + ' B < 8 KB)');
r = await ZG('/zo/summary?u=SPX', false); ok(r.status === 200, 'non-Pro SPX summary -> teaser path');
r = await ZG('/zo/surface?u=SPX', false); ok(r.status === 403, 'non-Pro surface -> 403');
r = await zoGetRoute(new Request('https://w.dev/zo/screen'), U('/zo/screen'), env, wctx, {}, { isPro: async () => { throw new Error('boom'); }, bearer: () => 't', stub: (e) => e.RECORDER.get(), now: Date.now });
ok(r.status === 403, 'gate throws -> 403 (fail closed)');
// the feeder ingest key opens the Pro path (note job + alert engine), a wrong key does not
for (const pth of ['/zo/summary?u=SPX', '/zo/summary?u=QQQ', '/zo/activity?u=all&kind=burst', '/zo/note?day=' + day + '&kind=morning']) {
  r = await W(pth, { headers: { 'x-ingest-key': SECRET } });
  ok(r.status === 200 || r.status === 404, 'ingest key GET ' + pth + ' -> ' + r.status);
  if (pth.includes('u=SPX')) { j = await r.json(); ok(!j.teaser && j.fresh_top && j.iv.t, 'ingest key gets the full summary'); }
  r = await W(pth, { headers: { 'x-ingest-key': 'z'.repeat(40) } });
  ok(r.status === 403 || (r.status === 200 && (await r.json()).teaser), 'wrong ingest key -> no Pro ' + pth);
}
// basis=close: the last summary of the last finished session
sql.exec('INSERT OR REPLACE INTO zohist (u, t, j) VALUES (?, ?, ?)', 'SPX', etAt(day, 0) - 3600 * 8, JSON.stringify({ u: 'SPX', spot: 1, levels: {} }));
r = await ZG('/zo/summary?u=SPX&basis=close'); j = await r.json();
ok(r.status === 200 && j.close && j.close.label && (etParts(now).h >= 16 ? j.spot === summ.spot : j.spot === 1), 'basis=close -> closing summary + label ' + (j.close && j.close.label));

// ---- trims: tier A 90 d, tier B 30 d ----
const put = async (u, t) => { const o = Object.assign({}, summ, { u, built: now - 30, t }); sql.exec('INSERT OR REPLACE INTO zohist (u, t, j) VALUES (?, ?, ?)', u, t, JSON.stringify(o)); };
await put('SPX', now - 80 * 86400); await put('SPX', now - 100 * 86400); await put('AAPL', now - 20 * 86400); await put('AAPL', now - 40 * 86400);
zoTrim(sql, now);
const has = (u, t) => sql.exec('SELECT COUNT(*) AS c FROM zohist WHERE u = ? AND t = ?', u, t).toArray()[0].c === 1;
ok(has('SPX', now - 80 * 86400) && !has('SPX', now - 100 * 86400) && has('AAPL', now - 20 * 86400) && !has('AAPL', now - 40 * 86400), 'trim: SPX keeps 80 d drops 100 d; AAPL keeps 20 d drops 40 d');

// ---- levels export ----
const mk = (u, d, t, day, s, cw, pw, zg, nn, em) => sql.exec('INSERT OR REPLACE INTO gexsnap (u, d, t, j) VALUES (?, ?, ?, ?)', u, d, t, JSON.stringify({ day, x: day, s, cw, pw, zg, n: nn, em, k: [], g: [] }));
const D = '2026-11-03', t0 = etAt(D, 9 * 60 + 30);
for (let i = 0; i < 12; i++) mk('SPX', 0, t0 + i * 120, D, 6800 + i, 6900, 6750, 6812, 12.5, [6800, 40]);
mk('SPX', 1, t0, D, 1, 1, 1, 1, 1, null);     // 1DTE rows never in the export
// ES bar at 09:30 ET: record = t(minute) lo n o c ... (only t, lo, n, o, c are read)
const bar = []; writeUv(Math.floor(t0 / 60), bar); writeUv(2 * 27200, bar); writeUv(40, bar); writeUv(5, bar); writeUv(9, bar);   // lo=13600 ticks (sv zigzag: 2*x), o=5, c=9
const lastMin = Math.floor((t0 + 11 * 120) / 60); const bar2 = []; writeUv(lastMin, bar2); writeUv(2 * 27200, bar2); writeUv(40, bar2); writeUv(5, bar2); writeUv(9, bar2);
sql.exec('INSERT OR REPLACE INTO ofbar (sym, t, b, s) VALUES (?, ?, ?, ?)', 'ES', lastMin, Uint8Array.from(bar2), null);
const prm = exportParams(new URLSearchParams('u=spx&from=' + D + '&to=' + D + '&step=15m'), etAt('2026-11-04', 600));
ok(prm.u === 'SPX' && prm.fromT === etAt(D, 0), 'exportParams normalises');
ok(exportParams(new URLSearchParams('u=AAPL'), now).error, 'export: bad symbol');
ok(exportParams(new URLSearchParams('u=SPX&step=1s'), now).error, 'export: bad step');
ok(exportParams(new URLSearchParams('u=SPX&format=xml'), now).error, 'export: bad format');
ok(exportParams(new URLSearchParams('u=SPX&from=2026-01-01&to=2026-11-01'), now).error === 'range over 90 days', 'export: >90 days refused');
ok(exportParams(new URLSearchParams('u=SPX&from=2026-11-05&to=2026-11-01'), now).error, 'export: from after to');
ok(exportParams(new URLSearchParams('u=SPX&from=nope'), now).error, 'export: bad date');
ok(pickSteps([{ t: 0, day: 'a' }, { t: 100, day: 'a' }, { t: 1000, day: 'a' }, { t: 90000, day: 'b' }], 'close').length === 2, 'close step = last row of each day');
const X = (qs, pro = true) => zoExportRoute(new Request('https://w.dev/zo/levels-export?' + qs), U('/zo/levels-export?' + qs), env, wctx, {}, deps(pro));
const q0 = 'u=SPX&from=' + D + '&to=' + D;
r = await X(q0 + '&step=5m', false); ok(r.status === 403, 'export non-Pro -> 403');
r = await X(q0 + '&step=15m&format=csv'); let txt = await r.text();
const lines = txt.split('\n');
ok(r.status === 200 && /text\/csv/.test(r.headers.get('content-type')) && /attachment/.test(r.headers.get('content-disposition')), 'export csv headers');
ok(lines[0] === 'time_et,symbol,spot,call_ceiling,put_floor,flip_line,range0_upper,range0_lower,net_gex_m', 'export csv header row');
ok(lines[1].startsWith('2026-11-03 09:44,SPX,') && lines[1].includes(',6900,6750,6812,6840,6760,12.5'), 'export csv row values: ' + lines[1]);
ok(lines.filter((l) => /^2026/.test(l)).length === 2, '15m step over 24 min of 2-min rows -> 2 rows');
ok(/Education only/.test(txt) && !/live|real-time|delayed/i.test(txt), 'export csv carries notice, no banned words');
ok(r.headers.get('cache-control') === 'private, no-store', 'export is private no-store');
r = await X(q0 + '&step=5m&format=json'); j = await r.json();
ok(r.status === 200 && j.rows.length === 5 && j.columns.length === 9, 'export json 5m -> 5 rows');
r = await X(q0 + '&step=close&format=json'); j = await r.json(); ok(j.rows.length === 1 && j.rows[0][2] === 6811, 'export close = last row of the day');
r = await X('u=ES&from=' + D + '&to=' + D + '&step=close&format=json'); j = await r.json();
ok(r.status === 200 && j.mapped_from === 'SPX' && j.rows.length === 1, 'ES export mapped from SPX (only snapshots with a futures bar get a row)');
// ES close 27209*0.25 = 6802.25; ratio to spot 6811 scales the SPX levels
ok(Math.abs(j.rows[0][2] - 6802.25) < 0.01 && Math.abs(j.rows[0][3] - 6900 * 6802.25 / 6811) < 0.01, 'ES levels = SPX level x (futures / spot)');
r = await X('u=QQQ&from=' + D + '&to=' + D); ok(r.status === 404, 'export: no history -> 404');
r = await X('u=SPX&from=2026-01-01&to=2026-11-03'); ok(r.status === 400, 'export route: >90 d -> 400');
const rl = { RL_ZX: { limit: async () => ({ success: false }) } };
r = await zoExportRoute(new Request('https://w.dev/zo/levels-export?' + q0), U('/zo/levels-export?' + q0), Object.assign({}, env, rl), wctx, {}, deps(true));
ok(r.status === 429, 'export rate limit -> 429');
console.log('\n' + n + ' checks passed');
