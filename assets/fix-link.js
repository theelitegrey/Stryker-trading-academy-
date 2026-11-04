// /fix-link: validates a pasted Firebase email-action link and reopens it on tradezoro.com
// (which proxies /__/auth/*). Never logs or sends the code anywhere but that redirect.
(function (root) {
  var HOSTS = ['strykertrades-e0cd8.firebaseapp.com', 'strykertrades-e0cd8.web.app', 'tradezoro.com', 'www.tradezoro.com'];
  var MODES = ['verifyEmail', 'resetPassword', 'recoverEmail', 'verifyAndChangeEmail'];
  var API_KEY = 'AIzaSyC8nqRVQ7wpuplYygZObKgNx2ojj5ZwbSQ'; // public web key, same as assets/auth.js

  // Returns the tradezoro.com URL to open, or null if the link is not acceptable.
  function fixLink(text) {
    var u;
    try { u = new URL(String(text || '').trim()); } catch (e) { return null; }
    if (u.protocol !== 'https:' || HOSTS.indexOf(u.hostname) === -1) return null;
    if (u.pathname !== '/__/auth/action') return null;
    var q = u.searchParams;
    if (MODES.indexOf(q.get('mode')) === -1 || !q.get('oobCode') || q.get('apiKey') !== API_KEY) return null;
    return 'https://tradezoro.com/__/auth/action' + u.search;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { fixLink: fixLink };
  if (!root.document) return;
  var form = root.document.getElementById('fl-form');
  if (!form) return;
  var box = root.document.getElementById('fl-input');
  var err = root.document.getElementById('fl-error');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var to = fixLink(box.value);
    if (!to) {
      err.hidden = false;
      box.setAttribute('aria-invalid', 'true');
      return;
    }
    root.location.assign(to);
  });
  box.addEventListener('input', function () { err.hidden = true; box.removeAttribute('aria-invalid'); });
})(typeof window !== 'undefined' ? window : globalThis);
