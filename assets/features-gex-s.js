// Stryker — /features/gex-s1 and gex-s2 section previews. No libraries.
// Finished state is the default markup; html.sx-anim (only when reduced motion
// is not requested) enables start states. Transform/opacity only.
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) document.documentElement.classList.add('sx-anim');

  // count-up: only values already printed on the capture (data-to)
  function countUp(b) {
    if (reduce || b._done) return; b._done = 1;
    var to = b.getAttribute('data-to'), dec = (to.split('.')[1] || '').length, end = parseFloat(to.replace(/,/g, '')), commas = to.indexOf(',') > -1;
    function fmt(v) { return commas ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec); }
    var start = end * 0.985, t0 = null;
    function step(t) {
      if (!t0) t0 = t; var k = Math.min(1, (t - t0) / 1100); k = 1 - Math.pow(1 - k, 3);
      b.textContent = fmt(start + (end - start) * k);
      if (k < 1) requestAnimationFrame(step); else b.textContent = to;
    }
    requestAnimationFrame(step);
  }

  // ---------- S1 rail ----------
  var rail = document.querySelector('[data-sx-rail]');
  if (rail) {
    var tabs = [].slice.call(rail.querySelectorAll('.sx-tab'));
    var cards = [].slice.call(rail.querySelectorAll('.sx-slide-card'));
    var track = rail.querySelector('.sx-track'), bar = rail.querySelector('.sx-bar i');
    var cur = 0, timer = null, stopped = reduce, DUR = 6000, visible = false;
    function media(i) { return cards[i].querySelector('.sx-media'); }
    function go(i, user) {
      i = (i + cards.length) % cards.length;
      if (user) stop();
      cards[cur].classList.remove('on'); media(cur).classList.remove('sx-live');
      tabs[cur].setAttribute('aria-selected', 'false'); tabs[cur].tabIndex = -1;
      cur = i;
      cards[cur].classList.add('on');
      tabs[cur].setAttribute('aria-selected', 'true'); tabs[cur].tabIndex = 0;
      track.style.transform = 'translateX(' + (-100 * cur) + '%)';
      var tl = rail.querySelector('.sx-tabs');
      tl.scrollTo({ left: tabs[cur].offsetLeft - tl.clientWidth / 2 + tabs[cur].offsetWidth / 2, behavior: reduce ? 'auto' : 'smooth' });
      var m = media(cur); void m.offsetWidth; requestAnimationFrame(function () { m.classList.add('sx-live'); });
      if (!stopped) arm();
    }
    function arm() {
      clearTimeout(timer);
      if (stopped || !visible) return;
      bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)'; void bar.offsetWidth;
      bar.style.transition = 'transform ' + DUR + 'ms linear'; bar.style.transform = 'scaleX(1)';
      timer = setTimeout(function () { go(cur + 1); }, DUR);
    }
    function stop() { stopped = true; clearTimeout(timer); bar.style.transition = 'none'; bar.style.transform = ''; rail.classList.add('is-stopped'); }
    if (reduce) rail.classList.add('is-stopped');
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { go(i, true); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); go(cur + (e.key === 'ArrowRight' ? 1 : -1), true); tabs[cur].focus(); }
      });
    });
    rail.querySelector('.sx-arrow.prev').addEventListener('click', function () { go(cur - 1, true); });
    rail.querySelector('.sx-arrow.next').addEventListener('click', function () { go(cur + 1, true); });
    var view = rail.querySelector('.sx-view'), x0 = null, y0 = 0;
    view.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; stop(); }, { passive: true });
    view.addEventListener('touchend', function (e) {
      if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(cur + (dx < 0 ? 1 : -1), true);
    }, { passive: true });
    rail.addEventListener('toggle', stop, true); // opening "How it's calculated" stops auto-play
    rail.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse' && e.target.closest('.sx-view')) stop(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        if (visible) { media(cur).classList.add('sx-live'); arm(); } else clearTimeout(timer);
      }, { threshold: 0.35 }).observe(rail);
    } else { visible = true; media(0).classList.add('sx-live'); }
  }

  // ---------- S2 scroll showcase ----------
  var rows = [].slice.call(document.querySelectorAll('[data-sx-row]'));
  if (rows.length) {
    var links = {}; [].slice.call(document.querySelectorAll('[data-sx-ix]')).forEach(function (a) { links[a.getAttribute('data-sx-ix')] = a; });
    var idxBox = document.querySelector('.sx-index div');
    function mark(id) {
      for (var k in links) links[k].classList.toggle('on', k === id);
      var a = links[id]; if (a && idxBox) idxBox.scrollTo({ left: a.offsetLeft - 16, behavior: reduce ? 'auto' : 'smooth' });
    }
    if (!('IntersectionObserver' in window) || reduce) {
      rows.forEach(function (r) { r.classList.add('sx-in'); r.querySelector('.sx-media').classList.add('sx-live'); });
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          var m = e.target.querySelector('.sx-media');
          if (e.isIntersecting) {
            e.target.classList.add('sx-in'); m.classList.add('sx-live');
            var b = e.target.querySelector('.sx-num b'); if (b) countUp(b);
          } else if (!reduce) { m.classList.remove('sx-live'); }
        });
      }, { threshold: 0.3 });
      // which row is under the middle of the screen -> sticky index highlight
      var io3 = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) mark(e.target.id.replace('sx-f-', '')); });
      }, { rootMargin: '-45% 0px -50% 0px' });
      rows.forEach(function (r) { io.observe(r); io3.observe(r); });
    }
  }
})();
