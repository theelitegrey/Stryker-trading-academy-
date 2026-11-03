// Passkey server tests. Run: node tools/tests/passkey.test.mjs
// A software authenticator (ES256 and RS256) builds real WebAuthn registrations/assertions; KV and Google are stubbed.
import assert from 'node:assert/strict';
import { createHash, webcrypto as crypto } from 'node:crypto';
import { handle } from '../../functions/api/passkey/[[path]].js';
import { verifyAssertion, verifyRegistration, b64u, unb64u, cborDecode } from '../../functions/api/passkey/_webauthn.js';

const sha = (d) => new Uint8Array(createHash('sha256').update(d).digest());
const cat = (...p) => Buffer.concat(p.map((x) => Buffer.from(x)));
// tiny CBOR encoder
function cb(v) {
  const head = (mt, n) => n < 24 ? [mt << 5 | n] : n < 256 ? [mt << 5 | 24, n] : [mt << 5 | 25, n >> 8, n & 255];
  if (typeof v === 'number') return Buffer.from(v >= 0 ? head(0, v) : head(1, -1 - v));
  if (typeof v === 'string') return cat(head(3, Buffer.byteLength(v)), Buffer.from(v));
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) return cat(head(2, v.length), v);
  if (v instanceof Map) return cat(head(5, v.size), ...[...v].flatMap(([k, x]) => [cb(k), cb(x)]));
  throw new Error('cbor');
}
const ORIGIN = 'https://tradezoro.com';
const cdj = (type, challenge, origin = ORIGIN) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

