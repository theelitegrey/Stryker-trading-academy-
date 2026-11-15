// Desktop Google sign-in handoff server tests. Run: node tools/tests/desktop-handoff.test.mjs
// Real handler + real JWT signing with throwaway keys; KV and Google (JWKS, OAuth token, accounts:lookup) are stubbed.
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';
import { handle, CODE_TTL_S } from '../../functions/api/desktop/[[path]].js';
import { b64u } from '../../functions/api/passkey/_webauthn.js';
import { createHash } from 'node:crypto';

const ORIGIN = 'https://tradezoro.com';
const kv = new Map();
const KV = { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); }, list: async () => ({ keys: [] }) };
const rsa = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const sak = await rsa(), idk = await rsa();
const LABEL = 'PRIVATE ' + 'KEY';
const pem = '-----BEGIN ' + LABEL + '-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', sak.privateKey)).toString('base64') + '\n-----END ' + LABEL + '-----\n';
const env = { PASSKEYS: KV, FIREBASE_SA_KEY: JSON.stringify({ client_email: 'sa@test.iam.gserviceaccount.com', private_key: pem }) };
const idjwk = { ...(await crypto.subtle.exportKey('jwk', idk.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
let disabled = false, validSince = 0;
const fetchImpl = async (u, init) => {
  u = String(u);
  if (u.includes('securetoken@system')) return new Response(JSON.stringify({ keys: [idjwk] }), { headers: { 'cache-control': 'max-age=3600' } });
  if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'x' }));
  if (u.includes('accounts:lookup')) { const id = JSON.parse(init.body).localId[0]; return new Response(JSON.stringify({ users: [{ localId: id, disabled, validSince: String(validSince) }] })); }
  throw new Error('unexpected fetch ' + u);
};
async function idToken(uid, o = {}) {
  const now = Math.floor(Date.now() / 1000), authTime = now - (o.authAgo || 0), h = b64u(Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })));
  const p = b64u(Buffer.from(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now, exp: now + 3600, auth_time: authTime, firebase: { sign_in_provider: o.provider || 'google.com' } })));
  let s = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', idk.privateKey, Buffer.from(h + '.' + p)));
  if (o.tamper) { s = Buffer.from(s); s[s.length - 1] ^= 1; }
  return h + '.' + p + '.' + b64u(s);
}
const nonce = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
// PKCE pair: the app keeps the verifier, the URL carries challenge = base64url(sha256(verifier)).
const pair = () => { const v = nonce(); return { v, c: createHash('sha256').update(v).digest('base64url') }; };
const post = (path, body, hdr = {}, deps = {}, e = env) => handle(new Request('https://tradezoro.com/api/desktop/' + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...hdr } }), e, { fetchImpl, ...deps });
const mint = async (n, tok, hdr = {}) => post('handoff', { nonce: n }, { origin: ORIGIN, authorization: 'Bearer ' + tok, ...hdr });
const J = (r) => r.json();
const resetRl = () => { for (const k of [...kv.keys()]) if (k.startsWith('rl:')) kv.delete(k); };
const claims = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
let n = 0; const t = (label, fn) => fn().then(() => { n++; console.log('PASS ' + label); });

