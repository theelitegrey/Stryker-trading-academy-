// TradeZoro — Admin: Students (students-admin.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`), assets/admin-guard.js, assets/admin-live-feed.js
// Read-only. Access is gated by guardAdminPage() plus Firestore security
// rules, which restrict reads across all student docs to accounts with a
// matching document in the `admins` collection.
// Live chart data (Owner 2026-10-26): each member's detail panel has a "Live chart data" switch that writes
// students/{uid}.liveFeed (+ liveFeedBy, liveFeedAt). The chart server (functions/api/chart/_rt.js) gives
// real-time CME futures to admins, the demo account and liveFeed === true members; firestore.rules lets only an
// admin write those three keys. Filter "Live data on" + the "Live data: N users" count live in the filter row.

let ALL_STUDENTS = [];

function initials(name){
  if (!name) return '?';
  const raw = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('');
  return raw.replace(/[^A-Z0-9]/g, '') || '?';
}

function planOptionsForStudent(currentPlanName){
  const plans = (typeof getCachedPlansForRoles === 'function') ? getCachedPlansForRoles() : [];
  let opts = '<option value=""' + (!currentPlanName ? ' selected' : '') + '>Self-Paced (no plan)</option>';
  plans.filter((p) => typeof adminPlanListed !== 'function' || adminPlanListed(p) || p.name === currentPlanName).forEach((p) => {
    const sel = p.name === currentPlanName ? ' selected' : '';
    opts += '<option value="' + escapeStudentText(p.name) + '"' + sel + '>' + escapeStudentText((typeof adminPlanStoredLabel === 'function' && !adminPlanListed(p) ? adminPlanStoredLabel(p) : (typeof adminPlanLabel === 'function' ? adminPlanLabel(p.name) : p.name))) + '</option>';
  });
  return opts;
}

