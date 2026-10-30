// Creator Hub (creator.html): dashboard, settings, plans, members, invites, moderators for the owner of a community.
// Depends on: creator.js (CH), creator-pay.js (CP: Payouts card, paid-plan limits), firebase auth/firestore/storage/functions, progress.js (db).
// All writes go straight to Firestore and are checked by the rules (functions-src/firestore.rules, Creator Hub block);
// bulk email import goes through CH.importEmails (API first, rules-checked batches as fallback).
(function () {
  var root = document.getElementById('hb-root');
  var me, list = [], cid, cm, plans = [], members = [], invites = [], grants = [], bans = [], tab = (['dash', 'settings', 'plans', 'members', 'invites', 'indicators', 'courses', 'discord', 'mods'].indexOf(new URLSearchParams(location.search).get('tab')) >= 0 ? new URLSearchParams(location.search).get('tab') : 'dash');
  var payOpen = false, payAcct = null;   // payOpen: this viewer may use creator payments now (CP.open); payAcct: my payout status
  var TABS = [['dash', 'Dashboard'], ['settings', 'Settings'], ['plans', 'Plans'], ['members', 'Members'], ['invites', 'Invites'], ['indicators', 'Indicators'], ['courses', 'Courses'], ['discord', 'Discord'], ['mods', 'Moderators']];
  var FEATS = [['feed', 'Feed'], ['courses', 'Courses'], ['indicators', 'Indicators'], ['events', 'Events'], ['leaderboard', 'Leaderboard'], ['discord', 'Discord roles']];
  var $ = function (id) { return document.getElementById(id); };
  var cref = function () { return db.collection('communities').doc(cid); };
  var E = CH.esc;

  function note(t) { return '<div class="cx-note">' + t + '</div>'; }
  function flash(type, m) { CH.toast(type, m); }
  function fail(e) { flash('error', e && e.code === 'permission-denied' ? 'Not allowed. Check the values and try again.' : 'Something went wrong. Try again.'); }

  CH.user().then(function (u) {
    me = u;
    if (u && window.CP) CP.open(u).then(function (o) {
      payOpen = o; if (!o) return;
      if (list.length && tab === 'dash') draw();
      CP.call('status').then(function (r) { payAcct = r.account; if (list.length && tab === 'plans') draw(); }).catch(function () {});
    });
    if (!u) { root.innerHTML = '<div class="cx-empty">Sign in to manage your communities.<div style="margin-top:14px"><button class="btn btn-primary" id="hb-login" type="button">Sign in</button></div></div>'; $('hb-login').onclick = CH.signIn; return; }
    return db.collection('communities').where('ownerUid', '==', u.uid).get().then(function (s) {
      list = s.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
      if (!list.length) { root.innerHTML = '<div class="cx-empty">You have no community yet.<div style="margin-top:14px"><a class="btn btn-primary" href="/creator-new">Start your community</a> <a class="btn btn-ghost" href="/features/creators">Learn more</a></div></div>'; return; }
      var want = new URLSearchParams(location.search).get('c');
      cid = (list.filter(function (c) { return c.id === want; })[0] || list[0]).id;
      return load();
    });
  }).catch(function () { root.innerHTML = '<div class="cx-empty">Could not load. Check your connection and try again.</div>'; });

  function load() {
    var c = cref();
    return Promise.all([c.get(), c.collection('plans').get(), c.collection('members').get(), c.collection('invites').get(), c.collection('grants').get(), c.collection('bans').get()]).then(function (r) {
      if (!r[0].exists) { root.innerHTML = '<div class="cx-empty">This community was not found.</div>'; return; }
      cm = r[0].data(); cm.id = cid;
      plans = r[1].docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }).sort(function (a, b) { return a.order - b.order; });
      members = r[2].docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
      invites = r[3].docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
      grants = r[4].docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
      bans = r[5].docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
      draw();
    });
  }

  // Keep ?c= and ?tab= in step with what is on screen, so the app menu (and a reload or a shared link) lands on the same tab.
  function syncUrl() {
    try {
      var q = new URLSearchParams(location.search); q.set('c', cid); if (tab === 'dash') q.delete('tab'); else q.set('tab', tab); q.delete('new');
      history.replaceState(null, '', location.pathname + '?' + q.toString());
      window.dispatchEvent(new Event('cn:route'));
    } catch (e) {}
  }

  function draw() {
    if (!cm) return;
    var h = '<div class="cx-spread"><div><p class="cx-eyebrow">Creator Hub</p><h1 style="margin:0">' + E(cm.name) + '</h1></div><div class="cx-row">' +
      (list.length > 1 ? '<select class="cx-in-s" id="hb-sw" aria-label="Switch community">' + list.map(function (c) { return '<option value="' + E(c.id) + '"' + (c.id === cid ? ' selected' : '') + '>' + E(c.name) + '</option>'; }).join('') + '</select>' : '') +
      '<a class="btn btn-ghost" href="/c/' + E(cid) + '">View page</a>' + (list.length < CH.cfg.MAX_COMMUNITIES ? '<a class="btn btn-ghost" href="/creator-new">New community</a>' : '') + '</div></div>';
    var flashNote = ''; try { flashNote = sessionStorage.getItem('cx_note') || ''; sessionStorage.removeItem('cx_note'); } catch (e) {}
    if (new URLSearchParams(location.search).get('new')) h += note('<b>Your community is live.</b> ' + (flashNote ? E(flashNote) + ' ' : '') + 'Share the link: <b>tradezoro.com/c/' + E(cid) + '</b>');
    if (cm.status === 'suspended') h += note('<b class="cx-bad">This community is suspended by TradeZoro staff.</b> It is hidden from members until reviewed.');
    h += '<div class="cx-tabs" style="margin-top:14px" id="hb-tabs">' + TABS.map(function (t) { return '<button type="button" data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div id="hb-body"></div>';
    root.innerHTML = h;
    $('hb-tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { tab = b.dataset.t; syncUrl(); draw(); } });
    var sw = $('hb-sw'); if (sw) sw.onchange = function () { cid = sw.value; syncUrl(); load(); };
    ({ dash: dash, settings: settings, plans: plansView, members: membersView, invites: invitesView, mods: modsView, indicators: indView, courses: coView, discord: discView })[tab]($('hb-body'));
  }

  // ---------------------------------------------------------------- indicators (assets/creator-ind.js)
  function discView(el) {
    if (!window.CHD) { el.innerHTML = '<div class="cx-empty">Could not load the Discord tool. Reload the page.</div>'; return; }
    window.CHD.view(el, { cid: cid, cm: cm, plans: plans, reload: load });
  }
  function coView(el) {
    if (!window.CHCourses) { el.innerHTML = '<div class="cx-empty">Could not load the courses tool. Reload the page.</div>'; return; }
    if (cm.ownerUid !== me.uid) { el.innerHTML = '<div class="cx-empty">Only the community owner can build and sell courses.</div>'; return; }
    window.CHCourses.view(el, { cid: cid, cm: cm, plans: plans, members: members, reload: load });
  }
  function indView(el) {
    if (!window.CHInd) { el.innerHTML = '<div class="cx-empty">Could not load the indicators tool. Reload the page.</div>'; return; }
    if (cm.ownerUid !== me.uid) { el.innerHTML = '<div class="cx-empty">Only the community owner can publish and sell indicators.</div>'; return; }
    window.CHInd.view(el, { cid: cid, cm: cm, plans: plans, members: members, reload: load });
  }

  // ---------------------------------------------------------------- dashboard
  function dash(el) {
    var week = Date.now() - 7 * 86400000;
    var joins = members.filter(function (m) { return m.joinedAt && m.joinedAt.toMillis() > week && m.role !== 'owner'; }).length;
    var active = members.filter(function (m) { return CH.isActive(m); }).length;
    var live = plans.filter(function (p) { return p.status === 'live'; }).length;
    el.innerHTML = '<div class="cx-stats"><div class="cx-box cx-stat"><b>' + (cm.memberCount || 0) + '</b>Members</div><div class="cx-box cx-stat"><b>' + joins + '</b>Joins this week</div><div class="cx-box cx-stat"><b>' + live + '</b>Live plans (' + plans.length + ' total)</div><div class="cx-box cx-stat"><b>' + grants.length + '</b>Pending email invites</div></div>' +
      (payOpen ? '<div id="hb-pay" class="cp-slot"></div>' : note('<b>Paid checkout opens soon.</b> You can start free communities, invite links and member import today. Founding Creators: 0% TradeZoro fee during launch; payment-processor fees will apply once paid checkout opens.')) +
      '<div class="cx-box"><h2>Your link</h2><div class="cx-linkbox"><span>tradezoro.com/c/' + E(cid) + '</span><button class="btn btn-ghost" id="hb-copy" type="button">Copy</button></div><p class="cx-muted" style="margin-bottom:0">' + active + ' active of ' + members.length + ' member records.</p></div>';
    $('hb-copy').onclick = function () { copy('https://tradezoro.com/c/' + cid); };
    if (payOpen && $('hb-pay')) CP.payoutsCard($('hb-pay'), { cid: cid, me: me, onChange: function (a) { payAcct = a; } });
  }
  function copy(t) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { flash('success', 'Copied'); }).catch(function () { prompt('Copy this link:', t); }); }

  // ---------------------------------------------------------------- settings
  function settings(el) {
    var h = '<form class="cx-f cx-box" id="st-f" novalidate><h2>Community settings</h2>' +
      '<div><label for="st-name">Name</label><input id="st-name" type="text" maxlength="50" value="' + E(cm.name) + '"></div>' +
      '<div><label for="st-owner">Creator name shown on the page</label><input id="st-owner" type="text" maxlength="60" value="' + E(cm.ownerName) + '"></div>' +
      '<div><label for="st-tag">Tagline</label><input id="st-tag" type="text" maxlength="100" value="' + E(cm.tagline) + '"></div>' +
      '<div><label for="st-about">About</label><textarea id="st-about" maxlength="4000">' + E(cm.about) + '</textarea></div>' +
      '<div><label for="st-video">Intro video link (YouTube, Vimeo or Loom)</label><input id="st-video" type="url" value="' + E(cm.introVideo) + '"></div>' +
      '<div><label for="st-logo">Logo</label><div class="cx-imgpick av">' + (cm.logoUrl ? '<img class="cx-prev" id="st-logo-prev" src="' + E(cm.logoUrl) + '" alt="Current logo">' : '<img class="cx-prev" id="st-logo-prev" alt="" hidden>') + '<button type="button" class="btn btn-ghost" id="st-logo-b">' + (cm.logoUrl ? 'Replace and crop' : 'Choose and crop') + '</button><input id="st-logo" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><div class="hint">Square. You crop it before it uploads (saved at 512 × 512).</div></div>' +
      '<div><label for="st-cover">Cover</label><div class="cx-imgpick">' + (cm.coverUrl ? '<img class="cx-prev" id="st-cover-prev" src="' + E(cm.coverUrl) + '" alt="Current cover">' : '<img class="cx-prev" id="st-cover-prev" alt="" hidden>') + '<button type="button" class="btn btn-ghost" id="st-cover-b">' + (cm.coverUrl ? 'Replace and crop' : 'Choose and crop') + '</button><input id="st-cover" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><div class="hint">Wide, 3 : 1. You crop it before it uploads (saved 1800 px wide). The guide shows where the logo and title sit.</div></div>' +
      '<div><label for="st-accent">Accent colour</label><input id="st-accent" type="color" value="' + E(cm.accent) + '"></div>' +
      '<div><label>Topics (up to 3)</label><div class="cx-pick" id="st-tags">' + CH.TAGS.map(function (t) { return '<label><input type="checkbox" value="' + t[0] + '"' + ((cm.tags || []).indexOf(t[0]) >= 0 ? ' checked' : '') + '> ' + t[1] + '</label>'; }).join('') + '</div></div>' +
      '<div><label>Features members see</label><div class="cx-pick" id="st-feats">' + FEATS.map(function (f) { return '<label><input type="checkbox" value="' + f[0] + '"' + (cm.features && cm.features[f[0]] ? ' checked' : '') + '> ' + f[1] + '</label>'; }).join('') + '</div><div class="hint">Only the tabs you turn on show to members. Feed, Events and Leaderboard are for members only.</div></div>' +
      '<div><label for="st-refund">Refund rule for paid plans</label><textarea id="st-refund" maxlength="300" style="min-height:70px" placeholder="Example: Full refund within 7 days if you ask by email.">' + E(cm.refundRule || '') + '</textarea><div class="hint">Shown to buyers before they pay. You handle refunds yourself. Required before members can buy a paid plan.</div></div>' +
      '<div><label for="st-vis">Visibility</label><select id="st-vis"><option value="public">Public: listed in the directory</option><option value="unlisted">Unlisted: anyone with the link</option><option value="private">Private: invite link only</option></select></div>' +
      '<div id="st-err" class="cx-bad" role="alert"></div><div class="cx-actions"><button class="btn btn-primary" type="submit" id="st-save">Save changes</button></div></form>';
    el.innerHTML = h; $('st-vis').value = cm.visibility;
    var cropped = {};   // kind -> cropped Blob, uploaded on Save
    ['logo', 'cover'].forEach(function (k) {
      var inp = $('st-' + k), prev = $('st-' + k + '-prev');
      $('st-' + k + '-b').addEventListener('click', function () { inp.value = ''; inp.click(); });
      inp.addEventListener('change', function () {
        var f = inp.files[0]; if (!f) return; $('st-err').textContent = '';
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { inp.value = ''; return $('st-err').textContent = 'Images must be PNG, JPG or WebP.'; }
        if (f.size > 20 * 1024 * 1024) { inp.value = ''; return $('st-err').textContent = 'That image is too large. Pick one under 20 MB.'; }
        if (!window.ImgCrop) { inp.value = ''; return $('st-err').textContent = 'The image editor did not load. Reload the page.'; }
        ImgCrop.open(f, { kind: k === 'logo' ? 'avatar' : 'cover' }).then(function (b) {
          inp.value = ''; if (!b) return;
          cropped[k] = b; if (prev.dataset.u) URL.revokeObjectURL(prev.dataset.u);
          prev.dataset.u = URL.createObjectURL(b); prev.src = prev.dataset.u; prev.hidden = false; prev.alt = 'New ' + k + ' (not saved yet)';
          $('st-' + k + '-b').textContent = 'Crop another image';
        }).catch(function () { inp.value = ''; $('st-err').textContent = 'Could not read that image. Try a PNG, JPG or WebP.'; });
      });
    });
    ['st-tag', 'st-about'].forEach(function (i) { $(i).addEventListener('input', function () { CH.warnIf(this); }); });
    $('st-tags').addEventListener('change', function (e) { if (document.querySelectorAll('#st-tags input:checked').length > 3) { e.target.checked = false; $('st-err').textContent = 'Up to 3 topics.'; } });
    $('st-f').addEventListener('submit', function (e) {
      e.preventDefault(); var err = $('st-err'); err.textContent = '';
      var name = $('st-name').value.trim(), video = $('st-video').value.trim();
      if (name.length < 3) return err.textContent = 'Name needs at least 3 characters.';
      if (!$('st-owner').value.trim()) return err.textContent = 'Add the creator name.';
      if (!CH.videoOk(video)) return err.textContent = 'The intro video must be a YouTube, Vimeo or Loom link.';
      if (CH.RISKY.test($('st-tag').value + ' ' + $('st-about').value)) return err.textContent = 'Remove wording like "guaranteed", "100%" or "risk-free". It breaks the Creator Rules.';
      var tags = [].slice.call(document.querySelectorAll('#st-tags input:checked')).map(function (i) { return i.value; });
      var feats = {}; FEATS.forEach(function (f) { feats[f[0]] = !!document.querySelector('#st-feats input[value=' + f[0] + ']').checked; });
      var patch = { name: name, ownerName: $('st-owner').value.trim(), tagline: $('st-tag').value.trim(), about: $('st-about').value.trim(), introVideo: video, accent: $('st-accent').value, visibility: $('st-vis').value, tags: tags, features: feats, updatedAt: CH.ts() };
      var btn = $('st-save'); btn.disabled = true;
      var ups = [];
      [['logo', 'logoUrl'], ['cover', 'coverUrl']].forEach(function (k) {
        var f = cropped[k[0]]; if (!f) return;
        if (f.size > 5 * 1024 * 1024) { patch._bad = true; return; }
        var ref = firebase.storage().ref('communities/' + cid + '/branding/' + k[0]);
        ups.push(ref.put(f, { contentType: f.type }).then(function () { return ref.getDownloadURL(); }).then(function (u) { patch[k[1]] = u; }));
      });
      if (patch._bad) { btn.disabled = false; return err.textContent = 'Images must be PNG, JPG or WebP, up to 5 MB.'; }
      var refund = $('st-refund').value.trim();
      if (CH.RISKY.test(refund)) { btn.disabled = false; return err.textContent = 'Remove wording like "guaranteed" or "risk-free" from the refund rule.'; }
      Promise.all(ups).then(function () { return cref().update(patch); }).then(function () {
        if (refund === (cm.refundRule || '')) return;
        return cref().update({ refundRule: refund, updatedAt: CH.ts() }).catch(function () { flash('info', 'Saved. The refund rule will save once paid checkout opens.'); });
      }).then(function () { flash('success', 'Saved'); return load(); })
        .catch(function (x) { btn.disabled = false; err.textContent = 'Could not save. Check the values and try again.'; });
    });
  }

  // ---------------------------------------------------------------- plans
  function plansView(el) {
    var h = '<div class="cx-spread" style="margin-bottom:12px"><h2 style="margin:0">Plans</h2>' + (plans.length < 8 ? '<button class="btn btn-primary" id="pl-new" type="button">Add plan</button>' : '') + '</div>' +
      (payOpen ? note(payAcct && payAcct.status === 'active' ? '<b>Payouts are active.</b> Paid plans (US dollars, $' + CP.MIN + ' to $' + CP.MAX + ', monthly, yearly or one-time) are on sale as soon as they are Live.' + (cm.refundRule ? '' : ' <b>Add a refund rule under Settings</b> first: buyers see it before they pay.')
          : '<b>Set up payouts</b> on the Dashboard tab to sell paid plans. Until then you can run free plans and give access by invite link or email.')
        : note('<b>Paid checkout opens soon.</b> Priced plans are saved with their price and show "Paid checkout opens soon" to members. Give people access to any plan by invite link or by email.'));
    h += '<div id="pl-form"></div>';
    h += plans.length ? plans.map(function (p, i) {
      return '<div class="cx-box" style="margin-bottom:10px"><div class="cx-spread"><div><b>' + E(p.name) + '</b> ' + (p.popular ? '<span class="cx-chip on">Popular</span> ' : '') + '<span class="cx-chip' + (p.status === 'live' ? ' on' : '') + '">' + (p.status === 'live' ? 'Live' : 'Draft') + '</span> <span class="cx-chip">' + E(p.joinMode === 'invite' ? 'Invite-only' : 'Open') + '</span>' +
        '<div class="cx-muted">' + E(CH.money(p)) + (p.trialDays ? ' · ' + p.trialDays + '-day trial' : '') + '</div></div>' +
        '<div class="cx-row"><button class="btn btn-ghost pl-up" data-i="' + i + '" type="button" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="btn btn-ghost pl-dn" data-i="' + i + '" type="button" aria-label="Move down"' + (i === plans.length - 1 ? ' disabled' : '') + '>↓</button><button class="btn btn-ghost pl-ed" data-i="' + i + '" type="button">Edit</button><button class="btn btn-ghost pl-del" data-i="' + i + '" type="button">Delete</button></div></div></div>';
    }).join('') : '<div class="cx-empty">No plans yet.</div>';
    el.innerHTML = h;
    var nb = $('pl-new'); if (nb) nb.onclick = function () { planForm(null); };
    el.querySelectorAll('.pl-ed').forEach(function (b) { b.onclick = function () { planForm(plans[+b.dataset.i]); }; });
    el.querySelectorAll('.pl-up').forEach(function (b) { b.onclick = function () { move(+b.dataset.i, -1); }; });
    el.querySelectorAll('.pl-dn').forEach(function (b) { b.onclick = function () { move(+b.dataset.i, 1); }; });
    el.querySelectorAll('.pl-del').forEach(function (b) { b.onclick = function () {
      var p = plans[+b.dataset.i], used = members.filter(function (m) { return m.planId === p.id; }).length;
      if (used && !confirm(used + ' member(s) are on this plan. Delete it anyway? They keep their member record.')) return;
      if (!used && !confirm('Delete plan "' + p.name + '"?')) return;
      cref().collection('plans').doc(p.id).delete().then(load).catch(fail);
    }; });
  }
  function move(i, d) {
    var a = plans[i], b = plans[i + d]; if (!b) return;
    var batch = db.batch();
    batch.update(cref().collection('plans').doc(a.id), { order: b.order === a.order ? a.order + d : b.order, updatedAt: CH.ts() });
    batch.update(cref().collection('plans').doc(b.id), { order: a.order === b.order ? b.order - d : a.order, updatedAt: CH.ts() });
    batch.commit().then(load).catch(fail);
  }
  function planForm(p) {
    var pr = p ? p.price : { amount: 0, currency: 'USD', interval: 'free' }, f = $('pl-form');
    // strict = creator payments are open for this viewer: the server limits apply (USD, $1-$999, month/year/one-time,
    // trial 0-30), and paid billing is only offered once payouts are Active. Otherwise phase-A behaviour (price saved,
    // shown as "Paid checkout opens soon").
    var strict = payOpen && !!window.CP, paidOk = strict && payAcct && payAcct.status === 'active';
    function billingOpts(cur) {
      var all = [['free', 'Free'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly'], ['lifetime', 'One-time']];
      return all.filter(function (o) {
        if (!strict) return true;
        if (o[0] === cur.interval) return true;
        return o[0] === 'free' || (paidOk && o[0] !== 'week');
      }).map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
    }
    f.innerHTML = '<form class="cx-f cx-box" id="pf" style="margin-bottom:12px" novalidate><h3>' + (p ? 'Edit plan' : 'New plan') + '</h3>' +
      '<div><label for="pf-name">Name</label><input id="pf-name" type="text" maxlength="40" value="' + E(p ? p.name : '') + '"></div>' +
      '<div class="cx-row"><div style="flex:1 1 110px"><label for="pf-int">Billing</label><select id="pf-int">' + billingOpts(pr) + '</select></div>' +
      '<div style="flex:1 1 100px"><label for="pf-amt">Price</label><input id="pf-amt" type="number" min="0" max="' + (strict ? CP.MAX : 100000) + '" step="1" value="' + (pr.amount || '') + '"></div>' +
      '<div style="flex:1 1 90px"><label for="pf-cur">Currency</label><select id="pf-cur"><option>USD</option>' + (strict && pr.currency !== 'INR' ? '' : '<option>INR</option>') + '</select></div>' +
      '<div style="flex:1 1 100px"><label for="pf-trial">Trial days</label><input id="pf-trial" type="number" min="0" max="' + (strict ? CP.TRIAL_MAX : 90) + '" step="1" value="' + (p ? p.trialDays : 0) + '"></div></div>' +
      (strict ? '<div class="hint" id="pf-hint">' + (paidOk ? 'Paid plans: US dollars, $' + CP.MIN + ' to $' + CP.MAX + '. Free trial 0 to ' + CP.TRIAL_MAX + ' days (monthly and yearly only).' : 'Paid billing unlocks when your payouts are Active (Dashboard tab).') + '</div>' : '') +
      '<div><label for="pf-desc">Short description</label><textarea id="pf-desc" maxlength="300" style="min-height:70px">' + E(p ? p.desc : '') + '</textarea></div>' +
      '<div><label for="pf-bul">What is included (one per line, up to 8)</label><textarea id="pf-bul" style="min-height:90px">' + E(p ? (p.bullets || []).join('\n') : '') + '</textarea></div>' +
      '<div class="cx-row"><div style="flex:1 1 140px"><label for="pf-status">Status</label><select id="pf-status"><option value="draft">Draft (hidden)</option><option value="live">Live</option></select></div>' +
      '<div style="flex:1 1 140px"><label for="pf-mode">Joining</label><select id="pf-mode"><option value="open">Open</option><option value="invite">Invite-only</option></select></div></div>' +
      '<label class="cx-check"><input type="checkbox" id="pf-pop"' + (p && p.popular ? ' checked' : '') + '><span>Mark as popular</span></label>' +
      '<div id="pf-err" class="cx-bad" role="alert"></div><div class="cx-actions"><button class="btn btn-ghost" type="button" id="pf-cancel">Cancel</button><button class="btn btn-primary" type="submit">Save plan</button></div></form>';
    $('pf-int').value = pr.interval; $('pf-cur').value = pr.currency; $('pf-status').value = p ? p.status : 'draft'; $('pf-mode').value = p ? (p.joinMode || 'open') : 'open';
    $('pf-cancel').onclick = function () { f.innerHTML = ''; };
    ['pf-desc', 'pf-bul'].forEach(function (i) { $(i).addEventListener('input', function () { CH.warnIf(this); }); });
    $('pf').addEventListener('submit', function (e) {
      e.preventDefault(); var err = $('pf-err'); err.textContent = '';
      var free = $('pf-int').value === 'free', amt = free ? 0 : +$('pf-amt').value, bul = $('pf-bul').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      if (!$('pf-name').value.trim()) return err.textContent = 'Name the plan.';
      if (!free && !(amt >= 1 && amt <= 100000)) return err.textContent = 'Enter a price between 1 and 100000.';
      if (strict && !free) {
        if ($('pf-cur').value !== 'USD' || ['month', 'year', 'lifetime'].indexOf($('pf-int').value) < 0) return err.textContent = 'Paid plans are sold in US dollars, monthly, yearly or one-time.';
        if (!(amt >= CP.MIN && amt <= CP.MAX)) return err.textContent = 'Enter a price from $' + CP.MIN + ' to $' + CP.MAX + '.';
        if (+$('pf-trial').value > CP.TRIAL_MAX) return err.textContent = 'Free trial: 0 to ' + CP.TRIAL_MAX + ' days.';
        if ($('pf-int').value === 'lifetime' && +$('pf-trial').value > 0) return err.textContent = 'One-time plans have no free trial. Set trial days to 0.';
      }
      if (bul.length > 8 || bul.some(function (b) { return b.length > 120; })) return err.textContent = 'Up to 8 lines, 120 characters each.';
      var tr = +$('pf-trial').value; if (!(tr >= 0 && tr <= 90 && tr % 1 === 0)) return err.textContent = 'Trial days: 0 to 90.';
      if (CH.RISKY.test($('pf-desc').value + ' ' + bul.join(' '))) return err.textContent = 'Remove wording like "guaranteed" or "risk-free".';
      var id = p ? p.id : null;
      if (!id) { for (var n = 1; n <= 8; n++) if (!plans.some(function (x) { return x.id === 'p' + n; })) { id = 'p' + n; break; } }
      var doc = { name: $('pf-name').value.trim(), desc: $('pf-desc').value.trim(), bullets: bul, price: { amount: amt, currency: $('pf-cur').value, interval: $('pf-int').value },
        trialDays: tr, popular: $('pf-pop').checked, status: $('pf-status').value, joinMode: $('pf-mode').value, order: p ? p.order : plans.length, updatedAt: CH.ts() };
      if (p && p.discordRoleId) doc.discordRoleId = p.discordRoleId;
      cref().collection('plans').doc(id).set(doc).then(function () { flash('success', 'Plan saved'); return load(); }).catch(function () { err.textContent = 'Could not save the plan. Check the values.'; });
    });
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------------------------------------------------------------- members
  var mq = '', mf = '';
  function planName(id) { var p = plans.filter(function (x) { return x.id === id; })[0]; return p ? p.name : (id ? '(deleted plan)' : 'Owner'); }
  function dateIn(t) { return t ? (t.toDate ? t.toDate() : new Date(t)).toISOString().slice(0, 10) : ''; }
  function membersView(el) {
    var rows = members.filter(function (m) {
      var s = (m.displayName || '') + ' ' + m.uid;
      return (!mq || s.toLowerCase().indexOf(mq) >= 0) && (!mf || (mf === 'expired' ? !CH.isActive(m) : m.status === mf));
    }).sort(function (a, b) { return (b.joinedAt ? b.joinedAt.toMillis() : 0) - (a.joinedAt ? a.joinedAt.toMillis() : 0); });
    var h = '<div class="cx-search"><input class="cx-in" id="mb-q" type="search" placeholder="Search members" value="' + E(mq) + '" aria-label="Search members"><select class="cx-in-s" id="mb-f" aria-label="Filter"><option value="">All</option><option value="active">Active</option><option value="expired">Expired</option><option value="banned">Banned</option></select></div>';
    h += '<div class="cx-tablewrap"><table class="cx-table"><thead><tr><th>Member</th><th>Plan</th><th>Role</th><th>Expires</th><th>Joined</th><th></th></tr></thead><tbody>' + rows.map(function (m) {
      var own = m.role === 'owner';
      return '<tr data-u="' + E(m.id) + '"><td>' + E(m.displayName || 'Member') + (m.status !== 'active' ? ' <span class="cx-chip">' + E(m.status) + '</span>' : '') + '<div class="cx-muted" style="font-size:11px">via ' + E(m.source) + '</div></td>' +
        '<td>' + (own ? 'Owner' : '<select class="cx-in-s mb-plan">' + plans.map(function (p) { return '<option value="' + E(p.id) + '"' + (p.id === m.planId ? ' selected' : '') + '>' + E(p.name) + '</option>'; }).join('') + (plans.some(function (p) { return p.id === m.planId; }) ? '' : '<option value="' + E(m.planId) + '" selected>' + E(planName(m.planId)) + '</option>') + '</select>') + '</td>' +
        '<td>' + (own ? 'Owner' : '<select class="cx-in-s mb-role"><option value="member"' + (m.role === 'member' ? ' selected' : '') + '>Member</option><option value="mod"' + (m.role === 'mod' ? ' selected' : '') + '>Moderator</option><option value="admin"' + (m.role === 'admin' ? ' selected' : '') + '>Admin</option></select>') + '</td>' +
        '<td>' + (own ? '' : '<input type="date" class="cx-in-s mb-exp" value="' + dateIn(m.expiresAt) + '" aria-label="Expiry date">') + '</td><td>' + E(CH.date(m.joinedAt)) + '</td>' +
        '<td>' + (own ? '' : '<div class="cx-row" style="flex-wrap:nowrap"><button class="btn btn-ghost mb-save" type="button">Save</button><button class="btn btn-ghost mb-exp-now" type="button">Expire</button><button class="btn btn-ghost mb-rm" type="button">Remove</button></div>') + '</td></tr>';
    }).join('') + '</tbody></table></div>' + (rows.length ? '' : '<div class="cx-empty" style="margin-top:10px">No members match.</div>');

    h += '<div class="cx-box" style="margin-top:18px"><h2>Add members by email</h2><p class="cx-muted">Paste emails (one per line or separated by commas). Each person gets access to the plan when they sign up or sign in with that email and open your community. Nothing is emailed from here.</p><form class="cx-f" id="im-f" novalidate>' +
      '<textarea id="im-list" class="cx-in" placeholder="name@example.com" style="min-height:110px"></textarea><div class="cx-row"><div style="flex:1 1 160px"><label for="im-plan">Plan</label><select id="im-plan">' + plans.map(function (p) { return '<option value="' + E(p.id) + '">' + E(p.name) + '</option>'; }).join('') + '</select></div><div style="flex:1 1 160px"><label for="im-exp">Access ends (optional)</label><input type="date" id="im-exp"></div></div>' +
      '<div id="im-msg" role="status"></div><div class="cx-actions"><button class="btn btn-primary" type="submit">Add members</button></div></form>' +
      (grants.length ? '<h3 style="margin-top:14px">Pending (' + grants.length + ')</h3><div class="cx-tablewrap" style="max-height:240px;overflow:auto"><table class="cx-table"><tbody>' + grants.map(function (g) { return '<tr data-g="' + E(g.id) + '"><td>' + E(g.email) + '</td><td>' + E(planName(g.planId)) + '</td><td>' + (g.expiresAt ? 'until ' + E(CH.date(g.expiresAt)) : '') + '</td><td><button class="btn btn-ghost gr-del" type="button">Cancel</button></td></tr>'; }).join('') + '</tbody></table></div>' : '') + '</div>';

    h += '<div class="cx-box" style="margin-top:18px"><h2>Ban by email</h2><p class="cx-muted">A banned email cannot join this community again. Remove the person from the table above too.</p><form class="cx-row" id="bn-f"><input class="cx-in" id="bn-em" type="email" placeholder="email@example.com" style="flex:1 1 220px"><button class="btn btn-primary" type="submit">Ban</button></form>' +
      (bans.length ? '<div class="cx-row" style="margin-top:10px">' + bans.map(function (b) { return '<span class="cx-chip">' + E(b.email) + ' <button type="button" class="bn-del" data-e="' + E(b.id) + '" aria-label="Unban" style="background:none;border:0;color:inherit;cursor:pointer">×</button></span>'; }).join('') + '</div>' : '') + '</div>';
    $('hb-body').innerHTML = h;
    $('mb-f').value = mf;
    $('mb-q').oninput = function () { mq = this.value.trim().toLowerCase(); var s = this.selectionStart; membersView($('hb-body')); var q = $('mb-q'); q.focus(); q.setSelectionRange(s, s); };
    $('mb-f').onchange = function () { mf = this.value; membersView($('hb-body')); };
    $('hb-body').querySelectorAll('tr[data-u]').forEach(function (tr) {
      var u = tr.dataset.u, m = members.filter(function (x) { return x.id === u; })[0];
      var sv = tr.querySelector('.mb-save'); if (!sv) return;
      sv.onclick = function () {
        var exp = tr.querySelector('.mb-exp').value, patch = { planId: tr.querySelector('.mb-plan').value, role: tr.querySelector('.mb-role').value, expiresAt: exp ? CH.stamp(new Date(exp + 'T23:59:59')) : null, status: m.status === 'expired' && !exp ? 'active' : m.status };
        if (exp && new Date(exp + 'T23:59:59') < new Date()) patch.status = 'expired'; else if (m.status === 'expired') patch.status = 'active';
        cref().collection('members').doc(u).update(patch).then(function () { flash('success', 'Saved'); return load(); }).catch(function () { flash('error', 'Not allowed. Only the owner can make admins.'); });
      };
      tr.querySelector('.mb-exp-now').onclick = function () { if (confirm('Expire this member now?')) cref().collection('members').doc(u).update({ status: 'expired', expiresAt: CH.stamp(new Date()) }).then(load).catch(fail); };
      tr.querySelector('.mb-rm').onclick = function () {
        if (!confirm('Remove ' + (m.displayName || 'this member') + ' from the community?')) return;
        var b = db.batch(); b.delete(cref().collection('members').doc(u)); b.update(cref(), { memberCount: CH.inc(-1) }); b.commit().then(load).catch(fail);
      };
    });
    $('im-f').onsubmit = function (e) {
      e.preventDefault(); var msg = $('im-msg'); msg.className = ''; msg.textContent = '';
      var emails = $('im-list').value.split(/[\s,;]+/).filter(Boolean), exp = $('im-exp').value;
      if (!emails.length) { msg.className = 'cx-bad'; return msg.textContent = 'Paste at least one email.'; }
      if (!plans.length) { msg.className = 'cx-bad'; return msg.textContent = 'Create a plan first.'; }
      CH.importEmails(cid, $('im-plan').value, emails, exp ? exp + 'T23:59:59Z' : null).then(function (r) {
        if (!r.ok) { msg.className = 'cx-bad'; return msg.textContent = (r.data && r.data.message) || 'Could not add them.'; }
        flash('success', r.data.added + ' added'); load();
      }).catch(fail);
    };
    $('hb-body').querySelectorAll('.gr-del').forEach(function (b) { b.onclick = function () { cref().collection('grants').doc(b.closest('tr').dataset.g).delete().then(load).catch(fail); }; });
    $('bn-f').onsubmit = function (e) {
      e.preventDefault(); var em = $('bn-em').value.trim().toLowerCase();
      if (!/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]{2,}$/.test(em)) return flash('error', 'Enter a valid email.');
      cref().collection('bans').doc(em).set({ email: em, createdBy: me.uid, createdAt: CH.ts() }).then(function () { flash('success', 'Banned'); return load(); }).catch(fail);
    };
    $('hb-body').querySelectorAll('.bn-del').forEach(function (b) { b.onclick = function () { cref().collection('bans').doc(b.dataset.e).delete().then(load).catch(fail); }; });
  }

  // ---------------------------------------------------------------- invites
  function code() { var a = new Uint8Array(12), s = ''; crypto.getRandomValues(a); var c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; for (var i = 0; i < 12; i++) s += c[a[i] % c.length]; return s; }
  function invitesView(el) {
    var h = '<form class="cx-f cx-box" id="iv-f" novalidate><h2>New invite</h2><div class="cx-row"><div style="flex:1 1 150px"><label for="iv-plan">Plan</label><select id="iv-plan">' + plans.map(function (p) { return '<option value="' + E(p.id) + '">' + E(p.name) + '</option>'; }).join('') + '</select></div>' +
      '<div style="flex:1 1 110px"><label for="iv-max">Max uses (0 = unlimited)</label><input id="iv-max" type="number" min="0" max="100000" step="1" value="10"></div><div style="flex:1 1 150px"><label for="iv-exp">Invite expires (optional)</label><input id="iv-exp" type="date"></div>' +
      '<div style="flex:1 1 130px"><label for="iv-days">Access lasts (days, 0 = no end)</label><input id="iv-days" type="number" min="0" max="3650" step="1" value="0"></div></div>' +
      '<div><label for="iv-label">Label (only you see it)</label><input id="iv-label" type="text" maxlength="60"></div><div id="iv-err" class="cx-bad" role="alert"></div><div class="cx-actions"><button class="btn btn-primary" type="submit"' + (plans.length ? '' : ' disabled') + '>Create invite</button></div></form>';
    h += '<h2 style="margin-top:20px">Your invites</h2>' + (invites.length ? invites.sort(function (a, b) { return (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0); }).map(function (i) {
      var url = 'https://tradezoro.com/c/' + cid + '?invite=' + i.id, dead = i.status !== 'active' || (i.expiresAt && i.expiresAt.toDate() < new Date()) || (i.maxUses > 0 && i.uses >= i.maxUses);
      return '<div class="cx-box" style="margin-bottom:10px"><div class="cx-spread"><div><b>' + E(i.label || 'Invite') + '</b> <span class="cx-chip' + (dead ? '' : ' on') + '">' + (i.status !== 'active' ? 'Revoked' : dead ? 'Used up or expired' : 'Active') + '</span><div class="cx-muted">' + E(planName(i.planId)) + ' · ' + i.uses + ' / ' + (i.maxUses || '∞') + ' used' + (i.expiresAt ? ' · ends ' + E(CH.date(i.expiresAt)) : '') + (i.grantDays ? ' · ' + i.grantDays + ' days access' : '') + '</div></div>' +
        '<div class="cx-row"><button class="btn btn-ghost iv-copy" data-u="' + E(url) + '" type="button">Copy link</button><button class="btn btn-ghost iv-code" data-c="' + E(i.id) + '" type="button">Copy code</button>' + (i.status === 'active' ? '<button class="btn btn-ghost iv-rev" data-c="' + E(i.id) + '" type="button">Revoke</button>' : '') + '</div></div></div>';
    }).join('') : '<div class="cx-empty">No invites yet.</div>');
    el.innerHTML = h;
    $('iv-f').onsubmit = function (e) {
      e.preventDefault(); var err = $('iv-err'); err.textContent = '';
      var mx = +$('iv-max').value, dy = +$('iv-days').value, exp = $('iv-exp').value;
      if (!(mx >= 0 && mx % 1 === 0 && mx <= 100000)) return err.textContent = 'Max uses must be a whole number.';
      if (!(dy >= 0 && dy % 1 === 0 && dy <= 3650)) return err.textContent = 'Access days must be a whole number.';
      var d = { planId: $('iv-plan').value, uses: 0, maxUses: mx, expiresAt: exp ? CH.stamp(new Date(exp + 'T23:59:59')) : null, grantDays: dy, label: $('iv-label').value.trim(), status: 'active', createdBy: me.uid, createdAt: CH.ts() };
      cref().collection('invites').doc(code()).set(d).then(function () { flash('success', 'Invite created'); return load(); }).catch(function () { err.textContent = 'Could not create the invite.'; });
    };
    el.querySelectorAll('.iv-copy').forEach(function (b) { b.onclick = function () { copy(b.dataset.u); }; });
    el.querySelectorAll('.iv-code').forEach(function (b) { b.onclick = function () { copy(b.dataset.c); }; });
    el.querySelectorAll('.iv-rev').forEach(function (b) { b.onclick = function () { if (confirm('Revoke this invite? The link stops working.')) cref().collection('invites').doc(b.dataset.c).update({ status: 'revoked' }).then(load).catch(fail); }; });
  }

  // ---------------------------------------------------------------- moderators
  function modsView(el) {
    var staff = members.filter(function (m) { return m.role === 'admin' || m.role === 'mod' || m.role === 'owner'; });
    el.innerHTML = note('<b>Admins</b> manage plans, members and invites. <b>Moderators</b> are flagged as moderators for the features that need them (they can pin and delete posts and comments in the Feed). Only you, the owner, can make or remove admins. To add one, they join first, then you change their role under Members.') +
      '<div class="cx-tablewrap"><table class="cx-table" style="min-width:420px"><thead><tr><th>Name</th><th>Role</th><th></th></tr></thead><tbody>' + staff.map(function (m) {
        return '<tr data-u="' + E(m.id) + '"><td>' + E(m.displayName || 'Member') + '</td><td>' + E(m.role === 'mod' ? 'Moderator' : m.role === 'admin' ? 'Admin' : 'Owner') + '</td><td>' + (m.role === 'owner' ? '' : '<button class="btn btn-ghost md-rm" type="button">Make member</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    el.querySelectorAll('.md-rm').forEach(function (b) { b.onclick = function () { cref().collection('members').doc(b.closest('tr').dataset.u).update({ role: 'member' }).then(load).catch(function () { flash('error', 'Only the owner can remove an admin.'); }); }; });
  }
})();
