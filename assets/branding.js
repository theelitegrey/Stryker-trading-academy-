// Stryker Trading Academy — dynamic branding (logo + favicon)
// Depends on: assets/progress.js (`db`)
//
// An admin can upload a custom logo/favicon in appearance-admin.html; those are
// stored as small base64 data URLs in Firestore (settings/logo,
// settings/favicon), which work as a plain img src exactly like a hosted file.
//
// THE FLASH THIS FIXES
// The HTML ships the bundled default, so the browser paints it immediately.
// The old version then waited for DOMContentLoaded AND a Firestore round trip
// before swapping in the custom one — several hundred milliseconds on mobile,
// during which the previous logo was plainly visible. On a site whose branding
// had changed, every visitor saw the old logo first, on every page load.
//
// Two changes:
//
//   1. The resolved data URL is cached in localStorage and applied
//      SYNCHRONOUSLY as this file parses — no DOMContentLoaded wait, no
//      network wait. This script sits at the end of <body>, so the brand
//      images already exist and can be corrected before they are painted.
//
//   2. Firestore is still read, but only to refresh that cache. A repeat
//      visitor never sees the wrong logo; a first-time visitor sees it for one
//      paint, which is the best achievable without inlining the image into
//      every page.
//
// The real elimination is to replace assets/images/logo-header.png with the
// current logo so the bundled default and the upload agree — then there is
// nothing to swap. This file makes the mismatch cheap, not correct.

var BRAND_LOGO_KEY = 'stryker_brand_logo';
var BRAND_FAVICON_KEY = 'stryker_brand_favicon';

function brandRead(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function brandWrite(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (e) { /* private mode or quota — the Firestore read still works */ }
}

function applyLogo(dataUrl) {
  if (!dataUrl) return;
  document.querySelectorAll('img.brand-mark').forEach(function (img) {
    // Reassigning src to its current value still triggers a reload in some
    // browsers, which is its own flicker.
    if (img.src !== dataUrl) img.src = dataUrl;
  });
}

function applyFavicon(dataUrl) {
  if (!dataUrl) return;
  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')
    .forEach(function (link) {
      if (link.href !== dataUrl) link.href = dataUrl;
    });
}

// --- Synchronous pass from cache. This is what removes the flash. -----------
applyLogo(brandRead(BRAND_LOGO_KEY));
applyFavicon(brandRead(BRAND_FAVICON_KEY));

// --- Refresh from Firestore in the background. ------------------------------
document.addEventListener('DOMContentLoaded', function () {
  if (typeof db === 'undefined') return;

  db.collection('settings').doc('logo').get().then(function (doc) {
    var url = (doc.exists && doc.data().dataUrl) ? doc.data().dataUrl : null;
    if (url) {
      if (url !== brandRead(BRAND_LOGO_KEY)) {
        brandWrite(BRAND_LOGO_KEY, url);
        applyLogo(url);
      }
    } else {
      // Admin reset to the bundled default — drop the cache, or every device
      // holding the old custom logo would keep showing it indefinitely.
      brandWrite(BRAND_LOGO_KEY, null);
    }
  }).catch(function (err) {
    console.error('Stryker: failed to load custom logo, using default', err);
  });

  db.collection('settings').doc('favicon').get().then(function (doc) {
    var url = (doc.exists && doc.data().dataUrl) ? doc.data().dataUrl : null;
    if (url) {
      if (url !== brandRead(BRAND_FAVICON_KEY)) {
        brandWrite(BRAND_FAVICON_KEY, url);
        applyFavicon(url);
      }
    } else {
      brandWrite(BRAND_FAVICON_KEY, null);
    }
  }).catch(function (err) {
    console.error('Stryker: failed to load custom favicon, using default', err);
  });
});
