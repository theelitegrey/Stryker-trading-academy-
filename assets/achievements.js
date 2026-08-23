// Stryker Trading Academy — Achievements page (achievements.html)
// Depends on: assets/auth.js, assets/progress.js, assets/chapters-data.js

const ACHIEVEMENTS = [
  {
    id: 'first-chapter', title: 'First Chapter Complete', desc: 'Finish your first chapter.',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>',
    check: (s, ch) => s.completedChapters.length >= 1
  },
  {
    id: 'foundations', title: 'Foundations Complete', desc: 'Complete all Part I foundation chapters.',
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    check: (s, ch) => ch.filter(c => c.level === 'foundation').every(c => s.completedChapters.includes(c.num))
  },
  {
    id: 'structure-master', title: 'Structure Master', desc: 'Complete all Part II intermediate chapters.',
    icon: '<circle cx="12" cy="12" r="9"/>',
    check: (s, ch) => ch.filter(c => c.level === 'intermediate').every(c => s.completedChapters.includes(c.num))
  },
  {
    id: 'smt-certified', title: 'SMT Certified', desc: 'Complete all Part III advanced chapters.',
    icon: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
    check: (s, ch) => ch.filter(c => c.level === 'advanced').every(c => s.completedChapters.includes(c.num))
  },
  {
    id: 'curriculum-complete', title: 'Curriculum Complete', desc: 'Finish all 42 chapters, start to finish.',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/><circle cx="12" cy="12" r="10"/>',
    check: (s, ch) => s.completedChapters.length >= ch.length
  },
  {
    id: 'streak-7', title: '7-Day Streak', desc: 'Study on 7 consecutive days.',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>',
    check: (s) => (s.bestStreak || 0) >= 7
  },
  {
    id: 'streak-30', title: '30-Day Streak', desc: 'Study on 30 consecutive days.',
    icon: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/><path d="M12 6v6l4 2"/>',
    check: (s) => (s.bestStreak || 0) >= 30
  },
  {
    id: 'lessons-25', title: '25 Lessons Logged', desc: 'Complete 25 individual lessons across any chapters.',
    icon: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    check: (s) => s.completedLessons.length >= 25
  }
];

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
      setTimeout(() => { if (!handled) window.location.href = 'login.html'; }, 1500);
      return;
    }
    handled = true;
    ensureStudentDoc(user)
      .then((student) => { if (student) renderAchievements(student); })
      .catch((err) => console.error('Stryker: failed to load achievements', err));
  });
});
