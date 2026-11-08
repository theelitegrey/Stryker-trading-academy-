// TradeZoro — sign-in return page for Alpaca and tastytrade (/connect/<id>/callback). DATA ONLY, read-only scopes.
// Flow: strip the code from the URL at once, check the single-use state (same signed-in user, under 10 min), swap the code through
// /connect/<id>/token, test the token with a harmless market-data call, keep the tokens in the device vault, go back to /charts
// (fixed address; never taken from the URL).
(function () {
  var m = /^\/connect\/(alpaca|tastytrade|upstox|fyers|dhan)\/callback\/?$/.exec(location.pathname), id = m && m[1];
  var q = new URLSearchParams(location.search);
  var code = id === 'fyers' ? q.get('auth_code') : id === 'dhan' ? q.get('tokenId') : q.get('code'),   // Fyers sends code=200 and the real one as auth_code
       state = q.get('state'), denied = q.get('error');
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  var h = document.getElementById('oa-h'), p = document.getElementById('oa-p'), a = document.getElementById('oa-a');
  function end(title, text) { h.textContent = title; p.textContent = text; a.hidden = false; }   // textContent only: nothing from the URL is ever shown
  var NAME = { alpaca: 'Alpaca', tastytrade: 'tastytrade', upstox: 'Upstox', fyers: 'Fyers', dhan: 'Dhan' }[id] || 'Your data source';
  if (!id || denied || !code || (!state && id !== 'dhan')) return end(NAME + ' was not connected', 'You can try again from Data source in the charts.');
  h.textContent = 'Connecting ' + NAME + '…';
  function user() {
    return new Promise(function (res) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; res(null); } }, 10000);
      try { firebase.auth().onAuthStateChanged(function (u) { if (done || !u) return; done = true; clearTimeout(t); res(u); }); } catch (e) { clearTimeout(t); res(null); }
    });
  }
  user().then(function (u) {
    if (!u) return end('Sign in first', 'Sign in to TradeZoro, then connect ' + NAME + ' again.');
    return Promise.all([import('./byo-core.js?v=919'), import('./byo-oauth.js?v=919'), import('./byo-tastytrade.js?v=919'), import('./byo-india.js?v=919'), import('./byo-dhan.js?v=919')]).then(function (mm) {
      var c = mm[0], oa = mm[1];
      if (id === 'dhan') {   // tokenId back from Dhan. Own-key mode (keys in the device vault) first; else the partner one-tap. Same user + 10-minute window.
        var dh = mm[4];
        return c.bindUser(u.uid).then(function () { return c.loadKeys('dhan-key'); }).then(function (keys) {
          return u.getIdToken().then(function (idt) { return keys ? dh.dhanKeyFinish(code, keys, u.uid, idt) : dh.dhanFinish(code, u.uid, idt); });
        }).then(function (creds) { return c.ADAPTERS.dhan.check(creds).then(function () { return c.saveSource('dhan', creds, undefined, true); }); })
          .then(function () { location.replace('/charts'); });
      }
      var rec = oa.takeOauthState(id, state, u.uid);
      if (!rec) return end(NAME + ' was not connected', 'The sign-in link expired. Start again from Data source in the charts.');
      return u.getIdToken().then(function (idt) { return oa.oauthTokenCall(id, { grant: 'code', code: code }, idt); })
        .then(function (j) {
          var creds = oa.oauthCreds(id, j);
          return (id === 'fyers' ? oa.probeOauth(id).then(function (cid) { if (!cid) throw new Error('no app id'); creds.appId = cid; }) : Promise.resolve())   // Fyers sends app_id:token on every call
            .then(function () { return c.bindUser(u.uid); }).then(function () { return c.ADAPTERS[id].check(creds); })
            .then(function () { return c.saveSource(id, creds, undefined, true); })
            .then(function () { location.replace('/charts'); });
        });
    });
  }).catch(function () { end(NAME + ' was not connected', 'Something went wrong. Try again from Data source in the charts.'); });
})();
