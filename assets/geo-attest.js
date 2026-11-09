// TradeZoro - sanctions attestation (Owner order 09 Nov 2026). Catches citizens and VPN users the edge block can't see.
// Depends on: assets/geo-block-list.js (window.TZGeoBlock), assets/auth.js (auth), assets/progress.js (db).
//
// 1. SIGN-UP (signup.html): a required "Country of residence" picker and a required attestation checkbox sit above
//    BOTH the Google button and the email form; neither path starts until both are answered. Picking a blocked place
//    shows the region message and keeps every sign-up button disabled. The answer is kept in sessionStorage and
//    written to students/{uid} by part 2 on the first page after sign-up.
// 2. EVERY SIGNED-IN PAGE that loads banned-check.js (it injects this file; legal pages excepted): if students/{uid} has no sanctionsAttest,
//    a full-screen dialog the member must answer covers the page (no close button, Escape does nothing). A saved
//    sign-up answer is written silently instead. Saving writes residenceCountry, sanctionsAttest: true and
//    sanctionsAttestAt (server time) ONCE; firestore.rules refuses any later change by the member.
// 3. A blocked residence (picked now, or stored) locks the page with the region message and signs the member out.
//    The real locks are server-side: Cloud Functions refuse checkout / free checkout / coupons for a blocked
//    residence, and the Stripe webhook sets students.sanctionsLocked on a blocked card or billing country.
(function () {
  var G = window.TZGeoBlock;
  if (!G) return;
  var KEY = 'tz_geo_attest';   // sessionStorage: {c: residence code, t: ms} from the sign-up form

  function esc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }

  // ---------- shared markup (sign-up block and the member dialog use the same fields) ----------
  function fieldsHtml(idp) {
    return '<div class="field geo-field">' +
        '<label for="' + idp + '-country">Country of residence</label>' +
        '<select id="' + idp + '-country" required autocomplete="country"></select>' +
      '</div>' +
      '<p class="geo-region-msg" id="' + idp + '-msg" role="alert" hidden>' + esc(G.REGION_MESSAGE) + '</p>' +
      '<label class="geo-attest" for="' + idp + '-attest">' +
        '<input type="checkbox" id="' + idp + '-attest" required>' +
        '<span>' + esc(G.ATTEST_TEXT) + '</span>' +
      '</label>';
  }
  function wire(root, idp, onChange) {
    var sel = root.querySelector('#' + idp + '-country');
    var box = root.querySelector('#' + idp + '-attest');
    var msg = root.querySelector('#' + idp + '-msg');
    G.fillSelect(sel);
    function state() {
      var code = sel.value || '';
      var blocked = !!code && G.isBlockedResidence(code);
      msg.hidden = !blocked;
      sel.setAttribute('aria-invalid', blocked ? 'true' : 'false');
      var ok = !!code && !blocked && box.checked;
      onChange({ code: code, blocked: blocked, ok: ok });
    }
    sel.addEventListener('change', state);
    box.addEventListener('change', state);
    state();
    return { sel: sel, box: box, state: state };
  }

  // ---------- 1. sign-up form ----------
  function setupSignup() {
    var form = document.getElementById('signup-form');
    var box = document.querySelector('.auth-box');
    if (!form || !box || document.getElementById('geo-signup')) return;
    var wrap = document.createElement('div');
    wrap.id = 'geo-signup';
    wrap.className = 'geo-signup';
    wrap.innerHTML = fieldsHtml('geo-su');
    var social = box.querySelector('.social-row');
    box.insertBefore(wrap, social || form);
    var hint = document.createElement('p');
    hint.className = 'geo-hint'; hint.id = 'geo-su-hint';
    hint.textContent = 'Choose your country and tick the box above to continue.';
    box.insertBefore(hint, social || form);
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-google-signin], #signup-form button[type="submit"]'));
    var current = { ok: false };
    wire(wrap, 'geo-su', function (s) {
      current = s;
      buttons.forEach(function (b) { b.disabled = !s.ok; b.setAttribute('aria-disabled', s.ok ? 'false' : 'true'); });
      hint.hidden = s.ok || s.blocked;
      try { if (s.ok) sessionStorage.setItem(KEY, JSON.stringify({ c: s.code, t: Date.now() })); else sessionStorage.removeItem(KEY); } catch (e) { /* storage blocked: the member dialog asks again */ }
    });
    // auth.js re-enables buttons in its finally(); stop a sign-up that slips past (capture phase runs first).
    function guard(e) {
      if (current.ok) return;
      e.preventDefault(); e.stopImmediatePropagation();
      hint.hidden = current.blocked;
      (current.code ? wrap.querySelector('#geo-su-attest') : wrap.querySelector('#geo-su-country')).focus();
    }
    form.addEventListener('submit', guard, true);
    document.querySelectorAll('[data-google-signin]').forEach(function (b) { b.addEventListener('click', guard, true); });
  }

  // ---------- 2/3. signed-in pages ----------
  function lockPage() {
    try {
      document.documentElement.innerHTML =
        '<head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not available in your region - TradeZoro</title></head>' +
        '<body class="geo-locked-body"><main class="geo-card" role="main">' +
        '<p class="geo-brand">TradeZoro</p><h1>Not available in your region</h1><p class="geo-msg">' + esc(G.REGION_MESSAGE) + '</p>' +
        '</main></body>';
      var st = document.createElement('style');
      st.textContent = 'body.geo-locked-body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#050506;color:rgba(255,255,255,.92);font:400 15px/22px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif}' +
        '.geo-card{width:100%;max-width:440px;background:#0b0b0d;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:32px 24px}' +
        '.geo-brand{margin:0 0 8px;font-size:13px;line-height:18px;font-weight:500;color:rgba(255,255,255,.44)}.geo-card h1{margin:0 0 12px;font-size:22px;line-height:28px;font-weight:700}.geo-msg{margin:0;color:rgba(255,255,255,.64)}' +
        '@media (prefers-color-scheme: light){body.geo-locked-body{background:#f5f5f7;color:#1d1d1f}.geo-card{background:#fff;border-color:rgba(0,0,0,.08)}.geo-brand{color:rgba(0,0,0,.5)}.geo-msg{color:rgba(0,0,0,.64)}}';
      document.head.appendChild(st);
    } catch (e) { /* sign-out below regardless */ }
    if (typeof auth !== 'undefined' && auth) auth.signOut().catch(function () {});
  }

  function save(uid, code) {
    return db.collection('students').doc(uid).set({
      residenceCountry: code,
      sanctionsAttest: true,
      sanctionsAttestAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  function showDialog(uid) {
    if (document.getElementById('geo-gate')) return;
    var ov = document.createElement('div');
    ov.id = 'geo-gate';
    ov.className = 'geo-gate';
    ov.innerHTML = '<div class="geo-gate-card" role="dialog" aria-modal="true" aria-labelledby="geo-gate-title" aria-describedby="geo-gate-desc">' +
      '<h2 id="geo-gate-title">Confirm your country</h2>' +
      '<p id="geo-gate-desc" class="geo-gate-sub">We need this once before you continue. TradeZoro is a US company and US rules decide where we can offer our services.</p>' +
      fieldsHtml('geo-gt') +
      '<p class="geo-gate-err" id="geo-gt-err" role="alert" hidden></p>' +
      '<button type="button" class="btn btn-primary btn-block" id="geo-gt-save" disabled>Continue</button>' +
      '<p class="geo-gate-legal">See <a href="/terms#restricted-regions">Restricted regions</a> in our Terms.</p>' +
      '</div>';
    document.body.appendChild(ov);
    document.documentElement.classList.add('geo-gate-open');
    var btn = ov.querySelector('#geo-gt-save');
    var err = ov.querySelector('#geo-gt-err');
    var cur = { ok: false };
    var w = wire(ov, 'geo-gt', function (s) { cur = s; btn.disabled = !(s.ok || s.blocked); btn.textContent = s.blocked ? 'Confirm' : 'Continue'; });
    // Keep focus inside the dialog; Escape does nothing (the member must answer).
    ov.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(ov.querySelectorAll('select, input, button, a[href]'), function (x) { return !x.disabled; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    btn.addEventListener('click', function () {
      if (cur.blocked) {
        // A blocked answer is stored too (attest stays absent): the server then refuses every purchase for this account.
        db.collection('students').doc(uid).set({ residenceCountry: cur.code }, { merge: true }).catch(function () {}).then(lockPage);
        return;
      }
      if (!cur.ok) return;
      btn.disabled = true; err.hidden = true;
      save(uid, cur.code).then(function () {
        ov.remove(); document.documentElement.classList.remove('geo-gate-open');
      }).catch(function (e) {
        btn.disabled = false;
        err.textContent = 'We couldn\'t save that. Check your connection and try again.';
        err.hidden = false;
        console.warn('TradeZoro: attestation not saved', e && e.code);
      });
    });
    setTimeout(function () { w.sel.focus(); }, 50);
  }

  function checkMember(user) {
    if (typeof db === 'undefined' || !db) return;
    var ref = db.collection('students').doc(user.uid);
    var tries = 0;
    (function look() {
      ref.get().then(function (snap) {
        // A brand-new account: ensureStudentDoc (progress.js) is still creating the doc. Wait for it.
        if (!snap.exists) { if (++tries < 8) setTimeout(look, 750); return; }
        var d = snap.data() || {};
        if (d.sanctionsLocked === true || G.isBlockedResidence(d.residenceCountry)) { lockPage(); return; }
        if (d.sanctionsAttest === true && d.residenceCountry) return;
        var saved = null;
        try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
        if (saved && saved.c && !G.isBlockedResidence(saved.c) && Date.now() - saved.t < 3600 * 1000) {
          save(user.uid, saved.c).then(function () { try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } })
            .catch(function () { showDialog(user.uid); });
          return;
        }
        showDialog(user.uid);
      }).catch(function (e) {
        // Fail open on a read error: the server-side checks are the real boundary.
        console.warn('TradeZoro: attestation check failed', e && e.code);
      });
    })();
  }

  function start() {
    if (document.getElementById('signup-form')) setupSignup();
    if (/^\/(login|signup)(\.html)?$/.test(location.pathname)) return;   // the sign-in pages route away first
    if (typeof auth === 'undefined' || !auth) return;
    var done = false;
    auth.onAuthStateChanged(function (user) { if (!user || done) return; done = true; checkMember(user); });
  }
  // Loaded by a plain tag (signup.html) or injected by banned-check.js, which can land after DOMContentLoaded.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.TZGeoAttest = { checkMember: checkMember, showDialog: showDialog, lockPage: lockPage };
})();
