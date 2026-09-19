/* Master Panel — boot: sign-in gate, session, chrome wiring.
 *
 * Authorisation is Firestore's, not this file's. The gate below decides what
 * to *show*; every read and write still goes through the rules, which allow
 * the panel collections only to a uid present in admins/.
 */
(function () {
  'use strict';

  var gate = document.getElementById('gate');
  var shell = document.getElementById('shell');
  var err = document.getElementById('gate-err');

  function showGate(message) {
    gate.hidden = false;
    shell.hidden = true;
    err.textContent = message || '';
  }
  function showPanel(user) {
    PANEL.user = user;
    gate.hidden = true;
    shell.hidden = false;
    document.getElementById('who').textContent = user.email || '';
    PANEL.loadSettings()
      .then(function () { return PANEL.loadAll(true); })
      .then(function () {
        PANEL.render();
        return PANEL.health.fetch();
      })
      .then(refreshAlertChip);
  }

  function refreshAlertChip(feed) {
    var chip = document.getElementById('alert-chip');
    var alerts = PANEL.health.build(feed || PANEL.health.data);
    var urgent = alerts.filter(function (a) { return a.severity === 'bad'; }).length;
    if (!alerts.length) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = urgent
      ? urgent + ' urgent'
      : alerts.length + ' warning' + (alerts.length === 1 ? '' : 's');
    chip.onclick = function () { PANEL.go('ops'); };
  }
  PANEL.refreshAlertChip = refreshAlertChip;

  // ---- sign in ---------------------------------------------------------
  document.getElementById('gate-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!PANEL.auth) { err.textContent = 'Firebase failed to load. Refresh the page.'; return; }
    var btn = document.getElementById('gate-submit');
    btn.disabled = true;
    err.textContent = '';
    PANEL.auth.signInWithEmailAndPassword(
      document.getElementById('gate-email').value.trim(),
      document.getElementById('gate-pass').value
    ).catch(function (e) {
      btn.disabled = false;
      err.textContent = e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password'
        ? 'That email and password do not match an account.'
        : (e.message || 'Sign-in failed.');
    });
  });

  if (!PANEL.auth) {
    showGate('Firebase failed to initialise. Check the network and refresh.');
  } else {
    PANEL.auth.onAuthStateChanged(function (user) {
      if (!user) { showGate(''); return; }
      PANEL.db.collection('admins').doc(user.uid).get()
        .then(function (doc) {
          if (doc.exists) { showPanel(user); return; }
          PANEL.auth.signOut();
          showGate('That account is signed in, but it is not an admin.');
        })
        .catch(function (e) {
          // Fail closed: an unreadable roster is not a pass.
          console.error('panel: admin check failed', e);
          PANEL.auth.signOut();
          showGate('Could not verify admin access (' + (e.code || e.message) + ').');
        });
    });
  }

  // ---- chrome ----------------------------------------------------------
  document.querySelectorAll('[data-sign-out]').forEach(function (b) {
    b.onclick = function () { PANEL.auth.signOut(); };
  });
  document.getElementById('side-toggle').onclick = function () {
    document.getElementById('side').classList.toggle('open');
  };
  document.getElementById('theme-toggle').onclick = function () {
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'dark' : 'light');
    try { localStorage.setItem('panel_theme', light ? 'dark' : 'light'); } catch (e) { }
  };
  document.getElementById('modal-close').onclick = PANEL.closeModal;
  document.getElementById('modal-back').addEventListener('click', function (ev) {
    if (ev.target === ev.currentTarget) PANEL.closeModal();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !document.getElementById('modal-back').hidden) PANEL.closeModal();
  });

  window.addEventListener('hashchange', function () {
    if (!shell.hidden) PANEL.render();
  });

  // The health feed is refreshed by a workflow, not by this page. Re-reading
  // it every 5 minutes keeps a panel left open on a second monitor honest.
  setInterval(function () {
    if (shell.hidden) return;
    PANEL.health.fetch(true).then(function (feed) {
      refreshAlertChip(feed);
      if (PANEL.route() === 'overview' || PANEL.route() === 'sites') PANEL.render();
    });
  }, 300000);
})();
