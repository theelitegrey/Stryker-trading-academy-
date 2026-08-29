// Stryker Trading Academy — app-style nav (pill rail + mobile dock)
//
// Desktop: icon+label pills in a rounded rail with a solid gold capsule that
// slides behind the active one. Mobile (<=820px): the pills fold away and a
// five-icon bottom dock takes over; the top bar keeps brand + bell + profile.
//
// The nav must survive page loads, so this file is deliberately loaded at the
// TOP of <body>, immediately after the dock markup and long before the
// firebase bundles — it paints the dock and the current-page highlight from
// localStorage in the first milliseconds, then wires up the auth-dependent
// parts (bell count, sign-out) whenever the firebase globals turn up.

(function(){

  var STORE = 'stryker_nav_authed';

  function storedAuthed(){
    try { return localStorage.getItem(STORE) === '1'; } catch(e) { return false; }
  }

  // The class goes on <html> as well as <body>: <html> exists before anything
  // else, so the dock is visible on the very first paint instead of waiting
  // for scripts at the end of the document.
  function setAuthedClass(on){
    [document.documentElement, document.body].forEach(function(el){
      if (el) el.classList.toggle('nav-authed', on);
    });
  }

  if (storedAuthed()) setAuthedClass(true);

  // Which pill/dock item is "current" for this page. Pages are served both as
  // /courses.html and (on Cloudflare Pages) as /courses, so the extension is
  // stripped before matching — otherwise the highlight silently disappears on
  // the live domain. Pages outside this map show no active state.
  function activeKey(){
    var segs = location.pathname.split('/').filter(Boolean);
    var f = (segs.length ? segs[segs.length - 1] : 'index').toLowerCase().replace(/\.html$/, '');
    if (f === 'index' || f === 'dashboard-user') return 'home';
    if (f === 'courses' || f === 'chapter') return 'learn';
    if (f === 'trade-journal') return 'journal';
    if (f === 'global-monitor') return 'monitor';
    if (f === 'trading-floor') return 'floor';
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

  function paint(){ setActive(activeKey()); }

  var wired = false;
  function wire(){
    if (wired || !document.querySelector('.appnav-pills, .appnav-dock')) return;
    wired = true;

    // capsule position depends on fonts/logo having laid out
    window.addEventListener('resize', moveCapsule, { passive: true });
    window.addEventListener('load', moveCapsule);
    setTimeout(moveCapsule, 300);

    // same-page anchors (Home <-> Platform on index) retarget the capsule
    window.addEventListener('hashchange', paint);

    // Coming back via the bfcache re-runs neither DOMContentLoaded nor the
    // auth listener, so re-assert the highlight there too.
    window.addEventListener('pageshow', paint);

    // Feedback on tap: light the pressed item instantly, before navigation.
    document.querySelectorAll('.appnav-dk, .appnav-pill').forEach(function(el){
      el.addEventListener('click', function(){ setActive(el.dataset.nav); });
    });
  }

  // Auth gating: the app nav (pills + bell/profile + dock) only renders for
  // signed-in users — guests keep the classic marketing nav. `auth` is defined
  // by assets/auth.js far below this script, so wait for it rather than
  // bailing out on the first look.
  function wireAuth(tries){
    tries = tries || 0;
    if (typeof auth === 'undefined' || !auth) {
      if (tries < 120) setTimeout(function(){ wireAuth(tries + 1); }, 150);
      return;
    }
    auth.onAuthStateChanged(function(user){
      var bell = document.getElementById('appnav-bell');
      var prof = document.getElementById('appnav-profile');
      var badge = document.getElementById('appnav-bell-badge');
      if (!user) {
        setAuthedClass(false);
        try { localStorage.removeItem(STORE); } catch(e) {}
        if (badge) badge.style.display = 'none';
        return;
      }
      setAuthedClass(true);
      try { localStorage.setItem(STORE, '1'); } catch(e) {}
      // pills may have just become visible — the capsule can only measure now
      paint();
      requestAnimationFrame(moveCapsule);
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
  }

  // Immediately (dock markup sits directly above this script) …
  if (storedAuthed()) setAuthedClass(true);
  paint();
  wire();

  // … and again once the rest of the document — the desktop pill rail lives in
  // the header — has been parsed.
  document.addEventListener('DOMContentLoaded', function(){
    if (storedAuthed()) setAuthedClass(true);
    paint();
    wire();
    wireAuth();
  });

})();
