// Stub Firestore + fetch for the admin-analytics build's headless-Chromium
// test harness. Not reused from tools/tests/richstub.js: that stub's
// generic colRef() fallback answers where/orderBy/limit chains with a fixed
// empty snapshot, which is wrong for the exact queries this page depends on
// (students orderBy(createdAt).limit(5), activityLog orderBy(createdAt).limit(8),
// traffic doc-by-id, adminStats/current, adminStats/daily-*). This stub
// implements those precisely, plus fetch() interception for the Firestore
// REST runAggregationQuery online-now call.
//
// mode: 'loaded' | 'failed' | 'no-data' | 'non-admin'
function build(mode) {
  const body = function (MODE) {
    var NOW = Date.now();
    function ts(dAgo, hAgo) {
      var ms = NOW - (dAgo || 0) * 864e5 - (hAgo || 0) * 36e5;
      return { toMillis: function () { return ms; }, toDate: function () { return new Date(ms); } };
    }

    var ADMIN_UID = 'u1';
    var IS_ADMIN = MODE !== 'non-admin';

    // ---- fixture data (obviously-fake round numbers, "Student A" names) ----
    var STUDENTS_ROWS = [];
    if (MODE === 'loaded') {
      var names = ['Student A', 'Student B', 'Student C', 'Student D', 'Student E'];
      var plans = ['Starter', 'Growth', 'Pro', 'Starter', 'Growth'];
      for (var i = 0; i < 5; i++) {
        STUDENTS_ROWS.push({
          id: 'stu' + i,
          displayName: names[i], email: 'student' + i + '@example.com',
          plan: plans[i], createdAt: ts(0, i), completedChapters: ['01', '02']
        });
      }
    }

    var ACTIVITY_ROWS = [];
    if (MODE === 'loaded') {
      for (var j = 0; j < 8; j++) {
        ACTIVITY_ROWS.push({
          id: 'log' + j, actorName: 'Admin', action: 'chapter.updated',
          summary: 'Updated chapter ' + String(j + 1).padStart(2, '0'),
          createdAt: ts(0, j)
        });
      }
    }

    var ADMIN_STATS_CURRENT = null;
    if (MODE === 'loaded') {
      ADMIN_STATS_CURRENT = {
        generatedAt: ts(0, 0), trigger: 'schedule', tz: 'UTC',
        totalUsers: 1000, new1: 10, new7: 50, new30: 100,
        active1: 100, active7: 300, active30: 500,
        paid: 200, free: 800, byPlan: { Starter: 800, Growth: 100, Pro: 100 },
        mrr: 1000, mrrCurrency: 'USD',
        // The paid-rule buckets. paid === payingMembers now: a grant is never
        // revenue, so the MRR sub-line must show the split beside the figure.
        payingMembers: 200, freeAccessMembers: 40, expiredMembers: 12,
        mrrUnconvertible: 3,
        avgCompletion: 50, startedCount: 500,
        chapterCompletions: { '1': 800, '2': 600, '3': 500, '4': 400, '38': 100 },
        chapterTitles: { '1': 'Candles, Charts & the Language of Price', '2': 'Market Structure', '3': 'Liquidity', '4': 'Order Blocks', '38': 'Prop Firm Psychology' },
        upcomingSessions: 2,
        seriesStart: '2026-08-01'
      };
    }

    var DAILY_DOCS = {};
    if (MODE === 'loaded') {
      // 3 days of history so the trend note shows "N days of history stored."
      for (var d = 0; d < 3; d++) {
        var key = new Date(NOW - d * 864e5);
        var dayId = key.getUTCFullYear() + '-' + String(key.getUTCMonth() + 1).padStart(2, '0') + '-' + String(key.getUTCDate()).padStart(2, '0');
        DAILY_DOCS['daily-' + dayId] = Object.assign({}, ADMIN_STATS_CURRENT);
      }
    }

    var TRAFFIC_DOCS = {};
    if (MODE === 'loaded') {
      var t0 = new Date(NOW);
      var key0 = t0.getUTCFullYear() + '-' + String(t0.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t0.getUTCDate()).padStart(2, '0');
      TRAFFIC_DOCS[key0] = { visits: 1000 };
    }

    var LIVE_SESSIONS_ROWS = [];
    if (MODE === 'loaded') {
      LIVE_SESSIONS_ROWS.push({ id: 'ls1', startsAt: ts(-3, 0) });
      LIVE_SESSIONS_ROWS.push({ id: 'ls2', startsAt: ts(-7, 0) });
    }

    function fail(msg) { return Promise.reject(new Error(msg || 'stub: simulated failure')); }

    function snap(exists, data) {
      return { exists: !!exists, id: 'x', data: function () { return data || {}; } };
    }
    function listSnap(rows) {
      return {
        empty: rows.length === 0, size: rows.length,
        docs: rows.map(function (r) { return { id: r.id, exists: true, data: function () { return r; } }; }),
        forEach: function (fn) { rows.forEach(function (r) { fn({ id: r.id, exists: true, data: function () { return r; } }); }); }
      };
    }

    // Generic doc/collection stub for everything the page touches but this
    // test does not specifically assert on (settings, plans, chapters,
    // conversations, notifications, pushTokens, adminNotes, adminTasks,
    // bannedUsers, moderators, communityPosts, contactMessages, ...).
    function genericDocRef() {
      return {
        get: function () { return MODE === 'failed' ? fail() : Promise.resolve(snap(false, null)); },
        set: function () { return Promise.resolve(); },
        update: function () { return Promise.resolve(); },
        delete: function () { return Promise.resolve(); },
        collection: function () { return genericColRef(); }
      };
    }
    function genericColRef() {
      return {
        doc: genericDocRef,
        get: function () { return MODE === 'failed' ? fail() : Promise.resolve(listSnap([])); },
        add: function () { return Promise.resolve({ id: 'x' }); },
        where: function () { return genericColRef(); },
        orderBy: function () { return genericColRef(); },
        limit: function () { return genericColRef(); },
        onSnapshot: function () { return function () {}; }
      };
    }

    function studentsColRef(state) {
      state = state || {};
      return {
        doc: function (uid) {
          return {
            get: function () {
              if (MODE === 'failed') return fail();
              // account-menu.js / theme.js / notifications.js read this for
              // the signed-in admin's own doc; harmless empty is fine.
              return Promise.resolve(snap(false, null));
            },
            set: function () { return Promise.resolve(); },
            collection: function () { return genericColRef(); }
          };
        },
        orderBy: function () { return studentsColRef(Object.assign({}, state, { ordered: true })); },
        limit: function (n) { return studentsColRef(Object.assign({}, state, { limitN: n })); },
        where: function () { return studentsColRef(state); }, // admin-tasks.js TradingView query: empty in this fixture
        get: function () {
          if (MODE === 'failed') return fail();
          var rows = STUDENTS_ROWS.slice(0, state.limitN || STUDENTS_ROWS.length);
          return Promise.resolve(listSnap(rows));
        }
      };
    }

    function activityLogColRef(state) {
      state = state || {};
      return {
        orderBy: function () { return activityLogColRef(Object.assign({}, state, { ordered: true })); },
        limit: function (n) { return activityLogColRef(Object.assign({}, state, { limitN: n })); },
        add: function () { return Promise.resolve({ id: 'x' }); },
        get: function () {
          if (MODE === 'failed') return fail();
          var rows = ACTIVITY_ROWS.slice(0, state.limitN || ACTIVITY_ROWS.length);
          return Promise.resolve(listSnap(rows));
        }
      };
    }

    function adminStatsColRef() {
      return {
        doc: function (id) {
          return {
            get: function () {
              if (MODE === 'failed') return fail();
              if (id === 'current') return Promise.resolve(snap(!!ADMIN_STATS_CURRENT, ADMIN_STATS_CURRENT));
              var d = DAILY_DOCS[id];
              return Promise.resolve(snap(!!d, d));
            }
          };
        }
      };
    }

    function trafficColRef() {
      return {
        doc: function (id) {
          return {
            get: function () {
              if (MODE === 'failed') return fail();
              // Race tests (race.js) install window.__trafficCtl(id) to control
              // each read's latency and outcome: { data, delayMs, fail }.
              if (typeof window.__trafficCtl === 'function') {
                var c = window.__trafficCtl(id) || {};
                return new Promise(function (resolve, reject) {
                  setTimeout(function () {
                    if (c.fail) reject(new Error('stub: traffic read failed (race test)'));
                    else resolve(snap(!!c.data, c.data));
                  }, c.delayMs || 0);
                });
              }
              var d = TRAFFIC_DOCS[id];
              return Promise.resolve(snap(!!d, d));
            }
          };
        }
      };
    }

    function liveSessionsColRef() {
      return {
        get: function () {
          if (MODE === 'failed') return fail();
          return Promise.resolve(listSnap(LIVE_SESSIONS_ROWS));
        }
      };
    }

    function adminsColRef() {
      return {
        doc: function (uid) {
          return {
            get: function () {
              // The admin guard itself must pass in every mode except
              // 'non-admin' — that is a separate, deliberate assertion.
              return Promise.resolve(snap(uid === ADMIN_UID && IS_ADMIN, IS_ADMIN ? { role: 'admin' } : null));
            }
          };
        }
      };
    }

    function colRef(name) {
      if (name === 'students') return studentsColRef();
      if (name === 'activityLog') return activityLogColRef();
      if (name === 'adminStats') return adminStatsColRef();
      if (name === 'traffic') return trafficColRef();
      if (name === 'liveSessions') return liveSessionsColRef();
      if (name === 'admins') return adminsColRef();
      return genericColRef();
    }

    window.__stubDb = { collection: colRef, batch: function () { return { set: function () {}, update: function () {}, delete: function () {}, commit: function () { return Promise.resolve(); } }; } };
    window.db = window.__stubDb;

    window.__stubAuth = {
      currentUser: { uid: ADMIN_UID, email: 'admin@example.com', displayName: 'Admin', getIdToken: function () { return Promise.resolve('fake-id-token'); } },
      onAuthStateChanged: function (cb) { setTimeout(function () { cb(window.__stubAuth.currentUser); }, 10); return function () {}; },
      setPersistence: function () { return Promise.resolve(); },
      signOut: function () { return Promise.resolve(); }
    };

    window.firebase = {
      apps: [],
      initializeApp: function () { return {}; },
      app: function () { return { functions: function () { return { httpsCallable: function () { return function () { return Promise.resolve({ data: {} }); }; } }; } }; },
      firestore: Object.assign(function () { return window.__stubDb; }, {
        FieldValue: { serverTimestamp: function () { return 'TS'; }, increment: function (n) { return { inc: n }; }, delete: function () { return 'DEL'; }, arrayUnion: function () { return 'AU'; }, arrayRemove: function () { return 'AR'; } },
        Timestamp: { now: function () { return { toDate: function () { return new Date(); } }; } }
      }),
      auth: Object.assign(function () { return window.__stubAuth; }, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }),
      messaging: function () { return { getToken: function () { return Promise.resolve(null); }, onMessage: function () {} }; }
    };
    window.auth = window.__stubAuth;
    window.showToast = function () { return Promise.resolve(); };

    // ---- fetch() interception: only the runAggregationQuery POST is real
    // network in production; intercept it and return a fixture count so the
    // "0 real network requests" check stays true while Online now still gets
    // a real value to render in the 'loaded' fixture.
    var REAL_FETCH = window.fetch;
    window.fetch = function (url, opts) {
      if (typeof url === 'string' && url.indexOf('runAggregationQuery') !== -1) {
        if (MODE === 'failed') return Promise.resolve({ ok: false, status: 500 });
        var n = MODE === 'loaded' ? 10 : 0;
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve([{ result: { aggregateFields: { n: { integerValue: String(n) } } }, readTime: new Date().toISOString() }]);
          }
        });
      }
      return Promise.reject(new Error('stub: blocked unexpected fetch to ' + url));
    };
  };
  return '(' + body.toString() + ')(' + JSON.stringify(mode) + ');';
}
module.exports = { build: build };
