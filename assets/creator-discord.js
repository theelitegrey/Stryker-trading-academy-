// Creator Hub -> Discord roles. Plain script. Exposes window.CHD:
//   CHD.view(el, ctx)        creator tab (creator.html, from creator-hub.js). ctx = { cid, cm, plans, reload() }
//   CHD.memberCard(el, ctx)  member card on the community page (c.html). ctx = { cid, cm, mem, me }
// Talks ONLY to the Discord Worker (CREATOR_CONFIG.DISCORD_API) with the person's Firebase ID token. No Discord token ever reaches
// this page; the Worker keeps them. If the Worker has no Discord app keys yet it answers "ready:false" and every screen says
// "Discord connection is being set up".
(function () {
  'use strict';
  var E = function (s) { return CH.esc(s); };
  var base = function () { var o = ''; try { if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) o = localStorage.getItem('cx_discord_api') || ''; } catch (e) {} return (o || CH.cfg.DISCORD_API || '').replace(/\/$/, ''); };

  function api(path, body) {
    return CH.user().then(function (u) {
      if (!u) return { ok: false, status: 401, data: { message: 'Sign in first.' } };
      return u.getIdToken().then(function (t) {
        return fetch(base() + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(body || {}) })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok && d.ok, status: r.status, data: d }; }); });
      });
    }).catch(function () { return { ok: false, status: 0, data: { message: 'Could not reach the Discord service. Try again.' } }; });
  }
  function pub(cid) {
    return fetch(base() + '/public?cid=' + encodeURIComponent(cid || ''), { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }
  var NOTICE = { connected: 'Discord server connected.', cancelled: 'Cancelled. Nothing changed.', failed: 'Discord said no. Try again.', noguild: 'No server was picked. Try again and choose a server.', taken: 'That Discord server is already connected to another community.',
    linked: 'Discord linked.', used: 'That Discord account is already linked to another TradeZoro account.', expired: 'That link expired. Start again.', notready: 'Discord connection is being set up.' };
  function flashFromUrl() {
    var d = new URLSearchParams(location.search).get('discord');
    if (!d || !NOTICE[d]) return '';
    try { var u = new URL(location.href); u.searchParams.delete('discord'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
    return d;
  }
  var SETUP = '<div class="cx-note"><b>Discord connection is being set up.</b> TradeZoro is finishing its Discord app. This tab turns on by itself when it is ready; nothing else to do.</div>';

  // ------------------------------------------------------------------------------------------ creator tab
  function view(el, ctx) {
    var $ = function (id) { return el.querySelector('#' + id); };
    var fl = flashFromUrl();
    el.innerHTML = '<div class="cx-empty">Loading…</div>';
    Promise.all([pub(ctx.cid), CH.user().then(function (u) { return u && api('/creator/roles', { cid: ctx.cid }); })]).then(function (r) {
      var p = r[0], roles = r[1];
      if (!p) { el.innerHTML = '<div class="cx-empty">Could not reach the Discord service. Try again in a minute.</div>'; return; }
      if (!p.ready) { el.innerHTML = SETUP + '<div class="cx-box"><h2>Discord roles</h2><p class="cx-muted">When this is on, you connect your Discord server, pick which Discord role each plan gets, and members who link their Discord are added to your server with that role. The role is removed when their membership ends.</p><button class="btn btn-ghost" type="button" disabled>Connect Discord server</button></div>'; return; }
      var h = fl ? '<div class="cx-note ' + (/connected|linked/.test(fl) ? '' : 'cx-bad') + '" role="status">' + E(NOTICE[fl]) + '</div>' : '';
      var d = roles && roles.ok ? roles.data : { connected: false };
      if (!d.connected) {
        h += '<div class="cx-box"><h2>Connect your Discord server</h2><p class="cx-muted">You need to own the server (or have Manage Server). TradeZoro\'s bot is added with only two permissions: <b>Manage Roles</b> and <b>Create Invite</b>. It cannot read messages. After it joins, drag the <b>TradeZoro</b> role above the roles you want it to hand out (Discord server settings, Roles).</p>' +
          '<div class="cx-actions"><button class="btn btn-primary" id="dc-conn" type="button">Connect Discord server</button></div><div class="cx-bad" id="dc-msg" role="alert"></div></div>';
        el.innerHTML = h;
        $('dc-conn').onclick = function () { var b = this; b.disabled = true; api('/creator/install', { cid: ctx.cid }).then(function (x) { if (x.ok) location.href = x.data.url; else { b.disabled = false; $('dc-msg').textContent = x.data.message || 'Could not start. Try again.'; } }); };
        return;
      }
      var assignable = (d.roles || []).filter(function (x) { return x.assignable; });
      h += '<div class="cx-box"><div class="cx-spread"><div><h2 style="margin:0">' + E(d.guild.name) + '</h2><div class="cx-muted">Discord server connected</div></div><span class="cx-chip on">Connected</span></div>' +
        (d.error ? '<p class="cx-bad" style="margin-top:10px">' + E(d.error) + '</p>' : '') +
        '<label class="cx-check" style="margin-top:14px"><input type="checkbox" id="dc-auto"' + (d.guild.autoJoin ? ' checked' : '') + '><span>Add members to the server automatically when they link Discord. If off, they get a one-use invite instead.</span></label></div>';
      h += '<div class="cx-box" style="margin-top:12px"><h2>Role for each plan</h2><p class="cx-muted">Members on a plan get that Discord role. Leave a plan on "No role" if it should not get one.' +
        (assignable.length ? '' : ' <b class="cx-bad">No role is available yet: move the TradeZoro role above your other roles in Discord, then reload.</b>') + '</p><div class="dc-plans">';
      ctx.plans.forEach(function (pl) {
        var cur = pl.discordRoleId || '';
        var missing = cur && !assignable.some(function (x) { return x.id === cur; });
        h += '<div class="dc-plan"><div class="dc-pn"><b>' + E(pl.name) + '</b><span class="cx-muted"> ' + E(CH.money(pl)) + '</span></div><select class="cx-in-s dc-sel" data-p="' + E(pl.id) + '" aria-label="Discord role for ' + E(pl.name) + '"><option value="">No role</option>' +
          assignable.map(function (x) { return '<option value="' + E(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>' + E(x.name) + '</option>'; }).join('') +
          (missing ? '<option value="' + E(cur) + '" selected>(role not available)</option>' : '') + '</select></div>';
      });
      if (!ctx.plans.length) h += '<p class="cx-muted">Add a plan first.</p>';
      h += '</div></div><div class="cx-box" style="margin-top:12px"><h2>Keep it in sync</h2><p class="cx-muted">TradeZoro checks every linked member every 15 minutes and removes the role when a membership ends, expires or is banned. After you remove or ban someone, press the button for an instant check.</p>' +
        '<div class="cx-actions"><button class="btn btn-ghost" id="dc-sync" type="button">Check everyone now</button><button class="btn btn-ghost" id="dc-off" type="button">Disconnect server</button></div><div id="dc-msg" class="cx-muted" role="status"></div></div>';
      el.innerHTML = h;
      $('dc-auto').onchange = function () { api('/creator/settings', { cid: ctx.cid, autoJoin: this.checked }).then(function (x) { CH.toast(x.ok ? 'success' : 'error', x.ok ? 'Saved' : (x.data.message || 'Could not save')); }); };
      el.querySelectorAll('.dc-sel').forEach(function (s) {
        s.onchange = function () {
          var ref = db.collection('communities').doc(ctx.cid).collection('plans').doc(s.dataset.p);
          ref.update({ discordRoleId: s.value ? s.value : firebase.firestore.FieldValue.delete(), updatedAt: CH.ts() })
            .then(function () { CH.toast('success', 'Saved. Members get it on their next check.'); }).catch(function () { CH.toast('error', 'Could not save the role.'); });
        };
      });
      $('dc-sync').onclick = function () { var b = this; b.disabled = true; $('dc-msg').textContent = 'Checking…'; api('/creator/resync', { cid: ctx.cid }).then(function (x) { b.disabled = false; $('dc-msg').textContent = x.ok ? 'Checked ' + x.data.checked + ' linked member' + (x.data.checked === 1 ? '' : 's') + '; removed ' + x.data.changed + '.' : (x.data.message || 'Could not check.'); }); };
      $('dc-off').onclick = function () {
        if (!confirm('Disconnect this Discord server? Roles TradeZoro gave are removed and members stay in the server.')) return;
        api('/creator/disconnect', { cid: ctx.cid }).then(function (x) { if (x.ok) view(el, ctx); else CH.toast('error', x.data.message || 'Could not disconnect.'); });
      };
    });
  }

  // ------------------------------------------------------------------------------------------ member card
  function memberCard(el, ctx) {
    var fl = flashFromUrl();
    pub(ctx.cid).then(function (p) {
      if (!p || !p.connected) { el.innerHTML = ''; return; }
      if (!p.ready) { el.innerHTML = ''; return; }
      el.innerHTML = '<div class="cx-box" style="margin-bottom:12px"><div class="cx-muted">Loading Discord…</div></div>';
      api('/sync', { cid: ctx.cid, refreshToken: ctx.me && ctx.me.refreshToken }).then(function (s) {
        var d = s.data || {}, h = '<div class="cx-box" style="margin-bottom:12px"><h2>Discord</h2>';
        if (fl) h += '<p class="' + (/linked/.test(fl) ? 'cx-ok' : 'cx-bad') + '" role="status">' + E(NOTICE[fl]) + '</p>';
        if (!s.ok && s.status !== 404) h += '<p class="cx-muted">' + E(d.message || 'Discord is not available right now.') + '</p>';
        else if (!d.linked) {
          h += '<p class="cx-muted">Link your Discord to join <b>' + E(p.guildName || 'the server') + '</b> and get your member role. TradeZoro sees only your Discord name and ID.</p><button class="btn btn-primary" type="button" id="dc-link" style="width:100%">Link Discord</button><div class="cx-bad" id="dc-m" role="alert"></div>' +
            '<p class="cx-muted" style="font-size:12px;margin-top:8px">TradeZoro keeps a sign-in key on its server so it can remove the role when your membership ends. Unlink any time.</p>';
        } else {
          var st = d.state, line = { active: '<b class="cx-ok">You are in the server with your role.</b>', invite: 'Join the server with this one-use invite. Your role is added automatically.', norole: 'Your plan has no Discord role.', badrole: 'The role for your plan is not available. Tell the creator.',
            removed: 'Your role was removed' + (d.note ? ' (' + E(d.note) + ')' : '') + '.', stale: 'Open TradeZoro again, or link Discord again, to refresh.', banned: 'You are banned from that Discord server.', error: E(d.note || 'Discord did not answer. It retries on its own.'), waiting: 'Waiting for the creator.' }[st] || 'Checking…';
          h += '<p>' + line + '</p>' + (d.inviteUrl ? '<a class="btn btn-primary" target="_blank" rel="noopener" href="' + E(d.inviteUrl) + '" style="width:100%">Open invite</a>' : '') +
            '<div class="cx-row" style="margin-top:8px"><button class="btn btn-ghost" type="button" id="dc-re">Check again</button><button class="btn btn-ghost" type="button" id="dc-un">Unlink Discord</button></div>';
        }
        el.innerHTML = h + '</div>';
        var lk = el.querySelector('#dc-link');
        if (lk) lk.onclick = function () { lk.disabled = true; api('/link/start', { cid: ctx.cid, refreshToken: ctx.me && ctx.me.refreshToken }).then(function (x) { if (x.ok) location.href = x.data.url; else { lk.disabled = false; el.querySelector('#dc-m').textContent = x.data.message || 'Could not start. Try again.'; } }); };
        var re = el.querySelector('#dc-re'); if (re) re.onclick = function () { fl = ''; memberCard(el, ctx); };
        var un = el.querySelector('#dc-un'); if (un) un.onclick = function () { if (confirm('Unlink Discord? Your role is removed. You stay in the server.')) api('/unlink', {}).then(function () { fl = ''; memberCard(el, ctx); }); };
      });
    });
  }
  window.CHD = { view: view, memberCard: memberCard };
})();
