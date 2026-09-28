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
  await check('paid/free, plan histogram, MRR (case-insensitive plan names)', () => {
    assert.strictEqual(cur.paid, 3);        // b Pro, c pro, d Elite
    assert.strictEqual(cur.free, 3);
    assert.deepStrictEqual(cur.byPlan, { Starter: 1, Pro: 1, pro: 1, Elite: 1, 'No plan': 1, Legacy: 1 });
    assert.strictEqual(cur.mrr, 19 + 19 + 49);
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
  await check('students read only via count() and one projected select(plan,completedChapters)', () => {
    const st = currentDb._calls.filter((c) => c.col === 'students');
    const kinds = [...new Set(st.map((c) => c.kind))].sort();
    assert.deepStrictEqual(kinds, ['count', 'select:plan,completedChapters']);
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

  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail ? 1 : 0);
})();
