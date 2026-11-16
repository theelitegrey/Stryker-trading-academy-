// TradeZoro desktop: Google sign-in in the SYSTEM browser (Google refuses OAuth inside embedded browsers such as
// Electron: "Couldn't sign you in. This browser or app may not be secure", whatever the user agent says).
// Pure helpers, no Electron import, so test/handoff.test.js runs them under plain node. main.js wires them up.
//
// Flow (one sign-in at a time):
//   1. The login page calls window.tzDesktop.googleSignIn(). Main makes a random verifier (32 bytes) and opens
//      https://tradezoro.com/desktop-login?nonce=<sha256(verifier)>&port=<p> in the default browser.
//      <p> is a loopback server on 127.0.0.1 that main starts for this one sign-in (random port, closed after
//      use or 5 minutes). If it cannot listen, the URL carries no port and the page returns through the
//      tradezoro:// protocol instead.
//   2. That page signs in with Google there (the normal site popup and account picker), then
//      POST /api/desktop/handoff (ID token + nonce) gives a one-time code (120 s, single use, bound to the nonce).
//   3. The page sends the browser to http://127.0.0.1:<p>/done?code=<c> (or tradezoro://auth?code=<c>).
//   4. Main POSTs {code, verifier} to /api/desktop/handoff/redeem and gets a Firebase custom token, which goes back
//      ONLY to the page that asked; the page runs firebase.auth().signInWithCustomToken(token).
// A code minted for someone else's nonce (login CSRF from a hostile page hitting the loopback port) is refused
// by the server (403), and the app keeps waiting for the real one. Tokens, codes and nonces are never logged.
const crypto = require('crypto');

const ORIGIN = 'https://tradezoro.com';
const LOGIN_PATH = '/desktop-login';
const PROTOCOL = 'tradezoro';
const FLOW_TTL_MS = 5 * 60 * 1000;
const MAX_BAD_CODES = 5;
const CODE_RE = /^[A-Za-z0-9_-]{32,128}$/;

function makeNonce() {
  return crypto.randomBytes(32).toString('base64url');
}

// PKCE-style pair: the verifier stays in main (sent only in the back-channel redeem call); the browser URL carries
// challenge = base64url(sha256(verifier)), so a URL read from browser history cannot redeem a code.
function makePair() {
  const verifier = makeNonce();
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

function loginUrl(nonce, port) {
  const u = new URL(LOGIN_PATH, ORIGIN);
  u.searchParams.set('nonce', nonce);
  if (port) u.searchParams.set('port', String(port));
  return u.href;
}

// The loopback server answers exactly one shape: GET /done?code=<c> with Host 127.0.0.1:<port>
// (the Host check stops DNS-rebinding pages from talking to it under another name). -> code or null.
function codeFromLoopback(method, reqUrl, host, port) {
  if (method !== 'GET') return null;
  if (String(host || '').toLowerCase() !== '127.0.0.1:' + port) return null;
  reqUrl = String(reqUrl || '');
  if (!reqUrl.startsWith('/done?')) return null;   // origin-form only (no //host or absolute URLs)
  let u; try { u = new URL(reqUrl, 'http://127.0.0.1:' + port); } catch (e) { return null; }
  if (u.host !== '127.0.0.1:' + port || u.pathname !== '/done') return null;
  const c = u.searchParams.get('code') || '';
  return CODE_RE.test(c) ? c : null;
}

// tradezoro://auth?code=<c>  (Windows passes it on the command line of a second instance). -> code or null.
function codeFromProtocolUrl(url) {
  let u; try { u = new URL(String(url || '')); } catch (e) { return null; }
  if (u.protocol !== PROTOCOL + ':') return null;
  const where = (u.hostname || u.pathname.replace(/^\/+/, '')).replace(/\/+$/, '');
  if (where !== 'auth') return null;
  const c = u.searchParams.get('code') || '';
  return CODE_RE.test(c) ? c : null;
}

function protocolArg(argv) {
  return (argv || []).find((a) => typeof a === 'string' && a.toLowerCase().startsWith(PROTOCOL + '://')) || null;
}

// Where the loopback server sends the browser after a code arrives: back to the site's own page, which shows
// "You're signed in, you can close this tab". ok=false shows "That didn't work, start again from the app".
function afterUrl(ok) {
  return ORIGIN + LOGIN_PATH + (ok ? '?done=1' : '?failed=1');
}

module.exports = { ORIGIN, LOGIN_PATH, PROTOCOL, FLOW_TTL_MS, MAX_BAD_CODES, CODE_RE, makeNonce, makePair, loginUrl, codeFromLoopback, codeFromProtocolUrl, protocolArg, afterUrl };
