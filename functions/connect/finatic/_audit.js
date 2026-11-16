// Order-test audit log: Firestore collection brokerOrderAudit (server-written with the service account; rules: admin read, no client write).
// Holds uid, time, env, account, symbol, side, qty, type, result status and the broker order id. Never tokens or keys.
// Chart live orders (2026-11-15): the audit doc id IS the order's idempotency key, created with ?documentId= (Firestore answers 409 for an id
// that exists), so a repeated key never reaches the broker twice (openAudit throws an Error with .duplicate). Also here: the live-trading kill
// switch settings/liveTrading {enabled:false} (admin-writable through the existing settings rule), read by the server before every live write.
const PROJECT = 'strykertrades-e0cd8';
const enc = new TextEncoder();
const b64u = (b) => { let s = ''; const a = new Uint8Array(b); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

async function accessToken(env, fetchImpl) {
  const sa = JSON.parse(env.FIREBASE_SA_KEY);
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', raw, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))), p = b64u(enc.encode(JSON.stringify({ iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/datastore', iat: now, exp: now + 300 })));
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(h + '.' + p)));
  const r = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + h + '.' + p + '.' + sig });
  if (!r.ok) throw new Error('audit auth');
  return (await r.json()).access_token;
}
const val = (v) => (v === null || v === undefined ? { nullValue: null } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { stringValue: String(v).slice(0, 300) });
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
const DOCS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/';
const base = DOCS + 'brokerOrderAudit';

// -> { id, finish(result) } or throws (caller refuses the order: no audit, no order). docId (optional) = the idempotency key.
export async function openAudit(env, deps, entry, docId) {
  if (deps.audit) return deps.audit(entry, docId);
  const f = deps.auditFetch || fetch;
  const at = await accessToken(env, f);
  const id = docId || crypto.randomUUID().replace(/-/g, '');
  const doc = { ...entry, at: new Date().toISOString(), result: 'attempt' };
  let r = await f(base + '?documentId=' + encodeURIComponent(id), { method: 'POST', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(doc) }) });
  if (r.status === 409) { const e = new Error('duplicate'); e.duplicate = true; throw e; }
  if (!r.ok) throw new Error('audit write');
  return { id, finish: async (res) => { try { const mask = Object.keys(res).map((k) => 'updateMask.fieldPaths=' + k).join('&'); await f(base + '/' + encodeURIComponent(id) + '?' + mask, { method: 'PATCH', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(res) }) }); } catch (e) { /* attempt row already exists */ } } };
}

// Kill switch: settings/liveTrading. -> true (live writes allowed) | false (switched off); throws when it cannot be read (the caller fails CLOSED).
// No doc = never switched off (the FINATIC_LIVE_ORDERS env switch must still be on). Cached 5 s per isolate.
let killMemo = { at: 0, v: null };
export const _resetKill = () => { killMemo = { at: 0, v: null }; };
export async function liveSwitchOn(env, deps) {
  if (deps.liveSwitch) return deps.liveSwitch();
  if (killMemo.v !== null && Date.now() - killMemo.at < 5000) return killMemo.v;
  const f = deps.auditFetch || fetch;
  const at = await accessToken(env, f);
  const r = await f(DOCS + 'settings/liveTrading', { headers: { authorization: 'Bearer ' + at } });
  let v;
  if (r.status === 404) v = true;
  else if (!r.ok) throw new Error('kill switch read');
  else { const j = await r.json(); const e = j && j.fields && j.fields.enabled; v = !(e && e.booleanValue === false); }
  killMemo = { at: Date.now(), v };
  return v;
}
