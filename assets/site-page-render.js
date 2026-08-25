// Stryker Trading Academy — Site page renderer (about.html, support.html,
// terms.html, privacy.html, cookies.html, gdpr.html, contact.html,
// refund-policy.html). Depends on: assets/progress.js (`db`), assets/site-pages.js
//
// Each page's <body> carries data-page-key="..." identifying which
// sitePages/{key} doc to render. Falls back to a plain "content coming
// soon" notice if the admin hasn't written this page yet, rather than
// showing an empty page or an error.

document.addEventListener('DOMContentLoaded', () => {
  const key = document.body.dataset.pageKey;
  if (!key || typeof db === 'undefined' || !db) return;

  loadSitePage(key).then((page) => {
    const titleEl = document.getElementById('site-page-title');
    const updatedEl = document.getElementById('site-page-updated');
    const bodyEl = document.getElementById('site-page-body');

    if (page && page.title && titleEl) {
      titleEl.textContent = page.title;
      document.title = page.title + ' — Stryker Trading Academy';
    }
    if (page && page.updatedAt && typeof page.updatedAt.toDate === 'function' && updatedEl) {
      updatedEl.textContent = 'Last updated ' + page.updatedAt.toDate().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    }
    if (bodyEl) {
      bodyEl.innerHTML = (page && page.bodyHtml)
        ? page.bodyHtml
        : '<p style="color:var(--ink-3);">This page hasn\'t been published yet. Please check back soon.</p>';
    }
  }).catch((err) => {
    console.error('Stryker: failed to load site page', key, err);
    const bodyEl = document.getElementById('site-page-body');
    if (bodyEl) bodyEl.innerHTML = '<p style="color:var(--ink-3);">This page could not be loaded right now — please try again shortly.</p>';
  });

  // Optional contact form (only present on contact.html) — saves to a new
  // admin-only-readable collection rather than requiring an email backend.
  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const errEl = document.getElementById('contact-form-error');
      const okEl = document.getElementById('contact-form-success');
      errEl.style.display = 'none'; okEl.style.display = 'none';

      const name = document.getElementById('contact-name').value.trim();
      const email = document.getElementById('contact-email').value.trim();
      const message = document.getElementById('contact-message').value.trim();
      if (!name || !email || !message) {
        errEl.textContent = 'Please fill in your name, email, and message.';
        errEl.style.display = 'block';
        return;
      }

      const btn = contactForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      db.collection('contactMessages').add({
        name: name, email: email, message: message,
        userUid: (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser.uid : null,
        status: 'new',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(() => {
        contactForm.reset();
        okEl.textContent = "Message sent — we'll get back to you soon.";
        okEl.style.display = 'block';
        if (typeof showToast === 'function') showToast('success', "Message sent — we'll get back to you soon.");
      }).catch((err) => {
        errEl.textContent = err.message || 'Could not send your message right now.';
        errEl.style.display = 'block';
      }).finally(() => { btn.disabled = false; });
    });
  }
});