function escapeStudentText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderStudentsTable(students){
  const body = document.getElementById('students-table-body');
  const countEl = document.getElementById('students-count');
  if (countEl) countEl.textContent = students.length + ' student' + (students.length === 1 ? '' : 's');

  if (!students.length) {
    body.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">No students found.</p>';
    return;
  }

  body.innerHTML = '';
  students.forEach((s) => {
    const name = s.displayName || (s.email ? s.email.split('@')[0] : 'Unnamed');
    const memberSince = (s.createdAt && typeof s.createdAt.toDate === 'function')
      ? s.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    const isAdminUser = CURRENT_ADMIN_UIDS.has(s.uid);
    const isModeratorUser = CURRENT_MODERATOR_UIDS.has(s.uid);
    const isStaffUser = (typeof CURRENT_STAFF_UIDS !== 'undefined') && CURRENT_STAFF_UIDS.has(s.uid);
    const roleTag = (typeof roleTagHtml === 'function') ? roleTagHtml(s.plan, { size: 'small', admin: true }) : '';
    const liveOn = s.liveFeed === true;
    const liveWhyList = liveWhy(s, isAdminUser);
    const card = document.createElement('div');
    // Collapsed by default. Every student's full detail was previously
    // expanded at once, so a list of twenty filled several screens and the
    // name you were looking for was buried between plan pickers and buttons.
    // No extra cost to collapse: all of this data already arrived in the one
    // students query, so opening a row reads nothing new.
    card.className = 'record-card student-row';
    card.innerHTML =
      '<button type="button" class="student-row-head" aria-expanded="false">' +
        '<div class="cell-user">' + (typeof avatarImgHtml === 'function' ? avatarImgHtml(s.uid, name, s, 36) : '<div class="cell-avatar"></div>') + '<div><span class="cell-name">' + stkEsc(name) + (isAdminUser ? ' <span class="status-tag active" style="margin-left:6px;">Admin</span>' : '') + (isModeratorUser ? ' <span class="status-tag" style="margin-left:6px; background:rgba(0,173,181,0.12); border-color:var(--teal-dim); color:var(--teal);">Moderator</span>' : '') + roleTag + (liveWhyList.length ? ' <span class="status-tag live-feed-tag" title="Why: ' + liveWhyList.join(', ') + '">Live data · ' + liveWhyList[0] + '</span>' : '') + '</span><span class="cell-sub">' + stkEsc(s.email || '—') + '</span></div></div>' +
        '<svg class="student-row-chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="student-row-body"><div class="student-row-inner">' +
      '<div class="record-stats">' +
        '<div class="record-stat"><span class="rs-label">Plan</span>' +
          '<select class="student-plan-select" data-uid="' + s.uid + '" style="font-family:var(--font-mono); font-size:12.5px; padding:5px 8px; border-radius:6px; border:1px solid var(--line); background-color:var(--bg-2); color:var(--ink-0);">' +
            planOptionsForStudent(s.plan) +
          '</select>' +
        '</div>' +
        '<div class="record-stat"><span class="rs-label">Chapters</span><span class="rs-val">' + (s.completedChapters ? s.completedChapters.length : 0) + ' / 42 core</span></div>' +
        '<div class="record-stat"><span class="rs-label">Lessons</span><span class="rs-val">' + (s.completedLessons ? s.completedLessons.length : 0) + '</span></div>' +
        '<div class="record-stat"><span class="rs-label">Streak</span><span class="rs-val">' + (s.currentStreak || 0) + ' day' + ((s.currentStreak || 0) === 1 ? '' : 's') + '</span></div>' +
        '<div class="record-stat"><span class="rs-label">Member since</span><span class="rs-val">' + memberSince + '</span></div>' +
      '</div>' +
      '<div class="live-feed-row">' +
        '<label class="live-feed-switch"><input type="checkbox" role="switch" data-live-feed="' + s.uid + '"' + (liveOn ? ' checked' : '') + '>' +
          '<span class="live-feed-track" aria-hidden="true"></span><span class="live-feed-label">Live chart data</span></label>' +
        '<span class="live-feed-saved" aria-live="polite"></span>' +
        '<span class="live-feed-note">' + (isAdminUser ? 'Admins always get live data.' : (s.demo === true ? 'Demo account: always live.' : (liveNote(s, liveOn, liveWhyList)))) + '</span>' +
      '</div>' +
      '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
        '<button class="btn btn-sm ' + (isAdminUser ? 'btn-ghost' : 'btn-primary') + '" data-toggle-admin="' + s.uid + '">' + (isAdminUser ? 'Revoke admin' : 'Grant admin') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-toggle-moderator="' + s.uid + '">' + (isModeratorUser ? 'Revoke moderator' : 'Grant moderator') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-toggle-staff="' + s.uid + '">' + (isStaffUser ? 'Revoke staff' : 'Grant staff') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-delete-student="' + s.uid + '" style="color:var(--bear); border-color:rgba(229,72,77,0.35);">Delete user</button>' +
      '</div>' +
      '</div></div>';

    const head = card.querySelector('.student-row-head');
    head.addEventListener('click', () => {
      const open = card.classList.toggle('open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    card.querySelector('[data-live-feed]').addEventListener('change', (e) => {
      const box = e.currentTarget;
      const want = box.checked;
      const saved = card.querySelector('.live-feed-saved');
      const note = card.querySelector('.live-feed-note');
      if (want && !confirm('Give ' + name + ' live futures data (real-time CME on ZoroCharts)?')) { box.checked = false; return; }
      box.disabled = true;
      saved.className = 'live-feed-saved'; saved.textContent = 'Saving…';
      strykerSetLiveFeed(s.uid, want, name)
        .then(() => {
          s.liveFeed = want;
          box.disabled = false;
          saved.className = 'live-feed-saved is-ok'; saved.textContent = '✓ Saved';
          setTimeout(() => { if (saved.textContent === '✓ Saved') saved.textContent = ''; }, 2500);
          if (note && !isAdminUser && s.demo !== true) note.textContent = want ? 'Approved by you just now. Real-time CME futures on ZoroCharts (about 1 min to switch off).' : 'Off: futures on ZoroCharts are 10 min delayed (within about 1 min).';
          const tag = card.querySelector('.live-feed-tag');
          const wl = liveWhy(s, isAdminUser);
          if (tag) { if (wl.length) { tag.textContent = 'Live data · ' + wl[0]; tag.title = 'Why: ' + wl.join(', '); } else tag.remove(); }
          else if (wl.length) { const t = document.createElement('span'); t.className = 'status-tag live-feed-tag'; t.textContent = 'Live data · ' + wl[0]; t.title = 'Why: ' + wl.join(', '); const nm = card.querySelector('.cell-name'); nm.appendChild(document.createTextNode(' ')); nm.appendChild(t); }
          if (typeof window.__strykerLiveCount === 'function') window.__strykerLiveCount();
        })
        .catch((err) => {
          box.checked = !want; box.disabled = false;
          saved.className = 'live-feed-saved is-err'; saved.textContent = 'Not saved';
          showToast('error', 'Could not change live chart data: ' + (err.message || err));
        });
    });

    card.querySelector('.student-plan-select').addEventListener('change', (e) => {
      const select = e.currentTarget;
      const newPlan = select.value || null;
      select.disabled = true;
      if (typeof syncPublicProfile === 'function') syncPublicProfile(s.uid, { plan: newPlan });
      db.collection('students').doc(s.uid).set({ plan: newPlan }, { merge: true })
        .then(() => {
          // An admin granting a plan is a conversion too. Previously only
          // checkout.js triggered this, so any plan granted from here paid the
          // referrer nothing — invisible, because the invite row simply stayed
          // on "Signed up" with no error anywhere.
          if (typeof processReferralConversion === 'function' && newPlan) {
            processReferralConversion(s.uid, newPlan);
          }
        })
        .then(() => {
          if (typeof logActivity === 'function') logActivity('student.plan_changed',
            'Changed ' + name + "'s plan to " + (newPlan || 'none'),
            { targetUid: s.uid, targetName: name, detail: 'from ' + (s.plan || 'none') + ' to ' + (newPlan || 'none') });
        })
        .then(() => loadStudents())
        .catch((err) => {
          showToast('error', 'Could not change plan: ' + (err.message || err));
          select.disabled = false;
        });
    });

    card.querySelector('[data-toggle-admin]').addEventListener('click', (e) => {
      const btn = e.currentTarget;

      if (isAdminUser) {
        const isSelf = s.uid === auth.currentUser.uid;
        const isLastAdmin = CURRENT_ADMIN_UIDS.size <= 1;
        if (isSelf && isLastAdmin) {
          showToast('error', "You're the only admin — you can't revoke your own access, or no one would be able to manage the academy.");
          return;
        }
        const warning = isSelf
          ? "This will remove YOUR OWN admin access immediately. You'll be signed out of admin pages. Continue?"
          : 'Revoke admin access for ' + name + '?';
        if (!confirm(warning)) return;
      }

      btn.disabled = true;
      const action = isAdminUser
        ? revokeAdmin(s.uid)
        : grantAdmin(s.uid, s.email, s.displayName, auth.currentUser.uid);
      action
        .then(() => {
          if (typeof logActivity === 'function') logActivity(
            isAdminUser ? 'student.admin_revoked' : 'student.admin_granted',
            (isAdminUser ? 'Revoked admin from ' : 'Granted admin to ') + name,
            { targetUid: s.uid, targetName: name });
        })
        .then(() => loadAdminList())
        .then(() => renderStudentsTable(ALL_STUDENTS))
        .catch((err) => {
          showToast('error', 'Could not update admin access: ' + (err.message || err));
          btn.disabled = false;
        });
    });

    card.querySelector('[data-toggle-staff]').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (isStaffUser && !confirm('Revoke staff for ' + name + '?')) return;

      btn.disabled = true;
      const action = isStaffUser
        ? revokeStaff(s.uid)
        : grantStaff(s.uid, s.email, s.displayName, auth.currentUser.uid);
      action
        .then(() => {
          if (typeof logActivity === 'function') logActivity(
            isStaffUser ? 'user.staff_revoked' : 'user.staff_granted',
            (isStaffUser ? 'Revoked staff from ' : 'Granted staff to ') + name,
            { targetUid: s.uid, targetName: name });
        })
        .then(() => loadStaffList())
        .then(() => renderStudentsTable(ALL_STUDENTS))
        .catch((err) => {
          showToast('error', 'Could not update staff: ' + (err.message || err));
          btn.disabled = false;
        });
    });

    card.querySelector('[data-toggle-moderator]').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (isModeratorUser && !confirm('Revoke moderator access for ' + name + '?')) return;

      btn.disabled = true;
      const action = isModeratorUser
        ? revokeModerator(s.uid)
        : grantModerator(s.uid, s.email, s.displayName, auth.currentUser.uid);
      action
        .then(() => {
          if (typeof logActivity === 'function') logActivity(
            isModeratorUser ? 'student.moderator_revoked' : 'student.moderator_granted',
            (isModeratorUser ? 'Revoked moderator from ' : 'Granted moderator to ') + name,
            { targetUid: s.uid, targetName: name });
        })
        .then(() => loadModeratorList())
        .then(() => renderStudentsTable(ALL_STUDENTS))
        .catch((err) => {
          showToast('error', 'Could not update moderator access: ' + (err.message || err));
          btn.disabled = false;
        });
    });

    card.querySelector('[data-delete-student]').addEventListener('click', (e) => {
      const btn = e.currentTarget;

      if (s.uid === auth.currentUser.uid) {
        showToast('error', "You can't delete your own account from here.");
        return;
      }
      if (isAdminUser && CURRENT_ADMIN_UIDS.size <= 1) {
        showToast('success', "That's the only admin account — deleting it would leave nobody able to manage the academy.");
        return;
      }
      if (isAdminUser && !confirm(name + ' is an ADMIN. Deleting will remove their admin access too. Continue?')) return;

      // Typed confirmation rather than a plain OK/Cancel: this is irreversible
      // and wipes journal entries, posts and progress that cannot be restored.
      const expected = (s.email || name || '').trim();
      const typed = prompt(
        'PERMANENTLY DELETE ' + name + '\n\n' +
        'This erases their profile, progress, journal, posts, replies, invites and notifications. It cannot be undone.\n\n' +
        'Type their email exactly to confirm:\n' + expected
      );
      if (typed === null) return;
      if (typed.trim().toLowerCase() !== expected.toLowerCase()) {
        showToast('success', "That didn't match — nothing was deleted.");
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Deleting…';
      // Logged BEFORE the delete runs: the actor's own admin lookup and the
      // target's details are still readable, and a delete that fails halfway
      // still leaves a record that it was attempted.
      if (typeof logActivity === 'function') logActivity('student.deleted',
        'Deleted the account ' + name + ' (' + (s.email || 'no email') + ')',
        { targetUid: s.uid, targetName: name });
      deleteStudentCompletely(s.uid, s.email, name)
        .then((report) => {
          showToast('success', 'Deleted ' + name + '.\n\n' + report.join('\n'));
          return loadAdminList().then(() => loadModeratorList()).then(() => loadStudents());
        })
        .catch((err) => {
          showToast('error', 'Delete failed: ' + (err.message || err));
          btn.disabled = false;
          btn.textContent = 'Delete user';
        });
    });

    body.appendChild(card);
  });
}

