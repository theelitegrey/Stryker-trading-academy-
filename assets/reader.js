// Stryker Trading Academy — chapter reader (chapter.html)
// Depends on: assets/chapters-data.js, assets/auth.js (firebase init + `auth`),
// assets/progress.js (Firestore helpers).
//
// Progress is saved to Firestore under the signed-in user's account, so it
// follows them across devices. If they're not signed in, progress is kept in
// this browser's localStorage instead, and a banner invites them to log in
// so it isn't lost.

function getChapterIndexFromQuery(){
  const params = new URLSearchParams(window.location.search);
  const chNum = params.get('ch') || '01';
  let idx = CHAPTERS.findIndex(c => c.num === chNum);
  if (idx === -1) idx = 0;
  return idx;
}

function loadLocalProgress(){
  try {
    const raw = localStorage.getItem('stryker_progress');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { completedLessons: [], completedChapters: [] };
}
function saveLocalProgress(lessonsSet, chaptersSet){
  try {
    localStorage.setItem('stryker_progress', JSON.stringify({
      completedLessons: Array.from(lessonsSet),
      completedChapters: Array.from(chaptersSet)
    }));
  } catch(e) {}
}

let completedLessonsSet = new Set();
let completedChaptersSet = new Set();
let CURRENT_INDEX = 0;
let CURRENT_UID = null; // null = guest — progress saves locally only
let CURRENT_BEST_STREAK = 0;
let CURRENT_NOTIFIED_ACHIEVEMENTS = [];

function persistProgress(){
  if (CURRENT_UID) {
    saveStudentProgress(CURRENT_UID, completedLessonsSet, completedChaptersSet)
      .then(() => {
        if (typeof checkAndNotifyNewAchievements === 'function') {
          checkAndNotifyNewAchievements(CURRENT_UID, {
            completedChapters: Array.from(completedChaptersSet),
            completedLessons: Array.from(completedLessonsSet),
            bestStreak: CURRENT_BEST_STREAK,
            notifiedAchievements: CURRENT_NOTIFIED_ACHIEVEMENTS
          }, (typeof CHAPTERS !== 'undefined') ? CHAPTERS : null);
        }
      })
      .catch(err => console.error('Stryker: failed to save progress to Firestore', err));
  } else {
    saveLocalProgress(completedLessonsSet, completedChaptersSet);
  }
}

function showGuestBanner(show){
  const overlay = document.getElementById('guest-paywall-overlay');
  const content = document.getElementById('reader-content-wrap');
  if (overlay) overlay.style.display = show ? 'flex' : 'none';
  if (content) content.classList.toggle('paywall-dimmed', show);
}

// Only called once an access decision has actually been made (allowed or
// denied) — reveals the reader content for the first time. If showGuestBanner
// already applied .paywall-dimmed in this same code path, the content
// becomes visible already-dimmed, so a denied visitor never sees a sharp,
// readable frame of gated content before the paywall catches up.
function revealReaderContent(){
  const gateOverlay = document.getElementById('access-gate-overlay');
  const content = document.getElementById('reader-content-wrap');
  if (gateOverlay) gateOverlay.style.display = 'none';
  if (content) content.classList.remove('gate-pending');
}

// Two distinct lock reasons share the same overlay markup: not signed in
// at all ("signin"), or signed in but the chapter's minRole exceeds the
// student's current plan ("role"). The wording and buttons differ.
function setPaywallMessage(reason, requiredRoleName){
  const heading = document.getElementById('paywall-heading');
  const body = document.getElementById('paywall-body');
  const actions = document.getElementById('paywall-actions');
  if (!heading || !body || !actions) return;
  if (reason === 'role') {
    heading.textContent = 'Upgrade to unlock this chapter';
    body.textContent = requiredRoleName
      ? ('This chapter requires the ' + requiredRoleName + ' plan. Upgrade to keep reading.')
      : "This chapter is beyond your current plan's chapter access. Upgrade to keep reading.";
    actions.innerHTML = '<button type="button" class="btn btn-primary" data-open-plan-modal data-upgrade-reason="This page needs a higher plan.">See plans</button><a href="dashboard-user.html" class="btn btn-ghost">Back to dashboard</a>';
  } else {
    heading.textContent = 'Sign in to keep reading';
    body.textContent = 'Create a free account or log in to read this chapter and save your progress across devices.';
    actions.innerHTML = '<a href="login.html" class="btn btn-primary">Log in</a><a href="signup.html" class="btn btn-ghost">Create free account</a>';
  }
}

// Checks the current chapter's minRole against the signed-in student's
// plan. Admins and unrestricted chapters always pass. Returns a promise
// resolving true/false so callers can decide whether to keep rendering.
// `student` is the doc ensureStudentDoc already resolved. Passing it in rather
// than re-reading matters: ensureStudentDoc heals a missing plan onto the
// document, and a second independent read could still be in flight when that
// write lands — seeing a blank plan and locking the reader out of a chapter
// the student is fully entitled to. Reusing the resolved object removes the
// race and saves a read.
function checkChapterRoleAccess(ch, uid, student){
  if (!uid || typeof db === 'undefined' || !db) return Promise.resolve(true); // guest banner handles the no-auth case separately

  const adminCheck = db.collection('admins').doc(uid).get();
  const rolesCheck = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();

  return Promise.all([adminCheck, rolesCheck]).then(([adminDoc]) => {
    if (adminDoc.exists) return true;
    const plan = student ? student.plan : null;
    window.__strykerCurrentPlan = plan;  // see plan-modal.js
    // Two independent checks, both must pass:
    // 1) this specific chapter's own minRole, if the admin set one directly on it
    const passesMinRole = ch.minRole ? hasRoleAccess(plan, ch.minRole) : true;
    // 2) the student's plan's bulk "chapter access" cutoff (e.g. Starter -> up to
    //    chapter 5), which applies to every chapter regardless of its own minRole
    const passesChapterLimit = (typeof hasChapterNumberAccess === 'function')
      ? hasChapterNumberAccess(plan, ch.num)
      : true;

    if (!passesMinRole || !passesChapterLimit) {
      // Says exactly which of the two checks refused and on what values.
      // Without this, "why is this locked" means reading three files and
      // guessing, which is how the last one took so long to find.
      console.warn('Stryker: chapter ' + ch.num + ' blocked —',
        'plan:', plan,
        '| chapter minRole:', ch.minRole || '(none)',
        '| passes minRole:', passesMinRole,
        '| plan chapter limit:', (typeof chapterLimitOf === 'function' ? chapterLimitOf(plan) : '?'),
        '| passes limit:', passesChapterLimit);
    }
    return passesMinRole && passesChapterLimit;
  }).catch((err) => {
    console.error('Stryker: chapter role check failed', err);
    return true; // fail open rather than lock students out on a transient error
  });
}

function buildTOC(activeIndex){
  const toc = document.getElementById('reader-toc-list');
  if (!toc) return;
  toc.innerHTML = '';
  const parts = [
    { key: 'foundation', label: 'Part I — Foundation' },
    { key: 'intermediate', label: 'Part II — Intermediate' },
    { key: 'advanced', label: 'Part III — Advanced' }
  ];
  parts.forEach(part => {
    const heading = document.createElement('div');
    heading.className = 'toc-part';
    heading.textContent = part.label;
    toc.appendChild(heading);

    CHAPTERS.forEach((ch, i) => {
      if (ch.level !== part.key) return;
      // three states per chapter: untouched, in progress (amber number),
      // complete (check). "In progress" = at least one lesson ticked.
      let started = false;
      for (let li = 0; li < ch.lessons.length; li++) {
        if (completedLessonsSet.has(ch.num + '-' + li)) { started = true; break; }
      }
      const item = document.createElement('a');
      item.href = 'chapter.html?ch=' + ch.num;
      item.className = 'toc-item' + (i === activeIndex ? ' current' : '') +
        (completedChaptersSet.has(ch.num) ? ' done' : (started ? ' started' : ''));
      item.innerHTML =
        '<span class="toc-num">' + ch.num + '</span>' +
        '<span>' + ch.title + '</span>' +
        '<svg class="toc-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';
      toc.appendChild(item);
    });
  });
}

// Casual-download deterrents. This does NOT prevent a technically determined
// person from capturing the video (screen recording or browser dev tools can
// always do that for anything played in a browser — only real DRM, which
// needs a licensed service, actually stops that). What this does stop:
// right-click "Save video as", drag-to-save, the native download button,
// keyboard shortcuts that trigger a save, and casually copying the raw file
// URL out of the page.
let VIDEO_HARDENED_ONCE = false;
function hardenVideoAgainstDownload(video){
  if (VIDEO_HARDENED_ONCE) return; // listeners only need attaching once, element is reused
  VIDEO_HARDENED_ONCE = true;

  video.addEventListener('contextmenu', (e) => e.preventDefault());
  video.addEventListener('dragstart', (e) => e.preventDefault());
  video.setAttribute('draggable', 'false');

  // Block Ctrl+S / Cmd+S while a video is focused or playing on this page.
  document.addEventListener('keydown', (e) => {
    const savingKey = (e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey);
    if (savingKey && document.getElementById('reader-video')) {
      e.preventDefault();
    }
  });
}

// Chapter content is inserted via innerHTML, and browsers silently ignore
// <script> tags that arrive that way — so a TradingView widget embedded
// directly in bodyHtml would never actually run. Instead, the content
// contains lightweight placeholder divs (class="tv-chart-embed", with a
// data-symbol and data-title), and this function finds them after the real
// HTML is in the DOM and injects a genuine, working widget into each one via
// createElement — which browsers DO execute.
function activateLiveCharts(container){
  container.querySelectorAll('.tv-chart-embed').forEach((slot) => {
    const symbol = slot.dataset.symbol;
    if (!symbol || slot.dataset.activated) return;
    slot.dataset.activated = '1';

    const title = slot.dataset.title || symbol;
    slot.innerHTML =
      '<div class="tv-chart-caption">' + title + ' — live, real price action</div>' +
      '<div class="tradingview-widget-container" style="height:420px;"><div class="tradingview-widget-container__widget" style="height:100%;"></div></div>';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.text = JSON.stringify({
      autosize: true,
      symbol: symbol,
      interval: '60',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      hide_side_toolbar: false,
      support_host: 'https://www.tradingview.com'
    });
    slot.querySelector('.tradingview-widget-container__widget').appendChild(script);
  });
}

function renderReader(){
  CURRENT_INDEX = getChapterIndexFromQuery();
  const ch = CHAPTERS[CURRENT_INDEX];
  if (!ch) return;

  document.title = 'Chapter ' + ch.num + ' — ' + ch.title + ' | Stryker Trading Academy';
  document.getElementById('reader-crumb-title').textContent = 'Chapter ' + ch.num;
  document.getElementById('reader-title').textContent = ch.title;

  const metaWrap = document.getElementById('reader-meta');
  metaWrap.innerHTML =
    '<span class="chapter-tag ' + LEVEL_TAG_CLASS[ch.level] + '">' + LEVEL_LABEL[ch.level] + '</span>' +
    '<span style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3);">' + ch.lessons.length + ' lessons</span>' +
    '<span style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3);">' + ch.dur + '</span>' +
    '<span style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3);">~' + estimateReadMinutes(ch) + ' min read</span>';

  const video = document.getElementById('reader-video');
  video.src = ch.video;
  video.load();
  hardenVideoAgainstDownload(video);
  setupVideoTools(video);
  setupVideoResume(video, ch);

  const body = document.getElementById('reader-body');
  body.innerHTML = ch.bodyHtml || (ch.paragraphs || []).map(p => '<p>' + p + '</p>').join('');
  activateLiveCharts(body);

  renderLessonList(ch);

  updateChapterProgressUI(ch);

  const prevBtn = document.getElementById('reader-prev');
  const nextBtn = document.getElementById('reader-next');
  if (CURRENT_INDEX > 0) {
    const p = CHAPTERS[CURRENT_INDEX - 1];
    prevBtn.style.visibility = 'visible';
    prevBtn.href = 'chapter.html?ch=' + p.num;
    prevBtn.querySelector('b').textContent = p.num + ' — ' + p.title;
  } else {
    prevBtn.style.visibility = 'hidden';
  }
  if (CURRENT_INDEX < CHAPTERS.length - 1) {
    const n = CHAPTERS[CURRENT_INDEX + 1];
    nextBtn.style.visibility = 'visible';
    nextBtn.href = 'chapter.html?ch=' + n.num;
    nextBtn.querySelector('b').textContent = n.num + ' — ' + n.title;
  } else {
    nextBtn.style.visibility = 'hidden';
  }

  buildTOC(CURRENT_INDEX);
  window.scrollTo({ top: 0 });
}

function updateChapterProgressUI(ch){
  const total = ch.lessons.length;
  let done = 0;
  ch.lessons.forEach((l, li) => { if (completedLessonsSet.has(ch.num + '-' + li)) done++; });
  const fill = document.getElementById('reader-progress-fill');
  const label = document.getElementById('reader-progress-label');
  if (fill) fill.style.width = Math.round((done/total)*100) + '%';
  if (label) label.textContent = done + ' / ' + total + ' lessons complete';

  const wasComplete = completedChaptersSet.has(ch.num);
  const markBtn = document.getElementById('reader-mark-complete');
  if (done === total && total > 0) {
    completedChaptersSet.add(ch.num);
    if (markBtn){ markBtn.textContent = 'Chapter complete ✓'; markBtn.classList.add('btn-ghost'); markBtn.classList.remove('btn-primary'); }
    showChapterCompleteCard(ch, !wasComplete);
  } else {
    completedChaptersSet.delete(ch.num);
    if (markBtn){ markBtn.textContent = 'Mark all lessons complete'; markBtn.classList.add('btn-primary'); markBtn.classList.remove('btn-ghost'); }
    const card = document.getElementById('reader-complete-card');
    if (card) card.remove();
  }
  updateResumeChip(ch, done, total);
  persistProgress();
  buildTOC(CURRENT_INDEX);
}

// ---------------------------------------------------------------------------
// Learning-flow layer: lesson accordions, resume chip, completion card,
// video speed/resume, reading time, scroll progress. All rendering-side —
// chapter CONTENT still comes from Firestore untouched.
// ---------------------------------------------------------------------------

const CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';

function firstIncompleteIndex(ch){
  for (let li = 0; li < ch.lessons.length; li++) {
    if (!completedLessonsSet.has(ch.num + '-' + li)) return li;
  }
  return -1;
}

// Renders the lesson list as focused accordions: the first unfinished lesson
// arrives open, finished ones arrive collapsed, and every open lesson ends
// with a "Mark done · continue" button that closes it and opens the next —
// so working through a chapter is one guided path instead of a wall of text.
function renderLessonList(ch, openIndex){
  const lessonsWrap = document.getElementById('reader-lessons');
  if (!lessonsWrap) return;
  lessonsWrap.innerHTML = '';
  if (openIndex === undefined) openIndex = firstIncompleteIndex(ch);

  ch.lessons.forEach((lesson, li) => {
    const lid = ch.num + '-' + li;
    const isDone = completedLessonsSet.has(lid);
    const open = li === openIndex;
    const block = document.createElement('div');
    block.className = 'lesson-block lv2' + (isDone ? ' done' : '') + (open ? ' open' : '');
    block.dataset.li = li;
    block.innerHTML =
      '<button type="button" class="lesson-head" aria-expanded="' + open + '">' +
        '<span class="lesson-check' + (isDone ? ' done' : '') + '" data-lid="' + lid + '" role="checkbox" aria-checked="' + isDone + '" aria-label="Mark lesson done">' + CHECK_SVG + '</span>' +
        '<h4>' + (li+1) + '. ' + lesson.title + '</h4>' +
        '<svg class="lesson-chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="lesson-body"><div class="lesson-body-in">' +
        '<div class="lesson-desc-rendered">' + (lesson.descHtml || ('<p>' + (lesson.desc || '') + '</p>')) + '</div>' +
        '<div class="lesson-actions"><button type="button" class="btn btn-sm ' + (isDone ? 'btn-ghost' : 'btn-primary') + ' lesson-done-next">' + (isDone ? 'Completed ✓' : 'Mark done · continue') + '</button></div>' +
      '</div></div>';

    block.querySelector('.lesson-head').addEventListener('click', (e) => {
      if (e.target.closest('.lesson-check')) { toggleLessonDone(ch, block, li); return; }
      const nowOpen = !block.classList.contains('open');
      block.classList.toggle('open', nowOpen);
      block.querySelector('.lesson-head').setAttribute('aria-expanded', nowOpen);
    });
    block.querySelector('.lesson-done-next').addEventListener('click', () => {
      const lid2 = ch.num + '-' + li;
      if (!completedLessonsSet.has(lid2)) toggleLessonDone(ch, block, li);
      block.classList.remove('open');
      block.querySelector('.lesson-head').setAttribute('aria-expanded', 'false');
      const next = firstIncompleteIndex(ch);
      if (next !== -1) {
        const nb = lessonsWrap.querySelector('.lesson-block[data-li="' + next + '"]');
        if (nb) {
          nb.classList.add('open');
          nb.querySelector('.lesson-head').setAttribute('aria-expanded', 'true');
          setTimeout(() => nb.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
        }
      } else {
        const card = document.getElementById('reader-complete-card');
        if (card) setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
      }
    });

    lessonsWrap.appendChild(block);
    activateLiveCharts(block);
  });
}

function toggleLessonDone(ch, block, li){
  const lid = ch.num + '-' + li;
  const nowDone = !completedLessonsSet.has(lid);
  if (nowDone) completedLessonsSet.add(lid); else completedLessonsSet.delete(lid);
  block.classList.toggle('done', nowDone);
  const check = block.querySelector('.lesson-check');
  check.classList.toggle('done', nowDone);
  check.setAttribute('aria-checked', nowDone);
  const btn = block.querySelector('.lesson-done-next');
  if (btn) {
    btn.textContent = nowDone ? 'Completed ✓' : 'Mark done · continue';
    btn.classList.toggle('btn-ghost', nowDone);
    btn.classList.toggle('btn-primary', !nowDone);
  }
  updateChapterProgressUI(ch);
}

// "Resume lesson N" chip in the lessons panel head — appears once the
// chapter is started but unfinished, and jumps to the first open item.
function updateResumeChip(ch, done, total){
  const head = document.querySelector('.panel-head');
  if (!head) return;
  let chip = document.getElementById('reader-resume-chip');
  const next = firstIncompleteIndex(ch);
  if (done > 0 && done < total && next !== -1) {
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'reader-resume-chip';
      chip.type = 'button';
      chip.className = 'reader-resume-chip';
      head.appendChild(chip);
      chip.addEventListener('click', () => {
        const wrap = document.getElementById('reader-lessons');
        const nb = wrap && wrap.querySelector('.lesson-block[data-li="' + firstIncompleteIndex(ch) + '"]');
        if (nb) {
          nb.classList.add('open');
          nb.querySelector('.lesson-head').setAttribute('aria-expanded', 'true');
          nb.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
    chip.textContent = 'Resume lesson ' + (next + 1) + ' ↓';
  } else if (chip) {
    chip.remove();
  }
}

// Completion card with the next chapter's door, shown under the lessons the
// moment every box is ticked. `celebrate` also fires a toast, only on the
// transition — not on every re-render of an already-finished chapter.
function showChapterCompleteCard(ch, celebrate){
  if (document.getElementById('reader-complete-card')) return;
  const row = document.querySelector('.mark-complete-row');
  if (!row) return;
  const next = CHAPTERS[CURRENT_INDEX + 1];
  const card = document.createElement('div');
  card.id = 'reader-complete-card';
  card.className = 'reader-complete-card';
  card.innerHTML =
    '<div class="rcc-glyph">🏁</div>' +
    '<div class="rcc-body"><h3>Chapter ' + ch.num + ' complete</h3>' +
    '<p>' + (next ? 'Next up: <b>Chapter ' + next.num + ' — ' + next.title + '</b>' : 'That was the final chapter of the curriculum. Well traded.') + '</p></div>' +
    (next ? '<a class="btn btn-primary" href="chapter.html?ch=' + next.num + '">Start Chapter ' + next.num + ' →</a>' : '<a class="btn btn-ghost" href="courses.html">Back to curriculum</a>');
  row.insertAdjacentElement('afterend', card);
  if (celebrate && typeof showToast === 'function') {
    showToast('success', 'Chapter ' + ch.num + ' complete' + (next ? ' — Chapter ' + next.num + ' is open.' : '!'));
  }
}

// Word-count estimate over the chapter body plus every lesson, at a reading
// pace of 200 wpm. Cheap, deterministic, and honest enough for a chip.
function estimateReadMinutes(ch){
  const strip = (h) => String(h || '').replace(/<[^>]*>/g, ' ');
  let text = strip(ch.bodyHtml) + ' ' + (ch.paragraphs || []).join(' ');
  (ch.lessons || []).forEach(l => { text += ' ' + strip(l.descHtml || l.desc); });
  const words = (text.match(/\S+/g) || []).length;
  return Math.max(1, Math.round(words / 200));
}

// Speed pills under the video. The chosen rate persists per device and
// re-applies to every chapter's video.
let VIDEO_TOOLS_BUILT = false;
function setupVideoTools(video){
  let saved = 1;
  try { saved = parseFloat(localStorage.getItem('stryker_video_rate')) || 1; } catch(e) {}
  if (!VIDEO_TOOLS_BUILT) {
    VIDEO_TOOLS_BUILT = true;
    const frame = document.querySelector('.video-frame');
    if (frame) {
      const tools = document.createElement('div');
      tools.id = 'video-tools';
      tools.className = 'video-tools';
      tools.innerHTML = '<span class="vt-label">SPEED</span>' +
        [0.75, 1, 1.25, 1.5, 1.75, 2].map(r =>
          '<button type="button" class="vt-rate' + (r === saved ? ' on' : '') + '" data-r="' + r + '">' + r + '×</button>').join('');
      frame.insertAdjacentElement('afterend', tools);
      tools.addEventListener('click', (e) => {
        const b = e.target.closest('.vt-rate');
        if (!b) return;
        const r = parseFloat(b.dataset.r);
        video.playbackRate = r;
        try { localStorage.setItem('stryker_video_rate', String(r)); } catch(err) {}
        tools.querySelectorAll('.vt-rate').forEach(x => x.classList.toggle('on', x === b));
      });
    }
  }
  video.playbackRate = saved;
  video.addEventListener('loadedmetadata', () => { video.playbackRate = saved; }, { once: true });
}

// Per-chapter playback position, saved to this device every few seconds and
// restored on return (skipped near the very start or end of the video).
let VIDEO_RESUME_BOUND = false;
let VIDEO_RESUME_KEY = null;
function setupVideoResume(video, ch){
  VIDEO_RESUME_KEY = 'stryker_vidpos_' + ch.num;
  let restored = null;
  try { restored = parseFloat(localStorage.getItem(VIDEO_RESUME_KEY)); } catch(e) {}
  video.addEventListener('loadedmetadata', () => {
    if (restored && restored > 10 && video.duration && restored < video.duration - 20) {
      video.currentTime = restored;
      if (typeof showToast === 'function') showToast('info', 'Video resumed where you left off.');
    }
  }, { once: true });

  if (VIDEO_RESUME_BOUND) return;
  VIDEO_RESUME_BOUND = true;
  let lastSave = 0;
  video.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - lastSave < 5000 || !VIDEO_RESUME_KEY) return;
    lastSave = now;
    try {
      if (video.currentTime > 10 && video.duration && video.currentTime < video.duration - 20) {
        localStorage.setItem(VIDEO_RESUME_KEY, String(Math.floor(video.currentTime)));
      }
    } catch(e) {}
  });
  video.addEventListener('ended', () => {
    try { if (VIDEO_RESUME_KEY) localStorage.removeItem(VIDEO_RESUME_KEY); } catch(e) {}
  });
}

// Thin gold reading-progress bar along the top of the chapter page.
(function initReaderScrollBar(){
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('reader-content-wrap')) return;
    const bar = document.createElement('div');
    bar.className = 'reader-scrollbar';
    document.body.appendChild(bar);
    let ticking = false;
    function update(){
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ')';
      ticking = false;
    }
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  });
})();

