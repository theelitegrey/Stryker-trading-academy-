// Stryker Trading Academy — Admin overview: recent students, stat cards,
// chapter engagement.
// Depends on: assets/auth.js, assets/progress.js (for `db`), assets/admin-guard.js
//
// Historically this pulled every student doc to compute all three panels in
// the browser. That does not scale (cost + load time grow with every signup,
// and it ships every student's PII to the browser to render four numbers).
// Stat cards and chapter engagement now read the adminStats/current snapshot
// written by the adminStatsRefresh Cloud Function; the visible student list
// is its own small bounded query. There is no unbounded students.get() left
// in this file.

function renderRecentStudents(students){
  const list = document.getElementById('recent-students-list');
  if (!list) return;

  if (students === null) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">Unavailable</p>';
    return;
  }
  if (!students.length) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">No students yet.</p>';
    return;
  }

  // Already ordered by createdAt desc from the query, capped to 5 there too.
  list.innerHTML = '';
  students.forEach((s) => {
    const name = s.displayName || (s.email ? s.email.split('@')[0] : 'Unnamed');
    const doneCount = s.completedChapters ? s.completedChapters.length : 0;
    const row = document.createElement('div');
    row.className = 'record-card';
    row.innerHTML =
      '<div class="cell-user">' + (typeof avatarImgHtml === 'function' ? avatarImgHtml(s.uid, name, s, 36) : '<div class="cell-avatar"></div>') + '<div><span class="cell-name">' + stkEsc(name) + '</span><span class="cell-sub">' + stkEsc(s.email || '—') + '</span></div></div>' +
      '<div class="record-stats">' +
        '<div class="record-stat"><span class="rs-label">Progress</span><span class="rs-val">' + doneCount + ' / 42 core chapters</span></div>' +
        '<div class="record-stat"><span class="rs-label">Streak</span><span class="rs-val">' + (s.currentStreak || 0) + ' day' + ((s.currentStreak || 0) === 1 ? '' : 's') + '</span></div>' +
      '</div>';
    list.appendChild(row);
  });
}

// ---- Headline stats -------------------------------------------------------
// Every figure here comes from the adminStats/current snapshot (written by
// the adminStatsRefresh Cloud Function), never from a client-side scan.
// Missing/loading/failed states are distinct so a "—" never gets mistaken
// for a real zero.

function renderAdminStats(stats, sessions){
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  if (stats === undefined) {
    ['stat-students', 'stat-mrr', 'stat-completion'].forEach((id) => set(id, 'Unavailable'));
  } else if (stats === null) {
    ['stat-students', 'stat-mrr', 'stat-completion'].forEach((id) => set(id, 'No data yet'));
  } else {
    set('stat-students', (typeof stats.totalUsers === 'number') ? stats.totalUsers.toLocaleString() : 'No data yet');
    set('stat-mrr', (typeof stats.mrr === 'number') ? '$' + Math.round(stats.mrr).toLocaleString() : 'No data yet');
    set('stat-completion', (typeof stats.avgCompletion === 'number') ? stats.avgCompletion + '%' : 'No data yet');
  }

  // Upcoming sessions still comes from its own small collection — the order
  // said this can stay if the collection is small, and liveSessions is.
  if (sessions === undefined) {
    set('stat-sessions', 'Unavailable');
  } else {
    const now = Date.now();
    const upcoming = sessions.filter((v) => {
      const t = v.startsAt && v.startsAt.toMillis ? v.startsAt.toMillis() : 0;
      return t > now;
    }).length;
    set('stat-sessions', String(upcoming));
  }
}

function renderChapterEngagement(stats){
  const wrap = document.getElementById('chapter-engagement');
  if (!wrap) return;

  if (stats === undefined) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13px; padding:6px 0;">Unavailable</p>';
    return;
  }
  if (stats === null || !stats.chapterCompletions || !stats.totalUsers) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13px; padding:6px 0;">No data yet</p>';
    return;
  }

  const titles = stats.chapterTitles || {};
  const comps = stats.chapterCompletions || {};
  const total = stats.totalUsers;
  const rows = Object.keys(comps).map((id) => {
    const done = comps[id] || 0;
    return { id, title: titles[id] || ('Chapter ' + id), pct: Math.round((done / total) * 100) };
  });

  // Busiest five: a full 42-row list would bury the panel it lives in.
  rows.sort((a, b) => b.pct - a.pct);
  const top = rows.slice(0, 5);

  if (!top.length || top[0].pct === 0) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13px; padding:6px 0;">No chapters completed yet.</p>';
    return;
  }

  wrap.innerHTML = top.map((c) =>
    '<div class="mini-bar-row">' +
      '<span class="label">' + escapeOverviewText(String(c.id).padStart(2, '0') + ' ' + c.title) + '</span>' +
      '<div class="mini-bar-track"><div class="mini-bar-fill" style="width:' + c.pct + '%"></div></div>' +
      '<span class="mini-bar-val">' + c.pct + '%</span>' +
    '</div>'
  ).join('');
}

function escapeOverviewText(v){
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('recent-students-list');
  if (!list) return; // not on this page

  guardAdminPage(() => {
    // One parallel batch rather than sequential reads. Each source resolves
    // independently so one broken query degrades a single panel instead of
    // blanking the whole dashboard. Recent students is a bounded top-5 query
    // (not a scan); stats + chapter engagement come from the adminStats
    // snapshot, not from students at all.
    Promise.all([
      db.collection('students').orderBy('createdAt', 'desc').limit(5).get()
        .then((snap) => { const out = []; snap.forEach((doc) => out.push(Object.assign({ uid: doc.id }, doc.data()))); return out; })
        .catch((err) => { console.error('Stryker: recent students query failed', err); return null; }),
      db.collection('adminStats').doc('current').get()
        .then((doc) => (doc.exists ? doc.data() : null))
        .catch((err) => { console.error('Stryker: adminStats/current read failed', err); return undefined; }),
      db.collection('liveSessions').get()
        .then((snap) => { const out = []; snap.forEach((doc) => out.push(doc.data())); return out; })
        .catch((err) => { console.error('Stryker: liveSessions read failed', err); return undefined; })
    ]).then(([students, stats, sessions]) => {
      renderRecentStudents(students);
      renderAdminStats(stats, sessions);
      renderChapterEngagement(stats);
    });
  });
});
