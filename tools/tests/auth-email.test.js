// Unit tests for functions-src/authEmail.js (mocked Admin SDK, fetch, Firestore). node tools/tests/auth-email.test.js
const assert = require('assert');
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === 'firebase-functions') {
    const chain = { region: () => chain, runWith: () => chain, https: { onCall: (f) => f }, logger: { info() {} } };
    return chain;
  }
  if (req === 'firebase-admin') return { apps: [1], initializeApp() {}, auth() {}, firestore() {} };
  return origLoad.call(this, req, ...a);
};
const { _authEmail: A } = require('../../functions-src/authEmail.js');

function mkDb() {
  const store = {};
  return { store, collection: () => ({ doc: (id) => ({ id }) }),
    runTransaction: async (fn) => fn({ get: async (r) => ({ exists: !!store[r.id], data: () => store[r.id] }), set: (r, d) => { store[r.id] = d; } }) };
}
const RAW = 'https://strykertrades-e0cd8.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=SECRETCODE&apiKey=K&continueUrl=https%3A%2F%2Ftradezoro.com%2Fx&lang=en';
function mk(over = {}) {
  const logs = [], calls = { fetch: [], links: [] };
  const deps = {
    logs, calls, db: mkDb(), key: 'rk', ip: '1.1.1.1', now: () => 1e12,
    log: (...a) => logs.push(a.join(' ')),
    fetch: async (u, o) => { calls.fetch.push({ u, o }); return { status: 200 }; },
    auth: {
      getUser: async () => ({ email: 'alice@example.com', emailVerified: false }),
      generateEmailVerificationLink: async (e, s) => { calls.links.push(s); return RAW; },
      generatePasswordResetLink: async (e, s) => { calls.links.push(s); return RAW.replace('verifyEmail', 'resetPassword'); }
    }, ...over };
  return deps;
}
const user = { auth: { uid: 'u1', token: { firebase: { sign_in_provider: 'password' } } } };
let n = 0; const t = async (name, f) => { await f(); n++; console.log('ok  ' + name); };

