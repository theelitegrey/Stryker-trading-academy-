// Stryker Trading Academy — notification system
// Depends on: assets/progress.js (`db`, `auth`), assets/avatars.js is NOT
// required here. assets/achievements-data.js (ACHIEVEMENTS array) is only
// needed by checkAndNotifyNewAchievements — pages that call it must load
// that file too.
//
// In-app only for now — no browser/mobile push yet, per instruction.
// Notifications live in a dedicated `notifications` collection rather than
// as a subcollection of students, since creating one is inherently an
// action taken by someone OTHER than the recipient (liking someone else's
// post, an admin granting access) — see the Firestore rule this needs.

// Achievements that need the full CHAPTERS array to evaluate (which
// specific chapters belong to which level) — skipped in any calling
// context that doesn't have chapters data loaded, rather than treated as
// "not earned." They'll get picked up on a later call where chapters IS
// available (e.g. achievements.html itself).
const NOTIF_NEEDS_CHAPTERS = ['foundations', 'structure-master', 'smt-certified', 'curriculum-complete'];

function createNotification(recipientUid, type, message, link){
  if (!recipientUid || typeof db === 'undefined' || !db) return Promise.resolve();
  return db.collection('notifications').add({
    recipientUid: recipientUid,
    type: type,
    message: message,
    link: link || null,
    read: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch((err) => console.error('Stryker: failed to create notification', err));
}

// Compares currently-earned achievements against what's already been
// notified about (students/{uid}.notifiedAchievements), notifies for any
// newly-earned ones, and records them so the same badge never notifies
// twice. `chapters` is optional — omit it in contexts where chapters data
// isn't loaded; the four level-specific badges just won't be checked yet.
// `extra` (also optional) carries stats that live outside the base student
// fields — postCount, replyCount, likesReceived, journalCount,
// hasWinningTrade — supplied by whichever caller actually has them.
function checkAndNotifyNewAchievements(uid, student, chapters, extra){
  if (typeof ACHIEVEMENTS === 'undefined') return Promise.resolve();
  const s = {
    completedChapters: student.completedChapters || [],
    completedLessons: student.completedLessons || [],
    bestStreak: student.bestStreak || 0,
    referralPoints: student.referralPoints || 0,
    bio: student.bio || '',
    customPhotoURL: student.customPhotoURL || null,
    avatarSeed: student.avatarSeed || null,
    plan: student.plan || null,
    tradingViewAccessGranted: !!student.tradingViewAccessGranted
  };
  const alreadyNotified = new Set(student.notifiedAchievements || []);
  const newlyEarned = ACHIEVEMENTS.filter((a) => {
    if (alreadyNotified.has(a.id)) return false;
    if (NOTIF_NEEDS_CHAPTERS.includes(a.id) && !chapters) return false;
    return a.check(s, chapters || [], extra);
  });

  if (!newlyEarned.length) return Promise.resolve();

  const notifyWrites = newlyEarned.map((a) =>
    createNotification(uid, 'achievement', 'Achievement unlocked: ' + a.title, 'achievements.html')
  );
  const updatedNotified = Array.from(alreadyNotified).concat(newlyEarned.map((a) => a.id));

  return Promise.all(notifyWrites).then(() =>
    db.collection('students').doc(uid).set({ notifiedAchievements: updatedNotified }, { merge: true })
  ).catch((err) => console.error('Stryker: failed to record notified achievements', err));
}

// General-purpose entry point — fetches fresh student data and the extra
// counters itself, so callers (a like, a reply, a post) just need a uid
// rather than reconstructing the whole stats object every time. Chapter-
// dependent badges aren't checked here (this doesn't load chapters data) —
// those are covered separately by reader.js and achievements.html, which
// already have that data loaded for other reasons.
//
// isSelf matters here: this function sometimes runs against the CALLER's
// own uid (after their own post/reply/referral) and sometimes against
// someone else's (after THEY receive a like — the liker's session is what
// triggers the recheck for the post author). The full multi-field profile
// sync below is only safe for the self case; a cross-user write can only
// touch the one field the Firestore rules specifically allow for that
// (floorLikesReceived), or it'll be rejected. Pass isSelf: false for any
// caller acting on someone else's uid.
function checkAndNotifyNewAchievementsFor(uid, isSelf){
  if (typeof db === 'undefined' || !db) return Promise.resolve();
  return db.collection('students').doc(uid).get().then((doc) => {
    if (!doc.exists) return;
    const student = doc.data();
    const extra = {
      postCount: student.floorPostCount || 0,
      replyCount: student.floorReplyCount || 0,
      likesReceived: student.floorLikesReceived || 0,
      journalCount: student.journalEntryCount || 0,
      hasWinningTrade: !!student.hasWinningTrade
    };
    // Piggyback the public-profile sync on this same fetch, rather than
    // adding syncPublicProfile calls at every individual counter-update
    // site — this function already re-fetches fresh student data after
    // every post/reply/like/referral/TV-grant, so it's the natural single
    // place to keep these specific fields current. Journal-related fields
    // are deliberately never synced here — they stay private, per the
    // reasoning in achievements-data.js's file header.
    //
    // The self case can sync all five fields at once (writing your own
    // profile doc, no restriction). The cross-user case (someone else's
    // uid, after they received a like) can only touch floorLikesReceived —
    // that's the one field the Firestore rules specifically allow a
    // non-owner to update, matching the same narrow exception on the
    // students/{uid} rule that the counter increment itself relies on.
    if (typeof syncPublicProfile === 'function') {
      if (isSelf) {
        syncPublicProfile(uid, {
          floorPostCount: extra.postCount,
          floorReplyCount: extra.replyCount,
          floorLikesReceived: extra.likesReceived,
          referralPoints: student.referralPoints || 0,
          tradingViewAccessGranted: !!student.tradingViewAccessGranted
        });
      } else {
        syncPublicProfile(uid, { floorLikesReceived: extra.likesReceived });
      }
    }
    return checkAndNotifyNewAchievements(uid, student, null, extra);
  }).catch((err) => console.error('Stryker: failed to check achievements', err));
}

function timeAgoShort(date){
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const NOTIF_ICONS = {
  like: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.6z"/></svg>',
  reply: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  tv_access_granted: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  achievement: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>',
  post_moderated: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M12 8v4"/><path d="M12 16v.01"/></svg>',
  moderation_review: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/></svg>',
  post_restored: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
  post_removed: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  referral_signup: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
  referral_conversion: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  contact_message: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>'
};

function renderNotifBellUI(){
  const btn = document.getElementById('notif-bell-btn');
  const panel = document.getElementById('notif-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = panel.style.display === 'block';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) markAllNotificationsRead();
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== btn) panel.style.display = 'none';
  });
}

let NOTIF_UNSUB = null;
let NOTIF_UID = null;

function escapeNotifText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderNotifList(docs){
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (!docs.length) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13px; padding:20px 16px; text-align:center;">No notifications yet.</p>';
    return;
  }
  list.innerHTML = docs.map((doc) => {
    const n = doc.data();
    const when = n.createdAt && n.createdAt.toDate ? timeAgoShort(n.createdAt.toDate()) : '';
    const icon = NOTIF_ICONS[n.type] || NOTIF_ICONS.achievement;
    const href = escapeNotifText(n.link || '#');
    // Message is escaped rather than trusted as HTML: moderation reasons
    // are free text typed by a moderator or admin, so an unescaped render
    // here would be a stored XSS vector against whoever opens the panel.
    return (
      '<a href="' + href + '" class="notif-item' + (n.read ? '' : ' unread') + '">' +
        '<span class="notif-item-icon">' + icon + '</span>' +
        '<span class="notif-item-body"><span class="notif-item-msg">' + escapeNotifText(n.message) + '</span><span class="notif-item-time">' + when + '</span></span>' +
      '</a>'
    );
  }).join('');
}

