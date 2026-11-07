// Unit tests for the push fix (Owner bug 2026-11-07: alerts reach the bell but don't pop up on the phone).
//   node tools/tests/push-rules-test.js
// 1. functions-src/pushRules.js: prune only dead-token codes (NOT invalid-argument), pushResult summary,
//    data-only message with Urgency high, test rate limit 3/hour.
// 2. functions-src/accountAdmin.js onNotificationCreated wired to pushRules + pushResult + the test guard.
// 3. assets/push.js token sync in a fake browser: first open upserts, same token skips, rotation saves the new
//    token and deletes the old one, a pruned doc is re-saved, permission 'default' never prompts or writes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const R = require(path.join(ROOT, 'functions-src', 'pushRules.js'));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };

// ---- 1. rules
ok(R.isDeadToken('messaging/registration-token-not-registered'), 'not-registered prunes');
ok(R.isDeadToken('messaging/invalid-registration-token'), 'invalid-registration-token prunes');
ok(!R.isDeadToken('messaging/invalid-argument'), 'invalid-argument does NOT prune (our payload error)');
ok(!R.isDeadToken('messaging/internal-error') && !R.isDeadToken('messaging/quota-exceeded') && !R.isDeadToken('unknown'), 'transient codes kept');
const toks = ['tokAAAAAA111111', 'tokBBBBBB222222', 'tokCCCCCC333333', 'tokDDDDDD444444'];
const err = (code) => ({ status: 'rejected', reason: { errorInfo: { code } } });
const s = R.summarize(toks, [{ status: 'fulfilled' }, err('messaging/registration-token-not-registered'), err('messaging/invalid-argument'), err('messaging/invalid-registration-token')]);
ok(s.sent === 1 && s.tokens === 4 && s.status === 'sent', 'summary counts sent / tokens');
ok(s.pruned.length === 2 && s.pruned.includes(toks[1]) && s.pruned.includes(toks[3]) && !s.pruned.includes(toks[2]), 'only dead tokens pruned');
ok(s.failed.join() === 'messaging/invalid-argument', 'invalid-argument logged as failed, kept');
ok(s.log[0] === '111111:ok' && !s.log.join(' ').includes('tokAAAAAA'), 'log carries token tails only');
ok(R.summarize(toks.slice(0, 1), [err('messaging/internal-error')]).status === 'failed', 'all failed -> failed');
ok(R.summarize([], []).status === 'no-device', 'no tokens -> no-device');
const m = R.buildMessage({ message: 'NQ crossed 21,000', link: 'charts.html?symbol=CME:NQ1!', type: 'chart_alert' }, 'nid1');
ok(!m.notification && m.data.title && m.data.body === 'NQ crossed 21,000' && m.data.link === '/charts.html?symbol=CME:NQ1!', 'data-only message, link kept');
ok(m.data.nid === 'nid1' && m.data.type === 'chart_alert' && Object.values(m.data).every((v) => typeof v === 'string'), 'all data values are strings (FCM rejects others)');
ok(m.webpush.headers.Urgency === 'high' && Number(m.webpush.headers.TTL) > 0, 'webpush Urgency high + TTL');
ok(!m.android && !m.apns, 'no native android/apns block (does not apply to web push)');
ok(R.buildMessage({ message: 'x'.repeat(600) }, 'a').data.body.length === 240, 'body capped');
let st = null; const t0 = 1e12; const res = [];
for (let i = 0; i < 4; i++) { const r = R.testAllowed(st, t0 + i * 1000); res.push(r.ok); st = r.state; }
ok(res.join() === 'true,true,true,false', 'test: 3 per hour, 4th refused');
ok(R.testAllowed(st, t0 + 3600001).ok, 'test: allowed again after an hour');

// ---- 2. wiring in accountAdmin.js
const aa = fs.readFileSync(path.join(ROOT, 'functions-src', 'accountAdmin.js'), 'utf8');
const fn = aa.slice(aa.indexOf('exports.onNotificationCreated'));
ok(/require\('\.\/pushRules'\)/.test(aa) && /pushRules\.summarize/.test(fn) && /pushRules\.buildMessage/.test(fn), 'onNotificationCreated uses pushRules');
ok(!/code === 'messaging\/invalid-argument'/.test(fn), 'no invalid-argument prune left in the function');
ok(/pushResult/.test(fn) && /'no-device'/.test(fn), 'pushResult written, incl. no-device');
ok(/n\.senderUid !== n\.recipientUid/.test(fn) && /testAllowed/.test(fn), 'test notification: self only + rate limit');

