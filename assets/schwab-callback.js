// TradeZoro — Schwab sign-in return page (/connect/schwab/callback). DATA ONLY.
// Depends on: Firebase auth (loaded by the page), assets/byo-core.js. Flow: strip the code from the URL at once, check the
// single-use state (same signed-in user, under 10 min), swap the code through /connect/schwab/token, keep the tokens in the
// device vault, go back to /charts (fixed address; never taken from the URL).
(function () {
  var q = new URLSearchParams(location.search);
  var code = q.get('code'), state = q.get('state'), denied = q.get('error');
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  var h = document.getElementById('sc-h'), p = document.getElementById('sc-p'), a = document.getElementById('sc-a');
  function end(title, text) { h.textContent = title; p.textContent = text; a.hidden = false; }   // textContent only: nothing from the URL is ever shown
  if (denied || !code || !state) return end('Schwab was not connected', 'You can try again from Data source in the charts.');
  function user() {
    return new Promise(function (res) {
      var done = false, off = null;
      var t = setTimeout(function () { if (!done) { done = true; res(null); } }, 10000);
      try { off = firebase.auth().onAuthStateChanged(function (u) { if (done || !u) return; done = true; clearTimeout(t); res(u); }); } catch (e) { clearTimeout(t); res(null); }
    });
  }
  user().then(function (u) {
    if (!u) return end('Sign in first', 'Sign in to TradeZoro, then connect Schwab again.');
    return import('./byo-core.js?v=969').then(function (c) {
      var rec = c.takeSchwabState(state, u.uid);
      if (!rec) return end('Schwab was not connected', 'The sign-in link expired. Start again from Data source in the charts.');
      return u.getIdToken().then(function (idt) {
        var body = { grant: 'code', code: code };
        if (rec.verifier) body.verifier = rec.verifier;
        return c.schwabTokenCall(body, idt);
      }).then(function (j) { return c.bindUser(u.uid).then(function () { return c.saveSchwab(j); }); })
        .then(function () { location.replace('/charts'); });
    });
  }).catch(function () { end('Schwab was not connected', 'Something went wrong. Try again from Data source in the charts.'); });
})();
