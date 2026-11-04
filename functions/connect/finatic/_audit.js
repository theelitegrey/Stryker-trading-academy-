// Order-test audit log: Firestore collection brokerOrderAudit (server-written with the service account; rules: admin read, no client write).
// Holds uid, time, env, account, symbol, side, qty, type, result status and the broker order id. Never tokens or keys.
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
const base = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/brokerOrderAudit';

// -> { id, finish(result) } or throws (caller refuses the order: no audit, no order).
export async function openAudit(env, deps, entry) {
  if (deps.audit) return deps.audit(entry);
  const f = deps.auditFetch || fetch;
  const at = await accessToken(env, f);
  const id = crypto.randomUUID().replace(/-/g, '');
  const doc = { ...entry, at: new Date().toISOString(), result: 'attempt' };
  let r = await f(base + '?documentId=' + id, { method: 'POST', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(doc) }) });
  if (!r.ok) throw new Error('audit write');
  return { id, finish: async (res) => { try { const mask = Object.keys(res).map((k) => 'updateMask.fieldPaths=' + k).join('&'); await f(base + '/' + id + '?' + mask, { method: 'PATCH', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(res) }) }); } catch (e) { /* attempt row already exists */ } } };
}