// ---- 3. assets/push.js in a fake browser
function browser({ perm = 'granted', token = 'T1' } = {}) {
  const store = new Map(); const writes = []; const ls = new Map(); let prompts = 0;
  const env = { cur: token };
  const doc = (id) => ({ id,
    set: async (d) => { writes.push(['set', id]); store.set(id, d); },
    delete: async () => { writes.push(['delete', id]); store.delete(id); },
    get: async () => ({ exists: store.has(id), data: () => store.get(id) }) });
  const win = {
    console: { warn() {}, error() {}, log() {} }, setTimeout, Promise, JSON, Date,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    Notification: { permission: perm, requestPermission: async () => { prompts++; return perm; } },
    PushManager: function () {},
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/150 Mobile', platform: 'Linux', maxTouchPoints: 5,
      serviceWorker: { register: async () => ({}), ready: Promise.resolve({}), addEventListener() {}, getRegistration: async () => null } },
    document: { addEventListener() {}, visibilityState: 'visible', getElementById: () => null, head: { appendChild() {} } },
    location: { pathname: '/charts.html', search: '' },
    matchMedia: () => ({ matches: true }),
    auth: { currentUser: { uid: 'u1' }, onAuthStateChanged() {} },
    db: { collection: (c) => ({ doc: (id) => (c === 'settings' ? { get: async () => ({ exists: true, data: () => ({ vapidKey: 'V' }) }) } : doc(id)) }) },
    firebase: { messaging: Object.assign(() => ({ getToken: async () => env.cur, onMessage() {}, deleteToken: async () => true }), {}),
                firestore: { FieldValue: { serverTimestamp: () => 'TS' } } }
  };
  win.window = win; win.self = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'push.js'), 'utf8'), win);
  return { win, store, writes, ls, env, prompts: () => prompts };
}
(async () => {
  let b = browser();
  ok(await b.win.syncToken(false) === 'T1' && b.store.has('T1') && b.store.get('T1').uid === 'u1', 'first open: token upserted');
  ok(Object.keys(b.store.get('T1')).sort().join() === 'createdAt,token,uid,userAgent', 'doc keeps the shape the live rules allow');
  const w0 = b.writes.length;
  await b.win.syncToken(false);
  ok(b.writes.length === w0, 'same token saved today: no write');
  b.store.delete('T1');
  await b.win.syncToken(false);
  ok(b.store.has('T1'), 'doc pruned server-side: re-saved on next open');
  b.env.cur = 'T2';
  await b.win.syncToken(false);
  ok(b.store.has('T2') && !b.store.has('T1'), 'rotation: new token saved, old token doc deleted');
  ok(await b.win.pushStatus() === 'on', 'status on');
  const p = b.win.syncToken(false), q = b.win.syncToken(false);
  ok(p === q, 'parallel syncs share one getToken');
  await p;
  b = browser({ perm: 'default' });
  ok(await b.win.syncToken(true) === null && b.writes.length === 0 && b.prompts() === 0, 'permission default: silent sync never prompts or writes');
  ok(await b.win.pushStatus() === 'off', 'status off when permission default');
  b = browser({ perm: 'denied' });
  ok(await b.win.pushStatus() === 'denied' && /Android/.test(b.win.pushUnblockHelp()), 'status denied + Android unblock help');
  b = browser();
  b.win.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari'; b.win.matchMedia = () => ({ matches: false });
  ok(await b.win.pushStatus() === 'ios-install', 'iPhone outside the Home Screen app: ios-install');
  b = browser();
  await b.win.syncToken(false);
  await b.win.disablePush();
  ok(!b.store.has('T1') && !b.ls.has('stryker_push_tok_u1'), 'turn off: doc and local record removed');
  console.log('\n' + n + ' passed');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
