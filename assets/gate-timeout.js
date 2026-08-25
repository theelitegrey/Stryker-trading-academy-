// Stryker Trading Academy — last-resort safety net for gated pages
//
// Every gated page starts with .dash-shell.gate-pending (visibility:hidden)
// behind #access-gate-overlay, so nobody sees a flash of real content before
// the access check resolves. The contract is that some guard — plan-guard.js,
// reader.js, model-reader.js, indicator-reader.js — always finishes by
// revealing the shell.
//
// That contract can break: Firebase never resolves auth state (browser is
// blocking IndexedDB), a Firestore read hangs on a dead connection, a guard
// throws before its reveal path, or the page is a stale cached copy whose
// guard script no longer matches. In every one of those cases the visitor is
// left staring at a spinner with no error and no way out — indistinguishable
// from the site being broken.
//
// So: if the shell is STILL hidden after the timeout, reveal it anyway and
// say something. Revealing is safe here — plan-guard has its own paywall for
// people who lack a plan, and the Firestore rules are the real access
// boundary regardless of what the DOM shows.

(function(){
  var TIMEOUT_MS = 8000;

  function stillHidden(){
    var shell = document.querySelector('.dash-shell.gate-pending, .reader-shell.gate-pending');
    return !!shell;
  }

  function rescue(){
    if (!stillHidden()) return;

    var shell = document.querySelector('.dash-shell.gate-pending, .reader-shell.gate-pending');
    var gateOverlay = document.getElementById('access-gate-overlay');
    if (gateOverlay) gateOverlay.style.display = 'none';
    if (shell) shell.classList.remove('gate-pending');

    // Don't stack on top of a notice another script already put up.
    if (document.getElementById('session-notice')) return;
    if (document.getElementById('gate-timeout-notice')) return;

    var host = document.querySelector('.dash-main') ||
               document.querySelector('.reader-main') ||
               shell;
    if (!host) return;

    var el = document.createElement('div');
    el.id = 'gate-timeout-notice';
    el.className = 'notice';
    el.style.margin = '20px 0';
    el.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>' +
      '<p><b>This page took too long to confirm your access.</b><br>' +
      'Usually this means your browser is blocking the storage the login needs, ' +
      'or you are viewing an out-of-date cached copy of the site. ' +
      'Signing in again normally clears it.' +
      '<br><a href="login.html" class="btn btn-primary btn-sm" style="margin-top:10px; display:inline-flex;">Go to login</a></p>';

    host.insertBefore(el, host.firstChild);
    console.warn('Stryker: access gate never resolved — revealed by gate-timeout.js after ' + TIMEOUT_MS + 'ms');
  }

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(rescue, TIMEOUT_MS);
  });
})();
