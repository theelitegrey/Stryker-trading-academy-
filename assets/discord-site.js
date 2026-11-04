// Settings -> "Join the TradeZoro Discord" card. Talks only to the Discord Worker (/site/sync, /link/start, /unlink) with the
// member's own Firebase ID token. No Discord token ever reaches this page. Pro role is decided by the Worker, not here.
(function () {
  'use strict';
  var box = document.getElementById('discord-site-body'); if (!box) return;
  var INVITE = 'https://discord.gg/ZYuHkVcMy';
  var base = 'https://discord-roles.theelitegrey.workers.dev';
  try { if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) base = localStorage.getItem('cx_discord_api') || base; } catch (e) {}
  var NOTICE = { cancelled: 'Cancelled. Nothing changed.', failed: 'Discord said no. Try again.', used: 'That Discord account is already linked to another TradeZoro account.', expired: 'That link expired. Start again.', notready: 'Discord connection is being set up.' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var user = null, msg = '';
  try { var q = new URLSearchParams(location.search).get('discord'); if (q && q !== 'linked') msg = NOTICE[q] || ''; if (q) { var u = new URL(location.href); u.searchParams.delete('discord'); history.replaceState(null, '', u.pathname + u.search + u.hash); } } catch (e) {}

  function api(path, body) {
    return user.getIdToken().then(function (t) {
      return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(body || {}) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok && d.ok, data: d }; }); });
    }).catch(function () { return { ok: false, data: { message: 'Could not reach the Discord service. Try again.' } }; });
  }
  var INTRO = 'Chat with other traders, ask questions and get updates. Free members can join. Pro members also get the Pro channels.';
  function paint(d) {
    var h = '';
    if (msg) h += '<p class="ds-msg" role="alert">' + esc(msg) + '</p>';
    if (!d || !d.ok) h += '<p class="ds-p">' + esc((d && d.data && d.data.message) || 'Discord is not available right now. Try again in a minute.') + '</p>';
    else if (d.data.ready === false) h += '<p class="ds-p">' + INTRO + '</p><p class="ds-p ds-mute">Discord connection is being set up.</p><div class="ds-row"><a class="btn btn-ghost btn-sm" href="' + INVITE + '" target="_blank" rel="noopener">Open Discord</a></div>';
    else if (!d.data.linked) h += '<p class="ds-p">' + INTRO + '</p><div class="ds-row"><button class="btn btn-primary btn-sm" type="button" id="ds-connect">Connect Discord</button><a class="btn btn-ghost btn-sm" href="' + INVITE + '" target="_blank" rel="noopener">Open Discord</a></div><p class="ds-p ds-mute">TradeZoro sees only your Discord name and ID.</p>';
    else {
      var x = d.data, st = x.state, line = x.pro && st === 'active' ? 'You have the TradeZoro Pro role.' : st === 'active' ? 'Pro members get the Pro channels.' :
        st === 'banned' ? 'You are banned from that Discord server.' : st === 'stale' ? 'Connect Discord again to join the server.' : 'Checking your role. It updates on its own every 15 minutes.';
      h += '<p class="ds-p"><b>Connected as ' + esc(x.username) + '</b></p><p class="ds-p">' + esc(line) + '</p><div class="ds-row"><a class="btn btn-primary btn-sm" href="' + INVITE + '" target="_blank" rel="noopener">Open Discord</a><button class="btn btn-ghost btn-sm" type="button" id="ds-check">Check again</button><button class="btn btn-ghost btn-sm" type="button" id="ds-un">Disconnect</button></div>';
    }
    box.innerHTML = h;
    var c = document.getElementById('ds-connect'), k = document.getElementById('ds-check'), un = document.getElementById('ds-un');
    if (c) c.onclick = function () { c.disabled = true; api('/link/start', { site: true, refreshToken: user.refreshToken }).then(function (r) { if (r.ok) location.href = r.data.url; else { msg = r.data.message || 'Could not start. Try again.'; paint(d); } }); };
    if (k) k.onclick = function () { k.disabled = true; load(); };
    if (un) un.onclick = function () { if (!confirm('Disconnect Discord? Your TradeZoro Pro role is removed. You stay in the server.')) return; un.disabled = true; api('/unlink').then(function () { msg = ''; load(); }); };
  }
  function load() { api('/site/sync', { refreshToken: user.refreshToken }).then(function (r) { paint(r.ok ? { ok: true, data: r.data } : r); }); }
  var go = function () { firebase.auth().onAuthStateChanged(function (u) { if (!u) return; user = u; load(); }); };
  if (window.firebase && firebase.auth) go(); else window.addEventListener('load', function () { if (window.firebase && firebase.auth) go(); });
})();
