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
    actions.innerHTML = '<a href="index.html#pricing" class="btn btn-primary">See plans</a><a href="dashboard-user.html" class="btn btn-ghost">Back to dashboard</a>';
  } else {
    heading.textContent = 'Sign in to keep reading';
    body.textContent = "Create a free account or log in to read this model's full write-up.";
    actions.innerHTML = '<a href="login.html" class="btn btn-primary">Log in</a><a href="signup.html" class="btn btn-ghost">Create free account</a>';
  }
}

function checkModelRoleAccess(m, uid){
  if (!m.minRole) return Promise.resolve(true);
  if (!uid || typeof db === 'undefined' || !db) return Promise.resolve(true);

  // Run independent reads in parallel — see reader.js's checkChapterRoleAccess
  // for why this matters (chaining triples the wait for no benefit).
  const adminCheck = db.collection('admins').doc(uid).get();
  const studentCheck = db.collection('students').doc(uid).get();
  const rolesCheck = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();

  return Promise.all([adminCheck, studentCheck, rolesCheck]).then(([adminDoc, studentDoc]) => {
    if (adminDoc.exists) return true;
    const plan = studentDoc.exists ? studentDoc.data().plan : null;
    return hasRoleAccess(plan, m.minRole);
  }).catch((err) => {
    console.error('Stryker: model role check failed', err);
    return true;
  });
}

function buildModelTOC(activeId){
  const toc = document.getElementById('model-toc-list');
  if (!toc) return;
  toc.innerHTML = '';
  MODELS.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach((m) => {
    const item = document.createElement('a');
    item.href = 'model.html?id=' + encodeURIComponent(m.id);
    item.className = 'toc-item' + (m.id === activeId ? ' current' : '');
    item.innerHTML = '<span>' + (m.name || 'Untitled') + '</span>';
    toc.appendChild(item);
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

function renderModel(m){
  document.getElementById('model-crumb-title').textContent = m.name || 'Model';
  document.getElementById('model-title').textContent = m.name || 'Untitled model';
  document.getElementById('model-meta').innerHTML =
    (m.category ? '<span class="chapter-tag tag-intermediate">' + m.category + '</span>' : '') +
    '<span style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3);">' + (m.steps ? m.steps.length : 0) + ' steps</span>';

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

  const stepsWrap = document.getElementById('model-steps');
  stepsWrap.innerHTML = '';
  (m.steps || []).forEach((step, i) => {
    const block = document.createElement('div');
    block.className = 'lesson-block';
    block.innerHTML =
      '<div style="width:22px; height:22px; border-radius:50%; background:var(--bg-2); border:1px solid var(--line); display:flex; align-items:center; justify-content:center; font-family:var(--font-mono); font-size:11px; color:var(--ink-2); flex-shrink:0;">' + (i + 1) + '</div>' +
      '<div><h4>' + (step.title || 'Step ' + (i + 1)) + '</h4><div class="lesson-desc-rendered">' + (step.descHtml || ('<p>' + (step.desc || '') + '</p>')) + '</div></div>';
    stepsWrap.appendChild(block);
  });

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
