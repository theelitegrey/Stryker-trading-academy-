// Stryker Trading Academy — curriculum listing (courses.html)
// Depends on: assets/progress.js (for `db`), assets/chapters-store.js
// (loadChapters/CHAPTERS).

let CURRENT_STUDENT_PLAN = null; // fetched once on load, used to show a lock badge on chapters beyond the student's access
let STUDENT_DONE_LESSONS = new Set();   // lesson ids "NN-i" from the student doc
let STUDENT_DONE_CHAPTERS = new Set();  // chapter nums from the student doc
let STUDENT_SIGNED_IN = false;

function chapterDoneCount(ch){
  let n = 0;
  for (let i = 0; i < ch.lessons.length; i++) {
    if (STUDENT_DONE_LESSONS.has(ch.num + '-' + i)) n++;
  }
  return n;
}

// "Continue learning" banner above the list: overall lesson progress across
// the whole curriculum plus a one-click jump to the first unfinished chapter.
// Only rendered for signed-in students who have actually started.
function renderContinueBanner(container){
  if (!STUDENT_SIGNED_IN) return;
  let totalLessons = 0, doneLessons = 0, target = null;
  CHAPTERS.forEach((ch) => {
    totalLessons += ch.lessons.length;
    const d = chapterDoneCount(ch);
    doneLessons += d;
    if (!target && d < ch.lessons.length) target = ch;
  });
  if (doneLessons === 0) return;
  const pct = totalLessons ? Math.round((doneLessons / totalLessons) * 100) : 0;
  const banner = document.createElement('div');
  banner.className = 'panel continue-banner';
  banner.innerHTML =
    '<div class="cb-main">' +
      '<span class="cb-kicker">' + (target ? 'CONTINUE LEARNING' : 'CURRICULUM COMPLETE') + '</span>' +
      '<h3>' + (target ? ('Chapter ' + target.num + ' — ' + target.title) : 'Every lesson, done. Well traded.') + '</h3>' +
      '<div class="cb-progress"><div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="cb-label">' + doneLessons + ' / ' + totalLessons + ' lessons · ' + pct + '%</span></div>' +
    '</div>' +
    (target
      ? '<a class="btn btn-primary" href="chapter.html?ch=' + target.num + '">' + (chapterDoneCount(target) > 0 ? 'Resume' : 'Start') + ' chapter →</a>'
      : '<a class="btn btn-ghost" href="dashboard-user.html">Back to dashboard</a>');
  container.appendChild(banner);
}

function unlockLabel(index){
  if (index === 0) return '<span class="status-pill unlocked">Free</span>';
  return '<span class="status-pill locked">Unlocks Ch.' + String(index).padStart(2,'0') + '</span>';
}

function roleLockBadge(ch){
  if (typeof hasChapterNumberAccess !== 'function' && typeof hasRoleAccess !== 'function') return '';
  const passesLimit = (typeof hasChapterNumberAccess === 'function') ? hasChapterNumberAccess(CURRENT_STUDENT_PLAN, ch.num) : true;
  const passesMinRole = ch.minRole && typeof hasRoleAccess === 'function' ? hasRoleAccess(CURRENT_STUDENT_PLAN, ch.minRole) : true;
  if (passesLimit && passesMinRole) return '';
  const requiredName = ch.minRole && !passesMinRole && typeof labelOf === 'function' ? labelOf(ch.minRole) : null;
  return '<span class="status-pill locked" title="Upgrade to unlock" style="background:rgba(245,197,66,0.12); border-color:rgba(245,197,66,0.35); color:#f5c542;">🔒 ' + (requiredName || 'Upgrade required') + '</span>';
}

// Per-chapter progress state in the status column: a green check pill once
// complete, a mini progress bar while in flight, nothing when untouched.
function progressBadge(ch){
  if (!STUDENT_SIGNED_IN) return '';
  const total = ch.lessons.length;
  const done = chapterDoneCount(ch);
  if (total > 0 && done === total) {
    return '<span class="status-pill unlocked" style="background:rgba(3,201,136,0.12); border-color:rgba(3,201,136,0.4); color:var(--gold-bright);">✓ Done</span>';
  }
  if (done > 0) {
    const pct = Math.round((done / total) * 100);
    return '<span class="ch-mini-progress" title="' + done + ' of ' + total + ' lessons done"><i style="width:' + pct + '%"></i></span>' +
           '<span class="ch-mini-label">' + done + '/' + total + '</span>';
  }
  return '';
}

