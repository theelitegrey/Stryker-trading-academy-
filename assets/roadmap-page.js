/**
 * Stryker Trading Academy — Roadmap page (roadmap.html)
 *
 * The in-depth view of settings/roadmap (see roadmap-data.js): what is being
 * built with its milestones and progress, what is planned, and a shipped
 * timeline with build numbers, plus the build log. Quiet reveal on scroll.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => { if (!d) return ''; const x = new Date(d + (d.length === 10 ? 'T12:00:00Z' : '')); return isNaN(x) ? esc(d) : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  const tag = (st) => '<span class="rmp-tag is-' + st + '">' + ({ progress: 'In progress', planned: 'Planned', shipped: 'Shipped' }[st] || st) + '</span>';
  function itemCard(it) {
    const ms = it.milestones || []; let nextMarked = false;
    return '<article class="rmp-item is-' + esc(it.status) + '" id="rm-' + esc(it.id || '') + '"><div class="rmp-item-head"><div><h3>' + esc(it.title) + '</h3><p class="rmp-desc">' + esc(it.desc || '') + '</p></div>' + tag(it.status) + '</div>' +
      (it.status === 'progress' ? '<div class="rmp-prog"><div class="bar"><i style="--p:' + Math.max(2, Math.min(100, Number(it.progress) || 0)) + '%"></i></div><b>' + (Number(it.progress) || 0) + '%</b></div>' : '') +
      (it.details ? '<p class="rmp-details">' + esc(it.details) + '</p>' : '') +
      (ms.length ? '<ul class="rmp-ms">' + ms.map((m) => { const cls = m.done ? 'done' : (!nextMarked ? (nextMarked = true, 'next') : ''); return '<li class="' + cls + '"><i></i>' + esc(m.label) + '</li>'; }).join('') + '</ul>' : '') +
      (it.sub && it.sub.length && !ms.length ? '<div class="rmp-sub">' + it.sub.map((s) => '<span>' + esc(s) + '</span>').join('') + '</div>' : '') +
      '<div class="rmp-foot">' + (it.when && it.when !== 'In progress' && it.when !== 'Shipped' && it.when !== 'Planned' ? '<span>' + esc(it.when) + '</span>' : '') + (it.date ? '<span>' + fmtDate(it.date) + '</span>' : '') + (it.build ? '<span class="rmp-build">build ' + esc(it.build) + '</span>' : '') + (it.link ? '<a href="' + esc(it.link) + '">Open →</a>' : '') + '</div></article>';
  }
  function render(data) {
    const items = (data.items || []).filter((i) => i && i.title);
    $('rmp-heading').textContent = 'Roadmap';
    if (data.note) $('rmp-note').textContent = data.note;
    if (data.updatedAt) { const d = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt); if (!isNaN(d)) $('rmp-updated').textContent = 'Updated ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    const prog = items.filter((i) => i.status === 'progress'), plan = items.filter((i) => i.status === 'planned'), ship = items.filter((i) => i.status === 'shipped').sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.build || 0) - (a.build || 0));
    $('rmp-summary').innerHTML = '<div class="rmp-sum is-progress"><i></i><div><b>' + prog.length + '</b><span> in progress</span></div></div><div class="rmp-sum is-planned"><i></i><div><b>' + plan.length + '</b><span> planned</span></div></div><div class="rmp-sum is-shipped"><i></i><div><b>' + ship.length + '</b><span> shipped</span></div></div>';
    $('rmp-now-list').innerHTML = prog.map(itemCard).join('') || '<p class="rp-empty">Nothing in progress right now.</p>';
    $('rmp-planned').hidden = !plan.length; $('rmp-planned-list').innerHTML = plan.map(itemCard).join('');
    $('rmp-shipped-list').innerHTML = ship.map((it) => '<div class="rmp-tl"><div class="rmp-tl-head"><b>' + esc(it.title) + '</b>' + (it.build ? '<span class="rmp-build">build ' + esc(it.build) + '</span>' : '') + (it.date ? '<span class="rmp-date">' + fmtDate(it.date) + '</span>' : '') + (it.link ? '<a class="rm-link" href="' + esc(it.link) + '">Open →</a>' : '') + '</div><p>' + esc(it.desc || '') + '</p>' + (it.details ? '<details><summary>Details</summary><p>' + esc(it.details) + '</p></details>' : '') + '</div>').join('') || '<p class="rp-empty">Nothing shipped yet.</p>';
    const cl = (data.changelog || []).slice().sort((a, b) => (b.build || 0) - (a.build || 0));
    $('rmp-cl').hidden = !cl.length; $('rmp-cl-list').innerHTML = cl.map((c) => '<div class="rmp-cl"><span class="rmp-build">' + esc(c.build) + '</span><span class="rmp-date">' + fmtDate(c.date) + '</span><span>' + esc(c.title) + '</span></div>').join('');
    const els = document.querySelectorAll('.rmp-item, .rmp-tl');
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver((entries) => { entries.forEach((e, i) => { if (e.isIntersecting) { setTimeout(() => e.target.classList.add('is-in'), Math.min(i, 6) * 70); io.unobserve(e.target); } }); }, { threshold: 0.1 }); els.forEach((el) => io.observe(el)); }
    else els.forEach((el) => el.classList.add('is-in'));
    setTimeout(() => els.forEach((el) => el.classList.add('is-in')), 1800);   // safety net: never leave items invisible
    if (location.hash) { const target = document.querySelector(location.hash.replace(/[^#\w-]/g, '')); if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200); }
  }
  document.addEventListener('DOMContentLoaded', () => {
    if (!$('rmp-summary')) return;
    const go = () => (window.StrykerRoadmap ? window.StrykerRoadmap.load() : Promise.resolve({ items: [] })).then(render);
    if (typeof auth !== 'undefined' && auth) { let done = false; auth.onAuthStateChanged(() => { if (!done) { done = true; go(); } }); setTimeout(() => { if (!done) { done = true; go(); } }, 2500); } else go();
  });
})();