async function newAuth(alg = -7) {
  const kp = alg === -7
    ? await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    : await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const j = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const cose = alg === -7
    ? new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(j.x, 'base64url')], [-3, Buffer.from(j.y, 'base64url')]])
    : new Map([[1, 3], [3, -257], [-1, Buffer.from(j.n, 'base64url')], [-2, Buffer.from(j.e, 'base64url')]]);
  return { kp, cose, alg, credId: Buffer.from(crypto.getRandomValues(new Uint8Array(32))), count: 0 };
}
const authData = (rpId, flags, count, extra = Buffer.alloc(0)) => cat(sha(rpId), [flags], [count >>> 24, count >>> 16 & 255, count >>> 8 & 255, count & 255], extra);
function regResponse(a, challenge, o = {}) {
  const attested = cat(Buffer.alloc(16), [a.credId.length >> 8, a.credId.length & 255], a.credId, cb(a.cose));
  const ad = authData(o.rpId || 'tradezoro.com', o.flags ?? 0x45, 0, attested);
  const att = cb(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
  return { clientDataJSON: cdj('webauthn.create', challenge, o.origin), attestationObject: att, rawId: a.credId };
}
async function sign(a, data) {
  const s = Buffer.from(await crypto.subtle.sign(a.alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5', a.kp.privateKey, data));
  if (a.alg !== -7) return s;
  const der = (x) => { x = Buffer.from(x); while (x[0] === 0 && x.length > 1) x = x.slice(1); if (x[0] & 128) x = cat([0], x); return cat([2, x.length], x); };
  const body = cat(der(s.slice(0, 32)), der(s.slice(32)));
  return cat([0x30, body.length], body);
}
async function getResponse(a, challenge, o = {}) {
  const ad = authData(o.rpId || 'tradezoro.com', o.flags ?? 0x05, o.count ?? ++a.count);
  const cd = cdj('webauthn.get', challenge, o.origin);
  const sig = await sign(a, cat(ad, sha(cd)));
  if (o.tamper) sig[sig.length - 1] ^= 1;
  return { clientDataJSON: cd, authenticatorData: ad, signature: sig };
}

// ---- unit: verifier ----
const cfg = { rpId: 'tradezoro.com', origins: [ORIGIN], devOriginOk: null };
const once = (c) => { const seen = new Set(); return async (x) => (x === c && !seen.has(x) ? (seen.add(x), true) : false); };
const CH = b64u(crypto.getRandomValues(new Uint8Array(32)));
for (const alg of [-7, -257]) {
  const a = await newAuth(alg);
  const reg = await verifyRegistration(regResponse(a, CH), cfg, once(CH));
  assert.equal(reg.credId, b64u(a.credId));
  const stored = { jwk: reg.jwk, alg: reg.alg, signCount: 0 };
  assert.deepEqual(await verifyAssertion(await getResponse(a, CH), stored, cfg, once(CH)), { signCount: 1 });
  const bad = async (o, re) => assert.rejects(() => verifyAssertion(o.resp, o.stored || stored, cfg, o.cons || once(CH)), re);
  await bad({ resp: await getResponse(a, CH, { tamper: true }) }, /bad signature/);
  await bad({ resp: await getResponse(a, CH, { origin: 'https://evil.example' }) }, /wrong origin/);
  await bad({ resp: await getResponse(a, CH, { rpId: 'evil.example' }) }, /wrong rpId/);
  await bad({ resp: await getResponse(a, CH, { flags: 0x01 }) }, /user verification/);   // UV missing
  await bad({ resp: await getResponse(a, CH, { flags: 0x04 }) }, /user verification/);   // UP missing
  await bad({ resp: await getResponse(a, CH), cons: once('other') }, /challenge/);
  const c = once(CH); await verifyAssertion(await getResponse(a, CH), stored, cfg, c);
  await bad({ resp: await getResponse(a, CH), cons: c }, /challenge/);                      // replayed challenge
  await bad({ resp: await getResponse(a, CH, { count: 5 }), stored: { ...stored, signCount: 9 } }, /signCount/);   // went down
  await bad({ resp: await getResponse(a, CH, { count: 9 }), stored: { ...stored, signCount: 9 } }, /signCount/);   // equal
  await verifyAssertion(await getResponse(a, CH, { count: 0 }), stored, cfg, once(CH));   // 0/0 (iCloud style) is fine
  // registration negatives
  await assert.rejects(() => verifyRegistration(regResponse(a, CH, { flags: 0x41 }), cfg, once(CH)), /user verification/);
  await assert.rejects(() => verifyRegistration(regResponse(a, CH, { rpId: 'x.com' }), cfg, once(CH)), /rpId/);
  await assert.rejects(() => verifyRegistration(regResponse(a, CH, { origin: 'http://tradezoro.com' }), cfg, once(CH)), /origin/);
}
assert.throws(() => cborDecode(Buffer.from([0xa1])), /eof/);

// ---- integration: the route handler ----
const kv = new Map();
const KV = { list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }), get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } };
const sak = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pem = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', sak.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----\n';
const env = { PASSKEYS: KV, FIREBASE_SA_KEY: JSON.stringify({ client_email: 'sa@test.iam.gserviceaccount.com', private_key: pem }) };
// stub Google: JWKS for ID tokens, OAuth token, accounts:lookup
const idk = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const idjwk = { ...(await crypto.subtle.exportKey('jwk', idk.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
let disabled = false, validSince = 0;
const fetchImpl = async (u, init) => {
  u = String(u);
  if (u.includes('securetoken@system')) return new Response(JSON.stringify({ keys: [idjwk] }), { headers: { 'cache-control': 'max-age=3600' } });
  if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'x' }));
  if (u.includes('accounts:lookup')) { const id = JSON.parse(init.body).localId[0]; return new Response(JSON.stringify(id === 'gone' ? {} : { users: [{ localId: id, disabled, validSince: String(validSince) }] })); }
  throw new Error('unexpected fetch ' + u);
};
async function idToken(uid, authAgo = 0) {
  const now = Math.floor(Date.now() / 1000), h = b64u(Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })));
  const p = b64u(Buffer.from(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now, exp: now + 3600, auth_time: now - authAgo })));
  const s = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', idk.privateKey, Buffer.from(h + '.' + p)));
  return h + '.' + p + '.' + b64u(s);
}
const call = (method, path, body, tok, hdr = {}) => handle(new Request('https://tradezoro.com/api/passkey' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { origin: ORIGIN, 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17)', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...hdr } }), env, { fetchImpl });
const J = async (r) => r.json();

assert.equal((await handle(new Request('https://tradezoro.com/api/passkey/login/options', { method: 'POST', headers: { origin: ORIGIN } }), { PASSKEYS: KV }, { fetchImpl })).status, 503);   // no SA key: closed
assert.equal((await call('POST', '/login/options', {}, null, { origin: 'https://evil.example' })).status, 403);
assert.equal((await call('POST', '/register/options', {})).status, 401);
assert.equal((await call('POST', '/register/options', {}, await idToken('u1', 3600))).status, 403);   // stale sign-in

const T = await idToken('u1');
const ro = await J(await call('POST', '/register/options', { email: 'a@b.c' }, T));
assert.equal(ro.publicKey.rp.id, 'tradezoro.com'); assert.equal(ro.publicKey.authenticatorSelection.residentKey, 'required');
assert.deepEqual(ro.publicKey.pubKeyCredParams.map((p) => p.alg), [-7, -257]);
const dev = await newAuth(-7);
const asB = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, b64u(v)]));
const regBody = (a, ch, x = {}) => { const r = regResponse(a, ch, x); return { id: b64u(a.credId), rawId: b64u(a.credId), response: { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject) } }; };
// wrong user cannot use u1's challenge
assert.equal((await call('POST', '/register/verify', regBody(dev, ro.publicKey.challenge), await idToken('u2'))).status, 400);
const T2 = await idToken('u1');
const ro2 = await J(await call('POST', '/register/options', {}, T2));
assert.equal((await call('POST', '/register/verify', regBody(dev, ro2.publicKey.challenge), T2)).status, 200);
assert.equal((await call('POST', '/register/verify', regBody(dev, ro2.publicKey.challenge), T2)).status, 400);   // replay
assert.equal((await handle(new Request('https://tradezoro.com/api/passkey/login/options', { method: 'POST', headers: { origin: 'http://127.0.0.1:8044' } }), { ...env, DEV: '1' }, { fetchImpl })).status, 403);   // DEV never on the real host
const list = await J(await call('GET', '', null, T));
assert.equal(list.passkeys.length, 1); assert.equal(list.passkeys[0].name, 'iPhone');
const ro3 = await J(await call('POST', '/register/options', {}, T));
assert.equal(ro3.publicKey.excludeCredentials.length, 1);

