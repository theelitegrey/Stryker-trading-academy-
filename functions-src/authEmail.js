/**
 * TradeZoro own verify + reset emails (Owner "Yes", 2026-11-04).
 *
 * Firebase's own mails link to strykertrades-e0cd8.firebaseapp.com, which some
 * phone networks block, and Google refuses to let us edit that template URL.
 * So we make the link with the Admin SDK, swap ONLY its host to tradezoro.com
 * (functions/_auth-proxy.js serves /__/auth/* there), and send it via Resend.
 *
 *   sendAuthEmail({ kind: 'verify'|'reset', email?, continuePath? })
 *     verify  signed-in, non-anonymous caller; own email only; skipped if verified
 *     reset   no sign-in; always the same generic answer (no account enumeration)
 *   Returns { ok:true } | { ok:true, fallback:true } | { ok:false, rateLimited:true, message }
 *   fallback:true = Resend failed; the client then uses Firebase's own mail.
 *
 * Secret: RESEND_API_KEY (Secret Manager, bound with runWith({secrets})).
 * Firestore: authEmailLimits/{sha256(scope:id)} {hits:[ms]}; server-only (the
 *   default-deny rule already covers it; no client access).
 * DEPLOY: functions:sendAuthEmail
 */
'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

const SITE = 'https://tradezoro.com';
const FROM = 'TradeZoro <noreply@tradezoro.com>';
const REPLY_TO = 'support@tradezoro.com';
const TEN_MIN = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const LIMITS = { short: 3, day: 10 };
const GENERIC = { ok: true };
const WAIT_MSG = 'Too many requests just now. Please try again in a few minutes.';

// ---- pure helpers (unit tested) ----

