// Stryker Trading Academy — Admin Settings (settings-admin.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`), assets/admin-team.js

function showAdminSettingsMsg(elId, message){
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function renderTeamList(currentUid){
  const list = document.getElementById('team-list');
  const countEl = document.getElementById('team-count');
  if (!list) return;

  if (countEl) countEl.textContent = CURRENT_ADMIN_DOCS.length + ' admin' + (CURRENT_ADMIN_DOCS.length === 1 ? '' : 's');

  if (!CURRENT_ADMIN_DOCS.length) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No admins found — that shouldn\'t be possible since you\'re signed in as one.</p>';
    return;
  }

  list.innerHTML = '';
  CURRENT_ADMIN_DOCS.forEach((admin) => {
    const isSelf = admin.uid === currentUid;
    const grantedDate = (admin.grantedAt && typeof admin.grantedAt.toDate === 'function')
      ? admin.grantedAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    const row = document.createElement('div');
    row.className = 'record-card';
    row.innerHTML =
      '<div class="cell-user">' + (typeof avatarImgHtml === 'function' ? avatarImgHtml(admin.uid, (admin.displayName || admin.email), null, 36) : '<div class="cell-avatar" style="background:linear-gradient(135deg,var(--teal),var(--teal-dim));"></div>') + '<div><span class="cell-name">' +
        (admin.displayName || admin.email || 'Unnamed') + (isSelf ? ' <span class="status-tag active" style="margin-left:6px;">You</span>' : '') +
        '</span><span class="cell-sub">' + (admin.email || '—') + '</span></div></div>' +
      '<div class="record-stats"><div class="record-stat"><span class="rs-label">Admin since</span><span class="rs-val">' + grantedDate + '</span></div></div>' +
      (!isSelf ? '<button class="btn btn-ghost btn-sm" data-revoke-uid="' + admin.uid + '">Revoke</button>' : '');

    if (!isSelf) {
      row.querySelector('[data-revoke-uid]').addEventListener('click', (e) => {
        if (!confirm('Revoke admin access for ' + (admin.displayName || admin.email) + '?')) return;
        const btn = e.currentTarget;
        btn.disabled = true;
        revokeAdmin(admin.uid)
          .then(() => loadAdminList())
          .then(() => renderTeamList(currentUid))
          .catch((err) => { alert('Could not revoke: ' + (err.message || err)); btn.disabled = false; });
      });
    }
    list.appendChild(row);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  let currentUser = null;

  guardAdminPage((user) => {
    currentUser = user;
    document.getElementById('settings-name').value = user.displayName || '';
    document.getElementById('settings-email').value = user.email || '';

    // Notification preferences — stored on the admin's own doc.
    db.collection('admins').doc(user.uid).get().then((doc) => {
      const data = doc.exists ? doc.data() : {};
      document.getElementById('notify-new-student').checked = !!data.notifyNewStudent;
      document.getElementById('notify-chapter-complete').checked = !!data.notifyChapterComplete;
      document.getElementById('notify-community-flag').checked = !!data.notifyCommunityFlag;
    }).catch((err) => console.error('Stryker: failed to load notification prefs', err));

    // Team members list
    loadAdminList().then(() => renderTeamList(user.uid))
      .catch((err) => {
        console.error('Stryker: failed to load team list', err);
        document.getElementById('team-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load team members: ' + (err.message || err) + '</p>';
      });

    // Site maintenance mode
    db.collection('settings').doc('site').get().then((doc) => {
      document.getElementById('maintenance-toggle').checked = !!(doc.exists && doc.data().maintenanceMode);
    }).catch((err) => console.error('Stryker: failed to load maintenance status', err));

    // Homepage "traders enrolled" stat — admin-adjustable baseline
    db.collection('publicStats').doc('enrollment').get().then((doc) => {
      document.getElementById('enrollcount-input').value = doc.exists ? (doc.data().count || 0) : 0;
    }).catch((err) => console.error('Stryker: failed to load enrolled count', err));
  });

  document.getElementById('settings-save-name').addEventListener('click', () => {
    if (!currentUser) return;
    const newName = document.getElementById('settings-name').value.trim();
    if (!newName) { showAdminSettingsMsg('settings-error', 'Display name cannot be empty.'); return; }
    currentUser.updateProfile({ displayName: newName })
      .then(() => showAdminSettingsMsg('settings-success', 'Saved.'))
      .catch((err) => showAdminSettingsMsg('settings-error', err.message || 'Could not save changes.'));
  });

  document.getElementById('settings-reset-password').addEventListener('click', () => {
    if (!currentUser || !currentUser.email) return;
    auth.sendPasswordResetEmail(currentUser.email)
      .then(() => showAdminSettingsMsg('settings-success', 'Password reset email sent — check your inbox.'))
      .catch((err) => showAdminSettingsMsg('settings-error', err.message || 'Could not send reset email.'));
  });

  document.getElementById('notify-save-btn').addEventListener('click', () => {
    if (!currentUser) return;
    const btn = document.getElementById('notify-save-btn');
    btn.disabled = true;
    db.collection('admins').doc(currentUser.uid).set({
      notifyNewStudent: document.getElementById('notify-new-student').checked,
      notifyChapterComplete: document.getElementById('notify-chapter-complete').checked,
      notifyCommunityFlag: document.getElementById('notify-community-flag').checked
    }, { merge: true })
      .then(() => showAdminSettingsMsg('settings-success', 'Preferences saved.'))
      .catch((err) => showAdminSettingsMsg('settings-error', err.message || 'Could not save preferences.'))
      .finally(() => { btn.disabled = false; });
  });

  document.getElementById('maintenance-save-btn').addEventListener('click', () => {
    const btn = document.getElementById('maintenance-save-btn');
    btn.disabled = true;
    const enabled = document.getElementById('maintenance-toggle').checked;
    db.collection('settings').doc('site').set({
      maintenanceMode: enabled,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
      .then(() => showAdminSettingsMsg('maintenance-success', enabled ? 'Maintenance mode is ON — the live site now redirects everyone but admins.' : 'Maintenance mode is OFF — the site is live for everyone again.'))
      .catch((err) => {
        document.getElementById('maintenance-error').textContent = err.message || 'Could not save.';
        document.getElementById('maintenance-error').style.display = 'block';
      })
      .finally(() => { btn.disabled = false; });
  });

  document.getElementById('enrollcount-save-btn').addEventListener('click', () => {
    const btn = document.getElementById('enrollcount-save-btn');
    const errEl = document.getElementById('enrollcount-error');
    errEl.style.display = 'none';
    const count = parseInt(document.getElementById('enrollcount-input').value, 10);
    if (isNaN(count) || count < 0) {
      errEl.textContent = 'Enter a whole number of 0 or more.';
      errEl.style.display = 'block';
      return;
    }
    btn.disabled = true;
    db.collection('publicStats').doc('enrollment').set({ count: count }, { merge: true })
      .then(() => showAdminSettingsMsg('enrollcount-success', 'Saved — the homepage will show ' + count.toLocaleString() + ' from now on.'))
      .catch((err) => {
        errEl.textContent = err.message || 'Could not save.';
        errEl.style.display = 'block';
      })
      .finally(() => { btn.disabled = false; });
  });
});