(async () => {
  await t('host rewrite keeps path and query', () => {
    const o = A.rewriteLink(RAW);
    assert(o.startsWith('https://tradezoro.com/__/auth/action?'));
    assert.strictEqual(o, RAW.replace('https://strykertrades-e0cd8.firebaseapp.com', 'https://tradezoro.com'));
    assert.throws(() => A.rewriteLink('https://x.com/other?a=1'));
    assert.throws(() => A.rewriteLink('https://x.com/__/auth/action'));
  });
  await t('continue-URL allow-list', () => {
    assert.strictEqual(A.continueUrl('reset', '/x'), 'https://tradezoro.com/login?reset=1');
    assert.strictEqual(A.continueUrl('verify', '/settings'), 'https://tradezoro.com/settings');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil', '/login', '/signup.html', '', null, 5, '/a b', '/a\nb'])
      assert.strictEqual(A.continueUrl('verify', bad), 'https://tradezoro.com/dashboard-user', String(bad));
  });
  await t('verify sends via Resend with own email, no tracking fields, plain text too', async () => {
    const d = mk(); const r = await A.handle({ kind: 'verify', email: 'victim@x.com', continuePath: '/settings' }, user, d);
    assert.deepStrictEqual(r, { ok: true });
    assert.strictEqual(d.calls.fetch[0].u, 'https://api.resend.com/emails');
    const b = JSON.parse(d.calls.fetch[0].o.body);
    assert.deepStrictEqual(b.to, ['alice@example.com']);
    assert.strictEqual(b.from, 'TradeZoro <noreply@tradezoro.com>'); assert.strictEqual(b.reply_to, 'support@tradezoro.com');
    assert(b.html.includes('https://tradezoro.com/__/auth/action?') && b.text.includes('https://tradezoro.com/__/auth/action?'));
    assert(!/firebaseapp/.test(b.html + b.text)); assert(!/<img/i.test(b.html));
    assert.strictEqual(d.calls.links[0].url, 'https://tradezoro.com/settings');
  });
  await t('verify: anonymous / signed-out refused; already verified skipped', async () => {
    assert.strictEqual((await A.handle({ kind: 'verify' }, {}, mk())).ok, false);
    const anon = { auth: { uid: 'a', token: { firebase: { sign_in_provider: 'anonymous' } } } };
    const d = mk(); assert.strictEqual((await A.handle({ kind: 'verify' }, anon, d)).ok, false); assert.strictEqual(d.calls.fetch.length, 0);
    const v = mk({ auth: { getUser: async () => ({ email: 'a@b.co', emailVerified: true }) } });
    const r = await A.handle({ kind: 'verify' }, user, v); assert(r.alreadyVerified); assert.strictEqual(v.calls.fetch.length, 0);
  });
  await t('reset: same answer for existing and unknown account', async () => {
    const d1 = mk(); const r1 = await A.handle({ kind: 'reset', email: 'alice@example.com' }, {}, d1);
    const d2 = mk(); d2.auth.generatePasswordResetLink = async () => { const e = new Error('x'); e.code = 'auth/user-not-found'; throw e; };
    const r2 = await A.handle({ kind: 'reset', email: 'nobody@example.com' }, {}, d2);
    assert.deepStrictEqual(r1, r2); assert.strictEqual(d2.calls.fetch.length, 0);
    assert.deepStrictEqual(await A.handle({ kind: 'reset', email: 'garbage' }, {}, mk()), r1);
  });
  await t('rate limit verify: 3 per 10 min, then friendly refusal; 10 a day', async () => {
    const d = mk(); const out = [];
    for (let i = 0; i < 4; i++) out.push(await A.handle({ kind: 'verify' }, user, d));
    assert(out[2].ok && !out[2].rateLimited); assert(out[3].rateLimited && /try again/i.test(out[3].message));
    let tt = 1e12; const d2 = mk({ now: () => tt }); let sent = 0;
    for (let i = 0; i < 14; i++) { tt += 11 * 60 * 1000; const r = await A.handle({ kind: 'verify' }, user, d2); if (!r.rateLimited) sent++; }
    assert.strictEqual(sent, 10);
  });
  await t('rate limit reset: per email and per IP, still generic success', async () => {
    const d = mk();
    for (let i = 0; i < 5; i++) assert.deepStrictEqual(await A.handle({ kind: 'reset', email: 'a@b.co' }, {}, d), { ok: true });
    assert.strictEqual(d.calls.fetch.length, 3);
    const d2 = mk(); let k = 0;
    for (let i = 0; i < 5; i++) { assert.deepStrictEqual(await A.handle({ kind: 'reset', email: 'u' + (k++) + '@b.co' }, {}, d2), { ok: true }); }
    assert.strictEqual(d2.calls.fetch.length, 3);
    assert(d2.logs.some((l) => /rate limited/.test(l)));
  });
  await t('fallback: Resend non-2xx, throw, missing key, link failure', async () => {
    for (const kind of ['verify', 'reset']) {
      const ctx = kind === 'verify' ? user : {}; const data = { kind, email: 'a@b.co' };
      assert.deepStrictEqual(await A.handle(data, ctx, mk({ fetch: async () => ({ status: 500 }) })), { ok: true, fallback: true });
      assert.deepStrictEqual(await A.handle(data, ctx, mk({ fetch: async () => { throw new Error('timeout'); } })), { ok: true, fallback: true });
      assert.deepStrictEqual(await A.handle(data, ctx, mk({ key: '' })), { ok: true, fallback: true });
    }
  });
  await t('logs never hold full email, link or code', async () => {
    const d = mk(); await A.handle({ kind: 'verify' }, user, d);
    await A.handle({ kind: 'reset', email: 'bob@example.com' }, {}, d);
    const d3 = mk({ fetch: async () => ({ status: 500 }) }); await A.handle({ kind: 'reset', email: 'carol@example.com' }, {}, d3);
    const all = d.logs.concat(d3.logs).join('\n');
    assert(all.length > 0); assert(!/alice@|bob@|carol@|example\.com|SECRETCODE|oobCode|tradezoro\.com\/__/.test(all), all);
  });
  await t('email html escapes link, has button, raw link, ignore line, footer', () => {
    const m = A.renderEmail('reset', 'https://tradezoro.com/__/auth/action?a=1&b="<x>');
    assert(m.html.includes('a=1&amp;b=&quot;&lt;x&gt;')); assert(/prefers-color-scheme:dark/.test(m.html));
    assert(/copy this link/.test(m.html) && /ignore this email/.test(m.html) && m.text.includes('TradeZoro'));
  });
  console.log(n + ' passed');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