// Full account deletion.
//
// PREFERRED PATH: the deleteUserAccount Cloud Function. It runs with the
// Admin SDK, so it can delete the Firebase Auth login itself — something the
// browser SDK fundamentally cannot do for anyone but the current user. It
// also cascades the Firestore data server-side, unrestricted by rules.
//
// FALLBACK PATH: if that function isn't deployed yet, wipe what the client is
// allowed to and leave a bannedUsers tombstone so the account is at least
// locked out. The caller is told plainly that the login still exists.
function deleteStudentCompletely(uid, email, name){
  const callable = (firebase.app().functions)
    ? firebase.app().functions('us-central1').httpsCallable('deleteUserAccount')
    : null;

  if (callable) {
    return callable({ uid: uid })
      .then((res) => {
        const data = res.data || {};
        const report = (data.report || []).map((line) => '• ' + line);
        if (data.authDeleted) report.push('• Firebase Auth login removed — nothing left to do manually');
        return report;
      })
      .catch((err) => {
        // Genuine refusals from the function are the admin's answer, not a
        // reason to fall back to a weaker delete.
        if (err && (err.code === 'permission-denied' || err.code === 'failed-precondition' || err.code === 'unauthenticated')) {
          throw new Error(err.message);
        }
        console.warn('TradeZoro: deleteUserAccount unavailable, falling back to client-side wipe', err);
        return deleteStudentClientSide(uid, email, name).then((report) => {
          report.push('');
          report.push('⚠ The Cloud Function is not deployed, so the Firebase Auth login could NOT be removed.');
          report.push('Delete it in Firebase console → Authentication → Users. They are blocked meanwhile.');
          return report;
        });
      });
  }

  return deleteStudentClientSide(uid, email, name);
}

