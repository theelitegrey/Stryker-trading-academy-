// TradeZoro — Admin dashboard analytics bento (real data only)
// Depends on: assets/auth.js, assets/progress.js (db), assets/presence.js
//             (PRESENCE_ONLINE_MS), assets/admin-guard.js, assets/admin-charts.js
//             (window.AAC: SVG charts + series builders). Loaded after all.
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
  if (!el) return;
  el.textContent = text;
  // State words ("Unavailable", "No data yet", "n/a") use a smaller style
  // so they never wrap mid-word inside a number-sized tile.
  el.classList.toggle('aa-v-text', /[A-Za-z]{2,}/.test(String(text)) && !/^\$?[\d.,]+%?$/.test(String(text)));
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
  'aa-total-users', 'aa-new-range', 'aa-active-range',
  'aa-paid-conv', 'aa-plan-split', 'aa-mrr', 'aa-mrr-sub', 'aa-completion', 'aa-completion-sub'
];

var AA_STATE = { stats: null, range: 'today' };

function aaFormatPlanSplit(stats){
  if (!stats.byPlan) return '';
  var total = stats.totalUsers || 0;
  var keys = Object.keys(stats.byPlan);
  if (!keys.length || !total) return '';
  return keys.map(function (k) {
    var n = stats.byPlan[k] || 0;
    return (typeof adminPlanLabel === 'function' ? adminPlanLabel(k) : k) + ' ' + Math.round((n / total) * 100) + '%';
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
  // Labels follow the selected chip.
  var newLabel = { today: 'New today', '7d': 'New \u00b7 7 days', '30d': 'New \u00b7 30 days', all: 'Total signups (all)' }[range];
  var activeLabel = { today: 'Active today', '7d': 'Active \u00b7 7 days', '30d': 'Active \u00b7 30 days', all: 'Active (all)' }[range];
  var nl = document.getElementById('aa-new-label'); if (nl) nl.textContent = newLabel;
  var al = document.getElementById('aa-active-label'); if (al) al.textContent = activeLabel;
  aaSet('aa-new-range', (typeof newVal === 'number') ? newVal.toLocaleString() : 'No data yet');
  aaSet('aa-active-range', (typeof activeVal === 'number') ? activeVal.toLocaleString()
    : (range === 'all' ? 'n/a' : 'No data yet'));

  var totalUsers = stats.totalUsers || 0;
  // The conversion card shows PAYING members only. A grant is not a customer,
  // so payingMembers is preferred over the legacy blended `paid` key.
  var paying = (typeof stats.payingMembers === 'number') ? stats.payingMembers : stats.paid;
  if (typeof paying === 'number' && totalUsers) {
    aaSet('aa-paid-conv', Math.round((paying / totalUsers) * 100) + '%');
  } else {
    aaSet('aa-paid-conv', 'No data yet');
  }
  var split = aaFormatPlanSplit(stats);
  aaSet('aa-plan-split', split || '\u2014');

  // MRR always carries its currency, and the comped/expired counts sit beside
  // it so a grant can never be mistaken for revenue.
  aaSet('aa-mrr', (typeof stats.mrr === 'number')
    ? '$' + Math.round(stats.mrr).toLocaleString() + ' ' + (stats.mrrCurrency || 'USD')
    : 'No data yet');
  var mrrBits = [];
  if (typeof stats.payingMembers === 'number') mrrBits.push(stats.payingMembers + ' paying');
  if (stats.freeAccessMembers) mrrBits.push(stats.freeAccessMembers + ' comped');
  if (stats.expiredMembers) mrrBits.push(stats.expiredMembers + ' expired');
  if (stats.mrrUnconvertible) mrrBits.push(stats.mrrUnconvertible + ' unconverted');
  aaSet('aa-mrr-sub', mrrBits.join(' \u00b7 ') || '\u2014');

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
      console.error('TradeZoro: adminStats/current read failed', err);
      AA_STATE.stats = undefined;
      aaRenderStats();
    });
}

// ---- B. Online now (REST aggregation, no SDK change) -----------------------

var AA_ONLINE_TIMER = null;

