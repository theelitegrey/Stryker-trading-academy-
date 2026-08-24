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
  if (body) body.innerHTML = '<p style="color:var(--ink-3);">Loading model…</p>';

  loadModels().then(() => {
    const id = getModelIdFromQuery();
    const m = MODELS.find((x) => x.id === id) || MODELS[0];
    if (!m) {
      if (body) body.innerHTML = '<p style="color:var(--ink-3);">No trading models found.</p>';
      return;
    }
    renderModel(m);

    if (!auth) { showModelGuestBanner(true); return; }
    auth.onAuthStateChanged((user) => { showModelGuestBanner(!user); });
  });
});
