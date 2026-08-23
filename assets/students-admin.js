// Stryker Trading Academy — Admin: Students (students-admin.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`)
// Read-only. See the notice on the page itself re: the security trade-off
// this list depends on (student profile docs are readable by any signed-in
// account, since there's no real admin-role backend to restrict this to).

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
    body.innerHTML = '<tr><td colspan="5" style="color:var(--ink-3);">No students found.</td></tr>';
    return;
  }

  body.innerHTML = '';
  students.forEach((s) => {
    const name = s.displayName || (s.email ? s.email.split('@')[0] : 'Unnamed');
    const memberSince = (s.createdAt && typeof s.createdAt.toDate === 'function')
      ? s.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><div class="cell-user"><div class="cell-avatar"></div><div><span class="cell-name">' + name + '</span><span class="cell-sub">' + (s.email || '—') + '</span></div></div></td>' +
      '<td>' + (s.completedChapters ? s.completedChapters.length : 0) + ' / 42</td>' +
      '<td>' + (s.completedLessons ? s.completedLessons.length : 0) + '</td>' +
      '<td>' + (s.currentStreak || 0) + ' day' + ((s.currentStreak || 0) === 1 ? '' : 's') + '</td>' +
      '<td>' + memberSince + '</td>';
    body.appendChild(tr);
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
        '<tr><td colspan="5" style="color:var(--ink-3);">Could not load students: ' + (err.message || err) + '</td></tr>';
      document.getElementById('students-count').textContent = 'Error loading students';
    });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;
  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) window.location.href = 'login.html'; }, 1500);
      return;
    }
    handled = true;
    loadStudents();
  });

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
