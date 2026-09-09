// Stryker Trading Academy — first-run onboarding (dashboard-user.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/journal-calc.js
// (journalDefaultSettings), assets/playbook-data.js (pbFromModel, savePlaybooks),
// assets/models-store.js (loadModels), assets/sanitize.js (stkEsc).
//
// WHY THIS EXISTS
//
// A new member signed in and landed on a dashboard with eleven sidebar entries
// and no indication which one to open first. Everything they had just paid for
// was present and none of it was pointed at. The quiet failure mode of a
// content product is not someone cancelling — it is someone never starting.
//
// Two pieces:
//
//   1. A four-step wizard, shown once. It sets the numbers everything else
//      depends on (account size and currency, which silently defaulted to
//      $10,000 USD and quietly wrongly scaled every risk percentage and R
//      multiple after it), records what they trade, turns one taught model
//      into their first playbook, and hands them a chapter to read.
//
//   2. A progress card that stays on the dashboard afterwards, showing the
//      next concrete step until they have actually done all four. It is
//      derived from real data — a saved playbook, a logged trade, a completed
//      chapter — not from flags the wizard sets. So it self-heals: someone who
//      skipped the wizard and did the work anyway sees it disappear, and
//      someone who clicked through it without doing the work still gets
//      pointed at what is missing.
//
// STORAGE: students/{uid}.onboarding = { seen, skipped, completedAt }.
// Only "was this shown" lives there. None of those fields are in the
// privileged set the Firestore rules lock, so the client may write them.

