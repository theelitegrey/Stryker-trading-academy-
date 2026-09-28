// Unit test for functions-src/adminStats.js: no network, no emulator.
//
// firebase-admin / firebase-functions are not installed in this checkout
// (functions-src/node_modules is empty on the server), and the Firestore
// emulator needs Java, which this host doesn't have. So both modules are
// stubbed at require() time, and a small in-memory Firestore fake implements
// exactly the calls adminStats.js makes: collection/doc/get/where/select/
// count().get()/batch. Run: node tools/tests/admin-analytics/stats-unit.js

const Module = require('module');
const path = require('path');
const assert = require('assert');

// ---- fake Firestore ------------------------------------------------------
class Timestamp {
  constructor(ms) { this.ms = ms; }
  static fromDate(d) { return new Timestamp(d.getTime()); }
  toMillis() { return this.ms; }
}
const SERVER_TS = { __serverTimestamp: true };

function makeDb(data) {
  const store = JSON.parse(JSON.stringify(data, (k, v) => v));
  // Re-hydrate timestamps (JSON loses the class).
  const hydrate = (o) => {
    if (o && typeof o === 'object') {
      if (typeof o.ms === 'number' && Object.keys(o).length === 1) return new Timestamp(o.ms);
      Object.keys(o).forEach((k) => { o[k] = hydrate(o[k]); });
    }
    return o;
  };
  Object.keys(store).forEach((c) => Object.keys(store[c]).forEach((id) => { store[c][id] = hydrate(store[c][id]); }));
  const calls = [];
  const cmp = (a, op, b) => {
    const av = a instanceof Timestamp ? a.ms : a;
    const bv = b instanceof Timestamp ? b.ms : b;
    if (av === undefined || av === null) return false;   // Firestore skips missing fields
    if (op === '>=') return av >= bv;
    if (op === '>') return av > bv;
    if (op === '==') return av === bv;
    throw new Error('op ' + op);
  };
  function query(col, filters, fields) {
    const rows = () => Object.keys(store[col] || {})
      .map((id) => ({ id, d: store[col][id] }))
      .filter((r) => filters.every(([f, op, v]) => cmp(r.d[f], op, v)));
    const snapOf = (rs) => ({
      docs: rs.map((r) => ({ id: r.id, data: () => {
        if (!fields) return r.d;
        const o = {}; fields.forEach((f) => { if (f in r.d) o[f] = r.d[f]; }); return o;
      } })),
      size: rs.length
    });
    return {
      where: (f, op, v) => query(col, filters.concat([[f, op, v]]), fields),
      select: (...fs) => query(col, filters, fs),
      count: () => ({ get: () => { calls.push({ col, kind: 'count', filters: filters.length }); return Promise.resolve({ data: () => ({ count: rows().length }) }); } }),
      get: () => { calls.push({ col, kind: fields ? 'select:' + fields.join(',') : 'get', filters: filters.length }); return Promise.resolve(snapOf(rows())); },
      doc: (id) => ({
        id,
        get: () => { calls.push({ col, kind: 'doc', id }); const d = (store[col] || {})[id]; return Promise.resolve({ exists: !!d, data: () => d }); }
      })
    };
  }
  const db = {
    collection: (c) => query(c, [], null),
    batch: () => {
      const ops = [];
      return {
        set: (ref, doc) => ops.push([ref, doc]),
        commit: () => {
          ops.forEach(([ref, doc]) => {
            const col = ref.__col;
            store[col] = store[col] || {};
            const copy = Object.assign({}, doc);
            Object.keys(copy).forEach((k) => { if (copy[k] === SERVER_TS) copy[k] = new Timestamp(Date.now()); });
            store[col][ref.id] = copy;
          });
          return Promise.resolve();
        }
      };
    },
    _store: store,
    _calls: calls
  };
  // doc refs need to know their collection for the batch
  const origCollection = db.collection;
  db.collection = (c) => {
    const q = origCollection(c);
    const origDoc = q.doc;
    q.doc = (id) => Object.assign(origDoc(id), { __col: c });
    return q;
  };
  return db;
}

