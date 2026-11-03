// Unit test: partner grant maths (functions-src/partnerAdmin.js) + the shared terms (assets/partner-terms.js).
// Node only, SDKs stubbed. Run: node tools/tests/partner-grant.test.js
const path = require('path'), Module = require('module'), assert = require('assert');
const chain = { region() { return chain; }, runWith() { return chain; }, https: { onCall: (f) => ({ __run: f }), HttpsError: class extends Error {} } };
const adminStub = { apps: [1], initializeApp() {}, firestore: Object.assign(() => ({ collection() {} }), { FieldValue: { serverTimestamp: () => '__ts__', delete: () => '__del__' } }) };
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return (r === 'firebase-functions/v1' || r === 'firebase-admin') ? r : orig.call(this, r, ...a); };
require.cache['firebase-functions/v1'] = { id: 'f', filename: 'f', loaded: true, exports: chain };
require.cache['firebase-admin'] = { id: 'a', filename: 'a', loaded: true, exports: adminStub };
const { grantPatch, GRANT_DAYS, PRO_PLAN_ID } = require('../../functions-src/partnerAdmin.js')._test;
const T = require('../../assets/partner-terms.js');
const DAY = 864e5, NOW = Date.UTC(2026, 10, 3);
let n = 0; const t = (name, f) => { f(); n++; console.log('PASS ' + name); };

t('grant length matches the shared terms', () => assert.strictEqual(GRANT_DAYS, T.PARTNER_TERMS.grantDays));
t('free member: Pro, active, +31 days from now, partner source', () => {
  const g = grantPatch({ plan: 'Starter' }, NOW);
  assert.strictEqual(g.kind, 'grant');
  assert.deepStrictEqual(g.patch, { plan: 'Pro', planId: PRO_PLAN_ID, subscriptionStatus: 'active', paidThroughMillis: NOW + 31 * DAY, partner: true, planSource: 'partner' });
});
t('no student plan at all is treated as free', () => assert.strictEqual(grantPatch({}, NOW).kind, 'grant'));
t('renew on a partner grant that has 10 days left adds 31 days on top (never shortens)', () => {
  const cur = NOW + 10 * DAY;
  const g = grantPatch({ plan: 'Pro', planSource: 'partner', paidThroughMillis: cur }, NOW);
  assert.strictEqual(g.patch.paidThroughMillis, cur + 31 * DAY);
});
t('expired partner grant restarts from now', () => {
  const g = grantPatch({ plan: 'Pro', planSource: 'partner', paidThroughMillis: NOW - 5 * DAY }, NOW);
  assert.strictEqual(g.patch.paidThroughMillis, NOW + 31 * DAY);
});
t('lapsed ex-payer with a future date is not shortened', () => {
  const far = NOW + 400 * DAY;
  const g = grantPatch({ plan: 'Starter', paidThroughMillis: far }, NOW);
  assert.ok(g.patch.paidThroughMillis >= far);
});
t('paying Pro member: billing untouched, only partner:true', () => {
  const s = { plan: 'Pro', planId: 'x', subscriptionStatus: 'active', billingProvider: 'stripe', stripeSubscriptionId: 'sub_1', paidThroughMillis: NOW + 12 * DAY };
  const g = grantPatch(s, NOW);
  assert.strictEqual(g.kind, 'keep'); assert.deepStrictEqual(g.patch, { partner: true });
});
t('paying member with a far-future date: untouched', () => {
  const g = grantPatch({ plan: 'Elite', billingProvider: 'razorpay', paidThroughMillis: NOW + 300 * DAY }, NOW);
  assert.deepStrictEqual(g.patch, { partner: true });
});
t('founding / permanent plan (no end date): untouched', () => {
  assert.deepStrictEqual(grantPatch({ plan: 'Pro', foundingMember: true }, NOW).patch, { partner: true });
  assert.deepStrictEqual(grantPatch({ plan: 'Pro' }, NOW).patch, { partner: true });
});
t('stale billing fields on an old partner grant do not block the renewal (never shortens)', () => {
  const g = grantPatch({ plan: 'Pro', planSource: 'partner', billingProvider: 'stripe', stripeSubscriptionId: 'old', paidThroughMillis: NOW + 5 * DAY }, NOW);
  assert.strictEqual(g.kind, 'grant'); assert.strictEqual(g.patch.paidThroughMillis, NOW + 36 * DAY);
});
t('lapsed ex-payer (date in the past, no partner source) can be granted', () => {
  const g = grantPatch({ plan: 'Pro', billingProvider: 'stripe', paidThroughMillis: NOW - 3 * DAY }, NOW);
  assert.strictEqual(g.kind, 'grant'); assert.strictEqual(g.patch.paidThroughMillis, NOW + 31 * DAY);
});
t('isoWeekKey', () => {
  assert.strictEqual(T.isoWeekKey(Date.UTC(2026, 10, 3)), '2026-W45');
  assert.strictEqual(T.isoWeekKey(Date.UTC(2026, 0, 1)), '2026-W01');
  assert.strictEqual(T.isoWeekKey(Date.UTC(2027, 0, 1)), '2026-W53');
});
t('missedWeeks: counts only full weeks after approval week with < 2 links', () => {
  const approved = Date.UTC(2026, 9, 14);                    // Wed, week 42
  const weeks = { '2026-W43': ['https://a.co/1', 'https://a.co/2'], '2026-W44': ['https://a.co/3'] };
  const m = T.missedWeeks(weeks, approved, NOW, 8);          // now = Tue week 45
  assert.deepStrictEqual(m, ['2026-W44']);
});
t('cleanLink: https only', () => {
  assert.strictEqual(T.cleanLink('http://a.co/x'), ''); assert.strictEqual(T.cleanLink('javascript:alert(1)'), '');
  assert.strictEqual(T.cleanLink(' https://a.co/x '), 'https://a.co/x');
});
console.log(n + ' passed');
