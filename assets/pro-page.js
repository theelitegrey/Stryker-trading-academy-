// TradeZoro /pro: showcase tabs, rails, reveal, the Coming soon rail and the Free vs Pro table. Data: assets/pro-features-data.js. No prices here.
(function () {
  var D = window.STRYKER_PRO_FEATURES, doc = document, root = doc.documentElement;
  var rm = false; try { rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var qa = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  // Coming soon rail (the six items flagged soon in the data file)
  var soon = doc.getElementById('pp-soon');
  if (D && soon) {
    var ico = function (k) { return '<svg class="ci" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + (D.icons[k] || D.icons.list) + '"/></svg>'; };
    soon.innerHTML = D.items.filter(function (i) { return i.soon; }).map(function (it) {
      return '<li class="pp-card is-soon"><div class="pp-ch"><span class="cm-lico">' + ico(it.icon) + '</span><span class="pp-chip pp-soon">' + (it.feed !== '—' ? it.feed + ' · ' : '') + 'Coming soon</span></div><h3>' + esc(it.name) + '</h3><p>' + esc(it.desc) + '</p></li>';
    }).join('');
  }

  // Free vs Pro: [row, free, pro] true = included, false = not included, string = note
  var cmp = doc.getElementById('pp-cmp');
  if (cmp) {
    var ROWS = [
      ['Charts, every chart type, drawings and indicators', true, true],
      ['Replay One, alerts, layouts and paper trading', true, true],
      ['Lessons, JournalX, Market Stats, ZoroTide, Liquidity Map overview', true, true],
      ['Community: read everything', true, true],
      ['Order flow: Footprint, Delta, CVD, Big Trades, Absorption, Stop Runs, Imbalance Zones', false, true],
      ['Volume Profile, VWAP and Market Profile from trades', false, true],
      ['Order book heatmap, DOM ladder, Book · DOM · Trades panel', false, true],
      ['Liquidity Walls and Book Imbalance', false, true],
      ['GEX+ levels, heatmap and Expected Move on charts', false, true],
      ['GEX+ page: every expiry, strike table, futures levels', false, true],
      ['Live CME futures data', 'Separate; 10 min delayed without it', 'Separate; 10 min delayed without it']
    ];
    var cell = function (v) { return v === true ? '<span class="pp-y" aria-label="Included">✓</span>' : v === false ? '<span class="pp-n" aria-label="Not included">—</span>' : '<span class="pp-t">' + esc(v) + '</span>'; };
    cmp.innerHTML = '<div class="pp-r pp-rh" role="row"><span role="columnheader">&nbsp;</span><span role="columnheader">Free</span><span role="columnheader">Pro</span></div>' +
      ROWS.map(function (r) { return '<div class="pp-r" role="row"><span class="pp-rn" role="rowheader">' + esc(r[0]) + '</span><span class="pp-c" role="cell" data-l="Free">' + cell(r[1]) + '</span><span class="pp-c" role="cell" data-l="Pro">' + cell(r[2]) + '</span></div>'; }).join('');
  }

  // Showcase tabs (click, touch, arrow keys)
  qa('.pp-tabs').forEach(function (list) {
    var tabs = qa('.pp-tab', list);
    function pick(i, focus) {
      tabs.forEach(function (t, k) {
        var on = k === i; t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1;
        var p = doc.getElementById(t.getAttribute('aria-controls')); if (p) { p.hidden = !on; p.classList.toggle('on', on); }
      });
      if (focus) tabs[i].focus();
      if (tabs[i].scrollIntoView) { try { tabs[i].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { pick(i); });
      t.addEventListener('keydown', function (e) {
        var k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!k) return;
        e.preventDefault(); pick((i + k + tabs.length) % tabs.length, true);
      });
    });
  });

  // Rail dots on phones
  qa('.pp-rail-wrap').forEach(function (w) {
    var rail = w.querySelector('.pp-rail'); if (!rail) return;
    var n = rail.children.length; if (n < 2) return;
    var dots = doc.createElement('div'); dots.className = 'pp-dots'; dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = new Array(n + 1).join('<i></i>'); w.appendChild(dots);
    var ds = qa('i', dots); ds[0].className = 'on';
    rail.addEventListener('scroll', function () {
      var i = Math.round(rail.scrollLeft / Math.max(1, rail.scrollWidth - rail.clientWidth) * (n - 1));
      ds.forEach(function (d, k) { d.className = k === i ? 'on' : ''; });
    }, { passive: true });
  });

  // Reveal on scroll (opacity/transform only; no motion for reduced-motion)
  var els = qa('.pp-rv');
  if (rm || typeof IntersectionObserver !== 'function') { els.forEach(function (e) { e.classList.add('is-in'); }); return; }
  root.classList.add('pp-js');
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
  els.forEach(function (e) { io.observe(e); });
})();
