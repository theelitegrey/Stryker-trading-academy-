// Zscript library: delivery of a published script to a chart.
//   POST /api/zs/get   Authorization: Bearer <Firebase ID token>
//   body { sid, pub? }   pub = the chart Web Worker's one-time P-256 public key (base64 raw point); needed for protected scripts
//   ->   open-source: { ok, sid, name, version, access:'open', source }
//        protected:   { ok, sid, name, version, access:'protected', sealed:{alg,epk,iv,ct} }   opens ONLY inside that worker
//
// ACCESS IS DECIDED BY FIRESTORE, on every load: every read below uses the CALLER'S OWN TOKEN, and the rules
// (functions-src/firestore.rules, "ZSCRIPT SCRIPT LIBRARY") allow src/ (open-source) or bin/ (protected) only while he may run it:
// the author, or anyone for a free live/unlisted script, or a buyer (zsScripts/{sid}/buyers/{uid}, written only by the creatorPay
// Cloud Function after Stripe confirms the payment) for a paid one. A taken-down script stops loading for everyone but the author.
// No service account exists. Protected scripts are never stored as source anywhere a buyer can read: bin/ holds the compiled
// program sealed to this server's key (Pages secret CREATOR_SEAL_KEY, the same key as Creator Hub indicators); this function
// opens it and seals it again to the requesting worker only. The plain source stays in src/, readable by the author and admins.
import { whoIs, getDoc, json, ApiError, rateLimit } from '../creator/_lib.js';
import { open, importServerKey, sealTo, unb64 } from '../../../assets/creator-seal.js';

const SID_RE = /^[A-Za-z0-9]{20}$/;
const PUB_RE = /^[A-Za-z0-9+/]{86,88}={0,2}$/;   // 65-byte uncompressed P-256 point

// Testable core (tests pass f = mock fetch). who = { uid, token, email, verified }.
export async function deliver(who, body, keyText, f = fetch) {
  const { sid, pub } = body || {};
  if (!SID_RE.test(sid || '')) throw new ApiError(400, 'bad', 'Bad request.');
  const meta = await getDoc(`zsScripts/${sid}`, who.token, f).catch((e) => { if (e.status === 403) return null; throw e; });
  if (!meta) throw new ApiError(404, 'gone', 'This script is not available.');
  if (meta.status === 'removed' && meta.authorUid !== who.uid) throw new ApiError(404, 'gone', 'This script was taken down.');
  const v = 'v' + meta.version;
  const base = { sid, name: meta.name, version: meta.version, access: meta.access };
  const denied = () => new ApiError(403, 'noaccess', meta.sale && meta.sale.mode === 'paid'
    ? 'This script is paid. Get it on its library page to add it to your chart.' : 'You cannot run this script.');
  if (meta.access === 'open') {
    let src;
    try { src = await getDoc(`zsScripts/${sid}/src/${v}`, who.token, f); } catch (e) { if (e.status === 403) throw denied(); throw e; }
    if (!src || typeof src.source !== 'string') throw new ApiError(404, 'gone', 'This script is not available.');
    return { ...base, source: src.source };
  }
  if (meta.access !== 'protected') throw new ApiError(500, 'bad', 'Unknown script type.');
  if (!PUB_RE.test(pub || '') || unb64(pub).length !== 65) throw new ApiError(400, 'bad', 'Bad request.');
  if (!keyText) throw new ApiError(503, 'nokey', 'Protected scripts are not switched on yet.');
  let bin;
  try { bin = await getDoc(`zsScripts/${sid}/bin/${v}`, who.token, f); } catch (e) { if (e.status === 403) throw denied(); throw e; }
  if (!bin || !bin.sealed) throw new ApiError(404, 'gone', 'This script is not available.');
  let build;
  try { build = JSON.parse(await open(await importServerKey(keyText), bin.sealed)); }
  catch (e) { throw new ApiError(500, 'seal', 'This script could not be opened. The author should publish it again.'); }
  if (!build || build.kind !== 'zsbin' || !build.program) throw new ApiError(500, 'seal', 'This script could not be opened. The author should publish it again.');
  return { ...base, sealed: await sealTo(pub, JSON.stringify({ v: meta.version, sid, program: build.program })) };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    const who = await whoIs(request);
    if (!rateLimit('zs:u:' + who.uid, 120, 10 * 60000)) throw new ApiError(429, 'slow', 'Too many loads. Wait a few minutes.');
    let body = {}; try { body = await request.json(); } catch (e) {}
    return json({ ok: true, ...(await deliver(who, body, env && env.CREATOR_SEAL_KEY)) });
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, error: e.code, message: e.message }, e.status);
    return json({ ok: false, error: 'server', message: 'Something went wrong. Try again.' }, 500);
  }
}
