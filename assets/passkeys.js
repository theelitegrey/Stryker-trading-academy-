// TradeZoro passkeys (WebAuthn) client. Server: functions/api/passkey/[[path]].js
// Used by: login.html (sign in), settings.html (manage), dashboard-user.html (one-time offer).
// window.TZPasskeys = { supported, signIn, conditional, list, add, rename, remove, offerDue, offerSnooze }
(function () {
  'use strict';
  var API = '/api/passkey';
  var supported = !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  var abortCond = null;

  function b64uToBuf(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), o = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o.buffer; }
  function bufToB64u(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

  function fail(msg, code) { var e = new Error(msg); e.pk = true; e.code = code; return e; }
  function api(method, path, body, withAuth) {
    var go = function (tok) {
      var h = { 'content-type': 'application/json' };
      if (tok) h.authorization = 'Bearer ' + tok;
      return fetch(API + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, credentials: 'omit' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw fail(j.error || 'Something went wrong. Please try again.', j.code); return j; }); });
    };
    if (!withAuth) return go(null);
    var u = (typeof auth !== "undefined" && auth) ? auth.currentUser : null;
    if (!u) return Promise.reject(fail('Please sign in first'));
    return u.getIdToken().then(go);
  }

  function decodeCreate(o) {
    o.challenge = b64uToBuf(o.challenge); o.user.id = b64uToBuf(o.user.id);
    o.excludeCredentials = (o.excludeCredentials || []).map(function (c) { return { type: c.type, id: b64uToBuf(c.id) }; });
    return o;
  }
  function friendly(e) {
    if (e && e.pk) return e;
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'AbortError') return fail('That was cancelled. Nothing was changed.', 'cancelled');
    if (n === 'InvalidStateError') return fail('This device already has a passkey for your account.', 'exists');
    if (n === 'SecurityError') return fail('Passkeys only work on tradezoro.com.', 'security');
    return fail("Your device couldn't do that. Please try again.", 'device');
  }

  // Sign in: resolves with the Firebase custom token. conditional=true fills the browser's email-box suggestion.
  function signIn(conditional) {
    if (!supported) return Promise.reject(fail('This browser does not support passkeys.'));
    if (abortCond) { try { abortCond.abort(); } catch (e) { /* ignore */ } abortCond = null; }
    var ctl = null;
    if (conditional) { ctl = new AbortController(); abortCond = ctl; }
    return api('POST', '/login/options', {}, false).then(function (o) {
      var pk = o.publicKey; pk.challenge = b64uToBuf(pk.challenge);
      var opts = { publicKey: pk };
      if (conditional) { opts.mediation = 'conditional'; opts.signal = ctl.signal; }
      return navigator.credentials.get(opts);
    }).then(function (c) {
      if (!c) throw fail('No passkey chosen.', 'cancelled');
      var r = c.response;
      return api('POST', '/login/verify', { id: c.id, rawId: bufToB64u(c.rawId), response: {
        clientDataJSON: bufToB64u(r.clientDataJSON), authenticatorData: bufToB64u(r.authenticatorData),
        signature: bufToB64u(r.signature), userHandle: r.userHandle ? bufToB64u(r.userHandle) : null } }, false);
    }).then(function (j) { return j.token; }, function (e) { throw friendly(e); });
  }
  function conditional() {
    if (!supported || !PublicKeyCredential.isConditionalMediationAvailable) return Promise.resolve(null);
    return PublicKeyCredential.isConditionalMediationAvailable().then(function (ok) { return ok ? signIn(true) : null; });
  }

  function list() { return api('GET', '', null, true).then(function (j) { return j.passkeys || []; }); }
  function add() {
    if (!supported) return Promise.reject(fail('This browser does not support passkeys.'));
    var u = auth.currentUser;
    return api('POST', '/register/options', { email: u.email || '', displayName: u.displayName || u.email || '' }, true).then(function (o) {
      return navigator.credentials.create({ publicKey: decodeCreate(o.publicKey) });
    }).then(function (c) {
      var r = c.response;
      return api('POST', '/register/verify', { id: c.id, rawId: bufToB64u(c.rawId), transports: r.getTransports ? r.getTransports() : [],
        response: { clientDataJSON: bufToB64u(r.clientDataJSON), attestationObject: bufToB64u(r.attestationObject) } }, true);
    }).then(null, function (e) { throw friendly(e); });
  }
  function rename(id, name) { return api('PATCH', '/' + encodeURIComponent(id), { name: name }, true); }
  function remove(id) { return api('DELETE', '/' + encodeURIComponent(id), null, true); }

  // One-time "sign in faster" offer: due when a normal sign-in just happened, nobody said "Not now" in 30 days, and none added.
  var SNOOZE = 'tz_pk_snooze_until';
  function offerDue() {
    try {
      if (!supported || sessionStorage.getItem('tz_pk_offer') !== '1') return false;
      sessionStorage.removeItem('tz_pk_offer');
      return Date.now() > Number(localStorage.getItem(SNOOZE) || 0);
    } catch (e) { return false; }
  }
  function offerSnooze() { try { localStorage.setItem(SNOOZE, String(Date.now() + 30 * 864e5)); } catch (e) { /* ignore */ } }

  window.TZPasskeys = { supported: supported, signIn: signIn, conditional: conditional, list: list, add: add, rename: rename, remove: remove, offerDue: offerDue, offerSnooze: offerSnooze };
})();
