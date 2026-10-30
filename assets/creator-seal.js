// TradeZoro Creator Hub: sealing for PROTECTED community indicators (ES module, WebCrypto only, no DOM).
// Same file runs in three places:
//   - the creator's browser (assets/creator-ind.js): seal(SEAL_PUB, template) at publish time, so the copy that
//     members' requests can reach is ciphertext only the server can open;
//   - the Pages Function (functions/api/creator/ind.js): open(serverKey, stored) and sealTo(clientPub, script)
//     for ONE chart session;
//   - the Pine Web Worker (assets/chart-pine-next-worker.js): session() makes a non-extractable key pair whose
//     private half never leaves the worker, and openSession() decrypts the delivered script there.
// Scheme: ECDH P-256 (fresh ephemeral key per message) -> HKDF-SHA-256 -> AES-256-GCM. Tests: tools/creator/ind-api.test.mjs.
const S = globalThis.crypto.subtle;
const te = new TextEncoder(), td = new TextDecoder();
const INFO = te.encode('tradezoro-seal-v1');

export function b64(u8) {
  u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) { const bin = atob(String(s || '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

const EC = { name: 'ECDH', namedCurve: 'P-256' };
async function aesFrom(priv, pub) {
  const bits = await S.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const hk = await S.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return S.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function sealWith(peerPub, text) {
  const eph = await S.generateKey(EC, true, ['deriveBits']);
  const key = await aesFrom(eph.privateKey, peerPub);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await S.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text));
  return { alg: 'p256-hkdf-a256gcm', epk: b64(await S.exportKey('raw', eph.publicKey)), iv: b64(iv), ct: b64(ct) };
}
async function openWith(priv, msg) {
  if (!msg || msg.alg !== 'p256-hkdf-a256gcm') throw new Error('Unknown sealed format');
  const pub = await S.importKey('raw', unb64(msg.epk), EC, false, []);
  const key = await aesFrom(priv, pub);
  return td.decode(await S.decrypt({ name: 'AES-GCM', iv: unb64(msg.iv) }, key, unb64(msg.ct)));
}

// --- creator browser: seal to the server's public key (JWK {kty, crv, x, y}) ---
export async function seal(serverPubJwk, text) {
  const pub = await S.importKey('jwk', Object.assign({ ext: true }, serverPubJwk), EC, false, []);
  return sealWith(pub, text);
}
// --- server: open with the private JWK (Pages secret CREATOR_SEAL_KEY) ---
export async function importServerKey(jwkText) {
  const j = typeof jwkText === 'string' ? JSON.parse(jwkText) : jwkText;
  return S.importKey('jwk', j, EC, false, ['deriveBits']);
}
export const open = openWith;
// --- server: seal for one chart session (client public key = raw P-256 point, base64) ---
export async function sealTo(clientPubB64, text) {
  const pub = await S.importKey('raw', unb64(clientPubB64), EC, false, []);
  return sealWith(pub, text);
}
// --- worker: a session key pair; the private key is non-extractable and stays in the worker ---
export async function session() {
  const kp = await S.generateKey(EC, false, ['deriveBits']);
  return { privateKey: kp.privateKey, pub: b64(await S.exportKey('raw', kp.publicKey)) };
}
export const openSession = openWith;
