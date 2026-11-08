// Chrome/Edge (isolated content script): passes two kinds of request from the panel to the extension and back.
// It accepts messages only from this same tab and origin, and only these two operations.
(function () {
  'use strict';
  var ORIGIN = location.origin;
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window || e.origin !== ORIGIN || !d || d.zv !== 'req' || typeof d.id !== 'string' || d.id.length > 40 || !d.body) return;
    var b = d.body, msg;
    if (b.op === 'levels' && typeof b.u === 'string' && b.u.length < 8) msg = { op: 'levels', u: b.u };
    else if (b.op === 'setLink' && (b.secret === null || (typeof b.secret === 'string' && /^[A-Za-z0-9_-]{43}$/.test(b.secret)))) msg = { op: 'setLink', secret: b.secret };
    else return;
    chrome.runtime.sendMessage(msg, function (res) {
      var body = chrome.runtime.lastError ? { status: 'error', error: 'Extension error. Reload the page.' } : res || {};
      window.postMessage({ zv: 'res', id: d.id, body: body }, ORIGIN);
    });
  });
})();
