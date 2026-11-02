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
  // Shared store for dash-hud.js (hero + status strip): feeds land here once, readers subscribe.
  var DK = window.__dk = { data: {}, subs: [], set: function (k, v) { DK.data[k] = v; DK.subs.forEach(function (f) { try { f(k, v); } catch (e) {} }); }, on: function (f) { DK.subs.push(f); Object.keys(DK.data).forEach(function (k) { f(k, DK.data[k]); }); } };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ago(ms) { if (!ms) return ''; var m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; }
  function ms(v) { return v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : 0); }
  function empty(text, href, cta) { return '<p class="dk-empty">' + esc(text) + '</p><a class="btn btn-primary btn-sm" href="' + href + '">' + esc(cta) + '</a>'; }
  // illustrated empty slot: dashed glowing outline, one first action
  function slot(title, text, href, cta) { return '<div class="dk-slot"><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="6" width="36" height="36" rx="9"/><path d="M24 16v16M16 24h16"/></svg><b>' + esc(title) + '</b><p>' + esc(text) + '</p><a class="btn btn-primary btn-sm" href="' + href + '">' + esc(cta) + '</a></div>'; }
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

  // news wave: next 6 releases on one horizontal timeline, bar height = impact (from the file, nothing derived)
  function wave(d, old) {
    var host = $('dk-wave'); if (!host) return;
    if (old) { host.innerHTML = stale('The calendar has not been refreshed. Open it for the latest.'); return; }
    var cur = d.defaultCurrency || 'USD', now = Date.now();
    var ev = (d.events || []).filter(function (e) { return e.cur === cur && Date.parse(e.at) > now && e.impact !== 'holiday'; }).sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); }).slice(0, 6);
    if (!ev.length) { host.innerHTML = '<p class="dk-empty">No releases are scheduled right now.</p>'; return; }
    var H = { high: 3, medium: 2, low: 1 }, t0 = Date.parse(ev[0].at), span = Math.max(Date.parse(ev[ev.length - 1].at) - t0, 36e5);
    host.innerHTML = '<div class="dk-wv" role="list">' + ev.map(function (e, i) {
      var at = Date.parse(e.at), x = ev.length === 1 ? 50 : 8 + i / (ev.length - 1) * 84, lv = H[e.impact] || 1;
      return '<div class="dk-wv-i is-' + esc(e.impact) + '" role="listitem" style="left:' + x.toFixed(1) + '%;--i:' + i + '"><i style="--h:' + (lv * 14) + 'px"></i><b>' + esc(new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })) + '</b><span>' + esc(e.event || '') + '</span></div>';
    }).join('') + '<u class="dk-wv-ln" aria-hidden="true"></u></div><p class="dk-dim">In time order. Taller bar = bigger expected impact. ' + esc(cur) + ', your local time.</p>';
  }

  // count-up the first time an element is seen (text keeps its own format; reduced motion: untouched)
  function countOnView(el, fmt) {
    if (!el) return;
    var to = parseFloat(el.getAttribute('data-to'));
    if (reduced || !isFinite(to) || !('IntersectionObserver' in window)) { el.textContent = fmt(to); return; }
    var io = new IntersectionObserver(function (es) { if (!es[0].isIntersecting) return; io.disconnect(); var t0 = performance.now(); (function f(now) { var p = Math.min(1, (now - t0) / 900); el.textContent = fmt(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); })(t0); });
    io.observe(el);
  }

  // ---- market pulse -------------------------------------------------------------------
  function pulse() {
    var MM = window.__MM, MB = window.__MB, EC = window.__EC, V = window.stkViz;
    var when = $('dk-pulse-when');
    if (EC && EC.load) EC.load().then(function (d) {
      DK.set('ec', d);
      var host = $('dk-ev'), until = Date.parse(d.goodUntil), old = isFinite(until) ? Date.now() > until : (Date.now() - Date.parse(d.generatedAt)) / 36e5 > (Number(d.staleAfterHours) || 30);
      var cur = d.defaultCurrency || 'USD', now = Date.now();
      var ev = (d.events || []).filter(function (e) { return e.cur === cur && Date.parse(e.at) > now && e.impact === 'high'; }).sort(function (a, b) { return Date.parse(a.at) - Date.parse(b.at); })[0];
      wave(d, old);
      if (old) { host.innerHTML = stale('The calendar has not been refreshed. Open it for the latest.'); return; }
      if (!ev) { host.innerHTML = '<p class="dk-empty">No high-impact releases are scheduled right now.</p>'; return; }
      var at = Date.parse(ev.at);
      host.innerHTML = '<b class="dk-ev-t">' + esc(ev.event || 'Release') + '</b><span class="dk-dim">' + esc(cur) + ' · ' + esc(new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })) + '</span><div class="dk-cd" id="dk-cd"></div>';
      var cd = $('dk-cd');
      (function t() { var left = at - Date.now(); cd.textContent = left > 0 ? EC.countdown(left) : 'Now'; })();
      if (!reduced) setInterval(function () { var left = at - Date.now(); cd.textContent = left > 0 ? EC.countdown(left) : 'Now'; }, 1000);
    }).catch(function () { DK.set('ec', false); $('dk-ev').innerHTML = stale('Calendar unavailable. Open the full calendar.'); });
    else $('dk-ev').innerHTML = '';

    if (MM && MM.load && V) MM.load().then(function (d) {
      DK.set('mm', d);
      var host = $('dk-map'); MM.setData(d);
      var g = (d.groups || []).filter(function (x) { return !x.excess; })[0], per = d.defaultPeriod || '1D', i = Math.max(0, (d.periods || []).indexOf(per));
      var rows = g ? (g.rows || []).map(function (r) { return { r: r, v: r.v[i] }; }).filter(function (x) { return typeof x.v === 'number' && isFinite(x.v); }) : [];
      if (!rows.length) { host.innerHTML = '<p class="dk-empty">The market map is warming up.</p>'; return; }
      var mx = Math.max.apply(null, rows.map(function (x) { return Math.abs(x.v); }).concat([0.01]));
      var items = rows.slice(0, 12).map(function (x) { return { a: Math.abs(x.v) + mx * 0.12, v: x.v, r: x.r }; });
      host.innerHTML = (MM.isStale() ? stale('Built a while ago. Treat as history.') : '') +
        V.treemapHtml(items, { ratio: 1.3, width: 300, label: function (it) { return { t: it.r.ticker || it.r.label, v: MM.fmtPct(it.v) }; }, cls: function (it) { return V.cls(V.bucket(it.v, undefined, g.scale)); } }) +
        '<p class="dk-dim">' + esc(g.title) + ' · ' + esc(per) + '</p>';
      var all = []; (d.groups || []).forEach(function (x) { if (x.excess) return; (x.rows || []).forEach(function (r) { var v = r.v[i]; if (typeof v === 'number' && isFinite(v)) all.push(v); }); });
      var up = all.filter(function (v) { return v > 0; }).length, dn = all.filter(function (v) { return v < 0; }).length, tot = up + dn;
      var br = $('dk-breadth');
      if (br && tot) {
        var C = 2 * Math.PI * 26, pu = up / tot;
        br.hidden = false;
        br.innerHTML = '<svg viewBox="0 0 64 64" class="dk-donut" role="img" aria-label="' + up + ' of ' + tot + ' markets up over ' + esc(per) + '"><circle cx="32" cy="32" r="26" class="dk-dn-bg"/><circle cx="32" cy="32" r="26" class="dk-dn-up" style="stroke-dasharray:' + (C * pu).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg>' +
          '<div><b><span data-to="' + up + '">' + up + '</span> up · <span data-to="' + dn + '">' + dn + '</span> down</b><span class="dk-dim">of ' + tot + ' markets on the board, ' + esc(per) + '</span></div>';
        br.querySelectorAll('[data-to]').forEach(function (e) { countOnView(e, function (v) { return Math.round(v); }); });
      }
      host.querySelectorAll('.mv-tile').forEach(function (b, n) { b.style.setProperty('--n', n); b.tabIndex = -1; b.addEventListener('click', function () { location.href = 'market-map.html'; }); });
      if (when && MM.whenLabel) when.textContent = 'Map: ' + MM.whenLabel();
    }).catch(function () { DK.set('mm', false); $('dk-map').innerHTML = stale('Map unavailable. Open the full map.'); });

    if (MB && MB.load && V) MB.load().then(function (b) {
      DK.set('mb', b);
      var host = $('dk-lad');
      if (MB.isStale(b)) { host.innerHTML = stale('The brief has not been refreshed. Open it for the latest.'); return; }
      var h = MB.ladders ? MB.ladders(b, 4) : '';
      host.innerHTML = h || '<p class="dk-empty">Key levels appear when the brief is published.</p>';
    }).catch(function () { DK.set('mb', false); $('dk-lad').innerHTML = stale('Brief unavailable. Open the full brief.'); });
  }

  // ---- your activity ---------------------------------------------------------------------
  function activity(uid) {
    var S = db.collection('students').doc(uid);
    S.collection('chartLayouts').orderBy('updatedAt', 'desc').limit(3).get().then(function (snap) {
      var out = []; snap.forEach(function (d) { var x = d.data() || {}; out.push({ id: d.id, thumb: /^(data:image\/|https:\/\/)/.test(x.thumb || '') ? x.thumb : '', name: x.name || 'Untitled', sub: [x.symbol, x.interval].filter(Boolean).join(' · '), at: ms(x.updatedAt) }); });
      $('dk-layouts').innerHTML = out.length ? '<ul class="dk-lay">' + out.map(function (l) {
        return '<li><a class="dk-lay-c" href="charts.html?openlayout=' + encodeURIComponent(l.id) + '" aria-label="Open layout ' + esc(l.name) + '"><span class="dk-lay-th">' + (l.thumb ? '<img src="' + esc(l.thumb) + '" alt="" loading="lazy">' : '<svg viewBox="0 0 80 40" aria-hidden="true"><path d="M2 30l12-8 10 5 14-14 12 8 14-12 14 6"/></svg>') + '</span><span class="dk-lay-t"><b>' + esc(l.name) + '</b><span class="dk-dim">' + esc(l.sub) + (l.at ? ' · ' + esc(ago(l.at)) : '') + '</span></span><em>Open</em></a></li>';
      }).join('') + '</ul>' : slot('Save your first layout', 'Save a chart setup once and it is here next time.', 'charts.html', 'Open ZoroCharts');
    }).catch(function () { $('dk-layouts').innerHTML = slot('Save your first layout', 'Save a chart setup once and it is here next time.', 'charts.html', 'Open ZoroCharts'); });

    S.collection('journal').orderBy('date', 'desc').limit(100).get().then(function (snap) {
      var t = []; snap.forEach(function (d) { if (d.id.charAt(0) !== '_') t.push(d.data()); });
      var from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 6);
      var wk = t.filter(function (x) { return x.date && new Date(x.date + 'T00:00:00').getTime() >= from.getTime(); });
      var host = $('dk-journal');
      if (!t.length) { host.innerHTML = slot('Log your first trade', 'Log a trade and your week shows up here.', 'trade-journal.html', 'Log your first trade'); return; }
      var days = [], names = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      for (var k = 6; k >= 0; k--) { var dd = new Date(); dd.setDate(dd.getDate() - k); var key = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0'); days.push({ key: key, n: 0, l: names[dd.getDay()] }); }
      t.forEach(function (x) { days.forEach(function (c) { if (x.date === c.key) c.n++; }); });
      var mx = Math.max.apply(null, days.map(function (c) { return c.n; }).concat([1]));
      var closed = t.filter(function (x) { return typeof x.pnl === 'number'; }).sort(function (a, b) { return ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || '')); });
      var run = 0, pts = closed.slice(-30).map(function (x) { run += x.pnl; return run; });
      var spark = '';
      if (pts.length > 1) { var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), sp = (hi - lo) || 1; spark = '<svg class="dk-spark" viewBox="0 0 120 32" preserveAspectRatio="none" role="img" aria-label="Shape of your last closed trades"><polyline pathLength="1" points="' + pts.map(function (p, i) { return (i / (pts.length - 1) * 120).toFixed(1) + ',' + (29 - (p - lo) / sp * 26).toFixed(1); }).join(' ') + '"/></svg>'; }
      host.innerHTML = '<div class="dk-big"><b id="dk-wk" data-to="' + wk.length + '">0</b><span>trade' + (wk.length === 1 ? '' : 's') + ' in the last 7 days</span></div>' +
        '<div class="dk-heat" role="img" aria-label="Trades per day, last 7 days">' + days.map(function (c, i) { return '<span style="--a:' + (c.n ? (0.25 + 0.75 * c.n / mx).toFixed(2) : 0.07) + ';--i:' + i + '" title="' + c.n + ' on ' + c.key + '"><i>' + (c.n || '') + '</i><em>' + c.l + '</em></span>'; }).join('') + '</div>' + spark + '<a class="dk-more" href="trade-journal.html">Review in JournalX →</a>';
      countOnView($('dk-wk'), function (v) { return Math.round(v); });
    }).catch(function () { $('dk-journal').innerHTML = slot('Log your first trade', 'Log a trade and your week shows up here.', 'trade-journal.html', 'Log your first trade'); });

    S.collection('replay').orderBy('updatedAt', 'desc').limit(1).get().then(function (snap) {
      var x = null, id = ''; snap.forEach(function (d) { x = d.data(); id = d.id; });
      $('dk-replay').innerHTML = x ? '<ul class="dk-list"><li><div><b>' + esc(x.name || x.symbolLabel || 'Replay session') + '</b><span class="dk-dim">' + esc(x.symbolLabel || '') + (x.total ? ' · ' + Math.round(100 * ((x.cursor || 0) + 1) / x.total) + '% replayed' : '') + '</span></div><a class="btn btn-ghost btn-sm" href="replay.html?session=' + encodeURIComponent(id) + '">Resume</a></li></ul>'
        : slot('Start a replay', 'Replay a past day bar by bar to practise a setup.', 'backtests.html', 'Start a replay');
    }).catch(function () { $('dk-replay').innerHTML = slot('Start a replay', 'Replay a past day bar by bar to practise a setup.', 'backtests.html', 'Start a replay'); });

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
    greet(); motion(); session(); plan(); creator(); pulse();
    if (typeof auth === 'undefined' || !auth || typeof db === 'undefined' || !db) return;
    var done = false;
    auth.onAuthStateChanged(function (u) { if (!u || done) return; done = true; activity(u.uid); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
