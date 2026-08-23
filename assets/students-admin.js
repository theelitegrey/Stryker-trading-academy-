// Stryker Trading Academy — Admin: Students (students-admin.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`), assets/admin-guard.js
// Read-only. Access is gated by guardAdminPage() plus Firestore security
// rules, which restrict reads across all student docs to accounts with a
// matching document in the `admins` collection.

let ALL_STUDENTS = [];

function initials(name){
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function renderStudentsTable(students){
  const body = document.getElementById('students-table-body');
  const countEl = document.getElementById('students-count');
  if (countEl) countEl.textContent = students.length + ' student' + (students.length === 1 ? '' : 's');

  if (!students.length) {
    body.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">No students found.</p>';
    return;
  }

  body.innerHTML = '';
  students.forEach((s) => {
    const name = s.displayName || (s.email ? s.email.split('@')[0] : 'Unnamed');
    const memberSince = (s.createdAt && typeof s.createdAt.toDate === 'function')
      ? s.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    const card = document.createElement('div');
    card.className = 'record-card';
    card.innerHTML =
      '<div class="cell-user"><div class="cell-avatar"></div><div><span class="cell-name">' + name + '</span><span class="cell-sub">' + (s.email || '—') + '</span></div></div>' +
      '<div class="record-stats">' +
        '<div class="record-stat"><span class="rs-label">Chapters</span><span class="rs-val">' + (s.completedChapters ? s.completedChapters.length : 0) + ' / 42</span></div>' +
        '<div class="record-stat"><span class="rs-label">Lessons</span><span class="rs-val">' + (s.completedLessons ? s.completedLessons.length : 0) + '</span></div>' +
        '<div class="record-stat"><span class="rs-label">Streak</span><span class="rs-val">' + (s.currentStreak || 0) + ' day' + ((s.currentStreak || 0) === 1 ? '' : 's') + '</span></div>' +
        '<div class="record-stat"><span class="rs-label">Member since</span><span class="rs-val">' + memberSince + '</span></div>' +
      '</div>';
    body.appendChild(card);
  });
}

function loadStudents(){
  db.collection('students').get()
    .then((snap) => {
      ALL_STUDENTS = [];
      snap.forEach((doc) => ALL_STUDENTS.push(Object.assign({ uid: doc.id }, doc.data())));
      renderStudentsTable(ALL_STUDENTS);
    })
    .catch((err) => {
      console.error('Stryker: failed to load students', err);
      document.getElementById('students-table-body').innerHTML =
        '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">Could not load students: ' + (err.message || err) + '</p>';
      document.getElementById('students-count').textContent = 'Error loading students';
    });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => loadStudents());

  document.getElementById('students-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { renderStudentsTable(ALL_STUDENTS); return; }
    const filtered = ALL_STUDENTS.filter(s =>
      (s.displayName || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q)
    );
    renderStudentsTable(filtered);
  });
});
