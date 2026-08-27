// Stryker Trading Academy — Admin: Site Pages list (pages-admin.html)
// Depends on: assets/admin-guard.js, assets/site-pages.js

function renderPagesAdminList(pages){
  const wrap = document.getElementById('pages-admin-list');
  wrap.innerHTML = '';
  pages.forEach((p) => {
    const isCustomized = !!p.updatedAt; // only true once an admin has actually saved this page
    const updated = p.updatedAt && typeof p.updatedAt.toDate === 'function'
      ? p.updatedAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Using built-in draft — not yet reviewed';
    const row = document.createElement('div');
    row.className = 'record-card';
    row.innerHTML =
      '<div><span class="cell-name">' + escapePagesAdminHtml(p.label) + (isCustomized ? '' : ' <span class="status-tag" style="margin-left:6px; background:rgba(245,197,66,0.12); color:#f5c542; border-color:rgba(245,197,66,0.3);">Needs review</span>') + '</span>' +
      '<span class="cell-sub">' + updated + ' · /' + p.key + '.html</span></div>' +
      '<a href="page-editor.html?key=' + encodeURIComponent(p.key) + '" class="btn btn-primary btn-sm">Edit</a>';
    wrap.appendChild(row);
  });

}

function escapePagesAdminHtml(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    loadAllSitePages().then(renderPagesAdminList).catch((err) => {
      document.getElementById('pages-admin-list').innerHTML =
        '<p style="color:var(--ink-3); font-size:13.5px;">Could not load pages: ' + (err.message || err) + '</p>';
    });

  });
});
