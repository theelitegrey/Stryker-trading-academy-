// Stryker Trading Academy — header Global Monitor icon
// Depends on: nothing. Pure markup and CSS.
//
// Injected into .topnav-right rather than added to 30-odd pages of markup, the
// same approach as the messages icon and account menu.
//
// A red dot pulses at the centre of the globe and does not go out. It marks the
// monitor as continuously running — a recording light, not an alert about any
// particular event.
//
// The previous version tried to make the dot conditional, lighting only for
// unseen high-severity headlines. That required pulling the 212KB monitor JSON
// on every page load to decide. This version fetches nothing at all: the icon
// costs one inline SVG and a CSS keyframe.

(function () {

  // A live indicator at the centre of the globe. It does not go out — it marks
  // the monitor as continuously running, the way a recording light does, rather
  // than reporting any particular alert.
  //
  // That makes it purely presentational, which is worth noting because the
  // earlier version fetched the 212KB monitor JSON on every page to decide
  // whether to light up. Nothing here fetches anything: the icon costs one SVG
  // and a CSS animation.

  var ICON =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="9"/>' +
      '<path d="M3.2 9.5h17.6M3.2 14.5h17.6"/>' +
      '<path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/>' +
    '</svg>';

  function build() {
    var right = document.querySelector('.topnav-right');
    if (!right || document.getElementById('gm-icon-wrap')) return;

    var wrap = document.createElement('div');
    wrap.className = 'gm-icon-wrap';
    wrap.id = 'gm-icon-wrap';
    wrap.innerHTML =
      '<a href="global-monitor.html" class="icon-btn" aria-label="Global Monitor" ' +
        'title="Global Monitor \u2014 live">' + ICON +
        // Inside the anchor and centred over the globe. aria-hidden because the
        // link already announces itself; a screen reader gains nothing from a
        // decorative pulse and would just hear a second, meaningless element.
        '<span class="gm-live-dot" aria-hidden="true"></span>' +
      '</a>';

    // First in the row: monitor, messages, notifications, account — global to
    // personal.
    right.insertBefore(wrap, right.firstChild);
  }

  document.addEventListener('DOMContentLoaded', build);

})();
