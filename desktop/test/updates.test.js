// node --test test/   (no Electron needed)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const U = require('../src/updates');

test('version compare', () => {
  assert.strictEqual(U.compare('1.1.0', '1.0.1'), 1);
  assert.strictEqual(U.compare('1.10.0', '1.9.9'), 1);
  assert.strictEqual(U.compare('1.0.1', '1.0.1'), 0);
  assert.strictEqual(U.compare('v1.0.1', '1.0.1'), 0);
  assert.strictEqual(U.compare('1.0', '1.0.0'), 0);
  assert.strictEqual(U.compare('0.9.9', '1.0.0'), -1);
});

test('the repo manifest parses', () => {
  const m = U.parseManifest(fs.readFileSync(path.join(__dirname, '..', '..', 'app-version.json'), 'utf8'));
  assert.ok(m && /^\d+\.\d+\.\d+$/.test(m.version) && m.notes.length > 0);
});

test('bad manifests give null', () => {
  for (const s of ['', 'nope', '{}', '{"windows":{"version":1}}', '{"windows":{"version":"1.2"}}']) assert.strictEqual(U.parseManifest(s), null, s);
  assert.strictEqual(U.parseManifest({ windows: { version: '1.2.0', minVersion: 'x' } }).minVersion, null);
});

const M = { version: '1.1.0', url: '/dl/TradeZoro-Setup.exe', notes: ['New banner'], minVersion: '1.0.0' };
test('banner: downloaded update shows, with notes only when versions match', () => {
  assert.deepStrictEqual(U.bannerState({ installed: '1.0.1', manifest: M, ready: '1.1.0' }),
    { kind: 'ready', version: '1.1.0', note: 'New banner', ready: true, canInstall: false });
  assert.strictEqual(U.bannerState({ installed: '1.0.1', manifest: M, ready: '1.2.0' }).note, '');
});
test('banner: nothing without a download, after X, or when not newer', () => {
  assert.strictEqual(U.bannerState({ installed: '1.0.1', manifest: M, ready: null }), null);
  assert.strictEqual(U.bannerState({ installed: '1.0.1', manifest: M, ready: '1.1.0', dismissed: '1.1.0' }), null);
  assert.strictEqual(U.bannerState({ installed: '1.1.0', manifest: M, ready: '1.1.0' }), null);
  assert.strictEqual(U.bannerState({ installed: '1.0.1', manifest: null, ready: '1.1.0' }).kind, 'ready');
});
test('banner: below minVersion blocks, even after X', () => {
  const s = U.bannerState({ installed: '0.9.0', manifest: M, ready: null, dismissed: '1.1.0' });
  assert.strictEqual(s.kind, 'block'); assert.strictEqual(s.ready, false);
  assert.strictEqual(U.bannerState({ installed: '0.9.0', manifest: M, ready: '1.1.0', dismissed: '1.1.0' }).ready, true);
});
