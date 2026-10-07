// Stryker Trading Academy: testimonials section components (+ /demo-testimonials page glue)
//
// Owner order 2026-10-07: "create 4 variations of these testimonials for
// hmepage section". Four layouts rendered from ONE data file,
// assets/testimonials-data.json ({ reviews: [{ name, initials, avatar?, role?,
// when (ISO), text, source?, sample? }] }). Nothing review-related is typed
// into the HTML, so the chosen layout drops into index.html as-is:
//
//   <div data-testi="grid|marquee|bento|carousel"
//        data-src="assets/testimonials-data.json?v=N" [data-limit="12"] [data-rows="3"]></div>
//   + assets/demo-testimonials.css (.tm-* card/layout rules) + this file.
//
//   grid      A: 3-col card grid; on phones the first 4 show, "Show more" opens the rest.
//   marquee   B: N rows drifting in opposite directions (CSS keyframes on transform,
//             content duplicated once, the copy aria-hidden). Pauses on hover, on
//             touch (tap toggles), and while off screen (.tm-off). Static under
//             prefers-reduced-motion.
//   bento     C: first review (or one with featured:true) as a big quote tile,
//             the rest in mixed-size tiles; pointer glow like the homepage bentos.
//   carousel  D: scroll-snap track with hidden scrollbar, prev/next arrows (desktop)
//             and dots. Sets scrollLeft on the track itself (never scrollIntoView).
//
// Truth rules: avatars are initials circles unless a review carries the member's
// own photo URL (never stock or AI faces). "2h ago" is computed from `when` and
// refreshed each minute. sample:true adds a visible SAMPLE tag to the card.
//
// Depends on: nothing (vanilla). The page glue at the bottom (theme button,
// A/B/C/D switcher) only runs when its elements exist.

