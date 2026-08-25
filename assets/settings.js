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
      setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
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
      renderAvatarPreview(student);
      document.getElementById('settings-tv-username').value = (student && student.tradingViewUsername) || '';
    }).catch((err) => console.error('Stryker: failed to load account info', err));
  });

  function renderAvatarPreview(studentData){
    const wrap = document.getElementById('avatar-preview-wrap');
    if (!wrap || typeof avatarImgHtml !== 'function' || !currentUser) return;
    wrap.innerHTML = avatarImgHtml(currentUser.uid, currentUser.displayName, studentData, 72);
  }

  document.getElementById('avatar-upload-btn').addEventListener('click', () => {
    document.getElementById('avatar-file-input').click();
  });

  document.getElementById('avatar-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !currentUser) return;
    const errEl = document.getElementById('avatar-error');
    const okEl = document.getElementById('avatar-success');
    errEl.style.display = 'none'; okEl.style.display = 'none';

    resizeAvatarToDataUrl(file, 240)
      .then((dataUrl) => {
        if (typeof syncPublicProfile === 'function') syncPublicProfile(currentUser.uid, { customPhotoURL: dataUrl });
        return db.collection('students').doc(currentUser.uid).set({ customPhotoURL: dataUrl }, { merge: true });
      })
      .then(() => getStudentDoc(currentUser.uid))
      .then((student) => {
        renderAvatarPreview(student);
        showSettingsMsg('avatar-success', 'Profile picture updated.');
      })
      .catch((err) => {
        errEl.textContent = err.message || 'Could not update your photo.';
        errEl.style.display = 'block';
      });
    e.target.value = '';
  });

  document.getElementById('avatar-randomize-btn').addEventListener('click', () => {
    if (!currentUser || typeof randomAvatarSeed !== 'function') return;
    const errEl = document.getElementById('avatar-error');
    const okEl = document.getElementById('avatar-success');
    errEl.style.display = 'none'; okEl.style.display = 'none';

    // Clears any custom upload and rolls a fresh generated-avatar seed, so
    // repeated clicks actually produce visibly different results.
    const newSeed = randomAvatarSeed();
    if (typeof syncPublicProfile === 'function') {
      syncPublicProfile(currentUser.uid, { customPhotoURL: firebase.firestore.FieldValue.delete(), avatarSeed: newSeed });
    }
    db.collection('students').doc(currentUser.uid).set({
      customPhotoURL: firebase.firestore.FieldValue.delete(),
      avatarSeed: newSeed
    }, { merge: true })
      .then(() => getStudentDoc(currentUser.uid))
      .then((student) => {
        renderAvatarPreview(student);
        showSettingsMsg('avatar-success', 'New avatar generated.');
      })
      .catch((err) => {
        errEl.textContent = err.message || 'Could not generate a new avatar.';
        errEl.style.display = 'block';
      });
  });

  document.getElementById('settings-save-name').addEventListener('click', () => {
    if (!currentUser) return;
    const newName = document.getElementById('settings-name').value.trim();
    if (!newName) { showSettingsMsg('settings-error', 'Display name cannot be empty.'); return; }
    currentUser.updateProfile({ displayName: newName })
      .then(() => {
        if (typeof syncPublicProfile === 'function') syncPublicProfile(currentUser.uid, { displayName: newName });
        return db.collection('students').doc(currentUser.uid).set({ displayName: newName }, { merge: true });
      })
      .then(() => showSettingsMsg('settings-success', 'Saved.'))
      .catch((err) => showSettingsMsg('settings-error', err.message || 'Could not save changes.'));
  });

  document.getElementById('settings-save-tv').addEventListener('click', () => {
    if (!currentUser) return;
    const newUsername = document.getElementById('settings-tv-username').value.trim();
    // Changing the username re-opens the request — an admin still needs to
    // grant the new one, so this always clears any prior "granted" flag
    // rather than only doing so conditionally, to avoid an admin missing a
    // genuine username change.
    db.collection('students').doc(currentUser.uid).set({
      tradingViewUsername: newUsername || null,
      tradingViewAccessGranted: false,
      tradingViewRequestedAt: newUsername ? firebase.firestore.FieldValue.serverTimestamp() : null
    }, { merge: true })
      .then(() => showSettingsMsg('settings-tv-success', newUsername ? 'Saved — we\'ll grant access soon.' : 'Cleared.'))
      .catch((err) => showSettingsMsg('settings-tv-error', err.message || 'Could not save.'));
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
