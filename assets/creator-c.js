// Community public page + member view (c.html, served for /c/<slug>).
// Depends on: creator.js (CH), creator-pay.js (CP: paid join + member billing), firebase auth/firestore/functions, progress.js (db).
(function () {
  var root = document.getElementById('cm-root');
  var slug = (location.pathname.match(/^\/c\/([a-z0-9-]+)/) || location.search.match(/[?&]c=([a-z0-9-]+)/) || [])[1];
  var cm, plans = [], me = null, mem = null, tab = 'about', hasInvite = '', inds = null, myAccess = {}, payOpen = false, paidBack = '';
  var qs = new URLSearchParams(location.search);
  if (qs.get('tab') === 'indicators') tab = 'indicators';
  if (qs.get('tab') === 'courses') tab = 'courses';
  var wantInd = (qs.get('ind') || '').replace(/[^A-Za-z0-9]/g, ''), indCode = (qs.get('icode') || '').replace(/[^A-Za-z0-9]/g, '');
  var FEATS = [['feed', 'Feed'], ['courses', 'Courses'], ['indicators', 'Indicators'], ['events', 'Events'], ['leaderboard', 'Leaderboard']];

  function msg(t) { root.innerHTML = '<div class="cx-empty">' + t + '</div>'; }
  if (!slug) return msg('Community not found. <a href="/communities" style="color:var(--gold-bright)">Browse communities</a>');

  try { var u = new URLSearchParams(location.search); hasInvite = (u.get('invite') || '').replace(/[^A-Za-z0-9]/g, ''); paidBack = u.get('paid') || ''; } catch (e) {}

  Promise.all([CH.user()]).then(function (r) { me = r[0]; return window.CP ? CP.open(me) : false; }).then(function (o) { payOpen = !!o; return db.collection('communities').doc(slug).get(); }).then(function (d) {
    if (!d.exists) return msg('Community not found. <a href="/communities" style="color:var(--gold-bright)">Browse communities</a>');
    cm = d.data(); cm.id = d.id;
    document.title = cm.name + ' — TradeZoro';
    if (cm.status === 'suspended') return msg('This community is not available right now.');
    var q = [db.collection('communities').doc(slug).collection('plans').where('status', '==', 'live').get().then(function (s) { plans = s.docs.map(function (x) { var o = x.data(); o.id = x.id; return o; }).sort(function (a, b) { return a.order - b.order; }); }).catch(function () { plans = []; })];
    if (me) q.push(db.collection('communities').doc(slug).collection('members').doc(me.uid).get().then(function (m) { mem = m.exists ? m.data() : null; }).catch(function () { mem = null; }));
    return Promise.all(q).then(draw).then(afterPay);
  }).catch(function (e) {
    if (e && e.code === 'permission-denied') return msg(me ? 'Community not found. <a href="/communities" style="color:var(--gold-bright)">Browse communities</a>' : 'Community not found, or it is private. <a href="/login" style="color:var(--gold-bright)">Sign in</a> if you have an invite.');
    msg('Could not load this community. Check your connection and try again.');
  });

  function isOwner() { return me && cm.ownerUid === me.uid; }
  // A paid plan can be bought right now (display; the server re-checks everything).
  function buyable(p) { return payOpen && cm.sellerReady === true && !!String(cm.refundRule || '').trim() && window.CP && CP.sellable(p); }
  // Back from Stripe Checkout: ?paid=1 waits for the webhook to add the member; ?paid=0 = buyer cancelled.
  function afterPay() {
    if (!paidBack) return;
    history.replaceState(null, '', location.pathname);
    if (paidBack === '0') return CH.toast('info', 'Checkout cancelled. Nothing was charged.');
    if (!me || (mem && mem.source === 'paid' && CH.isActive(mem))) return;
    var side = document.getElementById('cm-side');
    if (side) side.insertAdjacentHTML('afterbegin', '<div class="cx-box cp-wait" id="cp-wait" role="status" style="margin-bottom:12px"><b>Payment received.</b><p class="cx-muted">Adding you to ' + CH.esc(cm.name) + '…</p></div>');
    CP.awaitJoin(slug, me.uid, function (ok) {
      if (ok) return location.reload();
      var w = document.getElementById('cp-wait');
      if (w) w.innerHTML = '<b>Payment received.</b><p class="cx-muted">Your access is taking longer than usual. Refresh in a minute. If it still doesn\'t show, contact support@tradezoro.com.</p>';
    });
  }
  function enabled() { return FEATS.filter(function (f) { return cm.features && cm.features[f[0]]; }); }

  function draw() {
    var accent = /^#[0-9a-fA-F]{6}$/.test(cm.accent) ? cm.accent : '#03c988';
    var cover = cm.coverUrl ? 'background-image:url(' + CH.esc(cm.coverUrl) + ')' : 'background:linear-gradient(135deg,' + accent + '40,#0b0b0d)';
    var logo = cm.logoUrl ? '<img src="' + CH.esc(cm.logoUrl) + '" alt="">' : CH.esc((cm.name || '?').charAt(0).toUpperCase());
    var member = mem && CH.isActive(mem);
    var h = '<div class="cx-cover" style="' + cover + '"></div>' +
      '<div class="cx-head"><div class="cx-logo" style="border-color:' + accent + '">' + logo + '</div><div class="cx-t"><h1>' + CH.esc(cm.name) + '</h1>' +
      '<div class="cx-muted">' + CH.esc(cm.tagline || '') + '</div>' +
      (cm.demo === true ? '<div class="cx-demo" role="note"><span class="cx-demo-dot" aria-hidden="true"></span>Demo community · sample members, posts and results</div>' : '') + '</div>' +
      (isOwner() ? '<a class="btn btn-ghost" href="/creator?c=' + CH.esc(slug) + '">Manage</a>' : '') + '</div>' +
      '<div class="cx-row" style="margin:12px 14px 0">' + (cm.tags || []).map(function (t) { return '<span class="cx-chip">' + CH.esc(CH.tagLabel(t)) + '</span>'; }).join('') +
      '<span class="cx-chip">' + (cm.memberCount || 0) + ' member' + (cm.memberCount === 1 ? '' : 's') + '</span>' +
      (cm.visibility === 'private' ? '<span class="cx-chip">Private</span>' : '') + '</div>';
    var tabs = [['about', 'About']];
    // Indicators is visible to everyone who can see the page (so people can see what a plan includes); the code itself
    // never leaves the server unless the person has access.
    if (cm.features && cm.features.indicators && !(cm.visibility === 'private' && !member && !isOwner())) tabs.push(['indicators', 'Indicators']);
    // Courses: like indicators, the structure is visible to everyone who can see the page (a teaser with locks); the content is gated by the rules.
    if (cm.features && cm.features.courses && !(cm.visibility === 'private' && !member && !isOwner())) tabs.push(['courses', 'Courses']);
    if (member) enabled().forEach(function (f) { if (f[0] !== 'indicators' && f[0] !== 'courses') tabs.push(f); });
    if (tab === 'courses' && !tabs.some(function (t) { return t[0] === 'courses'; })) tab = 'about';
    if (tab === 'indicators' && !tabs.some(function (t) { return t[0] === 'indicators'; })) tab = 'about';
    h += '<div class="cx-tabs" style="margin-top:16px" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    h += '<div class="cx-two"><div id="cm-main"></div><aside id="cm-side"></aside></div>';
    root.innerHTML = h;
    root.querySelector('.cx-tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; tab = b.dataset.t; draw(); });
    main(member); side(member);
  }

  function main(member) {
    var el = document.getElementById('cm-main');
    if (tab === 'about') {
      var h = '';
      if (cm.visibility === 'private' && !member && !isOwner() && !hasInvite) h += '<div class="cx-note">This community is invite-only. Open the invite link you were sent to join.</div>';
      else {
        var em = CH.embed(cm.introVideo);
        if (em) h += '<div class="cx-video"><iframe src="' + CH.esc(em) + '" title="Intro video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
        h += '<div class="cx-box"><h2>About</h2>' + (cm.about ? CH.paraLinks(cm.about) : '<p class="cx-muted">No description yet.</p>') + '</div>';
      }
      el.innerHTML = h;
      return;
    }
    if (tab === 'indicators') return indicatorsTab(el, member);
    if (tab === 'courses') {
      if (!window.CHL) { el.innerHTML = '<div class="cx-empty">Could not load courses. Reload the page.</div>'; return; }
      return window.CHL.mount(el, { cid: slug, cm: cm, plans: plans, mem: mem, me: me, isOwner: isOwner(), member: !!member, signIn: CH.signIn });
    }
    if (!window.CHF) { el.innerHTML = '<div class="cx-empty">Could not load this tab. Reload the page.</div>'; return; }
    return window.CHF.mount(el, tab, { cid: slug, cm: cm, mem: mem, me: me, isOwner: isOwner(), member: !!member, signIn: CH.signIn });
  }

  // ---------------------------------------------------------------- indicators tab (Creator Hub phase B)
  function indUsable(x, member) {
    if (isOwner()) return 'yours';
    if (member && (x.planIds || []).indexOf(mem.planId) >= 0) return 'plan';
    var a = myAccess[x.id]; if (a && a.status === 'active' && (!a.expiresAt || a.expiresAt.toMillis() > Date.now())) return 'grant';
    return '';
  }
  function loadInds() {
    if (inds) return Promise.resolve(inds);
    var col = db.collection('communities').doc(slug).collection('indicators');
    return col.where('status', '==', 'live').get().then(function (s) {
      inds = s.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      var em = me && me.emailVerified && (me.email || '').toLowerCase();
      if (!em) return inds;
      return Promise.all(inds.map(function (x) { return col.doc(x.id).collection('access').doc(em).get().then(function (d) { if (d.exists) myAccess[x.id] = d.data(); }).catch(function () {}); })).then(function () { return inds; });
    });
  }
  function indicatorsTab(el, member) {
    el.innerHTML = '<div class="cx-empty">Loading indicators…</div>';
    loadInds().then(function (list) {
      if (!list.length) { el.innerHTML = '<div class="cx-empty"><h3>Indicators</h3>No indicators published yet.</div>'; return; }
      var planName = function (id) { var p = plans.filter(function (x) { return x.id === id; })[0]; return p ? p.name : ''; };
      el.innerHTML = '<p class="cx-muted" style="margin:0 0 12px">These indicators run on ZoroCharts. Access is checked every time the chart loads them.</p><div class="cx-igrid">' + list.map(function (x) {
        var how = indUsable(x, member), pls = (x.planIds || []).map(planName).filter(Boolean);
        var solo = x.solo || { mode: 'off' };
        var act;
        if (how) act = '<a class="btn btn-primary" href="/charts?cind=' + CH.esc(slug) + '/' + CH.esc(x.id) + '">Open on ZoroCharts</a>';
        else if (solo.mode === 'free') act = '<button class="btn btn-primary ci-free" type="button" data-i="' + CH.esc(x.id) + '">Get it free</button>';
        else if (solo.mode === 'paid' && !CH.cfg.PAYMENTS) act = '<button class="btn btn-ghost" type="button" disabled>Paid checkout opens soon</button>';
        else if (pls.length) act = '<button class="btn btn-ghost ci-plans" type="button">' + (member ? 'Not in your plan' : 'See plans') + '</button>';
        else act = '<button class="btn btn-ghost" type="button" disabled>By invite only</button>';
        var shots = (x.shots || []).slice(0, 4);
        return '<article class="cx-icard" id="ind-' + CH.esc(x.id) + '">' +
          (shots.length ? '<div class="cx-ishots stkc-scroll">' + shots.map(function (u, i) { return '<img src="' + CH.esc(u) + '" alt="' + CH.esc(x.name) + ' screenshot ' + (i + 1) + '" loading="lazy">'; }).join('') + '</div>' : '<div class="cx-ishots cx-ishots-none" aria-hidden="true"></div>') +
          '<div class="cx-ibody"><div class="cx-spread"><h3>' + CH.esc(x.name) + '</h3><span class="cx-chip">v' + x.version + '</span></div>' +
          (x.desc ? '<p class="cx-muted">' + CH.esc(x.desc).slice(0, 400) + '</p>' : '') +
          '<div class="cx-row" style="gap:6px">' + (x.protected ? '<span class="cx-chip">Protected code</span>' : '') + (x.tags || []).map(function (t) { return '<span class="cx-chip">' + CH.esc(t) + '</span>'; }).join('') + '</div>' +
          '<p class="cx-imeta">' + (pls.length ? 'Included in: <b>' + pls.map(CH.esc).join(', ') + '</b>' : 'Not in a plan') +
          (solo.mode === 'paid' ? ' · Alone: ' + CH.esc(CH.money({ price: { amount: solo.price.amount, currency: solo.price.currency, interval: 'lifetime' } })) : solo.mode === 'free' ? ' · Alone: free' : '') + '</p>' +
          (how && x.settingsNotes ? '<details class="cx-inotes"><summary>Settings notes</summary>' + CH.para(x.settingsNotes) + '</details>' : '') +
          (how ? '<p class="cx-ok" style="margin:8px 0 0">You have access' + (how === 'grant' && myAccess[x.id].expiresAt ? ' until ' + CH.esc(CH.date(myAccess[x.id].expiresAt)) : '') + '</p>' : '') +
          '<div class="cx-actions">' + act + '</div><div class="cx-bad ci-msg" role="alert"></div></div></article>';
      }).join('') + '</div>' +
      (indCode && wantInd ? '<div class="cx-box" style="margin-top:12px" id="ci-code"><b>You have an invite code for an indicator</b><p class="cx-muted">Use it to get the indicator on ZoroCharts (not a community membership).</p><button class="btn btn-primary" id="ci-redeem" type="button">Use code</button><div class="cx-bad" id="ci-cmsg" role="alert"></div></div>' : '');
      el.querySelectorAll('.ci-plans').forEach(function (b) { b.onclick = function () { var s = document.getElementById('cm-side'); if (s) s.scrollIntoView({ behavior: 'smooth' }); }; });
      el.querySelectorAll('.ci-free').forEach(function (b) { b.onclick = function () { claim(b.dataset.i, null, b); }; });
      var rd = document.getElementById('ci-redeem'); if (rd) rd.onclick = function () { claim(wantInd, indCode, rd); };
      if (wantInd) { var t = document.getElementById('ind-' + wantInd); if (t) t.scrollIntoView({ block: 'center' }); }
    }).catch(function () { el.innerHTML = '<div class="cx-empty">Could not load indicators. Try again.</div>'; });
  }
  // Free claim / invite-code redeem for ONE indicator. Rules-checked batch (firestore.rules, indicators/access).
  function claim(iid, codeId, btn) {
    if (!me) return CH.signIn();
    var msgEl = codeId ? document.getElementById('ci-cmsg') : btn.closest('.cx-ibody').querySelector('.ci-msg');
    if (!me.emailVerified) { msgEl.textContent = 'Verify your email first (check your inbox), then try again.'; return; }
    var em = (me.email || '').toLowerCase(), col = db.collection('communities').doc(slug).collection('indicators').doc(iid);
    btn.disabled = true;
    var go = codeId ? col.collection('codes').doc(codeId).get().then(function (c) {
      if (!c.exists || c.data().status !== 'active') throw { m: 'That code is not valid.' };
      var d = c.data();
      if (d.maxUses && d.uses >= d.maxUses) throw { m: 'That code has been used up.' };
      if (d.expiresAt && d.expiresAt.toMillis() < Date.now()) throw { m: 'That code has expired.' };
      var b = db.batch();
      b.set(col.collection('access').doc(em), { email: em, source: 'invite', status: 'active', code: codeId, createdBy: me.uid, createdAt: CH.ts(),
        expiresAt: d.grantDays ? CH.stamp(new Date(Date.now() + d.grantDays * 86400000)) : null });
      b.update(col.collection('codes').doc(codeId), { uses: CH.inc(1) });
      return b.commit();
    }) : col.collection('access').doc(em).set({ email: em, source: 'free', status: 'active', expiresAt: null, createdBy: me.uid, createdAt: CH.ts() });
    go.then(function () { CH.toast('success', 'Done. Open it on ZoroCharts.'); inds = null; myAccess = {}; draw(); })
      .catch(function (e) { btn.disabled = false; msgEl.textContent = (e && e.m) || 'Could not get access. You may already have it, or the code is not valid for you.'; });
  }

  function side(member) {
    var el = document.getElementById('cm-side'), h = '';
    if (isOwner()) h += '<div class="cx-box" style="margin-bottom:12px"><b>You run this community.</b><p class="cx-muted">Members see the page below. Manage it in the Creator Hub.</p></div>';
    else if (member && mem.source === 'paid' && mem.pay && window.CP) h += '<div class="cx-box" style="margin-bottom:12px"><b class="cx-ok">You are a member</b>' + CP.memberBox(cm, mem) + '</div>';
    else if (member) h += '<div class="cx-box" style="margin-bottom:12px"><b class="cx-ok">You are a member</b>' + (mem.expiresAt ? '<p class="cx-muted">Access until ' + CH.esc(CH.date(mem.expiresAt)) + '</p>' : '') + '<div style="margin-top:10px"><button class="btn btn-ghost" type="button" id="cm-leave">Leave community</button></div></div>';
    else if (hasInvite) h += '<div class="cx-box" style="margin-bottom:12px"><b>You have an invite</b><p class="cx-muted">Join ' + CH.esc(cm.name) + ' with your invite link.</p><button class="btn btn-primary" type="button" id="cm-redeem">Use invite</button><div id="cm-redeem-msg" class="cx-bad" role="alert"></div></div>';
    if (member && !isOwner() && cm.features && cm.features.discord && window.CHD) h += '<div id="cm-discord"></div>';
    if (!member && !isOwner() && !(cm.visibility === 'private' && !hasInvite)) {
      h += '<div class="cx-box"><h2>Plans</h2>';
      if (!plans.length) h += '<p class="cx-muted">No plans are open yet.</p>';
      plans.forEach(function (p) {
        var free = p.price && p.price.interval === 'free';
        h += '<div class="cx-plan' + (p.popular ? ' pop' : '') + '"><div class="cx-spread"><b>' + CH.esc(p.name) + '</b>' + (p.popular ? '<span class="cx-chip on">Popular</span>' : '') + '</div><div class="price">' + CH.esc(CH.money(p)) + '</div>' +
          (p.trialDays ? '<div class="cx-muted">' + p.trialDays + '-day free trial</div>' : '') +
          (p.desc ? '<p class="cx-muted" style="margin:6px 0">' + CH.esc(p.desc) + '</p>' : '') +
          ((p.bullets || []).length ? '<ul>' + p.bullets.map(function (b) { return '<li>' + CH.esc(b) + '</li>'; }).join('') + '</ul>' : '') +
          (free ? (p.joinMode === 'invite' ? '<button class="btn btn-ghost" disabled type="button" style="width:100%">Invite-only</button>' : '<button class="btn btn-primary cm-join" data-p="' + CH.esc(p.id) + '" type="button" style="width:100%">Join free</button>')
                : buyable(p) ? '<button class="btn btn-primary cm-buy" data-p="' + CH.esc(p.id) + '" type="button" style="width:100%">Join · ' + CH.esc(CP.short(p)) + '</button>'
                : '<button class="btn btn-ghost" disabled type="button" style="width:100%">Paid checkout opens soon</button>') + '</div>';
      });
      if (plans.some(buyable)) h += '<div class="cp-sold"><p>Sold by ' + CH.esc(cm.ownerName || 'the creator') + ', an independent creator. ' + CH.esc(CP.platformLine()) + '</p><p>Refunds: ask the creator first; their refund rule: ' + CH.esc(cm.refundRule) + '</p></div>';
      h += '<div id="cm-join-msg" class="cx-bad" role="alert"></div></div>';
    }
    h += '<div class="cx-box" style="margin-top:12px"><div class="cx-muted" style="margin-bottom:4px">Creator</div><b>' + CH.esc(cm.ownerName || 'Creator') + '</b>' +
      '<p class="cx-indie">Run by an independent creator, not by TradeZoro. TradeZoro does not verify creators or their claims. Education only. Not financial advice.</p>' +
      '<button class="btn btn-ghost" type="button" id="cm-report" style="margin-top:8px;width:100%">Report this community</button><div id="cm-rep" hidden></div></div>';
    el.innerHTML = h;
    var dcEl = document.getElementById('cm-discord'); if (dcEl) window.CHD.memberCard(dcEl, { cid: slug, cm: cm, mem: mem, me: me });

    el.querySelectorAll('.cm-join').forEach(function (b) { b.addEventListener('click', function () {
      if (!me) return CH.signIn();
      b.disabled = true;
      CH.join(slug, b.dataset.p).then(function (r) { if (r.ok) location.reload(); else { b.disabled = false; document.getElementById('cm-join-msg').textContent = r.data.message || 'Could not join. Try again.'; } })
        .catch(function () { b.disabled = false; document.getElementById('cm-join-msg').textContent = 'Could not join. You may be unable to join this community.'; });
    }); });
    el.querySelectorAll('.cm-buy').forEach(function (b) { b.addEventListener('click', function () {
      if (!me) return CH.signIn();
      var label = b.textContent, msgEl = document.getElementById('cm-join-msg');
      b.disabled = true; b.textContent = 'Opening secure checkout…'; msgEl.textContent = '';
      CP.call('checkout', { cid: slug, planId: b.dataset.p }).then(function (r) { location.href = r.url; })
        .catch(function (x) { b.disabled = false; b.textContent = label; msgEl.textContent = CP.errText(x); msgEl.className = CP.SWITCHING.test(msgEl.textContent) ? 'cx-muted' : 'cx-bad'; });
    }); });
    if (member && mem.source === 'paid' && window.CP) CP.bindMember(el, slug);
    var rb = document.getElementById('cm-redeem');
    if (rb) rb.addEventListener('click', function () {
      if (!me) return CH.signIn();
      rb.disabled = true;
      CH.redeem(slug, hasInvite).then(function (r) { if (r.ok) location.href = '/c/' + slug; else { rb.disabled = false; document.getElementById('cm-redeem-msg').textContent = r.data.message || 'That invite is not valid.'; } })
        .catch(function () { rb.disabled = false; document.getElementById('cm-redeem-msg').textContent = 'That invite is not valid, or you cannot join.'; });
    });
    var lv = document.getElementById('cm-leave');
    if (lv) lv.addEventListener('click', function () {
      if (!confirm('Leave this community? You lose access to anything your plan gave you.')) return;
      var b = db.batch();
      b.delete(db.collection('communities').doc(slug).collection('members').doc(me.uid));
      b.update(db.collection('communities').doc(slug), { memberCount: CH.inc(-1) });
      b.commit().then(function () { location.reload(); }).catch(function () { CH.toast('error', 'Could not leave. Try again.'); });
    });
    document.getElementById('cm-report').addEventListener('click', function () {
      if (!me) return CH.signIn();
      var box = document.getElementById('cm-rep'); box.hidden = false;
      box.innerHTML = '<div class="cx-f" style="margin-top:10px"><select id="cm-rr" class="cx-in-s" style="width:100%"><option value="scam">Scam or fraud</option><option value="results">Fake or misleading results</option><option value="copied">Copied or leaked material</option><option value="abuse">Abuse or harassment</option><option value="illegal">Illegal content</option><option value="other">Something else</option></select><textarea id="cm-rn" maxlength="500" placeholder="Details (optional)" class="cx-in" style="min-height:70px"></textarea><button class="btn btn-primary" id="cm-rs" type="button">Send report</button><div id="cm-rm" role="status"></div></div>';
      document.getElementById('cm-rs').onclick = function () {
        var d = { targetType: 'community', cid: slug, reporterUid: me.uid, reason: document.getElementById('cm-rr').value, status: 'open', createdAt: CH.ts() };
        var n = document.getElementById('cm-rn').value.trim(); if (n) d.note = n;
        db.collection('creatorReports').doc('community_' + slug + '_' + me.uid).set(d).then(function () { box.innerHTML = '<p class="cx-ok">Thanks. We will look at it.</p>'; })
          .catch(function () { document.getElementById('cm-rm').textContent = 'Could not send. You may have already reported this community.'; });
      };
    });
  }
})();
