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

function persistProgress(){
  if (CURRENT_UID) {
    saveStudentProgress(CURRENT_UID, completedLessonsSet, completedChaptersSet)
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
    actions.innerHTML = '<a href="index.html#pricing" class="btn btn-primary">See plans</a><a href="dashboard-user.html" class="btn btn-ghost">Back to dashboard</a>';
  } else {
    heading.textContent = 'Sign in to keep reading';
    body.textContent = 'Create a free account or log in to read this chapter and save your progress across devices.';
    actions.innerHTML = '<a href="login.html" class="btn btn-primary">Log in</a><a href="signup.html" class="btn btn-ghost">Create free account</a>';
  }
}

// Checks the current chapter's minRole against the signed-in student's
// plan. Admins and unrestricted chapters always pass. Returns a promise
// resolving true/false so callers can decide whether to keep rendering.
function checkChapterRoleAccess(ch, uid){
  if (!uid || typeof db === 'undefined' || !db) return Promise.resolve(true); // guest banner handles the no-auth case separately

  // All three reads are independent — run them in parallel rather than
  // chained, since chaining triples the wait on a slow connection for no
  // benefit (nothing here depends on another read's result until they've
  // all come back).
  const adminCheck = db.collection('admins').doc(uid).get();
  const studentCheck = db.collection('students').doc(uid).get();
  const rolesCheck = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();

  return Promise.all([adminCheck, studentCheck, rolesCheck]).then(([adminDoc, studentDoc]) => {
    if (adminDoc.exists) return true;
    const plan = studentDoc.exists ? studentDoc.data().plan : null;
    // Two independent checks, both must pass:
    // 1) this specific chapter's own minRole, if the admin set one directly on it
    const passesMinRole = ch.minRole ? hasRoleAccess(plan, ch.minRole) : true;
    // 2) the student's plan's bulk "chapter access" cutoff (e.g. Starter -> up to
    //    chapter 5), which applies to every chapter regardless of its own minRole
    const passesChapterLimit = (typeof hasChapterNumberAccess === 'function')
      ? hasChapterNumberAccess(plan, ch.num)
      : true;
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
      const item = document.createElement('a');
      item.href = 'chapter.html?ch=' + ch.num;
      item.className = 'toc-item' + (i === activeIndex ? ' current' : '') + (completedChaptersSet.has(ch.num) ? ' done' : '');
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
    '<span style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3);">' + ch.dur + '</span>';

  const video = document.getElementById('reader-video');
  video.src = ch.video;
  video.load();
  hardenVideoAgainstDownload(video);

  const body = document.getElementById('reader-body');
  body.innerHTML = ch.bodyHtml || (ch.paragraphs || []).map(p => '<p>' + p + '</p>').join('');
  activateLiveCharts(body);

  const lessonsWrap = document.getElementById('reader-lessons');
  lessonsWrap.innerHTML = '';
  ch.lessons.forEach((lesson, li) => {
    const lid = ch.num + '-' + li;
    const block = document.createElement('div');
    block.className = 'lesson-block';
    block.innerHTML =
      '<div class="lesson-check' + (completedLessonsSet.has(lid) ? ' done' : '') + '" data-lid="' + lid + '">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' +
      '</div>' +
      '<div><h4>' + (li+1) + '. ' + lesson.title + '</h4><div class="lesson-desc-rendered">' + (lesson.descHtml || ('<p>' + (lesson.desc || '') + '</p>')) + '</div></div>';
    block.querySelector('.lesson-check').addEventListener('click', function(){
      this.classList.toggle('done');
      if (this.classList.contains('done')) completedLessonsSet.add(lid);
      else completedLessonsSet.delete(lid);
      updateChapterProgressUI(ch);
    });
    lessonsWrap.appendChild(block);
    activateLiveCharts(block);
  });

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

  const markBtn = document.getElementById('reader-mark-complete');
  if (done === total) {
    completedChaptersSet.add(ch.num);
    if (markBtn){ markBtn.textContent = 'Chapter complete ✓'; markBtn.classList.add('btn-ghost'); markBtn.classList.remove('btn-primary'); }
  } else {
    completedChaptersSet.delete(ch.num);
    if (markBtn){ markBtn.textContent = 'Mark all lessons complete'; markBtn.classList.add('btn-primary'); markBtn.classList.remove('btn-ghost'); }
  }
  persistProgress();
  buildTOC(CURRENT_INDEX);
}

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
          renderReader();
          applyChapterRoleGate(user.uid);
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

function applyChapterRoleGate(uid){
  const ch = CHAPTERS[CURRENT_INDEX];
  if (!ch) { revealReaderContent(); return; }
  checkChapterRoleAccess(ch, uid).then((allowed) => {
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
