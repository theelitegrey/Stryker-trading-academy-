/**
 * Stryker Trading Academy — "What's next" roadmap strip (user dashboard)
 *
 * An animated timeline at the top of dashboard-user.html showing what has
 * just shipped, what is being built now, and what is planned. Content comes
 * from Firestore settings/roadmap when that doc exists:
 *   { items: [ { title, desc, status: 'shipped'|'progress'|'planned',
 *                when: 'Sep 2026', progress: 0-100, link, sub: ['…'] } ],
 *     heading, note }
 * and falls back to DEFAULT_ITEMS below. Motion: track draws in, nodes pop
 * in staggered, a pulse travels the track, the in-progress node breathes and
 * cycles through its sub-features. Honors prefers-reduced-motion. Members can
 * collapse it; the choice is remembered per browser.
 */
(function () {
  'use strict';
  const DEFAULT = {
    heading: "What's next at Stryker",
    note: 'Built in the open. Members see new modules the day they ship.',
    items: [
      { title: 'Smart Money desk', desc: 'Congress trades and insider filings, refreshed daily.', status: 'shipped', when: 'Shipped', link: 'smart-money.html' },
      { title: 'Charts workspace', desc: 'Live multi-provider charting inside the academy.', status: 'shipped', when: 'Shipped', link: 'charts.html' },
      { title: 'Backtest replay', desc: 'Bar-by-bar replay with simulated orders, ICT indicators and a coach.', status: 'shipped', when: 'Shipped', link: 'backtests.html' },
      { title: 'Full backtesting module', desc: 'In-depth analytics, strategy testing and Pine Script integration.', status: 'progress', when: 'In progress', progress: 35, sub: ['In-depth analytics', 'Strategy testing', 'Pine Script integration', 'Portfolio-level stats'] }
    ]
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'stryker_roadmap_collapsed';
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function render(mount, data) {
    const items = (data.items || []).filter((i) => i && i.title).slice(0, 8);
    if (!items.length) { mount.hidden = true; return; }
    const collapsed = (function () { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } })();
    const cur = items.findIndex((i) => i.status === 'progress');
    const n = items.length;
    mount.innerHTML = '<section class="rm' + (collapsed ? ' is-collapsed' : '') + (reduced ? ' is-static' : '') + '" aria-label="Roadmap">' +
      '<div class="rm-bg"></div>' +
      '<div class="rm-head"><div><span class="rm-kicker"><i></i>ROADMAP</span><h2>' + esc(data.heading || DEFAULT.heading) + '</h2></div><p>' + esc(data.note || '') + '</p><button type="button" class="rm-toggle" aria-expanded="' + (!collapsed) + '">' + (collapsed ? 'Show' : 'Hide') + '</button></div>' +
      '<div class="rm-body">' +
        '<div class="rm-track"><svg class="rm-line" viewBox="0 0 1000 12" preserveAspectRatio="none" aria-hidden="true"><line class="rm-line-base" x1="0" y1="6" x2="1000" y2="6"/><line class="rm-line-done" x1="0" y1="6" x2="' + (cur >= 0 ? (1000 * (cur + 0.5) / n) : 1000) + '" y2="6"/></svg><span class="rm-pulse" aria-hidden="true"></span>' +
          items.map((it, i) => '<div class="rm-node is-' + esc(it.status || 'planned') + '" style="left:' + (100 * (i + 0.5) / n) + '%; --d:' + (0.35 + i * 0.22) + 's"><span class="rm-dot">' + (it.status === 'shipped' ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg>' : it.status === 'progress' ? '<i class="rm-orbit"></i>' : '') + '</span></div>').join('') +
        '</div>' +
        '<div class="rm-cards" style="--n:' + n + '">' + items.map((it, i) => {
          const tag = it.status === 'shipped' ? 'Shipped' : it.status === 'progress' ? 'In progress' : 'Planned';
          const inner = '<div class="rm-when"><b>' + esc(tag) + '</b>' + (it.when && it.when !== tag ? '<span>' + esc(it.when) + '</span>' : '') + '</div><h3>' + esc(it.title) + '</h3><p>' + esc(it.desc || '') + '</p>' +
            (it.status === 'progress' ? '<div class="rm-prog"><i style="--p:' + Math.max(4, Math.min(100, Number(it.progress) || 30)) + '%"></i></div>' + (it.sub && it.sub.length ? '<div class="rm-sub" data-sub="' + esc(JSON.stringify(it.sub)) + '"><span>' + esc(it.sub[0]) + '</span></div>' : '') : '') +
            (it.link ? '<span class="rm-more">Open →</span>' : '');
          return (it.link ? '<a href="' + esc(it.link) + '"' : '<div') + ' class="rm-card is-' + esc(it.status || 'planned') + '" style="--d:' + (0.55 + i * 0.22) + 's">' + inner + (it.link ? '</a>' : '</div>');
        }).join('') + '</div>' +
      '</div></section>';
    const root = mount.querySelector('.rm');
    root.querySelector('.rm-toggle').addEventListener('click', () => { const c = root.classList.toggle('is-collapsed'); root.querySelector('.rm-toggle').textContent = c ? 'Show' : 'Hide'; root.querySelector('.rm-toggle').setAttribute('aria-expanded', String(!c)); try { localStorage.setItem(KEY, c ? '1' : '0'); } catch (e) { /* private mode */ } });
    // sub-feature ticker on the in-progress card
    const sub = root.querySelector('.rm-sub'); if (sub && !reduced) { let list = []; try { list = JSON.parse(sub.dataset.sub); } catch (e) { list = []; } if (list.length > 1) { let k = 0; setInterval(() => { k = (k + 1) % list.length; const s = sub.querySelector('span'); s.classList.add('is-out'); setTimeout(() => { s.textContent = list[k]; s.classList.remove('is-out'); }, 260); }, 2600); } }
    // travelling pulse along the completed part of the track
    const pulse = root.querySelector('.rm-pulse'); if (pulse && !reduced) { const end = cur >= 0 ? 100 * (cur + 0.5) / n : 100; pulse.style.setProperty('--end', end + '%'); }
    requestAnimationFrame(() => root.classList.add('is-in'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    const mount = document.getElementById('dash-roadmap'); if (!mount) return;
    const go = (data) => render(mount, data || DEFAULT);
    if (typeof db === 'undefined' || !db) { go(DEFAULT); return; }
    let done = false; const t = setTimeout(() => { if (!done) { done = true; go(DEFAULT); } }, 2500);
    db.collection('settings').doc('roadmap').get().then((doc) => { if (done) return; done = true; clearTimeout(t); go(doc.exists && doc.data() && Array.isArray(doc.data().items) ? doc.data() : DEFAULT); }).catch(() => { if (!done) { done = true; clearTimeout(t); go(DEFAULT); } });
  });
})();
