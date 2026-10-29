// TradeZoro — Settings page (settings.html)
// Depends on: assets/auth.js, assets/progress.js

function showSettingsMsg(elId, message){
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;

  let currentUser = null;
  let handled = false;
  let studentData = null;   // the loaded student doc, for the save handler

  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
      return;
    }
    handled = true;
    currentUser = user;

    document.getElementById('settings-name').value = user.displayName || '';
    document.getElementById('settings-email').value = user.email || '';
    document.getElementById('settings-uid').textContent = user.uid;

    ensureStudentDoc(user).then((student) => {
      studentData = student || {};
      if (student && student.createdAt && typeof student.createdAt.toDate === 'function') {
        document.getElementById('settings-member-since').textContent =
          student.createdAt.toDate().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      }
      const planEl = document.getElementById('settings-plan-name');
      if (planEl) planEl.textContent = (student && student.plan) ? ((typeof labelOf === 'function') ? labelOf(student.plan) : student.plan) : 'Self-Paced';

      // Subscription line: when the plan expires, how healthy it is, and a
      // renew shortcut. Founding members and non-expiring plans show their
      // standing instead of a date.
      const renewalRow = document.getElementById('settings-renewal-row');
      const renewalEl = document.getElementById('settings-plan-renewal');
      const renewBtn = document.getElementById('settings-renew-btn');
      if (renewalRow && renewalEl && student) {
        const pt = student.paidThroughMillis || 0;
        if (student.foundingMember) {
          renewalRow.style.display = '';
          renewalEl.textContent = '★ Founding member — lifetime access';
          renewalEl.style.color = 'var(--gold)';
        } else if (pt) {
          renewalRow.style.display = '';
          const dateLabel = new Date(pt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          const trialing = student.subscriptionStatus === 'trialing' && pt > Date.now();
          if (trialing) {
            // 7-day free trial: days left, the charge date, and that cancelling
            // before then costs nothing (Stripe portal / Razorpay cancel below).
            const left = Math.max(1, Math.ceil((pt - Date.now()) / 86400000));
            renewalEl.textContent = student.subscriptionAutopay
              ? 'Free trial: ' + left + ' day' + (left === 1 ? '' : 's') + ' left. First charge on ' + dateLabel + ' unless you cancel before then.'
              : 'Free trial: ' + left + ' day' + (left === 1 ? '' : 's') + ' left. Cancelled, so you won\'t be charged; access ends ' + dateLabel + '.';
            renewalEl.style.color = 'var(--teal)';
          } else if (student.subscriptionAutopay) {
            renewalEl.textContent = '↻ Auto-renews on ' + dateLabel;
            renewalEl.style.color = 'var(--bull)';
          } else if (Date.now() > pt) {
            renewalEl.textContent = 'Payment due — access pauses in a few days';
            renewalEl.style.color = 'var(--bear)';
          } else {
            renewalEl.textContent = 'Active until ' + dateLabel;
            const soon = pt - Date.now() < 3 * 24 * 60 * 60 * 1000;
            renewalEl.style.color = soon ? 'var(--amber, #e8b04b)' : 'var(--ink-1)';
          }
          if (renewBtn && student.planId && !student.subscriptionAutopay) {
            renewBtn.style.display = '';
            renewBtn.href = 'checkout.html?plan=' + encodeURIComponent(student.planId);
          }
          // Auto-renewal is the student's to switch off: cancels at cycle
          // end via the server, access runs to the paid date, and stage-1
          // reminders take over from there.
          const cancelBtn = document.getElementById('settings-cancel-autopay');
          // Stripe members manage everything (card, invoices, cancel at period
          // end) on Stripe's hosted Billing Portal; the server opens it for
          // their stored customer, never for an id this page sends.
          const billingBtn = document.getElementById('settings-manage-billing');
          if (billingBtn && student.billingProvider === 'stripe' && student.stripeSubscriptionId) {
            billingBtn.style.display = '';
            if (renewBtn && student.subscriptionAutopay) renewBtn.style.display = 'none';
            if (trialing && student.subscriptionAutopay) billingBtn.textContent = 'Cancel free trial or manage card';
            billingBtn.addEventListener('click', () => {
              billingBtn.disabled = true; billingBtn.textContent = 'Opening billing…';
              let fns = null;
              try { fns = firebase.app().functions(); } catch (e) {}
              const fail = (msg) => {
                showToast('error', msg);
                billingBtn.disabled = false; billingBtn.textContent = trialing && student.subscriptionAutopay ? 'Cancel free trial or manage card' : 'Manage billing (card, invoices, cancel)';
              };
              if (!fns) { fail('Billing is unavailable right now. Please try again.'); return; }
              fns.httpsCallable('stripePortal')({}).then((res) => {
                const url = res && res.data && res.data.url;
                if (!url || url.indexOf('https://billing.stripe.com/') !== 0) throw new Error('Could not open billing.');
                window.location.assign(url);
              }).catch((err) => fail('Could not open billing: ' + ((err && err.message) || err)));
            });
          }
          if (cancelBtn && student.subscriptionAutopay && student.razorpaySubscriptionId &&
              student.billingProvider !== 'stripe') {
            cancelBtn.style.display = '';
            if (trialing) cancelBtn.textContent = 'Cancel free trial';
            cancelBtn.addEventListener('click', () => {
              if (!confirm(trialing
                ? 'Cancel your free trial?\n\nYou won\'t be charged. Your ' + (student.plan ? (typeof labelOf === 'function' ? labelOf(student.plan) : student.plan) : 'plan') + ' access continues until ' + dateLabel + '.'
                : 'Switch off auto-renewal?\n\nYour ' + (student.plan ? (typeof labelOf === 'function' ? labelOf(student.plan) : student.plan) : 'plan') +
                           ' access continues until ' + dateLabel + ' — after that you can renew manually.')) return;
              cancelBtn.disabled = true; cancelBtn.textContent = 'Cancelling…';
              let fns = null;
              try { fns = firebase.app().functions(); } catch (e) {}
              if (!fns) { cancelBtn.disabled = false; cancelBtn.textContent = 'Cancel auto-renewal'; return; }
              fns.httpsCallable('razorpaySubsCancel')({}).then(() => {
                showToast('success', trialing
                  ? 'Free trial cancelled. You won\'t be charged, and your access runs until ' + dateLabel + '.'
                  : 'Auto-renewal is off — your access runs until ' + dateLabel + '.');
                cancelBtn.style.display = 'none';
                renewalEl.textContent = 'Active until ' + dateLabel + ' (auto-renewal off)';
                renewalEl.style.color = 'var(--ink-1)';
                if (renewBtn && student.planId) {
                  renewBtn.style.display = '';
                  renewBtn.href = 'checkout.html?plan=' + encodeURIComponent(student.planId);
                }
              }).catch((err) => {
                showToast('error', 'Could not cancel: ' + (err.message || err));
                cancelBtn.disabled = false; cancelBtn.textContent = 'Cancel auto-renewal';
              });
            });
          }
        }
      }
      // Live futures data (Owner 2026-10-30): the $5/month add-on, an admin approval (liveFeed) or neither.
      try { renderLiveData(student); } catch (e) { console.warn('TradeZoro: live data panel', e); }
      renderAvatarPreview(student);
      document.getElementById('settings-bio').value = (student && student.bio) || '';
      const unEl = document.getElementById('settings-username');
      if (unEl) unEl.value = (student && student.username) || '';
      const mnEl = document.getElementById('settings-mention-notify');
      if (mnEl) mnEl.checked = !(student && student.mentionNotifications === false);
      // A pre-username account: derive the default now so the field is never
      // just blank the first time they look at it.
      if (unEl && !unEl.value && typeof ensureUsername === 'function') {
        ensureUsername(currentUser).then((name) => { if (name && !unEl.value) unEl.value = name; });
      }
    }).catch((err) => console.error('TradeZoro: failed to load account info', err));
  });

  function renderAvatarPreview(studentData){
    const wrap = document.getElementById('avatar-preview-wrap');
    if (!wrap || typeof avatarImgHtml !== 'function' || !currentUser) return;
    wrap.innerHTML = avatarImgHtml(currentUser.uid, currentUser.displayName, studentData, 72);
  }

  document.getElementById('avatar-upload-btn').addEventListener('click', () => {
    document.getElementById('avatar-file-input').click();
  });

  document.getElementById('avatar-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !currentUser) return;
    const errEl = document.getElementById('avatar-error');
    const okEl = document.getElementById('avatar-success');
    errEl.style.display = 'none'; okEl.style.display = 'none';

    resizeAvatarToDataUrl(file, 240)
      .then((dataUrl) => {
        if (typeof syncPublicProfile === 'function') syncPublicProfile(currentUser.uid, { customPhotoURL: dataUrl });
        return db.collection('students').doc(currentUser.uid).set({ customPhotoURL: dataUrl }, { merge: true });
      })
      .then(() => getStudentDoc(currentUser.uid))
      .then((student) => {
        renderAvatarPreview(student);
        showSettingsMsg('avatar-success', 'Profile picture updated.');
      })
      .catch((err) => {
        errEl.textContent = err.message || 'Could not update your photo.';
        errEl.style.display = 'block';
      });
    e.target.value = '';
  });

  document.getElementById('avatar-randomize-btn').addEventListener('click', () => {
    if (!currentUser || typeof randomAvatarSeed !== 'function') return;
    const errEl = document.getElementById('avatar-error');
    const okEl = document.getElementById('avatar-success');
    errEl.style.display = 'none'; okEl.style.display = 'none';

    // Clears any custom upload and rolls a fresh generated-avatar seed, so
    // repeated clicks actually produce visibly different results.
    const newSeed = randomAvatarSeed();
    if (typeof syncPublicProfile === 'function') {
      syncPublicProfile(currentUser.uid, { customPhotoURL: firebase.firestore.FieldValue.delete(), avatarSeed: newSeed });
    }
    db.collection('students').doc(currentUser.uid).set({
      customPhotoURL: firebase.firestore.FieldValue.delete(),
      avatarSeed: newSeed
    }, { merge: true })
      .then(() => getStudentDoc(currentUser.uid))
      .then((student) => {
        renderAvatarPreview(student);
        showSettingsMsg('avatar-success', 'New avatar generated.');
      })
      .catch((err) => {
        errEl.textContent = err.message || 'Could not generate a new avatar.';
        errEl.style.display = 'block';
      });
  });

  document.getElementById('settings-save-name').addEventListener('click', () => {
    if (!currentUser) return;
    const newName = document.getElementById('settings-name').value.trim();
    const newBio = document.getElementById('settings-bio').value.trim();
    if (!newName) { showSettingsMsg('settings-error', 'Display name cannot be empty.'); return; }

    const unEl = document.getElementById('settings-username');
    const mnEl = document.getElementById('settings-mention-notify');
    const wantedUsername = unEl ? normalizeUsername(unEl.value) : '';
    const mentionsOn = mnEl ? mnEl.checked : true;

    // The username goes through its claim (uniqueness) path first: if the
    // handle is taken or malformed, nothing else should half-save around it.
    const currentUsername = (studentData && studentData.username) || '';
    const usernameStep = (unEl && wantedUsername !== currentUsername)
      ? claimUsername(currentUser.uid, wantedUsername, currentUsername)
      : Promise.resolve({ ok: true, username: currentUsername });

    usernameStep.then((res) => {
      if (!res.ok) { showSettingsMsg('settings-error', res.error); return; }
      if (unEl) unEl.value = res.username || wantedUsername;
      if (studentData) studentData.username = res.username || currentUsername;

      currentUser.updateProfile({ displayName: newName })
        .then(() => {
          // mentionNotifications lives on the PUBLIC profile doc deliberately:
          // the tagger's client is what writes the notification, so it has to
          // be able to read whether the tagged person wants one.
          if (typeof syncPublicProfile === 'function') syncPublicProfile(currentUser.uid,
            { displayName: newName, bio: newBio, mentionNotifications: mentionsOn });
          return db.collection('students').doc(currentUser.uid).set(
            { displayName: newName, bio: newBio, mentionNotifications: mentionsOn }, { merge: true });
        })
        .then(() => showSettingsMsg('settings-success', 'Saved.'))
        .catch((err) => showSettingsMsg('settings-error', err.message || 'Could not save changes.'));
    });
  });

  document.getElementById('settings-reset-password').addEventListener('click', () => {
    if (!currentUser || !currentUser.email) return;
    sendResetEmailWithReturn(currentUser.email)
      .then(() => showSettingsMsg('settings-success', 'Password reset email sent — check your inbox.'))
      .catch((err) => showSettingsMsg('settings-error', err.message || 'Could not send reset email.'));
  });

  document.getElementById('settings-reset-progress').addEventListener('click', () => {
    if (!currentUser) return;
    const ok = confirm('This clears all chapter and lesson completion progress. This cannot be undone. Continue?');
    if (!ok) return;
    db.collection('students').doc(currentUser.uid).set({
      completedLessons: [],
      completedChapters: []
    }, { merge: true })
      .then(() => showSettingsMsg('settings-success', 'Your learning progress has been reset.'))
      .catch((err) => showSettingsMsg('settings-error', err.message || 'Could not reset progress.'));
  });
});


