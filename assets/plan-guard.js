// Stryker Trading Academy — page access guard, role-rank aware.
// Admins are always exempt. Only loaded on pages that should be gated —
// never on checkout.html, index.html, or any admin page.
//
// Behavior:
// - If the current page's <body> has a data-page-access="<key>" attribute,
//   look up that key in settings/pageAccess (a plan id, or unset/null for
//   "any signed-in student"). Compare the student's plan rank against the
//   required plan's rank, using assets/roles.js.
// - If there's no data-page-access attribute at all (older pages that
//   haven't been tagged), fall back to the original behavior: any plan at
//   all is enough, matching pre-existing behavior so nothing regresses.
// - On failure, show an in-page "upgrade to unlock" overlay — the same
//   paywall-overlay/paywall-card pattern already used on chapter/model/
//   indicator pages — rather than redirecting away.
//
// The .dash-shell on every gated page starts hidden (.gate-pending, set in
// the page's own HTML) behind a full-screen loading overlay, so a student
// without access never gets even a brief flash of the real page before the
// paywall applies. Every code path below — allowed, denied, admin-exempt,
// or an error — must end by calling revealPageContent(), or the page would
// stay stuck hidden forever. The one deliberate exception is "not signed
// in": that's left showing the loading state, since the page's own auth
// check redirects to login shortly after anyway, and that's a better look
// than briefly flashing dashboard content right before the redirect fires.
//
// Depends on: assets/auth.js (`auth`), assets/progress.js (`db`),
// assets/roles.js (hasRoleAccess, loadPlansForRoles, loadPageAccess, labelOf).

