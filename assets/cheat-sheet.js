// cheat-sheet.js — signup gate for the free cheat-sheet download pages
// (cheat-sheet.html: FVG & Order Block; prop-firm-cheat-sheet.html: Prop Firm).
//
// One script for every sheet. Each page sets, on <body>:
//   data-cs-pdf     the PDF path on the site
//   data-cs-return  the path to come back to after signup/login
//   data-cs-label   the activity-log text for a download
// Missing attributes fall back to the FVG sheet's values, so /cheat-sheet
// behaves exactly as before.
//
// Signed out: shows "Create a free account" / "Log in". Both remember this
// page (sessionStorage `stryker_return_to`, the same key auth.js already
// honours in routeAfterAuth), so after signup or login the visitor lands
// back here. Signed in: shows the download link.
//
// The PDF lives at data-cs-pdf on the site. If it isn't there yet (HEAD 404),
// the button stays hidden (it has no href in the markup until the file is
// confirmed) and a "being finished" note shows instead.
//
// Dependencies: Firebase auth compat (initialised by main.js); progress.js
// (ensureStudentDoc) plus profiles-sync.js, referrals.js and roles.js, the
// same helpers the dashboard loads for it.
(function () {
  'use strict';
  var cfg = document.body.dataset;
  var PDF_PATH = cfg.csPdf || 'assets/downloads/stryker-fvg-order-block-cheat-sheet.pdf';
  var RETURN_TO = cfg.csReturn || '/cheat-sheet';
  var LABEL = cfg.csLabel || 'Downloaded the FVG & Order Block cheat sheet';

  var out = document.getElementById('cs-signed-out');
  var inn = document.getElementById('cs-signed-in');
  var dl = document.getElementById('cs-download');
  var pending = document.getElementById('cs-pending');

  function rememberReturn() {
    try { sessionStorage.setItem('stryker_return_to', RETURN_TO); } catch (e) {}
  }
  ['cs-signup', 'cs-login'].forEach(function (id) {
    var a = document.getElementById(id);
    if (a) a.addEventListener('click', rememberReturn);
  });

  function checkPdf() {
    fetch(PDF_PATH, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
      var ok = r.ok && /pdf/i.test(r.headers.get('content-type') || '');
      if (ok) dl.setAttribute('href', PDF_PATH);
      dl.hidden = !ok;
      pending.hidden = ok;
    }).catch(function () { dl.hidden = true; pending.hidden = false; });
  }

  function show(user) {
    out.hidden = !!user;
    inn.hidden = !user;
    if (!user) return;
    checkPdf();
    // A brand-new account lands here straight from signup, before it has
    // ever opened the dashboard (where the student doc is normally made).
    // Create it here the same way, so the signup, its first-touch
    // acquisition record and any referral are saved even if they never go
    // further than this page.
    if (typeof ensureStudentDoc === 'function') {
      ensureStudentDoc(user).catch(function (err) { console.warn('Stryker: student doc not created', err && err.code); });
    }
  }

  if (dl) {
    dl.addEventListener('click', function () {
      if (typeof logActivity === 'function') {
        try { logActivity('content.download', LABEL); } catch (e) {}
      }
    });
  }

  try {
    firebase.auth().onAuthStateChanged(show);
  } catch (e) {
    // Firebase unavailable: leave the signed-out state (the default markup).
  }
})();
