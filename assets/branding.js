// Stryker Trading Academy — dynamic branding (logo + favicon)
// Depends on: assets/progress.js (`db`)
// Loaded on every page. Reads Firestore's settings/appearance doc (public
// read); if an admin has uploaded a custom logo or favicon via
// appearance-admin.html, this swaps them in. If that doc doesn't exist yet,
// the bundled default images already in the HTML are left untouched.

document.addEventListener('DOMContentLoaded', () => {
  if (typeof db === 'undefined') return;

  db.collection('settings').doc('appearance').get().then((doc) => {
    if (!doc.exists) return;
    const data = doc.data();

    if (data.logoUrl) {
      document.querySelectorAll('img.brand-mark').forEach((img) => { img.src = data.logoUrl; });
    }
    if (data.faviconUrl) {
      document.querySelectorAll('link[rel="icon"]').forEach((link) => { link.href = data.faviconUrl; });
      document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((link) => { link.href = data.faviconUrl; });
    }
  }).catch((err) => {
    console.error('Stryker: failed to load custom branding, using defaults', err);
  });
});
