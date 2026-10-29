// Community public page + member view (c.html, served for /c/<slug>).
// Depends on: creator.js (CH), firebase auth/firestore, progress.js (db).
(function () {
  var root = document.getElementById('cm-root');
  var slug = (location.pathname.match(/^\/c\/([a-z0-9-]+)/) || location.search.match(/[?&]c=([a-z0-9-]+)/) || [])[1];
  var cm, plans = [], me = null, mem = null, tab = 'about', hasInvite = '';
  var FEATS = [['feed', 'Feed'], ['courses', 'Courses'], ['indicators', 'Indicators'], ['events', 'Events'], ['leaderboard', 'Leaderboard']];

  function msg(t) { root.innerHTML = '<div class="cx-empty">' + t + '</div>'; }
  if (!slug) return msg('Community not found. <a href="/communities" style="color:var(--gold-bright)">Browse communities</a>');

  try { var u = new URLSearchParams(location.search); hasInvite = (u.get('invite') || '').replace(/[^A-Za-z0-9]/g, ''); } catch (e) {}

  Promise.all([CH.user()]).then(function (r) { me = r[0]; return db.collection('communities').doc(slug).get(); }).then(function (d) {
    if (!d.exists) return msg('Community not found. <a href="/communities" style="color:var(--gold-bright)">Browse communities</a>');
    cm = d.data(); cm.id = d.id;
    document.title = cm.name + ' — TradeZoro';
    if (cm.status === 'suspended') return msg('This community is not available right now.');
    var q = [db.collection('communities').doc(slug).collection('plans').where('status', '==', 'live').get().then(function (s) { plans = s.docs.map(function (x) { var o = x.data(); o.id = x.id; return o; }).sort(function (a, b) { return a.order - b.order; }); }).catch(function () { plans = []; })];
    if (me) q.push(db.collection('communities').doc(slug).collection('members').doc(me.uid).get().then(function (m) { mem = m.exists ? m.data() : null; }).catch(function () { mem = null; }));
    return Promise.all(q).then(draw);
  }).catch(function () { msg('Could not load this community. Check your connection and try again.'); });

  function isOwner() { return me && cm.ownerUid === me.uid; }
  function enabled() { return FEATS.filter(function (f) { return cm.features && cm.features[f[0]]; }); }

  function draw() {
    var accent = /^#[0-9a-fA-F]{6}$/.test(cm.accent) ? cm.accent : '#03c988';
    var cover = cm.coverUrl ? 'background-image:url(' + CH.esc(cm.coverUrl) + ')' : 'background:linear-gradient(135deg,' + accent + '40,#0b0b0d)';
    var logo = cm.logoUrl ? '<img src="' + CH.esc(cm.logoUrl) + '" alt="">' : CH.esc((cm.name || '?').charAt(0).toUpperCase());
    var member = mem && CH.isActive(mem);
    var h = '<div class="cx-cover" style="' + cover + '"></div>' +
      '<div class="cx-head"><div class="cx-logo" style="border-color:' + accent + '">' + logo + '</div><div class="cx-t"><h1>' + CH.esc(cm.name) + '</h1>' +
      '<div class="cx-muted">' + CH.esc(cm.tagline || '') + '</div></div>' +
      (isOwner() ? '<a class="btn btn-ghost" href="/creator?c=' + CH.esc(slug) + '">Manage</a>' : '') + '</div>' +
      '<div class="cx-row" style="margin:12px 14px 0">' + (cm.tags || []).map(function (t) { return '<span class="cx-chip">' + CH.esc(CH.tagLabel(t)) + '</span>'; }).join('') +
      '<span class="cx-chip">' + (cm.memberCount || 0) + ' member' + (cm.memberCount === 1 ? '' : 's') + '</span>' +
      (cm.visibility === 'private' ? '<span class="cx-chip">Private</span>' : '') + '</div>';
    var tabs = [['about', 'About']];
    if (member) enabled().forEach(function (f) { tabs.push(f); });
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
        h += '<div class="cx-box"><h2>About</h2>' + (cm.about ? CH.para(cm.about) : '<p class="cx-muted">No description yet.</p>') + '</div>';
      }
      el.innerHTML = h;
      return;
    }
    var names = { feed: 'Feed', courses: 'Courses', indicators: 'Indicators', events: 'Events', leaderboard: 'Leaderboard' };
    // None of these ship in Phase A, so each says so honestly.
    el.innerHTML = '<div class="cx-empty"><h3>' + names[tab] + '</h3>Coming soon. ' + CH.esc(cm.ownerName || 'The creator') + ' has turned this on; it will appear here when it launches.</div>';
  }

  function side(member) {
    var el = document.getElementById('cm-side'), h = '';
    if (isOwner()) h += '<div class="cx-box" style="margin-bottom:12px"><b>You run this community.</b><p class="cx-muted">Members see the page below. Manage it in the Creator Hub.</p></div>';
    else if (member) h += '<div class="cx-box" style="margin-bottom:12px"><b class="cx-ok">You are a member</b>' + (mem.expiresAt ? '<p class="cx-muted">Access until ' + CH.esc(CH.date(mem.expiresAt)) + '</p>' : '') + '<div style="margin-top:10px"><button class="btn btn-ghost" type="button" id="cm-leave">Leave community</button></div></div>';
    else if (hasInvite) h += '<div class="cx-box" style="margin-bottom:12px"><b>You have an invite</b><p class="cx-muted">Join ' + CH.esc(cm.name) + ' with your invite link.</p><button class="btn btn-primary" type="button" id="cm-redeem">Use invite</button><div id="cm-redeem-msg" class="cx-bad" role="alert"></div></div>';
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
                : '<button class="btn btn-ghost" disabled type="button" style="width:100%">Paid checkout opens soon</button>') + '</div>';
      });
      h += '<div id="cm-join-msg" class="cx-bad" role="alert"></div></div>';
    }
    h += '<div class="cx-box" style="margin-top:12px"><div class="cx-muted" style="margin-bottom:4px">Creator</div><b>' + CH.esc(cm.ownerName || 'Creator') + '</b>' +
      '<p class="cx-indie">Run by an independent creator, not by TradeZoro. TradeZoro does not verify creators or their claims. Education only. Not financial advice.</p>' +
      '<button class="btn btn-ghost" type="button" id="cm-report" style="margin-top:8px;width:100%">Report this community</button><div id="cm-rep" hidden></div></div>';
    el.innerHTML = h;

    el.querySelectorAll('.cm-join').forEach(function (b) { b.addEventListener('click', function () {
      if (!me) return CH.signIn();
      b.disabled = true;
      CH.join(slug, b.dataset.p).then(function (r) { if (r.ok) location.reload(); else { b.disabled = false; document.getElementById('cm-join-msg').textContent = r.data.message || 'Could not join. Try again.'; } })
        .catch(function () { b.disabled = false; document.getElementById('cm-join-msg').textContent = 'Could not join. You may be unable to join this community.'; });
    }); });
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
