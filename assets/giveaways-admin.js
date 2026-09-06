// Stryker Trading Academy — Admin: Giveaways (giveaways-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js
//
// For now the module edits the teaser shown on the student Giveaways page
// (settings/giveaways — world-readable, admin-writable). Actual giveaway
// records (drops, entries, winners) will live in their own collection when
// the first one runs; this page is where that management plugs in.

document.addEventListener('DOMContentLoaded', () => {
  const errEl = document.getElementById('gv-admin-error');

  guardAdminPage(() => {
    db.collection('settings').doc('giveaways').get().then((doc) => {
      const d = doc.exists ? (doc.data() || {}) : {};
      document.getElementById('gv-adm-headline').value = d.headline || '';
      document.getElementById('gv-adm-sub').value = d.sub || '';
    }).catch((err) => {
      errEl.textContent = 'Could not load the saved teaser: ' + (err.message || err);
      errEl.style.display = 'block';
    });
  });

  document.getElementById('gv-adm-save').addEventListener('click', () => {
    errEl.style.display = 'none';
    const btn = document.getElementById('gv-adm-save');
    btn.disabled = true;

    const data = {
      headline: document.getElementById('gv-adm-headline').value.trim(),
      sub: document.getElementById('gv-adm-sub').value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (typeof logActivity === 'function') logActivity('giveaways.teaser_saved', 'Updated the giveaways teaser');
    db.collection('settings').doc('giveaways').set(data, { merge: true })
      .then(() => showToast('success', 'Teaser saved — the student Giveaways page shows it now.'))
      .catch((err) => {
        errEl.textContent = err.message || 'Could not save the teaser.';
        errEl.style.display = 'block';
      })
      .finally(() => { btn.disabled = false; });
  });
});
