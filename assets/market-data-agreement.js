// TradeZoro — Market Data Agreement (Owner order 2026-11-01). Classic script, global window.StkMDA.
// Depends on: firebase (compat) + assets/progress.js (db) + assets/auth.js (auth).
// Used by checkout.js (before LiveData payment) and by ZoroCharts (one-time modal for members already live by approval).
// The SERVER (acceptMarketDataAgreement in functions-src/marketData.js) validates and writes; this file only asks.
// StkMDA.VERSION mirrors AGREEMENT_VERSION there (tools/tests/market-data-terms.test.js checks they match).
(function () {
  var VERSION = 'v1', TERMS = 'market-data-terms';
  var Q = [
    ['regulated', 'Are you registered or licensed with any securities or futures regulator (for example SEC, CFTC, NFA, FCA, SEBI)?'],
    ['business', 'Do you use market data for a business, firm or employer, or for anyone other than yourself?'],
    ['advisor', 'Are you an investment adviser, or do you trade or manage money for others?'],
    ['redistribute', 'Do you redistribute or publish market data?']
  ];
  var css = '.mda{--mda-line:var(--line,#2c2c32);color:var(--ink-1,#c9c9cf);font-size:14px;line-height:1.5}' +
    '.mda h3{margin:0 0 4px;font-size:16px;color:var(--ink-0,#eee)}.mda .mda-sub{margin:0 0 14px;font-size:13px;color:var(--ink-2,#8b93a0)}' +
    '.mda-q{padding:12px 0;border-top:1px solid var(--mda-line)}.mda-q p{margin:0 0 8px;font-size:13.5px}' +
    '.mda-yn{display:flex;gap:8px}.mda-yn label{flex:1;position:relative;margin:0}' +
    '.mda-yn input{position:absolute;opacity:0;inset:0;width:100%;height:100%;margin:0;cursor:pointer}' +
    '.mda-yn span{display:flex;align-items:center;justify-content:center;min-height:44px;border:1px solid var(--mda-line);border-radius:10px;font-weight:600;font-size:14px;color:var(--ink-1,#c9c9cf);background:var(--bg-2,#131316)}' +
    '.mda-yn input:checked+span{border-color:var(--teal,#00adb5);color:var(--ink-0,#eee);background:rgba(0,173,181,.14)}' +
    '.mda-yn input:focus-visible+span{outline:2px solid var(--teal,#00adb5);outline-offset:2px}' +
    '.mda-pro{margin:12px 0 0;padding:12px 14px;border:1px solid rgba(245,166,35,.5);border-radius:10px;background:rgba(245,166,35,.1);font-size:13.5px;color:var(--ink-0,#eee)}' +
    '.mda-pro a{color:var(--teal,#00adb5);text-decoration:underline}' +
    '.mda-box{margin:14px 0;padding:12px 14px;border:1px solid var(--mda-line);border-radius:10px;background:var(--bg-2,#131316);font-size:13px;color:var(--ink-2,#8b93a0)}' +
    '.mda-box ul{margin:6px 0 8px;padding-left:18px}.mda-box a,.mda-note a{color:var(--teal,#00adb5);text-decoration:underline}' +
    '.mda-chk{display:flex;gap:12px;align-items:flex-start;min-height:44px;padding:6px 0;font-size:13.5px;color:var(--ink-0,#eee);cursor:pointer}' +
    '.mda-chk input{flex:0 0 22px;width:22px;height:22px;margin:1px 0 0}' +
    '.mda label.mda-nm{display:block;margin:10px 0 6px;font-size:13px;color:var(--ink-1,#c9c9cf)}' +
    '.mda input.mda-name{width:100%;box-sizing:border-box;min-height:48px;padding:0 14px;border:1px solid var(--mda-line);border-radius:10px;background:var(--bg-2,#131316);color:var(--ink-0,#eee);font-size:16px}' +
    '.mda-btn{width:100%;min-height:48px;margin-top:14px}.mda-err{margin:10px 0 0;color:#f08488;font-size:13px}' +
    '.mda-ok{margin:0;font-size:12.5px;color:var(--ink-2,#8b93a0)}.mda-note{margin:8px 0 0;font-size:12px;line-height:1.5;color:var(--ink-3,#6b7280)}' +
    '.mda-scrim{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.mda-dlg{width:100%;max-width:460px;max-height:92vh;overflow-y:auto;box-sizing:border-box;padding:20px;border:1px solid var(--line,#2c2c32);border-radius:16px;background:var(--bg-1,#0b0b0d);position:relative;scrollbar-width:thin}' +
    '.mda-x{position:absolute;top:6px;right:6px;width:44px;height:44px;border:0;background:transparent;color:var(--ink-2,#8b93a0);font-size:26px;cursor:pointer}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function fmtDate(t) {
    try { var d = t && t.toDate ? t.toDate() : (t && t.seconds ? new Date(t.seconds * 1000) : null); return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''; } catch (e) { return ''; }
  }
  function accepted(student) { var a = student && student.marketDataAgreement; return !!a && a.version === VERSION && a.nonProfessional === true; }
  function note() { return 'Market data is provided as is and may be delayed or inaccurate. Personal, non-commercial use only. <a href="/' + TERMS + '">Terms</a>'; }

  // Builds the form inside host. onDone() runs after the server saved it.
  function form(host, onDone) {
    var h = '<div class="mda"><h3>Market data agreement</h3><p class="mda-sub">Answer these so we know you are a non-professional user.</p>';
    Q.forEach(function (q, i) {
      h += '<div class="mda-q"><p id="mda-q' + i + '">' + esc(q[1]) + '</p><div class="mda-yn" role="radiogroup" aria-labelledby="mda-q' + i + '">' +
        '<label><input type="radio" name="mda-' + q[0] + '" value="no"><span>No</span></label>' +
        '<label><input type="radio" name="mda-' + q[0] + '" value="yes"><span>Yes</span></label></div></div>';
    });
    h += '<div class="mda-pro" role="alert" hidden>Professional data isn\'t sold online. <a href="help.html#new-ticket">Contact support</a> (Help, New support ticket) and we will help you.</div>' +
      '<div class="mda-box"><b style="color:var(--ink-0,#eee)">In short</b><ul><li>Personal, non-commercial use only. Do not share, resell or redistribute the data, or share your login.</li>' +
      '<li>Data comes from third parties and exchanges, as is. It may be delayed, interrupted or wrong, with no uptime promise.</li>' +
      '<li>Not investment advice. Trading futures carries a risk of loss. We and our data providers are not liable for losses from data errors or outages.</li>' +
      '<li>We may suspend access for misuse or if a provider or exchange requires it.</li></ul><a href="/' + TERMS + '" target="_blank" rel="noopener">Read the full Market Data Terms</a></div>' +
      '<label class="mda-chk"><input type="checkbox" class="mda-c"><span>I confirm I\'m a non-professional user and I agree to the Market Data Terms</span></label>' +
      '<label class="mda-nm" for="mda-name-f">Type your full name as your signature</label>' +
      '<input class="mda-name" type="text" autocomplete="name" maxlength="100" placeholder="Full name">' +
      '<div class="mda-err" role="alert" hidden></div><button type="button" class="btn btn-primary mda-btn" disabled>Accept and continue</button></div>';
    host.innerHTML = h;
    var root = host.querySelector('.mda'), pro = root.querySelector('.mda-pro'), chk = root.querySelector('.mda-c'),
      nm = root.querySelector('.mda-name'), btn = root.querySelector('.mda-btn'), err = root.querySelector('.mda-err');
    nm.id = 'mda-name-f';
    function answers() {
      var a = {}, all = true, anyYes = false;
      Q.forEach(function (q) { var r = root.querySelector('input[name="mda-' + q[0] + '"]:checked'); if (!r) { all = false; return; } a[q[0]] = r.value === 'yes'; if (r.value === 'yes') anyYes = true; });
      return { a: a, all: all, yes: anyYes };
    }
    function sync() {
      var r = answers(); pro.hidden = !r.yes;
      btn.disabled = !(r.all && !r.yes && chk.checked && nm.value.trim().length >= 2);
    }
    root.addEventListener('change', sync); nm.addEventListener('input', sync);
    btn.addEventListener('click', function () {
      var r = answers(); if (btn.disabled) return;
      var fns = null; try { fns = firebase.app().functions(); } catch (e) {}
      err.hidden = true; btn.disabled = true; btn.textContent = 'Saving…';
      if (!fns) { err.textContent = 'Could not save right now. Please try again.'; err.hidden = false; btn.textContent = 'Accept and continue'; btn.disabled = false; return; }
      fns.httpsCallable('acceptMarketDataAgreement')({ name: nm.value.trim(), answers: r.a, confirmed: true }).then(function () {
        if (onDone) onDone();
      }).catch(function (e) {
        err.textContent = (e && e.message) || 'Could not save. Please try again.'; err.hidden = false;
        btn.textContent = 'Accept and continue'; sync();
      });
    });
    return root;
  }

  // One-time modal over ZoroCharts. Closing it just hides it; it comes back next visit.
  function modal(onDone) {
    var scrim = document.createElement('div'); scrim.className = 'mda-scrim';
    var dlg = document.createElement('div'); dlg.className = 'mda-dlg'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true');
    var x = document.createElement('button'); x.type = 'button'; x.className = 'mda-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '\u00d7';
    var body = document.createElement('div'); dlg.appendChild(x); dlg.appendChild(body); scrim.appendChild(dlg); document.body.appendChild(scrim);
    var close = function () { scrim.remove(); document.removeEventListener('keydown', key); };
    var key = function (e) { if (e.key === 'Escape') close(); };
    x.addEventListener('click', close); scrim.addEventListener('click', function (e) { if (e.target === scrim) close(); });
    document.addEventListener('keydown', key);
    form(body, function () { close(); if (onDone) onDone(); });
  }

  // Members already live by Owner approval / grandfathering who have not accepted the current version.
  function autoPrompt() {
    if (typeof auth === 'undefined' || typeof db === 'undefined') return;
    var un = auth.onAuthStateChanged(function (u) {
      if (!u) return; un();
      db.collection('students').doc(u.uid).get().then(function (d) {
        var s = d.exists ? d.data() : {};
        if (s.liveFeed === true && !accepted(s)) setTimeout(function () { modal(); }, 1500);
      }).catch(function () {});
    });
  }

  window.StkMDA = { VERSION: VERSION, form: form, modal: modal, accepted: accepted, fmtDate: fmtDate, note: note, autoPrompt: autoPrompt };
  var me = document.currentScript; if (me && me.dataset.mdaAuto) autoPrompt();
})();
