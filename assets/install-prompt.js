// Stryker Trading Academy — install-to-home-screen prompt
//
// A first-visit bottom sheet on the mobile dashboard inviting the student to
// install the site, plus installStrykerApp() for the Settings button so it can
// be done deliberately at any time later.
//
// Shown ONCE per account on this device — the flag is set the moment the sheet
// appears, not when it is dismissed, so nobody is nagged on every visit. It
// never appears when already running installed, on desktop, or for guests.
//
// TWO PLATFORMS, TWO MECHANISMS. Chromium fires `beforeinstallprompt`, which
// we hold onto and replay from our own button — the browser's native install
// dialog then does the work. iOS Safari has no such API at all: the only path
// is Share → Add to Home Screen, so there the sheet teaches those two taps
// instead of pretending to have a button that cannot work.

(function () {

  var deferredEvent = null;

  // Must be listening before the browser decides to fire it, which can be as
  // early as page load — hence top-level, not inside DOMContentLoaded.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();      // keep Chrome's own banner from racing ours
    deferredEvent = e;
  });

  window.addEventListener('appinstalled', function () {
    deferredEvent = null;
    var card = document.getElementById('install-sheet');
    if (card) closeSheet();
    if (typeof showToast === 'function') showToast('success', 'Stryker is installed — look for the dragon on your home screen.');
    refreshSettingsCard();
  });

  function isStandalone(){
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  function isIOS(){ return /iPad|iPhone|iPod/.test(navigator.userAgent); }

  function isMobile(){
    return /Android|iPad|iPhone|iPod/.test(navigator.userAgent) ||
           window.matchMedia('(max-width: 820px)').matches;
  }

  function shownKey(uid){ return 'stryker_install_prompt_shown_' + uid; }

  // Chromium without a captured install event — the site is usually already
  // installed (Chrome never re-offers while a previous shortcut exists), or
  // the browser simply is not offering right now. Either way the manual path
  // works, so teach it instead of falling back to a toast.
  function androidStepsHtml(){
    return '<ol class="install-steps">' +
      '<li><span class="install-step-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></span>' +
        'Tap the <b>&#8942; menu</b> in your browser</li>' +
      '<li><span class="install-step-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg></span>' +
        'Choose <b>Add to Home screen</b> (or <b>Install app</b>)</li>' +
      '<li class="install-step-note">Already see Stryker there? It is installed — remove the old icon and re-add it to get the new one.</li>' +
    '</ol>';
  }

  function iosStepsHtml(){
    return '<ol class="install-steps">' +
      '<li><span class="install-step-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M12 15V3m0 0L8 7m4-4l4 4"/><path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/></svg></span>' +
        'Tap the <b>Share</b> button in Safari</li>' +
      '<li><span class="install-step-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg></span>' +
        'Choose <b>Add to Home Screen</b></li>' +
    '</ol>';
  }

  // ---- the bottom sheet ----------------------------------------------------

  function closeSheet(){
    var wrap = document.getElementById('install-sheet');
    if (!wrap) return;
    wrap.classList.remove('in');
    setTimeout(function () { if (wrap.parentElement) wrap.remove(); }, 300);
  }

  function openSheet(){
    if (document.getElementById('install-sheet')) return;

    var ios = isIOS();
    var canPrompt = !!deferredEvent;

    // One-tap button only when the browser has actually offered install;
    // otherwise the platform's manual steps. Never a button that cannot work.
    var steps = canPrompt ? '' : (ios ? iosStepsHtml() : androidStepsHtml());

    var wrap = document.createElement('div');
    wrap.id = 'install-sheet';
    wrap.className = 'install-sheet-wrap';
    wrap.innerHTML =
      '<div class="install-sheet-backdrop" data-install-close></div>' +
      '<div class="install-sheet" role="dialog" aria-modal="true" aria-label="Install Stryker">' +
        '<span class="install-grab" aria-hidden="true"></span>' +
        '<img class="install-icon" src="assets/images/icon-192.png" alt="" width="64" height="64">' +
        '<h3>Put Stryker on your home screen</h3>' +
        '<p>The full academy as an app — opens straight to your dashboard, full screen, with your notifications. No app store needed.</p>' +
        '<div id="install-sheet-mid">' + steps + '</div>' +
        '<div class="install-sheet-actions">' +
          (canPrompt ? '<button type="button" class="btn btn-primary" id="install-go">Install the app</button>' : '') +
          '<button type="button" class="btn btn-ghost" data-install-close>' + (canPrompt ? 'Not now' : 'Got it') + '</button>' +
        '</div>' +
        '<p class="install-later">You can always do this later from Settings.</p>' +
      '</div>';
    document.body.appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add('in'); });

    wrap.querySelectorAll('[data-install-close]').forEach(function (el) {
      el.addEventListener('click', closeSheet);
    });

    var go = document.getElementById('install-go');
    if (go) go.addEventListener('click', function () {
      if (!deferredEvent) { closeSheet(); return; }
      var ev = deferredEvent;
      // A used event is spent either way — Chrome will not accept a second
      // prompt() on it, but fires a fresh beforeinstallprompt on later visits.
      deferredEvent = null;
      ev.prompt();
      ev.userChoice.then(function (choice) { closeSheet(); });
    });

    // Chrome sometimes decides the site is installable only after the sheet is
    // already open. If the event lands now, swap the steps for the one-tap
    // button rather than leaving instructions for a menu nobody needs.
    if (!canPrompt) {
      window.addEventListener('beforeinstallprompt', function upgrade(e) {
        e.preventDefault();
        deferredEvent = e;
        window.removeEventListener('beforeinstallprompt', upgrade);
        var sheet = document.getElementById('install-sheet');
        if (!sheet) return;
        var mid = document.getElementById('install-sheet-mid');
        if (mid) mid.innerHTML = '';
        var actions = sheet.querySelector('.install-sheet-actions');
        if (actions && !document.getElementById('install-go')) {
          var btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'btn btn-primary'; btn.id = 'install-go';
          btn.textContent = 'Install the app';
          actions.insertBefore(btn, actions.firstChild);
          btn.addEventListener('click', function () {
            if (!deferredEvent) { closeSheet(); return; }
            var ev = deferredEvent; deferredEvent = null;
            ev.prompt();
            ev.userChoice.then(function () { closeSheet(); });
          });
        }
      });
    }
  }

  // Public: the Settings button (and anything else) can open this any time.
  window.installStrykerApp = openSheet;
  window.strykerInstalled = isStandalone;

  // ---- Settings card -------------------------------------------------------

  function refreshSettingsCard(){
    var state = document.getElementById('install-state');
    var btn = document.getElementById('install-open-btn');
    if (!state || !btn) return;
    if (isStandalone()) {
      state.textContent = 'Installed — you are using it right now.';
      btn.style.display = 'none';
    } else {
      state.textContent = isMobile()
        ? 'Not installed on this device.'
        : 'Best on a phone — open strykertrading.com there to install.';
      btn.style.display = 'inline-flex';
    }
  }

  // ---- first-visit trigger on the dashboard --------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    refreshSettingsCard();
    var btn = document.getElementById('install-open-btn');
    if (btn) btn.addEventListener('click', openSheet);

    // The automatic sheet: mobile dashboard, signed in, not installed, and
    // never shown for this account on this device before.
    if (!document.getElementById('dash-greeting') && !document.querySelector('.dash-main')) return;
    if (!/dashboard-user/.test(location.pathname)) return;
    if (isStandalone() || !isMobile()) return;
    if (typeof auth === 'undefined' || !auth) return;

    var ran = false;
    auth.onAuthStateChanged(function (user) {
      if (ran || !user) return;
      ran = true;
      try {
        if (localStorage.getItem(shownKey(user.uid)) === '1') return;
        localStorage.setItem(shownKey(user.uid), '1');
      } catch (e) { return; }
      // A beat after the dashboard paints, so it reads as an invitation over a
      // loaded page rather than a wall in front of a blank one.
      setTimeout(openSheet, 1600);
    });
  });

})();
