// Passkeys UI. Settings panel (#passkeys-panel) and the one-time offer on the dashboard.
// Needs: auth (assets/auth.js) and window.TZPasskeys (assets/passkeys.js).
(function () {
  'use strict';
  var P = window.TZPasskeys;
  if (!P || !P.supported || typeof auth === 'undefined' || !auth) return;
  var KEY = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3"/><path d="m16 7 3 3"/><path d="m13.5 9.5 2 2"/></svg>';
  function fmt(t) { return t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // ---- Settings ----
  var panel = document.getElementById('passkeys-panel');
  if (panel) {
    panel.hidden = false;
    var listEl = document.getElementById('pk-list'), emptyEl = document.getElementById('pk-empty'), msg = document.getElementById('pk-msg'), addBtn = document.getElementById('pk-add');
    var say = function (t, err) { msg.textContent = t || ''; msg.className = 'pk-msg' + (err ? ' err' : ''); };
    var recent = function () {
      return auth.currentUser.getIdTokenResult().then(function (r) { return (Date.now() / 1000 - Math.floor(Date.parse(r.authTime) / 1000)) < 540; });
    };
    var render = function (items) {
      listEl.textContent = '';
      emptyEl.hidden = items.length > 0; listEl.hidden = !items.length;
      items.forEach(function (k) {
        var li = el('li', 'pk-row'), ic = el('span', 'pk-ico'); ic.innerHTML = KEY;
        var main = el('div', 'pk-main'), name = el('div', 'pk-name', k.name);
        var meta = el('div', 'pk-meta', 'Added ' + fmt(k.createdAt) + ' · ' + (k.lastUsedAt ? 'Last used ' + fmt(k.lastUsedAt) : 'Not used yet'));
        if (k.flagged) { var f = el('div', 'pk-meta pk-flag', 'Blocked for safety. Remove it and add a new one.'); main.append(name, meta, f); } else main.append(name, meta);
        var act = el('div', 'pk-act'), rn = el('button', '', 'Rename'), rm = el('button', 'pk-del', 'Remove');
        rn.type = rm.type = 'button'; rn.setAttribute('aria-label', 'Rename ' + k.name); rm.setAttribute('aria-label', 'Remove ' + k.name);
        rn.onclick = function () {
          var inp = el('input', 'pk-input'); inp.value = k.name; inp.maxLength = 40; inp.setAttribute('aria-label', 'Passkey name');
          main.replaceChild(inp, name); inp.focus(); inp.select();
          var done = false, save = function () { if (done) return; done = true; var v = inp.value.trim(); if (!v || v === k.name) return refresh(); P.rename(k.id, v).then(refresh, function (e) { say(e.message, true); refresh(); }); };
          inp.onkeydown = function (ev) { if (ev.key === 'Enter') save(); if (ev.key === 'Escape') { done = true; refresh(); } };
          inp.onblur = save;
        };
        rm.onclick = function () {
          if (!confirm('Remove "' + k.name + '"? You will not be able to sign in with it any more.')) return;
          P.remove(k.id).then(function () { say('Passkey removed.'); refresh(); }, function (e) { say(e.message, true); });
        };
        act.append(rn, rm); li.append(ic, main, act); listEl.appendChild(li);
      });
    };
    var refresh = function () { return P.list().then(render, function (e) { say(e.message, true); }); };
    addBtn.addEventListener('click', function () {
      say(''); addBtn.disabled = true;
      recent().then(function (ok) {
        if (!ok) { say('For your safety, please log out and sign in again, then add a passkey.', true); return; }
        return P.add().then(function () { say('Passkey added. You can use it next time you sign in.'); return refresh(); });
      }).catch(function (e) { if (e && e.code === 'cancelled') say(e.message); else if (e && e.code === 'recent-login') say('For your safety, please log out and sign in again, then add a passkey.', true); else say((e && e.message) || 'Something went wrong.', true); })
        .then(function () { addBtn.disabled = false; });
    });
    auth.onAuthStateChanged(function (u) { if (u) refresh(); });
  }

  // ---- One-time offer (dashboard) ----
  if (document.body.hasAttribute('data-passkey-offer') && P.offerDue()) {
    auth.onAuthStateChanged(function (u) {
      if (!u || document.getElementById('pk-offer')) return;
      P.list().then(function (items) {
        if (items.length) return;
        var card = el('div', 'pk-offer'); card.id = 'pk-offer'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Passkey');
        var add = el('button', 'btn btn-primary btn-sm', 'Add a passkey'), no = el('button', 'btn btn-ghost btn-sm', 'Not now');
        add.type = no.type = 'button';
        var wrap = el('div', 'pk-offer-btns'); wrap.append(no, add);
        card.append(el('h3', '', 'Sign in faster next time with a passkey'), el('p', '', 'Use your fingerprint, face or screen lock instead of a password.'), wrap);
        // never on top of the welcome wizard: wait (up to 30 s) until it is closed
        var tries = 0, show = function () {
          if (document.body.classList.contains('ob-open') && tries++ < 30) return setTimeout(show, 1000);
          if (!document.body.classList.contains('ob-open')) document.body.appendChild(card);
        };
        show();
        no.onclick = function () { P.offerSnooze(); card.remove(); };
        add.onclick = function () { location.href = 'settings.html#passkeys'; };
      }, function () {});
    });
  }
})();