function aaFetchOnlineNow(){
  if (typeof auth === 'undefined' || !auth || !auth.currentUser) return Promise.resolve(null);
  // Same constant presence.js uses to decide "online"; deliberately no local
  // fallback copy, so the two definitions can never drift apart.
  if (typeof PRESENCE_ONLINE_MS !== 'number') return Promise.reject(new Error('presence.js not loaded'));
  var onlineMs = PRESENCE_ONLINE_MS;
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
    var v = row && row.result.aggregateFields && row.result.aggregateFields.n && row.result.aggregateFields.n.integerValue;
    // A count aggregation always answers with a row; anything else is a
    // malformed reply, which must read "Unavailable", never a made-up 0.
    if (v === undefined || v === null || isNaN(Number(v))) throw new Error('runAggregationQuery: no count in reply');
    return Number(v);
  });
}

// Online dot is green only when a real count came back; neutral grey while
// loading ("…"), on "Unavailable" and on "No data yet".
function aaSetOnline(text, live){
  aaSet('aa-online-now', text);
  var dot = document.getElementById('aa-online-dot');
  if (dot) dot.classList.toggle('is-live', !!live);
}

function aaRefreshOnlineNow(){
  return aaFetchOnlineNow().then(function (n) {
    if (n === null) aaSetOnline('No data yet', false);
    else aaSetOnline(n.toLocaleString(), true);
  }).catch(function (err) {
    console.error('TradeZoro: online-now aggregation failed', err);
    aaSetOnline('Unavailable', false);
  });
}

function aaStartOnlineNowPolling(){
  aaSetOnline('\u2026', false);
  aaLiveTick();
  if (AA_ONLINE_TIMER) clearInterval(AA_ONLINE_TIMER);
  AA_ONLINE_TIMER = setInterval(function () {
    if (document.visibilityState === 'visible') aaLiveTick();
  }, AAC_LIVE_MS);
}

// ---- B2. Live panel (every 30 s): online sparkline, who, hub, today counts ---

var AAC_LIVE_MS = 30000;
var AAC_SAMPLES_KEY = 'tz_admin_online_samples';
var AAC_LIVE = { at: 0, agoTimer: null };
var AAC_HUB_URL = 'https://book-recorder.theelitegrey.workers.dev/ts-health';

// Firestore REST helpers (same token path as the online-now aggregation).
function aacRest(op, body){
  if (typeof auth === 'undefined' || !auth || !auth.currentUser) return Promise.reject(new Error('signed out'));
  var url = 'https://firestore.googleapis.com/v1/projects/' + STRYKER_PROJECT_ID + '/databases/(default)/documents:' + op;
  return auth.currentUser.getIdToken().then(function (t) {
    return fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }).then(function (r) {
    if (!r.ok) throw new Error(op + ' HTTP ' + r.status);
    return r.json();
  });
}
function aacVal(v){
  if (!v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  return null;
}
function aacCount(collectionId, field, op, value){
  return aacRest('runAggregationQuery', { structuredAggregationQuery: {
    structuredQuery: { from: [{ collectionId: collectionId }], where: { fieldFilter: { field: { fieldPath: field }, op: op, value: value } } },
    aggregations: [{ alias: 'n', count: {} }] } }).then(function (rows) {
    var row = Array.isArray(rows) ? rows.find(function (r) { return r && r.result; }) : null;
    var v = row && row.result.aggregateFields && row.result.aggregateFields.n && row.result.aggregateFields.n.integerValue;
    if (v === undefined || isNaN(Number(v))) throw new Error('count: no value');
    return Number(v);
  });
}
// Orders since a time, money fields only (no names/emails), bounded.
function aacOrdersSince(ms, cap){
  return aacRest('runQuery', { structuredQuery: {
    from: [{ collectionId: 'orders' }],
    select: { fields: ['finalAmount', 'currency', 'amountUsd', 'createdAt', 'kind', 'status', 'gateway', 'studentUid'].map(function (f) { return { fieldPath: f }; }) },
    where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: new Date(ms).toISOString() } } },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    limit: cap } }).then(function (rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || !r.document) return;
      var f = r.document.fields || {};
      out.push({ finalAmount: aacVal(f.finalAmount), currency: aacVal(f.currency), amountUsd: aacVal(f.amountUsd), ms: aacVal(f.createdAt),
        kind: aacVal(f.kind), status: aacVal(f.status), gateway: aacVal(f.gateway), uid: aacVal(f.studentUid) });
    });
    out.capped = out.length >= cap;
    return out;
  });
}