(function () {
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cache = {};

  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function load(src) {
    if (!cache[src]) {
      cache[src] = fetch(src, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        var list = Array.isArray(j) ? j : (j && j.reviews) || [];
        return list.filter(function (r) { return r && r.name && r.text; });
      });
    }
    return cache[src];
  }

  // ------------------------------------------------------------ relative time
  function ago(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24); if (d < 7) return d + 'd ago';
    var w = Math.floor(d / 7); if (d < 30) return w + 'w ago';
    var mo = Math.floor(d / 30.44); if (mo < 12) return mo + 'mo ago';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
  function refreshTimes(root) {
    $$('time[data-ago]', root).forEach(function (el) { el.textContent = ago(el.getAttribute('datetime')); });
  }

  // ------------------------------------------------------------ card markup
  function hue(name) {
    var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % 4;
  }
  function initials(r) {
    if (r.initials) return String(r.initials).slice(0, 2).toUpperCase();
    return r.name.split(/\s+/).map(function (p) { return p.charAt(0); }).join('').slice(0, 2).toUpperCase();
  }
  function safeUrl(u) {
    u = String(u || '').trim();
    return /^(https:\/\/|\/|assets\/)/.test(u) && !/["'<>\s]/.test(u) ? u : '';
  }
  function avatar(r) {
    var url = safeUrl(r.avatar);
    var ini = esc(initials(r));
    if (url) return '<span class="tm-av tm-av-photo" aria-hidden="true"><img src="' + esc(url) + '" alt="" width="44" height="44" loading="lazy" decoding="async"></span>';
    return '<span class="tm-av tm-av-' + hue(r.name) + '" aria-hidden="true">' + ini + '</span>';
  }
  function meta(r) {
    var bits = [];
    if (r.when) bits.push('<time data-ago datetime="' + esc(r.when) + '">' + esc(ago(r.when)) + '</time>');
    if (r.role) bits.push(esc(r.role));
    if (r.source) bits.push('via ' + esc(r.source));
    return bits.join('<i aria-hidden="true"> · </i>');
  }
  function card(r, cls, hidden) {
    return '<article class="tm-card' + (cls ? ' ' + cls : '') + '"' + (hidden ? ' aria-hidden="true"' : '') + '>' +
      '<header class="tm-who">' + avatar(r) +
      '<div class="tm-id"><b>' + esc(r.name) + '</b><span>' + meta(r) + '</span></div>' +
      (r.sample ? '<span class="tm-sample" title="Sample text for layout only">Sample</span>' : '') +
      '</header><p>' + esc(r.text) + '</p></article>';
  }

  // ------------------------------------------------------------ A: grid
  function renderGrid(el, list) {
    var lim = parseInt(el.getAttribute('data-limit'), 10) || list.length;
    list = list.slice(0, lim);
    el.innerHTML = '<div class="tm-grid">' + list.map(function (r) { return card(r, 'tm-gi'); }).join('') + '</div>' +
      (list.length > 4 ? '<button type="button" class="tm-more" aria-expanded="false">Show more</button>' : '');
    var btn = el.querySelector('.tm-more');
    if (btn) btn.addEventListener('click', function () {
      var open = el.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? 'Show less' : 'Show more';
    });
  }

  // ------------------------------------------------------------ B: marquee
  function renderMarquee(el, list) {
    var n = Math.max(1, Math.min(3, parseInt(el.getAttribute('data-rows'), 10) || 3));
    var rows = [];
    for (var i = 0; i < n; i++) rows.push([]);
    list.forEach(function (r, i) { rows[i % n].push(r); });
    el.innerHTML = '<div class="tm-wall">' + rows.map(function (row, i) {
      var a = row.map(function (r) { return card(r, 'tm-mq'); }).join('');
      var b = row.map(function (r) { return card(r, 'tm-mq', true); }).join('');
      var dur = Math.max(30, row.length * 11);
      return '<div class="tm-row tm-row-' + i + (i % 2 ? ' tm-rev' : '') + '">' +
        '<div class="tm-track" style="--dur:' + dur + 's"><div class="tm-set">' + a + '</div><div class="tm-set" aria-hidden="true">' + b + '</div></div></div>';
    }).join('') + '</div>';
    // touch: a tap toggles pause for that row (hover covers mouse)
    $$('.tm-row', el).forEach(function (row) {
      row.addEventListener('touchstart', function () { row.classList.toggle('tm-held'); }, { passive: true });
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { el.classList.toggle('tm-off', !e.isIntersecting); });
      }, { rootMargin: '80px' }).observe(el);
    }
  }

  // ------------------------------------------------------------ C: bento
  function renderBento(el, list) {
    var lim = parseInt(el.getAttribute('data-limit'), 10) || 7;
    var fi = 0;
    list.forEach(function (r, i) { if (r.featured && !fi) fi = i; });
    var f = list[fi];
    var rest = list.filter(function (_, i) { return i !== fi; }).slice(0, lim - 1);
    var slots = ['a', 'b', 'c', 'd', 'e', 'g'];
    el.innerHTML = '<div class="tm-bento">' +
      '<figure class="tm-tile tm-feat"><span class="tm-qm" aria-hidden="true">&ldquo;</span>' +
      '<blockquote><p>' + esc(f.text) + '</p></blockquote>' +
      '<figcaption class="tm-who">' + avatar(f) + '<div class="tm-id"><b>' + esc(f.name) + '</b><span>' + meta(f) + '</span></div>' +
      (f.sample ? '<span class="tm-sample" title="Sample text for layout only">Sample</span>' : '') + '</figcaption></figure>' +
      rest.map(function (r, i) { return card(r, 'tm-tile tm-b-' + slots[i]); }).join('') + '</div>';
    if (!reduced) {
      el.addEventListener('pointermove', function (e) {
        var t = e.target.closest && e.target.closest('.tm-tile');
        if (!t) return;
        var b = t.getBoundingClientRect();
        t.style.setProperty('--mx', (e.clientX - b.left) + 'px');
        t.style.setProperty('--my', (e.clientY - b.top) + 'px');
      });
    }
  }

  // ------------------------------------------------------------ D: carousel
  var ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  function renderCarousel(el, list) {
    var lim = parseInt(el.getAttribute('data-limit'), 10) || list.length;
    list = list.slice(0, lim);
    el.innerHTML = '<div class="tm-car">' +
      '<div class="tm-track-x" tabindex="0" role="region" aria-roledescription="carousel" aria-label="Member reviews">' +
      list.map(function (r, i) { return card(r, 'tm-slide', false).replace('<article ', '<article aria-label="' + (i + 1) + ' of ' + list.length + '" '); }).join('') +
      '</div>' +
      '<button type="button" class="tm-arrow tm-prev" aria-label="Previous review">' + ARROW + '</button>' +
      '<button type="button" class="tm-arrow tm-next" aria-label="Next review">' + ARROW + '</button>' +
      '</div><div class="tm-dots" role="group" aria-label="Choose a review">' +
      list.map(function (_, i) { return '<button type="button" aria-label="Review ' + (i + 1) + '"></button>'; }).join('') + '</div>';
    var track = el.querySelector('.tm-track-x');
    var slides = $$('.tm-slide', el);
    var dots = $$('.tm-dots button', el);
    var prev = el.querySelector('.tm-prev'), next = el.querySelector('.tm-next');
    function step() {
      if (slides.length < 2) return track.clientWidth;
      return slides[1].offsetLeft - slides[0].offsetLeft;
    }
    function maxLeft() { return Math.max(0, track.scrollWidth - track.clientWidth); }
    function go(left) {
      left = Math.max(0, Math.min(maxLeft(), left));
      if (track.scrollTo && !reduced) track.scrollTo({ left: left, behavior: 'smooth' });
      else track.scrollLeft = left;
    }
    function sync() {
      var s = step() || 1;
      var last = Math.round(maxLeft() / s);
      var idx = Math.min(last, Math.round(track.scrollLeft / s));
      if (track.scrollLeft >= maxLeft() - 2) idx = last;
      dots.forEach(function (d, i) { d.hidden = i > last; });
      dots.forEach(function (d, i) { d.classList.toggle('on', i === idx); d.setAttribute('aria-current', i === idx ? 'true' : 'false'); });
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= maxLeft() - 2;
    }
    prev.addEventListener('click', function () { go(track.scrollLeft - step()); });
    next.addEventListener('click', function () { go(track.scrollLeft + step()); });
    dots.forEach(function (d, i) { d.addEventListener('click', function () { go(i * step()); }); });
    var raf = 0;
    track.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; sync(); }); }, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  }

  var RENDER = { grid: renderGrid, marquee: renderMarquee, bento: renderBento, carousel: renderCarousel };
  function mount(el) {
    var kind = el.getAttribute('data-testi');
    var fn = RENDER[kind];
    var src = el.getAttribute('data-src') || 'assets/testimonials-data.json';
    if (!fn) return;
    load(src).then(function (list) {
      if (!list.length) { el.closest('section') && (el.closest('section').hidden = true); return; }
      fn(el, list);
      el.classList.add('tm-ready');
    }).catch(function () {
      el.innerHTML = '<p class="tm-err">Reviews could not load. Refresh to try again.</p>';
    });
  }
  window.StrykerTestimonials = { mount: mount, ago: ago };
  $$('[data-testi]').forEach(mount);
  setInterval(function () { refreshTimes(document); }, 60000);

  // ------------------------------------------------------------ demo page glue
  var root = document.documentElement;
  var tb = document.getElementById('tm-theme');
  if (tb) tb.addEventListener('click', function () {
    if (typeof window.toggleStrykerTheme === 'function') { window.toggleStrykerTheme(); return; }
    var toDay = root.getAttribute('data-theme') !== 'light';
    if (toDay) root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
    try { localStorage.setItem('stryker_theme', toDay ? 'day' : 'night'); } catch (e) {}
  });
  var chips = $$('.tm-switch a');
  if (chips.length && 'IntersectionObserver' in window) {
    var vis = {};
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { vis[e.target.id] = e.intersectionRatio; });
      var best = null, br = 0;
      Object.keys(vis).forEach(function (k) { if (vis[k] > br) { br = vis[k]; best = k; } });
      chips.forEach(function (c) { c.classList.toggle('on', best && c.getAttribute('href') === '#' + best); });
    }, { threshold: [0, .1, .25, .5, .75, 1] });
    $$('.tm-var').forEach(function (v) { io.observe(v); });
  }
})();
