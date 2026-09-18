/* Vault encryption: PBKDF2 (310k, SHA-256) -> AES-256-GCM. Everything is
   standard WebCrypto; the passphrase never leaves the browser. */
(() => {
'use strict';
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptJson(obj, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { v: 1, enc: true, kdf: 'PBKDF2-SHA256-310k', salt: b64(salt), iv: b64(iv), data: b64(data) };
}
async function decryptJson(blob, passphrase) {
  const key = await deriveKey(passphrase, unb64(blob.salt));
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.data));
    return JSON.parse(dec.decode(plain));
  } catch { throw new Error('Wrong vault password'); }
}
window.PanelCrypto = { encryptJson, decryptJson };
})();
