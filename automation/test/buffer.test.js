const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stryker-social-'));
process.env.BUFFER_API_KEY = 'test-key';
const { env } = require('../src/config');
const db = require('../src/db');
const Buffer_ = require('../src/publish/buffer');
const Publish = require('../src/publish');

// A fake api.buffer.com that records the GraphQL requests it gets.
const calls = [];
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url) !== 'https://api.buffer.com') return realFetch(url, opts);
  const body = JSON.parse(opts.body);
  calls.push({ auth: opts.headers.authorization, body });
  const q = body.query;
  const reply = (data) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (/organizations/.test(q) && !/channels/.test(q)) return reply({ account: { email: 'a@b.c', organizations: [{ id: 'org1', name: 'Stryker' }] } });
  if (/channels\(/.test(q)) return reply({ channels: [
    { id: 'chx', name: 'Stryker', service: 'twitter', displayName: '@stryker', isDisconnected: false },
    { id: 'chig', name: 'stryker', service: 'instagram', displayName: 'stryker', isDisconnected: false },
    { id: 'chyt', name: 'Stryker', service: 'youtube', displayName: 'Stryker', isDisconnected: false }
  ] });
  if (/createPost/.test(q)) {
    if (body.variables.input.text === 'REJECT') return reply({ createPost: { message: 'Text too long' } });
    return reply({ createPost: { post: { id: 'p_' + calls.length, dueAt: null } } });
  }
  return reply({});
};

test('channels are fetched with the org id and mapped to platform names', async () => {
  const list = await Buffer_.channels(true);
  assert.deepStrictEqual(list.map((c) => c.platform), ['x', 'instagram', 'youtube']);
  assert.strictEqual(calls[0].auth, 'Bearer test-key');
  assert.strictEqual(calls[1].body.variables.organizationId, 'org1');
});

test('an X thread becomes text + twitter.thread metadata, share now', async () => {
  const ch = await Buffer_.channelFor('x', { buffer: {} });
  const r = await Buffer_.createPost({ channel: ch, platform: 'x', parts: ['head', 'second', 'third'], media: {} });
  const input = calls[calls.length - 1].body.variables.input;
  assert.strictEqual(input.channelId, 'chx');
  assert.strictEqual(input.text, 'head');
  assert.strictEqual(input.mode, 'shareNow');
  assert.deepStrictEqual(input.metadata.twitter.thread, [{ text: 'second' }, { text: 'third' }]);
  assert.ok(r.id && r.url.includes(r.id));
});

test('a video post is a reel on Instagram and a titled public video on YouTube', async () => {
  const ig = await Buffer_.channelFor('instagram', { buffer: {} });
  await Buffer_.createPost({ channel: ig, platform: 'instagram', parts: ['caption'], media: { videoUrl: 'https://h/media/a.mp4' } });
  let input = calls[calls.length - 1].body.variables.input;
  assert.deepStrictEqual(input.assets, [{ video: { url: 'https://h/media/a.mp4' } }]);
  assert.strictEqual(input.metadata.instagram.type, 'reel');
  const yt = await Buffer_.channelFor('youtube', { buffer: {} });
  await Buffer_.createPost({ channel: yt, platform: 'youtube', parts: ['desc'], media: { videoUrl: 'https://h/media/a.mp4', title: 'T #Shorts' } });
  input = calls[calls.length - 1].body.variables.input;
  assert.strictEqual(input.metadata.youtube.title, 'T #Shorts');
  assert.strictEqual(input.metadata.youtube.privacy, 'public');
});

test('a MutationError surfaces as a thrown error; a missing channel too', async () => {
  const ch = await Buffer_.channelFor('x', { buffer: {} });
  await assert.rejects(Buffer_.createPost({ channel: ch, platform: 'x', parts: ['REJECT'], media: {} }), /Text too long/);
  await assert.rejects(Buffer_.channelFor('threads', { buffer: {} }), /No threads channel/);
});

test('routing: viaBuffer respects the per-platform switches and configured() reflects it', () => {
  const s = { buffer: { enabled: true, platforms: { x: true, youtube: false } } };
  assert.strictEqual(Publish.viaBuffer('x', s), true);
  assert.strictEqual(Publish.viaBuffer('youtube', s), false);
  assert.strictEqual(Publish.viaBuffer('threads', s), true);   // unset means on
  assert.strictEqual(Publish.viaBuffer('x', { buffer: { enabled: false } }), false);
  const c = Publish.configured(s);
  assert.strictEqual(c.buffer, true); assert.strictEqual(c.x, true); assert.strictEqual(c.youtube, false);
});

test('publish() through Buffer builds the right text per platform', async () => {
  const s = { buffer: { enabled: true, platforms: {} }, xLinkPolicy: 'all', cards: true, platforms: {} };
  const post = { id: 'brief-1', kind: 'brief', title: 'Brief', video: false, linkPath: '/market-brief.html', campaign: 'brief',
    drafts: { x: ['one', 'two'], threads: 'threads text', instagram: 'ig', youtube: { title: 'yt' } }, media: {} };
  const r = await Publish.publish('x', post, s);
  const input = calls[calls.length - 1].body.variables.input;
  assert.ok(input.metadata.twitter.thread[0].text.includes('utm_source=x'));
  assert.strictEqual(r.via, 'buffer');
});
