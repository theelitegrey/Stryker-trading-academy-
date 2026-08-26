// Stryker Trading Academy — header messages icon
// Depends on: assets/messages.js, assets/auth.js, assets/progress.js
//
// Injected rather than added to 33 pages of markup, for the same reason as the
// account menu: one source, and the badge needs live data.
//
// The count comes from a LISTENER, not a page-load fetch. A badge that only
// updates on refresh would leave someone staring at a stale zero while a
// message sat waiting — and since it reads the same conversation documents the
// messages page already watches, the marginal cost is a single extra
// subscription rather than repeated polling.

(function () {

  var ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7' +
    'A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/></svg>';

  function build(){
    var right = document.querySelector('.topnav-right');
    if (!right || document.getElementById('msg-icon-wrap')) return null;

    var wrap = document.createElement('div');
    wrap.className = 'msg-icon-wrap';
    wrap.id = 'msg-icon-wrap';
    wrap.innerHTML =
      '<a href="messages.html" class="icon-btn" aria-label="Messages" title="Messages">' + ICON + '</a>' +
      '<span class="msg-icon-badge" id="msg-icon-badge"></span>';

    // Ahead of the bell, so the header reads messages, notifications, account
    // — most specific to least.
    var bell = right.querySelector('.notif-bell-wrap');
    if (bell) right.insertBefore(wrap, bell);
    else right.insertBefore(wrap, right.firstChild);
    return wrap;
  }

  function setCount(n){
    var badge = document.getElementById('msg-icon-badge');
    if (!badge) return;
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('.topnav-right')) return;
    if (typeof auth === 'undefined' || !auth) return;

    var started = false;
    auth.onAuthStateChanged(function (user) {
      if (started || !user) return;
      started = true;

      if (!build()) return;

      db.collection('conversations')
        .where('participants', 'array-contains', user.uid)
        .onSnapshot(function (snap) {
          var total = 0;
          snap.forEach(function (d) {
            total += (d.data().unread || {})[user.uid] || 0;
          });
          setCount(total);
        }, function (err) {
          // Silent: an unreadable badge is not worth an error toast on every
          // page, and the messages page itself reports properly.
          console.warn('Stryker: unread message count unavailable', err);
        });
    });
  });

})();
