// Stryker Trading Academy — Admin: Live Sessions management (dashboard-admin.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`)
//
// IMPORTANT HONEST NOTE: there is no real backend role system in this app —
// no custom claims, no server. Firestore security rules currently allow any
// signed-in user to write to `liveSessions` (see the rules given alongside
// this feature), because there's no way to cryptographically verify "this
// user is an admin" without a backend. This admin dashboard page is the
// intended place to manage sessions, but it is not access-controlled by
// anything stronger than "you know the URL." Treat it accordingly until a
// real admin-role backend is built.

function renderAdminSessionRow(session){
  const row = document.createElement('div');
  row.className = 'chapter';
  row.style.gridTemplateColumns = '1fr auto';
  row.innerHTML =
    '<div class="chapter-body">' +
      '<h3 style="font-size:15px;">' + (session.title || 'Untitled session') + '</h3>' +
      '<p>' + (session.description || '') + '</p>' +
      '<div class="chapter-meta">' +
        '<span>' + session.date + (session.time ? ' · ' + session.time : '') + '</span>' +
        (session.instrument ? '<span>' + session.instrument + '</span>' : '') +
      '</div>' +
    '</div>' +
    '<div class="chapter-status"><button class="icon-btn" data-session-id="' + session.id + '" title="Delete session">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>' +
    '</button></div>';
  row.querySelector('[data-session-id]').addEventListener('click', () => deleteAdminSession(session.id));
  return row;
}

function loadAdminSessions(){
  db.collection('liveSessions').orderBy('date', 'desc').get()
    .then((snap) => {
      const list = document.getElementById('admin-session-list');
      list.innerHTML = '';
      if (snap.empty) {
        list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No sessions scheduled yet.</p>';
        return;
      }
      snap.forEach((doc) => {
        list.appendChild(renderAdminSessionRow(Object.assign({ id: doc.id }, doc.data())));
      });
    })
    .catch((err) => {
      console.error('Stryker: failed to load sessions', err);
      document.getElementById('admin-session-list').innerHTML =
        '<p style="color:var(--ink-3); font-size:13.5px;">Could not load sessions: ' + (err.message || err) + '</p>';
    });
}

function deleteAdminSession(id){
  if (!confirm('Delete this live session?')) return;
  db.collection('liveSessions').doc(id).delete()
    .then(loadAdminSessions)
    .catch((err) => alert('Could not delete: ' + (err.message || err)));
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;
  const addBtn = document.getElementById('admin-session-add-btn');
  if (!addBtn) return; // not on this page

  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) window.location.href = 'login.html'; }, 1500);
      return;
    }
    handled = true;
    loadAdminSessions();
  });

  addBtn.addEventListener('click', () => {
    const errEl = document.getElementById('admin-session-error');
    errEl.style.display = 'none';

    const title = document.getElementById('admin-session-title').value.trim();
    const instrument = document.getElementById('admin-session-instrument').value.trim();
    const date = document.getElementById('admin-session-date').value;
    const time = document.getElementById('admin-session-time').value;
    const description = document.getElementById('admin-session-desc').value.trim();

    if (!title || !date) {
      errEl.textContent = 'A title and date are required.';
      errEl.style.display = 'block';
      return;
    }

    addBtn.disabled = true;
    db.collection('liveSessions').add({
      title, instrument, date, time, description,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      document.getElementById('admin-session-title').value = '';
      document.getElementById('admin-session-instrument').value = '';
      document.getElementById('admin-session-date').value = '';
      document.getElementById('admin-session-time').value = '';
      document.getElementById('admin-session-desc').value = '';
      loadAdminSessions();
    }).catch((err) => {
      errEl.textContent = err.message || 'Could not add session.';
      errEl.style.display = 'block';
    }).finally(() => { addBtn.disabled = false; });
  });
});
