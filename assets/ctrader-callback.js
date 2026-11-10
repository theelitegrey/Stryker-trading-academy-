// TradeZoro — cTrader sign-in return page (/connect/ctrader/callback). DATA ONLY, view-only (scope=accounts).
// Flow: strip the code from the URL at once, check the single-use state (same signed-in user, under 10 min), swap the code
// through /connect/ctrader/token, list the accounts over the relay, let the member pick one if there are several, keep the
// tokens + chosen account in the device vault, go back to /charts (fixed address; never taken from the URL).
(function () {
  var q = new URLSearchParams(location.search);
  var code = q.get('code'), state = q.get('state'), denied = q.get('error');
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  var h = document.getElementById('ct-h'), p = document.getElementById('ct-p'), a = document.getElementById('ct-a');
  function end(title, text) { h.textContent = title; p.textContent = text; a.hidden = false; }   // textContent only: nothing from the URL is ever shown
  if (denied || !code || !state) return end('cTrader was not connected', 'You can try again from Data source in the charts.');
  function user() {
    return new Promise(function (res) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; res(null); } }, 10000);
      try { firebase.auth().onAuthStateChanged(function (u) { if (done || !u) return; done = true; clearTimeout(t); res(u); }); } catch (e) { clearTimeout(t); res(null); }
    });
  }
  function pick(list) {   // several accounts: one big button each (login number and broker only)
    return new Promise(function (res) {
      h.textContent = 'Choose your cTrader account'; p.textContent = 'Which account should the charts use?';
      var box = document.createElement('div'); box.style.cssText = 'display:grid;gap:8px;margin:0 0 24px';
      list.forEach(function (x) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-secondary'; b.style.cssText = 'min-height:48px;text-align:left';
        b.textContent = (x.login ? '#' + x.login : 'Account') + (x.broker ? ' · ' + x.broker : '') + (x.isLive ? ' · Live' : ' · Demo');
        b.addEventListener('click', function () { box.remove(); h.textContent = 'Connecting cTrader…'; p.textContent = 'One moment.'; res(x); });
        box.appendChild(b);
      });
      p.after(box);
    });
  }
  user().then(function (u) {
    if (!u) return end('Sign in first', 'Sign in to TradeZoro, then connect cTrader again.');
    return Promise.all([import('./byo-core.js?v=953'), import('./byo-ctrader.js?v=953')]).then(function (m) {
      var c = m[0], ct = m[1];
      var rec = ct.takeCtraderState(state, u.uid);
      if (!rec) return end('cTrader was not connected', 'The sign-in link expired. Start again from Data source in the charts.');
      return u.getIdToken().then(function (idt) { return ct.ctraderTokenCall({ grant: 'code', code: code }, idt); })
        .then(function (j) {
          var creds = ct.ctraderCreds(j);
          return ct.listAccounts(creds).then(function (list) {
            if (!list.length) return end('No cTrader account found', 'This cTrader ID has no trading account to read prices from.');
            return (list.length === 1 ? Promise.resolve(list[0]) : pick(list)).then(function (x) {
              creds.accountId = x.id; creds.isLive = x.isLive;
              return c.bindUser(u.uid).then(function () { return c.saveSource('ctrader', creds, undefined, true); }).then(function () { location.replace('/charts'); });
            });
          });
        });
    });
  }).catch(function () { end('cTrader was not connected', 'Something went wrong. Try again from Data source in the charts.'); });
})();
