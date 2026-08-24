// Stryker Trading Academy — dedicated Trading Indicator Editor (indicator-editor.html)
// Mirrors assets/model-editor.js, simplified: no category/video/steps fields
// (indicators are id, name, summary, minRole, bodyHtml only), and no
// "reset from bundled content" since there's no seed array for indicators.

let EDITING_ID = null;
let IS_NEW_INDICATOR = false;

function getQueryParam(name){
  return new URLSearchParams(window.location.search).get(name);
}

function slugify(str){
  return String(str || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function loadIndicatorIntoForm(ind){
  document.getElementById('ed-id').value = ind.id || '';
  document.getElementById('ed-id').disabled = !IS_NEW_INDICATOR; // id is the doc ID — fixed once created
  document.getElementById('ed-name').value = ind.name || '';
  document.getElementById('ed-summary').value = ind.summary || '';
  document.getElementById('ed-min-role').value = ind.minRole || '';

  const bodyEl = document.getElementById('ed-body');
  bodyEl.innerHTML = ind.bodyHtml || '';
  bodyEl.setAttribute('data-placeholder', 'Write the full indicator write-up here…');

  document.getElementById('editor-heading').textContent = IS_NEW_INDICATOR ? 'New trading indicator' : ('Edit: ' + (ind.name || ind.id));
  document.getElementById('editor-subheading').textContent = ind.summary || 'No summary set';
}

function collectFormData(){
  const bodyHtml = document.getElementById('ed-body').innerHTML;
  const rawId = document.getElementById('ed-id').value.trim();

  return {
    id: IS_NEW_INDICATOR ? slugify(rawId) : rawId,
    name: document.getElementById('ed-name').value.trim() || 'Untitled indicator',
    summary: document.getElementById('ed-summary').value.trim(),
    minRole: document.getElementById('ed-min-role').value || null,
    bodyHtml: bodyHtml
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

  document.querySelectorAll('.rte-btn[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      bodyEditable.focus();
      document.execCommand(btn.dataset.cmd, false, btn.dataset.value || undefined);
    });
  });

  document.getElementById('rte-link-btn').addEventListener('click', () => {
    bodyEditable.focus();
    const url = prompt('Link URL (include https://):', 'https://');
    if (!url) return;
    document.execCommand('createLink', false, url);
  });

  document.getElementById('rte-code-btn').addEventListener('click', () => {
    bodyEditable.focus();
    wrapSelectionInCode();
  });

  document.getElementById('rte-image-btn').addEventListener('click', () => {
    document.getElementById('rte-image-input').click();
  });
  document.getElementById('rte-image-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    bodyEditable.focus();
    resizeImageToDataUrl(file, 700, 'image/jpeg').then((dataUrl) => {
      bodyEditable.focus();
      document.execCommand('insertHTML', false, '<img src="' + dataUrl + '" alt="">');
    }).catch((err) => alert('Could not insert that image: ' + (err.message || err)));
    e.target.value = '';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initRichTextToolbar();

  guardAdminPage(() => {
    Promise.all([loadIndicators(), loadPlansForRoles()]).then(([, plans]) => {
      const roleSelect = document.getElementById('ed-min-role');
      plans.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + ' (rank ' + (p.rank ?? 0) + ')';
        roleSelect.appendChild(opt);
      });

      const indicatorId = getQueryParam('id');
      const isNew = getQueryParam('new') === '1';
      IS_NEW_INDICATOR = isNew;

      let ind;
      if (isNew) {
        ind = { id: '', name: '', summary: '', minRole: null, bodyHtml: '' };
      } else {
        ind = INDICATORS.find(x => x.id === indicatorId);
        if (!ind) {
          document.getElementById('editor-error').textContent = 'Indicator not found.';
          document.getElementById('editor-error').style.display = 'block';
          return;
        }
      }

      EDITING_ID = ind.id;
      loadIndicatorIntoForm(ind);
    });
  });

  document.getElementById('save-indicator-btn').addEventListener('click', () => {
    const errEl = document.getElementById('editor-error');
    const okEl = document.getElementById('editor-success');
    errEl.style.display = 'none';
    okEl.style.display = 'none';

    const data = collectFormData();
    if (!data.id) {
      errEl.textContent = 'Indicator ID (slug) is required.';
      errEl.style.display = 'block';
      return;
    }
    if (!IS_NEW_INDICATOR && data.id !== EDITING_ID) {
      errEl.textContent = 'The indicator ID cannot be changed after creation. Delete and re-create if you need a different ID.';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('save-indicator-btn');
    btn.disabled = true;
    db.collection('indicators').doc(data.id).set(data)
      .then(() => loadIndicators(true))
      .then(() => {
        okEl.textContent = 'Saved.';
        okEl.style.display = 'block';
        IS_NEW_INDICATOR = false;
        EDITING_ID = data.id;
        document.getElementById('ed-id').disabled = true;
        document.getElementById('editor-heading').textContent = 'Edit: ' + data.name;
      })
      .catch((err) => {
        errEl.textContent = err.message || 'Could not save indicator.';
        errEl.style.display = 'block';
      })
      .finally(() => { btn.disabled = false; });
  });

  document.getElementById('delete-indicator-btn').addEventListener('click', () => {
    if (!EDITING_ID) return;
    if (!confirm('Delete "' + EDITING_ID + '"? This removes it immediately. This cannot be undone.')) return;
    db.collection('indicators').doc(EDITING_ID).delete()
      .then(() => loadIndicators(true))
      .then(() => { window.location.href = 'indicators-admin.html'; })
      .catch((err) => alert('Could not delete: ' + (err.message || err)));
  });
});