function aacSamples(){
  try { return JSON.parse(sessionStorage.getItem(AAC_SAMPLES_KEY) || '[]').filter(function (s) { return s && Date.now() - s.t < 3600000; }); }
  catch (e) { return []; }
}
function aacPushSample(n){
  var s = aacSamples(); s.push({ t: Date.now(), n: n });
  try { sessionStorage.setItem(AAC_SAMPLES_KEY, JSON.stringify(s)); } catch (e) {}
  return s;
}
function aacDrawSpark(){
  var host = document.getElementById('aac-online-spark');
  var note = document.getElementById('aac-spark-note');
  if (!host) return;
  var s = aacSamples();
  var vals = s.map(function (x) { return x.n; });
  AAC.sparkline(host, vals, 'Online now over the last 60 minutes: ' + (vals.length ? vals.join(', ') : 'no samples yet'));
  if (note) note.textContent = s.length < 2
    ? 'Sampling every 30 s while this page is open. The line starts after 2 samples.'
    : 'Last 60 min \u00b7 ' + s.length + ' samples since ' + AAC.fmtTimeIST(s[0].t) + ' IST \u00b7 peak ' + Math.max.apply(null, vals);
}

function aacRenderWho(rows){
  var ul = document.getElementById('aac-online-list');
  if (!ul) return;
  if (!rows) { ul.innerHTML = '<li class="aac-empty">Unavailable</li>'; return; }
  if (!rows.length) { ul.innerHTML = '<li class="aac-empty">Nobody online right now</li>'; return; }
  ul.innerHTML = rows.map(function (r) {
    return '<li><span class="aac-who-n">' + aaEsc(r.name || 'Trader') + '</span><span class="aac-who-p">' + aaEsc(r.page || '\u2014') + '</span></li>';
  }).join('');
}
function aacLoadWho(){
  var cutoff = new Date(Date.now() - PRESENCE_ONLINE_MS);
  return db.collection('presence').where('lastSeen', '>', cutoff).orderBy('lastSeen', 'desc').limit(50).get()
    .then(function (snap) {
      var out = [];
      snap.forEach(function (d) { var x = d.data(); out.push({ name: x.name, page: x.page }); });
      aacRenderWho(out);
    }).catch(function (err) { console.error('TradeZoro: who-online read failed', err); aacRenderWho(null); });
}

function aacLoadHub(){
  return fetch(AAC_HUB_URL, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('ts-health HTTP ' + r.status);
    return r.json();
  }).then(function (h) {
    if (typeof h.clients !== 'number') throw new Error('ts-health: no clients');
    aaSet('aac-hub', h.clients.toLocaleString());
    var bits = [];
    if (typeof h.bookClients === 'number') bits.push(h.bookClients + ' on the L2 book');
    bits.push(h.cmeOpen ? 'CME open' : 'CME closed');
    aaSet('aac-hub-sub', bits.join(' \u00b7 '));
  }).catch(function (err) {
    console.warn('TradeZoro: futures hub health unreachable', err);
    aaSet('aac-hub', 'Unavailable'); aaSet('aac-hub-sub', '');
  });
}

function aacLoadToday(){
  var since = AAC.istMidnightMs(Date.now());
  var p1 = aacCount('students', 'createdAt', 'GREATER_THAN_OR_EQUAL', { timestampValue: new Date(since).toISOString() })
    .then(function (n) { aaSet('aac-signups-today', n.toLocaleString()); })
    .catch(function (err) { console.error('TradeZoro: signups-today count failed', err); aaSet('aac-signups-today', 'Unavailable'); });
  var p2 = aacOrdersSince(since, 500).then(function (orders) {
    var b = AAC.bucketOrders(orders, Date.now(), 1);
    var t = b.by[b.keys[0]];
    aaSet('aac-payments-today', t.payments.toLocaleString() + (orders.capped ? '+' : ''));
    aaSet('aac-payments-sub', t.payments ? ('$' + t.usd.toLocaleString() + ' USD' + (t.unconverted ? ' \u00b7 ' + t.unconverted + ' unconverted' : '')) : '');
    aaSet('aac-trials-today', t.trials.toLocaleString());
  }).catch(function (err) {
    console.error('TradeZoro: orders-today query failed', err);
    aaSetUnavailable(['aac-payments-today', 'aac-trials-today']); aaSet('aac-payments-sub', '');
  });
  return Promise.all([p1, p2]);
}