(function(){
  function revealPageContent(){
    const gateOverlay = document.getElementById('access-gate-overlay');
    const shell = document.querySelector('.dash-shell');
    if (gateOverlay) gateOverlay.style.display = 'none';
    if (shell) shell.classList.remove('gate-pending');
  }

  // If Firebase itself failed to load, there's no way to check access at
  // all — fail open rather than leave the page stuck hidden forever.
  if (typeof db === 'undefined' || !db) { revealPageContent(); return; }
  if (typeof auth === 'undefined' || !auth) { revealPageContent(); return; }

  function showPlanPaywall(requiredRoleName){
    let overlay = document.getElementById('guest-paywall-overlay');
    // A page without the shared overlay markup still gets the card.
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'paywall-overlay';
      overlay.id = 'guest-paywall-overlay';
      overlay.innerHTML = '<div class="paywall-card">' +
        '<div class="paywall-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>' +
        '<h2 id="paywall-heading"></h2><p id="paywall-body"></p>' +
        '<div class="paywall-actions" id="paywall-actions"></div></div>';
      document.body.appendChild(overlay);
    }
    const heading = document.getElementById('paywall-heading');
    const body = document.getElementById('paywall-body');
    const actions = document.getElementById('paywall-actions');
    if (heading) heading.textContent = 'Upgrade to unlock this page';
    if (body) {
      body.textContent = requiredRoleName
        ? ('This page requires the ' + requiredRoleName + ' plan. Upgrade to keep going.')
        : 'This page requires an active plan. Upgrade to keep going.';
    }
    if (actions) actions.innerHTML = '<button type="button" class="btn btn-primary" data-open-plan-modal data-upgrade-reason="' + (requiredRoleName ? ('This page needs the ' + requiredRoleName + ' plan.') : 'This page needs a higher plan.') + '">See plans</button><a href="dashboard-user.html" class="btn btn-ghost">Back to dashboard</a>';

    // Paywall only the CONTENT column: the sidebar and top nav stay live so
    // a locked page never traps the student — they can keep navigating.
    const main = document.querySelector('.dash-main');
    if (main) {
      Array.from(main.children).forEach((c) => { if (c !== overlay) c.style.display = 'none'; });
      overlay.classList.add('paywall-inline');
      main.appendChild(overlay);
    } else {
      // no main column on this page — fall back to the full-screen overlay
      const shell = document.querySelector('.dash-shell');
      if (shell) shell.classList.add('paywall-dimmed');
    }
    overlay.style.display = 'flex';
    revealPageContent();
  }

  // ---- sidebar lock badges ------------------------------------------------
  // A subtle lock on every sidebar link whose page the current plan can't
  // open, so students see what's gated before they click.
  const PAGE_KEY_BY_FILE = {
    'courses.html': 'curriculum', 'models.html': 'models', 'indicators.html': 'indicators',
    'live-sessions.html': 'live-sessions', 'achievements.html': 'achievements',
    'global-monitor.html': 'global-monitor', 'trading-floor.html': 'trading-floor',
    'trade-journal.html': 'trade-journal', 'referrals.html': 'referrals'
  };

  function annotateSidebarLocks(plan, pageAccess){
    if (!pageAccess || typeof getPageAccessLevel !== 'function') return;
    document.querySelectorAll('.sidebar a.side-link').forEach((a) => {
      const file = (a.getAttribute('href') || '').split(/[?#]/)[0];
      const key = PAGE_KEY_BY_FILE[file];
      if (!key) return;
      const level = getPageAccessLevel(plan, pageAccess[key]);
      if (level !== 'blocked' || a.querySelector('.side-lock')) return;
      const s = document.createElement('span');
      s.className = 'side-lock';
      s.title = 'Upgrade to unlock';
      s.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
      a.appendChild(s);
    });
  }

  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled || !user) return; // the page's own guard handles "not signed in"
    handled = true;

    const pageKey = document.body.getAttribute('data-page-access');

    // Four independent reads — run them all at once rather than in stages.
    // The old version chained admin -> student -> (plans + pageAccess),
    // three sequential round-trips before any decision could be made; on a
    // slow connection that compounds into a genuinely long wait with
    // nothing shown but the loading spinner.
    const adminCheck = db.collection('admins').doc(user.uid).get();
    const studentCheck = db.collection('students').doc(user.uid).get();
    const rolesCheck = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
    const pageAccessCheck = (typeof loadPageAccess === 'function') ? loadPageAccess() : Promise.resolve({});

    Promise.all([adminCheck, studentCheck, rolesCheck, pageAccessCheck]).then(([adminDoc, studentDoc, , pageAccess]) => {
      if (adminDoc.exists) { revealPageContent(); return; } // admins never need a plan

      const plan = studentDoc.exists ? studentDoc.data().plan : null;
      // Published so plan-modal.js can offer only genuine UPGRADES rather
      // than listing the tier they already hold alongside a downgrade.
      window.__strykerCurrentPlan = plan;

      annotateSidebarLocks(plan, pageAccess);

      if (!pageKey) {
        // Ungated page: nothing to check. This used to paywall anyone with no
        // plan, which made sense when a blank plan meant "hasn't bought
        // anything". Since accounts default to the entry plan, a blank one now
        // means the student doc hasn't been healed yet — usually because this
        // read raced ensureStudentDoc's write — and paywalling an ungated page
        // over a field that is simply late is a lockout, not a gate.
        if (!plan) console.warn('Stryker: no plan resolved for this student; revealing ungated page anyway');
        revealPageContent();
        return;
      }

      const rawConfig = pageAccess ? pageAccess[pageKey] : null;
      const level = (typeof getPageAccessLevel === 'function')
        ? getPageAccessLevel(plan, rawConfig)
        : (hasRoleAccess(plan, rawConfig) ? 'full' : 'blocked');

      if (level === 'blocked') {
        const config = (typeof normalizePageAccessConfig === 'function') ? normalizePageAccessConfig(rawConfig) : { minRole: rawConfig, viewOnlyRole: null };
        const requiredRole = config.viewOnlyRole || config.minRole;
        const requiredName = (requiredRole && typeof labelOf === 'function') ? labelOf(requiredRole) : null;
        showPlanPaywall(requiredName);
      } else if (level === 'view') {
        // Can see the page, but shouldn't get interactive access — the
        // page's own CSS/JS reacts to this body class (see trading
        // floor's composer/vote/reply/bookmark restrictions).
        document.body.classList.add('view-only-mode');
        revealPageContent();
      } else {
        revealPageContent();
      }
    }).catch((err) => { console.error('Stryker: plan check failed', err); revealPageContent(); });
  });
})();
