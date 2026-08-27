// Stryker Trading Academy — Dashboard overview: one integrated view of the
// Trade Journal, the Global Monitor's FINANCIAL data, and the Trading Floor,
// topped with a deterministic daily briefing composed from all three.
//
// Depends on: auth.js (`auth`), progress.js (`db`), journal-calc.js
// (journalAggregateStats). Everything renders into the #dov block on
// dashboard-user.html and degrades module-by-module: a source that fails
// simply shows its quiet empty note, never an error wall.

(function(){
  var MONITOR_URL = 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data/monitor-data.json';

  // ---- module visibility filter (default: everything) -----------------------
  var MODS = { journal: true, markets: true, floor: true };
  try {
    var saved = JSON.parse(localStorage.getItem('stryker_dash_mods') || 'null');
    if (saved) MODS = Object.assign(MODS, saved);
  } catch (e) {}

  var DOV = { trades: null, monitor: null, posts: null };

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function stripHtml(h){
    var d = document.createElement('div');
    d.innerHTML = String(h || '');
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function money(v){
    var sign = v < 0 ? '-' : (v > 0 ? '+' : '');
    return sign + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: v % 1 ? 2 : 0 });
  }
  function timeAgo(ms){
    if (!ms) return '';
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm ago';
    if (m < 60 * 24) return Math.round(m / 60) + 'h ago';
    return Math.round(m / 1440) + 'd ago';
  }
  function countUp(el, target, format){
    if (!el) return;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !isFinite(target)) { el.textContent = format(target); return; }
    var t0 = performance.now(), dur = 700;
    function tick(now){
      var p = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(target * eased);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ---- greeting by time of day ----------------------------------------------
  function setGreeting(){
    var el = $('dov-greet');
    if (!el) return;
    var h = new Date().getHours();
    el.textContent = h < 5 ? 'Burning the midnight oil' :
                     h < 12 ? 'Good morning' :
                     h < 17 ? 'Good afternoon' : 'Good evening';
  }

  // ---- module filter chips ---------------------------------------------------
  var MOD_DEFS = [['journal', 'Journal'], ['markets', 'Markets'], ['floor', 'Community']];

  function renderFilter(){
    var host = $('dov-filter');
    if (!host) return;
    var allOn = MOD_DEFS.every(function (d) { return MODS[d[0]]; });
    host.innerHTML =
      '<span class="dov-filter-label">Show</span>' +
      '<button type="button" class="term-cat' + (allOn ? ' is-on' : '') + '" data-mod="__all">All</button>' +
      MOD_DEFS.map(function (d) {
        return '<button type="button" class="term-cat' + (MODS[d[0]] ? ' is-on' : '') + '" data-mod="' + d[0] + '">' + d[1] + '</button>';
      }).join('');
  }

  function applyFilter(){
    document.querySelectorAll('.dov-mod').forEach(function (el) {
      el.style.display = MODS[el.dataset.mod] ? '' : 'none';
    });
    drawEquitySpark(null);   // the journal card may have just changed width
  }

  // ---- journal overview ------------------------------------------------------
  function closedSince(trades, days){
    var from = Date.now() - days * 86400000;
    return trades.filter(function (t) {
      return t.pnl !== null && t.pnl !== undefined && t.date &&
             new Date(t.date + 'T00:00:00').getTime() >= from;
    });
  }

  function renderJournal(){
    var host = $('dov-journal-body');
    if (!host || DOV.trades === null) return;
    var trades = DOV.trades;
    if (!trades.length) {
      host.innerHTML = '<p class="dov-empty">No trades logged yet. Your stats, calendar and AI coach light up with the first entry.</p>' +
        '<a class="btn btn-primary btn-sm" href="trade-journal.html">Log your first trade</a>';
      return;
    }
    var t30 = closedSince(trades, 30);
    var s = journalAggregateStats(t30.length ? t30 : trades);
    var label = t30.length ? 'Net P&L · 30 days' : 'Net P&L · all time';
    var recent = trades.filter(function (t) { return t.pnl !== null && t.pnl !== undefined; }).slice(0, 3);

    host.innerHTML =
      '<div class="dov-hero-label">' + label + '</div>' +
      '<div class="dov-hero ' + (s.totalPnl > 0 ? 'gm-up' : (s.totalPnl < 0 ? 'gm-down' : '')) + '" id="dov-j-pnl">—</div>' +
      '<div class="dov-mini-stats">' +
        '<div><b>' + (s.closedTrades ? Math.round(s.winRate) + '%' : '—') + '</b><span>Win rate</span></div>' +
        '<div><b>' + (s.closedTrades ? (isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞') : '—') + '</b><span>Profit factor</span></div>' +
        '<div><b>' + s.closedTrades + '</b><span>Trades</span></div>' +
      '</div>' +
      '<canvas class="dov-eq" id="dov-j-spark" height="52"></canvas>' +
      recent.map(function (t) {
        var win = t.pnl > 0;
        return '<div class="dov-row">' +
          '<span class="dov-pill ' + (win ? 'is-win' : (t.pnl < 0 ? 'is-loss' : '')) + '">' + (win ? 'W' : (t.pnl < 0 ? 'L' : 'BE')) + '</span>' +
          '<b>' + esc(t.instrument || '—') + '</b>' +
          '<span class="dov-dim">' + esc(t.date || '') + '</span>' +
          '<span class="dov-amt ' + (win ? 'gm-up' : (t.pnl < 0 ? 'gm-down' : '')) + '">' + money(t.pnl) + '</span>' +
        '</div>';
      }).join('');

    countUp($('dov-j-pnl'), s.totalPnl, money);
    drawEquitySpark(t30.length ? t30 : trades);
  }

  var DOV_EQ_SERIES = null;

  function drawEquitySpark(closed){
    var c = $('dov-j-spark');
    if (closed) DOV_EQ_SERIES = closed;
    if (!c || !DOV_EQ_SERIES) return;
    closed = DOV_EQ_SERIES;
    // A hidden card measures 0 wide; skip and redraw when it comes back.
    if (!c.clientWidth) return;
    var chrono = closed.slice().sort(function (a, b) {
      return ((a.date || '') + (a.time || '')).localeCompare((b.date || '') + (b.time || ''));
    });
    if (chrono.length < 2) { c.style.display = 'none'; return; }
    var dpr = window.devicePixelRatio || 1;
    var w = c.clientWidth, h = 52;
    c.width = w * dpr; c.height = h * dpr;
    var x = c.getContext('2d');
    x.scale(dpr, dpr);
    var run = 0, pts = chrono.map(function (t) { run += t.pnl; return run; });
    var min = Math.min(0, Math.min.apply(null, pts)), max = Math.max.apply(null, pts);
    var span = (max - min) || 1;
    var up = pts[pts.length - 1] >= 0;
    var col = up ? '#03c988' : '#e5484d';
    x.beginPath();
    pts.forEach(function (p, i) {
      var px = 2 + (w - 4) * i / (pts.length - 1);
      var py = h - 4 - (h - 8) * (p - min) / span;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    });
    x.strokeStyle = col; x.lineWidth = 1.8; x.stroke();
    x.lineTo(w - 2, h); x.lineTo(2, h); x.closePath();
    x.fillStyle = up ? 'rgba(3,201,136,0.09)' : 'rgba(229,72,77,0.09)';
    x.fill();
  }

  // ---- markets overview (Global Monitor's financial data only) ---------------
  function svgSpark(spark, upColour){
    if (!spark || spark.length < 2) return '';
    var min = Math.min.apply(null, spark), max = Math.max.apply(null, spark);
    var span = (max - min) || 1;
    var pts = spark.map(function (v, i) {
      return (i * (56 / (spark.length - 1))).toFixed(1) + ',' + (18 - 16 * (v - min) / span).toFixed(1);
    }).join(' ');
    return '<svg viewBox="0 0 56 20" class="dov-qspark"><polyline points="' + pts + '" fill="none" stroke="' + upColour + '" stroke-width="1.6"/></svg>';
  }

  function renderMarkets(){
    var host = $('dov-markets-body');
    if (!host || DOV.monitor === null) return;
    var d = DOV.monitor;
    if (!d) {
      host.innerHTML = '<p class="dov-empty">Market data is warming up — open the Global Monitor for the full terminal.</p>';
      return;
    }
    var html = '';

    var quotes = (d.markets && d.markets.items || []).slice(0, 4);
    if (quotes.length) {
      html += '<div class="dov-quotes">' + quotes.map(function (q) {
        var up = (q.chgPct || 0) >= 0;
        var col = up ? '#03c988' : '#e5484d';
        return '<div class="dov-quote">' +
          '<span class="dov-dim">' + esc(q.label || q.s) + '</span>' +
          '<b>' + (typeof q.price === 'number' ? q.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—') + '</b>' +
          '<i style="color:' + col + '">' + (up ? '▲' : '▼') + ' ' + Math.abs(q.chgPct || 0).toFixed(2) + '%</i>' +
          svgSpark(q.spark, col) +
        '</div>';
      }).join('') + '</div>';
    }

    var now = Date.now();
    var events = (d.calendar && d.calendar.items || [])
      .filter(function (e) { return e.at && e.at > now && (e.impact === 'high' || e.impact === 'medium'); })
      .sort(function (a, b) { return a.at - b.at; })
      .slice(0, 3);
    if (events.length) {
      html += '<div class="dov-sub">Upcoming news</div>' + events.map(function (e) {
        var when = new Date(e.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        return '<div class="dov-row">' +
          '<i class="dov-dot" style="background:' + (e.impact === 'high' ? '#e5484d' : '#f5a524') + '"></i>' +
          '<b>' + esc(e.country || '') + '</b>' +
          '<span class="dov-trunc">' + esc(e.title || '') + '</span>' +
          '<span class="dov-dim" style="margin-left:auto; flex-shrink:0;">' + esc(when) + '</span>' +
        '</div>';
      }).join('');
    }

    var news = (d.finance && d.finance.items || []).slice(0, 3);
    if (news.length) {
      html += '<div class="dov-sub">Financial wire</div>' + news.map(function (n) {
        var inner = '<span class="dov-trunc2">' + esc(stripHtml(n.title)) + '</span>' +
          '<span class="dov-dim" style="flex-shrink:0;">' + esc(timeAgo(n.at)) + '</span>';
        return n.url
          ? '<a class="dov-row dov-link" href="' + esc(n.url) + '" target="_blank" rel="noopener">' + inner + '</a>'
          : '<div class="dov-row">' + inner + '</div>';
      }).join('');
    }

    host.innerHTML = html || '<p class="dov-empty">Market data is warming up — open the Global Monitor for the full terminal.</p>';
  }

  // ---- trading floor overview ------------------------------------------------
  function renderFloor(){
    var host = $('dov-floor-body');
    if (!host || DOV.posts === null) return;
    var posts = DOV.posts;
    if (!posts.length) {
      host.innerHTML = '<p class="dov-empty">The floor is quiet right now — start the conversation.</p>' +
        '<a class="btn btn-ghost btn-sm" href="trading-floor.html">Open the trading floor</a>';
      return;
    }
    host.innerHTML = posts.map(function (p) {
      var text = stripHtml(p.textHtml).slice(0, 120);
      return '<div class="dov-post">' +
        '<div class="dov-post-head"><b>' + esc(p.authorName || 'Trader') + '</b>' +
          '<span class="dov-dim">' + esc(timeAgo(p.atMs)) + '</span></div>' +
        '<p>' + esc(text) + (text.length >= 120 ? '…' : '') + '</p>' +
      '</div>';
    }).join('');
  }

  // ---- daily briefing: one deterministic digest across all three -------------
  function renderBrief(){
    var host = $('dov-brief-body');
    if (!host) return;
    var dateEl = $('dov-brief-date');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

    var lines = [];

    if (DOV.monitor) {
      var d = DOV.monitor;
      var next = (d.calendar && d.calendar.items || [])
        .filter(function (e) { return e.at && e.at > Date.now() && e.impact === 'high'; })
        .sort(function (a, b) { return a.at - b.at; })[0];
      if (next) {
        lines.push('<i style="background:#e5484d"></i><span><b>' + esc(next.country || '') + ' ' + esc(next.title || '') + '</b> is the next red-folder event — ' +
          esc(new Date(next.at).toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' })) + '. Size down around it.</span>');
      }
      var top = (d.finance && d.finance.items || [])[0];
      if (top) lines.push('<i style="background:#f5c542"></i><span>On the wire: ' + esc(stripHtml(top.title)) + '</span>');
    }

    if (DOV.trades && DOV.trades.length) {
      var week = closedSince(DOV.trades, 7);
      if (week.length) {
        var s = journalAggregateStats(week);
        lines.push('<i style="background:' + (s.totalPnl >= 0 ? '#03c988' : '#e5484d') + '"></i><span>Your week so far: <b>' +
          money(s.totalPnl) + '</b> over ' + s.closedTrades + ' trade' + (s.closedTrades === 1 ? '' : 's') +
          ' (' + Math.round(s.winRate) + '% win rate).</span>');
      }
      var last5 = DOV.trades.filter(function (t) { return typeof t.pnl === 'number'; }).slice(0, 5);
      var losses = last5.filter(function (t) { return t.pnl < 0; }).length;
      if (last5.length >= 4 && losses >= 3) {
        lines.push('<i style="background:#e5484d"></i><span><b>Cool off:</b> ' + losses + ' of your last ' + last5.length + ' trades were losses. Step away before the next entry.</span>');
      }
    } else if (DOV.trades) {
      lines.push('<i style="background:#f5c542"></i><span>Your journal is empty — log today\'s trades while they\'re fresh, or load the demo data to explore.</span>');
    }

    if (DOV.posts && DOV.posts.length) {
      var dayAgo = Date.now() - 86400000;
      var fresh = DOV.posts.filter(function (p) { return p.atMs > dayAgo; }).length;
      if (fresh) lines.push('<i style="background:#7fb4ff"></i><span>' + fresh + ' new post' + (fresh === 1 ? '' : 's') + ' on the trading floor in the last 24 hours.</span>');
    }

    host.innerHTML = lines.length
      ? lines.map(function (l) { return '<div class="dov-brief-line">' + l + '</div>'; }).join('')
      : '<div class="dov-brief-line"><i style="background:#f5c542"></i><span>Pulling today\'s picture together…</span></div>';
  }

  // ---- data loading ----------------------------------------------------------
  function loadJournal(uid){
    db.collection('students').doc(uid).collection('journal').get().then(function (snap) {
      var trades = [];
      snap.forEach(function (doc) {
        if (doc.id.charAt(0) === '_') return;
        trades.push(doc.data());
      });
      trades.sort(function (a, b) {
        return ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || ''));
      });
      DOV.trades = trades;
    }).catch(function () { DOV.trades = []; })
      .then(function () { renderJournal(); renderBrief(); });
  }

  function loadMonitor(){
    var buster = Math.floor(Date.now() / 300000);
    fetch(MONITOR_URL + '?t=' + buster)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) { DOV.monitor = d || false; renderMarkets(); renderBrief(); });
  }

  function loadFloor(){
    db.collection('communityPosts').orderBy('createdAt', 'desc').limit(3).get().then(function (snap) {
      var posts = [];
      snap.forEach(function (doc) {
        var p = doc.data();
        p.atMs = p.createdAt && p.createdAt.toMillis ? p.createdAt.toMillis() : 0;
        posts.push(p);
      });
      DOV.posts = posts;
    }).catch(function () { DOV.posts = []; })
      .then(function () { renderFloor(); renderBrief(); });
  }

  // ---- boot ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function(){
    if (!$('dov')) return;
    setGreeting();
    renderFilter();
    applyFilter();

    var filter = $('dov-filter');
    if (filter) filter.addEventListener('click', function (e) {
      var btn = e.target.closest('.term-cat');
      if (!btn) return;
      if (btn.dataset.mod === '__all') {
        MOD_DEFS.forEach(function (d) { MODS[d[0]] = true; });
      } else {
        MODS[btn.dataset.mod] = !MODS[btn.dataset.mod];
        // never leave the grid fully empty — flipping the last one off resets to all
        if (MOD_DEFS.every(function (d) { return !MODS[d[0]]; })) {
          MOD_DEFS.forEach(function (d) { MODS[d[0]] = true; });
        }
      }
      try { localStorage.setItem('stryker_dash_mods', JSON.stringify(MODS)); } catch (err) {}
      renderFilter();
      applyFilter();
    });

    loadMonitor();

    var rz;
    window.addEventListener('resize', function(){
      clearTimeout(rz);
      rz = setTimeout(function(){ drawEquitySpark(null); }, 180);
    });

    if (typeof auth === 'undefined' || !auth) { DOV.trades = []; DOV.posts = []; renderJournal(); renderFloor(); return; }
    var handled = false;
    auth.onAuthStateChanged(function (user) {
      if (handled || !user) return;
      handled = true;
      loadJournal(user.uid);
      loadFloor();
    });
  });
})();
