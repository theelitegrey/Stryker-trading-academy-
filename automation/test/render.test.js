const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stryker-social-'));
const scenes = require('../src/render/scenes');
const video = require('../src/render/video');
const Cards = require('../src/render/cards');

test('every scene type renders to a 1080x1920 PNG', () => {
  for (const type of ['title', 'point', 'stat', 'cta']) {
    const svg = scenes.sceneSvg({ type, heading: 'A heading that is fairly long to wrap', text: 'Supporting text under the heading, also long enough to wrap onto a second line.', stat: '4.93%' }, { kind: 'brief', index: 1, total: 5 });
    const png = scenes.renderPng(svg);
    assert.ok(png.length > 10000, type);
    assert.strictEqual(png.readUInt32BE(16), 1080); assert.strictEqual(png.readUInt32BE(20), 1920);
  }
});
test('card renders for each kind', async () => {
  for (const kind of ['brief', 'calendar', 'monitor', 'lesson', 'promo', 'feature', 'announce', 'manual']) {
    const svg = Cards.cardFor({ kind, title: 'T', source: { prints: [] }, scheduledForMs: Date.now(), expiresAtMs: Date.now() + 30 * 60000 }, { cardTitle: 'Headline', cardBody: 'Body text.' }, {});
    assert.ok(svg.startsWith('<svg'), kind);
  }
  const png = await Cards.renderPng(Cards.cardFor({ kind: 'brief', title: 'T', source: { prints: [] }, scheduledForMs: Date.now() }, { cardTitle: 'Headline', cardBody: 'Body.' }, {}));
  assert.strictEqual(png.readUInt32BE(16), 1200);
});
test('ASS captions time chunks across the speech', () => {
  const ass = video.assFile([{ start: 0, dur: 5, speech: 4, narration: 'one two three four five six seven eight nine ten' }]);
  const lines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[0].includes('0:00:00.00,0:00:02.00'));
  assert.ok(lines[1].includes('0:00:02.00,0:00:04.00'));
});
test('a short video builds with ffmpeg (no voice server)', { timeout: 240000 }, async () => {
  const r = await video.build({ id: 'test-clip', kind: 'lesson' }, { scenes: [
    { type: 'title', heading: 'Test', text: 'Two scenes', narration: 'A short test of the renderer.', stat: '' },
    { type: 'cta', heading: 'Done', text: '', narration: 'That is all.', stat: '' }
  ] }, { voice: 'none', musicDb: 0 });
  const f = path.join(process.env.DATA_DIR, r.video);
  assert.ok(fs.existsSync(f) && fs.statSync(f).size > 50000);
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, r.poster)));
  assert.ok(r.seconds >= 5);
});
