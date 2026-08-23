// Stryker Trading Academy — Admin: Appearance (appearance-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js,
// firebase-storage-compat.js
//
// Uploads go to Firebase Storage under branding/logo-* and branding/favicon-*,
// then the resulting download URL is written to Firestore's
// settings/appearance doc. Every page loads assets/branding.js, which reads
// that doc and swaps the bundled default logo/favicon for these if present.

function loadCurrentAppearance(){
  return db.collection('settings').doc('appearance').get().then((doc) => {
    if (!doc.exists) return;
    const data = doc.data();
    if (data.logoUrl) {
      document.getElementById('logo-preview').src = data.logoUrl;
      document.getElementById('logo-current-label').textContent = 'Current: custom upload';
    }
    if (data.faviconUrl) {
      document.getElementById('favicon-preview').src = data.faviconUrl;
      document.getElementById('favicon-current-label').textContent = 'Current: custom upload';
    }
  });
}

function showAppearanceMsg(elId, message){
  const el = document.getElementById(elId);
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function uploadBrandingFile(file, storagePathPrefix){
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = storagePathPrefix + '-' + Date.now() + '.' + ext;
  const ref = firebase.storage().ref(path);
  return ref.put(file).then(() => ref.getDownloadURL());
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    loadCurrentAppearance().catch((err) => {
      console.error('Stryker: failed to load current appearance', err);
    });
  });

  // Live preview of a selected file before upload
  document.getElementById('logo-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) document.getElementById('logo-preview').src = URL.createObjectURL(file);
  });
  document.getElementById('favicon-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) document.getElementById('favicon-preview').src = URL.createObjectURL(file);
  });

  document.getElementById('upload-logo-btn').addEventListener('click', () => {
    const errEl = document.getElementById('appearance-error');
    errEl.style.display = 'none';
    const file = document.getElementById('logo-file-input').files[0];
    if (!file) { errEl.textContent = 'Choose a logo file first.'; errEl.style.display = 'block'; return; }

    const btn = document.getElementById('upload-logo-btn');
    btn.disabled = true;
    btn.textContent = 'Uploading…';

    uploadBrandingFile(file, 'branding/logo')
      .then((url) => db.collection('settings').doc('appearance').set({ logoUrl: url, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }))
      .then(() => {
        document.getElementById('logo-current-label').textContent = 'Current: custom upload';
        showAppearanceMsg('appearance-success', 'Logo updated — it will now show across the whole site.');
      })
      .catch((err) => {
        console.error('Stryker: logo upload failed', err);
        errEl.textContent = 'Upload failed: ' + (err.message || err) + '. If this mentions storage/bucket-not-found or permissions, Firebase Storage likely needs to be enabled first.';
        errEl.style.display = 'block';
      })
      .finally(() => { btn.disabled = false; btn.textContent = 'Upload & save logo'; });
  });

  document.getElementById('upload-favicon-btn').addEventListener('click', () => {
    const errEl = document.getElementById('appearance-error');
    errEl.style.display = 'none';
    const file = document.getElementById('favicon-file-input').files[0];
    if (!file) { errEl.textContent = 'Choose a favicon file first.'; errEl.style.display = 'block'; return; }

    const btn = document.getElementById('upload-favicon-btn');
    btn.disabled = true;
    btn.textContent = 'Uploading…';

    uploadBrandingFile(file, 'branding/favicon')
      .then((url) => db.collection('settings').doc('appearance').set({ faviconUrl: url, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }))
      .then(() => {
        document.getElementById('favicon-current-label').textContent = 'Current: custom upload';
        showAppearanceMsg('appearance-success', 'Favicon updated — it will show in the browser tab across the site (may take a browser refresh or two to visibly update, since browsers cache favicons aggressively).');
      })
      .catch((err) => {
        console.error('Stryker: favicon upload failed', err);
        errEl.textContent = 'Upload failed: ' + (err.message || err) + '. If this mentions storage/bucket-not-found or permissions, Firebase Storage likely needs to be enabled first.';
        errEl.style.display = 'block';
      })
      .finally(() => { btn.disabled = false; btn.textContent = 'Upload & save favicon'; });
  });

  document.getElementById('reset-branding-btn').addEventListener('click', () => {
    if (!confirm('Reset to the bundled default logo and favicon? This does not delete uploaded files from storage, just stops using them.')) return;
    db.collection('settings').doc('appearance').delete()
      .then(() => {
        document.getElementById('logo-preview').src = 'assets/images/logo-emblem.png';
        document.getElementById('favicon-preview').src = 'assets/images/favicon-32.png';
        document.getElementById('logo-current-label').textContent = 'Current: bundled default';
        document.getElementById('favicon-current-label').textContent = 'Current: bundled default';
        showAppearanceMsg('appearance-success', 'Reset to bundled defaults.');
      })
      .catch((err) => {
        document.getElementById('appearance-error').textContent = 'Could not reset: ' + (err.message || err);
        document.getElementById('appearance-error').style.display = 'block';
      });
  });
});
