/* Stryker Trading Academy — homepage hero chart, "story loop".
   Loaded by index.html (after home-motion.js). Depends on: assets/home-hero-b.css. Drives the 4-state loop
   (GEX -> Volume Profile -> ICT -> Confluence). The progress bar is a CSS
   animation; its animationend advances the loop, so pausing is just
   animation-play-state. Off-screen / hidden tab = paused. Reduced motion =
   the finished confluence chart, no loop. */
(function () {
  var card = document.querySelector('.cb-card');
  if (!card) return;
  var steps = [].slice.call(card.querySelectorAll('.cb-step'));
  var caps = [].slice.call(card.querySelectorAll('.cb-cap p'));
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cur = -1, onScreen = true;

  function show(s) {
    cur = s;
    card.setAttribute('data-s', s);
    steps.forEach(function (b, i) {
      b.classList.toggle('is-done', i < s);
      b.classList.toggle('is-on', i === s);
      b.setAttribute('aria-selected', i === s ? 'true' : 'false');
      // restart the fill animation on the active tab
      if (i === s) { var f = b.querySelector('i'); f.style.animation = 'none'; void f.offsetWidth; f.style.animation = ''; }
    });
    caps.forEach(function (p, i) { p.classList.toggle('is-on', i === s); });
  }

  function syncPause() { card.classList.toggle('cb-paused', !onScreen || document.hidden); }

  steps.forEach(function (b, i) {
    b.addEventListener('click', function () { show(i); });
    if (!reduce) b.querySelector('i').addEventListener('animationend', function () {
      if (i === cur) show((cur + 1) % steps.length);
    });
  });

  if (reduce) { show(3); return; }

  // The HTML ships the finished chart (data-s=3) so no-JS still shows it;
  // with JS we clear it and tell the story from the start.
  card.setAttribute('data-s', '-1');
  caps.forEach(function (p) { p.classList.remove('is-on'); });
  card.classList.add('cb-ready');
  // Start the story the first time the card is seen (it sits below the fold
  // on phones), after the candles have built.
  var started = false;
  function start() { if (started) return; started = true; card.classList.add('cb-go'); setTimeout(function () { if (cur < 0) show(0); }, 900); }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      onScreen = es[0].isIntersecting; syncPause();
      if (onScreen && !document.hidden) start();
    }, { threshold: 0.15 }).observe(card);
  } else start();
  document.addEventListener('visibilitychange', syncPause);
})();
