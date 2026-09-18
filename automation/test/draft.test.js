const test = require('node:test');
const assert = require('node:assert');
process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'stryker-social-test-' + process.pid);
const Draft = require('../src/draft/claude');

const post = { source: { headline: 'Ten-year at 4.93%', bullets: [{ text: 'S&P up 1.14% to 7,637.76 at 14:00 ET' }] }, instructions: 'x' };
const good = { x: ['Ten-year fell to 4.93% as the S&P rose 1.14%'], threads: 'ok', instagram: 'ok', youtube: { title: 't', description: 'd', tags: [] }, figuresUsed: ['4.93%', '1.14%'] };

test('captions with source figures pass', () => {
  assert.deepStrictEqual(Draft.validateCaptions(good, post, { thread: false, xBudget: 25 }), []);
});
test('an invented figure is rejected', () => {
  const bad = Object.assign({}, good, { x: ['Ten-year fell to 4.99%'], figuresUsed: [] });
  const p = Draft.validateCaptions(bad, post, { thread: false, xBudget: 25 });
  assert.ok(p.some((s) => s.includes('4.99%')));
});
test('a URL in any platform text is rejected', () => {
  const bad = Object.assign({}, good, { threads: 'see https://example.com' });
  assert.ok(Draft.validateCaptions(bad, post, { thread: false, xBudget: 25 }).some((s) => /URL/.test(s)));
});
test('X length respects the link reserve', () => {
  const bad = Object.assign({}, good, { x: ['a'.repeat(270)] });
  assert.ok(Draft.validateCaptions(bad, post, { thread: false, xBudget: 25 }).some((s) => /characters/.test(s)));
  assert.deepStrictEqual(Draft.validateCaptions(Object.assign({}, good, { x: ['a'.repeat(270)] }), post, { thread: false, xBudget: 0 }), []);
});
test('thread rules', () => {
  assert.ok(Draft.validateCaptions(good, post, { thread: true, xBudget: 0 }).some((s) => /thread/.test(s)));
  assert.ok(Draft.validateCaptions(Object.assign({}, good, { x: ['a', 'b'] }), post, { thread: false, xBudget: 0 }).some((s) => /single/.test(s)));
});
test('figures with commas and time formats match the source', () => {
  assert.deepStrictEqual(Draft.missingFigures(['7,637.76', '14:00 ET', '4.93%'], [], JSON.stringify(post.source)), []);
});
test('script validation: structure and narration budget', () => {
  const sc = (type, n, stat) => ({ type, heading: 'h', text: '', narration: Array.from({ length: n }, (_, i) => 'w' + i).join(' '), stat: stat || '' });
  const ok = { scenes: [sc('title', 15), sc('point', 20), sc('point', 20), sc('stat', 20, '4.93%'), sc('cta', 20)], figuresUsed: ['4.93%'] };
  assert.deepStrictEqual(Draft.validateScript(ok, post), []);
  const noCta = { scenes: [sc('title', 20), sc('point', 20), sc('point', 20), sc('point', 20), sc('point', 20)], figuresUsed: [] };
  assert.ok(Draft.validateScript(noCta, post).some((s) => /cta/.test(s)));
  const statless = { scenes: [sc('title', 15), sc('point', 20), sc('stat', 20), sc('point', 20), sc('cta', 20)], figuresUsed: [] };
  assert.ok(Draft.validateScript(statless, post).some((s) => /without a stat/.test(s)));
});
