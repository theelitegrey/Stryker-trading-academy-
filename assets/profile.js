// Stryker Trading Academy — public profile page (profile.html?uid=...)
// Depends on: assets/progress.js (`db`, `auth`), assets/avatars.js
// (avatarImgHtml), assets/roles.js (roleTagHtml, findPlan, loadPlansForRoles).
//
// Reads from profiles/{uid} — a deliberately narrow, public-safe copy of a
// student's data, not the real students/{uid} doc (which stays restricted
// to the owner + admins). See assets/profiles-sync.js for the full reasoning
// and the write side of this.

const PROFILE_RECENT_POSTS_LIMIT = 6;

// IDs from the shared ACHIEVEMENTS array (achievements-data.js) that are
// actually computable from what's synced to the public profile doc.
// Excluded: the three level-specific curriculum badges (Foundations/
// Structure Master/SMT Certified), which need the exact completed-chapters
// list rather than just a count; and everything in achievements-data.js
// marked `private: true` (the 5 Trade Journal badges) — trade frequency
// and win/loss patterns stay off the public profile by design, same
// reasoning as why journal entries themselves are private everywhere else.
const PROFILE_VISIBLE_BADGE_IDS = [
  'first-chapter', 'chapters-5', 'chapters-10', 'halfway-there', 'chapters-30', 'curriculum-complete',
  'lessons-10', 'lessons-25', 'lessons-50', 'lessons-100',
  'streak-3', 'streak-7', 'streak-14', 'streak-30', 'streak-60', 'streak-100',
  'first-post', 'posts-5', 'posts-25', 'posts-50', 'first-reply', 'replies-10', 'likes-5', 'likes-25', 'likes-100',
  'first-referral', 'referral-points-100', 'referral-points-250', 'referral-points-500',
  'bio-set', 'avatar-customized', 'plan-upgraded', 'tv-access', 'early-adopter', 'welcome'
];

function getEarnedProfileBadges(profile){
  if (typeof ACHIEVEMENTS === 'undefined') return [];
  const s = {
    completedChapters: new Array(profile.completedChaptersCount || 0).fill(0), // count-only stand-in, length is all these checks use
    completedLessons: new Array(profile.completedLessonsCount || 0).fill(0),
    bestStreak: profile.bestStreak || 0,
    bio: profile.bio || '',
    customPhotoURL: profile.customPhotoURL || null,
    avatarSeed: profile.avatarSeed || null,
    plan: profile.plan || null,
    referralPoints: profile.referralPoints || 0,
    tradingViewAccessGranted: !!profile.tradingViewAccessGranted
  };
  const extra = {
    postCount: profile.floorPostCount || 0,
    replyCount: profile.floorReplyCount || 0,
    likesReceived: profile.floorLikesReceived || 0
  };
  // curriculum-complete needs ch.length specifically (the total chapter
  // count, 42) — a dummy array of the right length satisfies that check
  // without needing the actual chapter objects, which the level-specific
  // badges would need and which is exactly why those stay excluded above.
  const fakeChapters = new Array(42);
  return ACHIEVEMENTS.filter((a) => PROFILE_VISIBLE_BADGE_IDS.includes(a.id) && a.check(s, fakeChapters, extra));
}

function getProfileUidFromQuery(){
  return new URLSearchParams(window.location.search).get('uid');
}

