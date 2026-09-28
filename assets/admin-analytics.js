// Stryker Trading Academy — Admin dashboard analytics bento (real data only)
// Depends on: assets/auth.js, assets/progress.js (db), assets/presence.js
//             (PRESENCE_ONLINE_MS), assets/admin-guard.js. Loaded after both.
//
// This file owns the NEW analytics section at the top of dashboard-admin.html.
// It never touches the legacy stat-grid / chapter-engagement / recent-students
// panels below it — those stay owned by admin-overview.js.
//
// HARD RULES (do not relax these to make the UI look fuller):
//   - Every number here is either a real read or one of three placeholder
//     states: "…" (loading), "Unavailable" (the read failed), "No data yet"
//     (the read succeeded and there is genuinely nothing stored). A bare 0 is
//     only ever shown when a query actually returned and the count is zero.
//   - No collection scans. Every read here is a single doc, a doc-by-id, a
//     bounded/limited query, or a Firestore REST count aggregation.
//   - No trend is ever drawn from fewer than 2 stored daily snapshots.

var STRYKER_PROJECT_ID = 'strykertrades-e0cd8';

// ---- small render helpers --------------------------------------------------

function aaEsc(v){
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function aaSet(id, text){
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

function aaSetLoading(ids){ ids.forEach(function (id) { aaSet(id, '…'); }); }
function aaSetUnavailable(ids){ ids.forEach(function (id) { aaSet(id, 'Unavailable'); }); }
function aaSetNoData(ids){ ids.forEach(function (id) { aaSet(id, 'No data yet'); }); }

function aaRelativeTime(ms){
  if (!ms) return null;
  var diff = Date.now() - ms;
  if (diff < 0) diff = 0;
  var m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  var d = Math.floor(h / 24);
  return d + 'd ago';
}

function aaDayKey(dAgo){
  var d = new Date(Date.now() - dAgo * 86400000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

// ---- A. adminStats/current --------------------------------------------------

var AA_STATS_IDS = [
  'aa-total-users', 'aa-online-now', 'aa-new-range', 'aa-active-range',
  'aa-paid-conv', 'aa-plan-split', 'aa-mrr', 'aa-completion', 'aa-completion-sub'
];

var AA_STATE = { stats: null, range: 'today' };

function aaFormatPlanSplit(stats){
  if (!stats.byPlan) return '';
  var total = stats.totalUsers || 0;
  var keys = Object.keys(stats.byPlan);
  if (!keys.length || !total) return '';
  return keys.map(function (k) {
    var n = stats.byPlan[k] || 0;
    return k + ' ' + Math.round((n / total) * 100) + '%';
  }).join(' · ');
}

function aaRenderStats(){
  var stats = AA_STATE.stats;
  if (stats === undefined) { aaSetUnavailable(AA_STATS_IDS); return; }
  if (stats === null) { aaSetNoData(AA_STATS_IDS); return; }

  aaSet('aa-total-users', (typeof stats.totalUsers === 'number') ? stats.totalUsers.toLocaleString() : 'No data yet');

  var range = AA_STATE.range;
  var newVal = range === 'today' ? stats.new1 : range === '7d' ? stats.new7 : range === '30d' ? stats.new30 : stats.totalUsers;
  var activeVal = range === 'today' ? stats.active1 : range === '7d' ? stats.active7 : range === '30d' ? stats.active30 : null;
  aaSet('aa-new-range', (typeof newVal === 'number') ? newVal.toLocaleString() : 'No data yet');
  aaSet('aa-active-range', (typeof activeVal === 'number') ? activeVal.toLocaleString()
    : (range === 'all' ? 'n/a' : 'No data yet'));

  var totalUsers = stats.totalUsers || 0;
  var paid = stats.paid;
  if (typeof paid === 'number' && totalUsers) {
    aaSet('aa-paid-conv', Math.round((paid / totalUsers) * 100) + '%');
  } else {
    aaSet('aa-paid-conv', 'No data yet');
  }
  var split = aaFormatPlanSplit(stats);
  aaSet('aa-plan-split', split || '\u2014');

  aaSet('aa-mrr', (typeof stats.mrr === 'number')
    ? '$' + Math.round(stats.mrr).toLocaleString() + (stats.mrrCurrency && stats.mrrCurrency !== 'USD' ? ' ' + stats.mrrCurrency : '')
    : 'No data yet');

  if (typeof stats.avgCompletion === 'number') {
    aaSet('aa-completion', stats.avgCompletion + '%');
    var titles = stats.chapterTitles || {};
    var comps = stats.chapterCompletions || {};
    var ids = Object.keys(comps);
    if (ids.length) {
      ids.sort(function (a, b) { return (comps[b] || 0) - (comps[a] || 0); });
      var most = ids[0];
      var least = ids[ids.length - 1];
      aaSet('aa-completion-sub', 'Most: ' + (titles[most] || ('Ch ' + most)) + '  ·  Least: ' + (titles[least] || ('Ch ' + least)));
    } else {
      aaSet('aa-completion-sub', '');
    }
  } else {
    aaSet('aa-completion', 'No data yet');
    aaSet('aa-completion-sub', '');
  }

  var updatedEl = document.getElementById('aa-updated');
  if (updatedEl) {
    var ms = (stats.generatedAt && stats.generatedAt.toMillis) ? stats.generatedAt.toMillis() : null;
    var rel = aaRelativeTime(ms);
    updatedEl.textContent = rel ? ('Updated ' + rel) : '';
  }
}

function aaLoadStats(){
  aaSetLoading(AA_STATS_IDS);
  return db.collection('adminStats').doc('current').get()
    .then(function (doc) {
      AA_STATE.stats = doc.exists ? doc.data() : null;
      aaRenderStats();
    })
    .catch(function (err) {
      console.error('Stryker: adminStats/current read failed', err);
      AA_STATE.stats = undefined;
      aaRenderStats();
    });
}

// ---- B. Online now (REST aggregation, no SDK change) -----------------------

var AA_ONLINE_TIMER = null;

function aaFetchOnlineNow(){
  if (typeof auth === 'undefined' || !auth || !auth.currentUser) return Promise.resolve(null);
  var onlineMs = (typeof PRESENCE_ONLINE_MS === 'number') ? PRESENCE_ONLINE_MS : 150000;
  var cutoff = new Date(Date.now() - onlineMs).toISOString();
  var url = 'https://firestore.googleapis.com/v1/projects/' + STRYKER_PROJECT_ID +
    '/databases/(default)/documents:runAggregationQuery';
  var body = {
    structuredAggregationQuery: {
      structuredQuery: {
        from: [{ collectionId: 'presence' }],
        where: { fieldFilter: { field: { fieldPath: 'lastSeen' }, op: 'GREATER_THAN', value: { timestampValue: cutoff } } }
      },
      aggregations: [{ alias: 'n', count: {} }]
    }
  };
  return auth.currentUser.getIdToken().then(function (idToken) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }).then(function (res) {
    if (!res.ok) throw new Error('runAggregationQuery HTTP ' + res.status);
    return res.json();
  }).then(function (rows) {
    var row = Array.isArray(rows) ? rows.find(function (r) { return r && r.result; }) : null;
    if (!row) return 0;
    var v = row.result.aggregateFields && row.result.aggregateFields.n && row.result.aggregateFields.n.integerValue;
    return v === undefined ? 0 : Number(v);
  });
}

function aaRefreshOnlineNow(){
  return aaFetchOnlineNow().then(function (n) {
    aaSet('aa-online-now', n === null ? 'No data yet' : n.toLocaleString());
  }).catch(function (err) {
    console.error('Stryker: online-now aggregation failed', err);
    aaSet('aa-online-now', 'Unavailable');
  });
}

function aaStartOnlineNowPolling(){
  aaSet('aa-online-now', '…');
  aaRefreshOnlineNow();
  if (AA_ONLINE_TIMER) clearInterval(AA_ONLINE_TIMER);
  AA_ONLINE_TIMER = setInterval(function () {
    if (document.visibilityState === 'visible') aaRefreshOnlineNow();
  }, 60000);
}

// ---- C. Recent signups -------------------------------------------------------

function aaRenderRecentSignups(students){
  var wrap = document.getElementById('aa-recent-signups');
  if (!wrap) return;
  if (!students) { wrap.innerHTML = '<p class="aa-empty">Unavailable</p>'; return; }
  if (!students.length) { wrap.innerHTML = '<p class="aa-empty">No data yet</p>'; return; }
  wrap.innerHTML = students.map(function (s) {
    var name = s.displayName || (s.email ? s.email.split('@')[0] : 'Unnamed');
    var plan = s.plan || 'Free';
    var ms = (s.createdAt && s.createdAt.toMillis) ? s.createdAt.toMillis() : null;
    var rel = aaRelativeTime(ms) || '\u2014';
    return '<div class="feed-row"><span class="feed-dot"></span><div><div>' +
      aaEsc(name) + ' \u2014 ' + aaEsc(plan) + '</div><div class="feed-time">' + aaEsc(rel) + '</div></div></div>';
  }).join('');
}

function aaLoadRecentSignups(){
  var wrap = document.getElementById('aa-recent-signups');
  if (wrap) wrap.innerHTML = '<p class="aa-empty">\u2026</p>';
  return db.collection('students').orderBy('createdAt', 'desc').limit(5).get()
    .then(function (snap) {
      var out = [];
      snap.forEach(function (d) { out.push(Object.assign({ uid: d.id }, d.data())); });
      aaRenderRecentSignups(out);
      return out;
    })
    .catch(function (err) {
      console.error('Stryker: recent signups query failed', err);
      aaRenderRecentSignups(null);
      return null;
    });
}

// ---- D. Recent activity -----------------------------------------------------

function aaRenderRecentActivity(logs){
  var wrap = document.getElementById('aa-recent-activity');
  if (!wrap) return;
  if (!logs) { wrap.innerHTML = '<p class="aa-empty">Unavailable</p>'; return; }
  if (!logs.length) { wrap.innerHTML = '<p class="aa-empty">No data yet</p>'; return; }
  wrap.innerHTML = logs.map(function (l) {
    var actor = l.actorName || 'Unknown';
    var action = l.summary || l.action || '';
    var ms = (l.createdAt && l.createdAt.toMillis) ? l.createdAt.toMillis() : null;
    var rel = aaRelativeTime(ms) || '\u2014';
    return '<div class="feed-row"><span class="feed-dot"></span><div><div>' +
      aaEsc(actor) + ' \u2014 ' + aaEsc(action) + '</div><div class="feed-time">' + aaEsc(rel) + '</div></div></div>';
  }).join('');
}

function aaLoadRecentActivity(){
  var wrap = document.getElementById('aa-recent-activity');
  if (wrap) wrap.innerHTML = '<p class="aa-empty">\u2026</p>';
  return db.collection('activityLog').orderBy('createdAt', 'desc').limit(8).get()
    .then(function (snap) {
      var out = [];
      snap.forEach(function (d) { out.push(d.data()); });
      aaRenderRecentActivity(out);
      return out;
    })
    .catch(function (err) {
      console.error('Stryker: recent activity query failed', err);
      aaRenderRecentActivity(null);
      return null;
    });
}

// ---- E. Visits (traffic/{YYYY-MM-DD} day-total docs, explicit ids only) ----
// Ignores src~/cmp~ breakdown docs — only the plain day-total doc per date.

function aaDaysForRange(range){
  var n = range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 30; // "All" caps at 30 stored days
  var out = [];
  for (var i = 0; i < n; i++) out.push(aaDayKey(i));
  return out;
}

function aaLoadVisits(range){
  var wrap = document.getElementById('aa-visits');
  if (wrap) wrap.innerHTML = '<p class="aa-empty">\u2026</p>';
  var days = aaDaysForRange(range || 'today');
  return Promise.all(days.map(function (day) {
    return db.collection('traffic').doc(day).get().catch(function () { return { exists: false }; });
  })).then(function (docs) {
    var found = docs.filter(function (d) { return d.exists; });
    if (!found.length) {
      if (wrap) wrap.innerHTML = '<p class="aa-empty">No data yet</p>';
      return;
    }
    var total = found.reduce(function (acc, d) {
      var v = d.data().visits;
      return acc + (typeof v === 'number' ? v : 0);
    }, 0);
    if (wrap) {
      wrap.innerHTML = '<div class="aa-visit-total">' + total.toLocaleString() + '</div>' +
        '<div class="aa-visit-sub">' + found.length + ' of ' + days.length + ' day' + (days.length === 1 ? '' : 's') + ' in range with data</div>';
    }
  }).catch(function (err) {
    console.error('Stryker: visits read failed', err);
    if (wrap) wrap.innerHTML = '<p class="aa-empty">Unavailable</p>';
  });
}

// ---- Trend text (daily-* history; never draws fake history) ---------------

function aaLoadTrendNote(stats){
  var el = document.getElementById('aa-trend-note');
  if (!el) return;
  var seriesStart = stats && stats.seriesStart;
  // Check the last 7 calendar days by explicit doc id — cheap, bounded, and
  // enough to tell "a real history exists" from "just today's snapshot".
  var days = [];
  for (var i = 0; i < 7; i++) days.push(aaDayKey(i));
  Promise.all(days.map(function (day) {
    return db.collection('adminStats').doc('daily-' + day).get().catch(function () { return { exists: false }; });
  })).then(function (docs) {
    var count = docs.filter(function (d) { return d.exists; }).length;
    if (count >= 2) {
      el.textContent = count + ' days of history stored.';
    } else if (seriesStart) {
      el.textContent = 'Trend starts ' + seriesStart + '.';
    } else {
      el.textContent = '';
    }
  }).catch(function () { el.textContent = ''; });
}

// ---- Range chips -------------------------------------------------------------

function aaWireRangeChips(){
  var chips = document.querySelectorAll('#aa-range-seg [data-range]');
  chips.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var range = btn.getAttribute('data-range');
      AA_STATE.range = range;
      chips.forEach(function (b) { b.classList.toggle('active', b === btn); });
      aaRenderStats();
      aaLoadVisits(range);
    });
  });
}

