// node tools/tests/fix-link.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { fixLink } = createRequire(import.meta.url)('../../assets/fix-link.js');
const key = fs.readFileSync(new URL('../../assets/auth.js', import.meta.url), 'utf8').match(/apiKey: "([^"]+)"/)[1];
const q = `?mode=verifyEmail&oobCode=abc123&apiKey=${key}&continueUrl=https%3A%2F%2Ftradezoro.com%2Fdashboard-user&lang=en`;
const ok = h => `https://${h}/__/auth/action${q}`;
for (const h of ['strykertrades-e0cd8.firebaseapp.com', 'strykertrades-e0cd8.web.app', 'tradezoro.com', 'www.tradezoro.com'])
  assert.equal(fixLink(ok(h)), 'https://tradezoro.com/__/auth/action' + q, h);
for (const m of ['resetPassword', 'recoverEmail', 'verifyAndChangeEmail'])
  assert.ok(fixLink(ok('tradezoro.com').replace('verifyEmail', m)), m);
assert.ok(fixLink('  ' + ok('tradezoro.com') + '\n'));
const bad = [
  ok('evil.example'), ok('tradezoro.com.evil.example'), ok('evil.example/x@tradezoro.com'),
  `https://tradezoro.com/login${q}`, `https://tradezoro.com/__/auth/action/x${q}`,
  `https://tradezoro.com/__/auth/action?mode=verifyEmail&apiKey=${key}`,
  `https://tradezoro.com/__/auth/action?mode=verifyEmail&oobCode=&apiKey=${key}`,
  `https://tradezoro.com/__/auth/action?mode=signIn&oobCode=a&apiKey=${key}`,
  'https://tradezoro.com/__/auth/action?mode=verifyEmail&oobCode=a&apiKey=WRONG',
  'https://tradezoro.com/__/auth/action?mode=verifyEmail&oobCode=a',
  'javascript:alert(1)', 'data:text/html,x', 'http://tradezoro.com/__/auth/action' + q, 'not a url', '', null,
];
for (const b of bad) assert.equal(fixLink(b), null, String(b));
console.log('fix-link tests passed');
