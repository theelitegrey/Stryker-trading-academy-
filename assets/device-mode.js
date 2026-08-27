// Stryker Trading Academy — device detection for forced views
//
// Loaded synchronously in <head>, before first paint, so the layout never
// flashes from one mode to another. Stamps <html data-device="mobile|
// tablet|desktop">, which assets/style.css uses to FORCE the right shell
// for the physical device instead of trusting viewport width alone:
//
//   - a phone held in landscape reports >900px and used to get the squeezed
//     desktop sidebar; it now keeps the mobile drawer shell.
//   - a tablet in portrait reports <900px and used to get the phone drawer;
//     it now keeps a visible sidebar.
//
// Detection order matters: explicit mobile UAs first, then tablet UAs
// (including iPadOS, which reports itself as a Mac but has multi-touch),
// then a touch-screen heuristic to catch phones running in "Desktop site"
// mode with a spoofed UA. Touch-screen laptops fall through to desktop
// because their PRIMARY pointer is still fine (mouse/trackpad).

(function () {
  var ua = navigator.userAgent || '';
  var touchPoints = navigator.maxTouchPoints || 0;
  var coarsePrimary = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  var iPadOS = /Macintosh/.test(ua) && touchPoints > 1;

  var device;
  if (/iPhone|iPod|Windows Phone|BlackBerry|Opera Mini/i.test(ua) ||
      (/Android/i.test(ua) && /Mobile/i.test(ua))) {
    device = 'mobile';
  } else if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || iPadOS ||
      (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    device = 'tablet';
  } else if (coarsePrimary) {
    // Touch-first device wearing a desktop UA ("Desktop site" checkbox).
    // The shorter screen edge separates phones from tablets well enough.
    var shortEdge = Math.min(window.screen.width || 0, window.screen.height || 0);
    device = shortEdge && shortEdge < 620 ? 'mobile' : 'tablet';
  } else {
    device = 'desktop';
  }

  document.documentElement.setAttribute('data-device', device);
})();
