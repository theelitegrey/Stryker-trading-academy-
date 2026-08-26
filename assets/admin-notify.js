// Stryker Trading Academy — admin tasks in the notification bell
// Depends on: assets/admin-tasks.js, assets/notifications.js, assets/auth.js
//
// The action queue only existed on the dashboard, so an admin working in
// Chapters or Coupons had no idea a post had been flagged until they happened
// to navigate home. The bell is on every admin page, so outstanding work is
// pinned to the top of it and the badge counts it.
//
// These are NOT written into the notifications collection. A notification
// document is a record of a moment; a pending task is a live state. Writing
// one per flagged post would mean chasing them to mark read once handled, and
// three admins would each need their own copy of the same fact. Reading the
// current state instead means the bell can never claim work that is already
// done.
//
// Ordinary notifications still come from Firestore as before — this prepends
// to them rather than replacing them.

(function () {

  function esc(s){
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function render(tasks, dismissals){
    var list = document.getElementById('notif-list');
    if (!list) return;

    // The 'notifications' source exists so the dashboard queue can't say
    // "All clear" while the bell shows a count. Inside the bell itself it
    // would be circular — a row telling you about the panel you are reading —
    // and the badge already counts unread, so including it would double.
    var visible = tasks.filter(function (t) {
      return t.key !== 'notifications' && adminTaskIsVisible(t, dismissals);
    });

    var existing = document.getElementById('notif-task-block');
    if (existing) existing.remove();
    if (!visible.length) return;

    var block = document.createElement('div');
    block.id = 'notif-task-block';
    block.innerHTML =
      '<div class="notif-task-head">Waiting on you</div>' +
      visible.map(function (t) {
        return '<a href="' + t.src.link + '" class="notif-item notif-task">' +
          '<span class="notif-item-icon' + (t.src.tone === 'urgent' ? ' urgent' : '') + '">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.9">' + t.src.icon + '</svg></span>' +
          '<div class="notif-item-body">' +
            '<span class="notif-item-msg">' + esc(t.src.label(t.count)) + '</span>' +
            '<span class="notif-item-time">Tap to open</span>' +
          '</div>' +
        '</a>';
      }).join('');

    // Prepended: outstanding work outranks a read receipt from last week.
    list.insertBefore(block, list.firstChild);

    // Fold the task count into the badge. notifications.js owns the unread
    // number, so this reads what it wrote rather than replacing it — otherwise
    // whichever ran last would win and the other's count would vanish.
    var badge = document.getElementById('notif-badge');
    if (badge) {
      var unread = parseInt(badge.textContent, 10);
      if (isNaN(unread)) unread = 0;
      var total = unread + visible.length;
      badge.textContent = total > 9 ? '9+' : String(total);
      badge.style.display = total ? 'flex' : 'none';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('notif-list')) return;
    if (typeof loadAdminTaskCounts !== 'function') return;
    if (typeof auth === 'undefined' || !auth) return;

    var run = false;
    auth.onAuthStateChanged(function (user) {
      if (run || !user) return;
      run = true;

      // Only admins can read these collections at all, so a non-admin would
      // just log permission errors. Check first.
      db.collection('admins').doc(user.uid).get()
        .then(function (doc) {
          if (!doc.exists) return null;
          return Promise.all([loadAdminTaskCounts(), loadAdminTaskDismissals()])
            .then(function (res) {
              // notifications.js fills the panel on its own schedule; a short
              // delay lets it finish so this prepends to a populated list
              // rather than one that is about to be overwritten.
              setTimeout(function () { render(res[0], res[1]); }, 600);
            });
        })
        .catch(function (err) {
          console.warn('Stryker: admin task notifications unavailable', err);
        });
    });
  });

})();
