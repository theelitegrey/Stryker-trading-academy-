// TradeZoro: demo homepage 1024 variation A, "TERMINAL" (demo-v1024-a.html only)
//
// Drives the workstation panels:
//   - ticker tape: duplicated for a seamless loop, runs only while in view
//   - session clock: assets/market-hours.js (StrykerMarketHours.sessionLabel),
//     a calendar clock, not market data
//   - chart panel: three real app screenshots, rotates while in view until clicked
//   - GEX ladder: GET /api/gex/levels/SPX?dte=0 (public endpoint, same one the
//     GEX page and demo-bento use); gamma by strike around spot plus the call wall,
//     put wall and zero gamma. If it fails, the real ladder screenshot stays.
//     Freshness is written as "updated X min ago", never live/real-time.
//   - alerts feed: fixed EXAMPLE lines that rotate while in view
//   - panels: accessible tabs (click, arrow keys, 1-5 keys, F-key links)
//   - Free vs Pro: comparison rows mirror assets/pricing-hero.js (the live home
//     table, itself mirroring the plans records); prices come from the live
//     plans via plan-price.js exactly like the live home. Nothing hard-coded.
//   - phone command bar: hides when the closing CTA or footer is on screen
// Motion is transform/opacity only and off under prefers-reduced-motion.
// Depends on: assets/market-hours.js, assets/plan-price.js + assets/progress.js
//             (`db`, strykerLoadPlans, strykerFxReady, planSaleInfo,
//             planMoneyDisplay, planDisplayName, planIsArchived, planEscape).
(function () {
  'use strict';
  var doc = document;
  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  var REDUCE = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function inView(el, cb) {
    if (!el) return;
    if (!('IntersectionObserver' in window)) { cb(true); return; }
    new IntersectionObserver(function (es) { es.forEach(function (e) { cb(e.isIntersecting); }); }, { threshold: 0.05 }).observe(el);
  }
  function fmt(n, d) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }

  // ------------------------------------------------------------ ticker tape
  var tape = $('.tm-tape'), track = $('#tm-tape');
  function dupTape() {
    if (!track) return;
    var orig = track.getAttribute('data-orig');
    if (!orig) { orig = track.innerHTML; track.setAttribute('data-orig', orig); }
    track.innerHTML = orig + orig;
    var w = track.scrollWidth / 2;
    track.style.setProperty('--tape-d', Math.max(30, Math.round(w / 45)) + 's');
    tape.style.setProperty('--tape-d', Math.max(30, Math.round(w / 45)) + 's');
  }
  dupTape();
  if (!REDUCE) {
    inView(tape, function (v) { tape.classList.toggle('is-run', true); tape.classList.toggle('is-paused', !v); });
    tape.addEventListener('mouseenter', function () { tape.classList.add('is-paused'); });
    tape.addEventListener('mouseleave', function () { tape.classList.remove('is-paused'); });
  }

  // ------------------------------------------------------------ session clock
  (function () {
    var MH = window.StrykerMarketHours; if (!MH) return;
    var big = $('#tm-clock-big'), head = $('#tm-clock-head'), tail = $('#tm-clock-tail'), dot = $('#tm-clock-dot'), cmd = $('#tm-cmd-s');
    var chips = $$('#tm-sess span');
    var hms = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    function tick() {
      var now = Date.now(), L = MH.sessionLabel(now);
      big.textContent = hms.format(now);
      head.textContent = L.head;
      tail.textContent = L.next ? 'Next: ' + L.next.name + ' in ' + MH.fmtClock(L.next.at - now) : '';
      dot.classList.toggle('is-on', !!L.open);
      chips.forEach(function (c) { c.classList.toggle('is-on', L.sessions.indexOf(c.getAttribute('data-s')) >= 0); });
      if (cmd) cmd.textContent = L.shortHead;
    }
    tick();
    (function loop() { setTimeout(function () { if (!doc.hidden) tick(); loop(); }, 1000 - (Date.now() % 1000) + 5); })();
  })();

  // ------------------------------------------------------------ chart panel sub-tabs
  (function () {
    var box = $('.tm-shotbox'); if (!box) return;
    var imgs = $$('img', box), btns = $$('.tm-subtabs button'), cap = $('.tm-chart .tm-pf span');
    var CAPS = ['Footprint · delta per bar · imbalances', 'Volume profile · naked POC lines', 'Absorption on a one-minute chart'];
    var cur = 0, timer = null, stopped = false, visible = false;
    function show(i) {
      cur = i;
      imgs.forEach(function (im, k) { im.classList.toggle('is-on', k === i); });
      btns.forEach(function (b, k) { b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
      if (cap) cap.textContent = CAPS[i];
    }
    function run() {
      clearInterval(timer);
      if (REDUCE || stopped || !visible) return;
      timer = setInterval(function () { if (!doc.hidden) show((cur + 1) % imgs.length); }, 5000);
    }
    btns.forEach(function (b, k) { b.addEventListener('click', function () { stopped = true; clearInterval(timer); show(k); }); });
    inView(box, function (v) { visible = v; run(); });
  })();

  // ------------------------------------------------------------ GEX ladder (real SPX data)
  (function () {
    var lad = $('#tm-ladder'), meta = $('#tm-gex-meta'); if (!lad) return;
    function ago(sec) {
      if (!sec) return '';
      var m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60));
      if (m < 60) return 'updated ' + m + ' min ago';
      var h = Math.floor(m / 60);
      if (h < 48) return 'updated ' + h + ' h ago';
      return 'updated ' + Math.floor(h / 24) + ' d ago';
    }
    function money(v) {
      var a = Math.abs(v), s = v < 0 ? '-' : '+';
      if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
      if (a >= 1e3) return s + (a / 1e3).toFixed(0) + 'K';
      return s + a.toFixed(0);
    }
    function paintMeta(d) {
      var m = d.market || {};
      var closed = m.state && m.state !== 'open' && m.state !== 'stale';
      var a = ago(m.options_ts);
      meta.textContent = 'SPX · 0DTE' + (a ? ' · ' + (closed ? 'last session, ' : '') + a : '');
    }
    fetch('/api/gex/levels/SPX?dte=0', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || d.spot == null || !d.ladder || !d.ladder.length) throw new Error('no ladder');
      $('#tm-cw').textContent = d.call_wall != null ? fmt(d.call_wall) : '—';
      $('#tm-pw').textContent = d.put_wall != null ? fmt(d.put_wall) : '—';
      $('#tm-zg').textContent = d.zero_gamma != null ? fmt(d.zero_gamma) : '—';
      var all = d.ladder.filter(function (x) { return x && isFinite(x.strike) && isFinite(x.gex); });
      // Prefer the band from the put wall to the call wall (and zero gamma) so
      // the walls show; fall back to the strikes nearest spot if it is too wide.
      var keys = [d.spot, d.call_wall, d.put_wall, d.zero_gamma].filter(function (v) { return v != null && isFinite(v); });
      var lo = Math.min.apply(null, keys) - 6, hi = Math.max.apply(null, keys) + 6;
      var rows = all.filter(function (x) { return x.strike >= lo && x.strike <= hi; });
      if (rows.length < 8 || rows.length > 24) {
        rows = all.slice().sort(function (a, b) { return Math.abs(a.strike - d.spot) - Math.abs(b.strike - d.spot); }).slice(0, 19);
      }
      rows.sort(function (a, b) { return b.strike - a.strike; });
      if (!rows.length) throw new Error('empty');
      var mx = Math.max.apply(null, rows.map(function (x) { return Math.abs(x.gex); }).concat([1]));
      var spotRow = rows.reduce(function (best, x) { return Math.abs(x.strike - d.spot) < Math.abs(best.strike - d.spot) ? x : best; }, rows[0]);
      var zgRow = d.zero_gamma != null ? rows.reduce(function (best, x) { return Math.abs(x.strike - d.zero_gamma) < Math.abs(best.strike - d.zero_gamma) ? x : best; }, rows[0]) : null;
      if (zgRow && Math.abs(zgRow.strike - d.zero_gamma) > 5) zgRow = null;
      var html = rows.map(function (x) {
        var tag = '';
        if (x.strike === d.call_wall) tag = '<em class="cw">CW</em>';
        else if (x.strike === d.put_wall) tag = '<em class="pw">PW</em>';
        else if (zgRow && x === zgRow) tag = '<em class="zg">ZG</em>';
        var w = (Math.abs(x.gex) / mx).toFixed(3);
        return '<div class="tm-row' + (x.gex < 0 ? ' neg' : '') + (x === spotRow ? ' is-spot' : '') + '">' +
          '<span class="k">' + (x === spotRow ? '▸' : '') + fmt(x.strike) + '</span>' + tag +
          '<span class="bar"><i style="--w:' + w + '"></i></span><span class="v">' + money(x.gex) + '</span></div>';
      }).join('');
      lad.insertAdjacentHTML('beforeend', '<div class="tm-rows" aria-hidden="true">' + html + '</div>');
      lad.classList.add('is-data');
      lad.setAttribute('aria-label', 'SPX gamma exposure by strike. Call wall ' + fmt(d.call_wall) + ', put wall ' + fmt(d.put_wall) + '.');
      paintMeta(d);
      setInterval(function () { paintMeta(d); }, 30000);
      // grow the bars the first time the panel is seen
      if (!REDUCE) {
        lad.classList.add('pre');
        var once = false;
        inView(lad, function (v) { if (v && !once) { once = true; requestAnimationFrame(function () { lad.classList.remove('pre'); }); } });
      }
      // add the real levels to the ticker tape
      if (track && d.call_wall != null && d.put_wall != null) {
        var orig = track.getAttribute('data-orig') || '';
        track.setAttribute('data-orig', orig +
          '<span><b>SPX</b> call wall ' + fmt(d.call_wall) + '</span><span><b>SPX</b> put wall ' + fmt(d.put_wall) + '</span>' +
          (d.zero_gamma != null ? '<span><b>SPX</b> zero gamma ' + fmt(d.zero_gamma) + '</span>' : ''));
        dupTape();
      }
    }).catch(function () {
      meta.textContent = 'SPX · 0DTE · screenshot';
    });
  })();

  // ------------------------------------------------------------ example alerts feed
  (function () {
    var feed = $('#tm-feed'); if (!feed || REDUCE) return;
    var POOL = [
      ['PRICE', '', 'NQ1! crossed your level'],
      ['INDICATOR', 'tm-tag-i', 'CVD divergence on ES1!'],
      ['PUSH', 'tm-tag-p', 'Sent to your phone'],
      ['PRICE', '', 'GC1! touched the put wall line'],
      ['INDICATOR', 'tm-tag-i', 'Big trade printed on NQ1!'],
      ['INDICATOR', 'tm-tag-i', 'Absorption spotted on ES1!'],
      ['PRICE', '', 'BTCUSDT crossed your level'],
      ['INDICATOR', 'tm-tag-i', 'Stop run swept the high on NQ1!']
    ];
    var i = 4, timer = null;
    function push() {
      var p = POOL[i % POOL.length]; i++;
      var li = doc.createElement('li');
      li.className = 'is-new';
      li.innerHTML = '<b class="tm-tag ' + p[1] + '">' + p[0] + '</b><span>' + p[2] + '</span>';
      feed.insertBefore(li, feed.firstChild);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
    }
    inView(feed, function (v) {
      clearInterval(timer);
      if (v) timer = setInterval(function () { if (!doc.hidden) push(); }, 2800);
    });
  })();

  // ------------------------------------------------------------ panels (tabs)
  (function () {
    var tabs = $$('.tm-tabs [role="tab"]'), panes = $$('.tm-xs [role="tabpanel"]'), strip = $('.tm-tabs');
    if (!tabs.length) return;
    function sel(i, focus) {
      tabs.forEach(function (t, k) {
        var on = k === i;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        panes[k].hidden = !on;
        panes[k].classList.toggle('is-on', on);
        if (on && !REDUCE) { panes[k].classList.remove('is-in'); void panes[k].offsetWidth; panes[k].classList.add('is-in'); }
      });
      if (focus) tabs[i].focus({ preventScroll: true });
      // keep the active tab visible in the strip (scrollLeft on the strip only)
      var t = tabs[i], max = strip.scrollWidth - strip.clientWidth;
      if (max > 0) strip.scrollLeft = Math.max(0, Math.min(max, t.offsetLeft - (strip.clientWidth - t.offsetWidth) / 2));
    }
    tabs.forEach(function (t, k) {
      t.addEventListener('click', function () { sel(k); });
      t.addEventListener('keydown', function (e) {
        var n = null;
        if (e.key === 'ArrowRight') n = (k + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') n = (k - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = tabs.length - 1;
        if (n !== null) { e.preventDefault(); sel(n, true); }
      });
    });
    $$('[data-go]').forEach(function (a) {
      a.addEventListener('click', function () { sel(+a.getAttribute('data-go')); });
    });
    doc.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var tg = e.target && e.target.tagName;
      if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      var n = '12345'.indexOf(e.key);
      if (n >= 0) {
        var sec = $('#panels'), r = sec.getBoundingClientRect();
        if (r.top < innerHeight && r.bottom > 0) sel(n);
      }
    });
  })();

  // ------------------------------------------------------------ Free vs Pro spec table
  (function () {
    var body = $('#tm-rows'); if (!body) return;
    // Mirrors the comparison rows in assets/pricing-hero.js (live home).
    var GROUPS = [
      ['Learn', [
        ['Curriculum chapters', '@free-ch', 'All 64'],
        ['Volume Profile and Prop Firm tracks', false, true],
        ['Progress dashboard, achievements, streak', true, true]]],
      ['Order flow', [
        ['Footprint, delta, CVD, big trades, absorption, volume profile', 'NQ (last 24 h) and crypto', 'Every supported futures market, full history']]],
      ['GEX', [
        ['Symbols', 'SPX', 'Every symbol'],
        ['Expiry views', 'Same-day (0DTE)', 'Every expiry'],
        ['Futures conversion', false, true],
        ['Strike table', false, true]]],
      ['Journal', [
        ['New trades', '20 / month', 'Unlimited'],
        ['Manual entry', true, true],
        ['Import and broker sync', false, true],
        ['Analytics and AI coach', false, true]]],
      ['Backtesting', [
        ['Replay sessions', '3 / week', 'Unlimited']]],
      ['Market desk', [
        ['Global Monitor, economic calendar, pre-market brief', true, true],
        ['Smart Money Desk, charts, trading models', false, true],
        ['Private indicators', false, true]]],
      ['Community', [
        ['Read everything', true, true],
        ['Post and send direct messages', false, true]]]
    ];
    var freeCh = '1–10';
    function cell(v) {
      if (v === true) return '<span class="y" aria-label="Included">✓</span>';
      if (v === false) return '<span class="n" aria-label="Not included">—</span>';
      if (v === '@free-ch') return 'Chapters ' + freeCh;
      return String(v);
    }
    function render() {
      body.innerHTML = GROUPS.map(function (g) {
        return '<tr class="tm-grp"><td colspan="3">' + g[0] + '</td></tr>' + g[1].map(function (r) {
          return '<tr><th scope="row">' + r[0] + '</th><td>' + cell(r[1]) + '</td><td class="tm-pro">' + cell(r[2]) + '</td></tr>';
        }).join('');
      }).join('');
    }
    render();

    // Prices and names from the live plans (same selection as pricing-hero.js).
    function whenDb(cb, n) {
      if (typeof db !== 'undefined' && db && typeof strykerLoadPlans === 'function') return cb();
      if ((n || 0) > 40) return;
      setTimeout(function () { whenDb(cb, (n || 0) + 1); }, 150);
    }
    whenDb(function () {
      var fx = (typeof strykerFxReady === 'function') ? strykerFxReady() : Promise.resolve();
      Promise.all([strykerLoadPlans(), fx]).then(function (res) {
        var all = res[0] || [];
        var price = function (p) { return p ? planSaleInfo(p).price : 0; };
        var vis = all.filter(function (p) { return !p.hidden && !planIsArchived(p); })
          .sort(function (a, b) { return ((+a.rank || 0) - (+b.rank || 0)) || (price(a) - price(b)); });
        var free = vis.find(function (p) { return !price(p); }) || null;
        var pro = vis.find(function (p) { return p.featured && price(p) > 0; }) || vis.filter(function (p) { return price(p) > 0; }).pop() || null;
        var per = function (p) { return (typeof stkPeriodKind === 'function' && stkPeriodKind(p.period) === 'year') ? 'year' : 'month'; };
        if (free) {
          $('#tm-free-name').textContent = planDisplayName(free);
          $('#tm-free-price').innerHTML = planEscape(planMoneyDisplay(0)) + ' <span class="per">/ ' + per(free) + '</span>';
          var m = String(free.chapterAccess || '').match(/^(\d+)\s*-\s*(\d+)$/);
          if (m) { freeCh = m[1] + '–' + m[2]; render(); }
        }
        if (pro) {
          var s = planSaleInfo(pro);
          $('#tm-pro-name').textContent = planDisplayName(pro);
          $('#tm-pro-price').innerHTML = planEscape(planMoneyDisplay(s.price)) + ' <span class="per">/ ' + per(pro) + '</span>' +
            (s.active ? ' <s>' + planEscape(planMoneyDisplay(s.full)) + '</s>' : '');
          var cta = $('#tm-pro-cta');
          cta.href = 'checkout.html?plan=' + encodeURIComponent(pro.id);
          cta.textContent = (pro.ctaLabel || '').trim() || 'Join Pro';
        }
      }).catch(function (e) { console.error('TradeZoro demo: plans did not load', e); });
    });
  })();

  // ------------------------------------------------------------ phone command bar
  (function () {
    var bar = $('#tm-cmd'); if (!bar) return;
    var hide = { end: false, foot: false, top: true };
    function upd() { bar.classList.toggle('is-away', hide.end || hide.foot); }
    inView($('.tm-end'), function (v) { hide.end = v; upd(); });
    inView($('body > footer'), function (v) { hide.foot = v; upd(); });
  })();
})();
