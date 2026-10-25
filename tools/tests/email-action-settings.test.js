// Test: pickEmailActionSettings() in assets/auth.js (continue URL for the
// Firebase reset / verify emails). node tools/tests/email-action-settings.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../assets/auth.js'), 'utf8');
// Pull out just the constant + function; the rest of auth.js needs a browser.
const start = src.indexOf('const EMAIL_RETURN_HOSTS');
const end = src.indexOf('// Thin wrappers', start);
assert(start > 0 && end > start, 'pickEmailActionSettings block not found');
const pick = new Function(src.slice(start, end) + '\nreturn pickEmailActionSettings;')();

const cases = [
  // [hostname, kind, path, expected]
  ['tradezoro.com', 'reset', undefined, { url: 'https://tradezoro.com/login?reset=1' }],
  ['tradezoro.com', 'verify', '/dashboard-user', { url: 'https://tradezoro.com/dashboard-user' }],
  ['tradezoro.com', 'verify', '/rithmic-review', { url: 'https://tradezoro.com/rithmic-review' }],
  ['tradezoro.com', 'verify', '/settings', { url: 'https://tradezoro.com/settings' }],
  ['tradezoro.com', 'verify', undefined, { url: 'https://tradezoro.com/dashboard-user' }],
  ['tradezoro.com', 'verify', '//evil.example/x', { url: 'https://tradezoro.com/dashboard-user' }],
  ['tradezoro.com', 'verify', 'https://evil.example', { url: 'https://tradezoro.com/dashboard-user' }],
  ['tradezoro.com', 'verify', '/\\evil.example', { url: 'https://tradezoro.com/dashboard-user' }],
  ['tradezoro.com', 'verify', '/login', { url: 'https://tradezoro.com/dashboard-user' }],
  ['tradezoro.com', 'verify', '/signup.html', { url: 'https://tradezoro.com/dashboard-user' }],
  // Every other host keeps the old behaviour (no settings at all).
  ['www.tradezoro.com', 'reset', undefined, null],
  ['strykertrading.com', 'reset', undefined, null],
  ['localhost', 'verify', '/dashboard-user', null],
  ['127.0.0.1', 'reset', undefined, null],
  ['strykertrades-e0cd8.firebaseapp.com', 'verify', '/x', null],
  ['tradezoro.com.evil.example', 'reset', undefined, null],
];
let fail = 0;
for (const [h, k, p, want] of cases) {
  const got = pick(h, k, p);
  try { assert.deepStrictEqual(got, want); console.log('ok  ', h, k, p, '->', JSON.stringify(got)); }
  catch (e) { fail++; console.log('FAIL', h, k, p, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); }
}
console.log(fail ? fail + ' failed' : 'all ' + cases.length + ' passed');
process.exit(fail ? 1 : 0);
