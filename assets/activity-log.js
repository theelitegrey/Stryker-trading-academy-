// Stryker Trading Academy — activity logging
// Depends on: assets/auth.js (auth), assets/progress.js (db)
//
// One helper, logActivity(), called from every place that changes state.
// Writes to activityLog/{autoId}.
//
// DESIGN NOTES
//
// Fire-and-forget. A logging failure must never break or even slow the action
// being logged — every call swallows its own errors and nothing awaits it.
// A missing log line is a far smaller problem than a student unable to post
// because the audit write was rejected.
//
// The actor is taken from auth.currentUser, never from an argument. A caller
// cannot claim to be someone else, and there's no way to forget to pass it.
//
// Role is resolved once per page load and cached. Working it out per call
// would mean two Firestore reads on every logged action.
//
// Free text (post excerpts, moderation reasons, names) is stored raw and
// ESCAPED AT RENDER TIME in logs-admin.js. Storing pre-escaped text would
// corrupt it for any other consumer and double-escape on display.

var STRYKER_ACTOR_ROLE = null;      // 'admin' | 'moderator' | 'student'
var STRYKER_ACTOR_ROLE_PROMISE = null;

function resolveActorRole(uid){
  if (STRYKER_ACTOR_ROLE) return Promise.resolve(STRYKER_ACTOR_ROLE);
  if (STRYKER_ACTOR_ROLE_PROMISE) return STRYKER_ACTOR_ROLE_PROMISE;

  STRYKER_ACTOR_ROLE_PROMISE = Promise.all([
    db.collection('admins').doc(uid).get().catch(function(){ return { exists: false }; }),
    db.collection('moderators').doc(uid).get().catch(function(){ return { exists: false }; })
  ]).then(function (res) {
    STRYKER_ACTOR_ROLE = res[0].exists ? 'admin' : (res[1].exists ? 'moderator' : 'student');
    return STRYKER_ACTOR_ROLE;
  }).catch(function () {
    STRYKER_ACTOR_ROLE = 'student';
    return STRYKER_ACTOR_ROLE;
  });

  return STRYKER_ACTOR_ROLE_PROMISE;
}

// action  — short stable machine key, e.g. 'student.plan_changed'. Used by the
//           filter dropdown, so keep the vocabulary small and consistent.
// summary — one human sentence shown in the log table.
// meta    — optional extras (targetUid, targetName, before/after values).
function logActivity(action, summary, meta){
  try {
    if (typeof db === 'undefined' || !db) return Promise.resolve();
    if (typeof auth === 'undefined' || !auth || !auth.currentUser) return Promise.resolve();

    var user = auth.currentUser;

    return resolveActorRole(user.uid).then(function (role) {
      var entry = {
        actorUid: user.uid,
        actorName: user.displayName || (user.email ? user.email.split('@')[0] : 'Unknown'),
        actorEmail: user.email || null,
        actorRole: role,
        action: action,
        summary: summary || action,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (meta && typeof meta === 'object') {
        if (meta.targetUid) entry.targetUid = meta.targetUid;
        if (meta.targetName) entry.targetName = meta.targetName;
        if (meta.detail) entry.detail = meta.detail;
      }
      return db.collection('activityLog').add(entry);
    }).catch(function (err) {
      console.warn('Stryker: activity log write failed', err);
    });
  } catch (err) {
    console.warn('Stryker: activity log threw', err);
    return Promise.resolve();
  }
}

// Use this instead of logActivity() when the very next thing that happens is
// a page navigation.
//
// logActivity() is fire-and-forget by design, which is right almost
// everywhere — but it means the write is still in flight when the browser
// tears the page down, so it never reaches Firestore. That is exactly why
// "Logged out" appeared in the log while "Logged in" and "Created an account"
// never did: the sign-out path happened to await its write, the sign-in paths
// did not, and the redirect fired 400ms later.
//
// Awaiting alone would be a bad trade: a slow or failed log would leave
// someone staring at a login screen that appears to have done nothing. So the
// wait is capped — after the timeout the navigation proceeds regardless and
// the log entry is simply lost, which is the correct priority.
function logActivityBeforeNavigating(action, summary, meta, maxWaitMs){
  var write = logActivity(action, summary, meta);
  if (!write || typeof write.then !== 'function') return Promise.resolve();
  return Promise.race([
    write,
    new Promise(function (resolve) { setTimeout(resolve, maxWaitMs || 1500); })
  ]).catch(function () { /* never block navigation on a logging failure */ });
}

// Every action key the app writes, with the label shown in the admin filter.
// Kept here so the writers and the viewer can't drift apart.
var ACTIVITY_ACTIONS = {
  'auth.signup':              'Signed up',
  'auth.login':               'Logged in',
  'auth.logout':              'Logged out',
  'auth.email_verified':      'Confirmed email',
  'student.plan_changed':     'Plan changed',
  'student.deleted':          'User deleted',
  'student.admin_granted':    'Admin granted',
  'student.admin_revoked':    'Admin revoked',
  'student.moderator_granted':'Moderator granted',
  'student.moderator_revoked':'Moderator revoked',
  'student.profiles_backfill':'Profiles backfilled',
  'post.created':             'Post created',
  'post.edited':              'Post edited',
  'post.deleted':             'Post deleted',
  'reply.created':            'Reply posted',
  'reply.deleted':            'Reply deleted',
  'post.flagged':             'Post flagged',
  'post.restored':            'Post restored',
  'post.removed':             'Post removed',
  'content.chapter_saved':    'Chapter saved',
  'content.chapter_deleted':  'Chapter deleted',
  'content.model_saved':      'Model saved',
  'content.model_deleted':    'Model deleted',
  'content.indicator_saved':  'Indicator saved',
  'content.indicator_deleted':'Indicator deleted',
  'content.page_saved':       'Site page saved',
  'commerce.order_created':   'Order placed',
  'commerce.order_updated':   'Order updated',
  'commerce.coupon_saved':    'Coupon saved',
  'commerce.coupon_deleted':  'Coupon deleted',
  'commerce.plan_saved':      'Plan saved',
  'settings.updated':         'Settings updated',
  'settings.access_updated':  'Page access updated',
  'settings.appearance':      'Appearance updated',
  'log.purged':               'Log purged',
  'admin.task_added':         'Task added',
  'admin.task_done':          'Task completed'
};
