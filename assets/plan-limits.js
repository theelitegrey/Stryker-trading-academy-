// Stryker Trading Academy — Free plan usage limits (pricing change 2026-10-05)
// Depends on: assets/auth.js (auth), assets/progress.js (db), assets/roles.js
//             (loadPlansForRoles, findPlan, rankOf), assets/plan-modal.js
//             (openPlanUpgradeModal). Optional page hooks: gex.js
//             (strykerGexSetLimit), journal-main.js (JOURNAL_TRADES,
//             switchJournalTab, reloadJournalData), replay.js (calls
//             strykerReplayLimitOk before starting a session).
//
// The Free plan (rank 0) gets:
//   GEX           SPX only, 0DTE view only, no strike table
//   Trade journal manual entry, FREE_JOURNAL_MONTHLY new trades per calendar
//                 month; import, broker sync, analytics and AI coach are Pro.
//                 Existing trades are never hidden or deleted, and editing an
//                 existing trade is always allowed.
//   Backtesting   FREE_REPLAY_WEEKLY new replay sessions per week (Mon-Sun,
//                 local time), counted from the sessions saved in this browser.
//
// ENFORCEMENT IS CLIENT-SIDE ONLY. The journal and replay data live under
// students/{uid}/journal and /replay, which the member may write freely, and
// /api/gex/* is public. These limits shape the product; they are not a
// security boundary. Admins, Pro and anything unresolvable get no limits
// (fail open, same as plan-guard.js).
(function () {
  'use strict';
  var FREE_JOURNAL_MONTHLY = 20;
  var FREE_REPLAY_WEEKLY = 3;
  var tierPromise = null;

  // { free: true|false } once the signed-in member's plan is known.
  function tier() {
    if (tierPromise) return tierPromise;
    tierPromise = new Promise(function (resolve) {
      if (typeof auth === 'undefined' || !auth || typeof db === 'undefined' || !db) { resolve({ free: false }); return; }
      var done = false;
      auth.onAuthStateChanged(function (user) {
        if (done || !user) return;
        done = true;
        var a = db.collection('admins').doc(user.uid).get().catch(function () { return null; });
        var s = db.collection('students').doc(user.uid).get().catch(function () { return null; });
        var r = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
        Promise.all([a, s, r]).then(function (res) {
          if (res[0] && res[0].exists) return resolve({ free: false, admin: true });
          var plan = (res[1] && res[1].exists) ? res[1].data().plan : null;
          if (!plan || typeof findPlan !== 'function' || !findPlan(plan) || typeof rankOf !== 'function') return resolve({ free: false });
          resolve({ free: rankOf(plan) < 1, plan: plan });
        }).catch(function () { resolve({ free: false }); });
      });
    });
    return tierPromise;
  }
  window.strykerPlanTier = tier;

  function upgrade(why) {
    if (typeof window.openPlanUpgradeModal === 'function') window.openPlanUpgradeModal(why);
  }

  function lockCard(title, body, reason) {
    var d = document.createElement('div');
    d.className = 'plan-lock-card';
    d.innerHTML = '<b></b><p></p><button type="button" class="btn btn-primary btn-sm" data-open-plan-modal>See Pro</button>';
    d.querySelector('b').textContent = title;
    d.querySelector('p').textContent = body;
    d.querySelector('button').setAttribute('data-upgrade-reason', reason);
    return d;
  }

  // Wraps a panel: its own children are hidden by CSS (.plan-locked) and a
  // lock card is shown in their place. Nothing is removed from the DOM.
  function lockPanel(el, title, body, reason) {
    if (!el || el.classList.contains('plan-locked')) return;
    el.classList.add('plan-locked');
    el.insertBefore(lockCard(title, body, reason), el.firstChild);
  }

  // ---- GEX -------------------------------------------------------------------
  function applyGex() {
    if (typeof window.strykerGexSetLimit !== 'function') return;
    window.strykerGexSetLimit({ markets: ['SPX'], dtes: [0], noLadder: true });
    var note = document.querySelector('.gex-head');
    if (note && !document.getElementById('gex-free-note')) {
      var p = document.createElement('p');
      p.id = 'gex-free-note';
      p.className = 'plan-usage-note';
      p.innerHTML = 'Free plan: SPX, 0DTE view. <a href="#" data-open-plan-modal data-upgrade-reason="Pro unlocks GEX for every symbol and expiry, the futures conversion and the strike table.">Pro unlocks every symbol and expiry</a>.';
      note.parentNode.insertBefore(p, note.nextSibling);
    }
  }

  // ---- Trade journal -------------------------------------------------------------
  function monthKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1); }
  function tradeMonthKey(t) {
    var c = t && t.createdAt;
    var ms = c && typeof c.toMillis === 'function' ? c.toMillis() : (c && c.seconds ? c.seconds * 1000 : null);
    if (ms) return monthKey(new Date(ms));
    if (t && /^\d{4}-\d{2}/.test(t.date || '')) return t.date.slice(0, 4) + '-' + parseInt(t.date.slice(5, 7), 10);
    return null;
  }
  function journalUsed() {
    var list = (typeof JOURNAL_TRADES !== 'undefined' && JOURNAL_TRADES) ? JOURNAL_TRADES : [];
    var now = monthKey(new Date());
    return list.filter(function (t) { return tradeMonthKey(t) === now; }).length;
  }
  function editing() { return typeof JOURNAL_EDIT_ID !== 'undefined' && !!JOURNAL_EDIT_ID; }

  function paintJournalMeter() {
    var used = journalUsed();
    var full = used >= FREE_JOURNAL_MONTHLY;
    var host = document.getElementById('tab-add');
    if (!host) return;
    var m = document.getElementById('jr-free-meter');
    if (!m) {
      m = document.createElement('div');
      m.id = 'jr-free-meter';
      m.className = 'plan-usage-note';
      host.insertBefore(m, host.firstChild);
    }
    m.innerHTML = '<b>' + Math.min(used, FREE_JOURNAL_MONTHLY) + ' of ' + FREE_JOURNAL_MONTHLY + '</b> trades logged this month on the Free plan. ' +
      (full ? 'You have reached this month\u2019s limit. Your trades stay saved; ' : '') +
      '<a href="#" data-open-plan-modal data-upgrade-reason="Pro removes the monthly trade limit and adds import, broker sync, analytics and the AI coach.">Pro is unlimited</a>.';
    m.classList.toggle('is-full', full);
    var btn = document.getElementById('jf-save-btn');
    if (btn) btn.dataset.freeFull = (full && !editing()) ? '1' : '';
  }

  function applyJournal() {
    if (!document.getElementById('journal-tabs')) return;
    var reason = 'Pro unlocks unlimited trades, import, broker sync, analytics and the AI coach.';
    lockPanel(document.getElementById('tab-analytics'), 'Analytics are part of Pro', 'Break your trades down by setup, session, day and instrument with Pro.', reason);
    lockPanel(document.getElementById('tab-ai'), 'The AI coach is part of Pro', 'Pro gives you a plain-language review of your own journal.', reason);
    var imp = document.getElementById('ji-open-btn');
    lockPanel(imp && imp.closest('.panel'), 'Import and export are part of Pro', 'The Free plan logs trades by hand.', reason);
    lockPanel(document.getElementById('jb-panel'), 'Broker sync is part of Pro', 'Pro imports trades from a connected broker automatically.', reason);

    // Block NEW trades at the limit (capture phase, before journal-form-settings.js).
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('#jf-save-btn');
      if (!b || editing()) return;
      if (journalUsed() >= FREE_JOURNAL_MONTHLY) {
        e.stopImmediatePropagation(); e.preventDefault();
        upgrade('You have logged ' + FREE_JOURNAL_MONTHLY + ' trades this month, the Free plan limit. Your trades stay saved. Pro is unlimited.');
      }
    }, true);

    // Repaint the meter whenever the journal re-renders.
    ['switchJournalTab', 'reloadJournalData'].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== 'function' || orig.__planLimit) return;
      var w = function () { var r = orig.apply(this, arguments); Promise.resolve(r).then(paintJournalMeter, paintJournalMeter); paintJournalMeter(); return r; };
      w.__planLimit = true; w.__jrWrapped = orig.__jrWrapped;
      window[name] = w;
    });
    paintJournalMeter();
  }

  // ---- Backtesting / replay ------------------------------------------------------------
  function weekStartMs() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // Monday
    return d.getTime();
  }
  // replay.js awaits this before starting a new session. Resolves true when
  // the member may start one.
  window.strykerReplayLimitOk = function (D) {
    return tier().then(function (t) {
      if (!t.free || !D || !D.store || typeof D.store.listSessions !== 'function') return true;
      return D.store.listSessions().then(function (list) {
        var since = weekStartMs();
        var n = (list || []).filter(function (s) { return (s.createdAt || 0) >= since; }).length;
        if (n < FREE_REPLAY_WEEKLY) return true;
        upgrade('The Free plan includes ' + FREE_REPLAY_WEEKLY + ' backtesting sessions a week, and you have used them. You can still resume saved sessions. Pro is unlimited.');
        return false;
      }).catch(function () { return true; });
    });
  };
  function applyReplay() {
    var host = document.getElementById('rp-new-btn');
    if (!host || document.getElementById('rp-free-note') || !window.ReplayData) return;
    window.ReplayData.store.listSessions().then(function (list) {
      var since = weekStartMs();
      var n = (list || []).filter(function (s) { return (s.createdAt || 0) >= since; }).length;
      var p = document.createElement('p');
      p.id = 'rp-free-note';
      p.className = 'plan-usage-note';
      p.innerHTML = '<b>' + Math.min(n, FREE_REPLAY_WEEKLY) + ' of ' + FREE_REPLAY_WEEKLY + '</b> new sessions used this week on the Free plan. <a href="#" data-open-plan-modal data-upgrade-reason="Pro includes unlimited backtesting and replay.">Pro is unlimited</a>.';
      var anchor = document.getElementById('rp-head') || host.parentNode;
      anchor.parentNode.insertBefore(p, anchor.nextSibling);
    }).catch(function () {});
  }

  document.addEventListener('DOMContentLoaded', function () {
    tier().then(function (t) {
      if (!t.free) return;
      applyGex();
      applyJournal();
      applyReplay();
    });
  });
})();