function aacTickAgo(){
  var el = document.getElementById('aac-live-ago');
  if (!el) return;
  if (!AAC_LIVE.at) { el.textContent = 'Updating\u2026'; return; }
  var s = Math.max(0, Math.round((Date.now() - AAC_LIVE.at) / 1000));
  el.textContent = 'Updated ' + (s < 2 ? 'just now' : s + ' s ago') + ' \u00b7 every 30 s';
}

function aaLiveTick(){
  if (!AAC_LIVE.agoTimer) AAC_LIVE.agoTimer = setInterval(function () { if (document.visibilityState === 'visible') aacTickAgo(); }, 1000);
  var online = aaFetchOnlineNow().then(function (n) {
    if (n === null) { aaSetOnline('No data yet', false); return; }
    aaSetOnline(n.toLocaleString(), true);
    aacPushSample(n);
  }).catch(function (err) {
    console.error('TradeZoro: online-now aggregation failed', err);
    aaSetOnline('Unavailable', false);
  }).then(aacDrawSpark);
  return Promise.all([online, aacLoadWho(), aacLoadHub(), aacLoadToday()]).then(function () {
    AAC_LIVE.at = Date.now(); aacTickAgo();
  });
}

// ---- B3. Trend charts ---------------------------------------------------------

var AAC = window.AAC;
var AAC_T = { range: '30d', daily: {}, dailyFailed: 0, dailyAsked: 0, orders: null, ordersFailed: false, loaded: {} };
var AAC_ORDER_DAYS = 90;

function aacToday(){ return AAC.utcDayKey(Date.now()); }

// Reads daily-<key> docs by id (never a collection scan); only keys not read yet.
function aacLoadDaily(keys){
  var need = keys.filter(function (k) { return !(k in AAC_T.loaded); });
  return Promise.all(need.map(function (k) {
    AAC_T.dailyAsked++;
    return db.collection('adminStats').doc('daily-' + k).get().then(function (d) {
      AAC_T.loaded[k] = true;
      if (d.exists) AAC_T.daily[k] = d.data();
    }).catch(function () { AAC_T.dailyFailed++; });
  }));
}

function aacLoadOrders(){
  var since = AAC.istMidnightMs(Date.now()) - (AAC_ORDER_DAYS - 1) * 86400000;
  return aacOrdersSince(since, 5000).then(function (o) { AAC_T.orders = o; AAC_T.ordersFailed = false; })
    .catch(function (err) { console.error('TradeZoro: 90-day orders query failed', err); AAC_T.orders = null; AAC_T.ordersFailed = true; });
}

function aacCard(id){ var c = document.getElementById(id); if (c) { c.className = ''; c.innerHTML = ''; } return c; }
function aacTitle(id){ var c = document.getElementById(id); return (c && c.getAttribute('data-title')) || ''; }

// A daily-snapshot chart: never drawn from fewer than 2 stored snapshots.
function aacDailyChart(id, title, keys, series, opts){
  var card = aacCard(id); if (!card) return;
  opts = opts || {};
  var vals = series.map(function (s) { return AAC.dailySeries(AAC_T.daily, keys, s.pick); });
  var real = Math.max.apply(null, vals.map(AAC.realCount));
  if (!real && AAC_T.dailyAsked && AAC_T.dailyFailed >= AAC_T.dailyAsked) return AAC.state(card, title, 'Unavailable');
  if (real < 2) {
    return AAC.state(card, title, real === 1
      ? '1 daily snapshot so far. A trend needs 2; this fills in from ' + (opts.since || 'the next snapshot') + '.'
      : (opts.empty || 'No data yet. Recorded by the hourly snapshot from now on.'));
  }
  var last = null;
  for (var i = keys.length - 1; i >= 0 && last === null; i--) if (vals[0][i] !== null) last = vals[0][i];
  var fmt = opts.fmt || AAC.num;
  AAC.xy(card, {
    title: title, kind: opts.kind || 'line',
    value: opts.value !== undefined ? opts.value : (last === null ? undefined : fmt(last)),
    sub: opts.sub,
    labels: keys, short: AAC.shortDay,
    tips: keys.map(function (k) {
      var d = AAC_T.daily[k], g = d && d.generatedAt && d.generatedAt.toMillis ? d.generatedAt.toMillis() : null;
      return AAC.shortDay(k) + ' ' + k.slice(0, 4) + (g ? ' \u00b7 snapshot ' + AAC.fmtIST(g) : '');
    }),
    series: series.map(function (s, j) { return { name: s.name, cls: s.cls || ('aac-c' + (j + 1)), values: vals[j] }; }),
    fmt: fmt, axisFmt: opts.axisFmt,
    csv: { name: id.replace('aac-c-', ''), header: ['date_utc'].concat(series.map(function (s) { return s.name; })),
      rows: keys.map(function (k, i) { return [k].concat(vals.map(function (v) { return v[i] === null ? '' : v[i]; })); }) }
  });
}

