// Live tail from the recorder Worker: minute rows -> bucketed bars, and the fetch contract.  node tools/tests/bars-tail.test.mjs
import assert from 'node:assert/strict';
import { bucketTail, fetchRecorderTail, pageOf, pageBounds, mergeTail } from '../../functions/api/chart/_bars.js';
import { barsTailJson, decodeRecord } from '../../workers/book-recorder/src/orderflow.js';
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const T0 = 1700000100 - (1700000100 % 3600) + 3600;   // an hour boundary
const mins = []; for (let i = 0; i < 12; i++) mins.push([T0 + 60 * i, 100 + i, 105 + i, 99 + i, 101 + i, 10 + i]);
// 5m buckets
const b5 = bucketTail(mins, '5', 0, 1e12);
assert.equal(b5.length, 3); assert.deepEqual(b5[0], [T0, 100, 109, 99, 105, 10 + 11 + 12 + 13 + 14]);
assert.equal(b5[2][0], T0 + 600); assert.equal(b5[2][5], 20 + 21); ok('1m rows bucket to 5m: open of first, max high, min low, close of last, summed volume');
assert.equal(bucketTail(mins, '1', 0, 1e12).length, 12); ok('1m passes through');
assert.equal(bucketTail(mins, '240', 0, 1e12), null); assert.equal(bucketTail(mins, 'D', 0, 1e12), null); ok('4h / D are not served from the tail (null = old path)');
const mid = mins.slice(2); assert.equal(bucketTail(mid, '5', 0, 1e12)[0][0], T0 + 300); ok('a first bucket that starts mid-way is dropped, never shown as a short candle');
// page window filter
const [p1, p2] = [T0 + 120, T0 + 400]; assert.ok(bucketTail(mins, '1', p1, p2).every((r) => r[0] >= p1 && r[0] < p2)); ok('rows outside the page are cut');
// merge over Yahoo rows
const yahoo = [[T0 - 600, 1, 1, 1, 1, 1], [T0 - 300, 2, 2, 2, 2, 2]];
assert.equal(mergeTail(yahoo, b5).length, 5); ok('merged after Yahoo history');
// fetch contract
let seen = null;
const fakeFetch = async (u, init) => { seen = { u, auth: init.headers.authorization }; return new Response(JSON.stringify({ rows: mins }), { status: 200 }); };
const now = T0 + 700, page = pageOf('5', now);
const got = await fetchRecorderTail('NQ', '5', page, 'tok', fakeFetch);
assert.ok(got && got.length >= 1); assert.match(seen.u, /\/bars-tail\?sym=NQ$/); assert.equal(seen.auth, 'Bearer tok'); ok('fetch sends the caller token to /bars-tail?sym=NQ');
assert.equal(await fetchRecorderTail('RTY', '5', page, 'tok', fakeFetch), null); assert.equal(await fetchRecorderTail('NQ', '5', page, '', fakeFetch), null); ok('non-recorded symbols and token-less callers get null (never the live tail)');
assert.equal(await fetchRecorderTail('NQ', '5', page, 'tok', async () => new Response('x', { status: 403 })), null);
assert.equal(await fetchRecorderTail('NQ', '5', page, 'tok', async () => { throw new Error('down'); }), null); ok('403 / network error => null (falls back)');
const mg = await fetchRecorderTail('MNQ', '5', page, 'tok', fakeFetch);
assert.match(seen.u, /sym=NQ$/); assert.ok(mg.length >= 1 && mg.every((r) => r[5] === 0)); ok('MNQ reads the NQ tail, volume 0 (micro volume not recorded)');
// Worker side: a real feeder record -> OHLCV
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
import { splitPayload } from '../../workers/book-recorder/src/orderflow.js';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'bt-')), 'nq.bin');
execFileSync('python3', [join(here, '../../workers/book-recorder/of-feeder/of_feeder.py'), '--dry-run', join(here, '../../workers/book-recorder/test/fixtures/nq-trades-20261013-12utc.json.gz'), 'NQ', out]);
const sp = splitPayload(new Uint8Array(readFileSync(out)));
const j = barsTailJson('NQ', sp.recs.slice(0, 5));
assert.equal(j.rows.length, 5);
for (const r of j.rows) { assert.ok(r[2] >= Math.max(r[1], r[4]) && r[3] <= Math.min(r[1], r[4]) && r[5] > 0, JSON.stringify(r)); assert.equal(r[0] % 60, 0); }
const d0 = decodeRecord(sp.recs[0]); assert.equal(j.rows[0][1], d0.o * 0.25); ok('recorder minute records -> OHLCV rows (o/h/l/c within range, volume > 0, real prices)');
console.log(n + ' passed'); process.exit(0);
