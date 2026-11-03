// Minimal WebAuthn verifier (Workers / Node 20+, WebCrypto only). ES256 (-7) and RS256 (-257) only.
// Used by: functions/api/passkey/[[path]].js. Tested by tools/tests/passkey.test.mjs.
// Attestation is NOT trusted: we accept fmt "none" or "packed" (self attestation checked, x5c ignored)
// because a passkey is just a key the user owns; what we check is origin, rpId, flags and the challenge.

const enc = new TextEncoder();
export const b64u = (buf) => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export function unb64u(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url');
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function safeEqual(a, b) {   // constant time for equal lengths; length itself is not secret here
  if (!(a instanceof Uint8Array)) a = enc.encode(String(a));
  if (!(b instanceof Uint8Array)) b = enc.encode(String(b));
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
const sha256 = async (d) => new Uint8Array(await crypto.subtle.digest('SHA-256', d));
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

// ---- CBOR (just enough: uint, nint, bytes, text, array, map, simple values; definite lengths) ----
export function cborDecode(buf, start = 0, depth = 0) {
  if (depth > 8) throw new Error('cbor too deep');
  let p = start;
  const rd = () => {
    if (p >= buf.length) throw new Error('cbor eof');
    const ib = buf[p++], mt = ib >> 5, ai = ib & 31;
    let n;
    if (ai < 24) n = ai;
    else if (ai === 24) n = buf[p++];
    else if (ai === 25) { n = (buf[p] << 8) | buf[p + 1]; p += 2; }
    else if (ai === 26) { n = ((buf[p] * 2 ** 24) + (buf[p + 1] << 16) + (buf[p + 2] << 8) + buf[p + 3]); p += 4; }
    else throw new Error('cbor unsupported length');
    if (n === undefined || Number.isNaN(n)) throw new Error('cbor eof');
    return [mt, n];
  };
  const [mt, n] = rd();
  let v;
  if (mt === 0) v = n;
  else if (mt === 1) v = -1 - n;
  else if (mt === 2 || mt === 3) {
    if (p + n > buf.length) throw new Error('cbor eof');
    const s = buf.slice(p, p + n); p += n;
    v = mt === 2 ? s : new TextDecoder('utf-8', { fatal: true }).decode(s);
  } else if (mt === 4) {
    if (n > 64) throw new Error('cbor big');
    v = [];
    for (let i = 0; i < n; i++) { const r = cborDecode(buf, p, depth + 1); v.push(r.value); p = r.end; }
  } else if (mt === 5) {
    if (n > 64) throw new Error('cbor big');
    v = new Map();
    for (let i = 0; i < n; i++) {
      const k = cborDecode(buf, p, depth + 1); p = k.end;
      const x = cborDecode(buf, p, depth + 1); p = x.end;
      v.set(k.value, x.value);
    }
  } else if (mt === 7) {
    if (n === 20) v = false; else if (n === 21) v = true; else if (n === 22) v = null; else throw new Error('cbor simple');
  } else throw new Error('cbor type');
  return { value: v, end: p };
}

// ---- authenticator data ----
export function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('authData short');
  const out = { rpIdHash: ad.slice(0, 32), flags: ad[32], signCount: ((ad[33] * 2 ** 24) + (ad[34] << 16) + (ad[35] << 8) + ad[36]) };
  out.up = !!(out.flags & 1); out.uv = !!(out.flags & 4); out.at = !!(out.flags & 64);
  if (out.at) {
    if (ad.length < 55) throw new Error('authData short');
    const idLen = (ad[53] << 8) | ad[54];
    if (idLen < 1 || idLen > 1023 || ad.length < 55 + idLen) throw new Error('bad credId length');
    out.credId = ad.slice(55, 55 + idLen);
    const k = cborDecode(ad, 55 + idLen);
    out.coseKey = k.value;
  }
  return out;
}

// COSE -> JWK (only the two algorithms we accept). Returns { jwk, alg } or throws.
export function coseToJwk(c) {
  if (!(c instanceof Map)) throw new Error('bad key');
  const kty = c.get(1), alg = c.get(3);
  if (kty === 2 && alg === -7 && c.get(-1) === 1) {
    const x = c.get(-2), y = c.get(-3);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new Error('bad EC key');
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) } };
  }
  if (kty === 3 && alg === -257) {
    const n = c.get(-1), e = c.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array) || n.length < 256 || n.length > 512 || e.length > 4) throw new Error('bad RSA key');
    return { alg: -257, jwk: { kty: 'RSA', n: b64u(n), e: b64u(e) } };
  }
  throw new Error('unsupported key algorithm');
}

