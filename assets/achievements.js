// Stryker Trading Academy — Achievements page (achievements.html)
// Depends on: assets/auth.js, assets/progress.js, assets/chapters-data.js,
// assets/achievements-data.js (the ACHIEVEMENTS array itself)

function renderAchievements(student){
  const s = {
    completedChapters: student.completedChapters || [],
    completedLessons: student.completedLessons || [],
    bestStreak: student.bestStreak || 0
  };

  const total = ACHIEVEMENTS.length;
  const unlockedCount = ACHIEVEMENTS.filter(a => a.check(s, CHAPTERS)).length;

  const subtitle = document.getElementById('ach-subtitle');
  if (subtitle) subtitle.textContent = unlockedCount + ' of ' + total + ' badges unlocked.';

  const grid = document.getElementById('achievements-grid');
  if (!grid) return;
  grid.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const unlocked = a.check(s, CHAPTERS);
    const el = document.createElement('div');
    el.className = 'badge-item' + (unlocked ? '' : ' locked');
    el.title = a.desc;
    el.innerHTML =
      '<div class="badge-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + a.icon + '</svg></div>' +
      '<span>' + a.title + '</span>';
    grid.appendChild(el);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;
  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
      return;
    }
    handled = true;
    Promise.all([ensureStudentDoc(user), loadChapters()])
      .then(([student]) => {
        if (!student) return;
        renderAchievements(student);
        if (typeof checkAndNotifyNewAchievements === 'function') {
          checkAndNotifyNewAchievements(user.uid, student, CHAPTERS);
        }
      })
      .catch((err) => console.error('Stryker: failed to load achievements', err));
  });
});
