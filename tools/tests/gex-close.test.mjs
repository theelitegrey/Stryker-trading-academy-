// GEX "Daily close" levels: the close-snapshot picker (workers/book-recorder/src/gex-close.js) and the close build
// (functions/api/gex/_close.js). Pure node, no network needed:  node tools/tests/gex-close.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { closeCandidate, lastSessionDay, pickClose, closeSnapRows, nextOpen, closeLabel, etAt, etParts } from '../../workers/book-recorder/src/gex-close.js';
import { buildCloseLevels } from '../../functions/api/gex/_close.js';
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const at = (day, hh, mm) => etAt(day, hh * 60 + mm);

// ---- lastSessionDay: which session's close is "the last completed" ----
ok(lastSessionDay(at('2026-11-05', 12, 0)) === '2026-11-04', 'Thu midday -> Wed close');
ok(lastSessionDay(at('2026-11-05', 16, 10)) === '2026-11-04', 'Thu 16:10 (close window still open) -> Wed close');
ok(lastSessionDay(at('2026-11-05', 16, 25)) === '2026-11-05', 'Thu 16:25 -> Thu close');
ok(lastSessionDay(at('2026-11-05', 18, 30)) === '2026-11-05', 'futures evening session (Thu 18:30, trade date Fri) -> Thu close, the day before');
ok(lastSessionDay(at('2026-11-06', 2, 0)) === '2026-11-05', 'Fri 02:00 overnight -> Thu close');
ok(lastSessionDay(at('2026-11-07', 12, 0)) === '2026-11-06', 'Saturday -> Fri close');
ok(lastSessionDay(at('2026-11-08', 18, 30)) === '2026-11-06', 'Sunday 18:30 futures open -> Fri close');
ok(lastSessionDay(at('2026-11-09', 9, 45)) === '2026-11-06', 'Monday morning -> Fri close');

// ---- closeCandidate: which ingested chain is frozen ----
const day = '2026-11-05';
const c1 = closeCandidate(null, { ct: at(day, 15, 58), ts: at(day, 16, 3) });
ok(c1 === null, 'chain before 16:00 ET, fetched before 16:05 -> not frozen');
const c2 = closeCandidate(null, { ct: at(day, 16, 14), ts: at(day, 16, 16) });
ok(c2 && c2.day === day && c2.win, 'first chain inside 16:00-16:15 -> frozen');
ok(closeCandidate({ ct: at(day, 16, 14), win: true }, { ct: at(day, 16, 2), ts: at(day, 16, 4) }).win, 'closer to 16:00 replaces it');
ok(closeCandidate({ ct: at(day, 16, 2), win: true }, { ct: at(day, 16, 14), ts: at(day, 16, 16) }) === null, 'farther from 16:00 keeps the frozen one');
const late = closeCandidate(null, { ct: at(day, 15, 50), ts: at(day, 16, 6) });
ok(late && !late.win, 'no chain in the window yet: the first fetched after 16:05 is kept as a stand-in (win = false)');
ok(closeCandidate({ ct: at(day, 15, 50), win: false }, { ct: at(day, 16, 1), ts: at(day, 16, 12) }).win, 'an in-window chain replaces the stand-in');
ok(closeCandidate({ ct: at(day, 16, 1), win: true }, { ct: at(day, 15, 55), ts: at(day, 16, 20) }) === null, 'a stand-in never replaces an in-window chain');
ok(closeCandidate(null, { ct: at('2026-11-04', 16, 14), ts: at(day, 9, 10) }) === null, 'morning fetch of the prior day\'s chain -> ignored');
ok(closeCandidate(null, { ct: at('2026-11-07', 16, 1), ts: at('2026-11-07', 16, 2) }) === null, 'weekend chain -> ignored');
ok(closeCandidate(null, { ct: 0, ts: at(day, 16, 6) }) === null, 'no chain time -> ignored');

// ---- pickClose: missing day / holiday / weekend ----
const rows = [{ day: '2026-11-03', ct: at('2026-11-03', 16, 1), win: 1 }, { day: '2026-11-04', ct: at('2026-11-04', 16, 1), win: 1 }, { day: '2026-11-05', ct: at('2026-11-05', 16, 1), win: 1 }];
let p = pickClose(rows, at('2026-11-05', 12, 0));
ok(p.row.day === '2026-11-04' && !p.fallback, 'midday: yesterday\'s close, never today\'s (no lookahead)');
p = pickClose(rows, at('2026-11-07', 10, 0));
ok(p.row.day === '2026-11-05' && p.expected === '2026-11-06' && p.fallback, 'Fri close missing (holiday / feeder gap) -> latest earlier close, flagged fallback');
ok(pickClose([], at(day, 12, 0)) === null && pickClose(null, at(day, 12, 0)) === null, 'nothing stored -> null');
ok(pickClose([{ day: '2026-11-06', ct: 1 }], at('2026-11-06', 11, 0)) === null, 'only a later day stored -> null');