const login = async (a, o = {}) => {
  const lo = await J(await call('POST', '/login/options', {}));
  assert.deepEqual(lo.publicKey.allowCredentials, []);
  const r = await getResponse(a, lo.publicKey.challenge, o);
  const b = { id: b64u(a.credId), rawId: b64u(a.credId), response: { ...asB(r), userHandle: o.handle ?? ro.publicKey.user.id } };
  return { res: await call('POST', '/login/verify', b), b };
};
const ok = await login(dev);
assert.equal(ok.res.status, 200);
const tk = (await J(ok.res)).token, [h, p, s] = tk.split('.');
const cl = JSON.parse(Buffer.from(p, 'base64url'));
assert.equal(cl.uid, 'u1'); assert.equal(cl.iss, 'sa@test.iam.gserviceaccount.com'); assert.equal(cl.sub, cl.iss); assert.equal(cl.exp - cl.iat, 3600);
assert.equal(cl.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', sak.publicKey, Buffer.from(s, 'base64url'), Buffer.from(h + '.' + p)));
assert.equal((await call('POST', '/login/verify', ok.b)).status, 401);   // replay of the same assertion
assert.equal((await login(dev, { handle: b64u(crypto.getRandomValues(new Uint8Array(32))) })).res.status, 401);   // wrong user handle
assert.equal((await login(dev, { handle: '' })).res.status, 401);   // missing user handle
assert.equal((await login(dev, { tamper: true })).res.status, 401);
dev.count = 1; assert.equal((await login(dev, { count: 1 })).res.status, 401);   // counter did not rise -> refused + flagged
assert.equal((await login(dev)).res.status, 401);   // flagged stays blocked
assert.equal((await J(await call('GET', '', null, T))).passkeys[0].flagged, true);

// rename / delete, own only
const id = list.passkeys[0].id;
assert.equal((await call('PATCH', '/' + id, { name: 'Work laptop' }, await idToken('u2'))).status, 404);
assert.equal((await call('DELETE', '/' + id, null, await idToken('u2'))).status, 404);
assert.equal((await call('PATCH', '/' + id, { name: 'Work laptop' }, T)).status, 200);
assert.equal((await J(await call('GET', '', null, T))).passkeys[0].name, 'Work laptop');
assert.equal((await call('DELETE', '/' + id, null, T)).status, 200);
assert.equal((await J(await call('GET', '', null, T))).passkeys.length, 0);
assert.equal((await login(dev, { count: 50 })).res.status, 401);   // removed -> login fails

// disabled / deleted accounts; rate limit
const d2 = await newAuth(-257);
const T3 = await idToken('u3'); const r3 = await J(await call('POST', '/register/options', {}, T3));
assert.equal((await call('POST', '/register/verify', regBody(d2, r3.publicKey.challenge), T3)).status, 200);
const hd = r3.publicKey.user.id;
// a revoke (password reset) after the passkey was added kills it and blocks adding new ones from the old session
validSince = Math.floor(Date.now() / 1000) + 5; assert.equal((await login(d2, { handle: hd })).res.status, 401); validSince = 0;
disabled = true; assert.equal((await login(d2, { handle: hd })).res.status, 403); disabled = false;
assert.equal((await login(d2, { handle: hd })).res.status, 200);
for (const k of [...kv.keys()]) if (k.startsWith('rl:')) kv.delete(k);
let last; for (let i = 0; i < 32; i++) last = await call('POST', '/login/options', {});
assert.equal(last.status, 429);
console.log('passkey tests: ok');
