// Rithmic saved login + auto sync: server-side tests (no Firebase, no network except the local mock).
//   NODE_PATH=<a node_modules with firebase-admin + firebase-functions> node tools/tests/rithmic-creds.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pass = 0;
const t = (n, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('PASS ' + n); }, (e) => { console.log('FAIL ' + n + '\n  ' + (e && e.stack || e)); process.exitCode = 1; });

const K1 = crypto.randomBytes(32).toString('base64'), K2 = crypto.randomBytes(32).toString('base64');
const PW = 'pw-' + crypto.randomBytes(6).toString('hex');
delete process.env.RITHMIC_CRED_KEY; delete process.env.RITHMIC_CRED_KEY_VERSION;
// firebase-admin / firebase-functions are not installed in the worktree: stub just what the module touches at load.
const Module = require('node:module');
const fake = (id, exports) => { const f = require.resolve ? null : null; Module._cache[id] = { id, loaded: true, exports }; };
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const chain = { https: { HttpsError, onCall: (fn) => fn }, region() { return this; }, runWith() { return this; }, pubsub: { schedule() { return { timeZone() { return { onRun: (f) => f }; } }; } } };
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === 'firebase-functions') return chain;
  if (req === 'firebase-admin') { const fs_ = () => ({ collection: () => ({}) }); fs_.FieldValue = { serverTimestamp: () => 'TS', increment: (n) => n }; return { apps: [1], initializeApp() {}, firestore: fs_ }; }
  return origLoad.call(this, req, ...a);
};
const mod = require('../../functions-src/rithmicCreds.js');
const X = mod._test;

