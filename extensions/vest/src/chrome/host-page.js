// Chrome/Edge (page side, MAIN world): the host asks the extension's isolated bridge for levels. The levels link is never in this page.
(function () {
  'use strict';
  var ORIGIN = location.origin, seq = 0, wait = {};
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window || e.origin !== ORIGIN || !d || d.zv !== 'res' || !wait[d.id]) return;
    var w = wait[d.id]; delete wait[d.id]; clearTimeout(w.t); w.ok(d.body || {});
  });
  function ask(body) {
    return new Promise(function (ok) {
      var id = 'zv' + (++seq) + Math.random().toString(36).slice(2, 8);
      wait[id] = { ok: ok, t: setTimeout(function () { delete wait[id]; ok({ status: 'error', error: 'The extension did not answer. Reload the page.' }); }, 20000) };
      window.postMessage({ zv: 'req', id: id, body: body }, ORIGIN);
    });
  }
  var host = {
    levels: function (u) { return ask({ op: 'levels', u: u }); },
    setLink: function (secret) { return ask({ op: 'setLink', secret: secret }); },
  };
  globalThis.ZV_boot(window, host, globalThis.ZV_ASSETS);
})();
