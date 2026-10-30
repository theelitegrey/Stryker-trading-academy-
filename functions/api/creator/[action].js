// Creator Hub API: POST /api/creator/<action>  (Authorization: Bearer <Firebase ID token>, JSON body)
//   join    { cid, planId }                   join an open FREE plan
//   redeem  { cid, code }                     redeem an invite code (rate limited)
//   claim   { cid }                           accept the email grant made for my verified email
//   sync    {}                                accept every pending email grant for my verified email (max 10)
//   import  { cid, planId, emails[], expiresAt? }   owner/admin: add members by email (pending grants, max 500)
// Everything the caller is NOT allowed to do is refused by Firestore itself (rules), because every write
// carries the caller's own token. See _lib.js. Paid checkout is OFF (assets/creator-config.js): no action here
// ever creates a paid membership; paid plans are only reachable by invite, email grant or manual add by the owner.
import { whoIs, rateLimit, getDoc, commit, queryGroup, createDoc, bump, removeDoc, json, ApiError, isEmail, SLUG_RE, CODE_RE, fieldsOf, docName } from './_lib.js';

const memberBody = (uid, planId, source, extra = {}) => ({ uid, planId, role: 'member', source, status: 'active', expiresAt: null, ...extra });
const member = (cid, uid, body) => createDoc(`communities/${cid}/members/${uid}`, { ...body, joinedAt: null, lastActiveAt: null }, ['joinedAt', 'lastActiveAt']);

async function ensureOpen(cid, who, f) {
  const cm = await getDoc(`communities/${cid}`, who.token, f);
  if (!cm) throw new ApiError(404, 'nocommunity', 'Community not found.');
  if (cm.status !== 'active') throw new ApiError(403, 'suspended', 'This community is not available.');
  const me = await getDoc(`communities/${cid}/members/${who.uid}`, who.token, f);
  if (me) throw new ApiError(409, 'already', 'You are already a member.');
  // The ban list is readable by staff only, so for a normal joiner this read is refused (403). That is not an error here:
  // the members create rule (notBanned in firestore.rules) is what really blocks a banned email, and it runs on the write below.
  if (who.email) {
    let banned = null;
    try { banned = await getDoc(`communities/${cid}/bans/${who.email}`, who.token, f); } catch (e) { if (!(e instanceof ApiError) || e.status !== 403) throw e; }
    if (banned) throw new ApiError(403, 'banned', 'You cannot join this community.');
  }
  return cm;
}