function markAllComplete(){
  const ch = CHAPTERS[CURRENT_INDEX];
  ch.lessons.forEach((l, li) => completedLessonsSet.add(ch.num + '-' + li));
  persistProgress();
  renderReader();
}

document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('reader-body');
  if (body) showLoadingAnimation(body, 'Loading chapter…');

  loadChapters().then(() => {
    const local = loadLocalProgress();
    completedLessonsSet = new Set(local.completedLessons);
    completedChaptersSet = new Set(local.completedChapters);
    renderReader();

    if (!auth) {
      // Firebase failed to init — chapter still works fully in local/guest
      // mode (progress just saves to this device only).
      setPaywallMessage('signin');
      showGuestBanner(true);
      revealReaderContent();
      return;
    }

    auth.onAuthStateChanged((user) => {
      if (user) {
        CURRENT_UID = user.uid;
        showGuestBanner(false);
        ensureStudentDoc(user).then((student) => {
          completedLessonsSet = new Set((student && student.completedLessons) || []);
          completedChaptersSet = new Set((student && student.completedChapters) || []);
          CURRENT_BEST_STREAK = (student && student.bestStreak) || 0;
          CURRENT_NOTIFIED_ACHIEVEMENTS = (student && student.notifiedAchievements) || [];
          renderReader();
          applyChapterRoleGate(user.uid, student);
        }).catch(err => console.error('Stryker: failed to load progress from Firestore', err));
      } else {
        CURRENT_UID = null;
        setPaywallMessage('signin');
        showGuestBanner(true);
        revealReaderContent();
      }
    });
  });
});

function applyChapterRoleGate(uid, student){
  const ch = CHAPTERS[CURRENT_INDEX];
  if (!ch) { revealReaderContent(); return; }
  checkChapterRoleAccess(ch, uid, student).then((allowed) => {
    if (!allowed) {
      // The specific chapter's own minRole (if set) is the most precise
      // thing to name in the message; otherwise this was blocked by the
      // student's plan-wide chapter cutoff, so no single role name applies.
      const requiredName = (ch.minRole && typeof labelOf === 'function') ? labelOf(ch.minRole) : null;
      setPaywallMessage('role', requiredName);
      showGuestBanner(true);
    }
    revealReaderContent();
  });
}