// Client-only wipe. Cannot touch the Auth record — see above.
function deleteStudentClientSide(uid, email, name){
  const report = [];

  // Deletes every doc a query returns, in batches. Firestore caps a batch at
  // 500 writes.
  function deleteQuery(query, label){
    return query.get().then((snap) => {
      if (snap.empty) return;
      const docs = snap.docs;
      const batches = [];
      for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        batches.push(batch.commit());
      }
      return Promise.all(batches).then(() => { report.push('• ' + docs.length + ' ' + label); });
    }).catch((err) => {
      console.error('TradeZoro: failed deleting ' + label, err);
      report.push('• ' + label + ' — FAILED (' + (err.code || err.message) + ')');
    });
  }

  // Block first. If anything later fails halfway, they're still locked out
  // rather than left with a half-deleted but fully usable account.
  return db.collection('bannedUsers').doc(uid).set({
    email: email || null,
    displayName: name || null,
    deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
    deletedBy: auth.currentUser ? auth.currentUser.uid : null
  }).then(() => { report.push('• Account blocked from signing in'); })
    .then(() => deleteQuery(db.collection('students').doc(uid).collection('journal'), 'journal entries'))
    .then(() => deleteQuery(db.collection('students').doc(uid).collection('bookmarks'), 'bookmarks'))
    .then(() => deleteQuery(db.collection('communityPosts').where('authorUid', '==', uid), 'trading floor posts'))
    .then(() => deleteQuery(db.collection('notifications').where('recipientUid', '==', uid), 'notifications'))
    .then(() => deleteQuery(db.collection('referralCodes').where('uid', '==', uid), 'invite codes'))
    .then(() => deleteQuery(db.collection('referrals').where('referrerUid', '==', uid), 'invites they sent'))
    // NOT deleted: rows where this person was the INVITEE belong to whoever
    // invited them. Wiping them would erase someone else's earned history and
    // drop their invite count, while the points those invites paid stay on
    // their profile — leaving a total that no longer matches any visible row.
    // The row is tombstoned instead, so the credit survives the account.
    .then(() => db.collection('referrals').where('referredUid', '==', uid).get()
      .then((snap) => {
        if (snap.empty) return;
        const batch = db.batch();
        snap.forEach((d) => batch.update(d.ref, {
          referredUserDeleted: true,
          referredName: (d.data().referredName || name || 'A former member'),
          referredEmail: null,          // the account is gone; don't keep the address
          referredUid: null             // break the link to a uid that no longer exists
        }));
        return batch.commit().then(() => { report.push('• ' + snap.size + ' invite record(s) kept for whoever invited them'); });
      })
      .catch((err) => { report.push('• invite records — FAILED (' + (err.code || err.message) + ')'); }))
    .then(() => db.collection('admins').doc(uid).delete().catch(() => {}))
    .then(() => db.collection('moderators').doc(uid).delete().catch(() => {}))
    .then(() => db.collection('profiles').doc(uid).delete()
      .then(() => { report.push('• Public profile'); })
      .catch((err) => { report.push('• Public profile — FAILED (' + (err.code || err.message) + ')'); }))
    .then(() => db.collection('students').doc(uid).delete()
      .then(() => { report.push('• Student record'); }))
    .then(() => report);
}

