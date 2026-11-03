/* /academy: reveals, topic tabs, search over assets/academy-index.json, and (signed-in only) level progress rings + resume card. */
(function () {
  'use strict';
  var d = document, $ = function (s, r) { return (r || d).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || d).querySelectorAll(s)); };
  var rm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var rv = $$('.az-rv');
  if (!rm && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }); }, { threshold: .14, rootMargin: '0px 0px -40px 0px' });
    rv.forEach(function (e) { if (e.getBoundingClientRect().top < innerHeight) e.classList.add('is-in'); else io.observe(e); });
    d.documentElement.classList.add('az-rv-on');
  }
  // tabs (arrow keys, roving tabindex)
  var tabs = $$('.az-tabs [role=tab]');
  function pick(t) { tabs.forEach(function (b) { var on = b === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; $('#' + b.getAttribute('aria-controls')).hidden = !on; }); t.focus(); }
  tabs.forEach(function (b, i) {
    b.addEventListener('click', function () { pick(b); });
    b.addEventListener('keydown', function (e) { var k = e.key; if (k === 'ArrowRight') pick(tabs[(i + 1) % tabs.length]); else if (k === 'ArrowLeft') pick(tabs[(i + tabs.length - 1) % tabs.length]); });
  });
  // search + progress share the index
  var idx = null;
  function load() { return idx ? Promise.resolve(idx) : fetch('assets/academy-index.json').then(function (r) { return r.json(); }).then(function (j) { return (idx = j); }); }
  var q = $('#az-q'), res = $('#az-res');
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function run() {
    var v = q.value.trim().toLowerCase(); if (v.length < 2) { res.innerHTML = ''; return; }
    load().then(function (I) {
      var out = [];
      I.ch.forEach(function (c) {
        if (c[1].toLowerCase().indexOf(v) > -1) out.push(['Chapter', 'chapter.html?ch=' + c[0], c[0] + '  ' + c[1], '']);
        c[3].forEach(function (l) { if (out.length < 40 && l.toLowerCase().indexOf(v) > -1) out.push(['Lesson', 'chapter.html?ch=' + c[0], l, 'Chapter ' + c[0] + ': ' + c[1]]); });
      });
      I.a.forEach(function (a) { if (a.t.toLowerCase().indexOf(v) > -1) out.push(['Article', a.u, a.t, '']); });
      I.g.forEach(function (g) { if (g[0].toLowerCase().indexOf(v) > -1) out.push(['Term', 'chapter.html?ch=' + g[1], g[0], 'Taught in chapter ' + g[1]]); });
      I.m.forEach(function (m) { if (m.toLowerCase().indexOf(v) > -1) out.push(['Model', 'models', m, '']); });
      res.innerHTML = out.length ? out.slice(0, 8).map(function (o) { return '<li><a href="' + o[1] + '"><em>' + o[0] + '</em><span>' + esc(o[2]) + (o[3] ? '<small>' + esc(o[3]) + '</small>' : '') + '</span></a></li>'; }).join('')
        : '<li><a href="courses"><em>None</em><span>No match. Browse the full curriculum</span></a></li>';
    }).catch(function () {});
  }
  if (q) q.addEventListener('input', run);
  // progress: only for a signed-in member who has finished lessons; otherwise nothing is shown
  function progress(user) {
    if (!user || typeof db === 'undefined' || !db) return;
    Promise.all([db.collection('students').doc(user.uid).get(), load()]).then(function (a) {
      var done = new Set((a[0].exists && a[0].data().completedLessons) || []), I = a[1], core = I.ch.filter(function (c) { return /^\d/.test(c[0]); });
      var total = 0, got = 0, next = null;
      ['foundation', 'intermediate', 'advanced'].forEach(function (lv) {
        var t = 0, n = 0;
        core.filter(function (c) { return c[2] === lv; }).forEach(function (c) { c[3].forEach(function (_, i) { t++; if (done.has(c[0] + '-' + i)) n++; }); if (!next && c[3].some(function (_, i) { return !done.has(c[0] + '-' + i); })) next = c; });
        total += t; got += n;
        var r = $('[data-ring=' + lv + ']'), p = t ? Math.round(n * 100 / t) : 0;
        if (r && n) { r.hidden = false; $('.p', r).setAttribute('stroke-dasharray', p + ' 100'); $('b', r).textContent = p + '%'; }
      });
      if (got && next) {
        $('#az-cont-t').textContent = 'Chapter ' + next[0] + ': ' + next[1]; $('#az-cont-s').textContent = got + ' of ' + total + ' core lessons done';
        $('#az-cont-a').href = 'chapter.html?ch=' + next[0]; $('#az-continue').hidden = false;
      }
    }).catch(function () {});
  }
  if (typeof auth !== 'undefined' && auth && auth.onAuthStateChanged) auth.onAuthStateChanged(progress);
})();