export const actions = {
  async join(who, body, f) {
    const { cid, planId } = body;
    if (!SLUG_RE.test(cid || '') || !/^p[1-8]$/.test(planId || '')) throw new ApiError(400, 'bad', 'Bad request.');
    const cm = await ensureOpen(cid, who, f);
    if (cm.visibility === 'private') throw new ApiError(403, 'private', 'This community is invite-only.');
    const plan = await getDoc(`communities/${cid}/plans/${planId}`, who.token, f);
    if (!plan || plan.status !== 'live') throw new ApiError(404, 'noplan', 'That plan is not available.');
    if (plan.price.interval !== 'free') throw new ApiError(402, 'paid', 'Paid checkout opens soon.');
    if ((plan.joinMode || 'open') !== 'open') throw new ApiError(403, 'invite', 'This plan is invite-only.');
    await commit([member(cid, who.uid, memberBody(who.uid, planId, 'free')), bump(`communities/${cid}`, 'memberCount', 1)], who.token, f);
    return { joined: true, planId };
  },

  async redeem(who, body, f, ctx) {
    const { cid, code } = body;
    if (!SLUG_RE.test(cid || '') || !CODE_RE.test(code || '')) throw new ApiError(400, 'bad', 'That code does not look right.');
    if (!rateLimit('rd:u:' + who.uid, 10, 5 * 60000) || !rateLimit('rd:ip:' + (ctx.ip || '?'), 40, 5 * 60000)) throw new ApiError(429, 'slow', 'Too many tries. Wait a few minutes.');
    const cm = await ensureOpen(cid, who, f);
    const inv = await getDoc(`communities/${cid}/invites/${code}`, who.token, f);
    const now = Date.now();
    if (!inv || inv.status !== 'active') throw new ApiError(404, 'badcode', 'That invite is not valid.');
    if (inv.expiresAt && inv.expiresAt.getTime() <= now) throw new ApiError(410, 'expired', 'That invite has expired.');
    if (inv.maxUses > 0 && inv.uses >= inv.maxUses) throw new ApiError(410, 'full', 'That invite has been used up.');
    const exp = inv.grantDays > 0 ? new Date(now + inv.grantDays * 86400000) : null;
    await commit([
      member(cid, who.uid, memberBody(who.uid, inv.planId, 'invite', { inviteCode: code, expiresAt: exp })),
      bump(`communities/${cid}/invites/${code}`, 'uses', 1),
      bump(`communities/${cid}`, 'memberCount', 1)], who.token, f);
    return { joined: true, planId: inv.planId, expiresAt: exp && exp.toISOString(), name: cm.name };
  },

  async claim(who, body, f) {
    const { cid } = body;
    if (!SLUG_RE.test(cid || '')) throw new ApiError(400, 'bad', 'Bad request.');
    if (!who.verified || !who.email) throw new ApiError(403, 'unverified', 'Verify your email first.');
    const cm = await ensureOpen(cid, who, f);
    const g = await getDoc(`communities/${cid}/grants/${who.email}`, who.token, f);
    if (!g) throw new ApiError(404, 'nogrant', 'No pending access for your email.');
    await commit([
      member(cid, who.uid, memberBody(who.uid, g.planId, 'import', { expiresAt: g.expiresAt || null })),
      removeDoc(`communities/${cid}/grants/${who.email}`),
      bump(`communities/${cid}`, 'memberCount', 1)], who.token, f);
    return { joined: true, planId: g.planId, name: cm.name };
  },

  async sync(who, body, f) {
    if (!who.verified || !who.email) return { joined: [] };
    const hits = await queryGroup('grants', 'email', who.email, who.token, 10, f).catch(() => []);
    const joined = [];
    for (const h of hits) {
      const cid = h.path.split('/')[1];
      try { const r = await actions.claim(who, { cid }, f); joined.push({ cid, name: r.name, planId: r.planId }); }
      catch (e) { if (!(e instanceof ApiError)) throw e; }
    }
    return { joined };
  },

  async import(who, body, f) {
    const { cid, planId } = body;
    if (!SLUG_RE.test(cid || '') || !/^p[1-8]$/.test(planId || '')) throw new ApiError(400, 'bad', 'Bad request.');
    if (!rateLimit('im:u:' + who.uid, 20, 10 * 60000)) throw new ApiError(429, 'slow', 'Too many imports. Wait a few minutes.');
    const seen = new Set(), emails = [], bad = [];
    for (const raw of Array.isArray(body.emails) ? body.emails : []) {
      const e = String(raw || '').trim().toLowerCase(); if (!e) continue;
      if (!isEmail(e)) { bad.push(e.slice(0, 80)); continue; }
      if (!seen.has(e)) { seen.add(e); emails.push(e); }
    }
    if (!emails.length) throw new ApiError(400, 'empty', 'No valid email addresses found.');
    if (emails.length > 500) throw new ApiError(400, 'toomany', 'Up to 500 emails at a time.');
    let exp = null;
    if (body.expiresAt) { exp = new Date(body.expiresAt); if (isNaN(exp) || exp.getTime() < Date.now()) throw new ApiError(400, 'baddate', 'The expiry date must be in the future.'); }
    const plan = await getDoc(`communities/${cid}/plans/${planId}`, who.token, f);
    if (!plan) throw new ApiError(404, 'noplan', 'Plan not found.');
    const mk = (e) => ({ update: { name: docName(`communities/${cid}/grants/${e}`), fields: fieldsOf({ email: e, planId, expiresAt: exp, createdBy: who.uid, createdAt: null }) },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] });
    for (let i = 0; i < emails.length; i += 200) await commit(emails.slice(i, i + 200).map(mk), who.token, f);
    return { added: emails.length, skipped: bad };
  },
};

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  const action = new URL(request.url).pathname.split('/').pop();
  const fn = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
  if (!fn) return json({ error: 'unknown' }, 404);
  try {
    const who = await whoIs(request);
    let body = {}; try { body = await request.json(); } catch (e) {}
    if (!body || typeof body !== 'object') body = {};
    const out = await fn(who, body, fetch, { ip: request.headers.get('cf-connecting-ip') || '' });
    return json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, error: e.code, message: e.message }, e.status);
    return json({ ok: false, error: 'server', message: 'Something went wrong. Try again.' }, 500);
  }
}
