// Minimal Google REST client for the seed script (no dependencies, no secrets in the repo).
// Auth: the refresh token firebase-tools already keeps on this machine. It is exchanged for a short-lived access token in
// memory and never printed or written anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROJECT = 'strykertrades-e0cd8';
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
// firebase-tools' public installed-app OAuth client (the same one the CLI itself uses; not a secret of ours).
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

let _tok = null, _exp = 0;
export async function token() {
  if (_tok && Date.now() < _exp - 60000) return _tok;
  const cfgPath = process.env.FIREBASE_TOOLS_CONFIG || path.join(os.homedir(), '.config/configstore/firebase-tools.json');
  const rt = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).tokens.refresh_token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
  });
  if (!r.ok) throw new Error('token exchange failed: HTTP ' + r.status);
  const j = await r.json();
  _tok = j.access_token; _exp = Date.now() + (j.expires_in || 3000) * 1000;
  return _tok;
}

async function call(url, method = 'GET', body) {
  const t = await token();
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + t, 'x-goog-user-project': PROJECT, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1000 * (i + 1))); continue; }
    const txt = await r.text();
    let j; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt.slice(0, 200) }; }
    if (!r.ok) { const e = new Error(`HTTP ${r.status} ${method} ${url.replace(/\?.*/, '')}: ${JSON.stringify(j).slice(0, 300)}`); e.status = r.status; throw e; }
    return j;
  }
  throw new Error('request failed after retries: ' + url);
}

// ---- Firestore value encoding -------------------------------------------------
export class Ts { constructor(ms) { this.ms = ms; } }           // marks a Firestore timestamp
export const ts = (ms) => new Ts(ms);
export function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Ts) return { timestampValue: new Date(v.ms).toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') { const fields = {}; for (const k of Object.keys(v)) if (v[k] !== undefined) fields[k] = enc(v[k]); return { mapValue: { fields } }; }
  throw new Error('cannot encode ' + typeof v);
}
export function dec(v) {
  const k = Object.keys(v)[0], x = v[k];
  if (k === 'mapValue') { const o = {}; for (const [a, b] of Object.entries(x.fields || {})) o[a] = dec(b); return o; }
  if (k === 'arrayValue') return (x.values || []).map(dec);
  if (k === 'integerValue') return Number(x);
  if (k === 'nullValue') return null;
  if (k === 'timestampValue') return new Ts(Date.parse(x));
  return x;
}
const fieldsOf = (obj) => { const f = {}; for (const k of Object.keys(obj)) if (obj[k] !== undefined) f[k] = enc(obj[k]); return f; };

export async function getDoc(p) {
  try { const j = await call(`${FS}/${p}`); const o = {}; for (const [a, b] of Object.entries(j.fields || {})) o[a] = dec(b); return o; }
  catch (e) { if (e.status === 404) return null; throw e; }
}
/** Full-replace write of many docs: [{path, data}] (data replaces the document). Batches of 200. */
export async function setDocs(list) {
  for (let i = 0; i < list.length; i += 200) {
    const writes = list.slice(i, i + 200).map((d) => ({ update: { name: `${DOCS}/${d.path}`, fields: fieldsOf(d.data) } }));
    await call(`https://firestore.googleapis.com/v1/${DOCS}:commit`, 'POST', { writes });
  }
}
/** Merge write (only the listed top-level fields change). */
export async function mergeDoc(p, data) {
  const mask = Object.keys(data).filter((k) => data[k] !== undefined);
  const qs = mask.map((k) => 'updateMask.fieldPaths=' + encodeURIComponent('`' + k + '`')).join('&');
  await call(`${FS}/${p}?${qs}`, 'PATCH', { fields: fieldsOf(data) });
}
export async function deleteDocs(paths) {
  for (let i = 0; i < paths.length; i += 200) {
    const writes = paths.slice(i, i + 200).map((p) => ({ delete: `${DOCS}/${p}` }));
    await call(`https://firestore.googleapis.com/v1/${DOCS}:commit`, 'POST', { writes });
  }
}
/** names (relative paths) of every document directly in a collection path. */
export async function listPaths(collPath) {
  const out = []; let pt = '';
  do {
    const j = await call(`${FS}/${collPath}?pageSize=300&mask.fieldPaths=__name__${pt ? '&pageToken=' + pt : ''}`);
    for (const d of j.documents || []) out.push(d.name.split('/documents/')[1]);
    pt = j.nextPageToken || '';
  } while (pt);
  return out;
}
export async function listCollectionIds(docPath) {
  const j = await call(`${FS}/${docPath}:listCollectionIds`, 'POST', { pageSize: 100 });
  return j.collectionIds || [];
}
/** collection query: field == value (string). Returns relative doc paths. */
export async function queryEq(collection, field, value) {
  const j = await call(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`, 'POST', {
    structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } }, limit: 500 }
  });
  return j.filter((r) => r.document).map((r) => r.document.name.split('/documents/')[1]);
}

// ---- Identity Toolkit (Auth) admin --------------------------------------------
const IDT = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;
export async function authLookupByEmail(email) {
  const j = await call(`${IDT}/accounts:lookup`, 'POST', { email: [email] });
  return (j.users || [])[0] || null;
}
export async function authCreate({ email, password, displayName }) {
  return call(`${IDT}/accounts`, 'POST', { email, password, displayName, emailVerified: true });
}
export async function authUpdate(localId, patch) { return call(`${IDT}/accounts:update`, 'POST', Object.assign({ localId }, patch)); }
export async function authDelete(localId) { return call(`${IDT}/accounts:delete`, 'POST', { localId }); }
