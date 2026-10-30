// Creator Hub server helpers (Pages Functions, functions/api/creator/*).
// Used by: [action].js. Tested by tools/creator/api-test.mjs.
//
// There is NO service account behind these functions. Each call verifies the caller's Firebase ID token
// (same JWT check as the chart gate, functions/api/chart/_rt.js) and then talks to Firestore over REST WITH THAT
// SAME TOKEN, so the Firestore rules (functions-src/firestore.rules, "CREATOR HUB" block) stay the real boundary:
// a bug here cannot grant anything the rules would refuse. What this layer adds is what rules cannot do:
// friendly errors, atomic multi-document commits in one round trip, bulk email import, and rate limits.
import { verifyIdToken, bearerOf, RT_PROJECT } from '../chart/_rt.js';

export { RT_PROJECT, bearerOf };
export const DB = 'https://firestore.googleapis.com/v1/projects/' + RT_PROJECT + '/databases/(default)/documents';
const DOCS = 'projects/' + RT_PROJECT + '/databases/(default)/documents';

// ---- Firestore REST value codec -------------------------------------------------------------------------
export function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}
export function dec(f) {
  if (!f) return undefined;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('nullValue' in f) return null;
  if ('timestampValue' in f) return new Date(f.timestampValue);
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(dec);
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return undefined;
}
export const decDoc = (d) => (d && d.fields ? Object.fromEntries(Object.entries(d.fields).map(([k, x]) => [k, dec(x)])) : {});
export const fieldsOf = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));
export const docName = (path) => DOCS + '/' + path;

// ---- responses ---------------------------------------------------------------------------------------------
export const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export class ApiError extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; } }

// ---- token -------------------------------------------------------------------------------------------------
function b64uJson(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}
// -> { uid, email (lower-case or ''), verified } or throws 401. opts.fetchImpl / opts.nowSec are for tests.
export async function whoIs(request, opts = {}) {
  const token = bearerOf(request);
  const uid = token ? await verifyIdToken(token, opts) : null;
  if (!uid) throw new ApiError(401, 'signin', 'Sign in first.');
  const p = b64uJson(token.split('.')[1]);
  return { token, uid, email: String(p.email || '').toLowerCase(), verified: p.email_verified === true };
}

// ---- tiny in-isolate rate limiter (best effort: one bucket per isolate; the rules + maxUses are the hard limits) ----
const buckets = new Map();
export function rateLimit(key, max, windowMs, now = Date.now()) {
  const b = buckets.get(key);
  if (!b || now - b.at > windowMs) { buckets.set(key, { at: now, n: 1 }); if (buckets.size > 5000) buckets.clear(); return true; }
  b.n++; return b.n <= max;
}
export const _resetLimits = () => buckets.clear();

// ---- Firestore calls (always with the caller's token) -----------------------------------------------------
export async function getDoc(path, token, f = fetch) {
  const r = await f(DB + '/' + path, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  if (r.status === 404) return null;
  if (!r.ok) throw new ApiError(r.status === 403 ? 403 : 502, 'read', 'Could not read ' + path.split('/')[0] + '.');
  return decDoc(await r.json());
}
export async function commit(writes, token, f = fetch) {
  const r = await f(DB + ':commit', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ writes }) });
  if (r.ok) return true;
  let msg = ''; try { msg = (await r.json()).error.message || ''; } catch (e) {}
  if (r.status === 403) throw new ApiError(403, 'denied', 'Not allowed.');
  if (r.status === 409 || /ALREADY_EXISTS|already exists/i.test(msg)) throw new ApiError(409, 'exists', 'Already done.');
  throw new ApiError(502, 'write', 'Could not save. Try again.');
}
export async function queryGroup(collectionId, field, value, token, limit, f = fetch) {
  const r = await f(DB.replace(/\/documents$/, '/documents') + ':runQuery', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: true }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: enc(value) } }, limit } }) });
  if (!r.ok) throw new ApiError(r.status === 403 ? 403 : 502, 'query', 'Could not look that up.');
  return (await r.json()).filter((x) => x.document).map((x) => ({ path: x.document.name.split('/documents/')[1], data: decDoc(x.document) }));
}

// write builders ---------------------------------------------------------------------------------------------
export const createDoc = (path, obj, serverTimes = []) => ({
  update: { name: docName(path), fields: fieldsOf(obj) }, currentDocument: { exists: false },
  updateTransforms: serverTimes.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) });
export const bump = (path, field, by) => ({
  update: { name: docName(path) }, updateMask: { fieldPaths: [] }, currentDocument: { exists: true },
  updateTransforms: [{ fieldPath: field, increment: { integerValue: String(by) } }] });
export const removeDoc = (path) => ({ delete: docName(path) });

export const isEmail = (s) => typeof s === 'string' && s.length <= 200 && /^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]{2,}$/.test(s);
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;
export const CODE_RE = /^[A-Za-z0-9]{10,24}$/;
