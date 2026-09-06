// Stryker Trading Academy — Admin overview: recent students preview
// Depends on: assets/auth.js, assets/progress.js (for `db`), assets/admin-guard.js

function renderRecentStudents(students){
  const list = document.getElementById('recent-students-list');
  if (!list) return;

  if (!students.length) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">No students yet.</p>';
    return;
  }

  // Most recently created first, capped to 5 for this preview panel.
  const sorted = students.slice().sort((a, b) => {
    const at = (a.createdAt && a.createdAt.toMillis) ? a.createdAt.toMillis() : 0;
    const bt = (b.createdAt && b.createdAt.toMillis) ? b.createdAt.toMillis() : 0;
    return bt - at;
  }).slice(0, 5);

  list.innerHTML = '';
  sorted.forEach((s) => {
    const name = s.displayName || (s.email ? s.email.split('@')[0] : 'Unnamed');
    const doneCount = s.completedChapters ? s.completedChapters.length : 0;
    const row = document.createElement('div');
    row.className = 'record-card';
    row.innerHTML =
      '<div class="cell-user">' + (typeof avatarImgHtml === 'function' ? avatarImgHtml(s.uid, name, s, 36) : '<div class="cell-avatar"></div>') + '<div><span class="cell-name">' + name + '</span><span class="cell-sub">' + (s.email || '—') + '</span></div></div>' +
      '<div class="record-stats">' +
        '<div class="record-stat"><span class="rs-label">Progress</span><span class="rs-val">' + doneCount + ' / 42 chapters</span></div>' +
        '<div class="record-stat"><span class="rs-label">Streak</span><span class="rs-val">' + (s.currentStreak || 0) + ' day' + ((s.currentStreak || 0) === 1 ? '' : 's') + '</span></div>' +
      '</div>';
    list.appendChild(row);
  });
}


// ---- Headline stats -------------------------------------------------------
// Every figure here was previously hardcoded in the markup — 18,412 students,
// $61,940 MRR, a -1.4% trend. Impressive-looking placeholders are worse than
// no number at all on an admin panel: they are indistinguishable from real
// data, so a decision could be made on them.
//
// The percentage deltas are gone rather than faked. A trend needs a stored
// historical snapshot to compare against, and nothing records one — inventing
// a movement would repeat exactly the mistake being fixed.

function renderAdminStats(students, plans, sessions, chapters){
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  set('stat-students', students.length.toLocaleString());

  // MRR: sum each student's plan price. Only plans priced above zero count,
  // so the free entry tier every account now defaults to doesn't inflate it.
  const priceByName = {};
  plans.forEach((p) => {
    const price = parseFloat(String(p.price || '0').replace(/[^0-9.]/g, '')) || 0;
    if (p.name) priceByName[String(p.name).toLowerCase()] = price;
  });
  let mrr = 0;
  students.forEach((s) => {
    if (!s.plan) return;
    mrr += priceByName[String(s.plan).toLowerCase()] || 0;
  });
  set('stat-mrr', '$' + Math.round(mrr).toLocaleString());

  // Average completion across students who have started at least one chapter.
  // Including everyone who has never opened a lesson would drag this toward
  // zero and say more about signup volume than about the curriculum.
  const total = chapters.length || 42;
  const started = students.filter((s) => (s.completedChapters || []).length > 0);
  const avg = started.length
    ? Math.round(started.reduce((acc, s) => acc + ((s.completedChapters || []).length / total), 0) / started.length * 100)
    : 0;
  set('stat-completion', avg + '%');

  const now = Date.now();
  const upcoming = sessions.filter((v) => {
    const t = v.startsAt && v.startsAt.toMillis ? v.startsAt.toMillis() : 0;
    return t > now;
  }).length;
  set('stat-sessions', String(upcoming));
}

function renderChapterEngagement(students, chapters){
  const wrap = document.getElementById('chapter-engagement');
  if (!wrap) return;

  if (!students.length || !chapters.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13px; padding:6px 0;">Not enough data yet.</p>';
    return;
  }

  // How many students have completed each chapter, as a share of all students.
  const counts = chapters.map((ch) => {
    const id = String(ch.num || ch.id);
    const done = students.filter((s) => (s.completedChapters || []).map(String).indexOf(id) !== -1).length;
    return { id: id, title: ch.title || ('Chapter ' + id), pct: Math.round(done / students.length * 100) };
  });

  // Busiest five: a full 42-row list would bury the panel it lives in.
  counts.sort((a, b) => b.pct - a.pct);
  const top = counts.slice(0, 5);

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
    // One parallel batch rather than four sequential reads. Each secondary
    // source resolves to an empty list on failure so a missing collection
    // degrades one panel instead of blanking the whole dashboard.
    Promise.all([
      db.collection('students').get(),
      db.collection('plans').get().catch(() => ({ forEach: () => {} })),
      db.collection('liveSessions').get().catch(() => ({ forEach: () => {} })),
      db.collection('chapters').get().catch(() => ({ forEach: () => {} }))
    ]).then(([studentSnap, planSnap, sessionSnap, chapterSnap]) => {
      const students = [];
      studentSnap.forEach((doc) => students.push(Object.assign({ uid: doc.id }, doc.data())));
      const plans = [];
      planSnap.forEach((doc) => plans.push(Object.assign({ id: doc.id }, doc.data())));
      const sessions = [];
      sessionSnap.forEach((doc) => sessions.push(doc.data()));
      const chapters = [];
      chapterSnap.forEach((doc) => chapters.push(Object.assign({ id: doc.id }, doc.data())));

      renderRecentStudents(students);
      renderAdminStats(students, plans, sessions, chapters);
      renderChapterEngagement(students, chapters);
    }).catch((err) => {
      console.error('Stryker: failed to load admin overview', err);
      list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">Could not load students: ' + (err.message || err) + '</p>';
    });
  });
});
