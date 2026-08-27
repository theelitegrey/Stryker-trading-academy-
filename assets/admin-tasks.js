// Stryker Trading Academy — shared admin task sources
// Depends on: assets/progress.js (db)
//
// Single definition of "work waiting on an admin", used by two consumers:
//   - admin-todo.js   : the "Needs your attention" panel on the dashboard
//   - admin-notify.js : the notification bell, on every admin page
//
// Split out because the same list was about to be written twice. Two copies
// drift: a source added to one shows up in the panel but never in the bell,
// and the two disagree about how much is outstanding — which is worse than
// either being wrong on its own, because it makes both untrustworthy.
//
// These are QUERIES, not stored task records. See admin-todo.js for why.

var ADMIN_TASK_SOURCES = [
  {
    key: 'moderation',
    link: 'moderation-admin.html',
    notifType: 'moderation_review',
    icon: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>',
    tone: 'urgent',
    load: function () {
      return db.collection('communityPosts').where('hidden', '==', true).get()
        .then(function (snap) { return snap.size; });
    },
    label: function (n) {
      return n + (n === 1 ? ' flagged post needs review' : ' flagged posts need review');
    },
    sub: 'A moderator hid these pending your decision.'
  },
  {
    key: 'tradingview',
    link: 'indicators-admin.html',
    notifType: 'tv_access_granted',
    icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    tone: 'normal',
    load: function () {
      return db.collection('students').get().then(function (snap) {
        var n = 0;
        snap.forEach(function (d) {
          var s = d.data();
          if (s.tradingViewUsername && !s.tradingViewAccessGranted) n++;
        });
        return n;
      });
    },
    label: function (n) {
      return n + (n === 1 ? ' TradingView username awaiting approval' : ' TradingView usernames awaiting approval');
    },
    sub: 'Students cannot load the indicators until these are granted.'
  },
  {
    key: 'contact',
    link: 'support-admin.html',
    notifType: 'contact_message',
    icon: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
    tone: 'normal',
    load: function () {
      return db.collection('contactMessages').where('status', '==', 'new').get()
        .then(function (snap) { return snap.size; });
    },
    label: function (n) {
      return n + (n === 1 ? ' unread contact message' : ' unread contact messages');
    },
    sub: 'Sent through the public contact form.'
  },
  {
    // Unread notifications are work too. Without this the bell could read "1"
    // while the queue said "All clear" — the two measuring different things
    // and quietly contradicting each other, which makes both untrustworthy.
    // Opens the bell rather than navigating, since there is no standalone
    // notifications page.
    key: 'notifications',
    link: '#notifications',
    opensBell: true,
    icon: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    tone: 'normal',
    load: function () {
      if (typeof auth === 'undefined' || !auth || !auth.currentUser) return Promise.resolve(0);
      return db.collection('notifications')
        .where('recipientUid', '==', auth.currentUser.uid)
        .where('read', '==', false)
        .limit(50).get()
        .then(function (snap) { return snap.size; });
    },
    label: function (n) {
      return n + (n === 1 ? ' unread notification' : ' unread notifications');
    },
    sub: 'Open the bell to read them.'
  }
];

// Resolves every source in parallel. A source that fails reports 0 rather
// than rejecting, so one broken query degrades a single line instead of
// blanking the whole queue.
function loadAdminTaskCounts(){
  if (typeof db === 'undefined' || !db) return Promise.resolve([]);
  return Promise.all(ADMIN_TASK_SOURCES.map(function (src) {
    return src.load()
      .then(function (count) {
        return { key: src.key, count: count, src: src };
      })
      .catch(function (err) {
        console.error('Stryker: admin task source failed: ' + src.key, err);
        return { key: src.key, count: 0, src: src };
      });
  }));
}

// Dismissals are keyed by source and store the count at the time. A task is
// hidden only while that count still matches, so new items bring it back.
function loadAdminTaskDismissals(){
  if (typeof db === 'undefined' || !db) return Promise.resolve({});
  return db.collection('adminTaskDismissals').get()
    .then(function (snap) {
      var map = {};
      snap.forEach(function (d) { map[d.id] = d.data(); });
      return map;
    })
    .catch(function () { return {}; });
}

function adminTaskIsVisible(task, dismissals){
  if (!task.count) return false;
  var d = dismissals[task.key];
  return !d || d.signature !== task.count;
}
