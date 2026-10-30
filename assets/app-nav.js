// TradeZoro — app-style nav (pill rail + mobile dock)
//
// Desktop: icon+label pills in a rounded rail with a solid gold capsule that
// slides behind the active one. Mobile (<=820px): the pills fold away and a
// five-item bottom dock takes over; the top bar keeps brand + bell + profile.
//
// Dock (Owner "Option B", 2026-10-14): Charts, GEX, Journal, Learn, More.
// "More" opens a bottom sheet (#appnav-sheet, built here so every page gets
// the same list) with every other member page. The dock markup itself is
// copied into each page's HTML; the sheet is not. Charts carries a small
// "NEW" dot until NEW_UNTIL below, then it disappears on its own.
//
// The nav must survive page loads, so this file is deliberately loaded at the
// TOP of <body>, immediately after the dock markup and long before the
// firebase bundles — it paints the dock and the current-page highlight from
// localStorage in the first milliseconds, then wires up the auth-dependent
// parts (bell count, sign-out) whenever the firebase globals turn up.

(function(){

  var STORE = 'stryker_nav_authed';

  function storedAuthed(){
    try { return localStorage.getItem(STORE) === '1'; } catch(e) { return false; }
  }

  // The class goes on <html> as well as <body>: <html> exists before anything
  // else, so the dock is visible on the very first paint instead of waiting
  // for scripts at the end of the document.
  function setAuthedClass(on){
    [document.documentElement, document.body].forEach(function(el){
      if (el) el.classList.toggle('nav-authed', on);
    });
  }

  if (storedAuthed()) setAuthedClass(true);

  // Which pill/dock item is "current" for this page. Pages are served both as
  // /courses.html and (on Cloudflare Pages) as /courses, so the extension is
  // stripped before matching — otherwise the highlight silently disappears on
  // the live domain. Pages outside this map show no active state.
  function activeKey(){
    var segs = location.pathname.split('/').filter(Boolean);
    var f = (segs.length ? segs[segs.length - 1] : 'index').toLowerCase().replace(/\.html$/, '');
    if (f === 'courses' || f === 'chapter') return 'learn';
    if (f === 'trade-journal') return 'journal';
    if (f === 'charts') return 'charts';
    if (f === 'gex') return 'gex';
    if (moreKey(f)) return 'more';
    return null;
  }

  function pageFile(){
    var segs = location.pathname.split('/').filter(Boolean);
    return (segs.length ? segs[segs.length - 1] : 'index').toLowerCase().replace(/\.html$/, '');
  }

  // ---- "More" sheet --------------------------------------------------------
  var NEW_UNTIL = Date.parse('2026-10-21T23:59:59+05:30');
  var SV = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  // [file, label, one-line description, svg paths, extra files that count as this item]
  var MORE = [
    ['Main', [
      ['dashboard-user', 'Home', 'Your dashboard and progress', '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>', ['index']],
      ['trading-floor', 'Trading Floor', 'Community posts and chat', '<path d="M9 9V5a2.5 2.5 0 0 1 2.5-2.5h8A2.5 2.5 0 0 1 22 5v3.5a2.5 2.5 0 0 1-2.5 2.5H15"/><path d="M4.5 9h8a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5h-3l-3.5 3v-3H4.5A2.5 2.5 0 0 1 2 15.5v-4A2.5 2.5 0 0 1 4.5 9z"/>'],
      ['global-monitor', 'Global Monitor', 'World events and market news', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>'],
      ['messages', 'Messages', 'Direct messages', '<path d="M4 5h16v11H8l-4 4z"/>']
    ]],
    ['Tools', [
      ['backtests', 'Replay One', 'Test a model on past data', '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>', ['replay']],
      ['paper-review', 'Trade review', 'Review your paper trades', '<path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"/><path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2"/><path d="m9 14 2 2 4-4"/>'],
      ['leaderboard', 'Paper leaderboard', 'Opt-in demo-account ranks', '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'],
      ['models', 'Models', 'Trading model playbooks', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', ['model']],
      ['indicators', 'Indicators', 'Our chart indicators', '<path d="M3 17l5-6 4 4 8-9"/><path d="M15 6h5v5"/>', ['indicator']],
      ['market-brief', 'Market brief', 'Daily notes on key levels', '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>'],
      ['economic-calendar', 'Economic calendar', 'Upcoming news events', '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'],
      ['scanner', 'Market scanner', 'Movers, gaps, 52-week highs', '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/><path d="M8 12.5l2-2.5 2 1.5 2-3"/>'],
      ['market-stats', 'Market stats', 'How often sessions behave, with sample sizes', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
      ['market-map', 'Market map', 'Markets at a glance', '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'],
      ['smart-money', 'Smart money', 'Institutional flow view', '<path d="M12 3v18"/><path d="M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6"/>'],
      ['live-sessions', 'Live sessions', 'Free on YouTube (from December)', '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>']
    ]],
    ['Account', [
      ['profile', 'Profile', 'Your public profile', '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'],
      ['settings', 'Settings', 'Account and preferences', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'],
      ['achievements', 'Achievements', 'Badges and streaks', '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>'],
      ['referrals', 'Referrals', 'Invite friends', '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>'],
      ['giveaways', 'Giveaways', 'Current giveaways', '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13"/><path d="M12 8c-1.5-3-5-4-5-1.5S10 8 12 8zm0 0c1.5-3 5-4 5-1.5S14 8 12 8z"/>'],
      ['roadmap', 'Roadmap', 'What we are building next', '<path d="M4 21V4M4 4h12l-2 4 2 4H4"/>'],
      ['suggestions', 'Suggestions', 'Suggest features and vote', '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/>'],
      ['help', 'Help Center', 'Search answers and guides', '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>'],
      ['support', 'Support', 'Get help from the team', '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>']
    ]]
  ];

  var CREATOR_FILES = ['communities', 'c', 'creator', 'creator-new', 'creator-admin', 'creators'];
  function moreKey(f){
    if (CREATOR_FILES.indexOf(f) !== -1) return 'creator-hub';
    for (var g = 0; g < MORE.length; g++) {
      var list = MORE[g][1];
      for (var i = 0; i < list.length; i++) {
        if (list[i][0] === f || (list[i][4] && list[i][4].indexOf(f) !== -1)) return list[i][0];
      }
    }
    return null;
  }

  var sheet = null, scrim = null, lastFocus = null;

  // ---- Creator Hub section (Owner order 2026-10-30) ------------------------
  // One model feeds both menus: the sidebar section (#cn-section, static markup
  // in each page so it paints with the page; this code re-renders it) and the
  // "More" sheet groups. Only things that exist are listed. Ownership comes from
  // communities.ownerUid == uid (the same query the dashboard uses), cached in
  // sessionStorage for a few minutes; admins from /admins/{uid}. Presentation only:
  // the pages and the rules are the real gates.
  var CN_KEY = 'cn_owned', CN_TTL = 10 * 60 * 1000;
  var cnState = { uid: null, owned: [], admin: false };
  function esc(t){ return String(t == null ? '' : t).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var CI = {
    explore: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    mine: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    dash: '<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>',
    mod: '<path d="M12 3l8 3.5v5.5c0 4.5-3.2 8.2-8 9.5-4.8-1.3-8-5-8-9.5V6.5z"/>',
    start: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    how: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/>',
    members: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 20a6.5 6.5 0 0 0-2-4.6"/>',
    courses: '<path d="M12 6.5C10.5 5 8 4 4 4v14c4 0 6.5 1 8 2.5 1.5-1.5 4-2.5 8-2.5V4c-4 0-6.5 1-8 2.5zM12 6.5v14"/>',
    indicators: '<path d="M3 17l5-6 4 4 8-9"/><path d="M15 6h5v5"/>',
    feed: '<path d="M4 11v2a1 1 0 0 0 1 1h2l5 4V6L7 10H5a1 1 0 0 0-1 1z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
    plans: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6.5 15h3"/>',
    discord: '<path d="M7 7h10a4 4 0 0 1 4 4v4a3 3 0 0 1-5.2 2l-1.3-1.5h-3l-1.3 1.5A3 3 0 0 1 3 15v-4a4 4 0 0 1 4-4z"/><path d="M9 11v2M8 12h2M15.5 12h.01M17 13.5h.01"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'
  };

  function cnLoadCache(){
    try {
      var o = JSON.parse(sessionStorage.getItem(CN_KEY) || 'null');
      if (o && o.t && Date.now() - o.t < CN_TTL) { cnState = { uid: o.uid, owned: o.owned || [], admin: !!o.admin }; return true; }
    } catch(e) {}
    return false;
  }
  function cnSave(){ try { sessionStorage.setItem(CN_KEY, JSON.stringify({ t: Date.now(), uid: cnState.uid, owned: cnState.owned, admin: cnState.admin })); } catch(e) {} }

  // Which creator item is "current" for this URL. Returns a key or null.
  function cnCurrent(){
    var p = location.pathname.toLowerCase(), f = pageFile(), qs = new URLSearchParams(location.search);
    var one = cnState.owned.length === 1 ? cnState.owned[0].id : null;
    if (f === 'communities') return (qs.get('view') === 'mine' || location.hash === '#mine') ? 'mine' : 'explore';
    if (f === 'c' || /^\/c\//.test(p)) {
      var slug = (p.match(/^\/c\/([a-z0-9-]+)/) || [])[1] || qs.get('c');
      var t = qs.get('tab');
      if (one && slug === one && (t === 'feed' || t === 'events')) return 'feed';
      return 'explore';
    }
    if (f === 'creator') {
      var tb = qs.get('tab') || 'dash';
      if (cnState.owned.length === 1 && ['members', 'courses', 'indicators', 'plans', 'discord', 'settings'].indexOf(tb) !== -1) return tb;
      return 'dash';
    }
    if (f === 'creator-new') return 'start';
    if (f === 'creator-admin') return 'mod';
    if (f === 'creators') return 'how';
    return null;
  }

  // Items for the menus. [key, label, short description, icon, href, aria-label]
  function cnModel(){
    var st = cnState, one = st.owned.length === 1 ? st.owned[0] : null;
    var main = [
      ['explore', 'Explore communities', 'Find and join creator communities', '/communities'],
      ['mine', 'My communities', 'Communities you have joined', '/communities?view=mine']
    ];
    if (st.owned.length) main.push(['dash', 'Creator dashboard', st.owned.length > 1 ? 'Pick which community to manage' : 'Run your community', '/creator']);
    if (st.admin) main.push(['mod', 'Creator moderation', 'Staff: review communities', '/creator-admin']);
    if (!st.owned.length) main.push(['start', 'Start a community', 'Set up your own, free to start', '/creator-new']);
    main.push(['how', 'How it works', 'What creators can do here', '/features/creators']);
    var manage = null;
    if (one) {
      var base = '/creator?c=' + encodeURIComponent(one.id) + '&tab=';
      manage = { label: 'Manage ' + one.name, items: [
        ['members', 'Members', 'Roster, roles and bans', base + 'members'],
        ['courses', 'Courses', 'Build and publish courses', base + 'courses'],
        ['indicators', 'Indicators', 'Your protected indicators', base + 'indicators'],
        ['feed', 'Feed & events', 'Posts and live events', '/c/' + encodeURIComponent(one.id) + '?tab=feed'],
        ['plans', 'Plans', 'Pricing and access', base + 'plans'],
        ['discord', 'Discord', 'Roles for your server', base + 'discord'],
        ['settings', 'Settings', 'Name, look and features', base + 'settings']
      ] };
    }
    return { main: main, manage: manage, many: st.owned.length > 1 };
  }
  function cnAria(it, m){
    return m && m.manage && m.manage.items.indexOf(it) !== -1 ? it[1] + ', manage ' + m.manage.label.slice(7) : '';
  }

  // Sheet groups in the MORE tuple shape: [key, label, desc, icon, extra, href, on, aria]
  function creatorGroups(){
    var m = cnModel(), cur = cnCurrent();
    var conv = function(it){ return ['cn-' + it[0], it[1], it[2], CI[it[0]], [], it[3], it[0] === cur, cnAria(it, m)]; };
    var g = [['Creator Hub', m.main.map(conv)]];
    if (m.manage) g.push([m.manage.label, m.manage.items.map(conv)]);
    return g;
  }

  // Sidebar section: same markup as the static HTML in each page.
  function cnLink(it, cur, m){
    var on = it[0] === cur, al = cnAria(it, m);
    return '<a href="' + it[3] + '" class="side-link' + (on ? ' active' : '') + '" data-cn="' + it[0] + '"' + (on ? ' aria-current="page"' : '') + (al ? ' aria-label="' + esc(al) + '"' : '') + '>' +
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + CI[it[0]] + '</svg>' + esc(it[1]) + '</a>';
  }
  function renderSidebar(){
    var sec = document.getElementById('cn-section');
    if (!sec) return;
    var m = cnModel(), cur = cnCurrent();
    var h = '<div class="side-label" id="cn-label">Creator Hub</div>' + m.main.map(function(it){ return cnLink(it, cur, m); }).join('');
    if (m.manage) h += '<div class="side-sublabel" title="' + esc(m.manage.label) + '">' + esc(m.manage.label) + '</div>' + m.manage.items.map(function(it){ return cnLink(it, cur, m); }).join('');
    if (sec.innerHTML !== h) sec.innerHTML = h;
  }
  function refreshCreator(){
    renderSidebar();
    if (sheet && !isOpen()) { sheet.remove(); scrim.remove(); sheet = null; scrim = null; }
  }

  function loadCreatorState(user, tries){
    if (!user) { cnState = { uid: null, owned: [], admin: false }; try { sessionStorage.removeItem(CN_KEY); } catch(e) {} refreshCreator(); return; }
    if (cnState.uid === user.uid && cnLoadCache()) { refreshCreator(); return; }
    // db (assets/progress.js) is defined a little after auth on some pages: wait for it
    if (typeof db === 'undefined' || !db) { if ((tries || 0) < 60) setTimeout(function(){ loadCreatorState(user, (tries || 0) + 1); }, 150); return; }
    var st = { uid: user.uid, owned: [], admin: false };
    var q1 = db.collection('communities').where('ownerUid', '==', user.uid).get().then(function(s){
      st.owned = s.docs.map(function(d){ return { id: d.id, name: String((d.data() || {}).name || d.id).slice(0, 40) }; });
    }).catch(function(){});
    var q2 = db.collection('admins').doc(user.uid).get().then(function(d){ st.admin = !!d.exists; }).catch(function(){});
    Promise.all([q1, q2]).then(function(){ cnState = st; cnSave(); refreshCreator(); });
  }
  // Pages call this after they change their own tab/URL (history.replaceState)
  window.addEventListener('cn:route', function(){ renderSidebar(); if (sheet && !isOpen()) refreshCreator(); });
  window.addEventListener('popstate', renderSidebar);
  cnLoadCache();
  function buildSheet(){
    if (sheet) return sheet;
    var cur = moreKey(pageFile());
    scrim = document.createElement('div');
    scrim.className = 'appnav-scrim';
    scrim.id = 'appnav-scrim';
    sheet = document.createElement('div');
    sheet.className = 'appnav-sheet';
    sheet.id = 'appnav-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'More pages');
    sheet.hidden = true;
    var h = '<div class="appnav-sh-grip" aria-hidden="true"></div>' +
      '<div class="appnav-sh-head"><span>More</span><button type="button" class="appnav-sh-x" aria-label="Close">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
      '<div class="appnav-sh-body">';
    var groups = MORE.slice();
    var cg = creatorGroups();
    groups.splice.apply(groups, [1, 0].concat(cg));
    groups.forEach(function(g){
      h += '<div class="appnav-sh-group">' + esc(g[0]) + '</div><ul class="appnav-sh-list">';
      g[1].forEach(function(it){
        var on = it[6] !== undefined ? it[6] : it[0] === cur;
        h += '<li><a class="appnav-sh-item' + (on ? ' on' : '') + '" href="' + (it[5] || it[0]) + '"' + (on ? ' aria-current="page"' : '') + (it[7] ? ' aria-label="' + esc(it[7]) + '"' : '') + ' data-more="' + it[0] + '">' +
          '<span class="appnav-sh-ic"><svg ' + SV + '>' + it[3] + '</svg></span>' +
          '<span class="appnav-sh-tx"><span class="appnav-sh-l">' + it[1] + '</span><span class="appnav-sh-d">' + it[2] + '</span></span></a></li>';
      });
      h += '</ul>';
    });
    h += '</div>';
    sheet.innerHTML = h;
    document.body.appendChild(scrim);
    document.body.appendChild(sheet);

    scrim.addEventListener('click', closeSheet);
    sheet.querySelector('.appnav-sh-x').addEventListener('click', closeSheet);
    sheet.addEventListener('keydown', function(e){
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
      if (e.key !== 'Tab') return;
      var f = sheet.querySelectorAll('a, button');
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // swipe down to close: only when the list is scrolled to the top (or the
    // drag starts on the grip/header), so scrolling the list still works.
    var body = sheet.querySelector('.appnav-sh-body');
    var y0 = null, dy = 0;
    sheet.addEventListener('touchstart', function(e){
      var onHead = e.target.closest('.appnav-sh-grip, .appnav-sh-head');
      if (!onHead && body.scrollTop > 0) { y0 = null; return; }
      y0 = e.touches[0].clientY; dy = 0;
    }, { passive: true });
    sheet.addEventListener('touchmove', function(e){
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      if (dy > 0) { sheet.style.transition = 'none'; sheet.style.transform = 'translateY(' + dy + 'px)'; }
    }, { passive: true });
    sheet.addEventListener('touchend', function(){
      if (y0 === null) return;
      sheet.style.transition = ''; sheet.style.transform = '';
      if (dy > 70) closeSheet();
      y0 = null; dy = 0;
    });
    return sheet;
  }

  function isOpen(){ return !!(sheet && sheet.classList.contains('open')); }

  function openSheet(){
    buildSheet();
    var dock = document.getElementById('appnav-dock');
    var dh = dock ? Math.round(dock.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--appnav-dock-h', dh + 'px');
    lastFocus = document.activeElement;
    sheet.hidden = false;
    scrim.classList.add('open');
    document.documentElement.classList.add('appnav-sheet-open');
    // next frame so the slide-up transition runs from the hidden state
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ sheet.classList.add('open'); }); });
    var btn = document.getElementById('appnav-more');
    if (btn) { btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open'); }
    var first = sheet.querySelector('.appnav-sh-item.on') || sheet.querySelector('.appnav-sh-item');
    setTimeout(function(){ if (first) { first.focus({ preventScroll: true }); try { first.scrollIntoView({ block: 'center' }); } catch(e) {} } }, 30);
  }

  function closeSheet(){
    if (!sheet) return;
    sheet.classList.remove('open');
    scrim.classList.remove('open');
    document.documentElement.classList.remove('appnav-sheet-open');
    var btn = document.getElementById('appnav-more');
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('open'); }
    setTimeout(function(){ if (!isOpen()) sheet.hidden = true; }, 260);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch(e) {} }
  }

  function newDot(){
    var on = Date.now() < NEW_UNTIL;
    document.querySelectorAll('.appnav-new').forEach(function(el){
      if (on) el.classList.add('show'); else el.remove();
    });
  }

  function moveCapsule(){
    var cap = document.getElementById('appnav-capsule');
    var on = document.querySelector('.appnav-pill.on');
    if (!cap) return;
    if (!on || getComputedStyle(on.parentElement).display === 'none') { cap.style.opacity = '0'; return; }
    cap.style.opacity = '1';
    cap.style.left = on.offsetLeft + 'px';
    cap.style.width = on.offsetWidth + 'px';
  }

  function setActive(key){
    document.querySelectorAll('.appnav-pill, .appnav-dk').forEach(function(el){
      el.classList.toggle('on', el.dataset.nav === key);
    });
    moveCapsule();
  }

  function paint(){ setActive(activeKey()); }

  var wired = false;
  function wire(){
    if (wired || !document.querySelector('.appnav-pills, .appnav-dock')) return;
    wired = true;

    // capsule position depends on fonts/logo having laid out
    window.addEventListener('resize', moveCapsule, { passive: true });
    window.addEventListener('load', moveCapsule);
    setTimeout(moveCapsule, 300);

    // same-page anchors (Home <-> Platform on index) retarget the capsule
    window.addEventListener('hashchange', paint);

    // Coming back via the bfcache re-runs neither DOMContentLoaded nor the
    // auth listener, so re-assert the highlight there too.
    window.addEventListener('pageshow', paint);

    // Feedback on tap: light the pressed item instantly, before navigation.
    document.querySelectorAll('.appnav-dk, .appnav-pill').forEach(function(el){
      if (el.id === 'appnav-more') return;
      el.addEventListener('click', function(){ setActive(el.dataset.nav); });
    });

    var more = document.getElementById('appnav-more');
    if (more) more.addEventListener('click', function(){ isOpen() ? closeSheet() : openSheet(); });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && isOpen()) closeSheet(); });
    // bfcache restore must not come back with the sheet still up
    window.addEventListener('pageshow', function(){ if (isOpen()) closeSheet(); });
    newDot();
  }

  // Auth gating: the app nav (pills + bell/profile + dock) only renders for
  // signed-in users — guests keep the classic marketing nav. `auth` is defined
  // by assets/auth.js far below this script, so wait for it rather than
  // bailing out on the first look.
  function wireAuth(tries){
    tries = tries || 0;
    if (typeof auth === 'undefined' || !auth) {
      if (tries < 120) setTimeout(function(){ wireAuth(tries + 1); }, 150);
      return;
    }
    auth.onAuthStateChanged(function(user){
      var bell = document.getElementById('appnav-bell');
      var prof = document.getElementById('appnav-profile');
      var badge = document.getElementById('appnav-bell-badge');
      if (!user) {
        setAuthedClass(false);
        try { localStorage.removeItem(STORE); } catch(e) {}
        loadCreatorState(null);
        if (badge) badge.style.display = 'none';
        return;
      }
      setAuthedClass(true);
      try { localStorage.setItem(STORE, '1'); } catch(e) {}
      loadCreatorState(user);
      // pills may have just become visible — the capsule can only measure now
      paint();
      requestAnimationFrame(moveCapsule);
      if (bell) bell.href = 'dashboard-user.html';
      if (prof) prof.href = 'profile.html';
      if (badge && typeof db !== 'undefined' && db) {
        db.collection('notifications')
          .where('recipientUid', '==', user.uid)
          .where('read', '==', false)
          .limit(10).get()
          .then(function(snap){
            var n = snap.size;
            if (n > 0) { badge.textContent = n > 9 ? '9+' : String(n); badge.style.display = 'flex'; }
            else { badge.style.display = 'none'; }
          })
          .catch(function(){ /* badge stays hidden */ });
      }
    });
  }

  // Immediately (dock markup sits directly above this script) …
  if (storedAuthed()) setAuthedClass(true);
  paint();
  wire();

  // … and again once the rest of the document — the desktop pill rail lives in
  // the header — has been parsed.
  document.addEventListener('DOMContentLoaded', function(){
    if (storedAuthed()) setAuthedClass(true);
    paint();
    wire();
    renderSidebar();
    wireAuth();
  });

})();
