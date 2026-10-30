// Community public page + member view (c.html, served for /c/<slug>).
// Depends on: creator.js (CH), creator-pay.js (CP: paid join + member billing), firebase auth/firestore/functions, progress.js (db).
(function () {
  var root = document.getElementById('cm-root');
  var slug = (location.pathname.match(/^\/c\/([a-z0-9-]+)/) || location.search.match(/[?&]c=([a-z0-9-]+)/) || [])[1];
  var cm, plans = [], me = null, mem = null, tab = 'about', hasInvite = '', inds = null, myAccess = {}, payOpen = false, paidBack = '';
  var qs = new URLSearchParams(location.search);
  if (qs.get('tab') === 'indicators') tab = 'indicators';
  if (qs.get('tab') === 'courses') tab = 'courses';
  if (qs.get('tab') === 'feed' || qs.get('tab') === 'events') tab = qs.get('tab');   // app menu deep links (owner: Feed & events)
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
    q.push(loadCounts());
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

  // ---------------------------------------------------------------- page design (Profile layout, 2026-10-31)
  var IC = {
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    course: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    ind: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    charts: '<path d="M7 3v3M7 17v4M17 3v5M17 15v6"/><rect x="4.5" y="6" width="5" height="11" rx="1"/><rect x="14.5" y="8" width="5" height="7" rx="1"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    web: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    x: '<path d="M4 4l16 16M20 4L4 20"/>',
    yt: '<path d="M22.5 7.2a2.5 2.5 0 0 0-1.8-1.8C19.1 5 12 5 12 5s-7.1 0-8.7.4A2.5 2.5 0 0 0 1.5 7.2C1 8.8 1 12 1 12s0 3.2.5 4.8a2.5 2.5 0 0 0 1.8 1.8C4.9 19 12 19 12 19s7.1 0 8.7-.4a2.5 2.5 0 0 0 1.8-1.8c.5-1.6.5-4.8.5-4.8s0-3.2-.5-4.8z"/><path d="M10 15l5-3-5-3z"/>',
    ig: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
    discord: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M9 10h.01M15 10h.01"/>',
    send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    set: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1.1 1.2C7.8 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1.1 1.2 1.1.6 1.9 2 1.9 3.8M18 2H6v7a6 6 0 0 0 12 0z"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
  };
  function ic(n, c) { return '<svg class="cp-i ' + (c || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (IC[n] || IC.check) + '</svg>'; }
  var TABIC = { about: 'info', feed: 'msg', courses: 'course', indicators: 'ind', events: 'cal', leaderboard: 'trophy' };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var counts = { courses: 0, indicators: 0, events: 0 }, animated = false, parallaxOn = false;

  // Owner-saved URLs become icon chips (never raw URLs): platform from the host name.
  function platform(u) {
    var h = ''; try { h = new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return null; }
    if (/(^|\.)(x|twitter)\.com$/.test(h)) return ['x', 'X'];
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(h)) return ['yt', 'YouTube'];
    if (/(^|\.)instagram\.com$/.test(h)) return ['ig', 'Instagram'];
    if (/(^|\.)(discord\.gg|discord\.com)$/.test(h)) return ['discord', 'Discord'];
    if (/(^|\.)(t\.me|telegram\.me)$/.test(h)) return ['send', 'Telegram'];
    if (/(^|\.)tiktok\.com$/.test(h)) return ['web', 'TikTok'];
    if (/(^|\.)linkedin\.com$/.test(h)) return ['web', 'LinkedIn'];
    if (/(^|\.)github\.com$/.test(h)) return ['web', 'GitHub'];
    return ['web', h.length > 22 ? 'Website' : h];
  }
  function aboutIcon(t, d) {
    function pick(x) {
      x = x.toLowerCase();
      if (/indicator|script/.test(x)) return 'ind';
      if (/\bchart|walkthrough/.test(x)) return 'charts';
      if (/course|lesson|class|curriculum|\blearn/.test(x)) return 'course';
      if (/week|session|event|\blive\b|call|webinar/.test(x)) return 'cal';
      if (/community|member|chat|discord|feed|support/.test(x)) return 'users';
      if (/replay|journal|review|recap/.test(x)) return 'clock';
      return '';
    }
    return pick(t) || pick(d || '') || 'check';
  }
  // Splits the saved About text into: intro paragraphs, icon rows (bullet lines), a disclaimer, and link chips.
  function parseAbout(text) {
    var out = { blocks: [], links: [], edu: '' }, seen = {};
    function addLink(u) { u = u.replace(/[.,;:!?)]+$/, ''); if (seen[u]) return; var pf = platform(u); if (!pf) return; seen[u] = 1; out.links.push({ u: u, ic: pf[0], l: pf[1] }); }
    String(text || '').split(/\n{2,}/).forEach(function (para) {
      var lines = para.split('\n'), rows = [], prose = [];
      lines.forEach(function (ln) {
        var t = ln.trim(); if (!t) return;
        var urls = t.match(/https:\/\/[^\s<>"]{4,200}/g) || [];
        var rest = t.replace(/https:\/\/[^\s<>"]{4,200}/g, '').replace(/^[\s\-•*]*[A-Za-z0-9 ]{0,24}:?\s*$/, function (m) { return urls.length ? '' : m; }).trim();
        if (urls.length && !rest) { urls.forEach(addLink); return; }
        if (urls.length) { urls.forEach(addLink); t = t.replace(/https:\/\/[^\s<>"]{4,200}/g, '').replace(/[\s:]+$/, ''); }
        if (/^(education only|.*not financial advice)/i.test(t) && !out.edu) { out.edu = t; return; }
        var bm = t.match(/^[-•*]\s+(.*)$/);
        if (bm) { var r = bm[1], m = r.match(/^([^:.]{2,48}):\s+(.+)$/); rows.push(m ? { t: m[1], d: m[2] } : { t: r, d: '' }); }
        else prose.push(t);
      });
      if (prose.length) out.blocks.push({ k: /:$/.test(prose[prose.length - 1]) && prose.join(' ').length < 70 ? 'sub' : 'p', t: prose.join(' ') });
      if (rows.length) out.blocks.push({ k: 'rows', rows: rows });
    });
    return out;
  }
  function aboutHtml(ab) {
    var h = '';
    ab.blocks.forEach(function (b) {
      if (b.k === 'p') h += '<p class="cp-p">' + CH.esc(b.t) + '</p>';
      else if (b.k === 'sub') h += '<h3 class="cp-sub">' + CH.esc(b.t.replace(/:$/, '')) + '</h3>';
      else h += '<div class="cp-rows">' + b.rows.map(function (r) { return '<div class="cp-row"><span class="cp-ib">' + ic(aboutIcon(r.t, r.d)) + '</span><div><b>' + CH.esc(r.t) + '</b>' + (r.d ? '<span>' + CH.esc(r.d) + '</span>' : '') + '</div></div>'; }).join('') + '</div>';
    });
    if (ab.edu) h += '<div class="cp-edu">' + ic('shield') + '<span>' + CH.esc(ab.edu) + '</span></div>';
    return h;
  }
  function linkChips(links) {
    if (!links.length) return '';
    return '<div class="cp-links">' + links.map(function (l) { return '<a class="cp-lk" href="' + CH.esc(l.u) + '" target="_blank" rel="noopener noreferrer nofollow">' + ic(l.ic) + CH.esc(l.l) + '</a>'; }).join('') + '</div>';
  }
  function initials(n) { var w = String(n || '?').trim().split(/\s+/).filter(Boolean); return CH.esc(((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase()); }
  function shareLink() {
    var url = location.origin + '/c/' + slug;
    var done = function () { CH.toast('success', 'Link copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(function () { prompt('Copy this link:', url); });
    else prompt('Copy this link:', url);
  }
  function loadCounts() {
    var base = db.collection('communities').doc(slug), f = cm.features || {}, ps = [];
    if (f.courses) ps.push(base.collection('courses').where('status', '==', 'published').get().then(function (s) { counts.courses = s.size; }).catch(function () {}));
    if (f.indicators) ps.push(base.collection('indicators').where('status', '==', 'live').get().then(function (s) { counts.indicators = s.size; }).catch(function () {}));
    if (f.events) ps.push(base.collection('events').orderBy('startsAt', 'desc').limit(60).get().then(function (s) { var n = Date.now(); counts.events = s.docs.filter(function (d) { var x = d.data(), t = x.startsAt && x.startsAt.toMillis ? x.startsAt.toMillis() : 0; return t + (x.durationMin || 0) * 60000 >= n; }).length; }).catch(function () {}));
    return Promise.all(ps);
  }

  function draw() {
    var accent = /^#[0-9a-fA-F]{6}$/.test(cm.accent) ? cm.accent : '#03c988';
    var member = mem && CH.isActive(mem), cls = animated ? '' : ' rv';
    var coverBg = cm.coverUrl ? '<div class="cp-cv" role="img" aria-label="' + CH.esc(cm.name) + ' cover" style="background-image:url(' + CH.esc(cm.coverUrl) + ')"></div>' : '<div class="cp-cv cp-nocover" style="--acc:' + accent + '"></div>';
    var avatar = '<span class="cp-av' + (cm.logoUrl ? '' : ' ini') + '" style="--acc:' + accent + '">' + (cm.logoUrl ? '<img src="' + CH.esc(cm.logoUrl) + '" alt="' + CH.esc(cm.name) + ' logo" width="136" height="136">' : initials(cm.name)) + '</span>';
    var chips = (cm.demo === true ? '<span class="cp-chip demo" role="note"><i aria-hidden="true"></i>Demo community</span>' : '') +
      (cm.visibility === 'private' ? '<span class="cp-chip">' + ic('lock', 's14') + 'Private</span>' : '') +
      (cm.tags || []).map(function (t) { return '<span class="cp-chip tag">' + CH.esc(CH.tagLabel(t)) + '</span>'; }).join('');
    var act = (isOwner() ? '<a class="btn btn-primary cp-btn" href="/creator?c=' + CH.esc(slug) + '">' + ic('set') + 'Manage</a>' :
      (member ? '' : '<button class="btn btn-primary cp-btn" type="button" id="cp-join">Join</button>')) +
      '<button class="btn btn-ghost cp-btn" type="button" id="cp-share">' + ic('share') + 'Share</button>';
    var stats = [['users', 'Member' + (cm.memberCount === 1 ? '' : 's'), cm.memberCount || 0], ['course', 'Course' + (counts.courses === 1 ? '' : 's'), counts.courses], ['ind', 'Indicator' + (counts.indicators === 1 ? '' : 's'), counts.indicators], ['cal', 'Upcoming event' + (counts.events === 1 ? '' : 's'), counts.events]].filter(function (x) { return x[2] > 0; });
    var h = '<div class="cp-cover">' + coverBg + '</div>' +
      '<div class="cp-in"><div class="cp-head">' +
      '<div class="cp-avw' + cls + '" style="--i:0">' + avatar + '</div>' +
      '<div class="cp-title' + cls + '" style="--i:1"><h1>' + CH.esc(cm.name) + '</h1>' + (cm.tagline ? '<p class="cp-tl">' + CH.esc(cm.tagline) + '</p>' : '') + (chips ? '<div class="cp-meta">' + chips + '</div>' : '') + '</div>' +
      '<div class="cp-act' + cls + '" style="--i:3">' + act + '</div></div>' +
      (stats.length ? '<div class="cp-stats' + cls + '" data-n="' + stats.length + '" style="--i:4">' + stats.map(function (x) { return '<div class="cp-stat"><span class="cp-ib">' + ic(x[0]) + '</span><div><b class="cp-num" data-count="' + x[2] + '">' + x[2] + '</b><span>' + x[1] + '</span></div></div>'; }).join('') + '</div>' : '') + '</div>';
    var tabs = [['about', 'About']];
    // Indicators and Courses are visible to everyone who can see the page (a teaser; the content is gated by the rules).
    if (cm.features && cm.features.indicators && !(cm.visibility === 'private' && !member && !isOwner())) tabs.push(['indicators', 'Indicators']);
    if (cm.features && cm.features.courses && !(cm.visibility === 'private' && !member && !isOwner())) tabs.push(['courses', 'Courses']);
    if (member) enabled().forEach(function (f) { if (f[0] !== 'indicators' && f[0] !== 'courses') tabs.push(f); });
    if (tab === 'courses' && !tabs.some(function (t) { return t[0] === 'courses'; })) tab = 'about';
    if (tab === 'indicators' && !tabs.some(function (t) { return t[0] === 'indicators'; })) tab = 'about';
    if ((tab === 'feed' || tab === 'events') && !tabs.some(function (t) { return t[0] === tab; })) tab = 'about';
    h += '<div class="cp-bar"><div class="cp-in"><div class="cp-tabs"><div class="cp-tsc" role="tablist" aria-label="Community sections">' + tabs.map(function (t) {
      return '<button type="button" role="tab" data-t="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + ic(TABIC[t[0]] || 'check', 's16') + t[1] + '</button>'; }).join('') + '<span class="cp-ind"></span></div></div></div></div>';
    h += '<div class="cp-in"><div class="cx-two"><div id="cm-main"></div><aside id="cm-side"></aside></div></div>';
    root.innerHTML = h; root.classList.add('cp-root');
    var navEl = document.getElementById('site-nav'); document.documentElement.style.setProperty('--cp-nav', (navEl ? navEl.offsetHeight : 0) + 'px');
    var wrap = root.querySelector('.cp-tabs'), sc = wrap.firstChild, ind = sc.querySelector('.cp-ind');
    function place(instant) {
      var b = sc.querySelector('[aria-selected=true]'); if (!b) return;
      if (instant) ind.style.transition = 'none';
      ind.style.width = b.offsetWidth + 'px'; ind.style.transform = 'translateX(' + b.offsetLeft + 'px)';
      if (instant) { void ind.offsetWidth; ind.style.transition = ''; }
    }
    function edges() { wrap.classList.toggle('fl', sc.scrollLeft > 4); wrap.classList.toggle('fr', sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 4); }
    sc.addEventListener('scroll', edges, { passive: true });
    sc.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; tab = b.dataset.t;
      sc.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      place(); b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      try { var q2 = new URLSearchParams(location.search); if (tab === 'about') q2.delete('tab'); else q2.set('tab', tab); history.replaceState(null, '', location.pathname + (q2.toString() ? '?' + q2.toString() : '')); window.dispatchEvent(new Event('cn:route')); } catch (x) {}
      main(member);
    });
    requestAnimationFrame(function () { place(true); edges(); var sel = sc.querySelector('[aria-selected=true]'); if (sel && sc.scrollWidth > sc.clientWidth) sc.scrollLeft = Math.max(0, sel.offsetLeft - 24); });
    if (!window.__cpResize) { window.__cpResize = 1; window.addEventListener('resize', function () { var s = document.querySelector('.cp-tsc'); if (s) { var b = s.querySelector('[aria-selected=true]'), i = s.querySelector('.cp-ind'); if (b && i) { i.style.width = b.offsetWidth + 'px'; i.style.transform = 'translateX(' + b.offsetLeft + 'px)'; } } }); }
    var sh = document.getElementById('cp-share'); if (sh) sh.addEventListener('click', shareLink);
    var jn = document.getElementById('cp-join'); if (jn) jn.addEventListener('click', function () { var s = document.getElementById('cm-side') || document.getElementById('cm-plans'); var t = document.getElementById('cm-plans') || s; if (!me) return CH.signIn(); if (t) t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); });
    motion();
    main(member); side(member);
  }

  // Entrance stagger, count-up and (desktop only) cover parallax. All off under prefers-reduced-motion.
  function motion() {
    var els = root.querySelectorAll('.rv, .cp-num');
    if (reduce || !window.IntersectionObserver) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    root.querySelectorAll('.cp-num').forEach(function (e) { e.textContent = '0'; });
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return; io.unobserve(en.target); var e = en.target; e.classList.add('in');
        if (e.classList.contains('cp-num')) { var to = +e.dataset.count, t0 = performance.now(); (function f(t) { var p = Math.min(1, (t - t0) / 1000); e.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); })(t0); }
      });
    }, { threshold: .1 });
    els.forEach(function (e) { io.observe(e); });
    animated = true;
    if (!parallaxOn && matchMedia('(min-width:900px)').matches) {
      parallaxOn = true; var tick = false;
      window.addEventListener('scroll', function () { if (tick) return; tick = true; requestAnimationFrame(function () { var c = document.querySelector('.cp-cv'); if (c) c.style.transform = 'translate3d(0,' + Math.min(window.scrollY * .03, 10) + 'px,0) scale(1.06)'; tick = false; }); }, { passive: true });
    }
  }

  function main(member) {
    var el = document.getElementById('cm-main');
    if (tab === 'about') {
      var h = '';
      if (cm.visibility === 'private' && !member && !isOwner() && !hasInvite) h += '<div class="cx-note">This community is invite-only. Open the invite link you were sent to join.</div>';
      else {
        var em = CH.embed(cm.introVideo);
        if (em) h += '<div class="cx-video"><iframe src="' + CH.esc(em) + '" title="Intro video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
        var ab = parseAbout(cm.about);
        h += '<div class="cx-box cp-about"><h2>About</h2>' + (cm.about ? aboutHtml(ab) : '<p class="cx-muted">No description yet.</p>') + (ab.links.length ? '<div class="cp-find"><div class="cp-eyebrow">Find us</div>' + linkChips(ab.links) + '</div>' : '') + '</div>';
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
      h += '<div class="cx-box cp-card" id="cm-plans"><h2>Plans</h2>';
      if (!plans.length) h += '<p class="cx-muted">No plans are open yet.</p>';
      plans.forEach(function (p) {
        var free = p.price && p.price.interval === 'free';
        h += '<div class="cx-plan' + (p.popular ? ' pop' : '') + '"><div class="cx-spread"><b>' + CH.esc(p.name) + '</b>' + (p.popular ? '<span class="cx-chip on">Popular</span>' : '') + '</div><div class="price">' + CH.esc(String(p.name || '').trim().toLowerCase() === CH.money(p).toLowerCase() ? 'No charge' : CH.money(p)) + '</div>' +
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
    h += '<div class="cx-box cp-card cp-by"><div class="cp-byh"><span class="cp-ib">' + ic('users') + '</span><div><span class="cp-byl">Creator</span><b>' + CH.esc(cm.ownerName || 'Creator') + '</b></div></div>' +
      '<p class="cx-indie">Run by an independent creator, not by TradeZoro. TradeZoro does not verify creators or their claims. Education only. Not financial advice.</p>' +
      '<button class="cp-report" type="button" id="cm-report">' + ic('flag', 's14') + 'Report this community</button><div id="cm-rep" hidden></div></div>';
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
