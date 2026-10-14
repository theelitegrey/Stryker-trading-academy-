// Options analytics ingest validation (src/options.js). CI runs it (no node:sqlite needed).
//   node workers/book-recorder/test/options.test.mjs
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { validateOpt, validateOptItem, dayRow } from '../src/options.js';

const now = Math.floor(Date.now() / 1000);
export const sample = (u = 'SPX', over = {}) => Object.assign({
  u, spot: 7700, t: now - 30, day: '2026-10-14',
  em: [{ k: '0DTE', x: '2026-10-14', days: 0.1, em: 17.7, pct: 0.23, lo: 7682.3, hi: 7717.7, iv: 0.2, iv_em: 23,
    fut: { root: 'ES', c: 7748, em: 17.8, lo: 7730.2, hi: 7765.8 } }],
  fut: { root: 'ES', p: 7748, ratio: 1.0062 },
  term: [['2026-10-14', 0.08, 0.2094, 0.1679, 0.1929], ['2026-10-15', 1.08, 0.1762, null, 0.1568]],
  atm30: 0.1268, skew30: 0.0311,
  ivx: { rank: 21.6, pct: 52.4, lo: 13.47, hi: 31.05, n: 252, name: 'VIX', now: 17.2 },
  pc: { vol: 1.217, oi: 1.197 }
}, over);
const gz = (o) => { const b = gzipSync(JSON.stringify(o)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
let n = 0;
const t = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log('PASS', name); });

await t('valid item', () => assert.equal(validateOptItem(sample(), now), ''));
await t('valid body', async () => { const v = await validateOpt(gz({ v: 1, items: [sample(), sample('QQQ')] }), now * 1000); assert.ok(v.items && v.items.length === 2, JSON.stringify(v)); });
await t('unknown symbol', () => assert.match(validateOptItem(sample('AAPL'), now), /not served/));
await t('stale', () => assert.match(validateOptItem(sample('SPX', { t: now - 3600 }), now), /stale/));
await t('future', () => assert.match(validateOptItem(sample('SPX', { t: now + 600 }), now), /future/));
await t('expected move outside spot', () => assert.match(validateOptItem(sample('SPX', { em: [Object.assign({}, sample().em[0], { lo: 7701 })] }), now), /em range/));
await t('absurd move', () => assert.match(validateOptItem(sample('SPX', { em: [Object.assign({}, sample().em[0], { em: 5000 })] }), now), /out of range/));
await t('bad em key', () => assert.match(validateOptItem(sample('SPX', { em: [Object.assign({}, sample().em[0], { k: 'Yearly' })] }), now), /bad em row/));
await t('term iv NaN', () => assert.match(validateOptItem(sample('SPX', { term: [['2026-10-14', 1, NaN, 0, 0]] }), now), /term/));
await t('duplicate symbol', async () => assert.match((await validateOpt(gz({ v: 1, items: [sample(), sample()] }), now * 1000)).error, /duplicate/));
await t('not gzip', async () => assert.equal((await validateOpt(new TextEncoder().encode(JSON.stringify({ v: 1, items: [sample()] })).buffer, now * 1000)).error, 'not gzip'));
await t('too many items', async () => assert.equal((await validateOpt(gz({ v: 1, items: [sample(), sample('QQQ'), sample('SPY'), sample('SPX')] }), now * 1000)).error, 'bad header'));
await t('day row', () => assert.deepEqual(dayRow(sample()), ['2026-10-14', 0.1268, 0.0311, 1.217, 17.2]));
console.log(n + ' passed');
