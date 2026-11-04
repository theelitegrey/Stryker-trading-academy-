// Theme toggle for the demo page (same stryker_theme key as the rest of the site).
(function () {
  var b = document.getElementById('ra-theme'); if (!b) return;
  b.addEventListener('click', function () {
    var root = document.documentElement, light = root.getAttribute('data-theme') === 'light';
    if (light) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', 'light');
    try { localStorage.setItem('stryker_theme', light ? 'night' : 'day'); } catch (e) {}
  });
})();