function loadStudents(){
  Promise.all([
    db.collection('students').get(),
    loadAdminList(),
    loadModeratorList(),
    (typeof loadStaffList === 'function') ? loadStaffList() : Promise.resolve(),
    (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve()
  ])
    .then(([snap]) => {
      ALL_STUDENTS = [];
      snap.forEach((doc) => ALL_STUDENTS.push(Object.assign({ uid: doc.id }, doc.data())));
      // Through applyFilters rather than straight to render, so the count
      // label is populated on first paint and any role filter already chosen
      // is respected after a reload.
      if (typeof window.__strykerApplyUserFilters === 'function') {
        window.__strykerApplyUserFilters();
      } else {
        renderStudentsTable(ALL_STUDENTS);
      }
    })
    .catch((err) => {
      console.error('TradeZoro: failed to load students', err);
      document.getElementById('students-table-body').innerHTML =
        '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">Could not load students: ' + (err.message || err) + '</p>';
      document.getElementById('students-count').textContent = 'Error loading students';
    });
}

// One-time (or occasional) maintenance action: creates/updates a public
// profiles/{uid} doc for every existing student from their current
// students/{uid} data. Needed because the profile-sync hooks only fire
// going forward, on actual account activity (signing in, changing a photo,
// etc.) — an account that doesn't happen to trigger one of those after
// profile pages shipped would otherwise show "Profile not found"
// indefinitely. Safe to run more than once; merge:true just refreshes
// each field to whatever's currently on the student doc.
function backfillAllProfiles(){
  if (!ALL_STUDENTS.length) { showToast('error', 'No students loaded yet.'); return; }
  if (!confirm('Create/update a public profile for all ' + ALL_STUDENTS.length + ' students? Safe to run more than once.')) return;

  const btn = document.getElementById('backfill-profiles-btn');
  btn.disabled = true;
  btn.textContent = 'Backfilling…';

  const writes = ALL_STUDENTS.map((s) =>
    db.collection('profiles').doc(s.uid).set({
      displayName: s.displayName || '',
      photoURL: s.photoURL || null,
      customPhotoURL: s.customPhotoURL || null,
      avatarSeed: s.avatarSeed || null,
      plan: s.plan || null,
      bio: s.bio || null,
      createdAt: s.createdAt || null,
      currentStreak: s.currentStreak || 0,
      bestStreak: s.bestStreak || 0,
      completedChaptersCount: (s.completedChapters || []).length,
      completedLessonsCount: (s.completedLessons || []).length,
      // The invite leaderboard reads referralPoints from profiles/, since a
      // student can't list the students collection. Mirroring it here is what
      // makes existing point totals visible on the leaderboard at all.
      referralPoints: s.referralPoints || 0
    }, { merge: true })
  );

  Promise.allSettled(writes).then((results) => {
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (typeof logActivity === 'function') logActivity('student.profiles_backfill',
      'Backfilled ' + (writes.length - failed) + ' public profiles');
    btn.disabled = false;
    btn.textContent = 'Backfill all profiles';
    showToast('error', 'Done — ' + (writes.length - failed) + ' of ' + writes.length + ' profiles created/updated' + (failed ? ('. ' + failed + ' failed, check the console.') : '.'));
    if (failed) results.forEach((r) => { if (r.status === 'rejected') console.error('TradeZoro: profile backfill failed for one student', r.reason); });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => loadStudents());

  document.getElementById('backfill-profiles-btn').addEventListener('click', backfillAllProfiles);

  // Search and role filter compose rather than overriding one another.
  //
  // Written as one applyFilters() both inputs call, not two handlers that each
  // re-render from ALL_STUDENTS. Two independent handlers is the usual shape
  // and it is subtly broken: typing a search would silently discard the role
  // selection, and picking a role would clear the search box's effect, so the
  // visible controls would disagree with the visible rows.
  let CURRENT_ROLE_FILTER = 'all';

  function roleOf(s){
    // A user can hold several roles at once; this returns the SET they match,
    // so filtering by "staff" finds an admin who is also staff rather than
    // hiding them behind a single primary role.
    const roles = [];
    if (CURRENT_ADMIN_UIDS && CURRENT_ADMIN_UIDS.has(s.uid)) roles.push('admin');
    if (CURRENT_MODERATOR_UIDS && CURRENT_MODERATOR_UIDS.has(s.uid)) roles.push('moderator');
    if (typeof CURRENT_STAFF_UIDS !== 'undefined' && CURRENT_STAFF_UIDS.has(s.uid)) roles.push('staff');
    if (typeof isBotUid === 'function' && isBotUid(s.uid)) roles.push('bot');
    // "Student" means no elevated role — otherwise every admin would also show
    // under students and the filter would barely narrow anything.
    if (!roles.length) roles.push('student');
    return roles;
  }

  // The line under the switch: who approved it and when, or why they are live anyway.
  function liveNote(s, liveOn, why){
    const by = s.liveFeedBy && ALL_STUDENTS ? ALL_STUDENTS.find(x => x.uid === s.liveFeedBy) : null;
    let at = '';
    try { const t = s.liveFeedAt; const d = t && t.toDate ? t.toDate() : (t && t.seconds ? new Date(t.seconds * 1000) : null); if (d) at = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) {}
    const who = liveOn ? 'Approved' + (by ? ' by ' + (by.displayName || by.name || (by.email || '').split('@')[0]) : (s.liveFeedBy ? ' by an admin' : '')) + (at ? ' on ' + at : '') + '. ' : '';
    if (why.indexOf('Add-on') !== -1) return who + 'Also has the paid $5/month Live Futures Data add-on.';
    if (s.liveFeed === true && s.liveFeedGrandfathered === true) return 'Live futures: On (kept from Pro)' + (why.indexOf('Kept from Pro') === -1 ? ' \u2014 paused: Pro is no longer active, so futures are 10 min delayed.' : '. Stays on while their Pro is active; switch off to remove.');
    if (liveOn) return who + 'Real-time CME futures on ZoroCharts.';
    return 'Off: futures on ZoroCharts are 10 min delayed (unless they connect Rithmic or buy the add-on).';
  }

  // Mirrors isActiveProDoc in _rt.js: paid plan, not expired/cancelled, inside paidThrough + 3 days (founding = always).
  function proStillActive(s){
    if (!s.plan || !(typeof rankOf === 'function' && rankOf(s.plan) >= 1)) return false;
    if (s.subscriptionStatus === 'expired' || s.subscriptionStatus === 'cancelled' || s.subscriptionStatus === 'canceled') return false;
    if (s.foundingMember === true) return true;
    const pt = Number(s.paidThroughMillis) || 0;
    return !(pt > 0 && Date.now() > pt + 3 * 86400000);
  }
  // Why a member gets real-time chart data (mirrors functions/api/chart/_rt.js; the SERVER decides, this only labels).
  // Add-on = students/{uid}.liveData.active with paidThroughMillis + 3 days grace.
  function liveWhy(s, isAdminUser){
    const why = [];
    if (isAdminUser) why.push('Admin');
    if (s.demo === true) why.push('Demo');
    if (s.liveFeed === true && s.liveFeedGrandfathered === true) {
      // Early Pro member kept live (Owner 2026-10-30): server keeps real-time only while Pro stays active.
      if (proStillActive(s)) why.push('Kept from Pro');
    } else if (s.liveFeed === true) why.push('Switch');
    // Owner 2026-10-30: Pro no longer includes real-time futures. The $5/month add-on does (liveData, 3 days grace).
    const ld = s.liveData || {}, lpt = Number(ld.paidThroughMillis) || 0;
    if (ld.active === true && (!lpt || Date.now() <= lpt + 3 * 86400000)) why.push('Add-on');
    return why;
  }
  // renderStudentsTable (top level) calls this too; without the global the whole list failed to load.
  window.liveWhy = liveWhy;

  function applyFilters(){
    const q = (document.getElementById('students-search').value || '').trim().toLowerCase();
    let list = ALL_STUDENTS;

    if (CURRENT_ROLE_FILTER === 'live') {
      list = list.filter(s => liveWhy(s, CURRENT_ADMIN_UIDS.has(s.uid)).length > 0);
    } else if (CURRENT_ROLE_FILTER === 'plan-pro' || CURRENT_ROLE_FILTER === 'plan-free') {
      const wantPro = CURRENT_ROLE_FILTER === 'plan-pro';
      list = list.filter(s => (typeof rankOf === 'function' && s.plan && rankOf(s.plan) >= 1) === wantPro);
    } else if (CURRENT_ROLE_FILTER !== 'all') {
      list = list.filter(s => roleOf(s).indexOf(CURRENT_ROLE_FILTER) !== -1);
    }
    if (q) {
      list = list.filter(s =>
        (s.displayName || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q)
      );
    }
    renderStudentsTable(list);

    const count = document.getElementById('users-filter-count');
    if (count) {
      count.textContent = list.length === ALL_STUDENTS.length
        ? list.length + ' users'
        : list.length + ' of ' + ALL_STUDENTS.length;
    }
    liveCount();
  }
  // "Live data: N users" = everyone who gets real-time: admin, demo, the admin switch, or an active Live Futures Data add-on
  function liveCount(){
    const el = document.getElementById('users-live-count');
    if (!el) return;
    let n = 0, pro = 0, sw = 0;
    ALL_STUDENTS.forEach(s => { const w = liveWhy(s, CURRENT_ADMIN_UIDS.has(s.uid)); if (w.length) n++; if (w.indexOf('Add-on') !== -1) pro++; if (w.indexOf('Switch') !== -1) sw++; });
    el.textContent = 'Live data: ' + n + ' user' + (n === 1 ? '' : 's') + ' (add-on ' + pro + ', approved ' + sw + ')';
  }
  window.__strykerLiveCount = liveCount;

  document.getElementById('students-search').addEventListener('input', applyFilters);

  const filterBar = document.getElementById('users-role-filter');
  if (filterBar) {
    filterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-role]');
      if (!btn) return;
      filterBar.querySelectorAll('[data-role]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      CURRENT_ROLE_FILTER = btn.getAttribute('data-role');
      applyFilters();
    });
    // dashboard "Manage" link: students-admin.html#live opens on the Live data filter
    if (location.hash === '#live') { const b = filterBar.querySelector('[data-role="live"]'); if (b) b.click(); }
  }

  // Exposed so loadStudents() can refresh counts once the role lists resolve;
  // roleOf depends on them, and they load asynchronously.
  window.__strykerApplyUserFilters = applyFilters;
});

// ---- CSV export (WordPress-style "export users") ---------------------------
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('students-export-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!ALL_STUDENTS.length) { if (typeof showToast === 'function') showToast('error', 'Nothing loaded yet.'); return; }
    const esc = (v) => {
      const s = String(v === null || v === undefined ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const when = (ts) => ts && typeof ts.toDate === 'function' ? ts.toDate().toISOString().slice(0, 10) : '';
    const header = ['UID', 'Name', 'Email', 'Plan', 'Joined', 'Chapters completed', 'TradingView username', 'TV access'];
    const lines = [header.join(',')].concat(ALL_STUDENTS.map((s) => [
      s.uid, s.name || s.displayName || '', s.email || '', s.plan || '',
      when(s.createdAt), Array.isArray(s.completedChapters) ? s.completedChapters.length : '',
      s.tradingViewUsername || '', s.tradingViewAccessGranted ? 'granted' : (s.tradingViewUsername ? 'pending' : '')
    ].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stryker-students-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    if (typeof showToast === 'function') showToast('success', 'Exported ' + ALL_STUDENTS.length + ' students.');
  });
});
