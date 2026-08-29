// Stryker Trading Academy — single Trading Model reader (model.html)
// Mirrors assets/reader.js, simplified: models don't track per-step
// completion the way chapters track per-lesson completion.

function getModelIdFromQuery(){
  return new URLSearchParams(window.location.search).get('id');
}

function showModelGuestBanner(show){
  const overlay = document.getElementById('guest-paywall-overlay');
  const content = document.getElementById('reader-content-wrap');
  if (overlay) overlay.style.display = show ? 'flex' : 'none';
  if (content) content.classList.toggle('paywall-dimmed', show);
}

// Only called once an access decision has actually been made — reveals the
// reader content for the first time. If showModelGuestBanner already applied
// .paywall-dimmed in this same code path, content becomes visible
// already-dimmed, so a denied visitor never sees a sharp, readable frame of
// gated content before the paywall catches up.
function revealModelReaderContent(){
  const gateOverlay = document.getElementById('access-gate-overlay');
  const content = document.getElementById('reader-content-wrap');
  if (gateOverlay) gateOverlay.style.display = 'none';
  if (content) content.classList.remove('gate-pending');
}

function setModelPaywallMessage(reason, requiredRoleName){
  const heading = document.getElementById('paywall-heading');
  const body = document.getElementById('paywall-body');
  const actions = document.getElementById('paywall-actions');
  if (!heading || !body || !actions) return;
  if (reason === 'role') {
    heading.textContent = 'Upgrade to unlock this model';
    body.textContent = 'This model requires the ' + (requiredRoleName || 'a higher') + ' plan. Upgrade to keep reading.';
    actions.innerHTML = '<button type="button" class="btn btn-primary" data-open-plan-modal data-upgrade-reason="This page needs a higher plan.">See plans</button><a href="dashboard-user.html" class="btn btn-ghost">Back to dashboard</a>';
  } else {
    heading.textContent = 'Sign in to keep reading';
    body.textContent = "Create a free account or log in to read this model's full write-up.";
    actions.innerHTML = '<a href="login.html" class="btn btn-primary">Log in</a><a href="signup.html" class="btn btn-ghost">Create free account</a>';
  }
}

