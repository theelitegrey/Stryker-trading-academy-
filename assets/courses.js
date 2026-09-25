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
      '<h3>' + (target ? ('Chapter ' + stkEsc(target.num) + ' — ' + stkEsc(target.title)) : 'Every lesson, done. Well traded.') + '</h3>' +
      '<div class="cb-progress"><div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="cb-label">' + doneLessons + ' / ' + totalLessons + ' lessons · ' + pct + '%</span></div>' +
    '</div>' +
    (target
      ? '<a class="btn btn-primary" href="chapter.html?ch=' + target.num + '">' + (chapterDoneCount(target) > 0 ? 'Resume' : 'Start') + ' chapter →</a>'
      : '<a class="btn btn-ghost" href="dashboard-user.html">Back to dashboard</a>');
  container.appendChild(banner);
}

// "Free" only on core-curriculum chapters within the Starter plan's own
// chapter-number ceiling (chapterLimitOf/hasChapterNumberAccess — never
// hardcoded, so it tracks whatever chapterAccess is actually set to).
// Everything else gets no pill here: roleLockBadge() already shows the
// lock for anyone without access, and there is no one-chapter-at-a-time
// unlock sequence to imply with a "Unlocks Ch.0N" label — chapters open
// purely by plan tier, not by finishing the one before them. Track
// chapters (VP-/PF-, ch.track set to anything but 'core') are always
// paid content and never show "Free", even if their number happens to
// fall inside the Starter numeric range (track numbering is separate).
function unlockLabel(ch){
  if (typeof isTrackChapter === 'function' && isTrackChapter(ch)) return '';
  const entryPlan = (typeof defaultPlanName === 'function') ? defaultPlanName() : 'Starter';
  const freeForEntry = (typeof hasChapterNumberAccess === 'function')
    ? hasChapterNumberAccess(entryPlan, ch.num)
    : false;
  return freeForEntry ? '<span class="status-pill unlocked">Free</span>' : '';
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

// Specialist tracks are paid: a plan with a finite core chapter limit
// (Starter, "1-7") can't read them. Same test the server's chapterGate uses
// to set minRank, so the badge and the Firestore rules agree.
function trackLocked(){
  if (typeof chapterLimitOf !== 'function') return false;
  return chapterLimitOf(CURRENT_STUDENT_PLAN) !== Infinity;
}

function trackChapterEl(ch){
  const el = document.createElement('div');
  el.className = 'chapter';
  el.setAttribute('data-expand', '');
  el.setAttribute('data-track', ch.track);
  const lessonsHtml = ch.lessons.map((l, i) =>
    '<div class="lesson-item"><span class="lnum">0' + (i+1) + '</span><span>' + stkEsc(l.title) + '</span></div>'
  ).join('');
  const preview = stkEsc(ch.preview || '');
  const locked = trackLocked();
  el.innerHTML =
    '<div class="chapter-num" style="font-size:12px; white-space:nowrap; letter-spacing:-.02em;">' + stkEsc(ch.num) + '</div>' +
    '<div class="chapter-body">' +
      '<h3>' + stkEsc(ch.title) + '</h3>' +
      '<p>' + preview.slice(0, 130) + (preview.length > 130 ? '…' : '') + '</p>' +
      '<div class="chapter-meta">' +
        '<span class="chapter-tag ' + (LEVEL_TAG_CLASS[ch.level] || '') + '">' + (LEVEL_LABEL[ch.level] || '') + '</span>' +
        '<span>' + ch.lessons.length + ' lessons</span>' +
      '</div>' +
      '<div class="chapter-detail"><div class="chapter-detail-inner">' +
        '<div><h5>What you\'ll learn</h5><p>' + preview + '</p>' +
          '<a class="btn btn-primary btn-sm" style="margin-top:14px; display:inline-flex;" href="chapter.html?ch=' + encodeURIComponent(ch.num) + '">' +
            (locked ? 'Preview chapter →' : 'Read full chapter →') + '</a></div>' +
        '<div><h5>Lessons</h5>' + lessonsHtml + '</div>' +
      '</div></div>' +
    '</div>' +
    '<div class="chapter-status" style="display:flex; align-items:center; gap:10px;">' +
      progressBadge(ch) +
      (locked ? '<span class="status-pill locked" title="Upgrade to unlock" style="background:rgba(245,197,66,0.12); border-color:rgba(245,197,66,0.35); color:#f5c542;">🔒 Pro</span>' : '') +
      '<svg class="chapter-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' +
    '</div>';
  el.addEventListener('click', (e) => {
    if (e.target.closest('a,button')) return;
    el.classList.toggle('expanded');
  });
  return el;
}

function renderTracks(container){
  if (typeof TRACK_CHAPTERS === 'undefined' || !TRACK_CHAPTERS.length) return;
  TRACKS.forEach((t) => {
    const items = TRACK_CHAPTERS.filter((c) => c.track === t.id);
    if (!items.length) return;
    const heading = document.createElement('div');
    heading.className = 'part-heading';
    heading.setAttribute('data-track-heading', t.id);
    heading.innerHTML = '<span>Specialist track · ' + stkEsc(t.name) + '</span><span class="part-count">' + items.length + ' chapters</span>';
    container.appendChild(heading);
    const blurb = document.createElement('p');
    blurb.style.cssText = 'color:var(--ink-3); font-size:13.5px; margin:-4px 0 12px;';
    blurb.textContent = t.blurb + (trackLocked() ? ' Included with Pro and Elite.' : '');
    if (t.link) {
      const a = document.createElement('a');
      a.href = t.link.href;
      a.textContent = t.link.label;
      a.style.color = 'var(--gold)';
      a.setAttribute('data-track-link', t.id);
      blurb.appendChild(document.createTextNode(' ' + t.link.lead + ' '));
      blurb.appendChild(a);
    }
    container.appendChild(blurb);
    const list = document.createElement('div');
    list.className = 'chapter-list';
    list.style.marginBottom = '8px';
    items.forEach((ch) => list.appendChild(trackChapterEl(ch)));
    container.appendChild(list);
  });
}

function renderChapters(filterLevel){
  const container = document.getElementById('chapter-render-target');
  if (!container || typeof CHAPTERS === 'undefined') return;
  container.innerHTML = '';

  renderContinueBanner(container);

  if (filterLevel === 'tracks') { renderTracks(container); return; }

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
      const el = document.createElement('div');
      el.className = 'chapter';
      el.setAttribute('data-expand', '');

      const lessonsHtml = ch.lessons.map((l, i) =>
        '<div class="lesson-item"><span class="lnum">0' + (i+1) + '</span><span>' + stkEsc(l.title) + '</span></div>'
      ).join('');

      const preview = stkEsc(ch.preview || '');

      el.innerHTML =
        '<div class="chapter-num">' + ch.num + '</div>' +
        '<div class="chapter-body">' +
          '<h3>' + stkEsc(ch.title) + '</h3>' +
          '<p>' + preview.slice(0, 130) + (preview.length > 130 ? '…' : '') + '</p>' +
          '<div class="chapter-meta">' +
            '<span class="chapter-tag ' + LEVEL_TAG_CLASS[ch.level] + '">' + LEVEL_LABEL[ch.level] + '</span>' +
            // ch.dur is the recording's runtime — omitted while there is no
            // recording, same as on the chapter page itself.
            '<span>' + ch.lessons.length + ' lessons</span>' +
            ((chapterVideoUrl(ch) || ch.hasVideo === true) ? '<span>' + ch.dur + '</span>' : '') +
          '</div>' +
          '<div class="chapter-detail"><div class="chapter-detail-inner">' +
            '<div><h5>What you\'ll learn</h5><p>' + preview + '</p>' +
              '<a class="btn btn-primary btn-sm" style="margin-top:14px; display:inline-flex;" href="chapter.html?ch=' + ch.num + '">' +
                ((chapterVideoUrl(ch) || ch.hasVideo === true) ? 'Read full chapter &amp; watch video →' : 'Read full chapter →') + '</a></div>' +
            '<div><h5>Lessons</h5>' + lessonsHtml + '</div>' +
          '</div></div>' +
        '</div>' +
        '<div class="chapter-status" style="display:flex; align-items:center; gap:10px;">' +
          progressBadge(ch) + unlockLabel(ch) + roleLockBadge(ch) +
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
  if (filterLevel === 'all') renderTracks(container);
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

  if (!auth) {
    // Firebase failed to init entirely — treat as a guest, but chapters
    // still render from the bundled seed (loadChapters() falls back to
    // CHAPTERS_SEED whenever `db` is unavailable, so this is a local read,
    // never a Firestore call).
    loadChapters().then(() => renderChapters('all'));
    showGuestPaywall(true);
    return;
  }

  auth.onAuthStateChanged((user) => {
    showGuestPaywall(!user);
    if (!user) {
      // Signed out: the curriculum stays fully behind the paywall overlay
      // (see showGuestPaywall above), so there is nothing to render here —
      // skip the `chapters` read entirely rather than firing it and eating
      // the resulting Firestore rules rejection. Rules require signedIn()
      // on chapters/models/indicators; reading any of them while signed out
      // only ever produced a console "Missing or insufficient permissions"
      // error with no visible effect (dev audit P3-7).
      return;
    }
    if (typeof db !== 'undefined' && db) {
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
      Promise.all([loadChapters(), planLookup, rolesLookup]).then(() => {
        const activeTab = document.querySelector('.level-tab.active');
        renderChapters(activeTab ? activeTab.dataset.level : 'all');
      });
    } else {
      // Signed in, but Firestore itself is unavailable — still show the
      // bundled chapters rather than leaving the loading animation forever.
      loadChapters().then(() => renderChapters('all'));
    }
  });
});