(function () {
  'use strict';

  const OB_TOTAL_STEPS = 4;

  let OB_UID = null;
  let OB_STEP = 0;
  let OB_DRAFT = { balance: 10000, currency: 'USD', instruments: [], sessions: [], modelId: null };
  let OB_MODELS = [];
  let OB_STATE = null;      // the derived checklist, see obDeriveState

  const $ = (id) => document.getElementById(id);
  const esc = (s) => (typeof stkEsc === 'function' ? stkEsc(s) : String(s === null || s === undefined ? '' : s));

  // Options offered in the wizard. Deliberately short: a new member should be
  // able to finish this without thinking hard, and every one of these is
  // editable later in the journal's own settings.
  const OB_MARKETS = ['NQ', 'ES', 'YM', 'GC', 'CL', 'EURUSD', 'GBPUSD', 'BTC', 'ETH'];
  const OB_SESSIONS = ['Asia', 'London', 'New York', 'Off hours'];
  const OB_CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'AED', 'SGD'];

  // ---- state ---------------------------------------------------------------

  function obStudentRef(uid) { return db.collection('students').doc(uid); }
  function obJournalRef(uid) { return db.collection('students').doc(uid).collection('journal'); }

  // Reads the four things the checklist reports on. Everything here is a fact
  // about the account rather than a flag, so the card cannot claim someone has
  // done something they have not.
  function obDeriveState(uid) {
    return Promise.all([
      obStudentRef(uid).get().catch(() => null),
      obJournalRef(uid).doc('_settings').get().catch(() => null),
      obJournalRef(uid).doc('_playbooks').get().catch(() => null)
    ]).then(([studentDoc, settingsDoc, pbDoc]) => {
      const s = (studentDoc && studentDoc.exists) ? (studentDoc.data() || {}) : {};
      const settings = (settingsDoc && settingsDoc.exists) ? (settingsDoc.data() || {}) : {};
      const pbs = (pbDoc && pbDoc.exists) ? ((pbDoc.data() || {}).playbooks || []) : [];

      return {
        onboarding: s.onboarding || {},
        // configuredAt is stamped only when a human chose these values. The
        // journal seeds defaults on first load, so its mere existence proves
        // nothing about whether anyone looked at them.
        accountSet: !!settings.configuredAt,
        currency: settings.currency || 'USD',
        balance: settings.accountBalance,
        hasPlaybook: pbs.length > 0,
        playbookName: pbs.length ? pbs[0].name : null,
        hasTrade: (s.journalEntryCount || 0) > 0,
        chaptersDone: (s.completedChapters || []).length,
        firstName: (s.displayName || '').trim().split(/\s+/)[0] || null
      };
    });
  }

  function obStepsFrom(state) {
    return [
      { key: 'account',  done: state.accountSet,  label: 'Set your account size and currency',
        why: 'Every risk percentage and R multiple on the site is measured against this.',
        cta: 'Open journal settings', href: 'trade-journal.html' },
      { key: 'playbook', done: state.hasPlaybook, label: 'Turn a taught model into your first playbook',
        why: 'It becomes the checklist you tick on each trade, and the thing the analytics measure.',
        cta: 'Open the Playbook', href: 'trade-journal.html' },
      { key: 'chapter',  done: state.chaptersDone > 0, label: 'Finish your first chapter',
        why: 'The curriculum runs in order — chapter one is the foundation the rest sits on.',
        cta: 'Start reading', href: 'courses.html' },
      { key: 'trade',    done: state.hasTrade, label: 'Log your first trade',
        why: 'Nothing in the journal, the analytics or the playbook can say anything until there is one.',
        cta: 'Log a trade', href: 'trade-journal.html' }
    ];
  }

  // ---- the persistent progress card ---------------------------------------

  function obRenderCard(state) {
    const mount = $('dash-onboarding');
    if (!mount) return;

    const steps = obStepsFrom(state);
    const done = steps.filter((s) => s.done).length;

    // The card's whole job is to disappear. Once all four are real, it goes
    // and does not come back.
    if (done === steps.length) { mount.innerHTML = ''; mount.hidden = true; return; }

    const next = steps.find((s) => !s.done);
    const pct = Math.round((done / steps.length) * 100);

    mount.hidden = false;
    mount.innerHTML =
      '<section class="ob-card">' +
        '<div class="ob-card-head">' +
          '<div>' +
            '<h3>Getting set up</h3>' +
            '<p>Four things make everything else on the site work. ' + done + ' of ' + steps.length + ' done.</p>' +
          '</div>' +
          '<button type="button" class="ob-card-restart" id="ob-restart">Run the setup again</button>' +
        '</div>' +
        '<div class="ob-progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
          '<span style="width:' + pct + '%"></span>' +
        '</div>' +
        '<ol class="ob-steps">' +
          steps.map((s) => {
            const isNext = s === next;
            return '<li class="' + (s.done ? 'is-done' : isNext ? 'is-next' : '') + '">' +
              '<span class="ob-tick" aria-hidden="true">' + (s.done ? '&#10003;' : '') + '</span>' +
              '<span class="ob-step-body">' +
                '<span class="ob-step-label">' + esc(s.label) + '</span>' +
                (isNext ? '<span class="ob-step-why">' + esc(s.why) + '</span>' : '') +
              '</span>' +
              (isNext ? '<a class="btn btn-primary btn-sm" href="' + esc(s.href) + '">' + esc(s.cta) + '</a>' : '') +
            '</li>';
          }).join('') +
        '</ol>' +
      '</section>';

    const restart = $('ob-restart');
    if (restart) restart.addEventListener('click', () => obOpenWizard(true));
  }

  // ---- the wizard ----------------------------------------------------------

  function obChipRow(name, options, selected) {
    return '<div class="ob-chips">' + options.map((o) =>
      '<button type="button" class="ob-chip' + (selected.indexOf(o) !== -1 ? ' active' : '') + '" ' +
      'data-ob-toggle="' + name + '" data-value="' + esc(o) + '">' + esc(o) + '</button>').join('') + '</div>';
  }

  function obStepHtml(state) {
    if (OB_STEP === 0) {
      const hi = state.firstName ? 'Welcome, ' + esc(state.firstName) + '.' : 'Welcome.';
      return '<h3>' + hi + ' Two minutes and the site starts working for you.</h3>' +
        '<p class="ob-sub">Start with the number everything else is measured against. Risk percentages, R multiples and every P&amp;L figure are relative to this, so a rough figure now beats the placeholder.</p>' +
        '<div class="ob-field-row">' +
          '<label class="ob-field">Account size' +
            '<input type="number" id="ob-balance" min="1" step="100" value="' + (OB_DRAFT.balance || 10000) + '">' +
          '</label>' +
          '<label class="ob-field">Currency' +
            '<select id="ob-currency">' + OB_CURRENCIES.map((c) =>
              '<option value="' + c + '"' + (OB_DRAFT.currency === c ? ' selected' : '') + '>' + c + '</option>').join('') +
            '</select>' +
          '</label>' +
        '</div>' +
        '<p class="ob-note">Changeable any time in the journal’s settings. Nothing here is locked in.</p>';
    }

    if (OB_STEP === 1) {
      return '<h3>What do you trade?</h3>' +
        '<p class="ob-sub">These become the dropdowns on the trade form, so logging a trade is two taps instead of typing. Pick as many as apply.</p>' +
        '<h4 class="ob-group">Markets</h4>' + obChipRow('instruments', OB_MARKETS, OB_DRAFT.instruments) +
        '<h4 class="ob-group">Sessions</h4>' + obChipRow('sessions', OB_SESSIONS, OB_DRAFT.sessions) +
        '<p class="ob-note">Leave any of it blank and you get the full default list instead.</p>';
    }

    if (OB_STEP === 2) {
      if (!OB_MODELS.length) {
        return '<h3>Your first playbook</h3>' +
          '<p class="ob-sub">The academy models could not be loaded right now. You can skip this and add a playbook later from the journal.</p>';
      }
      return '<h3>Your first playbook</h3>' +
        '<p class="ob-sub">Pick one taught model to start with. Its steps become the checklist you tick on every trade, and the Playbook tab then measures what following those rules is actually worth to you. You can add the rest later.</p>' +
        '<div class="ob-models">' + OB_MODELS.map((m) => {
          const n = (m.steps || []).length;
          return '<button type="button" class="ob-model' + (OB_DRAFT.modelId === m.id ? ' active' : '') + '" data-ob-model="' + esc(m.id) + '">' +
            '<b>' + esc(m.name || 'Untitled model') + '</b>' +
            '<span>' + esc(m.summary || '') + '</span>' +
            '<i>' + n + ' rule' + (n === 1 ? '' : 's') + '</i>' +
          '</button>';
        }).join('') + '</div>';
    }

    // Final step
    const chapterLine = state.chaptersDone > 0
      ? 'You have finished ' + state.chaptersDone + ' chapter' + (state.chaptersDone === 1 ? '' : 's') + ' already — pick up where you left off.'
      : 'Chapter one is the foundation the rest of the curriculum sits on. It is worth going slower than you think you need to.';
    return '<h3>You’re set up.</h3>' +
      '<p class="ob-sub">' + esc(chapterLine) + '</p>' +
      '<ul class="ob-recap">' +
        '<li><b>Curriculum</b> — 42 chapters, in order, with your progress tracked.</li>' +
        '<li><b>Trade journal</b> — log trades, tick your playbook rules, watch the analytics build.</li>' +
        '<li><b>Backtesting</b> — replay past sessions against your playbook to build a track record in an evening.</li>' +
        '<li><b>Live sessions and the Trading Floor</b> — trade the open together, then talk about it.</li>' +
      '</ul>' +
      '<p class="ob-note">This checklist stays on your dashboard until all four steps are genuinely done.</p>';
  }

  function obRenderWizard(state) {
    const body = $('ob-modal-body');
    if (!body) return;
    body.innerHTML = obStepHtml(state);

    $('ob-dots').innerHTML = Array.from({ length: OB_TOTAL_STEPS }, (_, i) =>
      '<span class="' + (i === OB_STEP ? 'active' : i < OB_STEP ? 'past' : '') + '"></span>').join('');

    $('ob-back').style.visibility = OB_STEP === 0 ? 'hidden' : '';
    $('ob-next').textContent = OB_STEP === OB_TOTAL_STEPS - 1 ? 'Go to my dashboard' : 'Continue';
  }

  function obReadStep() {
    if (OB_STEP === 0) {
      const b = parseFloat($('ob-balance').value);
      OB_DRAFT.balance = isFinite(b) && b > 0 ? b : 10000;
      OB_DRAFT.currency = $('ob-currency').value || 'USD';
    }
    // Steps 1 and 2 write straight into OB_DRAFT as they are clicked.
  }

  // Saves everything the wizard collected. Each write is independent and
  // failure-tolerant: a member who loses connection mid-wizard keeps whatever
  // landed, and the derived checklist will simply still show what is missing.
  function obSave() {
    const base = (typeof journalDefaultSettings === 'function') ? journalDefaultSettings() : {};
    const settings = Object.assign({}, base, {
      accountBalance: OB_DRAFT.balance,
      currency: OB_DRAFT.currency,
      // Proof a human chose these. Without it the seeded defaults are
      // indistinguishable from a deliberate choice.
      configuredAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (OB_DRAFT.instruments.length) settings.instruments = OB_DRAFT.instruments.slice();
    if (OB_DRAFT.sessions.length) settings.sessions = OB_DRAFT.sessions.slice();

    const work = [
      obJournalRef(OB_UID).doc('_settings').set(settings, { merge: true })
        .catch((e) => console.error('Stryker: onboarding could not save journal settings', e))
    ];

    const model = OB_MODELS.find((m) => m.id === OB_DRAFT.modelId);
    if (model && typeof pbFromModel === 'function') {
      work.push(
        obJournalRef(OB_UID).doc('_playbooks').get()
          .then((doc) => {
            const existing = (doc.exists ? (doc.data() || {}).playbooks : null) || [];
            // Never duplicate: someone re-running the wizard and picking the
            // same model again should not end up with two of it.
            if (existing.some((p) => p.sourceModelId === model.id)) return null;
            const pb = pbFromModel(model, existing.length);
            return obJournalRef(OB_UID).doc('_playbooks').set({
              playbooks: existing.concat([pb]),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          })
          .catch((e) => console.error('Stryker: onboarding could not save the playbook', e))
      );
    }

    work.push(
      obStudentRef(OB_UID).set({
        onboarding: { seen: true, completedAt: firebase.firestore.FieldValue.serverTimestamp() }
      }, { merge: true }).catch((e) => console.error('Stryker: onboarding flag not saved', e))
    );

    return Promise.all(work);
  }

  function obCloseWizard() {
    const modal = $('ob-modal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('ob-open');
  }

  function obOpenWizard(restart) {
    const modal = $('ob-modal');
    if (!modal || !OB_STATE) return;

    OB_STEP = 0;
    OB_DRAFT = {
      balance: OB_STATE.balance || 10000,
      currency: OB_STATE.currency || 'USD',
      instruments: [], sessions: [], modelId: null
    };

    modal.hidden = false;
    document.body.classList.add('ob-open');
    obRenderWizard(OB_STATE);

    // Models load in the background; the picker step redraws when they arrive.
    if (!OB_MODELS.length && typeof pbLoadAdoptableModels === 'function') {
      pbLoadAdoptableModels().then((models) => {
        OB_MODELS = models || [];
        if (OB_STEP === 2) obRenderWizard(OB_STATE);
      });
    }
    if (restart) console.log('Stryker: onboarding restarted by the member');
  }

  function obFinish(skipped) {
    obReadStep();
    const after = skipped
      ? obStudentRef(OB_UID).set({ onboarding: { seen: true, skipped: true } }, { merge: true }).catch(() => {})
      : obSave();

    return Promise.resolve(after).then(() => {
      obCloseWizard();
      // Re-derive rather than assume: the card must reflect what actually
      // saved, not what the wizard hoped to save.
      return obDeriveState(OB_UID).then((state) => { OB_STATE = state; obRenderCard(state); });
    });
  }

  // ---- wiring --------------------------------------------------------------

  function obWire() {
    const modal = $('ob-modal');
    if (!modal) return;

    $('ob-next').addEventListener('click', () => {
      obReadStep();
      if (OB_STEP < OB_TOTAL_STEPS - 1) { OB_STEP++; obRenderWizard(OB_STATE); return; }
      obFinish(false);
    });
    $('ob-back').addEventListener('click', () => {
      obReadStep();
      if (OB_STEP > 0) { OB_STEP--; obRenderWizard(OB_STATE); }
    });
    $('ob-skip').addEventListener('click', () => obFinish(true));

    // Chip and model selection, delegated so redraws never lose their handlers.
    $('ob-modal-body').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-ob-toggle]');
      if (chip) {
        const list = OB_DRAFT[chip.dataset.obToggle];
        const v = chip.dataset.value;
        const i = list.indexOf(v);
        if (i === -1) list.push(v); else list.splice(i, 1);
        chip.classList.toggle('active');
        return;
      }
      const model = e.target.closest('[data-ob-model]');
      if (model) {
        OB_DRAFT.modelId = OB_DRAFT.modelId === model.dataset.obModel ? null : model.dataset.obModel;
        obRenderWizard(OB_STATE);
      }
    });

    // Escape closes, and counts as a skip rather than as silence — otherwise
    // the wizard reappears on every visit and becomes an irritation.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) obFinish(true);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof auth === 'undefined' || !auth || !$('dash-onboarding')) return;
    obWire();

    let handled = false;
    auth.onAuthStateChanged((user) => {
      if (!user || handled) return;
      handled = true;
      OB_UID = user.uid;

      obDeriveState(OB_UID).then((state) => {
        OB_STATE = state;
        obRenderCard(state);

        // The wizard opens once, for someone who has not seen it and has not
        // already done the work by another route.
        const steps = obStepsFrom(state);
        const untouched = steps.every((s) => !s.done);
        if (!state.onboarding.seen && untouched) {
          if (typeof pbLoadAdoptableModels === 'function') {
            pbLoadAdoptableModels().then((models) => { OB_MODELS = models || []; obOpenWizard(false); });
          } else {
            obOpenWizard(false);
          }
        }
      }).catch((err) => console.error('Stryker: onboarding state could not be read', err));
    });
  });

  // Exercised directly by the tests.
  window.__OB = {
    deriveState: obDeriveState,
    stepsFrom: obStepsFrom,
    renderCard: obRenderCard,
    openWizard: obOpenWizard,
    draft: () => OB_DRAFT,
    setModels: (m) => { OB_MODELS = m; },
    setUid: (u) => { OB_UID = u; },
    setState: (s) => { OB_STATE = s; },
    step: () => OB_STEP
  };
})();
