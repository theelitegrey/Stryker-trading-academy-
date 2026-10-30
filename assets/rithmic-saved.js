// TradeZoro — Rithmic saved login (browser side). SHIPPED OFF.
// Depends on: firebase (compat) functions + auth. Server: functions-src/rithmicCreds.js.
// Everything here stays hidden unless the callable rithmicCredStatus answers { available: true }, which needs
// settings/commerce.rithmicSavedLogin = true AND the server key. Switch off or key missing => no UI at all.
// The password is only ever sent to rithmicCredSave (once, when the member ticks the box) and received from
// rithmicSessionTicket (to log in). It is never stored in localStorage, the DOM or logs.
(function () {
  'use strict';
  function fns() { try { return firebase.app().functions(); } catch (e) { return null; } }
  function call(name, data) { var f = fns(); if (!f) return Promise.reject(new Error('offline')); return f.httpsCallable(name)(data || {}).then(function (r) { return r.data; }); }
  var cache = null;
  function status(force) {
    if (cache && !force) return cache;
    cache = call('rithmicCredStatus').catch(function () { return { available: false, saved: false }; });
    return cache;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---- Settings -> Connections ---------------------------------------------------------------------------
  function renderSettings(host, st) {
    if (!st.available || !st.saved) { host.hidden = true; return; }
    host.hidden = false;
    var when = function (ms) { return ms ? new Date(ms).toLocaleString() : 'never'; };
    host.querySelector('[data-rs-body]').innerHTML =
      '<div class="rs-row"><div><b>Rithmic</b><small>' + esc(st.system) + ' \u00b7 ' + esc(st.username) + '</small><small>Last used ' + esc(when(st.lastUsedAt)) + '</small></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="rs-remove">Remove</button></div>' +
      '<label class="rs-check"><input type="checkbox" id="rs-auto"' + (st.autoSync ? ' checked' : '') + '><span>Sync my journal automatically after the trading day</span></label>' +
      '<label class="rs-time"><span>Time (New York)</span><input type="time" id="rs-time" value="' + esc(st.syncTime) + '"></label>' +
      (st.lastSyncStatus ? '<p class="rs-note">' + (st.lastSyncStatus === 'ok' ? 'Last sync ' + esc(when(st.lastSyncAt)) + ': ' + esc(st.lastSyncDetail || 'ok') : 'Rithmic sync failed: ' + esc(st.lastSyncDetail || 'unknown')) + '</p>' : '') +
      '<p class="rs-note">Stored encrypted on our server. Used only to load your charts and import your trades. Some prop firms allow one login at a time, so pick a time after you finish trading.</p>';
    host.querySelector('#rs-remove').addEventListener('click', function () {
      if (!confirm('Remove your saved Rithmic login from TradeZoro?')) return;
      call('rithmicCredDelete').then(function () { cache = null; return status(true); }).then(function (s) { renderSettings(host, s); });
    });
    var save = function () { call('rithmicCredSettings', { autoSync: host.querySelector('#rs-auto').checked, syncTime: host.querySelector('#rs-time').value }).catch(function (e) { alert(e.message || 'Could not save.'); }); };
    host.querySelector('#rs-auto').addEventListener('change', save); host.querySelector('#rs-time').addEventListener('change', save);
  }
  function initSettings() {
    var host = document.getElementById('settings-connections-panel'); if (!host) return;
    if (typeof auth === 'undefined') return;
    auth.onAuthStateChanged(function (u) { if (u) status().then(function (s) { renderSettings(host, s); }); });
  }

  // ---- hooks used by the Connect sheets (journal + charts) -----------------------------------------------------
  // savedLogin = { mount(el), afterLogin({system,user,password,gateway}) } : renders the opt-in checkbox (default OFF)
  // and, after a successful login, saves when ticked.
  function sheetHook() {
    var box = null;
    return status().then(function (st) {
      if (!st.available) return null;
      return {
        mount: function (el) {
          if (!el) return;
          el.innerHTML = '<label class="rjs-check-row"><input type="checkbox" id="rjs-save-login"><span>Remember my Rithmic login on TradeZoro</span></label>' +
            '<small class="rjs-hint" style="margin:-4px 0 16px 34px">Stored encrypted on our server. Used only to load your charts and import your trades. Remove it any time in Settings \u2192 Connections.</small>';
          box = el.querySelector('#rjs-save-login');
        },
        afterLogin: function (c) {
          if (!box || !box.checked) return Promise.resolve();
          return call('rithmicCredSave', { system: c.system, username: c.user, password: c.password, gateway: c.gateway }).then(function () { cache = null; });
        }
      };
    });
  }
  // Charts auto-connect: resolves to a credential the existing browser client logs in with, or null.
  function ticket() {
    return status().then(function (st) { return st.available && st.saved ? call('rithmicSessionTicket') : null; }).catch(function () { return null; });
  }
  window.strykerRithmicSaved = { status: status, sheetHook: sheetHook, ticket: ticket };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSettings); else initSettings();
})();
