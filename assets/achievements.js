// Stryker Trading Academy — Achievements page (achievements.html)
// Depends on: assets/auth.js, assets/progress.js, assets/chapters-data.js,
// assets/achievements-data.js (the ACHIEVEMENTS array itself)

function buildAchievementCheckContext(student){
  return {
    completedChapters: student.completedChapters || [],
    completedLessons: student.completedLessons || [],
    bestStreak: student.bestStreak || 0,
    referralPoints: student.referralPoints || 0,
    bio: student.bio || '',
    customPhotoURL: student.customPhotoURL || null,
    avatarSeed: student.avatarSeed || null,
    plan: student.plan || null,
    tradingViewAccessGranted: !!student.tradingViewAccessGranted
  };
}

function buildAchievementExtra(student){
  return {
    postCount: student.floorPostCount || 0,
    replyCount: student.floorReplyCount || 0,
    likesReceived: student.floorLikesReceived || 0,
    journalCount: student.journalEntryCount || 0,
    hasWinningTrade: !!student.hasWinningTrade
  };
}

function renderAchievements(student){
  const s = buildAchievementCheckContext(student);
  const extra = buildAchievementExtra(student);

  const total = ACHIEVEMENTS.length;
  const unlockedCount = ACHIEVEMENTS.filter(a => a.check(s, CHAPTERS, extra)).length;

  const subtitle = document.getElementById('ach-subtitle');
  if (subtitle) subtitle.textContent = unlockedCount + ' of ' + total + ' badges unlocked.';

  const grid = document.getElementById('achievements-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Grouped by category rather than one flat wall of 43 tiles — each
  // category gets its own small heading so the page stays scannable.
  const categories = [];
  ACHIEVEMENTS.forEach((a) => { if (!categories.includes(a.category)) categories.push(a.category); });

  categories.forEach((cat) => {
    const section = document.createElement('div');
    section.className = 'badge-category';

    const heading = document.createElement('h3');
    heading.className = 'badge-category-heading';
    heading.textContent = cat;
    section.appendChild(heading);

    const catGrid = document.createElement('div');
    catGrid.className = 'badge-grid';

    ACHIEVEMENTS.filter((a) => a.category === cat).forEach((a) => {
      const unlocked = a.check(s, CHAPTERS, extra);
      const el = document.createElement('div');
      el.className = 'badge-item' + (unlocked ? '' : ' locked');
      el.title = a.desc;
      const iconColor = unlocked ? a.color : 'var(--ink-3)';
      el.innerHTML =
        '<div class="badge-ic" style="color:' + iconColor + '; background:' + (unlocked ? a.color + '1a' : 'var(--bg-3)') + '; border-color:' + (unlocked ? a.color + '55' : 'var(--line)') + ';">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + a.icon + '</svg>' +
        '</div>' +
        '<span>' + a.title + '</span>';
      catGrid.appendChild(el);
    });

    section.appendChild(catGrid);
    grid.appendChild(section);
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
          checkAndNotifyNewAchievements(user.uid, student, CHAPTERS, buildAchievementExtra(student));
        }
      })
      .catch((err) => console.error('Stryker: failed to load achievements', err));
  });
});