function formatJoinDate(createdAt){
  if (!createdAt || typeof createdAt.toDate !== 'function') return null;
  return createdAt.toDate().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function escapeProfileText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeAgoLabel(date){
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

function bannerGradientFor(plan){
  const color = (plan && plan.color) ? plan.color : '#00adb5';
  return 'linear-gradient(120deg, ' + color + '33, ' + color + '08 60%, transparent)';
}

function renderPostCard(post){
  const when = post.createdAt && post.createdAt.toDate ? timeAgoLabel(post.createdAt.toDate()) : '';
  const imgHtml = post.imageDataUrl ? '<img src="' + post.imageDataUrl + '" style="width:100%; border-radius:8px; margin-top:10px; display:block;">' : '';
  return (
    '<div class="record-card" style="flex-direction:column; align-items:stretch; gap:6px;">' +
      '<span class="cell-sub">' + when + '</span>' +
      '<div style="font-size:14px; color:var(--ink-1); line-height:1.5;">' + (post.textHtml || '') + '</div>' +
      imgHtml +
    '</div>'
  );
}

function renderRecentPosts(posts){
  const wrap = document.getElementById('profile-posts-list');
  if (!wrap) return;
  if (!posts.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; padding:8px 0;">No posts on the Trading Floor yet.</p>';
    return;
  }
  wrap.innerHTML = posts.map(renderPostCard).join('');
}

function renderProfile(uid, profile, isOwnProfile, postCount){
  const target = document.getElementById('profile-render-target');
  if (!target) return;

  const name = profile.displayName || 'Trader';
  const avatarHtml = (typeof avatarImgHtml === 'function') ? avatarImgHtml(uid, name, profile, 96) : '';
  const plan = (profile.plan && typeof findPlan === 'function') ? findPlan(profile.plan) : null;
  const roleTag = (profile.plan && typeof roleTagHtml === 'function') ? roleTagHtml(profile.plan) : '';
  const joinDate = formatJoinDate(profile.createdAt);

  const earnedBadges = getEarnedProfileBadges(profile);
  const badgesHtml = earnedBadges.length
    ? '<div style="display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-top:22px;">' +
        earnedBadges.map((a) =>
          '<div class="profile-badge-ic" title="' + escapeProfileText(a.title) + ' — ' + escapeProfileText(a.desc) + '" style="color:' + a.color + '; background:' + a.color + '2e; border-color:' + a.color + ';">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' + a.icon + '</svg>' +
          '</div>'
        ).join('') +
      '</div>'
    : '';

  target.innerHTML =
    '<div class="panel" style="overflow:hidden; padding:0;">' +
      '<div style="height:100px; background:' + bannerGradientFor(plan) + ';"></div>' +
      '<div style="text-align:center; padding:0 32px 40px; margin-top:-52px;">' +
        '<div style="display:flex; justify-content:center; margin-bottom:14px;"><div style="border-radius:50%; border:4px solid var(--bg-2); overflow:hidden; line-height:0;">' + avatarHtml + '</div></div>' +
        '<h2 style="font-size:21px; margin-bottom:4px;">' + escapeProfileText(name) + roleTag + '</h2>' +
        (profile.bio ? '<p style="font-size:13.5px; color:var(--ink-1); max-width:420px; margin:0 auto 10px;">' + escapeProfileText(profile.bio) + '</p>' : '') +
        (joinDate ? '<p style="color:var(--ink-3); font-size:12.5px; margin-bottom:24px;">Member since ' + joinDate + '</p>' : '<div style="margin-bottom:24px;"></div>') +
        '<div style="display:flex; justify-content:center; gap:36px; flex-wrap:wrap;">' +
          '<div><b style="display:block; font-family:var(--font-mono); font-size:20px; color:var(--ink-0);">' + (profile.currentStreak || 0) + '</b><span style="font-size:11px; color:var(--ink-3);">Day streak</span></div>' +
          '<div><b style="display:block; font-family:var(--font-mono); font-size:20px; color:var(--ink-0);">' + (profile.bestStreak || 0) + '</b><span style="font-size:11px; color:var(--ink-3);">Best streak</span></div>' +
          '<div><b style="display:block; font-family:var(--font-mono); font-size:20px; color:var(--ink-0);">' + (profile.completedChaptersCount || 0) + '</b><span style="font-size:11px; color:var(--ink-3);">Chapters done</span></div>' +
          '<div><b style="display:block; font-family:var(--font-mono); font-size:20px; color:var(--ink-0);">' + postCount + '</b><span style="font-size:11px; color:var(--ink-3);">Floor posts</span></div>' +
        '</div>' +
        badgesHtml +
        '<div style="display:flex; justify-content:center; gap:10px; margin-top:28px; flex-wrap:wrap;">' +
          (isOwnProfile
            ? '<a href="settings.html" class="btn btn-ghost btn-sm">Edit profile</a>'
            // Only on someone else's profile — a Message button on your own
            // would open a conversation with yourself.
            : '<a href="messages.html?to=' + encodeURIComponent(uid) + '" class="btn btn-primary btn-sm">' +
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
              'stroke-width="2" style="margin-right:6px; vertical-align:-2px;">' +
              '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/>' +
              '</svg>Message</a>') +
          '<button class="btn btn-ghost btn-sm" id="profile-copy-link-btn">Copy profile link</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="panel">' +
      '<div class="panel-head"><h2 style="font-size:15px;">Recent Trading Floor posts</h2></div>' +
      '<div id="profile-posts-list"><p style="color:var(--ink-3); font-size:13.5px;">Loading…</p></div>' +
    '</div>';

  const copyBtn = document.getElementById('profile-copy-link-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const url = window.location.origin + window.location.pathname + '?uid=' + encodeURIComponent(uid);
      navigator.clipboard.writeText(url).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy profile link'; }, 1800);
      }).catch(() => {});
    });
  }
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

    // When viewing your own profile, make sure it actually exists first —
    // this is what was missing before: visiting profile.html as your very
    // first page after this feature shipped found nothing, since nothing
    // on this page triggered the sync that every other page already does
    // via ensureStudentDoc. Other people's profiles can't be self-healed
    // this way (no permission to write someone else's), so those rely on
    // the admin bulk-backfill tool for any pre-existing accounts.
    const readyCheck = isOwnProfile ? ensureStudentDoc(currentUser) : Promise.resolve();

    readyCheck.then(() => {
      const profileCheck = db.collection('profiles').doc(targetUid).get();
      const postsCheck = db.collection('communityPosts').where('authorUid', '==', targetUid).limit(50).get()
        .then((snap) => {
          const posts = [];
          snap.forEach((doc) => posts.push(doc.data()));
          posts.sort((a, b) => {
            const aTime = (a.createdAt && a.createdAt.toMillis) ? a.createdAt.toMillis() : 0;
            const bTime = (b.createdAt && b.createdAt.toMillis) ? b.createdAt.toMillis() : 0;
            return bTime - aTime; // newest first
          });
          return posts;
        })
        .catch((err) => { console.error('Stryker: failed to load posts', err); return []; });

      Promise.all([profileCheck, postsCheck, (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve()])
        .then(([profileDoc, posts]) => {
          if (!profileDoc.exists) { renderProfileNotFound(); return; }
          renderProfile(targetUid, profileDoc.data(), isOwnProfile, posts.length);
          renderRecentPosts(posts.slice(0, PROFILE_RECENT_POSTS_LIMIT));
        })
        .catch((err) => {
          console.error('Stryker: failed to load profile', err);
          renderProfileNotFound();
        });
    }).catch((err) => {
      console.error('Stryker: failed to prepare profile', err);
      renderProfileNotFound();
    });
  });
});
