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
    if (m.id) row.id = 'contact-' + m.id;     // deep-link target
    row.innerHTML =
      '<div><span class="cell-name">' + escapePagesAdminHtml(p.label) + (isCustomized ? '' : ' <span class="status-tag" style="margin-left:6px; background:rgba(245,197,66,0.12); color:#f5c542; border-color:rgba(245,197,66,0.3);">Needs review</span>') + '</span>' +
      '<span class="cell-sub">' + updated + ' · /' + p.key + '.html</span></div>' +
      '<a href="page-editor.html?key=' + encodeURIComponent(p.key) + '" class="btn btn-primary btn-sm">Edit</a>';
    wrap.appendChild(row);
  });

  // Honour a #contact-<id> deep link from a notification. The rows only exist
  // once this render has run, so the browser's own anchor handling has already
  // fired and found nothing — it has to be done here.
  if (location.hash.indexOf('#contact-') === 0) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('record-card-flash');
      // Removed after the animation so the highlight does not persist and
      // make an old message look permanently unread.
      setTimeout(() => target.classList.remove('record-card-flash'), 2400);
    }
  }
}

function renderContactMessages(messages){
  const wrap = document.getElementById('pages-admin-contact-list');
  if (!messages.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No messages yet.</p>';
    return;
  }
  wrap.innerHTML = '';
  messages.forEach((m) => {
    const when = m.createdAt && typeof m.createdAt.toDate === 'function'
      ? m.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    const row = document.createElement('div');
    row.className = 'record-card';
    row.innerHTML =
      '<div style="flex:1;"><span class="cell-name">' + escapePagesAdminHtml(m.name || 'Unknown') + '</span>' +
      '<span class="cell-sub">' + escapePagesAdminHtml(m.email || '—') + ' · ' + when + '</span>' +
      '<p style="font-size:13px; color:var(--ink-2); margin-top:8px; margin-bottom:0;">' + escapePagesAdminHtml(m.message || '') + '</p></div>';
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

    db.collection('contactMessages').orderBy('createdAt', 'desc').limit(30).get()
      .then((snap) => {
        const messages = [];
        // Keep the document id: the row needs it as an anchor target so a
        // notification can deep-link to the specific message. doc.data() alone
        // discards it, which is why the link had nothing to aim at.
        snap.forEach((doc) => {
          const m = doc.data();
          m.id = doc.id;
          messages.push(m);
        });
        renderContactMessages(messages);
      })
      .catch((err) => {
        document.getElementById('pages-admin-contact-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load messages: ' + (err.message || err) + '</p>';
      });
  });
});
