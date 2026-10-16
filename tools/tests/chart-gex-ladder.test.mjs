// GEX Ladder core unit tests (pure node):  node tools/tests/chart-gex-ladder.test.mjs
// Ranking, role tags, shared colour scale, previous-day selection (no lookahead), money format.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from '../../assets/chart-gex-ladder-core.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; console.log('PASS', m); };

// money
eq(C.fmtMoney(185.1e6), '+$185.1M', 'fmt +$185.1M');
eq(C.fmtMoney(-170e6), '\u2212$170.0M', 'fmt \u2212$170.0M');
eq(C.fmtMoney(1.24e9), '+$1.24B', 'fmt billions');
eq(C.fmtMoney(-89500), '\u2212$89.5K', 'fmt thousands');
eq(C.fmtMoney(NaN), '\u2014', 'fmt NaN');
eq(C.dayTag('2026-10-15', 1.6e9), '10/15 \u00b7 $1.6B', 'day tag billions');
eq(C.dayTag('2026-10-09', -795e6), '10/9 \u00b7 $795M', 'day tag millions, no sign');

// ranking on a synthetic ladder, spot 100
const rows = [{ k: 110, g: 5e8 }, { k: 108, g: -3e8 }, { k: 104, g: 9e8 }, { k: 101, g: -1e8 }, { k: 99, g: 2e8 }, { k: 97, g: 7e8 }, { k: 95, g: -8e8 }, { k: 90, g: 4e8 }, { k: 120, g: 1.5e9 }, { k: 80, g: 0 }];
const spot = 100;
const r = C.rankStrikes(rows, spot, 10);
eq(r.map((x) => x.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'ranks 1..n, zero GEX dropped');
eq(r[0].strike, 120, 'rank 1 = biggest |GEX| (120)');
eq(r.map((x) => x.strike).slice(0, 4), [120, 104, 95, 97], 'order by |GEX|');
ok(r[0].share === 1 && r[1].share < 1 && r[1].share > 0.5, 'share = |g| / biggest');
eq(r.find((x) => x.strike === 120).role, 'Resistance', 'big positive above price = Resistance');
eq(r.find((x) => x.strike === 97).role, 'Support', 'big positive below price = Support');
eq(r.find((x) => x.strike === 95).role, 'Accelerant', 'big negative = Accelerant');
eq(r.find((x) => x.strike === 99).role, 'Magnet', 'largest |GEX| within 1% of spot (99) is the Magnet');
eq(r.find((x) => x.strike === 104).role, 'Resistance', '104 is outside the 1% band: stays Resistance');
eq(r.filter((x) => x.role === 'Magnet').length, 1, 'exactly one Magnet');
eq(C.rankStrikes(rows, spot, 3).length, 3, 'top-n respected');
eq(C.rankStrikes([], spot), [], 'empty ladder');
// no strike near price -> no Magnet role
const far = C.rankStrikes([{ k: 120, g: 1e9 }, { k: 80, g: -1e9 }], 100, 10);
ok(!far.some((x) => x.role === 'Magnet'), 'nothing within 1%: no Magnet tag');
const m = C.magnet(rows, spot, 0.05);
ok(m.strike === 104 && Math.abs(m.pct - 4) < 1e-9, 'magnet() strike + % distance (104, +4% in a 5% band)');
// near band 5%
eq(C.magnet(rows, spot).strike, 99, 'default band 1%: magnet = 99');

// shared scale + strength + biggest + spot row
const A = [{ k: 3, g: 1e9 }, { k: 2, g: -2e8 }], B = [{ k: 3, g: 5e7 }, { k: 2, g: -9e8 }];
const vmax = C.sharedScale([A, B]);
ok(vmax === 1e9, 'one shared scale = biggest |GEX| of any column');
ok(C.strength(1e9, vmax) === 1 && C.strength(5e7, vmax) < 0.2 && C.strength(-9e8, vmax) > C.strength(2e8, vmax), 'strength is monotone on the shared scale');
eq(C.biggestIndex(A), 0, 'biggest per column (A)');
eq(C.biggestIndex(B), 1, 'biggest per column (B, negative)');
eq(C.spotIndex(rows, 102.4), rows.findIndex((x) => x.k === 101) >= 0 ? C.spotIndex(rows, 102.4) : -1, 'spotIndex runs');
eq(rows[C.spotIndex(rows, 102.4)].k, 101, 'spot row = nearest strike');
eq(C.netTotal(A), 8e8, 'net total');

// ladder shapes
eq(C.ladderFromSnap({ k: [10, 11], g: [-2, 3] }), [{ k: 11, g: 3e6 }, { k: 10, g: -2e6 }], 'snapshot $M -> $, high to low');
const QQQ = JSON.parse(fs.readFileSync(new URL('./fixtures/gex/QQQ-0.json', import.meta.url)));
const lad = C.ladderFromApi(QQQ);
ok(lad.length > 10 && lad[0].k > lad[lad.length - 1].k, 'real API ladder parses, high to low (' + lad.length + ' strikes)');
const rr = C.rankStrikes(lad, QQQ.spot, 10);
ok(rr.length === 10 && rr.every((x, i) => i === 0 || Math.abs(rr[i - 1].g) >= Math.abs(x.g)), 'real ladder: top 10 sorted by |GEX|');

// previous days: strictly before the ET day of "now", newest first, capped 0..5
const etDay = (sec) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(sec * 1000));
const sess = [{ day: '2026-10-16' }, { day: '2026-10-15' }, { day: '2026-10-14' }, { day: '2026-10-13' }, { day: '2026-10-09' }, { day: '2026-10-08' }, { day: '2026-10-07' }];
const T16 = Date.UTC(2026, 9, 16, 15, 0) / 1000;      // 11:00 ET on 10/16
eq(C.previousDays(sess, T16, 2, etDay), ['2026-10-15', '2026-10-14'], 'live: last 2 sessions before today');
eq(C.previousDays(sess, T16, 0, etDay), [], 'N=0 draws none');
eq(C.previousDays(sess, T16, 9, etDay).length, 5, 'N is capped at 5');
const T14 = Date.UTC(2026, 9, 14, 18, 0) / 1000;      // replay clock inside 10/14
eq(C.previousDays(sess, T14, 3, etDay), ['2026-10-13', '2026-10-09', '2026-10-08'], 'replay: only days before the replay day (no lookahead)');
ok(!C.previousDays(sess, T14, 5, etDay).some((d) => d >= '2026-10-14'), 'replay: replay day and later never selected');
const T14late = Date.UTC(2026, 9, 15, 2, 0) / 1000;   // 22:00 ET on 10/14: still the 10/14 day
ok(!C.previousDays(sess, T14late, 5, etDay).includes('2026-10-14'), 'ET day boundary: 22:00 ET is still that day');
eq(C.previousDays(null, T16, 2, etDay), [], 'no sessions');
// day top strikes: peak |GEX| per strike over the session, signed, top 2
const day = [{ k: [100, 101, 102], g: [1, -5, 2] }, { k: [100, 101, 102], g: [-8, -1, 3] }];
eq(C.dayTop(day, 2), [{ strike: 100, g: -8e6 }, { strike: 101, g: -5e6 }], 'dayTop = per-strike peak over the session, top 2');
eq(C.dayTop([], 2), [], 'dayTop empty');

console.log(n + ' passed');
