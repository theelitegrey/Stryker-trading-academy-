// Stryker Trading Academy — Admin: Live Sessions management (dashboard-admin.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`), assets/admin-guard.js
//
// Real admin access control: writes to `liveSessions` are restricted by
// Firestore security rules to accounts with a matching document in the
// `admins` collection (see rules). guardAdminPage() (assets/admin-guard.js)
// also checks this client-side before this page's logic runs at all, so a
// non-admin gets redirected rather than seeing permission-denied errors.

// Accepts a bare YouTube video id or any usual URL shape (watch?v=, youtu.be/,
// /live/, /embed/) and returns the 11-char id, or null.
function ytExtractId(input){
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/live\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function renderAdminSessionRow(session){
  const row = document.createElement('div');
  row.className = 'chapter';
  row.style.gridTemplateColumns = '1fr auto';
  row.innerHTML =
    '<div class="chapter-body">' +
      '<h3 style="font-size:15px;">' + (session.title || 'Untitled session') +
        (session.isLive ? ' <span class="status-tag active" style="vertical-align:middle;">● LIVE</span>' : '') + '</h3>' +
      '<p>' + (session.description || '') + '</p>' +
      '<div class="chapter-meta">' +
        '<span>' + session.date + (session.time ? ' · ' + session.time : '') + '</span>' +
        (session.instrument ? '<span>' + session.instrument + '</span>' : '') +
        (session.videoId ? '<span>▶ video ' + session.videoId + '</span>' : '<span style="opacity:.6;">no video attached</span>') +
      '</div>' +
    '</div>' +
    '<div class="chapter-status" style="display:flex; gap:8px; align-items:center;">' +
      (session.videoId
        ? '<button class="btn btn-ghost btn-sm" data-live-toggle="' + session.id + '">' + (session.isLive ? 'End live' : 'Go live') + '</button>'
        : '') +
      '<button class="icon-btn" data-session-id="' + session.id + '" title="Delete session">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>' +
    '</button></div>';
  row.querySelector('[data-session-id]').addEventListener('click', () => deleteAdminSession(session.id));
  const liveBtn = row.querySelector('[data-live-toggle]');
  if (liveBtn) liveBtn.addEventListener('click', () => toggleSessionLive(session));
  return row;
}

// Going live on one session ends any other live session in the same write, so
// the student page never has to pick between two "live" banners.
function toggleSessionLive(session){
  const goingLive = !session.isLive;
  db.collection('liveSessions').where('isLive', '==', true).get().then((snap) => {
    const batch = db.batch();
    snap.forEach((doc) => batch.update(doc.ref, { isLive: false }));
    if (goingLive) {
      batch.update(db.collection('liveSessions').doc(session.id), {
        isLive: true,
        liveStartedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    return batch.commit();
  }).then(() => {
    showToast('success', goingLive ? 'Session is LIVE — students see the player now.' : 'Live ended.');
    loadAdminSessions();
  }).catch((err) => showToast('error', 'Could not update: ' + (err.message || err)));
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
    .catch((err) => showToast('error', 'Could not delete: ' + (err.message || err)));
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;
  const addBtn = document.getElementById('admin-session-add-btn');
  if (!addBtn) return; // not on this page

  guardAdminPage(() => loadAdminSessions());

  addBtn.addEventListener('click', () => {
    const errEl = document.getElementById('admin-session-error');
    errEl.style.display = 'none';

    const title = document.getElementById('admin-session-title').value.trim();
    const instrument = document.getElementById('admin-session-instrument').value.trim();
    const date = document.getElementById('admin-session-date').value;
    const time = document.getElementById('admin-session-time').value;
    const description = document.getElementById('admin-session-desc').value.trim();
    const videoRaw = (document.getElementById('admin-session-video') || {}).value || '';
    const videoId = ytExtractId(videoRaw);

    if (!title || !date) {
      errEl.textContent = 'A title and date are required.';
      errEl.style.display = 'block';
      return;
    }
    if (videoRaw.trim() && !videoId) {
      errEl.textContent = 'That doesn\'t look like a YouTube link or video ID.';
      errEl.style.display = 'block';
      return;
    }

    addBtn.disabled = true;
    db.collection('liveSessions').add({
      title, instrument, date, time, description,
      videoId: videoId || null,
      isLive: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      const v = document.getElementById('admin-session-video');
      if (v) v.value = '';
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
