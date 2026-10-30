// Creator Hub: course files (PDFs, images, attachments) served only to people who may read the lesson.
//   GET /api/creator/file?cid=<slug>&crid=<course>&lid=<lesson>&i=<main|0..7>   Authorization: Bearer <Firebase ID token>
//   (signed-out visitors may only fetch files of FREE PREVIEW lessons; the rules decide that too)
//
// ACCESS IS CHECKED BY FIRESTORE, not here: the lesson's content document is read WITH THE CALLER'S OWN TOKEN, and the rules
// (functions-src/firestore.rules, courses/.../content/body) allow it only if he is the owner, the lesson is a free preview,
// or he is an active member on a plan that includes the lesson / has the course alone, the lesson has been released (drip)
// and, for in-order courses, he has finished the previous lesson. No service account exists.
//
// The content document holds, per file, a download token sealed to the server key (the creator's browser seals it at upload;
// same scheme as community indicators, assets/creator-seal.js). Members can read the sealed blob but not open it. Only this
// function opens it (Pages secret CREATOR_SEAL_KEY), fetches the object from Storage with the token and streams the bytes.
// No public Storage URL is ever shown to a member. Storage rules deny every direct read except the owner's.
import { whoIs, getDoc, json, ApiError, rateLimit, SLUG_RE } from './_lib.js';
import { open, importServerKey } from '../../../assets/creator-seal.js';
import { RT_PROJECT } from '../chart/_rt.js';

const ID_RE = /^[A-Za-z0-9]{12,24}$/;
const BUCKET = RT_PROJECT + '.firebasestorage.app';
const SAFE_CT = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/zip', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

// Testable core. who may be null (signed out, free preview only). f = fetch (tests pass a mock).
export async function fileFor(who, q, keyText, f = fetch) {
  const { cid, crid, lid } = q;
  const i = q.i === 'main' ? 'main' : /^[0-7]$/.test(q.i || '') ? Number(q.i) : null;
  if (!SLUG_RE.test(cid || '') || !ID_RE.test(crid || '') || !ID_RE.test(lid || '') || i === null) throw new ApiError(400, 'bad', 'Bad request.');
  if (!keyText) throw new ApiError(503, 'nokey', 'Course files are not switched on yet.');
  let body;
  try { body = await getDoc(`communities/${cid}/courses/${crid}/lessons/${lid}/content/body`, who ? who.token : null, f); }
  catch (e) { if (e.status === 403) throw new ApiError(403, 'noaccess', 'You do not have access to this lesson yet.'); throw e; }
  if (!body) throw new ApiError(404, 'nofile', 'This file is not available.');
  const file = i === 'main' ? body.file : (body.attachments || [])[i];
  if (!file || !file.sealed || !file.fid) throw new ApiError(404, 'nofile', 'This file is not available.');
  let tok;
  try { tok = await open(await importServerKey(keyText), file.sealed); } catch (e) { throw new ApiError(500, 'seal', 'This file could not be opened. The creator should upload it again.'); }
  if (!/^[A-Za-z0-9-]{20,80}$/.test(tok)) throw new ApiError(500, 'seal', 'This file could not be opened.');
  const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`communities/${cid}/files/${file.fid}`)}?alt=media&token=${tok}`;
  const r = await f(url);
  if (!r.ok) throw new ApiError(404, 'nofile', 'This file is not available.');
  return { file, stream: r.body, ct: SAFE_CT.has(file.ct) ? file.ct : 'application/octet-stream' };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  try {
    let who = null;
    if ((request.headers.get('authorization') || '').trim()) who = await whoIs(request);
    if (!rateLimit('file:' + (who ? who.uid : request.headers.get('cf-connecting-ip') || '?'), 240, 10 * 60000)) throw new ApiError(429, 'slow', 'Too many downloads. Wait a few minutes.');
    const u = new URL(request.url);
    const out = await fileFor(who, Object.fromEntries(u.searchParams), env && env.CREATOR_SEAL_KEY);
    const name = String(out.file.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
    return new Response(out.stream, { status: 200, headers: {
      'content-type': out.ct, 'content-disposition': 'inline; filename="' + name + '"', 'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer' } });
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, error: e.code, message: e.message }, e.status);
    return json({ ok: false, error: 'server', message: 'Something went wrong. Try again.' }, 500);
  }
}
