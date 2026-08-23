// Stryker Trading Academy — Admin: Appearance (appearance-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js
//
// No Firebase Storage needed (and no Blaze/paid-plan requirement) — images
// are resized client-side on a canvas to a small max dimension, exported as
// a compact base64 data URL, and written directly into Firestore. That data
// URL is a normal string an <img src> or <link rel="icon" href> can use
// as-is, so branding.js on every other page doesn't need to know the
// difference between this and a real hosted file URL.
//
// Logo and favicon are kept as SEPARATE Firestore documents (settings/logo,
// settings/favicon) rather than one combined doc, so each gets its own full
// ~1MB Firestore document size budget instead of splitting a shared one.

function resizeImageToDataUrl(file, maxDim, mimeType){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(mimeType || 'image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function loadCurrentAppearance(){
  const logoP = db.collection('settings').doc('logo').get();
  const faviconP = db.collection('settings').doc('favicon').get();
  return Promise.all([logoP, faviconP]).then(([logoDoc, faviconDoc]) => {
    if (logoDoc.exists && logoDoc.data().dataUrl) {
      document.getElementById('logo-preview').src = logoDoc.data().dataUrl;
      document.getElementById('logo-current-label').textContent = 'Current: custom upload';
    }
    if (faviconDoc.exists && faviconDoc.data().dataUrl) {
      document.getElementById('favicon-preview').src = faviconDoc.data().dataUrl;
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

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    loadCurrentAppearance().catch((err) => {
      console.error('Stryker: failed to load current appearance', err);
    });
  });

  // Live preview of a selected file before saving
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
    btn.textContent = 'Saving…';

    resizeImageToDataUrl(file, 300, 'image/png')
      .then((dataUrl) => db.collection('settings').doc('logo').set({ dataUrl, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }))
      .then(() => {
        document.getElementById('logo-current-label').textContent = 'Current: custom upload';
        showAppearanceMsg('appearance-success', 'Logo updated — it will now show across the whole site.');
      })
      .catch((err) => {
        console.error('Stryker: logo save failed', err);
        errEl.textContent = 'Could not save logo: ' + (err.message || err);
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
    btn.textContent = 'Saving…';

    resizeImageToDataUrl(file, 64, 'image/png')
      .then((dataUrl) => db.collection('settings').doc('favicon').set({ dataUrl, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }))
      .then(() => {
        document.getElementById('favicon-current-label').textContent = 'Current: custom upload';
        showAppearanceMsg('appearance-success', 'Favicon updated. Browsers cache favicons aggressively, so it may take a refresh or two to visibly change.');
      })
      .catch((err) => {
        console.error('Stryker: favicon save failed', err);
        errEl.textContent = 'Could not save favicon: ' + (err.message || err);
        errEl.style.display = 'block';
      })
      .finally(() => { btn.disabled = false; btn.textContent = 'Upload & save favicon'; });
  });

  document.getElementById('reset-branding-btn').addEventListener('click', () => {
    if (!confirm('Reset to the bundled default logo and favicon?')) return;
    Promise.all([
      db.collection('settings').doc('logo').delete(),
      db.collection('settings').doc('favicon').delete()
    ])
      .then(() => {
        document.getElementById('logo-preview').src = 'assets/images/logo-emblem-sm.png';
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
