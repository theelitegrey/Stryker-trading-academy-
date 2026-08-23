// Stryker Trading Academy — Settings page (settings.html)
// Depends on: assets/auth.js, assets/progress.js

function showSettingsMsg(elId, message){
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;

  let currentUser = null;
  let handled = false;

  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) window.location.href = 'login.html'; }, 1500);
      return;
    }
    handled = true;
    currentUser = user;

    document.getElementById('settings-name').value = user.displayName || '';
    document.getElementById('settings-email').value = user.email || '';
    document.getElementById('settings-uid').textContent = user.uid;

    ensureStudentDoc(user).then((student) => {
      if (student && student.createdAt && typeof student.createdAt.toDate === 'function') {
        document.getElementById('settings-member-since').textContent =
          student.createdAt.toDate().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      }
      const planEl = document.getElementById('settings-plan-name');
      if (planEl) planEl.textContent = (student && student.plan) ? student.plan : 'Self-Paced';
    }).catch((err) => console.error('Stryker: failed to load account info', err));
  });

  document.getElementById('settings-save-name').addEventListener('click', () => {
    if (!currentUser) return;
    const newName = document.getElementById('settings-name').value.trim();
    if (!newName) { showSettingsMsg('settings-error', 'Display name cannot be empty.'); return; }
    currentUser.updateProfile({ displayName: newName })
      .then(() => db.collection('students').doc(currentUser.uid).set({ displayName: newName }, { merge: true }))
      .then(() => showSettingsMsg('settings-success', 'Saved.'))
      .catch((err) => showSettingsMsg('settings-error', err.message || 'Could not save changes.'));
  });

  document.getElementById('settings-reset-password').addEventListener('click', () => {
    if (!currentUser || !currentUser.email) return;
    auth.sendPasswordResetEmail(currentUser.email)
      .then(() => showSettingsMsg('settings-success', 'Password reset email sent — check your inbox.'))
      .catch((err) => showSettingsMsg('settings-error', err.message || 'Could not send reset email.'));
  });

  document.getElementById('settings-reset-progress').addEventListener('click', () => {
    if (!currentUser) return;
    const ok = confirm('This clears all chapter and lesson completion progress. This cannot be undone. Continue?');
    if (!ok) return;
    db.collection('students').doc(currentUser.uid).set({
      completedLessons: [],
      completedChapters: []
    }, { merge: true })
      .then(() => showSettingsMsg('settings-success', 'Your learning progress has been reset.'))
      .catch((err) => showSettingsMsg('settings-error', err.message || 'Could not reset progress.'));
  });
});
