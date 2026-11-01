// TradeZoro — "Your desk" (dashboard-user.html): the trading-desk home.
//
// Fills the cards that dashboard-user.html ships as skeletons. Nothing here is invented: market cards read the
// same JSON the market pages read (market-map, market-brief, econ-calendar via their loaders and stale rules),
// activity cards read the member's own stores with small queries (limit 3-5), the Learn card is drawn by
// dash-path.js from dashboard.js's student doc. The chart in the hero is a labelled SAMPLE.
//
// Depends on: auth.js (auth, db), mkt-viz.js (stkViz), market-map/brief/econ-calendar.js (__MM/__MB/__EC),
// journal-calc.js, market-hours.js, roles.js + plan-guard.js (plan), app-nav.js (cn:owned event).
// Every card degrades alone to a quiet note; reveal is visible-by-default with a 1.5 s safety net.
(function () {
  'use strict';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ago(ms) { if (!ms) return ''; var m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; }
  function ms(v) { return v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : 0); }
  function empty(text, href, cta) { return '<p class="dk-empty">' + esc(text) + '</p><a class="btn btn-primary btn-sm" href="' + href + '">' + esc(cta) + '</a>'; }
  function stale(why) { return '<p class="dk-stale">' + esc(why) + '</p>'; }
  function countUp(el, n) {
    if (!el) return;
    if (reduced || !n) { el.textContent = n; return; }
    var t0 = performance.now();
    (function f(now) { var p = Math.min(1, (now - t0) / 800); el.textContent = Math.round(n * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); })(t0);
  }

  // ---- session pill (a clock from market-hours.js, not data) ---------------------
  function session() {
    var t = $('dk-session-t'), box = $('dk-session'), MH = window.StrykerMarketHours;
    if (!t || !MH) return;
    function tick() {
      var l = MH.sessionLabel(Date.now()), txt = l.short;
      if (t.textContent !== txt) t.textContent = txt;
      box.classList.toggle('is-open', !!l.marketOpen);
    }
    tick();
    var id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', function () { if (document.hidden) { clearInterval(id); id = 0; } else if (!id) { tick(); id = setInterval(tick, 1000); } });
  }

  // ---- sample ticker: seeded walk, labelled Sample, paused when hidden -------------
  function ticker() {
    var line = $('dk-tick-l'), area = $('dk-tick-a');
    if (!line) return;
    var seed = 11, N = 48, pts = [];
    function r() { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; }
    var v = 50; for (var i = 0; i < N; i++) { v += r() * 9; pts.push(v); }
    function draw() {
      var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), sp = (hi - lo) || 1;
      var xy = pts.map(function (p, i) { return (i / (N - 1) * 240).toFixed(1) + ',' + (80 - (p - lo) / sp * 70).toFixed(1); });
      line.setAttribute('points', xy.join(' '));
      area.setAttribute('d', 'M' + xy.join('L') + 'L240,90L0,90Z');
    }
    draw();
    if (reduced) return;
    var id = 0, hero = $('dk-hero'), on = true;
    function step() { pts.shift(); pts.push(pts[pts.length - 1] + r() * 9); draw(); }
    function go() { if (!id && on && !document.hidden) id = setInterval(step, 900); }
    function stop() { clearInterval(id); id = 0; }
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : go(); });
    if ('IntersectionObserver' in window && hero) new IntersectionObserver(function (e) { on = e[0].isIntersecting; on ? go() : stop(); }).observe(hero);
    go();
  }

  // ---- plan: Pro chip / Pro card ----------------------------------------------------
  function plan() {
    var tries = 0;
    (function poll() {
      var p = window.__strykerCurrentPlan;
      if (p === undefined || p === null || typeof rankOf !== 'function') { if (++tries < 40) setTimeout(poll, 250); return; }
      var pro = rankOf(p) > 0;
      var card = $('dk-pro'); if (card) card.hidden = pro;
      var gex = $('dk-gex');
      if (gex && !pro) gex.setAttribute('data-open-plan-modal', '');   // free: the existing paywall modal, no price
      else if (gex) { var c = $('dk-gex-pro'); if (c) c.hidden = true; }
    })();
  }

  // ---- market pulse -------------------------------------------------------------------
  function pulse() {
    var MM = window.__MM, MB = window.__MB, EC = window.__EC, V = window.stkViz;
    var when = $('dk-pulse-when');
    if (EC && EC.load) EC.load().then(function (d) {
      var host = $('dk-ev'), until = Date.parse(d.goodUntil), old = isFinite(until) ? Date.now() > until : (Date.now() - Date.parse(d.generatedAt)) / 36e5 > (Number(d.staleAfterHours) || 30);
      var cur = d.defaultCurrency || 'USD', now = Date.now();
      var ev = (d.events || []).filter(function (e) { return e.cur === cur && Date.parse(e.at) > now && e.impact === 'high'; }).sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); })[0];
      if (old) { host.innerHTML = stale('The calendar has not been refreshed. Open it for the latest.'); return; }
      if (!ev) { host.innerHTML = '<p class="dk-empty">No high-impact releases are scheduled right now.</p>'; return; }
      var at = Date.parse(ev.at);
      host.innerHTML = '<b class="dk-ev-t">' + esc(ev.title || ev.name || 'Release') + '</b><span class="dk-dim">' + esc(cur) + ' · ' + esc(new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })) + '</span><div class="dk-cd" id="dk-cd"></div>';
      var cd = $('dk-cd');
      (function t() { var left = at - Date.now(); cd.textContent = left > 0 ? EC.countdown(left) : 'Now'; })();
      if (!reduced) setInterval(function () { var left = at - Date.now(); cd.textContent = left > 0 ? EC.countdown(left) : 'Now'; }, 1000);
    }).catch(function () { $('dk-ev').innerHTML = stale('Calendar unavailable. Open the full calendar.'); });
    else $('dk-ev').innerHTML = '';

    if (MM && MM.load && V) MM.load().then(function (d) {
      var host = $('dk-map'); MM.setData(d);
      var g = (d.groups || []).filter(function (x) { return !x.excess; })[0], per = d.defaultPeriod || '1D', i = Math.max(0, (d.periods || []).indexOf(per));
      var rows = g ? (g.rows || []).map(function (r) { return { r: r, v: r.v[i] }; }).filter(function (x) { return typeof x.v === 'number' && isFinite(x.v); }) : [];
      if (!rows.length) { host.innerHTML = '<p class="dk-empty">The market map is warming up.</p>'; return; }
      var mx = Math.max.apply(null, rows.map(function (x) { return Math.abs(x.v); }).concat([0.01]));
      var items = rows.slice(0, 12).map(function (x) { return { a: Math.abs(x.v) + mx * 0.12, v: x.v, r: x.r }; });
      host.innerHTML = (MM.isStale() ? stale('Built a while ago. Treat as history.') : '') +
        V.treemapHtml(items, { ratio: 1.6, width: 300, label: function (it) { return { t: it.r.ticker || it.r.label, v: MM.fmtPct(it.v) }; }, cls: function (it) { return V.cls(V.bucket(it.v, undefined, g.scale)); } }) +
        '<p class="dk-dim">' + esc(g.title) + ' · ' + esc(per) + '</p>';
      host.querySelectorAll('.mv-tile').forEach(function (b) { b.tabIndex = -1; b.addEventListener('click', function () { location.href = 'market-map.html'; }); });
      if (when && MM.whenLabel) when.textContent = 'Map: ' + MM.whenLabel();
    }).catch(function () { $('dk-map').innerHTML = stale('Map unavailable. Open the full map.'); });

    if (MB && MB.load && V) MB.load().then(function (b) {
      var host = $('dk-lad');
      if (MB.isStale(b)) { host.innerHTML = stale('The brief has not been refreshed. Open it for the latest.'); return; }
      var h = MB.ladders ? MB.ladders(b, 3) : '';
      host.innerHTML = h || '<p class="dk-empty">Key levels appear when the brief is published.</p>';
    }).catch(function () { $('dk-lad').innerHTML = stale('Brief unavailable. Open the full brief.'); });
  }

  // ---- your activity ---------------------------------------------------------------------
  function activity(uid) {
    var S = db.collection('students').doc(uid);
    S.collection('chartLayouts').orderBy('updatedAt', 'desc').limit(3).get().then(function (snap) {
      var out = []; snap.forEach(function (d) { var x = d.data() || {}; out.push({ id: d.id, name: x.name || 'Untitled', sub: [x.symbol, x.interval].filter(Boolean).join(' · '), at: ms(x.updatedAt) }); });
      $('dk-layouts').innerHTML = out.length ? '<ul class="dk-list">' + out.map(function (l) {
        return '<li><div><b>' + esc(l.name) + '</b><span class="dk-dim">' + esc(l.sub) + (l.at ? ' · ' + esc(ago(l.at)) : '') + '</span></div><a class="btn btn-ghost btn-sm" href="charts.html?openlayout=' + encodeURIComponent(l.id) + '">Open</a></li>';
      }).join('') + '</ul>' : empty('Save a chart setup once and it is here next time.', 'charts.html', 'Save your first layout');
    }).catch(function () { $('dk-layouts').innerHTML = empty('Save a chart setup once and it is here next time.', 'charts.html', 'Open ZoroCharts'); });

    S.collection('journal').orderBy('date', 'desc').limit(100).get().then(function (snap) {
      var t = []; snap.forEach(function (d) { if (d.id.charAt(0) !== '_') t.push(d.data()); });
      var from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 6);
      var wk = t.filter(function (x) { return x.date && new Date(x.date + 'T00:00:00').getTime() >= from.getTime(); });
      var host = $('dk-journal');
      if (!t.length) { host.innerHTML = empty('Log a trade and your week shows up here.', 'trade-journal.html', 'Log your first trade'); return; }
      var closed = t.filter(function (x) { return typeof x.pnl === 'number'; }).sort(function (a, b) { return ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')); });
      var run = 0, pts = closed.slice(-30).map(function (x) { run += x.pnl; return run; });
      var spark = '';
      if (pts.length > 1) { var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), sp = (hi - lo) || 1; spark = '<svg class="dk-spark" viewBox="0 0 120 32" preserveAspectRatio="none" aria-label="Equity curve of your last closed trades"><polyline points="' + pts.map(function (p, i) { return (i / (pts.length - 1) * 120).toFixed(1) + ',' + (29 - (p - lo) / sp * 26).toFixed(1); }).join(' ') + '"/></svg>'; }
      host.innerHTML = '<div class="dk-big"><b id="dk-wk">0</b><span>trade' + (wk.length === 1 ? '' : 's') + ' in the last 7 days</span></div>' + spark + '<a class="dk-more" href="trade-journal.html">Review in JournalX →</a>';
      countUp($('dk-wk'), wk.length);
    }).catch(function () { $('dk-journal').innerHTML = empty('Log a trade and your week shows up here.', 'trade-journal.html', 'Log your first trade'); });

    S.collection('replay').orderBy('updatedAt', 'desc').limit(1).get().then(function (snap) {
      var x = null, id = ''; snap.forEach(function (d) { x = d.data(); id = d.id; });
      $('dk-replay').innerHTML = x ? '<ul class="dk-list"><li><div><b>' + esc(x.name || x.symbolLabel || 'Replay session') + '</b><span class="dk-dim">' + esc(x.symbolLabel || '') + (x.total ? ' · ' + Math.round(100 * ((x.cursor || 0) + 1) / x.total) + '% replayed' : '') + '</span></div><a class="btn btn-ghost btn-sm" href="replay.html?session=' + encodeURIComponent(id) + '">Resume</a></li></ul>'
        : empty('Replay a past day bar by bar to practise a setup.', 'backtests.html', 'Start a replay');
    }).catch(function () { $('dk-replay').innerHTML = empty('Replay a past day bar by bar to practise a setup.', 'backtests.html', 'Start a replay'); });

    db.collection('communityPosts').orderBy('createdAt', 'desc').limit(3).get().then(function (snap) {
      var h = ''; snap.forEach(function (d) { var p = d.data() || {}, tx = document.createElement('div'); tx.innerHTML = String(p.textHtml || ''); var t = (tx.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 110); h += '<li class="dk-post"><div><b>' + esc(p.authorName || 'Trader') + '</b><span class="dk-dim">' + esc(ago(ms(p.createdAt))) + '</span></div><p>' + esc(t) + '</p></li>'; });
      $('dk-floor').innerHTML = h ? '<ul class="dk-list dk-posts">' + h + '</ul>' : empty('The floor is quiet. Start the conversation.', 'trading-floor.html', 'Open the Trading Floor');
    }).catch(function () { $('dk-floor').innerHTML = empty('The floor is quiet. Start the conversation.', 'trading-floor.html', 'Open the Trading Floor'); });
  }

  // ---- creator card ---------------------------------------------------------------------------
  function creator() {
    document.addEventListener('cn:owned', function (e) {
      var o = (e.detail && e.detail.owned) || [];
      if (!o.length) return;
      $('dk-cr-t').textContent = 'You run ' + (o.length === 1 ? o[0].name : o.length + ' communities') + '. Post, host events and see your members.';
      var a = $('dk-cr-a'); a.textContent = o.length === 1 ? 'Manage ' + o[0].name : 'Manage communities'; a.href = o.length === 1 ? 'creator.html?c=' + encodeURIComponent(o[0].id) : 'creator-new.html';
    });
  }

  // ---- reveal (visible by default; hidden only once JS runs, 1.5 s safety net) ---------------------
  function motion() {
    var els = [].slice.call(document.querySelectorAll('.dk-rv'));
    function all() { els.forEach(function (e) { e.classList.add('is-in'); }); }
    if (reduced || !('IntersectionObserver' in window)) { all(); return; }
    document.documentElement.classList.add('dk-js');
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    els.forEach(function (e) { io.observe(e); });
    setTimeout(all, 1500);
    if (window.matchMedia('(hover:hover) and (pointer:fine)').matches) els.forEach(function (c) {
      if (!c.hasAttribute('data-tilt')) return;
      c.addEventListener('pointermove', function (e) { var b = c.getBoundingClientRect(); c.style.setProperty('--ty', ((e.clientX - b.left) / b.width - .5) * 5 + 'deg'); c.style.setProperty('--tx', (.5 - (e.clientY - b.top) / b.height) * 5 + 'deg'); });
      c.addEventListener('pointerleave', function () { c.style.removeProperty('--tx'); c.style.removeProperty('--ty'); });
    });
  }

  function greet() { var el = $('dov-greet'); if (el) { var h = new Date().getHours(); el.textContent = h < 5 ? 'Burning the midnight oil' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; } }

  function boot() {
    greet(); motion(); session(); ticker(); plan(); creator(); pulse();
    if (typeof auth === 'undefined' || !auth || typeof db === 'undefined' || !db) return;
    var done = false;
    auth.onAuthStateChanged(function (u) { if (!u || done) return; done = true; activity(u.uid); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
