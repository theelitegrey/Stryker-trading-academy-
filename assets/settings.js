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
      showProPrice();

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
      // Live futures data (Owner 2026-10-30): the $7/month add-on, an admin approval (liveFeed) or neither.
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


// ---- Live data panel (settings.html #settings-livedata-panel). Data plans, Owner 2026-11-04: tools free, live data paid. -----
// students/{uid}.liveData (L1 Data) and .liveDataL2 (L2 Data) = { active, paidThroughMillis, source, autopay, stripeSubscriptionId |
// razorpaySubscriptionId }, written only by the payment functions; students/{uid}.liveFeed = an admin's approval. The chart SERVER
// decides (functions/api/chart/_rt.js: isRealtimeToken = L1, isL2Token = L2); this panel only shows the same fields and offers
// buy / cancel. No price on the buy buttons (prices only on checkout and /pricing); a running add-on shows its own renewal price.
function showProPrice(){}   // Pro is no longer sold (2026-11-04); kept as a no-op for the old caller
const LD_PRICE = { liveData: '$7', liveDataL2: '$20' };   // fallback; the plans docs win
const LD_NAME = { liveData: 'L1 Data', liveDataL2: 'L2 Data' }, LD_PLAN = { liveData: 'LiveData', liveDataL2: 'LiveDataL2' };
let ldPriceAsked = false;
function renderLiveData(student){
  if (!ldPriceAsked) {
    ldPriceAsked = true;
    Object.keys(LD_PLAN).forEach((f) => { try { db.collection('plans').doc(LD_PLAN[f]).get().then((d) => {
      if (d.exists && Number(d.data().price) > 0 && '$' + Number(d.data().price) !== LD_PRICE[f]) { LD_PRICE[f] = '$' + Number(d.data().price); renderLiveData(student); }
      if (!d.exists || d.data().archived === true) { const b = document.getElementById(f === 'liveData' ? 'settings-ld-buy' : 'settings-ld-buy-l2'); if (b) b.dataset.off = '1', b.style.display = 'none'; }
    }).catch(() => {}); } catch (e) {} });
  }
  const panel = document.getElementById('settings-livedata-panel');
  if (!panel) return;
  const st = document.getElementById('settings-ld-status'), box = document.getElementById('settings-ld-addons'),
    buy1 = document.getElementById('settings-ld-buy'), buy2 = document.getElementById('settings-ld-buy-l2');
  const s = student || {}, GRACE = 3 * 86400000;
  const label = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const on = (ld) => !!ld && ld.active === true && (!ld.paidThroughMillis || Date.now() <= ld.paidThroughMillis + GRACE);
  const has1 = on(s.liveData), has2 = on(s.liveDataL2);
  // Early Pro members: live data while Pro stays active (mirrors isActiveProDoc in _rt.js; since 2026-11-04 active Pro also counts as L2).
  const proOn = !!s.plan && (typeof rankOf === 'function' ? rankOf(s.plan) >= 1 : !/^(free|starter|)$/i.test(String(s.plan))) && ['expired', 'cancelled', 'canceled'].indexOf(s.subscriptionStatus) === -1 &&
    (s.foundingMember === true || !(Number(s.paidThroughMillis) > 0 && Date.now() > Number(s.paidThroughMillis) + GRACE));
  const approved = s.liveFeed === true && s.liveFeedGrandfathered !== true;
  let level = has2 || proOn ? 'L2' : (has1 || approved) ? 'L1' : '';
  st.textContent = level === 'L2' ? 'L2 · live order book and trades' + (proOn && !has2 ? ' (with your Pro plan)' : '')
    : level === 'L1' ? 'L1 · live trades and quotes' + (approved && !has1 ? ' (approved)' : '')
    : 'None · futures are 10 minutes behind';
  st.style.color = level ? 'var(--bull)' : 'var(--ink-1)';
  buy2.style.display = level === 'L2' || buy2.dataset.off ? 'none' : '';
  buy1.style.display = level || buy1.dataset.off ? 'none' : '';
  box.innerHTML = '';
  ['liveDataL2', 'liveData'].forEach((f) => {
    const ld = s[f] || {};
    if (!on(ld) || ld.source === 'manual') return;
    const pt = ld.paidThroughMillis || 0, w = document.createElement('div');
    w.style.marginBottom = '12px';
    w.innerHTML = '<div class="mini-bar-row" style="margin-bottom:10px;"><span class="label"></span><span class="mini-bar-val" style="width:auto; font-size:13px; color:var(--ink-1);"></span></div>';
    w.querySelector('.label').textContent = LD_NAME[f];
    w.querySelector('.mini-bar-val').textContent = !pt ? 'On' : ld.autopay ? 'Renews ' + label(pt) + ' · ' + LD_PRICE[f] + '/month' : 'Ends ' + label(pt) + ' (auto-renewal off)';
    const btn = (txt, cls) => { const b = document.createElement(cls === 'a' ? 'a' : 'button'); if (cls !== 'a') b.type = 'button'; b.className = 'btn btn-ghost btn-sm btn-block'; b.style.marginBottom = '8px'; b.textContent = txt; w.appendChild(b); return b; };
    let fns = null; const F = () => { if (!fns) { try { fns = firebase.app().functions(); } catch (e) {} } return fns; };
    if (ld.autopay && ld.stripeSubscriptionId) {
      const m = btn('Manage ' + LD_NAME[f] + ' (cancel, card, invoices)');
      m.onclick = () => {
        m.disabled = true; const t = m.textContent; m.textContent = 'Opening billing…';
        const fail = (msg) => { showToast('error', msg); m.disabled = false; m.textContent = t; };
        if (!F()) { fail('Billing is unavailable right now. Please try again.'); return; }
        F().httpsCallable('stripePortal')({}).then((res) => {
          const url = res && res.data && res.data.url;
          if (!url || url.indexOf('https://billing.stripe.com/') !== 0) throw new Error('Could not open billing.');
          window.location.assign(url);
        }).catch((err) => fail('Could not open billing: ' + ((err && err.message) || err)));
      };
    } else if (ld.autopay && ld.razorpaySubscriptionId) {
      const c = btn('Cancel ' + LD_NAME[f]); c.style.borderColor = 'rgba(229,72,77,0.3)';
      c.onclick = () => {
        if (!confirm('Cancel ' + LD_NAME[f] + '?\n\nIt stays on until ' + label(pt) + '.')) return;
        c.disabled = true; c.textContent = 'Cancelling…';
        if (!F()) { c.disabled = false; c.textContent = 'Cancel ' + LD_NAME[f]; return; }
        F().httpsCallable('razorpaySubsCancel')({ addon: true, planId: LD_PLAN[f] }).then(() => {
          showToast('success', 'Cancelled. ' + LD_NAME[f] + ' runs until ' + label(pt) + '.');
          c.remove(); w.querySelector('.mini-bar-val').textContent = 'Ends ' + label(pt) + ' (auto-renewal off)';
        }).catch((err) => { showToast('error', 'Could not cancel: ' + ((err && err.message) || err)); c.disabled = false; c.textContent = 'Cancel ' + LD_NAME[f]; });
      };
    } else if (!ld.autopay) { const r = btn('Renew ' + LD_NAME[f], 'a'); r.href = 'checkout.html?plan=' + LD_PLAN[f]; }
    box.appendChild(w);
  });
  if (has1 && has2) { const n = document.createElement('p'); n.style.cssText = 'margin:0 0 10px; font-size:12.5px; color:var(--ink-2); line-height:1.5;'; n.textContent = 'L2 Data includes L1. You can cancel L1 Data if you like.'; box.appendChild(n); }
  const ag = document.getElementById('settings-ld-agree'), m = s.marketDataAgreement;
  if (ag) {
    const ok = !!m && m.version === 'v1' && m.nonProfessional === true, at = ok && m.acceptedAt, when = at ? label(at.toDate ? at.toDate().getTime() : (at.seconds || 0) * 1000) : '';
    ag.innerHTML = ok ? 'Market data agreement: accepted ' + when + ' \u00b7 <a href="market-data-terms">View terms</a>' : 'Market data agreement: Not accepted \u00b7 <a href="market-data-terms">View terms</a>';
  }
}
