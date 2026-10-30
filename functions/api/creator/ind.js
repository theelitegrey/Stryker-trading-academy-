// Creator Hub: delivery of community indicators to ZoroCharts.
//   POST /api/creator/ind   Authorization: Bearer <Firebase ID token>
//   body { cid, iid, pub }   pub = the chart Web Worker's one-time P-256 public key (base64 raw point)
//   ->   { ok, version, name, protected, sealed:{alg,epk,iv,ct} }   sealed opens ONLY with the worker's private key
//
// ACCESS IS CHECKED ON EVERY LOAD, by Firestore itself: the vault document is read WITH THE CALLER'S OWN TOKEN, and the
// rules (functions-src/firestore.rules, "indicators" block) allow that read only while he has access right now (active,
// unexpired member on an included plan, or an active, unexpired access grant for his verified email, not banned). A
// member whose plan ended, expired or was banned gets 403 here on his next chart load. No service account exists.
//
// What the vault holds: the build the creator's browser made at publish time (assets/creator-ind.js): comments already
// stripped and, for protected indicators, every own name replaced by a marker (assets/pine-obfuscate.js template()),
// sealed to this server's public key. Only this function holds the private key (Pages secret CREATOR_SEAL_KEY).
// Per buyer, it fills the markers with names derived from HMAC(key, uid + indicator) and adds an invisible watermark
// line (zero-width characters) carrying 8 bytes of HMAC(key, uid), then seals the result to the worker's session key.
// Leak tracing: tools/creator/trace-leak.mjs (needs the same key) matches a leaked copy to a uid.
import { whoIs, getDoc, json, ApiError, rateLimit, SLUG_RE } from './_lib.js';
import { open, importServerKey, sealTo, unb64 } from '../../../assets/creator-seal.js';
import { fill, namer, encodeMark, insertMark } from '../../../assets/pine-obfuscate.js';

const IID_RE = /^[A-Za-z0-9]{12,24}$/;
const PUB_RE = /^[A-Za-z0-9+/]{86,88}={0,2}$/;   // 65-byte uncompressed P-256 point
const te = new TextEncoder();

async function hmacHex(secret, msg) {
  const k = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// The HMAC secret is derived from the private key's d (so one secret to manage).
const macSecret = (jwkText) => 'tz-mark|' + JSON.parse(jwkText).d;
export async function markBytes(jwkText, uid) {
  const hx = (await hmacHex(macSecret(jwkText), 'uid|' + uid)).slice(0, 16);
  return new Uint8Array(hx.match(/../g).map((x) => parseInt(x, 16)));
}

// Testable core (tests pass f = mock fetch). who = { uid, token, email, verified }.
export async function deliver(who, body, keyText, f = fetch) {
  const { cid, iid, pub } = body || {};
  if (!SLUG_RE.test(cid || '') || !IID_RE.test(iid || '') || !PUB_RE.test(pub || '') || unb64(pub).length !== 65) throw new ApiError(400, 'bad', 'Bad request.');
  if (!keyText) throw new ApiError(503, 'nokey', 'Community indicators are not switched on yet.');
  const meta = await getDoc(`communities/${cid}/indicators/${iid}`, who.token, f).catch((e) => { if (e.status === 403) return null; throw e; });
  if (!meta || meta.status !== 'live') throw new ApiError(404, 'noind', 'This indicator is not available.');
  let vault;
  try { vault = await getDoc(`communities/${cid}/indicators/${iid}/vault/v${meta.version}`, who.token, f); }
  catch (e) { if (e.status === 403) throw new ApiError(403, 'noaccess', 'Your access to this indicator has ended. Open the community page to get access.'); throw e; }
  if (!vault || !vault.sealed) throw new ApiError(404, 'noind', 'This indicator is not available.');
  const key = await importServerKey(keyText);
  let build;
  try { build = JSON.parse(await open(key, vault.sealed)); } catch (e) { throw new ApiError(500, 'seal', 'This indicator could not be opened. The creator should publish it again.'); }
  let script;
  if (build.kind === 'tpl') {
    script = fill(build, namer(await hmacHex(macSecret(keyText), 'names|' + who.uid + '|' + cid + '/' + iid)));
  } else if (build.kind === 'plain') script = String(build.source || '');
  else throw new ApiError(500, 'seal', 'Unknown build.');
  const mark = encodeMark(await markBytes(keyText, who.uid));
  const lines = script.split('\n').length;
  // Position varies per buyer too (but never inside an indented block; see insertMark).
  script = insertMark(script, mark, 2 + (parseInt((await hmacHex(macSecret(keyText), 'pos|' + who.uid)).slice(0, 6), 16) % Math.max(1, lines - 2)));
  return { version: meta.version, name: meta.name, protected: meta.protected !== false, sealed: await sealTo(pub, JSON.stringify({ v: meta.version, source: script })) };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    const who = await whoIs(request);
    if (!rateLimit('ind:u:' + who.uid, 120, 10 * 60000)) throw new ApiError(429, 'slow', 'Too many loads. Wait a few minutes.');
    let body = {}; try { body = await request.json(); } catch (e) {}
    return json({ ok: true, ...(await deliver(who, body, env && env.CREATOR_SEAL_KEY)) });
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, error: e.code, message: e.message }, e.status);
    return json({ ok: false, error: 'server', message: 'Something went wrong. Try again.' }, 500);
  }
}
