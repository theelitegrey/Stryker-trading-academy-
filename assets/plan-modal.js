// Stryker Trading Academy — in-dashboard plan upgrade modal
// Depends on: assets/progress.js (db), assets/auth.js (auth),
//             assets/roles.js (loadPlansForRoles, rankOf, getCachedPlansForRoles)
//
// Every paywall used to link out to index.html#pricing. That dumps a
// signed-in student onto the public marketing homepage, loses the page they
// were trying to reach, and makes them scroll a sales section to find the
// plan grid. This keeps the whole thing in place: pick a plan, go straight to
// checkout.
//
// Injected rather than added to each page's markup, because thirteen pages
// carry a paywall and four separate files build the actions row. One source
// of truth is worth the small runtime cost.

(function () {

  var MODAL_ID = 'plan-upgrade-modal';

  function esc(s){
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function currentPlanName(){
    // Set by plan-guard/reader when they resolve the student doc. Absent on
    // pages that never needed it, in which case every plan is offered.
    return window.__strykerCurrentPlan || null;
  }

  function buildModal(){
    if (document.getElementById(MODAL_ID)) return document.getElementById(MODAL_ID);

    var overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'plan-modal-overlay';
    overlay.innerHTML =
      '<div class="plan-modal">' +
        '<button type="button" class="plan-modal-close" aria-label="Close">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<h2 class="plan-modal-title">Choose your plan</h2>' +
        '<p class="plan-modal-sub" id="plan-modal-sub">Upgrade to unlock this page.</p>' +
        '<div class="plan-modal-grid" id="plan-modal-grid">' +
          '<div class="loading-state" data-lottie-auto><div class="loading-lottie-wrap"></div></div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('.plan-modal-close').addEventListener('click', closeModal);
    // Backdrop click closes; clicks inside the card must not bubble out to it.
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
    });

    return overlay;
  }

  function renderPlans(plans){
    var grid = document.getElementById('plan-modal-grid');
    if (!grid) return;

    var mine = currentPlanName();
    var myRank = (typeof rankOf === 'function' && mine) ? rankOf(mine) : -1;

    // Only plans ABOVE the current one are worth showing — offering someone
    // the tier they already hold, or a downgrade, is noise on a paywall.
    var upgrades = plans.filter(function (p) {
      if (myRank < 0) return true;
      return (p.rank !== null && p.rank !== undefined ? p.rank : 0) > myRank;
    });

    if (!upgrades.length) {
      grid.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; text-align:center; padding:20px;">' +
        'You are already on the highest plan. If this page still looks locked, contact support.</p>';
      return;
    }

    grid.innerHTML = '';
    upgrades.forEach(function (plan) {
      var color = plan.color || '#00adb5';
      var features = (plan.features || []).slice(0, 5).map(function (f) {
        return '<li><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
               'stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>' + esc(f) + '</li>';
      }).join('');

      var card = document.createElement('div');
      card.className = 'plan-modal-card';
      card.style.borderColor = color + '55';
      card.innerHTML =
        '<span class="plan-modal-pill" style="color:' + color + '; background:' + color + '1a; border-color:' + color + '55;">' +
          esc(plan.name || 'Plan') + '</span>' +
        '<div class="plan-modal-price">$' + esc(plan.price || '0') +
          '<span>/ ' + esc(plan.period || 'month') + '</span></div>' +
        (features ? '<ul class="plan-modal-features">' + features + '</ul>' : '') +
        '<button type="button" class="btn btn-primary plan-modal-pick">Choose ' + esc(plan.name || 'plan') + '</button>';

      card.querySelector('.plan-modal-pick').addEventListener('click', function () {
        // checkout.js reads ?plan=<id>, and auth.js already stores a return-to
        // path, so this slots into the existing purchase flow unchanged.
        window.location.href = 'checkout.html?plan=' + encodeURIComponent(plan.id);
      });

      grid.appendChild(card);
    });
  }

  function openModal(reasonText){
    var overlay = buildModal();
    var sub = document.getElementById('plan-modal-sub');
    if (sub && reasonText) sub.textContent = reasonText;

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    var load = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve([]);
    load.then(function (plans) {
      renderPlans(plans || []);
    }).catch(function (err) {
      var grid = document.getElementById('plan-modal-grid');
      if (grid) {
        grid.innerHTML = '<p style="color:var(--bear); font-size:13.5px; text-align:center; padding:20px;">' +
          'Could not load plans: ' + esc(err.message || err) + '</p>';
      }
    });
  }

  function closeModal(){
    var overlay = document.getElementById(MODAL_ID);
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Exposed so the four paywall builders (plan-guard, reader, model-reader,
  // indicator-reader) can all call the same thing.
  window.openPlanUpgradeModal = openModal;
  window.closePlanUpgradeModal = closeModal;

  // Any paywall button can opt in with data-open-plan-modal, including ones
  // rendered after this script ran — hence a delegated listener.
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest ? e.target.closest('[data-open-plan-modal]') : null;
    if (!trigger) return;
    e.preventDefault();
    openModal(trigger.getAttribute('data-upgrade-reason') || null);
  });

})();