// Same rules as pickEmailActionSettings in assets/auth.js.
function continueUrl(kind, path) {
  if (kind === 'reset') return SITE + '/login?reset=1';
  const p = typeof path === 'string' ? path : '';
  const ok = p.charAt(0) === '/' && p.charAt(1) !== '/' && p.indexOf('\\') === -1 &&
    !/[\u0000-\u001f\s]/.test(p) && p.length < 200 &&
    !/^\/(login|signup)(\.html)?([?#].*)?$/.test(p);
  return SITE + (ok ? p : '/dashboard-user');
}

// Swap only the host. Keep /__/auth/action and the whole query.
function rewriteLink(link) {
  const u = new URL(link);
  const out = SITE + u.pathname + u.search;
  if (u.pathname !== '/__/auth/action' || !out.startsWith(SITE + '/__/auth/action?')) {
    throw new Error('unexpected action link shape');
  }
  return out;
}

function maskEmail(e) {
  const s = String(e || '');
  const at = s.indexOf('@');
  if (at < 1) return '***';
  return s[0] + '***@' + s.slice(at + 1, at + 2) + '***';
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const COPY = {
  verify: { subject: 'Confirm your TradeZoro email', head: 'Confirm your email', body: 'Tap the button to confirm your email address and finish setting up your account.', btn: 'Confirm email', ignore: "Didn't create a TradeZoro account? You can ignore this email." },
  reset: { subject: 'Reset your TradeZoro password', head: 'Reset your password', body: 'Tap the button to choose a new password for your account.', btn: 'Reset password', ignore: "Didn't ask for this? You can ignore this email. Your password will not change." }
};

function renderEmail(kind, link) {
  const c = COPY[kind];
  const L = esc(link);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(c.subject)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
 .bg{background:#000000!important}.card{background:#161617!important}
 .ink{color:#f5f5f7!important}.ink2{color:#d2d2d7!important}.ink3{color:#a1a1a6!important}
 .rule{border-color:#2c2c2e!important}.raw{background:#1d1d1f!important;color:#d2d2d7!important}
}
</style></head>
<body class="bg" style="margin:0;padding:0;background:#f5f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:#f5f5f7;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="max-width:520px;background:#ffffff;border-radius:16px;">
<tr><td style="padding:32px 28px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div class="ink" style="font-size:22px;font-weight:700;letter-spacing:.2px;color:#1d1d1f;">Trade<span style="color:#0071e3;">Zoro</span></div>
</td></tr>
<tr><td style="padding:16px 28px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<h1 class="ink" style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#1d1d1f;">${esc(c.head)}</h1>
<p class="ink2" style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#424245;">${esc(c.body)}</p>
</td></tr>
<tr><td align="center" style="padding:0 28px 24px;">
<a href="${L}" style="display:block;background:#0071e3;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:600;line-height:1;text-decoration:none;text-align:center;padding:18px 24px;border-radius:12px;">${esc(c.btn)}</a>
</td></tr>
<tr><td style="padding:0 28px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<p class="ink3" style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#6e6e73;">If the button doesn't work, copy this link into your browser:</p>
<p class="raw" style="margin:0 0 24px;padding:12px;border-radius:8px;background:#f5f5f7;font-size:13px;line-height:1.4;color:#424245;word-break:break-all;">${L}</p>
<p class="ink3" style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#6e6e73;">${esc(c.ignore)}</p>
</td></tr>
<tr><td class="rule" style="padding:16px 28px 28px;border-top:1px solid #e5e5ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div class="ink3" style="font-size:13px;color:#6e6e73;">TradeZoro</div>
</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${c.head}\n\n${c.body}\n\n${link}\n\nIf the link doesn't work, copy it into your browser.\n${c.ignore}\n\nTradeZoro\n`;
  return { subject: c.subject, html, text };
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Counts one attempt; returns true if it is allowed. Firestore transaction on a server-only doc.
async function hit(db, scope, id, now) {
  const ref = db.collection('authEmailLimits').doc(sha(scope + ':' + String(id).toLowerCase()));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const hits = ((snap.exists && snap.data().hits) || []).filter((t) => now - t < DAY);
    const recent = hits.filter((t) => now - t < TEN_MIN).length;
    if (recent >= LIMITS.short || hits.length >= LIMITS.day) return false;
    hits.push(now);
    tx.set(ref, { hits, updatedAt: now });
    return true;
  });
}

async function resendSend(deps, to, mail) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + deps.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: mail.subject, html: mail.html, text: mail.text }),
      signal: ac.signal
    });
    return !!(r && r.status >= 200 && r.status < 300);
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// deps: { auth, db, fetch, key, log, now }
async function handle(data, ctx, deps) {
  const log = deps.log;
  const now = deps.now ? deps.now() : Date.now();
  const kind = data && data.kind;
  if (kind !== 'verify' && kind !== 'reset') return { ok: false, error: 'bad-request' };
  if (!deps.key) { log('resend key missing'); return { ok: true, fallback: true }; }

  let to, actionLink;
  if (kind === 'verify') {
    const a = ctx && ctx.auth;
    if (!a || !a.uid) return { ok: false, error: 'sign-in-required' };
    if (a.token && a.token.firebase && a.token.firebase.sign_in_provider === 'anonymous') return { ok: false, error: 'sign-in-required' };
    let user;
    try { user = await deps.auth.getUser(a.uid); } catch (e) { return { ok: false, error: 'sign-in-required' }; }
    if (!user.email) return { ok: false, error: 'no-email' };
    if (user.emailVerified) return { ok: true, alreadyVerified: true };
    if (!(await hit(deps.db, 'verify-uid', a.uid, now))) {
      log('verify rate limited', a.uid);
      return { ok: false, rateLimited: true, message: WAIT_MSG };
    }
    to = user.email;
    try {
      actionLink = rewriteLink(await deps.auth.generateEmailVerificationLink(to, { url: continueUrl('verify', data.continuePath) }));
    } catch (e) { log('verify link failed', e && e.code); return { ok: true, fallback: true }; }
  } else {
    const email = String((data && data.email) || '').trim();
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email) || email.length > 320) return GENERIC;
    const okEmail = await hit(deps.db, 'reset-email', email, now);
    const okIp = await hit(deps.db, 'reset-ip', deps.ip || 'unknown', now);
    if (!okEmail || !okIp) { log('reset rate limited', maskEmail(email)); return GENERIC; }
    to = email;
    try {
      actionLink = rewriteLink(await deps.auth.generatePasswordResetLink(email, { url: continueUrl('reset') }));
    } catch (e) {
      if (e && e.code === 'auth/user-not-found') { log('reset for unknown account', maskEmail(email)); return GENERIC; }
      log('reset link failed', e && e.code);
      return { ok: true, fallback: true };
    }
  }

  const sent = await resendSend(deps, to, renderEmail(kind, actionLink));
  if (!sent) { log(kind + ' resend failed', maskEmail(to)); return { ok: true, fallback: true }; }
  log(kind + ' sent', maskEmail(to));
  return GENERIC;
}

exports.sendAuthEmail = functions
  .region('us-central1')
  .runWith({ maxInstances: 5, timeoutSeconds: 30, memory: '256MB', secrets: ['RESEND_API_KEY'] })
  .https.onCall(async (data, context) => {
    if (!admin.apps.length) admin.initializeApp();
    const h = (context.rawRequest && context.rawRequest.headers) || {};
    const ip = String(h['x-forwarded-for'] || (context.rawRequest && context.rawRequest.ip) || '').split(',')[0].trim();
    return handle(data, context, {
      auth: admin.auth(), db: admin.firestore(), fetch: (...a) => fetch(...a),
      key: process.env.RESEND_API_KEY, ip,
      log: (msg, extra) => functions.logger.info('sendAuthEmail: ' + msg + (extra ? ' ' + extra : ''))
    });
  });

exports._authEmail = { continueUrl, rewriteLink, maskEmail, renderEmail, handle, hit };