function checkModelRoleAccess(m, uid){
  if (!uid || typeof db === 'undefined' || !db) return Promise.resolve(true);

  // Run independent reads in parallel — see reader.js's checkChapterRoleAccess
  // for why this matters (chaining triples the wait for no benefit).
  const adminCheck = db.collection('admins').doc(uid).get();
  const studentCheck = db.collection('students').doc(uid).get();
  const rolesCheck = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
  const pageAccessCheck = (typeof loadPageAccess === 'function') ? loadPageAccess() : Promise.resolve({});

  return Promise.all([adminCheck, studentCheck, rolesCheck, pageAccessCheck]).then(([adminDoc, studentDoc, , pageAccess]) => {
    if (adminDoc.exists) return true;
    const plan = studentDoc.exists ? studentDoc.data().plan : null;
    window.__strykerCurrentPlan = plan;  // see plan-modal.js

    // Section-wide restriction, set in Roles & Access for "Trading models"
    // as a whole (independent of any individual model's own minRole below).
    // This reader has no view-only UI, so a 'view' tier is treated as
    // readable, same as 'full' — only 'blocked' actually denies here.
    const pageConfig = pageAccess ? pageAccess['models'] : null;
    const pageLevel = (typeof getPageAccessLevel === 'function') ? getPageAccessLevel(plan, pageConfig) : 'full';
    if (pageLevel === 'blocked') return false;

    // This specific model's own minRole, if the admin set one directly on it.
    return m.minRole ? hasRoleAccess(plan, m.minRole) : true;
  }).catch((err) => {
    console.error('Stryker: model role check failed', err);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Playbook checklist. Models don't have per-lesson completion the way chapters
// do, but working through a model's criteria is exactly the kind of thing you
// want to keep your place in — so each step can be ticked off, saved locally
// per model (no Firestore write, no plan gating), and read back on the models
// list as a progress bar on that model's card.
// ---------------------------------------------------------------------------

function modelStepsKey(id){ return 'stryker_model_steps_' + id; }

function readModelSteps(id){
  try {
    const raw = localStorage.getItem(modelStepsKey(id));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function writeModelSteps(id, arr){
  try { localStorage.setItem(modelStepsKey(id), JSON.stringify(arr)); } catch (e) {}
}

function updateModelStepProgress(m){
  const total = (m.steps || []).length;
  const done = readModelSteps(m.id).filter(Boolean).length;
  const bar = document.getElementById('model-step-bar');
  const txt = document.getElementById('model-step-count');
  const card = document.getElementById('model-done-card');
  if (bar) bar.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
  if (txt) txt.textContent = done + ' of ' + total + ' steps checked';
  if (card) card.style.display = (total && done === total) ? '' : 'none';
}

function toggleModelStep(m, i, on){
  const arr = readModelSteps(m.id);
  while (arr.length < (m.steps || []).length) arr.push(false);
  arr[i] = on;
  writeModelSteps(m.id, arr);
  updateModelStepProgress(m);
}

function buildModelTOC(activeId){
  const toc = document.getElementById('model-toc-list');
  if (!toc) return;
  toc.innerHTML = '';

  const sorted = MODELS.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const byCat = {};
  sorted.forEach((m) => {
    const c = (m.category || 'Other').trim() || 'Other';
    (byCat[c] = byCat[c] || []).push(m);
  });

  Object.keys(byCat).sort().forEach((cat) => {
    const label = document.createElement('div');
    label.className = 'toc-cat';
    label.textContent = cat;
    toc.appendChild(label);

    byCat[cat].forEach((m) => {
      const total = (m.steps || []).length;
      const done = readModelSteps(m.id).filter(Boolean).length;
      const item = document.createElement('a');
      item.href = 'model.html?id=' + encodeURIComponent(m.id);
      item.className = 'toc-item' + (m.id === activeId ? ' current' : '') +
        (total && done === total ? ' done' : (done ? ' started' : ''));
      item.innerHTML = '<span>' + (m.name || 'Untitled') + '</span>' +
        (done ? '<em class="toc-mini">' + done + '/' + total + '</em>' : '');
      toc.appendChild(item);
    });
  });
}

// Same casual-download deterrents as the chapter video player.
function hardenModelVideoAgainstDownload(video){
  video.addEventListener('contextmenu', (e) => e.preventDefault());
  video.addEventListener('dragstart', (e) => e.preventDefault());
  video.setAttribute('draggable', 'false');
  document.addEventListener('keydown', (e) => {
    const savingKey = (e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey);
    if (savingKey && document.getElementById('model-video')) e.preventDefault();
  });
}

// The model before/after this one alphabetically — the same order the list
// and the sidebar use, so "next model" means what the reader expects.
function modelNeighbours(id){
  const sorted = MODELS.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const i = sorted.findIndex((x) => x.id === id);
  return { prev: i > 0 ? sorted[i - 1] : null, next: i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null };
}

function renderModelHero(m){
  const head = document.querySelector('.reader-head');
  if (!head || typeof modelSceneHtml !== 'function') return;
  let hero = document.getElementById('model-hero');
  if (!hero) {
    hero = document.createElement('div');
    hero.id = 'model-hero';
    hero.className = 'mdl-hero';
    head.parentNode.insertBefore(hero, head);
  }
  hero.innerHTML = modelSceneHtml(m);
}

function renderModel(m){
  document.getElementById('model-crumb-title').textContent = m.name || 'Model';
  document.getElementById('model-title').textContent = m.name || 'Untitled model';

  const mins = (typeof modelReadMinutes === 'function') ? modelReadMinutes(m) : 0;
  document.getElementById('model-meta').innerHTML =
    (m.category ? '<span class="chapter-tag tag-intermediate">' + m.category + '</span>' : '') +
    '<span class="mdl-meta-mono">' + (m.steps ? m.steps.length : 0) + ' steps</span>' +
    (mins ? '<span class="mdl-meta-mono">· ' + mins + ' min read</span>' : '');

  renderModelHero(m);

  if (m.video) {
    document.getElementById('model-video-frame').style.display = '';
    document.getElementById('model-video-note').style.display = '';
    const video = document.getElementById('model-video');
    video.src = m.video;
    video.load();
    hardenModelVideoAgainstDownload(video);
  }

  const body = document.getElementById('model-body');
  body.innerHTML = m.bodyHtml || (m.paragraphs || []).map(p => '<p>' + p + '</p>').join('');

  // ---- steps as a working checklist ---------------------------------------
  const stepsWrap = document.getElementById('model-steps');
  const saved = readModelSteps(m.id);
  stepsWrap.innerHTML = '';

  const bar = document.createElement('div');
  bar.className = 'mdl-step-head';
  bar.innerHTML =
    '<div class="mdl-step-barwrap"><span id="model-step-bar"></span></div>' +
    '<div class="mdl-step-meta"><span id="model-step-count"></span>' +
    '<button type="button" class="mdl-step-reset" id="model-step-reset">Reset</button></div>';
  stepsWrap.appendChild(bar);

  (m.steps || []).forEach((step, i) => {
    const block = document.createElement('div');
    block.className = 'lesson-block mdl-step' + (saved[i] ? ' checked' : '');
    block.innerHTML =
      '<button type="button" class="mdl-step-tick" aria-pressed="' + (saved[i] ? 'true' : 'false') +
        '" aria-label="Mark step ' + (i + 1) + ' as learned"><i>' + (i + 1) + '</i>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></button>' +
      '<div><h4>' + (step.title || 'Step ' + (i + 1)) + '</h4>' +
      '<div class="lesson-desc-rendered">' + (step.descHtml || ('<p>' + (step.desc || '') + '</p>')) + '</div></div>';

    block.querySelector('.mdl-step-tick').addEventListener('click', function (){
      const on = !block.classList.contains('checked');
      block.classList.toggle('checked', on);
      this.setAttribute('aria-pressed', on ? 'true' : 'false');
      toggleModelStep(m, i, on);
      buildModelTOC(m.id);
    });

    stepsWrap.appendChild(block);
  });

  const doneCard = document.createElement('div');
  doneCard.id = 'model-done-card';
  doneCard.className = 'mdl-done';
  doneCard.style.display = 'none';
  doneCard.innerHTML =
    '<h3>Every step of this model is checked off</h3>' +
    '<p>Next: take it to the journal. Log the model by name on your next trades so you build real data on whether it works for you — and re-read the walkthrough before you size up.</p>' +
    '<div class="mdl-done-acts"><a class="btn btn-primary btn-sm" href="trade-journal.html">Open the journal</a>' +
    '<a class="btn btn-ghost btn-sm" href="models.html">Back to all models</a></div>';
  stepsWrap.appendChild(doneCard);

  const reset = document.getElementById('model-step-reset');
  if (reset) reset.addEventListener('click', function (){
    writeModelSteps(m.id, []);
    renderModel(m);
  });

  // ---- previous / next model ----------------------------------------------
  const nb = modelNeighbours(m.id);
  let nav = document.getElementById('model-neighbours');
  if (!nav) {
    nav = document.createElement('div');
    nav.id = 'model-neighbours';
    nav.className = 'mdl-nav';
    const main = document.querySelector('.reader-main');
    if (main) main.appendChild(nav);
  }
  nav.innerHTML =
    (nb.prev ? '<a class="mdl-nav-item" href="model.html?id=' + encodeURIComponent(nb.prev.id) + '">' +
      '<span>← Previous model</span><b>' + (nb.prev.name || '') + '</b></a>' : '<span></span>') +
    (nb.next ? '<a class="mdl-nav-item next" href="model.html?id=' + encodeURIComponent(nb.next.id) + '">' +
      '<span>Next model →</span><b>' + (nb.next.name || '') + '</b></a>' : '<span></span>');

  updateModelStepProgress(m);
  buildModelTOC(m.id);
  window.scrollTo({ top: 0 });
}

document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('model-body');
  if (body) showLoadingAnimation(body, 'Loading model…');

  loadModels().then(() => {
    const id = getModelIdFromQuery();
    const m = MODELS.find((x) => x.id === id) || MODELS[0];
    if (!m) {
      if (body) body.innerHTML = '<p style="color:var(--ink-3);">No trading models found.</p>';
      revealModelReaderContent();
      return;
    }
    renderModel(m);

    if (!auth) { setModelPaywallMessage('signin'); showModelGuestBanner(true); revealModelReaderContent(); return; }
    auth.onAuthStateChanged((user) => {
      if (!user) {
        setModelPaywallMessage('signin');
        showModelGuestBanner(true);
        revealModelReaderContent();
        return;
      }
      showModelGuestBanner(false);
      checkModelRoleAccess(m, user.uid).then((allowed) => {
        if (!allowed) {
          const requiredName = (typeof labelOf === 'function') ? labelOf(m.minRole) : null;
          setModelPaywallMessage('role', requiredName);
          showModelGuestBanner(true);
        }
        revealModelReaderContent();
      });
    });
  });
});
