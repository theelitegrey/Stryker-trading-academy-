// Stryker Trading Academy — app-style public header (nav.appnav + appnav-dock)
//
// Desktop: icon+label pills in a rounded rail with a solid gold capsule that
// slides behind the active one. Mobile (<=820px): the pills fold away and a
// five-icon bottom dock takes over; the top bar keeps brand + bell + profile.
//
// The bell shows the signed-in student's unread notification count (a single
// read, not a live listener — these are marketing pages, the full live bell
// lives in the app shell) and routes to the dashboard where the real bell is.
// Signed out, both bell and profile route to login.

(function(){

  // Which pill/dock item is "current" for this page. Pages outside this map
  // (about, legal, support…) simply show no active state.
  function activeKey(){
    var f = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (f === '' || f === 'index.html') return location.hash === '#platform' ? 'platform' : 'home';
    if (f === 'courses.html' || f === 'chapter.html') return 'curriculum';
    if (f === 'indicators.html' || f === 'indicator.html') return 'indicators';
    if (f === 'trading-floor.html') return 'floor';
    return null;
  }

  function moveCapsule(){
    var cap = document.getElementById('appnav-capsule');
    var on = document.querySelector('.appnav-pill.on');
    if (!cap) return;
    if (!on || getComputedStyle(on.parentElement).display === 'none') { cap.style.opacity = '0'; return; }
    cap.style.opacity = '1';
    cap.style.left = on.offsetLeft + 'px';
    cap.style.width = on.offsetWidth + 'px';
  }

  function setActive(key){
    document.querySelectorAll('.appnav-pill, .appnav-dk').forEach(function(el){
      el.classList.toggle('on', el.dataset.nav === key);
    });
    moveCapsule();
  }

  document.addEventListener('DOMContentLoaded', function(){
    if (!document.querySelector('.appnav')) return;

    setActive(activeKey());
    // capsule position depends on fonts/logo having laid out
    window.addEventListener('resize', moveCapsule, { passive: true });
    window.addEventListener('load', moveCapsule);
    setTimeout(moveCapsule, 300);

    // same-page anchors (Home ↔ Platform on index) retarget the capsule
    // without a reload
    window.addEventListener('hashchange', function(){ setActive(activeKey()); });

    // the fixed dock needs breathing room at the page bottom while visible
    if (document.getElementById('appnav-dock')) {
      document.body.classList.add('has-appdock');
    }

    // auth wiring — degrade to guest links when firebase never initialised
    if (typeof auth === 'undefined' || !auth) return;
    auth.onAuthStateChanged(function(user){
      var bell = document.getElementById('appnav-bell');
      var prof = document.getElementById('appnav-profile');
      var badge = document.getElementById('appnav-bell-badge');
      if (!user) {
        if (bell) bell.href = 'login.html';
        if (prof) prof.href = 'login.html';
        if (badge) badge.style.display = 'none';
        return;
      }
      if (bell) bell.href = 'dashboard-user.html';
      if (prof) prof.href = 'profile.html';
      if (badge && typeof db !== 'undefined' && db) {
        db.collection('notifications')
          .where('recipientUid', '==', user.uid)
          .where('read', '==', false)
          .limit(10).get()
          .then(function(snap){
            var n = snap.size;
            if (n > 0) { badge.textContent = n > 9 ? '9+' : String(n); badge.style.display = 'flex'; }
            else { badge.style.display = 'none'; }
          })
          .catch(function(){ /* badge stays hidden */ });
      }
    });
  });

})();