// ---- Live futures data panel (settings.html #settings-livedata-panel) -----------------------------------------------
// students/{uid}.liveData = { active, paidThroughMillis, source, autopay, stripeSubscriptionId | razorpaySubscriptionId }
// (written only by the payment functions) and students/{uid}.liveFeed (an admin's approval). The chart SERVER decides
// real-time from the same fields (functions/api/chart/_rt.js); this panel only shows them and offers cancel / buy.
function renderLiveData(student){
  try { db.collection('plans').doc('LiveData').get().then((d) => { if (!d.exists) { const b = document.getElementById('settings-ld-buy'); if (b) { b.style.display = 'none'; const n = document.getElementById('settings-ld-soon'); if (n) n.style.display = ''; } } }).catch(() => {}); } catch (e) {}
  const panel = document.getElementById('settings-livedata-panel');
  if (!panel) return;
  const st = document.getElementById('settings-ld-status'), row = document.getElementById('settings-ld-row'),
    rowL = document.getElementById('settings-ld-row-l'), dateEl = document.getElementById('settings-ld-date'),
    buy = document.getElementById('settings-ld-buy'), cancel = document.getElementById('settings-ld-cancel'),
    manage = document.getElementById('settings-ld-manage');
  const s = student || {}, ld = s.liveData || {};
  const pt = ld.paidThroughMillis || 0, GRACE = 3 * 86400000;
  const paid = ld.active === true && (!pt || Date.now() <= pt + GRACE);
  const label = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  buy.style.display = 'none'; cancel.style.display = 'none'; manage.style.display = 'none'; row.style.display = 'none';
  if (paid && ld.source !== 'manual') {
    st.textContent = 'On: real-time CME futures'; st.style.color = 'var(--bull)';
    if (pt) {
      row.style.display = '';
      if (ld.autopay) { rowL.textContent = 'Renews'; dateEl.textContent = label(pt) + ' · $5/month'; }
      else { rowL.textContent = 'Ends'; dateEl.textContent = label(pt) + ' (auto-renewal off)'; }
    }
    if (ld.autopay && ld.stripeSubscriptionId) {
      manage.style.display = ''; manage.textContent = 'Cancel, update card or invoices';
      manage.onclick = () => {
        manage.disabled = true; manage.textContent = 'Opening billing…';
        let fns = null; try { fns = firebase.app().functions(); } catch (e) {}
        const fail = (m) => { showToast('error', m); manage.disabled = false; manage.textContent = 'Cancel, update card or invoices'; };
        if (!fns) { fail('Billing is unavailable right now. Please try again.'); return; }
        fns.httpsCallable('stripePortal')({}).then((res) => {
          const url = res && res.data && res.data.url;
          if (!url || url.indexOf('https://billing.stripe.com/') !== 0) throw new Error('Could not open billing.');
          window.location.assign(url);
        }).catch((err) => fail('Could not open billing: ' + ((err && err.message) || err)));
      };
    } else if (ld.autopay && ld.razorpaySubscriptionId) {
      cancel.style.display = '';
      cancel.onclick = () => {
        if (!confirm('Cancel live futures data?\n\nReal-time stays on until ' + label(pt) + ', then your futures charts go back to 10 minutes behind.')) return;
        cancel.disabled = true; cancel.textContent = 'Cancelling…';
        let fns = null; try { fns = firebase.app().functions(); } catch (e) {}
        if (!fns) { cancel.disabled = false; cancel.textContent = 'Cancel live futures data'; return; }
        fns.httpsCallable('razorpaySubsCancel')({ addon: true }).then(() => {
          showToast('success', 'Cancelled. Real-time runs until ' + label(pt) + '.');
          cancel.style.display = 'none'; rowL.textContent = 'Ends'; dateEl.textContent = label(pt) + ' (auto-renewal off)';
        }).catch((err) => { showToast('error', 'Could not cancel: ' + ((err && err.message) || err)); cancel.disabled = false; cancel.textContent = 'Cancel live futures data'; });
      };
    } else if (!ld.autopay) { buy.style.display = ''; buy.textContent = 'Renew live futures data: $5/month'; }
  } else if (s.liveFeed === true && s.liveFeedGrandfathered === true) {
    // Early Pro members keep live futures while Pro stays active (mirrors isActiveProDoc in functions/api/chart/_rt.js).
    const proOn = !!s.plan && (typeof rankOf === 'function' ? rankOf(s.plan) >= 1 : !/^(free|starter|)$/i.test(String(s.plan))) && ['expired', 'cancelled', 'canceled'].indexOf(s.subscriptionStatus) === -1 &&
      (s.foundingMember === true || !(Number(s.paidThroughMillis) > 0 && Date.now() > Number(s.paidThroughMillis) + GRACE));
    if (proOn) { st.textContent = 'Live futures data: included for you as an early Pro member'; st.style.color = 'var(--bull)'; }
    else { st.textContent = 'Off: futures are 10 minutes behind'; st.style.color = 'var(--ink-1)'; buy.style.display = ''; buy.textContent = 'Get live futures data: $5/month'; }
  } else if (s.liveFeed === true || (paid && ld.source === 'manual')) {
    st.textContent = 'On: approved by TradeZoro'; st.style.color = 'var(--bull)';
  } else {
    st.textContent = 'Off: futures are 10 minutes behind'; st.style.color = 'var(--ink-1)';
    buy.style.display = ''; buy.textContent = 'Get live futures data: $5/month';
  }
}
