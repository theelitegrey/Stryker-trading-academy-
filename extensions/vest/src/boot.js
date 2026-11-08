// Zoro for Vest: start-up inside Vest's page. Hooks go in at document_start (before Vest's own code runs) so the panel sees the
// session; the panel mounts once the page has a body. `host` gives levels (and saving the levels link) without exposing the link here.
(function (root) {
  'use strict';
  root.ZV_boot = function (win, host, assets) {
    if (win.__zoroForVest) return win.__zoroForVest;
    var E = new root.ZV_Engine(win, {});
    var L = new root.ZV_Levels(win, host, function () { if (ui) ui.refresh(); }, function (sym) { return E.marks[sym]; });
    var ui = null;
    var go = function () {
      if (ui || !win.document.body) return;
      ui = new root.ZV_UI(win, E, L, host, assets);
      ui.mount();
      E.start();
    };
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', go); else go();
    win.__zoroForVest = { version: root.ZV_VERSION };   // nothing reachable from here: no engine, no tokens
    return win.__zoroForVest;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
