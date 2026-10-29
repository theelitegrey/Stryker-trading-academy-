// TradeZoro Creator Hub: shared helpers (window.CH).
// Depends on: assets/creator-config.js, firebase app/auth/firestore, assets/auth.js (`auth`), assets/progress.js (`db`).
// Used by: creators.html, creator-new.html, c.html, creator.html, communities.html, creator-admin.html.
(function (g) {
  var CFG = g.CREATOR_CONFIG || { PAYMENTS: false, TAGS: [] };
  var RESERVED = ['admin','api','app','c','communities','community','creator','creators','creator-rules','help','login','signup','support','settings','terms','privacy','tradezoro','zoro','zorocharts','stryker','official','staff','team','null','undefined','new','www','mod','moderator','billing','checkout','charts','gex','courses','learn','pricing','about','contact','features','dashboard','profile'];
  var CH = { cfg: CFG, TAGS: CFG.TAGS, RESERVED: RESERVED };

  CH.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  CH.para = function (s) { return CH.esc(s).split(/\n{2,}/).map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join(''); };
  CH.tagLabel = function (t) { for (var i = 0; i < CH.TAGS.length; i++) if (CH.TAGS[i][0] === t) return CH.TAGS[i][1]; return t; };
  CH.money = function (p) {
    var pr = p && p.price;
    if (!pr || pr.interval === 'free') return 'Free';
    var sym = pr.currency === 'INR' ? '\u20B9' : '$';
    if (pr.interval === 'lifetime') return sym + pr.amount + ' one-time';
    return sym + pr.amount + ' / ' + pr.interval;
  };
  CH.slugOk = function (s) { return /^[a-z0-9][a-z0-9-]{2,29}$/.test(s) && !/--/.test(s) && !/-$/.test(s) && RESERVED.indexOf(s) < 0; };
  CH.slugify = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/--+/g, '-').slice(0, 30).replace(/-$/, ''); };
  CH.RISKY = /guarantee|100\s?%|risk[- ]?free|profit every|can'?t lose|no risk|sure win/i;
  CH.warnIf = function (el) {
    if (!el) return;
    var w = el.parentNode.querySelector('.cx-warn');
    if (CH.RISKY.test(el.value)) {
      if (!w) { w = document.createElement('div'); w.className = 'cx-warn'; el.insertAdjacentElement('afterend', w); }
      w.textContent = 'Careful: wording like "guaranteed", "100%" or "risk-free" breaks the Creator Rules. Do not promise results.';
    } else if (w) w.remove();
  };
  CH.toast = function (type, msg) { if (typeof showToast === 'function') showToast(type, msg); else console.log(type, msg); };
  CH.user = function () {
    return new Promise(function (res) {
      if (typeof auth === 'undefined' || !auth) return res(null);
      var un = auth.onAuthStateChanged(function (u) { un(); res(u); });
    });
  };
  CH.signIn = function () { if (typeof goToLoginPreservingReturn === 'function') goToLoginPreservingReturn(); else location.href = '/login'; };
  CH.ts = function () { return firebase.firestore.FieldValue.serverTimestamp(); };
  CH.inc = function (n) { return firebase.firestore.FieldValue.increment(n); };
  CH.stamp = function (d) { return d ? firebase.firestore.Timestamp.fromDate(d) : null; };
  CH.date = function (t) { if (!t) return ''; var d = t.toDate ? t.toDate() : new Date(t); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
  CH.displayName = function (u) { return String((u && (u.displayName || (u.email || '').split('@')[0])) || 'Member').slice(0, 60); };
  CH.isActive = function (m) { if (!m || m.status !== 'active') return false; var e = m.expiresAt; return !e || (e.toDate ? e.toDate() : new Date(e)).getTime() > Date.now(); };

  // Video embed: YouTube / Vimeo / Loom links only (the rules allow only these hosts).
  CH.embed = function (url) {
    var m;
    if (!url) return '';
    if ((m = url.match(/youtube\.com\/watch\?[^#]*v=([\w-]{6,})/) || url.match(/youtu\.be\/([\w-]{6,})/) || url.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/))) return 'https://www.youtube-nocookie.com/embed/' + m[1];
    if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/))) return 'https://player.vimeo.com/video/' + m[1];
    if ((m = url.match(/loom\.com\/(?:share|embed)\/([\w]+)/))) return 'https://www.loom.com/embed/' + m[1];
    return '';
  };
  CH.videoOk = function (u) { return u === '' || /^https:\/\/(www\.|m\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|loom\.com|www\.loom\.com)\/\S{1,400}$/.test(u); };
  CH.urlOk = function (u) { return u === '' || /^https:\/\/\S{4,480}$/.test(u); };

  // POST /api/creator/<action> with the caller's ID token. Returns {ok, status, data}; status 0 = no API here (dev server).
  CH.api = function (action, body) {
    return CH.user().then(function (u) {
      if (!u) return { ok: false, status: 401, data: { message: 'Sign in first.' } };
      return u.getIdToken().then(function (t) {
        return fetch('/api/creator/' + action, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(body || {}) })
          .then(function (r) {
            var ct = r.headers.get('content-type') || '';
            if (ct.indexOf('json') < 0) return { ok: false, status: 0, data: {} };
            return r.json().then(function (d) { return { ok: r.ok && d.ok, status: r.status, data: d }; });
          });
      });
    }).catch(function () { return { ok: false, status: 0, data: {} }; });
  };

  // Direct (rules-checked) fallbacks, used only when the API is not reachable. Same atomic batches the API commits.
  var memRef = function (cid, uid) { return db.collection('communities').doc(cid).collection('members').doc(uid); };
  var cmRef = function (cid) { return db.collection('communities').doc(cid); };
  function memberDoc(u, planId, source, extra) {
    var d = { uid: u.uid, planId: planId, role: 'member', source: source, status: 'active', joinedAt: CH.ts(), expiresAt: null, lastActiveAt: CH.ts(), displayName: CH.displayName(u) };
    for (var k in (extra || {})) d[k] = extra[k];
    return d;
  }
  CH.join = function (cid, planId) {
    return CH.api('join', { cid: cid, planId: planId }).then(function (r) {
      if (r.status !== 0) return r;
      return CH.user().then(function (u) {
        var b = db.batch();
        b.set(memRef(cid, u.uid), memberDoc(u, planId, 'free'));
        b.update(cmRef(cid), { memberCount: CH.inc(1) });
        return b.commit().then(function () { return { ok: true, status: 200, data: {} }; });
      });
    });
  };
  CH.redeem = function (cid, code) {
    return CH.api('redeem', { cid: cid, code: code }).then(function (r) {
      if (r.status !== 0) return r;
      return CH.user().then(function (u) {
        return cmRef(cid).collection('invites').doc(code).get().then(function (s) {
          if (!s.exists) return { ok: false, status: 404, data: { message: 'That invite is not valid.' } };
          var i = s.data();
          if (i.status !== 'active') return { ok: false, status: 404, data: { message: 'That invite is not valid.' } };
          if (i.expiresAt && i.expiresAt.toDate() < new Date()) return { ok: false, status: 410, data: { message: 'That invite has expired.' } };
          if (i.maxUses > 0 && i.uses >= i.maxUses) return { ok: false, status: 410, data: { message: 'That invite has been used up.' } };
          var exp = i.grantDays > 0 ? CH.stamp(new Date(Date.now() + i.grantDays * 86400000)) : null;
          var b = db.batch();
          b.set(memRef(cid, u.uid), memberDoc(u, i.planId, 'invite', { inviteCode: code, expiresAt: exp }));
          b.update(cmRef(cid).collection('invites').doc(code), { uses: CH.inc(1) });
          b.update(cmRef(cid), { memberCount: CH.inc(1) });
          return b.commit().then(function () { return { ok: true, status: 200, data: {} }; });
        });
      });
    });
  };
  CH.claim = function (cid) {
    return CH.api('claim', { cid: cid }).then(function (r) {
      if (r.status !== 0) return r;
      return CH.user().then(function (u) {
        var em = (u.email || '').toLowerCase(), gr = cmRef(cid).collection('grants').doc(em);
        return gr.get().then(function (s) {
          if (!s.exists) return { ok: false, status: 404, data: { message: 'No pending access for your email.' } };
          var gd = s.data(), b = db.batch();
          b.set(memRef(cid, u.uid), memberDoc(u, gd.planId, 'import', { expiresAt: gd.expiresAt || null }));
          b.delete(gr);
          b.update(cmRef(cid), { memberCount: CH.inc(1) });
          return b.commit().then(function () { return { ok: true, status: 200, data: {} }; });
        });
      });
    });
  };
  CH.importEmails = function (cid, planId, emails, expiresAt) {
    return CH.api('import', { cid: cid, planId: planId, emails: emails, expiresAt: expiresAt || null }).then(function (r) {
      if (r.status !== 0) return r;
      return CH.user().then(function (u) {
        var seen = {}, list = [], bad = [];
        emails.forEach(function (e) { e = String(e).trim().toLowerCase(); if (!e) return; if (!/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]{2,}$/.test(e) || e.length > 200) bad.push(e); else if (!seen[e]) { seen[e] = 1; list.push(e); } });
        if (!list.length) return { ok: false, status: 400, data: { message: 'No valid email addresses found.' } };
        var chain = Promise.resolve();
        for (var i = 0; i < list.length; i += 400) (function (part) {
          chain = chain.then(function () {
            var b = db.batch();
            part.forEach(function (e) { b.set(cmRef(cid).collection('grants').doc(e), { email: e, planId: planId, expiresAt: expiresAt ? CH.stamp(new Date(expiresAt)) : null, createdBy: u.uid, createdAt: CH.ts() }); });
            return b.commit();
          });
        })(list.slice(i, i + 400));
        return chain.then(function () { return { ok: true, status: 200, data: { added: list.length, skipped: bad } }; });
      });
    });
  };

  CH.card = function (c) {
    var cover = c.coverUrl ? 'style="background-image:url(' + CH.esc(c.coverUrl) + ')"' : 'style="background:linear-gradient(135deg,' + CH.esc(c.accent || '#03c988') + '33,#0b0b0d)"';
    var logo = c.logoUrl ? '<img src="' + CH.esc(c.logoUrl) + '" alt="" loading="lazy">' : '<span>' + CH.esc((c.name || '?').charAt(0).toUpperCase()) + '</span>';
    return '<a class="cx-ccard" href="/c/' + CH.esc(c.slug) + '"><div class="cx-ccover" ' + cover + '></div><div class="cx-clogo" style="border-color:' + CH.esc(c.accent || '#03c988') + '">' + logo + '</div>' +
      '<div class="cx-cbody"><h3>' + CH.esc(c.name) + '</h3><p>' + CH.esc(c.tagline || '') + '</p>' +
      '<div class="cx-ctags">' + (c.tags || []).map(function (t) { return '<span class="cx-chip">' + CH.esc(CH.tagLabel(t)) + '</span>'; }).join('') + '</div>' +
      '<div class="cx-cmeta">' + (c.memberCount || 0) + ' member' + (c.memberCount === 1 ? '' : 's') + ' \u00b7 by ' + CH.esc(c.ownerName || 'a creator') + '</div></div></a>';
  };
  g.CH = CH;
})(window);
