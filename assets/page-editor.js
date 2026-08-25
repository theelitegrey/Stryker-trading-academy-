// Stryker Trading Academy — Admin: Site Page editor (page-editor.html?key=...)
// Depends on: assets/admin-guard.js, assets/site-pages.js

let PE_KEY = null;

function initPageEditorToolbar(){
  const bodyEditable = document.getElementById('pe-body');

  document.querySelectorAll('#pe-rte-toolbar .rte-btn[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      bodyEditable.focus();
      document.execCommand(btn.dataset.cmd, false, btn.dataset.value || undefined);
    });
  });

  document.getElementById('pe-link-btn').addEventListener('click', () => {
    bodyEditable.focus();
    const url = prompt('Link URL (include https://):', 'https://');
    if (!url) return;
    document.execCommand('createLink', false, url);
  });
}

function loadPageIntoEditor(key){
  const registryEntry = SITE_PAGES_REGISTRY.find((p) => p.key === key);
  if (!registryEntry) {
    document.getElementById('pe-error').textContent = 'Unknown page key: ' + key;
    document.getElementById('pe-error').style.display = 'block';
    return;
  }

  document.getElementById('pe-heading').textContent = 'Edit: ' + registryEntry.label;
  document.getElementById('pe-preview-link').href = key + '.html';

  loadSitePage(key).then((page) => {
    document.getElementById('pe-title').value = (page && page.title) || registryEntry.label;
    document.getElementById('pe-body').innerHTML = (page && page.bodyHtml) || '';
  }).catch((err) => {
    document.getElementById('pe-error').textContent = 'Could not load page: ' + (err.message || err);
    document.getElementById('pe-error').style.display = 'block';
  });
}

function savePageFromEditor(){
  const errEl = document.getElementById('pe-error');
  const okEl = document.getElementById('pe-success');
  errEl.style.display = 'none'; okEl.style.display = 'none';

  const title = document.getElementById('pe-title').value.trim();
  const bodyHtml = document.getElementById('pe-body').innerHTML.trim();
  if (!title) {
    errEl.textContent = 'Add a page title before saving.';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('pe-save-btn');
  btn.disabled = true;
  saveSitePage(PE_KEY, { title: title, bodyHtml: bodyHtml })
    .then(() => {
      okEl.textContent = 'Page saved.';
      okEl.style.display = 'block';
      if (typeof showToast === 'function') showToast('success', 'Page saved.');
    })
    .catch((err) => {
      errEl.textContent = err.message || 'Could not save page.';
      errEl.style.display = 'block';
    })
    .finally(() => { btn.disabled = false; });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    PE_KEY = new URLSearchParams(window.location.search).get('key');
    if (!PE_KEY) {
      document.getElementById('pe-error').textContent = 'No page specified — go back to Site Pages and click Edit on a page.';
      document.getElementById('pe-error').style.display = 'block';
      return;
    }

    initPageEditorToolbar();
    loadPageIntoEditor(PE_KEY);
    document.getElementById('pe-save-btn').addEventListener('click', savePageFromEditor);
  });
});
