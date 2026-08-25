// Stryker Trading Academy — Admin: Trading Models list (models-admin.html)
// Mirrors assets/chapters-admin.js.

function renderModelList(){
  const container = document.getElementById('model-list');
  const countEl = document.getElementById('model-count');
  if (!container) return;

  if (countEl) countEl.textContent = MODELS.length + ' model' + (MODELS.length === 1 ? '' : 's');

  if (!MODELS.length) {
    container.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No trading models yet. Click "+ Add new model" to create the first one.</p>';
    return;
  }

  container.innerHTML = '';
  const sorted = MODELS.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  sorted.forEach((m) => {
    const card = document.createElement('div');
    card.className = 'record-card';
    card.innerHTML =
      '<div style="flex:1 1 260px;">' +
        '<span class="cell-name">' + (m.name || 'Untitled model') + '</span>' +
        '<div class="chapter-meta" style="margin-top:6px;">' +
          (m.category ? '<span class="chapter-tag tag-intermediate">' + m.category + '</span>' : '') +
          '<span>' + (m.steps ? m.steps.length : 0) + ' steps</span>' +
        '</div>' +
        (m.summary ? '<p style="font-size:12.5px; color:var(--ink-3); margin-top:6px; max-width:520px;">' + m.summary + '</p>' : '') +
      '</div>' +
      '<div style="display:flex; gap:8px;">' +
        '<a href="model.html?id=' + encodeURIComponent(m.id) + '" class="btn btn-ghost btn-sm" target="_blank">View</a>' +
        '<a href="model-editor.html?id=' + encodeURIComponent(m.id) + '" class="btn btn-primary btn-sm">Edit</a>' +
      '</div>';
    container.appendChild(card);
  });
}

function importBundledModels(triggerBtn){
  if (typeof MODELS_SEED === 'undefined' || !MODELS_SEED.length) {
    alert('No bundled trading models exist yet to import from.');
    return;
  }
  if (!confirm('Update all ' + MODELS_SEED.length + ' bundled models into Firestore? This overwrites any matching model currently saved with whatever is in the bundled seed right now.')) return;

  const errEl = document.getElementById('update-all-models-error');
  const okEl = document.getElementById('update-all-models-success');
  if (errEl) errEl.style.display = 'none';
  if (okEl) okEl.style.display = 'none';
  if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = 'Updating…'; }

  const writes = MODELS_SEED.map((m) =>
    db.collection('models').doc(m.id).set(m)
      .then(() => ({ id: m.id, ok: true }))
      .catch((err) => ({ id: m.id, ok: false, error: err && (err.message || String(err)) }))
  );

  if (typeof logActivity === 'function') logActivity('content.model_saved',
    'Published the trading model set (' + writes.length + ' models)');

  Promise.allSettled(writes)
    .then((results) => {
      const outcomes = results.map((r) => r.value || { ok: false, error: 'unknown failure' });
      const failed = outcomes.filter((o) => !o.ok);
      const succeeded = outcomes.filter((o) => o.ok);
      return loadModels(true).then(() => ({ failed, succeeded }));
    })
    .then(({ failed, succeeded }) => {
      renderModelList();
      if (failed.length === 0) {
        if (okEl) { okEl.textContent = 'All ' + succeeded.length + ' models updated.'; okEl.style.display = 'block'; }
      } else {
        const msg = failed.length + ' of ' + MODELS_SEED.length + ' models FAILED: ' + failed.map((f) => f.id).join(', ') + '. First error: ' + failed[0].error;
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } else { alert(msg); }
      }
    })
    .finally(() => {
      if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = 'Update all'; }
    });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    loadModels()
      .then(() => renderModelList())
      .catch((err) => {
        console.error('Stryker: failed to load trading models admin page', err);
        document.getElementById('model-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load: ' + (err.message || err) + '</p>';
      });

    document.getElementById('update-all-models-btn').addEventListener('click', (e) => importBundledModels(e.target));
  });
});
