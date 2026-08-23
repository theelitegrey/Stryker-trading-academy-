// Stryker Trading Academy — student dashboard (dashboard-user.html)
// Depends on: assets/auth.js, assets/progress.js, assets/chapters-data.js

function pct(n, d){ return d ? Math.round((n / d) * 100) : 0; }

function setBadge(id, unlocked){
  const el = document.getElementById(id);
  if (el) el.classList.toggle('locked', !unlocked);
}

function renderDashboard(student){
  const completedChapters = new Set(student.completedChapters || []);
  const completedLessons = new Set(student.completedLessons || []);
  const totalChapters = CHAPTERS.length;
  const doneCount = completedChapters.size;

  let nextChapter = CHAPTERS.find(c => !completedChapters.has(c.num));
  if (!nextChapter) nextChapter = CHAPTERS[CHAPTERS.length - 1];

  // ---- Name + subtitle + resume button ----
  const displayName = student.displayName || (student.email ? student.email.split('@')[0] : 'Trader');
  const firstName = displayName.split(' ')[0];
  const firstNameEl = document.getElementById('dash-first-name');
  if (firstNameEl) firstNameEl.textContent = firstName;

  const subtitleEl = document.getElementById('dash-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = (doneCount === 0)
      ? "You haven't started a chapter yet — Chapter " + nextChapter.num + " is a great place to begin."
      : "You're " + doneCount + " chapter" + (doneCount === 1 ? '' : 's') + " into the ICT/SMT core path. Chapter " + nextChapter.num + " is next.";
  }

  const resumeBtn = document.getElementById('dash-resume-btn');
  if (resumeBtn) {
    resumeBtn.href = 'chapter.html?ch=' + nextChapter.num;
    resumeBtn.textContent = (doneCount === 0 ? 'Start Chapter ' : 'Resume Chapter ') + nextChapter.num;
  }

  // ---- Stat cards ----
  const statChapters = document.getElementById('stat-chapters');
  if (statChapters) statChapters.textContent = doneCount + ' / ' + totalChapters;

  const streakVal = student.currentStreak || 0;
  const statStreak = document.getElementById('stat-streak');
  if (statStreak) statStreak.textContent = streakVal + ' day' + (streakVal === 1 ? '' : 's');

  const statLessons = document.getElementById('stat-lessons');
  if (statLessons) statLessons.textContent = String(completedLessons.size);

  const statMember = document.getElementById('stat-member-since');
  if (statMember) {
    let dateStr = '—';
    if (student.createdAt && typeof student.createdAt.toDate === 'function') {
      dateStr = student.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    }
    statMember.textContent = dateStr;
  }

  // ---- Continue learning ----
  const continueWrap = document.getElementById('continue-learning-list');
  if (continueWrap) {
    continueWrap.innerHTML = '';
    const rows = [];
    if (nextChapter) rows.push(nextChapter);
    const doneChapters = CHAPTERS.filter(c => completedChapters.has(c.num)).slice(-2).reverse();
    doneChapters.forEach(c => { if (!rows.find(r => r.num === c.num)) rows.push(c); });

    if (!rows.length) {
      continueWrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">Start your first chapter to see it here.</p>';
    } else {
      rows.slice(0, 3).forEach(ch => {
        const doneL = ch.lessons.filter((l, li) => completedLessons.has(ch.num + '-' + li)).length;
        const totalL = ch.lessons.length;
        const isDone = completedChapters.has(ch.num);
        const row = document.createElement('div');
        row.className = 'continue-row';
        row.innerHTML =
          '<div class="continue-thumb">' + ch.num + '</div>' +
          '<div class="continue-body">' +
            '<h4>' + ch.title + '</h4>' +
            '<div class="progress-track"><div class="progress-fill" style="width:' + pct(doneL, totalL) + '%"></div></div>' +
            '<div class="continue-meta">' + (isDone ? 'Completed' : (doneL + ' / ' + totalL + ' lessons')) + ' · ' + LEVEL_LABEL[ch.level] + '</div>' +
          '</div>' +
          '<a href="chapter.html?ch=' + ch.num + '" class="btn btn-ghost btn-sm">' + (isDone ? 'Review' : 'Resume') + '</a>';
        continueWrap.appendChild(row);
      });
    }
  }

  // ---- Achievements ----
  const foundationNums = CHAPTERS.filter(c => c.level === 'foundation').map(c => c.num);
  const intermediateNums = CHAPTERS.filter(c => c.level === 'intermediate').map(c => c.num);
  const advancedNums = CHAPTERS.filter(c => c.level === 'advanced').map(c => c.num);
  const allDone = (nums) => nums.length > 0 && nums.every(n => completedChapters.has(n));

  setBadge('badge-first-chapter', doneCount >= 1);
  setBadge('badge-foundations', allDone(foundationNums));
  setBadge('badge-structure-master', allDone(intermediateNums));
  setBadge('badge-smt-certified', allDone(advancedNums));

  // ---- Your track panel ----
  const trackFill = document.getElementById('track-progress-fill');
  const trackLabel = document.getElementById('track-progress-label');
  const percent = pct(doneCount, totalChapters);
  if (trackFill) trackFill.style.width = percent + '%';
  if (trackLabel) trackLabel.textContent = doneCount + ' of ' + totalChapters + ' chapters · ' + percent + '% complete';
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return; // auth.js already shows a fallback error if init failed.

  let handled = false;
  let sawNullOnce = false;

  auth.onAuthStateChanged((user) => {
    if (handled) return;

    if (user) {
      handled = true;
      hideSessionNotice();
      ensureStudentDoc(user)
        .then((student) => { if (student) renderDashboard(student); })
        .catch((err) => {
          console.error('Stryker: failed to load dashboard data', err);
          showSessionNotice(
            "Signed in, but couldn't load your data.",
            'This usually means Firestore isn\'t set up yet, or its security rules aren\'t published. Error: ' + (err && err.message ? err.message : String(err)),
            false
          );
        });
      return;
    }

    // First time we see "no user" — this can be a genuine signed-out state,
    // but it can also just be Firebase still restoring a persisted session
    // right after the page navigated here from login.html. Give it a brief
    // grace window before concluding they're actually logged out; a real
    // user (if any) is picked up by this same callback firing again.
    if (!sawNullOnce) {
      sawNullOnce = true;
      showSessionNotice('Checking your session…', "If this doesn't resolve in a couple seconds, your browser may be blocking the storage Firebase needs to stay signed in across pages.", false);
      setTimeout(() => {
        if (!handled) {
          showSessionNotice(
            "Couldn't confirm you're signed in.",
            'Your login worked, but this new page could not detect an active session — likely a browser storage restriction. Try logging in again below.',
            true
          );
        }
      }, 1500);
    }
  });
});

// Shows an inline notice on the dashboard instead of silently redirecting,
// so a failed session-check is visible and debuggable rather than looking
// like a mysterious bounce back to the login page.
function showSessionNotice(title, detail, showLoginButton){
  let el = document.getElementById('session-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'session-notice';
    el.className = 'notice';
    el.style.margin = '20px 0';
    const main = document.querySelector('.dash-main');
    if (main) main.insertBefore(el, main.firstChild);
  }
  el.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>' +
    '<p><b>' + title + '</b><br>' + detail +
    (showLoginButton ? '<br><a href="login.html" class="btn btn-primary btn-sm" style="margin-top:10px; display:inline-flex;">Go to login</a>' : '') +
    '</p>';
}
function hideSessionNotice(){
  const el = document.getElementById('session-notice');
  if (el) el.remove();
}
