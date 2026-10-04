/* Home hero, variation A ("Layered"). Preview only.
   Toggles the three chart lenses (GEX / Volume Profile / ICT), runs the
   staged intro once, and pauses the small loops off-screen or in a hidden
   tab. Reduced motion: no intro, finished chart at once. No libraries. */
(function () {
  'use strict';
  var card = document.getElementById('ca-card');
  if (!card) return;

  var lenses = ['gex', 'vp', 'ict'];
  var pills = card.querySelectorAll('.ca-pill');
  lenses.forEach(function (l) { card.classList.add('on-' + l); });

  Array.prototype.forEach.call(pills, function (btn) {
    btn.addEventListener('click', function () {
      var lens = btn.getAttribute('data-lens');
      var on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      card.classList.toggle('on-' + lens, on);
      // A toggle during the intro should show the layer finished, not stuck
      // at its pre-animation state.
      if (card.classList.contains('ca-anim') && !card.classList.contains('ca-done')) finish();
    });
  });

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var visible = true;

  function setPaused() {
    card.classList.toggle('ca-paused', !visible || document.hidden);
  }
  function finish() {
    card.classList.remove('ca-anim', 'ca-go');
    card.classList.add('ca-done');
  }

  if (!reduce) {
    card.classList.add('ca-anim');
    var started = false;
    var start = function () {
      if (started) return;
      started = true;
      requestAnimationFrame(function () {
        card.classList.add('ca-go');
        // after the last keyframe (confluence pop ends ~6.8s) drop the intro
        // classes so the chart sits in its plain finished state.
        setTimeout(finish, 7000);
      });
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          visible = e.isIntersecting;
          if (visible) start();
          setPaused();
        });
      }, { threshold: 0.15 }).observe(card);
    } else {
      start();
    }
    document.addEventListener('visibilitychange', setPaused);
  }
})();
