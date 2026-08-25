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

    const catList = document.createElement('div');
    catList.className = 'badge-list';

    ACHIEVEMENTS.filter((a) => a.category === cat).forEach((a) => {
      const unlocked = a.check(s, CHAPTERS, extra);
      const el = document.createElement('div');
      el.className = 'badge-row' + (unlocked ? '' : ' locked');
      const iconColor = unlocked ? a.color : 'var(--ink-3)';
      const statusIcon = unlocked
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + a.color + '" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
      el.innerHTML =
        '<div class="badge-row-ic" style="color:' + iconColor + '; background:' + (unlocked ? a.color + '1a' : 'transparent') + '; border-color:' + (unlocked ? a.color + '55' : 'var(--line)') + ';">' +
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + a.icon + '</svg>' +
        '</div>' +
        '<div class="badge-row-text"><span class="badge-row-title">' + a.title + '</span><span class="badge-row-desc">' + a.desc + '</span></div>' +
        '<div class="badge-row-status">' + statusIcon + '</div>';
      catList.appendChild(el);
    });

    section.appendChild(catList);
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
