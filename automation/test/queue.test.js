const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stryker-social-'));
const db = require('../src/db');
const { pacingAllows } = require('../src/scheduler');
const producers = require('../src/producers');
const { wavDuration, utmLink } = require('../src/util');
const X = require('../src/publish/x');

test('enqueue de-duplicates by id and claims are atomic', () => {
  assert.strictEqual(db.enqueue({ id: 'brief-2026-09-18', kind: 'brief', platforms: ['x'] }), true);
  assert.strictEqual(db.enqueue({ id: 'brief-2026-09-18', kind: 'brief', platforms: ['x'] }), false);
  assert.strictEqual(db.claim('brief-2026-09-18', 'ready', 'drafting'), true);
  assert.strictEqual(db.claim('brief-2026-09-18', 'ready', 'drafting'), false);
  assert.strictEqual(db.getPost('brief-2026-09-18').status, 'drafting');
});
test('settings merge over defaults and survive reload', () => {
  db.saveSettings({ pacing: { x: { maxPerDay: 2 } }, brief: { hour: 7 } });
  const s = db.settings();
  assert.strictEqual(s.pacing.x.maxPerDay, 2);
  assert.strictEqual(s.pacing.x.minGapMinutes, 45);
  assert.strictEqual(s.brief.hour, 7);
  assert.strictEqual(s.brief.minute, 30);
});
test('pacing: gap and daily cap, calendar ignores the gap', () => {
  const s = { pacing: { x: { minGapMinutes: 45, maxPerDay: 2 } } };
  const t = Date.parse('2026-09-18T12:00:00Z');
  const state = { platforms: { x: { lastPostAtMs: t - 10 * 60000, day: '2026-09-18', count: 1 } } };
  assert.strictEqual(pacingAllows('x', s, state, t).ok, false);
  assert.strictEqual(pacingAllows('x', s, state, t, true).ok, true);
  assert.strictEqual(pacingAllows('x', s, { platforms: { x: { lastPostAtMs: t - 60 * 60000, day: '2026-09-18', count: 2 } } }, t).why, 'daily cap');
  assert.strictEqual(pacingAllows('x', s, { platforms: { x: { lastPostAtMs: t - 60 * 60000, day: '2026-09-17', count: 2 } } }, t).ok, true);
});
test('platform selection: videos go everywhere enabled, text to X and Threads', () => {
  const s = { platforms: { x: true, threads: true, instagram: true, youtube: false } };
  assert.deepStrictEqual(producers.platformsFor('lesson', true, s), ['x', 'threads', 'instagram']);
  assert.deepStrictEqual(producers.platformsFor('feature', false, s), ['x', 'threads']);
});
test('lesson cursor skips short lessons and wraps', () => {
  const chapters = [
    { num: '01', title: 'A', lessons: [{ title: 'short', text: 'x' }, { title: 'long', text: 'y'.repeat(300) }] },
    { num: '02', title: 'B', lessons: [{ title: 'long2', text: 'z'.repeat(300) }] }
  ];
  const a = producers.nextLesson(chapters, {});
  assert.strictEqual(a.lesson.title, 'long');
  const b = producers.nextLesson(chapters, a.next);
  assert.strictEqual(b.lesson.title, 'long2');
  const c = producers.nextLesson(chapters, b.next);
  assert.strictEqual(c.lesson.title, 'long');
});
test('wav header duration', () => {
  const rate = 24000, secs = 2, data = Buffer.alloc(rate * 2 * secs);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  assert.strictEqual(wavDuration(Buffer.concat([h, data])), 2);
});
test('utm links and X weighted length', () => {
  const u = utmLink('https://strykertrading.com', '/chapter.html?ch=03', 'youtube', 'lesson-x');
  assert.ok(u.includes('utm_source=youtube') && u.includes('ch=03'));
  assert.strictEqual(X.weightedLength('hello https://example.com/very/long/path/that/goes/on'), 6 + 23);
});
