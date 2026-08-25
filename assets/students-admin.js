// Stryker Trading Academy — Admin: Students (students-admin.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`), assets/admin-guard.js
// Read-only. Access is gated by guardAdminPage() plus Firestore security
// rules, which restrict reads across all student docs to accounts with a
// matching document in the `admins` collection.

let ALL_STUDENTS = [];

function initials(name){
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function planOptionsForStudent(currentPlanName){
  const plans = (typeof getCachedPlansForRoles === 'function') ? getCachedPlansForRoles() : [];
  let opts = '<option value=""' + (!currentPlanName ? ' selected' : '') + '>Self-Paced (no plan)</option>';
  plans.forEach((p) => {
    const sel = p.name === currentPlanName ? ' selected' : '';
    opts += '<option value="' + escapeStudentText(p.name) + '"' + sel + '>' + escapeStudentText(p.name) + '</option>';
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
    const roleTag = (typeof roleTagHtml === 'function') ? roleTagHtml(s.plan, { size: 'small' }) : '';
    const card = document.createElement('div');
    card.className = 'record-card';
    card.innerHTML =
      '<div class="cell-user">' + (typeof avatarImgHtml === 'function' ? avatarImgHtml(s.uid, name, s, 36) : '<div class="cell-avatar"></div>') + '<div><span class="cell-name">' + name + (isAdminUser ? ' <span class="status-tag active" style="margin-left:6px;">Admin</span>' : '') + (isModeratorUser ? ' <span class="status-tag" style="margin-left:6px; background:rgba(0,173,181,0.12); border-color:var(--teal-dim); color:var(--teal);">Moderator</span>' : '') + roleTag + '</span><span class="cell-sub">' + (s.email || '—') + '</span></div></div>' +
      '<div class="record-stats">' +
        '<div class="record-stat"><span class="rs-label">Plan</span>' +
          '<select class="student-plan-select" data-uid="' + s.uid + '" style="font-family:var(--font-mono); font-size:12.5px; padding:5px 8px; border-radius:6px; border:1px solid var(--line); background:var(--bg-2); color:var(--ink-0);">' +
            planOptionsForStudent(s.plan) +
          '</select>' +
        '</div>' +
        '<div class="record-stat"><span class="rs-label">Chapters</span><span class="rs-val">' + (s.completedChapters ? s.completedChapters.length : 0) + ' / 42</span></div>' +
        '<div class="record-stat"><span class="rs-label">Lessons</span><span class="rs-val">' + (s.completedLessons ? s.completedLessons.length : 0) + '</span></div>' +
        '<div class="record-stat"><span class="rs-label">Streak</span><span class="rs-val">' + (s.currentStreak || 0) + ' day' + ((s.currentStreak || 0) === 1 ? '' : 's') + '</span></div>' +
        '<div class="record-stat"><span class="rs-label">Member since</span><span class="rs-val">' + memberSince + '</span></div>' +
      '</div>' +
      '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
        '<button class="btn btn-sm ' + (isAdminUser ? 'btn-ghost' : 'btn-primary') + '" data-toggle-admin="' + s.uid + '">' + (isAdminUser ? 'Revoke admin' : 'Grant admin') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-toggle-moderator="' + s.uid + '">' + (isModeratorUser ? 'Revoke moderator' : 'Grant moderator') + '</button>' +
      '</div>';

    card.querySelector('.student-plan-select').addEventListener('change', (e) => {
      const select = e.currentTarget;
      const newPlan = select.value || null;
      select.disabled = true;
      if (typeof syncPublicProfile === 'function') syncPublicProfile(s.uid, { plan: newPlan });
      db.collection('students').doc(s.uid).set({ plan: newPlan }, { merge: true })
        .then(() => loadStudents())
        .catch((err) => {
          alert('Could not change plan: ' + (err.message || err));
          select.disabled = false;
        });
    });

    card.querySelector('[data-toggle-admin]').addEventListener('click', (e) => {
      const btn = e.currentTarget;

      if (isAdminUser) {
        const isSelf = s.uid === auth.currentUser.uid;
        const isLastAdmin = CURRENT_ADMIN_UIDS.size <= 1;
        if (isSelf && isLastAdmin) {
          alert("You're the only admin — you can't revoke your own access, or no one would be able to manage the academy.");
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
        .then(() => loadAdminList())
        .then(() => renderStudentsTable(ALL_STUDENTS))
        .catch((err) => {
          alert('Could not update admin access: ' + (err.message || err));
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
        .then(() => loadModeratorList())
        .then(() => renderStudentsTable(ALL_STUDENTS))
        .catch((err) => {
          alert('Could not update moderator access: ' + (err.message || err));
          btn.disabled = false;
        });
    });

    body.appendChild(card);
  });
}

function loadStudents(){
  Promise.all([
    db.collection('students').get(),
    loadAdminList(),
    loadModeratorList(),
    (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve()
  ])
    .then(([snap]) => {
      ALL_STUDENTS = [];
      snap.forEach((doc) => ALL_STUDENTS.push(Object.assign({ uid: doc.id }, doc.data())));
      renderStudentsTable(ALL_STUDENTS);
    })
    .catch((err) => {
      console.error('Stryker: failed to load students', err);
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
  if (!ALL_STUDENTS.length) { alert('No students loaded yet.'); return; }
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
      completedLessonsCount: (s.completedLessons || []).length
    }, { merge: true })
  );

  Promise.allSettled(writes).then((results) => {
    const failed = results.filter((r) => r.status === 'rejected').length;
    btn.disabled = false;
    btn.textContent = 'Backfill all profiles';
    alert('Done — ' + (writes.length - failed) + ' of ' + writes.length + ' profiles created/updated' + (failed ? ('. ' + failed + ' failed, check the console.') : '.'));
    if (failed) results.forEach((r) => { if (r.status === 'rejected') console.error('Stryker: profile backfill failed for one student', r.reason); });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => loadStudents());

  document.getElementById('backfill-profiles-btn').addEventListener('click', backfillAllProfiles);

  document.getElementById('students-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { renderStudentsTable(ALL_STUDENTS); return; }
    const filtered = ALL_STUDENTS.filter(s =>
      (s.displayName || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q)
    );
    renderStudentsTable(filtered);
  });
});