// ---- stub firebase-admin / firebase-functions ---------------------------
let currentDb = null;
const registered = {};
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fnBuilder = () => {
  const b = {
    region: () => b, runWith: () => b,
    pubsub: { schedule: (s) => ({ timeZone: () => ({ onRun: (h) => { registered.schedule = { s, h }; return h; } }) }) },
    https: { onCall: (h) => { registered.call = h; return h; }, HttpsError }
  };
  return b;
};
const adminStub = {
  apps: [1],
  initializeApp: () => {},
  firestore: Object.assign(() => currentDb, { Timestamp, FieldValue: { serverTimestamp: () => SERVER_TS } })
};
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'firebase-admin') return adminStub;
  if (req === 'firebase-functions/v1') return Object.assign(fnBuilder(), { https: fnBuilder().https });
  return origLoad.apply(this, arguments);
};
const mod = require(path.join(__dirname, '../../../functions-src/adminStats.js'));
Module._load = origLoad;
const T = mod._test;

// ---- fixtures -----------------------------------------------------------
const NOW = Date.now();
const day = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const ts = (n) => ({ ms: NOW - n * 86400000 });
const fixture = {
  plans: {
    starter: { name: 'Starter', price: 'Free' },
    pro: { name: 'Pro', price: '$19/mo' },
    elite: { name: 'Elite', price: '$49' }
  },
  chapters: { c1: { num: '1', title: 'One' }, c2: { num: '2', title: 'Two' }, c3: { num: '3', title: 'Three' }, c4: { num: '4', title: 'Four' } },
  students: {
    a: { plan: 'Starter', createdAt: ts(0),  lastActiveDate: day(0),  completedChapters: ['1', '2'], email: 'a@x', displayName: 'Student A' },
    b: { plan: 'Pro',     createdAt: ts(3),  lastActiveDate: day(2),  completedChapters: ['1'] },
    c: { plan: 'pro',     createdAt: ts(10), lastActiveDate: day(10), completedChapters: [] },
    d: { plan: 'Elite',   createdAt: ts(40), lastActiveDate: day(40), completedChapters: ['1', '2', '3', '4', '99'] },
    e: {                  createdAt: ts(60) },                               // no plan, never active
    f: { plan: 'Legacy',  createdAt: ts(100), lastActiveDate: day(1) }      // unknown plan = free
  },
  liveSessions: { s1: { startsAt: { ms: NOW + 3600e3 } }, s2: { startsAt: { ms: NOW - 3600e3 } } },
  admins: { adm: { at: 1 } }
};

let pass = 0, fail = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { pass++; console.log('PASS', name); },
    (e) => { fail++; console.log('FAIL', name, '-', e.message); });
}

