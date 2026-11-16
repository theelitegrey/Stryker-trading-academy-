// Unit tests for the system-browser Google sign-in helpers (src/handoff.js). Run: node --test test/handoff.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../src/handoff');

const CODE = 'A'.repeat(43);

test('nonce: 32 random bytes, url-safe, never repeats', () => {
  const a = h.makeNonce(), b = h.makeNonce();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  const seen = new Set(); for (let i = 0; i < 500; i++) seen.add(h.makeNonce());
  assert.equal(seen.size, 500);
});

test('PKCE pair: challenge = base64url(sha256(verifier)), verifier not derivable from the URL', () => {
  const { verifier, challenge } = h.makePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, require('crypto').createHash('sha256').update(verifier).digest('base64url'));
  assert.notEqual(verifier, challenge);
  assert.ok(!h.loginUrl(challenge, 5000).includes(verifier));
});

test('login URL: only tradezoro.com/desktop-login, nonce + port as query', () => {
  const u = new URL(h.loginUrl('n'.repeat(43), 51234));
  assert.equal(u.origin, 'https://tradezoro.com');
  assert.equal(u.pathname, '/desktop-login');
  assert.equal(u.searchParams.get('nonce'), 'n'.repeat(43));
  assert.equal(u.searchParams.get('port'), '51234');
  assert.equal(new URL(h.loginUrl('x'.repeat(43), null)).searchParams.has('port'), false);   // protocol fallback
});

test('loopback: only GET /done?code= on Host 127.0.0.1:<port>', () => {
  assert.equal(h.codeFromLoopback('GET', '/done?code=' + CODE, '127.0.0.1:5000', 5000), CODE);
  assert.equal(h.codeFromLoopback('POST', '/done?code=' + CODE, '127.0.0.1:5000', 5000), null);
  assert.equal(h.codeFromLoopback('GET', '/done?code=' + CODE, 'evil.example:5000', 5000), null);   // DNS rebinding
  assert.equal(h.codeFromLoopback('GET', '/done?code=' + CODE, 'localhost:5000', 5000), null);
  assert.equal(h.codeFromLoopback('GET', '/done?code=' + CODE, '127.0.0.1:5001', 5000), null);
  assert.equal(h.codeFromLoopback('GET', '/other?code=' + CODE, '127.0.0.1:5000', 5000), null);
  assert.equal(h.codeFromLoopback('GET', '/done?code=short', '127.0.0.1:5000', 5000), null);
  assert.equal(h.codeFromLoopback('GET', '/done?code=' + CODE + '%3Cscript', '127.0.0.1:5000', 5000), null);
  assert.equal(h.codeFromLoopback('GET', '/done', '127.0.0.1:5000', 5000), null);
  assert.equal(h.codeFromLoopback('GET', '//evil.example/done?code=' + CODE, '127.0.0.1:5000', 5000), null);
});

test('protocol: tradezoro://auth?code= only', () => {
  assert.equal(h.codeFromProtocolUrl('tradezoro://auth?code=' + CODE), CODE);
  assert.equal(h.codeFromProtocolUrl('tradezoro://auth/?code=' + CODE), CODE);
  assert.equal(h.codeFromProtocolUrl('TRADEZORO://auth?code=' + CODE), CODE);
  assert.equal(h.codeFromProtocolUrl('tradezoro://other?code=' + CODE), null);
  assert.equal(h.codeFromProtocolUrl('https://auth?code=' + CODE), null);
  assert.equal(h.codeFromProtocolUrl('tradezoro://auth?code=bad'), null);
  assert.equal(h.codeFromProtocolUrl('not a url'), null);
});

test('protocol arg is found in a second-instance argv (Windows)', () => {
  const u = 'tradezoro://auth?code=' + CODE;
  assert.equal(h.protocolArg(['C:\\TradeZoro.exe', '--allow-file-access-from-files', u]), u);
  assert.equal(h.protocolArg(['C:\\TradeZoro.exe']), null);
  assert.equal(h.protocolArg(undefined), null);
});

test('after-redirect stays on tradezoro.com', () => {
  assert.equal(h.afterUrl(true), 'https://tradezoro.com/desktop-login?done=1');
  assert.equal(h.afterUrl(false), 'https://tradezoro.com/desktop-login?failed=1');
});

test('limits: 5 minute flow, a few bad codes', () => {
  assert.equal(h.FLOW_TTL_MS, 300000);
  assert.ok(h.MAX_BAD_CODES >= 3 && h.MAX_BAD_CODES <= 10);
});