// ---- history fallback: snapshot nearest 16:00 ET inside 16:00-16:15 ----
const snaps = [at(day, 15, 58), at(day, 16, 2), at(day, 16, 4), at(day, 16, 16), at('2026-11-04', 16, 14)].map((t) => ({ t, s: 1 }));
const hr = closeSnapRows(snaps);
ok(hr.length === 2 && hr.find((r) => r.day === day).ct === at(day, 16, 2) && hr.find((r) => r.day === '2026-11-04').ct === at('2026-11-04', 16, 14), 'history: per day the snapshot nearest 16:00 inside the window');
ok(closeSnapRows([{ t: at(day, 15, 59) }, { t: at(day, 16, 20) }]).length === 0, 'history: nothing in the window -> no row');

// ---- helpers ----
ok(etParts(nextOpen('2026-11-06')).day === '2026-11-09' && etParts(nextOpen('2026-11-06')).min === 570, 'next open after Friday = Monday 09:30 ET');
ok(closeLabel('2026-11-05') === 'Thu 5 Nov', 'label "Thu 5 Nov"');
ok(etParts(at('2026-11-02', 16, 0)).h === 16 && etParts(at('2026-07-02', 16, 0)).h === 16, '16:00 ET right in EST and EDT');

// ---- close build from a frozen chain (real QQQ chain, relabelled as a 16:01 ET close) ----
const rd = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/gex/' + f, import.meta.url))));
const near = Object.assign(rd('walls-QQQ-near-20261027.json.gz'), { chain_time: '2026-10-27T16:01:00' });
const term = Object.assign(rd('walls-QQQ-term-20261027.json.gz'), { chain_time: '2026-10-27T16:01:00' });
const stub = { 'cache-control': '' };
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('offline test'); };   // no Yahoo / vendor: futures conversion errors, levels stay
const c0 = await buildCloseLevels('QQQ', 0, {}, { now: at('2026-10-28', 11, 0), frozen: { near: { d: near, day: '2026-10-27' }, term: { d: term, day: '2026-10-27' } } });
ok(c0.basis === 'close' && c0.close.day === '2026-10-27' && c0.close.label === 'Tue 27 Oct' && c0.close.source === 'chain', 'close build: basis + close block');
ok(c0.expiry === '2026-10-28', '0DTE from a Tue close = Wednesday\'s expiry (the next session)');
ok(c0.call_wall >= c0.spot && c0.put_wall <= c0.spot && c0.zero_gamma != null && c0.wall_method === 'structure_1_30d', 'close build: walls + zero gamma (' + c0.put_wall + ' / ' + c0.call_wall + ')');
ok(c0.market.state === 'close' && c0.sources.hybrid_skip_reason, 'close build: market state "close", no vendor hybrid');
const again = await buildCloseLevels('QQQ', 0, {}, { now: at('2026-10-28', 15, 0), frozen: { near: { d: near, day: '2026-10-27' }, term: { d: term, day: '2026-10-27' } } });
ok(again.call_wall === c0.call_wall && again.put_wall === c0.put_wall && again.zero_gamma === c0.zero_gamma && JSON.stringify(again.expected) === JSON.stringify(c0.expected), 'same levels at 11:00 and 15:00 (fixed for the session)');
// missing frozen chain -> history snapshot
const snap = { t: at('2026-10-27', 16, 2), day: '2026-10-27', s: 600, cw: 610, pw: 590, zg: 598, n: 12.5, em: [600, 5], x: '2026-10-28', k: [595, 600, 605], g: [-1, 2, 3] };
const hb = await buildCloseLevels('QQQ', 0, {}, { frozen: { near: null, term: null }, history: { snap, day: '2026-10-27', fallback: false }, convert: async (nm, s, raw) => ({ NQ: { ratio: 41, basis: 10, levels: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v == null ? null : v * 41 + 10])) } }) });
ok(hb.close.source === 'history' && hb.call_wall === 610 && hb.put_wall === 590 && hb.zero_gamma === 598 && hb.expected['68%'][0] === 595, 'no frozen chain -> recorded snapshot nearest 16:00');
ok(hb.futures.NQ.levels.call_wall === 610 * 41 + 10 && hb.ladder.length === 3, 'history fallback: futures conversion + ladder');
await assert.rejects(buildCloseLevels('QQQ', 0, {}, { frozen: { near: null, term: null }, history: null }), /no daily close/); n++; console.log('PASS nothing stored -> clear error');
globalThis.fetch = realFetch; void stub;
console.log(n + ' checks, ALL PASS');