function derToRaw(sig, size = 32) {   // ECDSA DER -> r||s
  if (sig[0] !== 0x30) throw new Error('bad sig');
  let p = 2; if (sig[1] & 0x80) p = 2 + (sig[1] & 0x7f);
  const part = () => {
    if (sig[p] !== 0x02) throw new Error('bad sig');
    let l = sig[p + 1], s = sig.slice(p + 2, p + 2 + l); p += 2 + l;
    while (s.length > size && s[0] === 0) s = s.slice(1);
    if (s.length > size) throw new Error('bad sig');
    const o = new Uint8Array(size); o.set(s, size - s.length); return o;
  };
  const r = part(), s = part();
  return concat(r, s);
}

async function verifySig(jwk, alg, sig, data) {
  if (alg === -7) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(sig), data);
  }
  if (alg === -257) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  }
  return false;
}

// Shared checks on clientDataJSON. Returns the challenge (base64url string) so the caller can consume it from storage.
function checkClientData(clientDataJSON, type, { origins, devOriginOk }) {
  let cd;
  try { cd = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clientDataJSON)); } catch (e) { throw new Error('bad clientData'); }
  if (cd.type !== type) throw new Error('wrong type');
  if (cd.crossOrigin === true) throw new Error('cross-origin');
  if (typeof cd.origin !== 'string' || !(origins.includes(cd.origin) || (devOriginOk && devOriginOk(cd.origin)))) throw new Error('wrong origin');
  if (typeof cd.challenge !== 'string' || cd.challenge.length < 16 || cd.challenge.length > 128) throw new Error('bad challenge');
  return cd.challenge;
}

// cfg = { rpId, origins: [..], devOriginOk?: fn }
// Registration: the caller passes consumeChallenge(challenge) -> true once, and we do the rest.
export async function verifyRegistration({ clientDataJSON, attestationObject, rawId }, cfg, consumeChallenge) {
  const challenge = checkClientData(clientDataJSON, 'webauthn.create', cfg);
  if (!(await consumeChallenge(challenge))) throw new Error('unknown or used challenge');
  const att = cborDecode(attestationObject).value;
  if (!(att instanceof Map)) throw new Error('bad attestation');
  const fmt = att.get('fmt'), stmt = att.get('attStmt'), adBytes = att.get('authData');
  if (!(adBytes instanceof Uint8Array)) throw new Error('bad authData');
  const ad = parseAuthData(adBytes);
  if (!safeEqual(ad.rpIdHash, await sha256(enc.encode(cfg.rpId)))) throw new Error('wrong rpId');
  if (!ad.up || !ad.uv) throw new Error('user verification required');
  if (!ad.at || !ad.credId) throw new Error('no credential');
  if (!safeEqual(ad.credId, rawId)) throw new Error('credential id mismatch');
  const { jwk, alg } = coseToJwk(ad.coseKey);
  if (fmt === 'packed') {
    if (!(stmt instanceof Map)) throw new Error('bad statement');
    if (!stmt.has('x5c')) {   // self attestation: signed by the new key itself
      if (stmt.get('alg') !== alg || !(stmt.get('sig') instanceof Uint8Array)) throw new Error('bad self attestation');
      const data = concat(adBytes, await sha256(clientDataJSON));
      if (!(await verifySig(jwk, alg, stmt.get('sig'), data))) throw new Error('bad self attestation');
    }
  } else if (fmt !== 'none') throw new Error('unsupported attestation format');
  return { credId: b64u(ad.credId), jwk, alg, signCount: ad.signCount };
}

// Assertion: stored = { jwk, alg, signCount }. Returns { signCount, cloneSuspected:false } or throws.
export async function verifyAssertion({ clientDataJSON, authenticatorData, signature }, stored, cfg, consumeChallenge) {
  const challenge = checkClientData(clientDataJSON, 'webauthn.get', cfg);
  if (!(await consumeChallenge(challenge))) throw new Error('unknown or used challenge');
  const ad = parseAuthData(authenticatorData);
  if (!safeEqual(ad.rpIdHash, await sha256(enc.encode(cfg.rpId)))) throw new Error('wrong rpId');
  if (!ad.up || !ad.uv) throw new Error('user verification required');
  const data = concat(authenticatorData, await sha256(clientDataJSON));
  let ok = false;
  try { ok = await verifySig(stored.jwk, stored.alg, signature, data); } catch (e) { ok = false; }
  if (!ok) throw new Error('bad signature');
  if ((ad.signCount !== 0 || stored.signCount !== 0) && ad.signCount <= stored.signCount) {
    const e = new Error('signCount did not increase (possible cloned key)'); e.clone = true; throw e;
  }
  return { signCount: ad.signCount };
}