function renderChapters(filterLevel){
  const container = document.getElementById('chapter-render-target');
  if (!container || typeof CHAPTERS === 'undefined') return;
  container.innerHTML = '';

  renderContinueBanner(container);

  const order = ['foundation','intermediate','advanced'];
  order.forEach(level => {
    if (filterLevel !== 'all' && filterLevel !== level) return;
    const items = CHAPTERS.filter(c => c.level === level);
    if (!items.length) return;

    const heading = document.createElement('div');
    heading.className = 'part-heading';
    heading.innerHTML = '<span>' + PART_LABEL[level] + '</span><span class="part-count">' + items.length + ' chapters</span>';
    container.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'chapter-list';
    list.style.marginBottom = '8px';

    items.forEach((ch) => {
      const globalIndex = parseInt(ch.num, 10) - 1;
      const el = document.createElement('div');
      el.className = 'chapter';
      el.setAttribute('data-expand', '');

      const lessonsHtml = ch.lessons.map((l, i) =>
        '<div class="lesson-item"><span class="lnum">0' + (i+1) + '</span><span>' + l.title + '</span></div>'
      ).join('');

      const preview = ch.paragraphs[0];

      el.innerHTML =
        '<div class="chapter-num">' + ch.num + '</div>' +
        '<div class="chapter-body">' +
          '<h3>' + ch.title + '</h3>' +
          '<p>' + preview.slice(0, 130) + (preview.length > 130 ? '…' : '') + '</p>' +
          '<div class="chapter-meta">' +
            '<span class="chapter-tag ' + LEVEL_TAG_CLASS[ch.level] + '">' + LEVEL_LABEL[ch.level] + '</span>' +
            '<span>' + ch.lessons.length + ' lessons</span><span>' + ch.dur + '</span>' +
          '</div>' +
          '<div class="chapter-detail"><div class="chapter-detail-inner">' +
            '<div><h5>What you\'ll learn</h5><p>' + preview + '</p>' +
              '<a class="btn btn-primary btn-sm" style="margin-top:14px; display:inline-flex;" href="chapter.html?ch=' + ch.num + '">Read full chapter &amp; watch video →</a></div>' +
            '<div><h5>Lessons</h5>' + lessonsHtml + '</div>' +
          '</div></div>' +
        '</div>' +
        '<div class="chapter-status" style="display:flex; align-items:center; gap:10px;">' +
          progressBadge(ch) + unlockLabel(globalIndex) + roleLockBadge(ch) +
          '<svg class="chapter-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' +
        '</div>';

      el.addEventListener('click', (e) => {
        if (e.target.closest('a,button')) return; // let real links navigate normally
        el.classList.toggle('expanded');
      });

      list.appendChild(el);
    });

    container.appendChild(list);
  });
}

function showGuestPaywall(show){
  const overlay = document.getElementById('guest-paywall-overlay');
  const content = document.getElementById('courses-content-wrap');
  if (overlay) overlay.style.display = show ? 'flex' : 'none';
  if (content) content.classList.toggle('paywall-dimmed', show);
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.level-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.level-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderChapters(btn.dataset.level);
    });
  });

  const container = document.getElementById('chapter-render-target');
  if (container) showLoadingAnimation(container, 'Loading curriculum…');

  loadChapters().then(() => renderChapters('all'));

  if (!auth) {
    // Firebase failed to init — still let the curriculum render, just as a
    // guest (matches how chapter.html degrades in the same situation).
    showGuestPaywall(true);
    return;
  }

  auth.onAuthStateChanged((user) => {
    showGuestPaywall(!user);
    if (user && typeof db !== 'undefined' && db) {
      STUDENT_SIGNED_IN = true;
      const planLookup = db.collection('students').doc(user.uid).get()
        .then((doc) => {
          const data = doc.exists ? doc.data() : {};
          CURRENT_STUDENT_PLAN = data.plan || null;
          STUDENT_DONE_LESSONS = new Set(data.completedLessons || []);
          STUDENT_DONE_CHAPTERS = new Set(data.completedChapters || []);
        })
        .catch(() => {});
      const rolesLookup = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
      Promise.all([planLookup, rolesLookup]).then(() => {
        const activeTab = document.querySelector('.level-tab.active');
        renderChapters(activeTab ? activeTab.dataset.level : 'all');
      });
    }
  });
});
