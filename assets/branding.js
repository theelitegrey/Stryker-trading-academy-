// Stryker Trading Academy — dynamic branding (logo + favicon)
// Depends on: assets/progress.js (`db`)
// Loaded on every page. Reads Firestore's settings/logo and settings/favicon
// docs (public read) — if an admin has uploaded a custom one via
// appearance-admin.html, this swaps it in over the bundled default already
// in the HTML. Images are stored as small base64 data URLs directly in
// Firestore (no Cloud Storage / paid plan required), which work as a plain
// <img src> or <link rel="icon" href> value exactly like a hosted file URL.

document.addEventListener('DOMContentLoaded', () => {
  if (typeof db === 'undefined') return;

  db.collection('settings').doc('logo').get().then((doc) => {
    if (doc.exists && doc.data().dataUrl) {
      document.querySelectorAll('img.brand-mark').forEach((img) => { img.src = doc.data().dataUrl; });
    }
  }).catch((err) => console.error('Stryker: failed to load custom logo, using default', err));

  db.collection('settings').doc('favicon').get().then((doc) => {
    if (doc.exists && doc.data().dataUrl) {
      document.querySelectorAll('link[rel="icon"]').forEach((link) => { link.href = doc.data().dataUrl; });
      document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((link) => { link.href = doc.data().dataUrl; });
    }
  }).catch((err) => console.error('Stryker: failed to load custom favicon, using default', err));
});
