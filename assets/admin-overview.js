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
      '<div class="cell-user"><div class="cell-avatar"></div><div><span class="cell-name">' + name + '</span><span class="cell-sub">' + (s.email || '—') + '</span></div></div>' +
      '<div class="record-stats">' +
        '<div class="record-stat"><span class="rs-label">Progress</span><span class="rs-val">' + doneCount + ' / 42 chapters</span></div>' +
        '<div class="record-stat"><span class="rs-label">Streak</span><span class="rs-val">' + (s.currentStreak || 0) + ' day' + ((s.currentStreak || 0) === 1 ? '' : 's') + '</span></div>' +
      '</div>';
    list.appendChild(row);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('recent-students-list');
  if (!list) return; // not on this page

  guardAdminPage(() => {
    db.collection('students').get()
      .then((snap) => {
        const students = [];
        snap.forEach((doc) => students.push(doc.data()));
        renderRecentStudents(students);
      })
      .catch((err) => {
        console.error('Stryker: failed to load recent students', err);
        list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">Could not load students: ' + (err.message || err) + '</p>';
      });
  });
});
