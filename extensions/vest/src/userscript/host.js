// Tampermonkey host: the levels link lives in Tampermonkey's own storage (GM_setValue), the request goes out through
// GM_xmlhttpRequest to tradezoro.com only (@connect). Vest's page never sees the link.
(function () {
  'use strict';
  var C = globalThis.ZV_CORE;
  var W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  function get(url) {
    return new Promise(function (ok) {
      GM_xmlhttpRequest({ method: 'GET', url: url, anonymous: true, timeout: 15000, headers: { Accept: 'application/json' },
        onload: function (r) { ok(r); }, onerror: function () { ok({ status: 0 }); }, ontimeout: function () { ok({ status: 0 }); } });
    });
  }
  var host = {
    levels: function (u) {
      var secret = GM_getValue('lvSecret', null);
      if (!secret) return Promise.resolve({ status: 'nolink', hasLink: false });
      var url = C.levelsUrl(secret, u);
      if (!url) return Promise.resolve({ status: 'error', error: 'No levels for this market.', hasLink: true });
      return get(url).then(function (r) {
        if (r.status === 404) return { status: 'inactive', hasLink: true };
        if (r.status === 429) return { status: 'error', error: 'Too many levels requests. Try again in a minute.', hasLink: true };
        if (r.status !== 200) return { status: 'error', error: r.status ? 'Levels feed answered ' + r.status + '.' : 'Levels could not be loaded.', hasLink: true };
        try { return { status: 'ok', json: JSON.parse(r.responseText), hasLink: true }; } catch (e) { return { status: 'error', error: 'Levels answer was not readable.', hasLink: true }; }
      });
    },
    setLink: function (secret) {
      if (secret && !/^[A-Za-z0-9_-]{43}$/.test(secret)) return Promise.resolve({ status: 'error' });
      if (secret) GM_setValue('lvSecret', secret); else GM_deleteValue('lvSecret');
      return Promise.resolve({ status: 'ok' });
    },
  };
  globalThis.ZV_boot(W, host, globalThis.ZV_ASSETS);
})();
