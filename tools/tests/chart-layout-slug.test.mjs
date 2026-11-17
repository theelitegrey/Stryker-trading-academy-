// Layout link ids (assets/chart-layout-slug.js, Owner feature 17 Nov 2026): 8 chars, uppercase letters + digits,
// no 0 O 1 I L, uniform, plus the /charts/<ID> path parsing.   node tools/tests/chart-layout-slug.test.mjs
import assert from 'node:assert/strict';
import { genSlug, isSlug, slugFromPath, isChartsPath, SLUG_CHARS, SLUG_LEN } from '../../assets/chart-layout-slug.js';

let n = 0; const ok = (name, f) => { f(); n++; console.log('PASS', name); };
ok('charset is 31 symbols, no confusables', () => {
  assert.equal(SLUG_CHARS.length, 31); assert.equal(new Set(SLUG_CHARS).size, 31);
  for (const c of '0O1IL') assert.ok(!SLUG_CHARS.includes(c), c);
  assert.ok(/^[A-Z0-9]+$/.test(SLUG_CHARS));
});
const seen = new Set(), count = {};
ok('20000 ids: length 8, charset only, isSlug, no repeats', () => {
  for (let i = 0; i < 20000; i++) {
    const s = genSlug();
    assert.equal(s.length, SLUG_LEN); assert.equal(s.length, 8);
    assert.ok(/^[A-Z2-9]{8}$/.test(s) && !/[0O1IL]/.test(s), s);
    assert.ok(isSlug(s), s);
    assert.ok(!seen.has(s), 'repeat ' + s); seen.add(s);
    for (const c of s) count[c] = (count[c] || 0) + 1;
  }
});
ok('every symbol is used, roughly evenly (rejection sampling)', () => {
  assert.equal(Object.keys(count).length, 31);
  const exp = 20000 * 8 / 31, vals = Object.values(count);
  assert.ok(Math.min(...vals) > exp * 0.9 && Math.max(...vals) < exp * 1.1, JSON.stringify([Math.min(...vals), Math.max(...vals), exp]));
});
ok('bytes >= 248 are skipped (no modulo bias)', () => {
  let call = 0;
  const s = genSlug((a) => { for (let i = 0; i < a.length; i++) a[i] = call === 0 ? 255 : i; call++; return a; });
  assert.equal(s, SLUG_CHARS.slice(0, 8));
});
ok('isSlug rejects confusables, case, length', () => {
  for (const b of ['VMW7HYS', 'VMW7HYSIX', 'vmw7hysi', 'VMW7HYS0', 'VMW7HYSO', 'VMW7HYS1', 'VMW7HYSL', '', null, 12345678]) assert.ok(!isSlug(b), String(b));
  assert.ok(isSlug('VMW7HYSJ'));
});
ok('slugFromPath', () => {
  assert.equal(slugFromPath('/charts/VMW7HYSJ'), 'VMW7HYSJ');
  assert.equal(slugFromPath('/charts/vmw7hysj/'), 'VMW7HYSJ');
  for (const p of ['/charts', '/charts.html', '/charts/agents', '/charts/VMW7HYSI', '/charts/VMW7HYSJ/x', '/x/VMW7HYSJ', '/charts/ABCDEFG0']) assert.equal(slugFromPath(p), null, p);
});
ok('isChartsPath', () => {
  for (const p of ['/charts', '/charts/', '/charts.html', '/charts/VMW7HYSJ']) assert.ok(isChartsPath(p), p);
  for (const p of ['/charts-agents', '/dashboard-user', '/charts/x/y']) assert.ok(!isChartsPath(p), p);
});
console.log(n + '/7 passed');
