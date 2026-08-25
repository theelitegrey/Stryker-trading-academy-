// Stryker Trading Academy — public profile page (profile.html?uid=...)
// Depends on: assets/progress.js (`db`, `auth`), assets/avatars.js
// (avatarImgHtml), assets/roles.js (roleTagHtml, loadPlansForRoles).
//
// Reads from profiles/{uid} — a deliberately narrow, public-safe copy of a
// student's data, not the real students/{uid} doc (which stays restricted
// to the owner + admins). See assets/profiles-sync.js for the full reasoning
// and the write side of this.

function getProfileUidFromQuery(){
  return new URLSearchParams(window.location.search).get('uid');
}

function formatJoinDate(createdAt){
  if (!createdAt || typeof createdAt.toDate !== 'function') return null;
  return createdAt.toDate().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function renderProfileNotFound(){
  const target = document.getElementById('profile-render-target');
  if (!target) return;
  target.innerHTML =
    '<div class="panel" style="text-align:center; padding:56px 32px;">' +
      '<h2 style="font-size:19px; margin-bottom:8px;">Profile not found</h2>' +
      '<p style="color:var(--ink-3); font-size:14px;">This account may not exist, or hasn\'t signed in since profile pages launched yet.</p>' +
    '</div>';
}

function renderProfile(uid, profile, isOwnProfile, postCount){
  const target = document.getElementById('profile-render-target');
  if (!target) return;

  const name = profile.displayName || 'Trader';
  const avatarHtml = (typeof avatarImgHtml === 'function') ? avatarImgHtml(uid, name, profile, 96) : '';
  const roleTag = (profile.plan && typeof roleTagHtml === 'function') ? roleTagHtml(profile.plan) : '';
  const joinDate = formatJoinDate(profile.createdAt);

  target.innerHTML =
    '<div class="panel" style="text-align:center; padding:48px 32px;">' +
      '<div style="margin-bottom:18px; display:flex; justify-content:center;">' + avatarHtml + '</div>' +
      '<h2 style="font-size:22px; margin-bottom:6px;">' + escapeProfileText(name) + roleTag + '</h2>' +
      (joinDate ? '<p style="color:var(--ink-3); font-size:13px; margin-bottom:28px;">Member since ' + joinDate + '</p>' : '<div style="margin-bottom:28px;"></div>') +
      '<div style="display:flex; justify-content:center; gap:40px; flex-wrap:wrap;">' +
        '<div><b style="display:block; font-family:var(--font-mono); font-size:22px; color:var(--ink-0);">' + (profile.currentStreak || 0) + '</b><span style="font-size:11.5px; color:var(--ink-3);">Day streak</span></div>' +
        '<div><b style="display:block; font-family:var(--font-mono); font-size:22px; color:var(--ink-0);">' + postCount + '</b><span style="font-size:11.5px; color:var(--ink-3);">Trading Floor posts</span></div>' +
      '</div>' +
      (isOwnProfile ? '<a href="settings.html" class="btn btn-ghost btn-sm" style="margin-top:32px;">Edit profile</a>' : '') +
    '</div>';
}

function escapeProfileText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;

  auth.onAuthStateChanged((currentUser) => {
    if (!currentUser) {
      window.location.href = 'login.html';
      return;
    }

    const targetUid = getProfileUidFromQuery() || currentUser.uid;
    const isOwnProfile = targetUid === currentUser.uid;

    const profileCheck = db.collection('profiles').doc(targetUid).get();
    const postCountCheck = db.collection('communityPosts').where('authorUid', '==', targetUid).get()
      .then((snap) => snap.size)
      .catch((err) => { console.error('Stryker: failed to load post count', err); return 0; });

    Promise.all([profileCheck, postCountCheck, (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve()])
      .then(([profileDoc, postCount]) => {
        if (!profileDoc.exists) { renderProfileNotFound(); return; }
        renderProfile(targetUid, profileDoc.data(), isOwnProfile, postCount);
      })
      .catch((err) => {
        console.error('Stryker: failed to load profile', err);
        renderProfileNotFound();
      });
  });
});
