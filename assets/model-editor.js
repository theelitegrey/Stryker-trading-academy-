// Stryker Trading Academy — dedicated Trading Model Editor (model-editor.html)
// Mirrors assets/chapter-editor.js almost exactly, with model-specific fields
// (id/slug, category, summary, steps instead of lessons).

let EDITING_ID = null;
let IS_NEW_MODEL = false;

function getQueryParam(name){
  return new URLSearchParams(window.location.search).get(name);
}

function slugify(str){
  return String(str || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function htmlToParagraphs(html){
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const blocks = tmp.querySelectorAll('p, li, h3');
  const out = [];
  blocks.forEach((b) => { const t = b.textContent.trim(); if (t) out.push(t); });
  if (!out.length) {
    const plain = tmp.textContent.trim();
    if (plain) out.push(plain);
  }
  return out.length ? out : [''];
}

function stepRowHtml(step, idx){
  const descHtml = step.descHtml || (step.desc ? '<p>' + String(step.desc).replace(/</g, '&lt;') + '</p>' : '');
  return (
    '<div class="lesson-edit-row" data-step-idx="' + idx + '">' +
      '<div class="field"><label>Step ' + (idx + 1) + ' title</label><input type="text" class="step-title-input" value="' + (step.title || '').replace(/"/g, '&quot;') + '"></div>' +
      '<div class="field" style="flex:2 1 260px;"><label>Description</label>' +
        '<div class="rte-editable step-desc-editable" contenteditable="true" data-placeholder="What this step covers…" style="min-height:60px; font-size:13.5px; padding:10px 12px;">' + descHtml + '</div>' +
      '</div>' +
      '<button type="button" class="icon-btn remove-step-btn" title="Remove step"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
    '</div>'
  );
}

function renderStepRows(steps){
  const wrap = document.getElementById('step-edit-rows');
  wrap.innerHTML = steps.map((s, i) => stepRowHtml(s, i)).join('');
  wireRemoveButtons();
  trackStepEditableFocus();
}

let LAST_FOCUSED_EDITABLE = null;

function trackStepEditableFocus(){
  document.querySelectorAll('.step-desc-editable').forEach((el) => {
    el.addEventListener('focus', () => { LAST_FOCUSED_EDITABLE = el; });
  });
}

function wireRemoveButtons(){
  document.querySelectorAll('.remove-step-btn').forEach((btn) => {
    btn.onclick = () => {
      const rows = document.querySelectorAll('.lesson-edit-row');
      if (rows.length <= 1) { alert('A model needs at least one step.'); return; }
      btn.closest('.lesson-edit-row').remove();
    };
  });
}

function loadModelIntoForm(m){
  document.getElementById('ed-id').value = m.id || '';
  document.getElementById('ed-id').disabled = !IS_NEW_MODEL; // id is the doc ID — fixed once created
  document.getElementById('ed-name').value = m.name || '';
  document.getElementById('ed-category').value = m.category || '';
  document.getElementById('ed-summary').value = m.summary || '';
  document.getElementById('ed-video').value = m.video || '';

  const bodyEl = document.getElementById('ed-body');
  bodyEl.innerHTML = m.bodyHtml || '';
  bodyEl.setAttribute('data-placeholder', 'Write the full model write-up here…');

  renderStepRows(m.steps && m.steps.length ? m.steps : [{ title: '', desc: '' }]);

  document.getElementById('editor-heading').textContent = IS_NEW_MODEL ? 'New trading model' : ('Edit: ' + (m.name || m.id));
  document.getElementById('editor-subheading').textContent = m.category || 'No category set';
}

function collectFormData(){
  const steps = [];
  document.querySelectorAll('.lesson-edit-row').forEach((row) => {
    const title = row.querySelector('.step-title-input').value.trim();
    const descEl = row.querySelector('.step-desc-editable');
    const descHtml = descEl.innerHTML.trim();
    const descPlain = descEl.textContent.trim();
    if (title || descPlain) steps.push({ title, desc: descPlain, descHtml: descHtml });
  });

  const bodyHtml = document.getElementById('ed-body').innerHTML;
  const rawId = document.getElementById('ed-id').value.trim();

  return {
    id: IS_NEW_MODEL ? slugify(rawId) : rawId,
    name: document.getElementById('ed-name').value.trim() || 'Untitled model',
    category: document.getElementById('ed-category').value.trim(),
    summary: document.getElementById('ed-summary').value.trim(),
    video: document.getElementById('ed-video').value.trim(),
    bodyHtml: bodyHtml,
    paragraphs: htmlToParagraphs(bodyHtml),
    steps: steps.length ? steps : [{ title: '', desc: '', descHtml: '' }]
  };
}

function resizeImageToDataUrl(file, maxDim, mimeType){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(mimeType || 'image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function wrapSelectionInCode(){
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const text = sel.toString();
  if (text) {
    document.execCommand('insertHTML', false, '<code>' + text.replace(/</g, '&lt;') + '</code>');
  } else {
    document.execCommand('insertHTML', false, '<code>code</code>');
  }
}

function initRichTextToolbar(){
  const bodyEditable = document.getElementById('ed-body');
  LAST_FOCUSED_EDITABLE = bodyEditable;
  bodyEditable.addEventListener('focus', () => { LAST_FOCUSED_EDITABLE = bodyEditable; });

  function focusTarget(){
    const target = LAST_FOCUSED_EDITABLE || bodyEditable;
    target.focus();
    return target;
  }

  document.querySelectorAll('.rte-btn[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      focusTarget();
      document.execCommand(btn.dataset.cmd, false, btn.dataset.value || undefined);
    });
  });

  document.getElementById('rte-link-btn').addEventListener('click', () => {
    focusTarget();
    const url = prompt('Link URL (include https://):', 'https://');
    if (!url) return;
    document.execCommand('createLink', false, url);
  });

  document.getElementById('rte-code-btn').addEventListener('click', () => {
    focusTarget();
    wrapSelectionInCode();
  });

  document.getElementById('rte-image-btn').addEventListener('click', () => {
    document.getElementById('rte-image-input').click();
  });
  document.getElementById('rte-image-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const target = focusTarget();
    resizeImageToDataUrl(file, 700, 'image/jpeg').then((dataUrl) => {
      target.focus();
      document.execCommand('insertHTML', false, '<img src="' + dataUrl + '" alt="">');
    }).catch((err) => alert('Could not insert that image: ' + (err.message || err)));
    e.target.value = '';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initRichTextToolbar();

  guardAdminPage(() => {
    loadModels().then(() => {
      const modelId = getQueryParam('id');
      const isNew = getQueryParam('new') === '1';
      IS_NEW_MODEL = isNew;

      let m;
      if (isNew) {
        m = { id: '', name: '', category: '', summary: '', video: '', bodyHtml: '', steps: [{ title: '', desc: '' }] };
      } else {
        m = MODELS.find(x => x.id === modelId);
        if (!m) {
          document.getElementById('editor-error').textContent = 'Model not found.';
          document.getElementById('editor-error').style.display = 'block';
          return;
        }
      }

      EDITING_ID = m.id;
      loadModelIntoForm(m);
    });
  });

  document.getElementById('add-step-btn').addEventListener('click', () => {
    const rows = document.querySelectorAll('.lesson-edit-row').length;
    document.getElementById('step-edit-rows').insertAdjacentHTML('beforeend', stepRowHtml({ title: '', desc: '' }, rows));
    wireRemoveButtons();
  });

  document.getElementById('save-model-btn').addEventListener('click', () => {
    const errEl = document.getElementById('editor-error');
    const okEl = document.getElementById('editor-success');
    errEl.style.display = 'none';
    okEl.style.display = 'none';

    const data = collectFormData();
    if (!data.id) {
      errEl.textContent = 'Model ID (slug) is required.';
      errEl.style.display = 'block';
      return;
    }
    if (!IS_NEW_MODEL && data.id !== EDITING_ID) {
      errEl.textContent = 'The model ID cannot be changed after creation. Delete and re-create if you need a different ID.';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('save-model-btn');
    btn.disabled = true;
    db.collection('models').doc(data.id).set(data)
      .then(() => loadModels(true))
      .then(() => {
        okEl.textContent = 'Saved.';
        okEl.style.display = 'block';
        IS_NEW_MODEL = false;
        EDITING_ID = data.id;
        document.getElementById('ed-id').disabled = true;
        document.getElementById('editor-heading').textContent = 'Edit: ' + data.name;
      })
      .catch((err) => {
        errEl.textContent = err.message || 'Could not save model.';
        errEl.style.display = 'block';
      })
      .finally(() => { btn.disabled = false; });
  });

  document.getElementById('reset-from-seed-btn').addEventListener('click', () => {
    if (!EDITING_ID || typeof MODELS_SEED === 'undefined') return;
    const seedModel = MODELS_SEED.find(m => m.id === EDITING_ID);
    if (!seedModel) {
      alert('No bundled version of "' + EDITING_ID + '" exists to reset from.');
      return;
    }
    if (!confirm('Overwrite this model with the latest bundled content? This cannot be undone.')) return;

    const btn = document.getElementById('reset-from-seed-btn');
    btn.disabled = true;
    btn.textContent = 'Resetting…';

    db.collection('models').doc(EDITING_ID).set(seedModel)
      .then(() => loadModels(true))
      .then(() => {
        loadModelIntoForm(seedModel);
        document.getElementById('editor-success').textContent = 'Reset to the latest bundled version.';
        document.getElementById('editor-success').style.display = 'block';
      })
      .catch((err) => alert('Could not reset: ' + (err.message || err)))
      .finally(() => { btn.disabled = false; btn.textContent = 'Reset from bundled content'; });
  });

  document.getElementById('delete-model-btn').addEventListener('click', () => {
    if (!EDITING_ID) return;
    if (!confirm('Delete "' + EDITING_ID + '"? This removes it immediately. This cannot be undone.')) return;
    db.collection('models').doc(EDITING_ID).delete()
      .then(() => loadModels(true))
      .then(() => { window.location.href = 'models-admin.html'; })
      .catch((err) => alert('Could not delete: ' + (err.message || err)));
  });
});