function updateNotifBadge(unreadCount){
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function markAllNotificationsRead(){
  if (!NOTIF_UID || typeof db === 'undefined' || !db) return;
  db.collection('notifications').where('recipientUid', '==', NOTIF_UID).where('read', '==', false).limit(50).get()
    .then((snap) => {
      if (snap.empty) return;
      const batch = db.batch();
      snap.forEach((doc) => batch.update(doc.ref, { read: true }));
      return batch.commit();
    })
    .catch((err) => console.error('Stryker: failed to mark notifications read', err));
}

// Real-time — a notification bell that only updates on the next page load
// defeats the point of a live badge count. This is a deliberate, narrow
// exception to the rest of this codebase's load-once-per-page-visit
// pattern, justified by what this specific feature actually needs to feel
// right.
function initNotificationBell(uid){
  NOTIF_UID = uid;
  if (typeof db === 'undefined' || !db) return;
  if (NOTIF_UNSUB) NOTIF_UNSUB();

  NOTIF_UNSUB = db.collection('notifications').where('recipientUid', '==', uid).limit(30)
    .onSnapshot((snap) => {
      const docs = snap.docs.slice().sort((a, b) => {
        const aTime = (a.data().createdAt && a.data().createdAt.toMillis) ? a.data().createdAt.toMillis() : 0;
        const bTime = (b.data().createdAt && b.data().createdAt.toMillis) ? b.data().createdAt.toMillis() : 0;
        return bTime - aTime;
      });
      const unread = docs.filter((d) => !d.data().read).length;
      updateNotifBadge(unread);
      renderNotifList(docs);
    }, (err) => console.error('Stryker: notification listener failed', err));
}

document.addEventListener('DOMContentLoaded', () => {
  renderNotifBellUI();
  if (!auth) return;
  // Only start the real-time listener where the bell UI actually exists —
  // chapter.html and similar reader pages load this file just for
  // createNotification/checkAndNotifyNewAchievements (the write side),
  // not the bell itself, so there's nothing for a listener to update there.
  if (!document.getElementById('notif-bell-btn')) return;
  auth.onAuthStateChanged((user) => {
    if (user) initNotificationBell(user.uid);
  });
});
