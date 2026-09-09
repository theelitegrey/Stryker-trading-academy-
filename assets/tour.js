// Stryker Trading Academy — guided feature walkthrough (dashboard-user.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/sanitize.js.
// Runs after the first-run setup wizard in assets/onboarding.js, never with it.
//
// WHAT THIS IS
//
// The setup wizard gets a new member configured. It does not tell them what
// the site contains. Eleven sidebar entries is a lot to meet at once, and the
// two most valuable things here — the backtester and the Playbook — are the
// two nobody would guess at from a menu label.
//
// So: a spotlight tour that walks the sidebar, one feature at a time, in the
// order they will actually need them rather than the order they appear.
//
// DESIGN RULES THIS FOLLOWS
//
//   Subtle. A dimmed page, a ring around the real control, and a small card.
//   No mascot, no confetti, no blocking modal pretending to be a product tour.
//
//   Always escapable, three different ways, because "skip" means different
//   things to different people:
//     Skip this step  — not interested in this one feature, keep going
//     Maybe later     — interested, wrong moment; comes back in three days
//     Skip all        — do not show me this again, ever
//   Escape is the same as "maybe later", the gentlest of the three.
//
//   Never point at nothing. If a step's target is missing or invisible (a
//   feature behind a plan gate, a narrow screen, a page mid-render), the step
//   renders as a plain centred card instead of a spotlight over empty space.
//
//   Never trap anyone. The tour reads the page; it does not require the page.
//   Any failure closes it rather than blocking the dashboard behind an overlay.
//
// STORAGE: students/{uid}.tour = { step, done, skipped, snoozedUntil, seen }.
// None of those fields are in the privileged set the Firestore rules lock.

