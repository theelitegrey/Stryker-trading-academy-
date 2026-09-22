// Stryker Trading Academy — keyboard focus mode
//
// Puts the class "kbd" on <html> while someone is moving around the page
// with the keyboard, and takes it off the moment they press a mouse button,
// touch the screen or use a pen. style.css scopes the focus ring on text
// fields to :root.kbd, because browsers count a clicked text field as
// :focus-visible and the ring would otherwise appear on every mouse click.
//
// Loaded on every page, next to version-check.js. No dependencies; if it
// fails to load, fields keep their existing :focus styling and nothing breaks.
(function () {
  var root = document.documentElement;
  var NAV = { Tab: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
              Home: 1, End: 1, PageUp: 1, PageDown: 1, Enter: 1, ' ': 1, Escape: 1 };
  document.addEventListener('keydown', function (e) {
    if (NAV[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey) root.classList.add('kbd');
  }, true);
  document.addEventListener('pointerdown', function () {
    root.classList.remove('kbd');
  }, true);
})();