(async () => {
  // pure helpers
  await check('planPriceMap parses display prices', () => {
    assert.deepStrictEqual(T.planPriceMap([{ name: 'Starter', price: 'Free' }, { name: 'Pro', price: '$19/mo' }]), { starter: 0, pro: 19 });
  });
  await check('windowStartStr: 1 day = today, 7 days = today-6', () => {
    const now = new Date('2026-09-28T23:59:00Z');
    assert.strictEqual(T.windowStartStr(now, 1), '2026-09-28');
    assert.strictEqual(T.windowStartStr(now, 7), '2026-09-22');
    assert.strictEqual(T.windowStartStr(now, 30), '2026-08-30');
  });
  await check('summarise with no students: avgCompletion null (not 0)', () => {
    const s = T.summarise([], [], []);
    assert.strictEqual(s.avgCompletion, null);
    assert.strictEqual(s.paid, 0);
  });

  // full snapshot through the scheduled handler
  currentDb = makeDb(fixture);
  await registered.schedule.h();
  const cur = currentDb._store.adminStats.current;
  await check('snapshot written to current and daily-<today>', () => {
    assert.ok(cur);
    assert.ok(currentDb._store.adminStats['daily-' + day(0)]);
    assert.strictEqual(cur.trigger, 'schedule');
    assert.strictEqual(cur.seriesStart, day(0));
  });
  await check('totals and windows', () => {
    assert.strictEqual(cur.totalUsers, 6);
    assert.strictEqual(cur.new1, 1);
    assert.strictEqual(cur.new7, 2);
    assert.strictEqual(cur.new30, 3);
    assert.strictEqual(cur.active1, 1);
    assert.strictEqual(cur.active7, 3);     // a (0), b (2), f (1)
    assert.strictEqual(cur.active30, 4);    // + c (10)
    assert.strictEqual(cur.upcomingSessions, 1);
  });
  await check('plan histogram, and NO revenue without payment evidence', () => {
    // Updated for the paid rule (fix 1). These fixture students carry paid
    // plan LABELS but the fixture has no orders/subscriptions, so under the
    // rule none of them is revenue. Before the fix this asserted paid 3 and
    // mrr 87 purely from the labels — that assertion encoded the bug.
    assert.strictEqual(cur.paid, 0, 'a label is not a payment');
    assert.strictEqual(cur.payingMembers, 0);
    assert.strictEqual(cur.freeAccessMembers, 3, 'b Pro, c pro, d Elite: labels, no money');
    assert.strictEqual(cur.mrr, 0);
    assert.strictEqual(cur.mrrCurrency, 'USD');
    assert.deepStrictEqual(cur.byPlan, { Starter: 1, Pro: 1, pro: 1, Elite: 1, 'No plan': 1, Legacy: 1 });
  });
  await check('completion ignores unknown chapter ids; avg over starters only', () => {
    assert.deepStrictEqual(cur.chapterCompletions, { 1: 3, 2: 2, 3: 1, 4: 1 });
    assert.strictEqual(cur.startedCount, 3);
    // a 2/4, b 1/4, d 4/4 (stale id '99' ignored) → (0.5+0.25+1)/3 = 58%
    assert.strictEqual(cur.avgCompletion, Math.round(((0.5 + 0.25 + 1) / 3) * 100));
  });
  await check('snapshot holds no per-student data', () => {
    const json = JSON.stringify(cur);
    ['a@x', 'Student A', 'email', 'displayName'].forEach((s) => assert.ok(json.indexOf(s) === -1, 'leaked ' + s));
  });
  await check('students read via ONE projected select, no full-document get()', () => {
    const st = currentDb._calls.filter((c) => c.col === 'students');
    const kinds = [...new Set(st.map((c) => c.kind))].sort();
    // The window counts moved off count() aggregations and onto this same
    // projected scan, because an aggregation cannot skip bot- ids (see
    // countWindows in adminStats.js). That is ONE students read per run, down
    // from eight; the projection still keeps names/emails in the database.
    assert.deepStrictEqual(kinds, ['select:plan,completedChapters,createdAt,lastActiveDate,paidThroughMillis,subscriptionStatus,foundingMember,foundingCoupon']);
    assert.strictEqual(st.length, 1, 'exactly one students read per snapshot');
    assert.ok(!st.some((c) => c.kind === 'get'), 'never an unprojected students get()');
    // Fix 1 added the payment-evidence reads. They are projected too, and
    // there is ONE of each per run — never one read per student.
    ['orders', 'coupons', 'razorpaySubs'].forEach((col) => {
      const cs = currentDb._calls.filter((c) => c.col === col);
      assert.strictEqual(cs.length, 1, 'exactly one ' + col + ' read per snapshot');
      assert.ok(String(cs[0].kind).indexOf('select:') === 0, col + ' must be projected, not a full get()');
    });
  });
  await check('seriesStart is preserved on later runs', async () => {
    currentDb._store.adminStats.current.seriesStart = '2026-01-01';
    currentDb._store.adminStats.current.generatedAt = new Timestamp(0);
    await registered.schedule.h();
    assert.strictEqual(currentDb._store.adminStats.current.seriesStart, '2026-01-01');
  });

  // callable guard
  await check('refresh: signed-out rejected', async () => {
    await assert.rejects(() => registered.call({}, {}), (e) => e.code === 'unauthenticated');
  });
  await check('refresh: non-admin rejected (checked against admins/{uid})', async () => {
    await assert.rejects(() => registered.call({}, { auth: { uid: 'a', token: { admin: true } } }), (e) => e.code === 'permission-denied');
  });
  await check('refresh: admin allowed, writes manual snapshot', async () => {
    currentDb._store.adminStats.current.generatedAt = new Timestamp(0);
    const r = await registered.call({}, { auth: { uid: 'adm' } });
    assert.strictEqual(r.ok, true); assert.strictEqual(r.throttled, false);
    assert.strictEqual(currentDb._store.adminStats.current.trigger, 'manual');
  });
  await check('refresh: throttled within 60 s', async () => {
    const r = await registered.call({}, { auth: { uid: 'adm' } });
    assert.strictEqual(r.throttled, true);
  });

  // ---- bot-* exclusion (CoS item 3) --------------------------------------
  // The rule is the generated `bot-` PREFIX and nothing else. These tests
  // prove both directions: a bot record reaches NO aggregate, and a real user
  // still reaches every one.
  await check('isBotUid: prefix only, never a substring match', () => {
    assert.strictEqual(T.isBotUid('bot-8gOMwJ7KPpFCY7eK1Tm1'), true);
    assert.strictEqual(T.isBotUid('bot-'), true, 'bare prefix is a bot id');
    assert.strictEqual(T.isBotUid('robot-abc'), false, 'contains but does not start with bot-');
    assert.strictEqual(T.isBotUid('xbot-1'), false, 'contains but does not start with bot-');
    assert.strictEqual(T.isBotUid('Bot-1'), false, 'case-sensitive: generated ids are lower-case');
    assert.strictEqual(T.isBotUid(undefined), false);
  });

  // Baseline snapshot with no bot records at all.
  currentDb = makeDb(fixture);
  await registered.schedule.h();
  const noBots = JSON.parse(JSON.stringify(currentDb._store.adminStats.current, (k, v) => (k === 'generatedAt' ? undefined : v)));

  // The same fixture plus one synthetic bot record that would, if counted,
  // move totalUsers, scanned, new*, active*, paid, mrr, byPlan and completion.
  const withBot = JSON.parse(JSON.stringify(fixture));
  withBot.students['bot-synthetic123'] = {
    plan: 'Elite', createdAt: ts(0), lastActiveDate: day(0),
    completedChapters: ['1', '2', '3'], email: 'bot@x', displayName: 'Desk Bot'
  };
  currentDb = makeDb(withBot);
  await registered.schedule.h();
  const botCur = currentDb._store.adminStats.current;

  await check('a synthetic bot- record reaches NO aggregate (full stat object identical)', () => {
    const got = JSON.parse(JSON.stringify(botCur, (k, v) => (k === 'generatedAt' ? undefined : v)));
    // Asserting on the WHOLE object, not just totalUsers: a bot must be
    // invisible to the aggregation, not subtracted from one line.
    assert.deepStrictEqual(got, noBots);
  });
  await check('...specifically: totalUsers, scanned, paid, mrr and byPlan are unmoved', () => {
    assert.strictEqual(botCur.totalUsers, noBots.totalUsers);
    assert.strictEqual(botCur.scanned, noBots.scanned);
    assert.strictEqual(botCur.paid, noBots.paid);
    assert.strictEqual(botCur.mrr, noBots.mrr);
    assert.strictEqual(botCur.new1, noBots.new1);
    assert.strictEqual(botCur.active1, noBots.active1);
    assert.strictEqual(botCur.byPlan.Elite, noBots.byPlan.Elite, 'bot must not inflate its plan bucket');
    assert.strictEqual(botCur.chapterCompletions['1'], noBots.chapterCompletions['1']);
  });

  // A real 28-char Firebase uid must still be counted, in every number.
  const withReal = JSON.parse(JSON.stringify(fixture));
  const REAL_UID = 'aSgVnKuaY9evfRSCMlVZdFXWFuI2';   // 28 chars, real-uid shape
  assert.strictEqual(REAL_UID.length, 28);
  withReal.students[REAL_UID] = {
    plan: 'Elite', createdAt: ts(0), lastActiveDate: day(0), completedChapters: ['1']
  };
  currentDb = makeDb(withReal);
  await registered.schedule.h();
  const realCur = currentDb._store.adminStats.current;

  await check('a real 28-char uid DOES still reach totalUsers and every aggregate', () => {
    assert.strictEqual(realCur.totalUsers, noBots.totalUsers + 1);
    assert.strictEqual(realCur.scanned, noBots.scanned + 1);
    assert.strictEqual(realCur.new1, noBots.new1 + 1);
    assert.strictEqual(realCur.new30, noBots.new30 + 1);
    assert.strictEqual(realCur.active1, noBots.active1 + 1);
    // Under the paid rule this Elite label has no payment evidence, so it
    // reaches the aggregates as a free-access member, not as revenue. The
    // point of this test is that the row is COUNTED, not that it is paid.
    assert.strictEqual(realCur.freeAccessMembers, noBots.freeAccessMembers + 1, 'Elite label, no gateway record');
    assert.strictEqual(realCur.paid, noBots.paid, 'a label must not create revenue');
    assert.strictEqual(realCur.mrr, noBots.mrr);
    assert.strictEqual(realCur.byPlan.Elite, noBots.byPlan.Elite + 1);
  });

  // Edge: ids that merely CONTAIN "bot-" are real users and must count.
  const withLookalikes = JSON.parse(JSON.stringify(fixture));
  withLookalikes.students['robot-abc'] = { plan: 'Elite', createdAt: ts(0), lastActiveDate: day(0), completedChapters: [] };
  withLookalikes.students['xbot-1'] = { plan: 'Elite', createdAt: ts(0), lastActiveDate: day(0), completedChapters: [] };
  currentDb = makeDb(withLookalikes);
  await registered.schedule.h();
  const lookCur = currentDb._store.adminStats.current;

  await check('robot-abc and xbot-1 still COUNT (prefix rule, not substring)', () => {
    assert.strictEqual(lookCur.totalUsers, noBots.totalUsers + 2);
    // Counted as members; not revenue, since neither has a payment record.
    assert.strictEqual(lookCur.freeAccessMembers, noBots.freeAccessMembers + 2);
    assert.strictEqual(lookCur.byPlan.Elite, noBots.byPlan.Elite + 2);
  });

  // Edge: the bare prefix `bot-` as an id is excluded.
  const withBare = JSON.parse(JSON.stringify(fixture));
  withBare.students['bot-'] = { plan: 'Elite', createdAt: ts(0), lastActiveDate: day(0), completedChapters: [] };
  currentDb = makeDb(withBare);
  await registered.schedule.h();
  await check('the bare id "bot-" is excluded too', () => {
    const c = currentDb._store.adminStats.current;
    assert.strictEqual(c.totalUsers, noBots.totalUsers);
    assert.strictEqual(c.paid, noBots.paid);
  });

  await check('window counts still honour field type, as the old queries did', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    const w = T.countWindows([
      { createdAt: { toMillis: () => Date.parse('2026-09-28T01:00:00Z') }, lastActiveDate: '2026-09-28' },
      { createdAt: { toMillis: () => Date.parse('2026-09-01T01:00:00Z') }, lastActiveDate: '2026-09-01' },
      { },                                          // no fields: counted in total only
      { createdAt: 'not-a-timestamp', lastActiveDate: 12345 }  // wrong types: never matched by the old queries either
    ], now);
    assert.strictEqual(w.totalUsers, 4);
    assert.strictEqual(w.new1, 1);
    assert.strictEqual(w.new30, 2);
    assert.strictEqual(w.active1, 1);
    assert.strictEqual(w.active30, 2);
  });

  // ---- THE PAID RULE: evidence of payment, not a plan label ---------------
  // Every case below is modelled on a real account from the 2026-09-28 revenue
  // audit, which found 29 of 30 "paid" members had never paid anything.
  // These MUST fail on main (where price>0 alone counted as paid) and pass here.
  const NOW = Date.parse('2026-09-28T20:00:00Z');
  const FUTURE = NOW + 30 * 86400000;
  const PAST = NOW - 30 * 86400000;
  const PLANS = [{ name: 'Elite', price: '$129/mo' }, { name: 'Starter', price: 'Free' }];
  const COUPONS = {
    WELCOME: { type: 'free', value: 0 },
    BETA: { type: 'free', value: 0 },
    FREE: { type: 'percent', value: 0 }
  };
  // Runs summarise() with payment evidence; one student unless told otherwise.
  const sum1 = (row, evidence) => T.summarise(
    [Object.assign({ __uid: 'u1', plan: 'Elite' }, row)], PLANS, [],
    Object.assign({ couponsByCode: COUPONS, nowMs: NOW }, evidence)
  );

  await check('RULE 1: founding grant (foundingMember, WELCOME) is NOT paid', () => {
    const s = sum1({ foundingMember: true, foundingCoupon: 'WELCOME',
      subscriptionStatus: 'active', paidThroughMillis: FUTURE },
      { ordersByUid: { u1: [{ finalAmount: 0, currency: 'USD', gateway: 'coupon',
        couponCode: 'WELCOME', status: 'completed' }] } });
    assert.strictEqual(s.mrr, 0, 'a grant is not revenue');
    assert.strictEqual(s.payingMembers, 0);
    assert.strictEqual(s.freeAccessMembers, 1);
    assert.strictEqual(s.freeAccessReasons['founding grant'], 1);
  });

  await check('RULE 2: free-coupon checkout (BETA) is NOT paid', () => {
    const s = sum1({ foundingCoupon: 'BETA', subscriptionStatus: 'active', paidThroughMillis: FUTURE },
      { ordersByUid: { u1: [{ finalAmount: 0, currency: 'USD', gateway: 'coupon',
        couponCode: 'BETA', status: 'completed' }] } });
    assert.strictEqual(s.mrr, 0);
    assert.strictEqual(s.payingMembers, 0);
    assert.strictEqual(s.freeAccessMembers, 1);
    assert.strictEqual(s.freeAccessReasons['free coupon BETA'], 1);
  });

  await check('RULE 3: hand-set paid label, no gateway record and no coupon, is NOT paid', () => {
    const s = sum1({ subscriptionStatus: 'active', paidThroughMillis: FUTURE }, {});
    assert.strictEqual(s.mrr, 0, 'a label is not money');
    assert.strictEqual(s.payingMembers, 0);
    assert.strictEqual(s.freeAccessMembers, 1);
    assert.strictEqual(s.freeAccessReasons['hand-set label, no gateway record'], 1);
  });

  await check('RULE 4: zero-amount order with no coupon is NOT paid', () => {
    const s = sum1({ subscriptionStatus: 'active', paidThroughMillis: FUTURE },
      { ordersByUid: { u1: [{ finalAmount: 0, currency: 'USD', gateway: 'stripe', status: 'completed' }] } });
    assert.strictEqual(s.mrr, 0);
    assert.strictEqual(s.payingMembers, 0);
    assert.strictEqual(s.freeAccessMembers, 1);
    assert.strictEqual(s.freeAccessReasons['zero-amount order'], 1);
  });

  await check('RULE 5: real Stripe subscription + future paidThrough IS paid', () => {
    const s = sum1({ subscriptionStatus: 'active', paidThroughMillis: FUTURE },
      { ordersByUid: { u1: [{ finalAmount: 129, currency: 'USD', amountUsd: 129,
        gateway: 'stripe', status: 'completed', stripeSubscriptionId: 'sub_live' }] },
        subsByUid: { u1: { stripe: true } } });
    assert.strictEqual(s.payingMembers, 1);
    assert.strictEqual(s.mrr, 129);
    assert.strictEqual(s.freeAccessMembers, 0);
    assert.strictEqual(s.expiredMembers, 0);
  });

  await check('RULE 6: expired entitlement with a real past payment is NOT paid, lands in expiredMembers', () => {
    const s = sum1({ subscriptionStatus: 'active', paidThroughMillis: PAST },
      { ordersByUid: { u1: [{ finalAmount: 129, currency: 'USD', amountUsd: 129,
        gateway: 'stripe', status: 'completed', stripeSubscriptionId: 'sub_old' }] },
        subsByUid: { u1: { stripe: true } } });
    assert.strictEqual(s.payingMembers, 0, 'the period has lapsed');
    assert.strictEqual(s.mrr, 0);
    assert.strictEqual(s.expiredMembers, 1);
    assert.strictEqual(s.freeAccessMembers, 0);
  });

  await check('RULE 7: INR order with amountUsd converts; one without it never joins the sum', () => {
    const ok = sum1({ paidThroughMillis: FUTURE },
      { ordersByUid: { u1: [{ finalAmount: 10700, currency: 'INR', amountUsd: 129,
        fxRate: 83, gateway: 'razorpay', status: 'completed' }] } });
    assert.strictEqual(ok.mrr, 129, 'amountUsd is used, not the rupee figure');
    assert.strictEqual(ok.mrrCurrency, 'USD');
    assert.strictEqual(ok.mrrUnconvertible, 0);

    const bad = sum1({ paidThroughMillis: FUTURE },
      { ordersByUid: { u1: [{ finalAmount: 10700, currency: 'INR',
        gateway: 'razorpay', status: 'completed' }] } });
    assert.strictEqual(bad.mrr, 0, '10700 rupees must never be summed as dollars');
    assert.strictEqual(bad.mrrUnconvertible, 1, 'surfaced as an exception, not dropped');
    assert.strictEqual(bad.payingMembers, 1, 'still a paying member, just unconvertible');
  });

  await check('mrrCurrency is USD, never null', () => {
    assert.strictEqual(T.summarise([], PLANS, []).mrrCurrency, 'USD');
    assert.strictEqual(sum1({ paidThroughMillis: FUTURE }, {}).mrrCurrency, 'USD');
  });

  await check('the three buckets are separate and sum to the paid-labelled count', () => {
    const rows = [
      { __uid: 'pay', plan: 'Elite', paidThroughMillis: FUTURE },
      { __uid: 'grant', plan: 'Elite', foundingMember: true, paidThroughMillis: FUTURE },
      { __uid: 'lapsed', plan: 'Elite', paidThroughMillis: PAST },
      { __uid: 'starter', plan: 'Starter' }
    ];
    const s = T.summarise(rows, PLANS, [], {
      couponsByCode: COUPONS, nowMs: NOW,
      ordersByUid: {
        pay: [{ finalAmount: 129, currency: 'USD', amountUsd: 129, gateway: 'stripe', status: 'completed' }],
        lapsed: [{ finalAmount: 129, currency: 'USD', amountUsd: 129, gateway: 'stripe', status: 'completed' }]
      }
    });
    assert.strictEqual(s.payingMembers, 1);
    assert.strictEqual(s.freeAccessMembers, 1);
    assert.strictEqual(s.expiredMembers, 1);
    assert.strictEqual(s.payingMembers + s.freeAccessMembers + s.expiredMembers, 3,
      'the three buckets must account for every paid-labelled student');
    assert.strictEqual(s.mrr, 129, 'only the genuine payer contributes revenue');
    assert.strictEqual(s.paid, 1, 'the legacy key must mean paying, never a grant');
  });

  await check('a refunded/failed order is not proof of payment', () => {
    ['refunded', 'failed', 'cancelled', 'created'].forEach((st) => {
      assert.strictEqual(T.orderProvesPayment(
        { finalAmount: 129, gateway: 'stripe', status: st }, COUPONS), false, st);
    });
    assert.strictEqual(T.orderProvesPayment(
      { finalAmount: 129, gateway: 'stripe', status: 'completed' }, COUPONS), true);
  });

  await check('MRR is the CURRENT recurring charge, not lifetime revenue', () => {
    // Six monthly payments of $19 are $114 of lifetime revenue but $19 of
    // MRR. Summing every order would overstate a real customer, the mirror
    // image of the label bug. Found by cross-checking the rule against the
    // real audit evidence, where the one paying account has two orders.
    const s = sum1({ paidThroughMillis: FUTURE }, {
      ordersByUid: { u1: [
        { finalAmount: 19, currency: 'USD', amountUsd: 19, gateway: 'stripe',
          status: 'completed', createdAt: NOW - 150 * 86400000 },
        { finalAmount: 19, currency: 'USD', amountUsd: 19, gateway: 'stripe',
          status: 'completed', createdAt: NOW - 5 * 86400000 }
      ] }
    });
    assert.strictEqual(s.payingMembers, 1);
    assert.strictEqual(s.mrr, 19, 'two $19 orders are $19 of MRR, not $38');
  });

  await check('the newest qualifying order sets the rate, and a free order never does', () => {
    // An upgrade: old $19, current $49. MRR follows the newest.
    const up = sum1({ paidThroughMillis: FUTURE }, {
      ordersByUid: { u1: [
        { finalAmount: 19, currency: 'USD', amountUsd: 19, gateway: 'stripe', status: 'completed', createdAt: NOW - 90 * 86400000 },
        { finalAmount: 49, currency: 'USD', amountUsd: 49, gateway: 'stripe', status: 'completed', createdAt: NOW - 2 * 86400000 }
      ] }
    });
    assert.strictEqual(up.mrr, 49, 'the current rate, not the old one');

    // A later zero-amount coupon order must not zero out a real payment:
    // it is disqualified before the newest-order choice is made.
    const mixed = sum1({ paidThroughMillis: FUTURE }, {
      ordersByUid: { u1: [
        { finalAmount: 49, currency: 'USD', amountUsd: 49, gateway: 'stripe', status: 'completed', createdAt: NOW - 10 * 86400000 },
        { finalAmount: 0, currency: 'USD', gateway: 'coupon', couponCode: 'WELCOME', status: 'completed', createdAt: NOW - 1 * 86400000 }
      ] }
    });
    assert.strictEqual(mixed.payingMembers, 1);
    assert.strictEqual(mixed.mrr, 49, 'a free grant on top of a paid plan does not erase the revenue');
  });

  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})();