await t('fails closed without KV / service-account key', async () => {
  assert.equal((await post('handoff', { nonce: nonce() }, { origin: ORIGIN }, {}, { PASSKEYS: KV })).status, 503);
  assert.equal((await post('handoff/redeem', { code: nonce(), verifier: nonce() }, {}, {}, { FIREBASE_SA_KEY: env.FIREBASE_SA_KEY })).status, 503);
});
await t('only POST, only known routes', async () => {
  assert.equal((await handle(new Request('https://tradezoro.com/api/desktop/handoff'), env, { fetchImpl })).status, 405);
  assert.equal((await post('other', {}, { origin: ORIGIN })).status, 404);
});
await t('mint: needs our Origin (CSRF), a valid nonce and a real ID token', async () => {
  const tok = await idToken('u1');
  assert.equal((await mint(nonce(), tok, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('handoff', { nonce: nonce() }, { authorization: 'Bearer ' + tok })).status, 403);   // no Origin
  assert.equal((await mint('short', tok)).status, 400);
  assert.equal((await mint(nonce() + '<x>', tok)).status, 400);
  assert.equal((await mint(nonce(), await idToken('u1', { tamper: true }))).status, 401);
  assert.equal((await mint(nonce(), await idToken('anon', { provider: 'anonymous' }))).status, 401);
  assert.equal((await post('handoff', { nonce: nonce() }, { origin: ORIGIN })).status, 401);
});
await t('mint refuses an ID token from an old sign-in (auth_time > 10 min)', async () => {
  resetRl();
  assert.equal((await mint(nonce(), await idToken('u1', { authAgo: 3600 }))).status, 401);
});
await t('DEV origin only off the real domain', async () => {
  const devEnv = { ...env, DEV: '1' };
  const r = await post('handoff', { nonce: nonce() }, { origin: 'http://127.0.0.1:8045', authorization: 'Bearer ' + await idToken('u1') }, {}, devEnv);
  assert.equal(r.status, 403);   // request URL is tradezoro.com, so DEV is ignored
});
await t('mint + redeem: one-time code becomes a custom token for that uid', async () => {
  resetRl();
  const P = pair(), nn = P.c;
  const r = await mint(nn, await idToken('u-google'));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const { code, expiresIn } = await J(r);
  assert.equal(expiresIn, CODE_TTL_S);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const stored = [...kv.entries()].filter(([k]) => k.startsWith('dh:'));
  assert.equal(stored.length, 1);
  assert.ok(!stored[0][0].includes(code) && !stored[0][1].includes(code) && !stored[0][1].includes(P.v), 'KV holds no code and no verifier');
  assert.equal((await post('handoff/redeem', { code, verifier: nn })).status, 403, 'the URL nonce alone cannot redeem');
  const P2 = pair(), r2 = await J(await mint(P2.c, await idToken('u-google')));
  const rr = await post('handoff/redeem', { code: r2.code, verifier: P2.v });
  assert.equal(rr.status, 200);
  const { token } = await J(rr);
  const c = claims(token);
  assert.equal(c.uid, 'u-google');
  assert.equal(c.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
  assert.ok(c.exp - c.iat <= 3600);
  // custom token signature verifies with the service-account public key
  const [h, p, s] = token.split('.');
  assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', sak.publicKey, Buffer.from(s, 'base64url'), Buffer.from(h + '.' + p)));
  assert.equal([...kv.keys()].filter((k) => k.startsWith('dh:')).length, 0, 'codes deleted');
});
await t('single use: a second redeem of the same code is 410', async () => {
  resetRl();
  const P = pair(), nn = P.c;
  const { code } = await J(await mint(nn, await idToken('u2')));
  assert.equal((await post('handoff/redeem', { code, verifier: P.v })).status, 200);
  assert.equal((await post('handoff/redeem', { code, verifier: P.v })).status, 410);
});
await t('verifier mismatch is 403 and burns the code', async () => {
  resetRl();
  const P = pair(), nn = P.c;
  const { code } = await J(await mint(nn, await idToken('u3')));
  assert.equal((await post('handoff/redeem', { code, verifier: nonce() })).status, 403);
  assert.equal((await post('handoff/redeem', { code, verifier: P.v })).status, 410);   // attacker guessing burns it, owner restarts
});
await t('expiry: a code older than 120 s is 410', async () => {
  resetRl();
  const P = pair(), nn = P.c;
  const { code } = await J(await mint(nn, await idToken('u4')));
  assert.equal((await post('handoff/redeem', { code, verifier: P.v }, {}, { nowMs: Date.now() + (CODE_TTL_S + 5) * 1000 })).status, 410);
});
await t('unknown / malformed code', async () => {
  resetRl();
  assert.equal((await post('handoff/redeem', { code: nonce(), verifier: nonce() })).status, 410);
  assert.equal((await post('handoff/redeem', { code: 'x', verifier: nonce() })).status, 400);
  assert.equal((await post('handoff/redeem', { code: nonce() })).status, 400);
});
await t('redeem from a foreign web page (Origin set) is 403', async () => {
  resetRl();
  const P = pair(), nn = P.c;
  const { code } = await J(await mint(nn, await idToken('u5')));
  assert.equal((await post('handoff/redeem', { code, verifier: P.v }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('handoff/redeem', { code, verifier: P.v })).status, 200);   // foreign try did not burn it
});
await t('disabled account / revoked sessions get no token', async () => {
  resetRl();
  let P = pair(), nn = P.c; let { code } = await J(await mint(nn, await idToken('u6')));
  disabled = true;
  assert.equal((await post('handoff/redeem', { code, verifier: P.v })).status, 403);
  disabled = false;
  P = pair(); nn = P.c; ({ code } = await J(await mint(nn, await idToken('u6'))));
  validSince = Math.floor(Date.now() / 1000) + 10;
  assert.equal((await post('handoff/redeem', { code, verifier: P.v })).status, 401);
  validSince = 0;
});
await t('rate limit: 21st call in a minute from one IP is 429', async () => {
  resetRl();
  let last;
  for (let i = 0; i < 21; i++) last = await post('handoff/redeem', { code: nonce(), verifier: nonce() }, { 'cf-connecting-ip': '9.9.9.9' });
  assert.equal(last.status, 429);
});
console.log('desktop handoff: ' + n + ' groups passed');
