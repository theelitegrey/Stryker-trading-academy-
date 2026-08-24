// Stryker Trading Academy — Site Pages module (legal/info pages: About,
// Support, Terms & Risk Disclosure, Privacy, Cookies, GDPR, Contact, Refund)
// Depends on: assets/progress.js (`db`)
//
// Collection: sitePages/{pageKey} — public read (anyone, even signed out,
// needs to read a Privacy Policy), admin-only write. Mirrors the exact same
// pattern already used for chapters/models/plans/settings.

const SITE_PAGES_REGISTRY = [
  { key: 'about', label: 'About Us' },
  { key: 'support', label: 'Support' },
  { key: 'terms', label: 'Terms & Risk Disclosure' },
  { key: 'privacy', label: 'Privacy Policy' },
  { key: 'cookies', label: 'Cookie Policy' },
  { key: 'gdpr', label: 'GDPR' },
  { key: 'contact', label: 'Contact Us' },
  { key: 'refund-policy', label: 'Refund Policy' }
];

function sitePagesCollectionRef(){
  return db.collection('sitePages');
}

function loadSitePage(key){
  return sitePagesCollectionRef().doc(key).get()
    .then((doc) => {
      if (doc.exists) return Object.assign({ key: key }, doc.data());
      // Not yet customized by an admin — fall back to the built-in draft so
      // the public page shows real content and the editor opens pre-filled
      // instead of blank.
      const fallback = (typeof SITE_PAGES_DEFAULTS !== 'undefined') ? SITE_PAGES_DEFAULTS[key] : null;
      return fallback ? Object.assign({ key: key }, fallback) : null;
    });
}

function loadAllSitePages(){
  return sitePagesCollectionRef().get()
    .then((snap) => {
      const map = {};
      snap.forEach((doc) => { map[doc.id] = doc.data(); });
      return SITE_PAGES_REGISTRY.map((entry) => {
        const fallback = (typeof SITE_PAGES_DEFAULTS !== 'undefined' && SITE_PAGES_DEFAULTS[entry.key]) ? SITE_PAGES_DEFAULTS[entry.key] : {};
        return Object.assign({ key: entry.key, label: entry.label, title: entry.label, bodyHtml: '' }, fallback, map[entry.key] || {});
      });
    });
}

function saveSitePage(key, data){
  return sitePagesCollectionRef().doc(key).set(
    Object.assign({}, data, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() }),
    { merge: true }
  );
}
