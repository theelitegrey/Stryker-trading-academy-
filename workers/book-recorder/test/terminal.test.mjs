// Unit tests for src/terminal.js (brief / market map / econ calendar files served by the Worker).
// Run: node workers/book-recorder/test/terminal.test.mjs
import assert from 'node:assert/strict';
import { validateTerminal, terminalHealth, TERMINAL_NAMES } from '../src/terminal.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const now = Date.parse('2026-10-14T19:00:00Z');
const base = { schema: 1, generatedAt: '2026-10-14T18:55:00Z', goodUntil: '2026-10-15T07:00:00Z' };
const brief = Object.assign({ headline: 'h', bullets: [{ title: 'a', text: 'b' }] }, base);
const map = Object.assign({ groups: [{ id: 'x', rows: [] }], periods: ['1D'], curve: {} }, base);
const cal = Object.assign({ events: [{ at: '2026-10-14T12:30:00Z' }], currencies: [] }, base);

t('names', () => assert.deepEqual(TERMINAL_NAMES, ['market-brief', 'market-map', 'econ-calendar']));
t('valid files pass', () => {
  assert.ok(validateTerminal('market-brief', brief, now).ok);
  assert.ok(validateTerminal('market-map', map, now).ok);
  assert.ok(validateTerminal('econ-calendar', cal, now).ok);
});
t('unknown name refused', () => assert.equal(validateTerminal('other', brief, now).error, 'bad name'));
t('wrong schema refused', () => assert.equal(validateTerminal('market-brief', Object.assign({}, brief, { schema: 2 }), now).error, 'schema'));
t('old generatedAt refused (a replayed file cannot overwrite a fresh one)', () =>
  assert.match(validateTerminal('market-brief', Object.assign({}, brief, { generatedAt: '2026-10-14T17:00:00Z' }), now).error, /generatedAt/));
t('goodUntil must be after generatedAt and within 4 days', () => {
  assert.equal(validateTerminal('market-brief', Object.assign({}, brief, { goodUntil: '2026-10-14T18:00:00Z' }), now).error, 'goodUntil');
  assert.equal(validateTerminal('market-brief', Object.assign({}, brief, { goodUntil: '2026-10-20T07:00:00Z' }), now).error, 'goodUntil');
  assert.equal(validateTerminal('market-brief', Object.assign({}, brief, { goodUntil: 'soon' }), now).error, 'goodUntil');
});
t('shape checks per file', () => {
  assert.equal(validateTerminal('market-brief', Object.assign({}, base), now).error, 'brief shape');
  assert.equal(validateTerminal('market-map', Object.assign({}, base, { groups: [] }), now).error, 'map shape');
  assert.equal(validateTerminal('econ-calendar', Object.assign({}, base, { events: [] }), now).error, 'calendar shape');
  assert.equal(validateTerminal('market-map', [], now).error, 'bad body');
});
t('health: all fresh -> ok', () => {
  const rows = TERMINAL_NAMES.map((name) => ({ name, t: now - 60000, g: now - 60000, u: now + 3600000 }));
  const h = terminalHealth(rows, now);
  assert.equal(h.ok, true);
  assert.equal(h.files['market-map'].ok, true);
});
t('health: one past goodUntil -> not ok, names it', () => {
  const rows = TERMINAL_NAMES.map((name) => ({ name, t: now, g: now, u: name === 'econ-calendar' ? now - 1 : now + 3600000 }));
  const h = terminalHealth(rows, now);
  assert.equal(h.ok, false);
  assert.equal(h.files['econ-calendar'].ok, false);
  assert.equal(h.files['market-brief'].ok, true);
});
t('health: a missing file -> not ok', () => {
  const h = terminalHealth([{ name: 'market-brief', t: now, g: now, u: now + 1 }], now);
  assert.equal(h.ok, false);
  assert.equal(h.files['market-map'].missing, true);
});
console.log(n + ' terminal tests passed');
