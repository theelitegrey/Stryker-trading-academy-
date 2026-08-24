// Stryker Trading Academy — Admin: Roles & Access (access-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js,
// assets/roles.js (GATEABLE_PAGES, loadPlansForRoles, loadPageAccess)

let CURRENT_PAGE_ACCESS = {};

function renderRolesSummary(plans){
  const container = document.getElementById('roles-summary-list');
  if (!plans.length) {
    container.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No plans exist yet — <a href="billing-admin.html" style="color:var(--teal);">create your Starter/Pro/Elite plans first</a>, then come back here to set page and content access.</p>';
    return;
  }
  container.innerHTML = plans.map((p) => {
    const color = p.color || '#8b93a0';
    return (
      '<div class="record-card" style="align-items:center;">' +
        '<div style="display:flex; align-items:center; gap:12px; flex:1;">' +
          '<span style="width:14px; height:14px; border-radius:50%; background:' + color + '; flex-shrink:0; display:inline-block;"></span>' +
          '<div>' +
            '<span class="cell-name">' + (p.name || 'Untitled plan') + '</span>' +
            '<div style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3); margin-top:3px;">rank ' + (p.rank ?? 0) + ' · $' + (p.price || '0') + '/' + (p.period || 'month') + '</div>' +
          '</div>' +
        '</div>' +
        '<a href="billing-admin.html" class="btn btn-ghost btn-sm">Edit rank / color</a>' +
      '</div>'
    );
  }).join('');
}

function planOptionsHtml(plans, selectedId){
  let opts = '<option value="">No restriction — any signed-in student</option>';
  plans.forEach((p) => {
    const sel = p.id === selectedId ? ' selected' : '';
    opts += '<option value="' + p.id + '"' + sel + '>' + (p.name || p.id) + ' (rank ' + (p.rank ?? 0) + ')</option>';
  });
  return opts;
}

function renderPageAccessList(plans, pageAccess){
  const container = document.getElementById('page-access-list');
  if (!plans.length) {
    container.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">Add at least one plan before setting page access.</p>';
    return;
  }
  container.innerHTML = GATEABLE_PAGES.map((page) => {
    const current = pageAccess[page.key] || '';
    return (
      '<div class="record-card" style="align-items:center;">' +
        '<div style="flex:1;"><span class="cell-name">' + page.label + '</span></div>' +
        '<select class="page-access-select" data-page-key="' + page.key + '" style="min-width:240px;">' +
          planOptionsHtml(plans, current) +
        '</select>' +
      '</div>'
    );
  }).join('');
}

function saveAllPageAccess(){
  const errEl = document.getElementById('access-error');
  const okEl = document.getElementById('access-success');
  errEl.style.display = 'none';
  okEl.style.display = 'none';

  const data = {};
  document.querySelectorAll('.page-access-select').forEach((sel) => {
    data[sel.dataset.pageKey] = sel.value || null;
  });

  const btn = document.getElementById('save-page-access-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  db.collection('settings').doc('pageAccess').set(data, { merge: false })
    .then(() => {
      okEl.textContent = 'Page access saved.';
      okEl.style.display = 'block';
    })
    .catch((err) => {
      errEl.textContent = err.message || 'Could not save page access.';
      errEl.style.display = 'block';
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Save page access';
    });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    Promise.all([loadPlansForRoles(), loadPageAccess()])
      .then(([plans, pageAccess]) => {
        CURRENT_PAGE_ACCESS = pageAccess;
        renderRolesSummary(plans);
        renderPageAccessList(plans, pageAccess);
      })
      .catch((err) => {
        console.error('Stryker: failed to load roles & access admin page', err);
        document.getElementById('roles-summary-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load: ' + (err.message || err) + '</p>';
      });

    document.getElementById('save-page-access-btn').addEventListener('click', saveAllPageAccess);
  });
});