// ---- H. Refresh now ----------------------------------------------------------

function aaWireRefreshButton(){
  var btn = document.getElementById('aa-refresh-btn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    btn.disabled = true;
    var original = btn.textContent;
    btn.textContent = 'Refreshing\u2026';
    var fns;
    try { fns = firebase.app().functions('us-central1'); } catch (e) { fns = null; }
    if (!fns) {
      btn.textContent = 'Refresh failed';
      setTimeout(function () { btn.textContent = original; btn.disabled = false; }, 2500);
      return;
    }
    fns.httpsCallable('adminStatsRefresh')({})
      .then(function () { return aaLoadStats(); })
      .then(function () {
        btn.textContent = 'Refreshed';
        setTimeout(function () { btn.textContent = original; btn.disabled = false; }, 2000);
      })
      .catch(function (err) {
        console.error('Stryker: adminStatsRefresh failed', err);
        btn.textContent = 'Refresh failed';
        setTimeout(function () { btn.textContent = original; btn.disabled = false; }, 2500);
      });
  });
}

// ---- boot ---------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  var section = document.getElementById('admin-analytics');
  if (!section) return; // not on this page

  aaWireRangeChips();
  aaWireRefreshButton();

  guardAdminPage(function () {
    aaLoadStats().then(function () { aaLoadTrendNote(AA_STATE.stats); });
    aaStartOnlineNowPolling();
    aaLoadRecentSignups();
    aaLoadRecentActivity();
    aaLoadVisits('today');
  });
});

document.addEventListener('visibilitychange', function () {
  // Stop wasting reads on a hidden tab; aaStartOnlineNowPolling's own guard
  // already skips ticks while hidden, this just also pauses the timer outright
  // when the tab has been hidden a long time (tab discarded/backgrounded).
  if (document.visibilityState === 'hidden' && AA_ONLINE_TIMER) {
    clearInterval(AA_ONLINE_TIMER);
    AA_ONLINE_TIMER = null;
  } else if (document.visibilityState === 'visible' && !AA_ONLINE_TIMER && document.getElementById('admin-analytics')) {
    aaStartOnlineNowPolling();
  }
});
