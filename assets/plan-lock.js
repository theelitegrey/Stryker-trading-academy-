// TradeZoro: the one "this is part of Pro" lock card (pricing upgrades, 2026-10-12)
// Depends on: assets/roles.js (loadPlansForRoles, chapterLimitOf),
//             assets/plan-price.js (planSaleInfo, planIsArchived, planDisplayName),
//             assets/trial.js (strykerTrialDecorate; optional),
//             assets/plan-modal.js (data-open-plan-modal fallback; optional).
//
// Used by the GEX page (assets/gex.js: locked market / expiry / strike table)
// and the chapter reader (assets/reader.js: chapter 11+ for Free members, and
// the end of the last free chapter), so the wording lives in ONE place.
//
// The card: lock icon, title, two short bullets, one button, and the line
// "Education only. Not financial advice." No countdowns, no scarcity.
//
// Button: a link to checkout for the Pro plan, the same link the pricing card
// uses. It reads "Join Pro" and strykerTrialDecorate() relabels it "Start
// 7-day free trial" (plus the small-print icon) only when the server says this
// member can still have a trial. A member who already used one, or any member
// while the trial switch is off, keeps "Join Pro". Until the plans have loaded
// the button opens the upgrade modal instead, so it is never dead.
//
// API (global):
//   strykerPlanLock.card(kind, where, opts) -> HTMLElement
//     kind  'gex' | 'options' | 'scanner' | 'chapters'
//     where short tag for analytics, e.g. 'gex-market', 'chapter-end'
//     opts  { closable: bool, onClose: fn, chapterLimit: number,
//             back: { href, label } (a quiet second link, e.g. back to chapters) }
//     For 'chapters' without chapterLimit, the limit comes from the member's
//     plan (window.__strykerCurrentPlan) or the entry plan, via roles.js
//     chapterLimitOf, so "Chapters 11+" follows the plan's chapterAccess.
//
// Events: there is no analytics/event path on the site that can take new
// event names without a Firestore rules change (traffic/ only accepts the
// daily visit counter ids; activityLog is the admin audit trail). So nothing
// is written. Each view / click dispatches a DOM event instead,
//   document 'stryker:lock' { detail: { event: 'lock_view'|'lock_click', where } }
// for a future analytics hook to pick up.
(function () {
  'use strict';

  var COPY = {
    gex: {
      title: function () { return 'Futures GEX+ levels are part of Pro'; },
      bullets: function () {
        return ['ES, NQ and gold (GC) futures levels at every expiry (Free covers SPX 0DTE)',
                'The strike table: net GEX, DEX and open interest by strike'];
      },
      reason: 'Pro unlocks GEX+ for every market and expiry, and the strike table.'
    },
    scanner: {
      title: function () { return 'Custom scanner filters are part of Pro'; },
      bullets: function () {
        return ['Build your own scans: any column, any value, on US stocks, ETFs and crypto',
                'Free keeps every preset scan'];
      },
      reason: 'Pro unlocks custom scanner filters.'
    },
    options: {
      title: function () { return 'QQQ and SPY options analytics are part of Pro'; },
      bullets: function () {
        return ['Expected move, IV rank, term structure and skew for QQQ (NQ) and SPY (Free covers SPX)',
                'Plus futures GEX+ for every market and expiry, gold (GC) included'];
      },
      reason: 'Pro unlocks options analytics for every market.'
    },
    chapters: {
      title: function (n) { return n ? 'Chapters ' + (n + 1) + '+ are part of Pro' : 'Later chapters are part of Pro'; },
      bullets: function (n) {
        return [(n ? 'Chapter ' + (n + 1) + ' to the end of the course' : 'Every chapter of the course') + ', with progress saved',
                'Plus futures GEX+ for every market and an unlimited JournalX'];
      },
      reason: 'Pro unlocks every chapter of the course.'
    }
  };

  var LOCK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  var TICK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

  function emit(event, where) {
    try { document.dispatchEvent(new CustomEvent('stryker:lock', { detail: { event: event, where: where } })); } catch (e) {}
  }

  // The plan sold on the pricing card: featured, priced, not hidden/archived.
  var _proPromise = null;
  function proPlan() {
    if (_proPromise) return _proPromise;
    var load = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve([]);
    _proPromise = load.then(function (all) {
      var price = function (p) { return (typeof planSaleInfo === 'function') ? planSaleInfo(p).price : (parseFloat(p.price) || 0); };
      var sold = (all || []).filter(function (p) {
        return !p.hidden && !(typeof planIsArchived === 'function' ? planIsArchived(p) : p.archived === true) && price(p) > 0;
      });
      return sold.find(function (p) { return p.featured; }) || sold[0] || null;
    }).catch(function () { return null; });
    return _proPromise;
  }

  function freeChapterLimit() {
    if (typeof chapterLimitOf !== 'function') return 0;
    var mine = window.__strykerCurrentPlan || ((typeof defaultPlanName === 'function') ? defaultPlanName() : null);
    var n = mine ? chapterLimitOf(mine) : Infinity;
    return isFinite(n) && n > 0 ? n : 0;
  }

  function card(kind, where, opts) {
    opts = opts || {};
    var c = COPY[kind] || COPY.gex;
    var n = opts.chapterLimit && isFinite(opts.chapterLimit) ? opts.chapterLimit
      : (kind === 'chapters' ? freeChapterLimit() : 0);
    var el = document.createElement('div');
    el.className = 'plan-lock';
    el.setAttribute('data-lock-where', where || kind);
    el.setAttribute('role', 'region');
    var title = c.title(n);
    el.setAttribute('aria-label', title);
    el.innerHTML =
      (opts.closable ? '<button type="button" class="plan-lock-x" aria-label="Close">×</button>' : '') +
      '<div class="plan-lock-head"><span class="plan-lock-ico">' + LOCK_SVG + '</span><h3></h3></div>' +
      '<ul class="plan-lock-list">' + c.bullets(n).map(function () { return '<li>' + TICK_SVG + '<span></span></li>'; }).join('') + '</ul>' +
      '<a class="btn btn-primary plan-lock-cta" href="#" data-open-plan-modal>Join Pro</a>' +
      (opts.back ? '<a class="plan-lock-back" href="#"></a>' : '') +
      '<p class="plan-lock-edu">Education only. Not financial advice.</p>';
    if (opts.back) {
      var bk = el.querySelector('.plan-lock-back');
      bk.href = opts.back.href; bk.textContent = opts.back.label;
    }
    el.querySelector('h3').textContent = title;
    var items = el.querySelectorAll('.plan-lock-list li span');
    c.bullets(n).forEach(function (b, i) { items[i].textContent = b; });
    var cta = el.querySelector('.plan-lock-cta');
    cta.setAttribute('data-upgrade-reason', c.reason);

    proPlan().then(function (pro) {
      if (!pro) return;
      cta.removeAttribute('data-open-plan-modal');
      cta.href = 'checkout.html?plan=' + encodeURIComponent(pro.id);
      var name = (typeof planDisplayName === 'function') ? planDisplayName(pro) : 'Pro';
      if (cta.getAttribute('data-trial') !== '1') cta.textContent = 'Join ' + name;
      if (typeof strykerTrialDecorate === 'function') strykerTrialDecorate(cta, pro);
    });

    cta.addEventListener('click', function () { emit('lock_click', where || kind); });
    var x = el.querySelector('.plan-lock-x');
    if (x) x.addEventListener('click', function () {
      el.remove();
      if (typeof opts.onClose === 'function') opts.onClose();
    });
    // lock_view once the card is actually on screen.
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (ents) {
        if (ents.some(function (e) { return e.isIntersecting; })) { io.disconnect(); emit('lock_view', where || kind); }
      });
      setTimeout(function () { io.observe(el); }, 0);
    } else {
      emit('lock_view', where || kind);
    }
    return el;
  }

  window.strykerPlanLock = { card: card, proPlan: proPlan };
})();