function aacPaying(d){ return typeof d.payingMembers === 'number' ? d.payingMembers : d.paid; }
function aacUsdFmt(v){ return '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function aacAxisCompact(v){ return v >= 1000 ? (Math.round(v / 100) / 10) + 'k' : String(Math.round(v * 10) / 10); }

function aacRenderUsers(keys){
  aacDailyChart('aac-c-total', 'Total users', keys, [{ name: 'Total users', pick: function (d) { return d.totalUsers; } }], { axisFmt: aacAxisCompact });
  aacDailyChart('aac-c-new', 'New signups per day', keys, [{ name: 'New signups', pick: function (d) { return d.new1; } }], { kind: 'bar', axisFmt: aacAxisCompact,
    sub: 'New users dated that UTC day' });
  aacDailyChart('aac-c-active', 'Active users', keys, [
    { name: 'DAU', pick: function (d) { return d.active1; } },
    { name: 'WAU', pick: function (d) { return d.active7; } },
    { name: 'MAU', pick: function (d) { return d.active30; } }], { axisFmt: aacAxisCompact, value: null });
  aacDailyChart('aac-c-freepaid', 'Free vs paying', keys, [
    { name: 'Paying', cls: 'aac-c1', pick: function (d) { return aacPaying(d); } },
    { name: 'Free and comped', cls: 'aac-c5', pick: function (d) { var p = aacPaying(d); return (typeof d.totalUsers === 'number' && typeof p === 'number') ? d.totalUsers - p : null; } }],
    { kind: 'area', axisFmt: aacAxisCompact, value: null });
  aacDailyChart('aac-c-conv', 'Paid conversion', keys, [{ name: 'Paying / total', pick: function (d) {
    var p = aacPaying(d); return (typeof p === 'number' && d.totalUsers) ? Math.round((p / d.totalUsers) * 1000) / 10 : null; } }],
    { fmt: function (v) { return v + '%'; }, axisFmt: function (v) { return (Math.round(v * 10) / 10) + '%'; } });
  aacDailyChart('aac-c-peak', 'Online peak per day', keys, [{ name: 'Peak online (hourly samples)', pick: function (d) { return d.onlinePeak; } }],
    { since: 'tomorrow', empty: 'No data yet. The hourly snapshot records this from today.', sub: 'Highest of the hourly online-now samples' });
}

function aacOrderKeys(keys){
  // Orders are IST days; the range picks how many of the 90 fetched days to show.
  var n = Math.min(AAC_ORDER_DAYS, keys.length);
  var b = AAC.bucketOrders(AAC_T.orders || [], Date.now(), AAC_ORDER_DAYS);
  return { keys: b.keys.slice(-n), by: b.by };
}

function aacOrderChart(id, title, ok, series, opts){
  var card = aacCard(id); if (!card) return;
  if (AAC_T.ordersFailed) return AAC.state(card, title, 'Unavailable');
  if (!AAC_T.orders) return AAC.state(card, title, '\u2026');
  var b = ok;
  var vals = series.map(function (s) { return b.keys.map(function (k) { return s.pick(b.by[k]); }); });
  var tot = vals.map(function (v) { return v.reduce(function (a, x) { return a + x; }, 0); });
  // A real, answered zero: say so in words instead of drawing an empty axis.
  if (!tot.some(function (x) { return x > 0; })) return AAC.state(card, title, opts.none + ' in the last ' + b.keys.length + ' days (IST).');
  AAC.xy(card, {
    title: title, kind: 'bar', value: opts.value(tot), sub: opts.sub + (AAC_T.orders.capped ? ' \u00b7 capped at 5,000 orders' : ''),
    labels: b.keys, short: AAC.shortDay, tips: b.keys.map(function (k) { return AAC.shortDay(k) + ' ' + k.slice(0, 4) + ' (IST day)'; }),
    series: series.map(function (s, j) { return { name: s.name, cls: s.cls || ('aac-c' + (j + 1)), values: vals[j] }; }),
    fmt: opts.fmt, axisFmt: opts.axisFmt || aacAxisCompact,
    csv: { name: id.replace('aac-c-', ''), header: ['date_ist'].concat(series.map(function (s) { return s.name; })),
      rows: b.keys.map(function (k, i) { return [k].concat(vals.map(function (v) { return v[i]; })); }) }
  });
}

function aacRenderMoney(keys){
  aacDailyChart('aac-c-mrr', 'MRR (USD)', keys, [{ name: 'MRR', pick: function (d) { return d.mrr; } }],
    { fmt: aacUsdFmt, axisFmt: function (v) { return '$' + aacAxisCompact(v); }, sub: 'Paying members only, from the daily snapshot' });
  var ok = aacOrderKeys(keys);
  var span = ok.keys.length + ' days';
  aacOrderChart('aac-c-usd', 'Collected per day (USD)', ok, [{ name: 'Collected USD', pick: function (x) { return x.usd; } }],
    { none: 'No collected USD', value: function (t) { return aacUsdFmt(Math.round(t[0] * 100) / 100); }, sub: 'Total in the last ' + span + '; foreign orders without a USD amount are left out',
      fmt: aacUsdFmt, axisFmt: function (v) { return '$' + aacAxisCompact(v); } });
  aacOrderChart('aac-c-payments', 'Payments per day', ok, [{ name: 'Payments', pick: function (x) { return x.payments; } }],
    { none: 'No paid orders', value: function (t) { return t[0].toLocaleString(); }, sub: 'Paid orders in the last ' + span + ' (trials, coupons and refunds excluded)' });
  aacOrderChart('aac-c-trials', 'Trials started vs converted', ok, [
    { name: 'Started', cls: 'aac-c2', pick: function (x) { return x.trials; } },
    { name: 'Converted', cls: 'aac-c1', pick: function (x) { return x.converted; } }],
    { none: 'No trials started', value: function (t) { return t[0] ? (t[1] + ' of ' + t[0] + ' converted') : '0 trials'; }, sub: 'By the day the trial started; converted = a later paid order in this window' });
  var card = aacCard('aac-c-planmix');
  var st = AA_STATE.stats;
  if (st === undefined) AAC.state(card, 'Plan mix', 'Unavailable');
  else if (!st || !st.byPlan || !Object.keys(st.byPlan).length) AAC.state(card, 'Plan mix', 'No data yet');
  else {
    var items = Object.keys(st.byPlan).map(function (k) {
      return { name: typeof adminPlanLabel === 'function' ? adminPlanLabel(k) : k, value: st.byPlan[k] || 0 };
    }).sort(function (a, b) { return b.value - a.value; });
    AAC.donut(card, { title: 'Plan mix', centerLabel: 'users', items: items, sub: 'Plan label on each account (labels are not payments)',
      csv: { name: 'plan-mix', header: ['plan', 'users'], rows: items.map(function (i) { return [i.name, i.value]; }) } });
  }
}

function aacStatCard(id, title, value, sub, rows){
  var card = aacCard(id);
  if (value === null || value === undefined) return AAC.state(card, title, AA_STATE.stats === undefined ? 'Unavailable' : 'No data yet. Recorded by the hourly snapshot from now on.');
  AAC.hbars(card, { title: title, value: value, sub: sub, items: rows || [],
    csv: { name: id.replace('aac-c-', ''), header: ['item', 'count'], rows: (rows || []).map(function (r) { return [r.name, r.value]; }) } });
}

function aacRenderEngagement(keys){
  var st = AA_STATE.stats;
  var card = aacCard('aac-c-funnel');
  if (st === undefined) AAC.state(card, 'Chapter completion', 'Unavailable');
  else if (!st || !st.chapterCompletions || !Object.keys(st.chapterCompletions).length) AAC.state(card, 'Chapter completion', 'No data yet');
  else {
    var titles = st.chapterTitles || {};
    var ids = Object.keys(st.chapterCompletions).sort(function (a, b) { return Number(a) - Number(b) || (a < b ? -1 : 1); });
    var items = ids.map(function (i) { return { name: 'Ch ' + i, value: st.chapterCompletions[i] || 0, tip: 'Chapter ' + i + ': ' + (titles[i] || '') }; });
    AAC.hbars(card, { title: 'Chapter completion', scroll: items.length > 10, items: items,
      value: (typeof st.startedCount === 'number' ? st.startedCount.toLocaleString() + ' started' : undefined),
      sub: 'Members who completed each chapter, in course order',
      csv: { name: 'chapter-completion', header: ['chapter', 'title', 'completions'], rows: ids.map(function (i) { return ['Ch ' + i, titles[i] || '', st.chapterCompletions[i] || 0]; }) } });
  }
  aacDailyChart('aac-c-alerts', 'Chart alerts', keys, [
    { name: 'Alerts stored', cls: 'aac-c2', pick: function (d) { return d.chartAlertsTotal; } },
    { name: 'Alerts fired (distinct)', cls: 'aac-c3', pick: function (d) { return d.alertFiresTotal; } }],
    { since: 'tomorrow', axisFmt: aacAxisCompact, value: (st && typeof st.chartAlertsTotal === 'number') ? st.chartAlertsTotal.toLocaleString() + ' stored' : undefined,
      empty: 'No data yet. The hourly snapshot records alert totals from today.', sub: 'Running totals; the daily change is alerts created / fired' });
  aacDailyChart('aac-c-push', 'Push-enabled devices', keys, [{ name: 'Devices', pick: function (d) { return d.pushDevices; } }],
    { since: 'tomorrow', axisFmt: aacAxisCompact, value: (st && typeof st.pushDevices === 'number') ? st.pushDevices.toLocaleString() : undefined,
      empty: (st && typeof st.pushDevices === 'number') ? st.pushDevices.toLocaleString() + ' devices now. The daily line starts tomorrow.' : 'No data yet. Recorded by the hourly snapshot from today.' });
  var sup = st && typeof st.supportOpen === 'number' ? st.supportOpen : null;
  aacStatCard('aac-c-support', 'Support tickets open', sup === null ? null : sup.toLocaleString(), 'Not closed', sup === null ? [] : [
    { name: 'Waiting for support', value: st.supportWaitingSupport || 0 },
    { name: 'Waiting for member', value: st.supportWaitingMember || 0 }]);
  var sg = st && st.suggestionsByStatus;
  var SG = [['new', 'New'], ['review', 'Under review'], ['planned', 'Planned'], ['progress', 'In progress'], ['shipped', 'Shipped'], ['declined', 'Not planned']];
  var sgRows = sg ? SG.filter(function (x) { return typeof sg[x[0]] === 'number'; }).map(function (x) { return { name: x[1], value: sg[x[0]] }; }) : [];
  aacStatCard('aac-c-sugg', 'Suggestions by status', sgRows.length ? sgRows.reduce(function (a, r) { return a + r.value; }, 0).toLocaleString() : null, 'All suggestions', sgRows);
}

function aacRenderAll(){
  var st = AA_STATE.stats;
  var keys = AAC.rangeKeys(AAC_T.range, aacToday(), st && st.seriesStart);
  if (!keys.length) keys = [aacToday()];
  aacRenderUsers(keys);
  aacRenderMoney(keys);
  aacRenderEngagement(keys);
}

function aacLoadTrends(){
  var st = AA_STATE.stats;
  var keys = AAC.rangeKeys(AAC_T.range === 'all' ? 'all' : '90d', aacToday(), st && st.seriesStart);
  ['aac-c-total', 'aac-c-new', 'aac-c-active', 'aac-c-freepaid', 'aac-c-conv', 'aac-c-peak', 'aac-c-mrr', 'aac-c-usd',
   'aac-c-payments', 'aac-c-trials', 'aac-c-planmix', 'aac-c-funnel', 'aac-c-alerts', 'aac-c-push', 'aac-c-support', 'aac-c-sugg']
    .forEach(function (id) { var c = aacCard(id); if (c) AAC.state(c, c.getAttribute('data-title') || '', '\u2026'); });
  return Promise.all([aacLoadDaily(keys), AAC_T.orders ? null : aacLoadOrders()]).then(aacRenderAll);
}

function aacWireTrendRange(){
  var btns = document.querySelectorAll('#aac-range-seg [data-range]');
  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      AAC_T.range = b.getAttribute('data-range');
      btns.forEach(function (x) { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      var st = AA_STATE.stats;
      if (AAC_T.range === 'all') aacLoadDaily(AAC.rangeKeys('all', aacToday(), st && st.seriesStart)).then(aacRenderAll);
      else aacRenderAll();
    });
  });
}