await t('server copies of the browser modules are current', () => {
  execFileSync('node', ['tools/sync-rithmic-server.mjs', '--check'], { cwd: new URL('../../', import.meta.url).pathname });
});
await t('no key -> refuses to encrypt (nothing saved without RITHMIC_CRED_KEY)', () => {
  assert.equal(X.haveKey({}), false);
  assert.throws(() => X.encryptPassword('u1', PW, {}), /not set up/);
  assert.equal(X.haveKey({ RITHMIC_CRED_KEY: 'short' }), false);   // not 32 bytes
});
await t('encrypt/decrypt round trip; ciphertext does not contain the password', () => {
  const env = { RITHMIC_CRED_KEY: K1 };
  const e = X.encryptPassword('u1', PW, env);
  assert.deepEqual(Object.keys(e).sort(), ['encPassword', 'iv', 'keyVersion', 'tag']);
  assert.ok(!JSON.stringify(e).includes(PW));
  assert.equal(X.decryptPassword('u1', e, env), PW);
  assert.notEqual(X.encryptPassword('u1', PW, env).iv, e.iv, 'fresh iv each time');
});
await t('tamper and wrong uid fail (GCM tag + uid bound as AAD)', () => {
  const env = { RITHMIC_CRED_KEY: K1 };
  const e = X.encryptPassword('u1', PW, env);
  assert.throws(() => X.decryptPassword('u2', e, env));
  const bad = Buffer.from(e.encPassword, 'base64'); bad[0] ^= 1;
  assert.throws(() => X.decryptPassword('u1', Object.assign({}, e, { encPassword: bad.toString('base64') }), env));
  assert.throws(() => X.decryptPassword('u1', e, { RITHMIC_CRED_KEY: K2 }));
});
await t('key rotation: old rows decrypt with _V1, new rows use the new version', () => {
  const old = X.encryptPassword('u1', PW, { RITHMIC_CRED_KEY: K1 });                       // version 1
  const env2 = { RITHMIC_CRED_KEY: K2, RITHMIC_CRED_KEY_VERSION: '2', RITHMIC_CRED_KEY_V1: K1 };
  assert.equal(X.decryptPassword('u1', old, env2), PW);
  const nu = X.encryptPassword('u1', X.decryptPassword('u1', old, env2), env2);
  assert.equal(nu.keyVersion, 2);
  assert.equal(X.decryptPassword('u1', nu, { RITHMIC_CRED_KEY: K2, RITHMIC_CRED_KEY_VERSION: '2' }), PW);   // old key no longer needed
  assert.throws(() => X.decryptPassword('u1', old, { RITHMIC_CRED_KEY: K2, RITHMIC_CRED_KEY_VERSION: '2' }), /key for this saved login/);
});
await t('input checks: gateway must be wss://*.rithmic.com, sync time HH:MM', () => {
  assert.ok(X.gatewayOk('wss://rprotocol.rithmic.com:443'));
  for (const g of ['ws://rprotocol.rithmic.com', 'wss://evil.com', 'wss://rithmic.com.evil.com', '', null]) assert.equal(X.gatewayOk(g), false, String(g));
  assert.ok(X.timeOk('17:15') && X.timeOk('00:00')); assert.ok(!X.timeOk('24:00') && !X.timeOk('5pm'));
});
await t('schedule: due only after the member\'s ET time, weekdays, once a day, never mid-session', () => {
  const at = (iso) => Date.parse(iso);
  // 2026-10-27 is a Tuesday; EDT = UTC-4. 17:20 ET = 21:20Z
  assert.equal(X.isDue({ syncTime: '17:15' }, at('2026-10-27T21:20:00Z')), true);
  assert.equal(X.isDue({ syncTime: '17:15' }, at('2026-10-27T21:10:00Z')), false);          // before
  assert.equal(X.isDue({ syncTime: '17:15' }, at('2026-10-27T14:00:00Z')), false);          // 10:00 ET, market hours
  assert.equal(X.isDue({ syncTime: '17:15' }, at('2026-10-27T23:30:00Z')), false);          // too late (>90 min)
  assert.equal(X.isDue({ syncTime: '17:15', lastSyncDay: '2026-10-27' }, at('2026-10-27T21:20:00Z')), false);
  assert.equal(X.isDue({ syncTime: '17:15' }, at('2026-10-31T21:20:00Z')), false);          // Saturday
  assert.equal(X.isDue({ syncTime: '18:30' }, at('2026-10-27T22:40:00Z')), true);           // member-chosen time
});
await t('source: no secret reaches a log, a status reply or an audit row', () => {
  const src = fs.readFileSync(new URL('../../functions-src/rithmicCreds.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /console\.|functions\.logger/);
  const status = src.slice(src.indexOf('exports.rithmicCredStatus'), src.indexOf('exports.rithmicCredDelete'));
  assert.doesNotMatch(status, /encPassword|password|\biv\b|\btag\b/);
  for (const m of src.matchAll(/audit\([^)]*\)/g)) assert.doesNotMatch(m[0], /password|username|encPassword/i);
  assert.match(fs.readFileSync(new URL('../../functions-src/firestore.rules', import.meta.url), 'utf8'), /match \/rithmicCreds\/\{uid\}\s*\{ allow read, write: if false;/);
  assert.match(fs.readFileSync(new URL('../../functions-src/accountAdmin.js', import.meta.url), 'utf8'), /collection\('rithmicCreds'\)\.doc\(targetUid\)\.delete/);
});

// one real server-side sync against the mock gateway, with a decrypted saved row
const PORT = 8792;
const mock = spawn('node', [new URL('./rithmic-mock.mjs', import.meta.url).pathname, String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => mock.stdout.once('data', r));
try {
  await t('auto sync: decrypts the saved login, reads the day, groups trips, logs out, sends no order', async () => {
    process.env.RITHMIC_CRED_KEY = K1;
    const row = Object.assign({ system: 'Apex', gateway: 'ws://127.0.0.1:' + PORT, username: 'demo' }, X.encryptPassword('u1', 'demo-pass'));
    // dev-only seam: the production loader is the same code
    const r = await mod._syncOne('u1', row);
    assert.equal(r.accounts, 2);
    assert.equal(r.trips.length, 1);                       // "today" fixture: one NQ trade on APEX-1001
    assert.equal(r.trips[0].grossPnl, 100);
    const st = await (await fetch('http://127.0.0.1:' + PORT + '/__stats')).json();
    assert.deepEqual(st.forbidden, []);
  });
} finally { mock.kill(); }
console.log(pass + ' passed');
process.exit(process.exitCode || 0);
