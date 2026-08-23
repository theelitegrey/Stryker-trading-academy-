// Stryker Trading Academy — Admin: Chapters & Content analytics (chapters-admin.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`), assets/chapters-data.js

function renderChapterEngagement(students){
  const totalStudents = students.length;
  document.getElementById('chstat-total-students').textContent = totalStudents;

  if (!totalStudents) {
    document.getElementById('chstat-avg-completion').textContent = '0';
    document.getElementById('chstat-most-completed').textContent = '—';
    document.getElementById('chapter-engagement-list').innerHTML =
      '<p style="color:var(--ink-3); font-size:13.5px;">No students yet — analytics will appear once people start signing up.</p>';
    return;
  }

  const totalChaptersCompleted = students.reduce((sum, s) => sum + ((s.completedChapters || []).length), 0);
  const avgCompletion = (totalChaptersCompleted / totalStudents).toFixed(1);
  document.getElementById('chstat-avg-completion').textContent = avgCompletion;

  // Per-chapter completion counts
  const counts = {};
  CHAPTERS.forEach(ch => { counts[ch.num] = 0; });
  students.forEach(s => {
    (s.completedChapters || []).forEach(num => {
      if (counts.hasOwnProperty(num)) counts[num]++;
    });
  });

  let mostCompletedChapter = null;
  let mostCompletedCount = -1;
  CHAPTERS.forEach(ch => {
    if (counts[ch.num] > mostCompletedCount) {
      mostCompletedCount = counts[ch.num];
      mostCompletedChapter = ch;
    }
  });
  document.getElementById('chstat-most-completed').textContent =
    mostCompletedChapter ? ('Ch. ' + mostCompletedChapter.num) : '—';

  const list = document.getElementById('chapter-engagement-list');
  list.innerHTML = '';
  CHAPTERS.forEach(ch => {
    const pct = totalStudents ? Math.round((counts[ch.num] / totalStudents) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'mini-bar-row';
    row.innerHTML =
      '<span class="label">' + ch.num + ' ' + ch.title + '</span>' +
      '<div class="mini-bar-track"><div class="mini-bar-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="mini-bar-val">' + pct + '%</span>';
    list.appendChild(row);
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
    db.collection('students').get()
      .then((snap) => {
        const students = [];
        snap.forEach((doc) => students.push(doc.data()));
        renderChapterEngagement(students);
      })
      .catch((err) => {
        console.error('Stryker: failed to load chapter analytics', err);
        document.getElementById('chapter-engagement-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load analytics: ' + (err.message || err) + '</p>';
      });
  });
});