// ---- C. Recent signups -------------------------------------------------------

function aaRenderRecentSignups(students){
  var wrap = document.getElementById('aa-recent-signups');
  if (!wrap) return;
  if (!students) { wrap.innerHTML = '<p class="aa-empty">Unavailable</p>'; return; }
  if (!students.length) { wrap.innerHTML = '<p class="aa-empty">No data yet</p>'; return; }
  wrap.innerHTML = students.map(function (s) {
    var name = s.displayName || (s.email ? s.email.split('@')[0] : 'Unnamed');
    var plan = s.plan ? (typeof adminPlanLabel === 'function' ? adminPlanLabel(s.plan) : s.plan) : 'Free';
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
      snap.forEach(function (d) { if (!d.data().test) out.push(Object.assign({ uid: d.id }, d.data())); });
      aaRenderRecentSignups(out);
      return out;
    })
    .catch(function (err) {
      console.error('TradeZoro: recent signups query failed', err);
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
      console.error('TradeZoro: recent activity query failed', err);
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

// Only the newest aaLoadVisits call may write the card. "30d" issues 30 reads
// and "Today" one, so a later Today answer used to be overwritten when the
// earlier 30d batch finally settled. Every write path below (total, "No data
// yet"/"Unavailable", and the catch) bails out when a newer call has started.
var aaVisitsSeq = 0;

function aaLoadVisits(range){
  var my = ++aaVisitsSeq;
  var wrap = document.getElementById('aa-visits-body');
  if (wrap) wrap.innerHTML = '<div class="v">\u2026</div><div class="l">Visits (site-wide day totals)</div>';
  var days = aaDaysForRange(range || 'today');
  var failed = 0;
  return Promise.all(days.map(function (day) {
    return db.collection('traffic').doc(day).get().catch(function () { failed++; return { exists: false }; });
  })).then(function (docs) {
    if (my !== aaVisitsSeq) return; // a newer range was picked while these reads were in flight
    var found = docs.filter(function (d) { return d.exists; });
    if (!found.length) {
      // Every read failing is an outage; reads that succeeded and found no
      // doc mean nothing has been counted for those days yet.
      var msg = failed === days.length ? 'Unavailable' : 'No data yet';
      if (wrap) wrap.innerHTML = '<div class="v aa-v-text">' + msg + '</div><div class="l">Visits (site-wide day totals)</div>';
      return;
    }
    var total = found.reduce(function (acc, d) {
      var v = d.data().visits;
      return acc + (typeof v === 'number' ? v : 0);
    }, 0);
    if (wrap) {
      var span = range === 'all' ? 'last 30 days' : (days.length === 1 ? 'today' : 'last ' + days.length + ' days');
      wrap.innerHTML = '<div class="v">' + total.toLocaleString() + '</div>' +
        '<div class="l">Visits (site-wide day totals)</div>' +
        '<div class="sub">' + span + ' \u00b7 ' + found.length + ' of ' + days.length + ' day' + (days.length === 1 ? '' : 's') + ' with data' +
        (failed ? ' \u00b7 ' + failed + ' unreadable' : '') + '</div>';
    }
  }).catch(function (err) {
    // A stale request that rejects late must not flip a newer answer to
    // "Unavailable"; still log it, so a real outage stays visible.
    console.error('TradeZoro: visits read failed', err);
    if (my !== aaVisitsSeq) return;
    if (wrap) wrap.innerHTML = '<div class="v aa-v-text">Unavailable</div><div class="l">Visits (site-wide day totals)</div>';
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
        aaLoadTrendNote(AA_STATE.stats);
        delete AAC_T.loaded[aacToday()];
        AAC_T.orders = null;
        aacLoadTrends();
        btn.textContent = 'Refreshed';
        setTimeout(function () { btn.textContent = original; btn.disabled = false; }, 2000);
      })
      .catch(function (err) {
        console.error('TradeZoro: adminStatsRefresh failed', err);
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
  aacWireTrendRange();

  guardAdminPage(function () {
    aaLoadStats().then(function () { aaLoadTrendNote(AA_STATE.stats); return aacLoadTrends(); });
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