(function () {
  'use strict';

  const SNOOZE_DAYS = 3;

  // Ordered by when a member actually needs the thing, not by menu position.
  // `target` is a CSS selector; a step with no target is a centred card.
  const TOUR_STEPS = [
    {
      id: 'welcome',
      title: 'A quick tour?',
      body: 'Ninety seconds through what is here and what each part is for. You can leave at any point, and pick it up again from Settings.'
    },
    {
      id: 'curriculum',
      target: '.sidebar a[href="courses.html"]',
      title: 'Curriculum',
      body: 'Forty-two chapters in a deliberate order, with your progress tracked. Everything else on the site assumes the ideas taught here, so it is worth starting at chapter one even if the early titles look familiar.'
    },
    {
      id: 'models',
      target: '.sidebar a[href="models.html"]',
      title: 'Trading models',
      body: 'Six complete setups, each written as an explicit sequence of rules rather than a vibe. These are what you turn into a playbook and then measure.'
    },
    {
      id: 'journal',
      target: '.sidebar a[href="trade-journal.html"]',
      title: 'Trade journal',
      body: 'Log every trade and the analytics build themselves: expectancy, drawdown, results by session and by day. It also holds your Playbook and your prop firm accounts.'
    },
    {
      id: 'playbook',
      target: '.sidebar a[href="trade-journal.html"]',
      title: 'The Playbook, inside the journal',
      body: 'The part worth finding early. Adopt a taught model, tick its rules as you log each trade, and it tells you what following the plan is worth to you per trade — and which single rule costs you most when you skip it.'
    },
    {
      id: 'backtests',
      target: '.sidebar a[href="backtests.html"]',
      title: 'Backtesting',
      body: 'Replay past sessions bar by bar and trade them as if live. Run a session against a playbook and an evening here produces the same graded evidence a month of live trading would.'
    },
    {
      id: 'charts',
      target: '.sidebar a[href="charts.html"]',
      title: 'Charts',
      body: 'Live multi-provider charting with the institutional tooling built in, so you are not switching tabs to mark up a level.'
    },
    {
      id: 'indicators',
      target: '.sidebar a[href="indicators.html"]',
      title: 'Indicators',
      body: 'Request access to the private TradingView indicators included with your plan. Add your TradingView username here and access is granted to your account.'
    },
    {
      id: 'live',
      target: '.sidebar a[href="live-sessions.html"]',
      title: 'Live sessions',
      body: 'Trade the New York open alongside everyone else. Every session is recorded, so missing one costs you nothing but the chat.'
    },
    {
      id: 'floor',
      target: '.sidebar a[href="trading-floor.html"]',
      title: 'Trading floor',
      body: 'The members-only feed. Post setups, mark up charts, argue about them. Quieter and more useful than a public group.'
    },
    {
      id: 'monitor',
      target: '.sidebar a[href="global-monitor.html"]',
      title: 'Global monitor',
      body: 'Sessions, macro events and market movers on one screen, refreshed through the day, so you know what is about to move before it does.'
    },
    {
      id: 'smart-money',
      target: '.sidebar a[href="smart-money.html"]',
      title: 'Smart money desk',
      body: 'Congressional trades and insider filings, refreshed daily from official sources. Slow signal, but genuinely public information most people never read.'
    },
    {
      id: 'done',
      title: 'That is the whole site.',
      body: 'The checklist on your dashboard tracks the four things worth doing first. You can run this tour again whenever you like from Settings.'
    }
  ];

  let TR_UID = null;
  let TR_I = 0;
  let TR_ACTIVE = false;
  let TR_SIDEBAR_OPENED = false;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => (typeof stkEsc === 'function' ? stkEsc(s) : String(s === null || s === undefined ? '' : s));

  function trRef(uid) { return db.collection('students').doc(uid); }

  function trSave(patch) {
    if (!TR_UID) return Promise.resolve();
    return trRef(TR_UID).set({ tour: patch }, { merge: true })
      .catch((e) => console.error('Stryker: tour state not saved', e));
  }

  // ---- geometry ------------------------------------------------------------

  // A target only counts if it is actually on screen and has size. A link
  // inside a collapsed sidebar is in the DOM and useless to point at.
  function visibleRect(sel) {
    if (!sel) return null;
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    if (r.bottom < 0 || r.top > window.innerHeight) return null;
    if (r.right < 0 || r.left > window.innerWidth) return null;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return null;
    return r;
  }

  // On a narrow screen the sidebar is off-canvas, so every target in it fails
  // the check above. Reuse the page's own drawer classes rather than inventing
  // a second way to open it.
  function ensureSidebarOpen() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const r = sidebar.getBoundingClientRect();
    if (r.width > 4 && r.left > -4) return;               // already visible
    sidebar.classList.add('mobile-open');
    const backdrop = $('dash-sidebar-backdrop');
    if (backdrop) backdrop.classList.add('visible');
    TR_SIDEBAR_OPENED = true;
  }

  function restoreSidebar() {
    if (!TR_SIDEBAR_OPENED) return;
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.classList.remove('mobile-open');
    const backdrop = $('dash-sidebar-backdrop');
    if (backdrop) backdrop.classList.remove('visible');
    TR_SIDEBAR_OPENED = false;
  }

  // ---- rendering -----------------------------------------------------------

  function positionCard(card, rect) {
    const pad = 14;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left, top;

    // Prefer to the right of the target, which is where the sidebar's
    // neighbours are. Flip below, then left, then just centre it.
    if (rect.right + pad + cw <= window.innerWidth - 8) {
      left = rect.right + pad;
      top = Math.min(Math.max(rect.top - 8, 8), window.innerHeight - ch - 8);
    } else if (rect.bottom + pad + ch <= window.innerHeight - 8) {
      left = Math.min(Math.max(rect.left, 8), window.innerWidth - cw - 8);
      top = rect.bottom + pad;
    } else if (rect.left - pad - cw >= 8) {
      left = rect.left - pad - cw;
      top = Math.min(Math.max(rect.top - 8, 8), window.innerHeight - ch - 8);
    } else {
      left = Math.max((window.innerWidth - cw) / 2, 8);
      top = Math.max((window.innerHeight - ch) / 2, 8);
    }
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(top) + 'px';
  }

  function render() {
    const step = TOUR_STEPS[TR_I];
    if (!step) { finish('done'); return; }

    const root = $('tour-root');
    const hole = $('tour-hole');
    const card = $('tour-card');
    if (!root || !hole || !card) { finish('error'); return; }

    if (step.target) ensureSidebarOpen();

    const rect = step.target ? visibleRect(step.target) : null;

    // No usable target: a centred card, no spotlight. Better an honest card
    // than a ring around nothing.
    if (!rect) {
      hole.hidden = true;
      card.classList.add('is-centred');
      card.style.left = '';
      card.style.top = '';
    } else {
      hole.hidden = false;
      const pad = 6;
      hole.style.left = Math.round(rect.left - pad) + 'px';
      hole.style.top = Math.round(rect.top - pad) + 'px';
      hole.style.width = Math.round(rect.width + pad * 2) + 'px';
      hole.style.height = Math.round(rect.height + pad * 2) + 'px';
      card.classList.remove('is-centred');
    }

    const last = TR_I === TOUR_STEPS.length - 1;
    const first = TR_I === 0;

    card.innerHTML =
      '<div class="tour-card-head">' +
        '<span class="tour-count">' + (TR_I + 1) + ' of ' + TOUR_STEPS.length + '</span>' +
        '<button type="button" class="tour-x" id="tour-later" title="Maybe later" aria-label="Maybe later">&#10005;</button>' +
      '</div>' +
      '<h4>' + esc(step.title) + '</h4>' +
      '<p>' + esc(step.body) + '</p>' +
      '<div class="tour-actions">' +
        '<div class="tour-actions-left">' +
          (first
            ? '<button type="button" class="tour-link" id="tour-skipall">No thanks</button>'
            : '<button type="button" class="tour-link" id="tour-back">Back</button>') +
          (last || first ? '' : '<button type="button" class="tour-link" id="tour-skipstep">Skip this step</button>') +
        '</div>' +
        '<div class="tour-actions-right">' +
          (last ? '' : '<button type="button" class="tour-link" id="tour-later2">Maybe later</button>') +
          (last || first ? '' : '<button type="button" class="tour-link tour-link-quiet" id="tour-skipall2">Skip all</button>') +
          '<button type="button" class="btn btn-primary btn-sm" id="tour-next">' +
            (last ? 'Done' : first ? 'Show me around' : 'Next') + '</button>' +
        '</div>' +
      '</div>';

    if (!rect) { card.style.left = ''; card.style.top = ''; }
    else positionCard(card, rect);

    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('tour-next', () => (last ? finish('done') : go(1)));
    on('tour-back', () => go(-1));
    on('tour-skipstep', () => go(1));
    on('tour-later', () => finish('later'));
    on('tour-later2', () => finish('later'));
    on('tour-skipall', () => finish('skipped'));
    on('tour-skipall2', () => finish('skipped'));

    $('tour-next').focus();
    trSave({ step: TR_I, seen: true });
  }

  function go(delta) {
    TR_I = Math.max(0, Math.min(TOUR_STEPS.length - 1, TR_I + delta));
    render();
  }

  function start(fromStep) {
    const root = $('tour-root');
    if (!root) return;
    TR_I = Math.max(0, Math.min(TOUR_STEPS.length - 1, fromStep || 0));
    TR_ACTIVE = true;
    root.hidden = false;
    document.body.classList.add('tour-open');
    render();
  }

  function finish(reason) {
    const root = $('tour-root');
    if (root) root.hidden = true;
    document.body.classList.remove('tour-open');
    TR_ACTIVE = false;
    restoreSidebar();

    if (reason === 'done') trSave({ done: true, step: TOUR_STEPS.length - 1, seen: true });
    else if (reason === 'skipped') trSave({ skipped: true, seen: true });
    else if (reason === 'later') {
      trSave({ seen: true, step: TR_I, snoozedUntil: Date.now() + SNOOZE_DAYS * 86400000 });
    }
  }

  // ---- lifecycle -----------------------------------------------------------

  function shouldOffer(tour, onboarding) {
    if (!tour) tour = {};
    if (tour.done || tour.skipped) return false;
    // Never both at once. The setup wizard has to be answered first, or the
    // two overlays fight over the same screen.
    if (!onboarding || !onboarding.seen) return false;
    if (tour.snoozedUntil && Date.now() < tour.snoozedUntil) return false;
    return true;
  }

  function wire() {
    // Reposition rather than drift when the page moves under the spotlight.
    let raf = null;
    const reflow = () => {
      if (!TR_ACTIVE) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(render);
    };
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (!TR_ACTIVE) return;
      if (e.key === 'Escape') { e.preventDefault(); finish('later'); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    });

    // Clicking the dimmed area is the same as Escape: it reads as "not now",
    // not as "never".
    const root = $('tour-root');
    if (root) root.addEventListener('click', (e) => {
      if (e.target === root || e.target.id === 'tour-veil') finish('later');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof auth === 'undefined' || !auth || !$('tour-root')) return;
    wire();

    let handled = false;
    auth.onAuthStateChanged((user) => {
      if (!user || handled) return;
      handled = true;
      TR_UID = user.uid;

      trRef(TR_UID).get().then((doc) => {
        const d = (doc.exists ? doc.data() : {}) || {};
        if (!shouldOffer(d.tour, d.onboarding)) return;
        // A beat after the dashboard settles, so the tour does not fight the
        // page's own load animation for attention.
        setTimeout(() => { if (!TR_ACTIVE) start((d.tour && d.tour.step) || 0); }, 900);
      }).catch((e) => console.error('Stryker: tour state could not be read', e));
    });
  });

  // Settings lives on another page, where the sidebar targets the tour points
  // at do not exist. Rather than run a broken tour there, clear the tour flags
  // and send the member to the dashboard, where it starts on arrival.
  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('settings-tour-btn');
    if (!btn || typeof auth === 'undefined' || !auth) return;
    btn.addEventListener('click', () => {
      const note = $('settings-tour-note');
      if (note) note.hidden = false;
      btn.disabled = true;
      const user = auth.currentUser;
      const reset = user
        ? db.collection('students').doc(user.uid)
            .set({ tour: { done: false, skipped: false, snoozedUntil: 0, step: 0, seen: true } }, { merge: true })
            .catch(() => {})
        : Promise.resolve();
      reset.then(() => { window.location.href = 'dashboard-user.html'; });
    });
  });

  // Public: lets Settings and the onboarding card re-run the tour on demand.
  window.strykerStartTour = function (fromStep) { start(fromStep || 0); };
  window.__TOUR = {
    steps: TOUR_STEPS, start, finish, go, shouldOffer,
    index: () => TR_I, active: () => TR_ACTIVE, setUid: (u) => { TR_UID = u; }
  };
})();
