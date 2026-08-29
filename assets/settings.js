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
  let studentData = null;   // the loaded student doc, for the save handler

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
      studentData = student || {};
      if (student && student.createdAt && typeof student.createdAt.toDate === 'function') {
        document.getElementById('settings-member-since').textContent =
          student.createdAt.toDate().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      }
      const planEl = document.getElementById('settings-plan-name');
      if (planEl) planEl.textContent = (student && student.plan) ? student.plan : 'Self-Paced';
      renderAvatarPreview(student);
      document.getElementById('settings-bio').value = (student && student.bio) || '';
      const unEl = document.getElementById('settings-username');
      if (unEl) unEl.value = (student && student.username) || '';
      const mnEl = document.getElementById('settings-mention-notify');
      if (mnEl) mnEl.checked = !(student && student.mentionNotifications === false);
      // A pre-username account: derive the default now so the field is never
      // just blank the first time they look at it.
      if (unEl && !unEl.value && typeof ensureUsername === 'function') {
        ensureUsername(currentUser).then((name) => { if (name && !unEl.value) unEl.value = name; });
      }
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
    const newBio = document.getElementById('settings-bio').value.trim();
    if (!newName) { showSettingsMsg('settings-error', 'Display name cannot be empty.'); return; }

    const unEl = document.getElementById('settings-username');
    const mnEl = document.getElementById('settings-mention-notify');
    const wantedUsername = unEl ? normalizeUsername(unEl.value) : '';
    const mentionsOn = mnEl ? mnEl.checked : true;

    // The username goes through its claim (uniqueness) path first: if the
    // handle is taken or malformed, nothing else should half-save around it.
    const currentUsername = (studentData && studentData.username) || '';
    const usernameStep = (unEl && wantedUsername !== currentUsername)
      ? claimUsername(currentUser.uid, wantedUsername, currentUsername)
      : Promise.resolve({ ok: true, username: currentUsername });

    usernameStep.then((res) => {
      if (!res.ok) { showSettingsMsg('settings-error', res.error); return; }
      if (unEl) unEl.value = res.username || wantedUsername;
      if (studentData) studentData.username = res.username || currentUsername;

      currentUser.updateProfile({ displayName: newName })
        .then(() => {
          // mentionNotifications lives on the PUBLIC profile doc deliberately:
          // the tagger's client is what writes the notification, so it has to
          // be able to read whether the tagged person wants one.
          if (typeof syncPublicProfile === 'function') syncPublicProfile(currentUser.uid,
            { displayName: newName, bio: newBio, mentionNotifications: mentionsOn });
          return db.collection('students').doc(currentUser.uid).set(
            { displayName: newName, bio: newBio, mentionNotifications: mentionsOn }, { merge: true });
        })
        .then(() => showSettingsMsg('settings-success', 'Saved.'))
        .catch((err) => showSettingsMsg('settings-error', err.message || 'Could not save changes.'));
    });
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
