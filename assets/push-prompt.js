// Stryker Trading Academy — push notification prompt
// Depends on: assets/push.js, assets/auth.js
//
// Sits at the top of the dashboard for anyone who hasn't turned push on.
//
// IT DOES NOT REQUEST PERMISSION ITSELF. The Enable button here calls the same
// enablePush() the Settings toggle does, so the browser prompt still only ever
// follows a deliberate tap. That distinction is the whole point: browsers
// remember a denial permanently and will not ask again, so a prompt fired at
// someone who has not asked for it costs that device push forever. This card
// earns the tap first by saying what it is for.
//
// WHEN IT STAYS HIDDEN
//   - push already on for this device
//   - permission already denied (nothing to offer — the browser won't re-ask)
//   - the browser cannot do push at all
//   - dismissed for this account
//   - iPhone not installed to the Home Screen, where web push is unavailable
//     regardless of what the card says
//
// Dismissal is per account and permanent, in localStorage. Not sessionStorage:
// reappearing on every visit after being turned down is how a prompt becomes
// something people learn to swat away without reading.

(function () {

  function dismissKey(uid){ return 'stryker_push_prompt_dismissed_' + uid; }

  function isDismissed(uid){
    try { return localStorage.getItem(dismissKey(uid)) === '1'; }
    catch (e) { return false; }
  }

  function dismiss(uid){
    try { localStorage.setItem(dismissKey(uid), '1'); } catch (e) {}
  }

  function build(uid){
    var host = document.querySelector('.dash-main');
    var topbar = host && host.querySelector('.dash-topbar');
    if (!host || document.getElementById('push-prompt')) return;

    var card = document.createElement('div');
    card.className = 'push-prompt';
    card.id = 'push-prompt';
    card.innerHTML =
      '<div class="push-prompt-glow" aria-hidden="true"></div>' +
      '<div class="push-prompt-icon">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">' +
          '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>' +
          '<path d="M13.73 21a2 2 0 0 1-3.46 0"/>' +
        '</svg>' +
      '</div>' +
      '<div class="push-prompt-body">' +
        '<h3>Never miss a setup</h3>' +
        '<p>Turn on notifications and this device will alert you the moment a live ' +
          'session starts, someone replies to your post, or a message arrives — even ' +
          'with the site closed.</p>' +
        '<div class="push-prompt-actions">' +
          '<button type="button" class="btn btn-primary btn-sm" id="push-prompt-enable">Turn on notifications</button>' +
          '<a href="settings.html" class="btn btn-ghost btn-sm">More options</a>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="push-prompt-close" id="push-prompt-close" aria-label="Dismiss">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>';

    // Directly under the greeting, above the stats — noticeable without
    // pushing the page's actual content off the first screen.
    if (topbar && topbar.nextSibling) host.insertBefore(card, topbar.nextSibling);
    else host.insertBefore(card, host.firstChild);

    requestAnimationFrame(function () { card.classList.add('in'); });

    function close(){
      card.classList.add('out');
      // Removed only after the transition, so it animates away rather than
      // vanishing and jerking the layout up.
      setTimeout(function () { if (card.parentElement) card.remove(); }, 260);
    }

    document.getElementById('push-prompt-close').addEventListener('click', function () {
      dismiss(uid);
      close();
    });

    document.getElementById('push-prompt-enable').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Turning on…';
      enablePush().then(function (status) {
        if (status === 'enabled') {
          if (typeof showToast === 'function') {
            showToast('success', 'Notifications are on for this device.');
          }
          dismiss(uid);   // done with it — don't ask again on another device visit
          close();
          return;
        }
        var msg = status === 'denied'
          ? 'You declined the browser prompt, so nothing will be sent to this device.'
          : status === 'no-key'
            ? 'Notifications are not configured yet. Try again later.'
            : 'Could not turn notifications on. You can retry from Settings.';
        if (typeof showToast === 'function') showToast('error', msg);
        btn.disabled = false;
        btn.textContent = 'Turn on notifications';
        // Denial is permanent in the browser, so leaving the card up would
        // offer a button that can no longer do anything.
        if (status === 'denied' || status === 'blocked') { dismiss(uid); close(); }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('.dash-main')) return;
    if (typeof auth === 'undefined' || !auth) return;
    if (typeof enablePush !== 'function') return;

    var ran = false;
    auth.onAuthStateChanged(function (user) {
      if (ran || !user) return;
      ran = true;

      if (isDismissed(user.uid)) return;
      if (typeof pushSupported !== 'function' || !pushSupported()) return;
      if (Notification.permission === 'denied') return;

      // iOS only allows web push for sites installed to the Home Screen, so
      // offering it in Safari would be a button that cannot work.
      var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      var installed = window.matchMedia('(display-mode: standalone)').matches ||
                      window.navigator.standalone === true;
      if (isIOS && !installed) return;

      pushEnabledOnThisDevice().then(function (on) {
        if (!on) build(user.uid);
      });
    });
  });

})();
