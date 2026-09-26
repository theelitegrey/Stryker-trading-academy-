// Stryker Trading Academy — model page stats card (model.html)
// Mounts into #model-stats-slot, right after the article body. Renders
// ONLY when the model carries Owner-approved stats; otherwise the slot
// stays completely empty (no box, no heading, no "coming soon").
//
// SCHEMA (on the model object, see assets/models-data.js):
//   m.stats = {
//     approved: true,              // REQUIRED, must be boolean true (Owner-approved).
//                                   // Anything else (missing, false, "true", 1, ...) = render nothing.
//     title: "Backtest summary",   // optional heading
//     period: "Jan 2024 - Jun 2025", sample: "NQ, 5m, 212 trades",   // optional context strings
//     metrics: [ { label: "Win rate", value: 48.5, unit: "%", decimals: 1 },
//                { label: "Avg R",    value: 1.9,  unit: "R", decimals: 1 } ],   // 1-6 items
//     equity: [0, 1.2, 0.4, 2.1, ...],   // optional, cumulative R or %, 2-400 points;
//                                         // sparkline hidden if absent/invalid
//     disclaimer: "..."            // optional EXTRA text; the DEFAULT disclaimer
//                                   // below is always shown regardless
//   }
//
// TRUTH RULE: no model in assets/models-data.js may ship m.stats today — this
// file invents no numbers that can reach production. The only stats a
// visitor can ever see outside of an Owner-approved model.stats are the demo
// fixture below, which is fenced off from production in three ways: (1) only
// on localhost/127.0.0.1, (2) only with ?statsdemo=1 in the URL, (3) the
// fixture lives under tools/, which tools/check.py's deploy list excludes —
// it cannot ship. The fixture is loaded over fetch(), never inlined here.
//
// DEFAULT DISCLAIMER: DRAFT COPY pending content-developer APPROVED/REVISE
// (routed by website-developer). Do not treat the wording below as final.
(function () {

  var DEFAULT_DISCLAIMER = 'Hypothetical/backtested results have inherent ' +
    'limitations and do not represent actual trading. Past performance does ' +
    'not guarantee future results. Educational content only, not financial advice.';

  var SLOT_ID = 'model-stats-slot';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Per-mount teardown so re-renders (Reset button -> renderModel again)
  // never leak IntersectionObservers from a previous card.
  var activeTeardown = null;

  function isFiniteNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function fmtValue(value, decimals) {
    var d = isFiniteNum(decimals) ? Math.max(0, Math.min(6, Math.round(decimals))) : 0;
    return value.toFixed(d);
  }

  function validMetrics(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length && out.length < 6; i++) {
      var m = list[i];
      if (!m || typeof m !== 'object') continue;
      if (!isFiniteNum(m.value)) continue;
      var label = (typeof m.label === 'string' && m.label.trim()) ? m.label.trim() : null;
      if (!label) continue;
      out.push({
        label: label,
        value: m.value,
        unit: (typeof m.unit === 'string') ? m.unit : '',
        decimals: isFiniteNum(m.decimals) ? m.decimals : 0
      });
    }
    return out;
  }

  function validEquity(points) {
    if (!Array.isArray(points) || points.length < 2 || points.length > 400) return null;
    var out = [];
    for (var i = 0; i < points.length; i++) {
      if (!isFiniteNum(points[i])) return null;
      out.push(points[i]);
    }
    return out;
  }

  // ---- sparkline ------------------------------------------------------------
  function sparklineSvg(points) {
    var w = 260, h = 56, pad = 4;
    var min = Math.min.apply(null, points), max = Math.max.apply(null, points);
    var range = (max - min) || 1;
    var stepX = (w - pad * 2) / (points.length - 1);
    var coords = points.map(function (v, i) {
      var x = pad + i * stepX;
      var y = h - pad - ((v - min) / range) * (h - pad * 2);
      return [x, y];
    });
    var d = coords.map(function (c, i) {
      return (i === 0 ? 'M' : 'L') + c[0].toFixed(2) + ',' + c[1].toFixed(2);
    }).join(' ');
    var lastUp = points[points.length - 1] >= points[0];
    var stroke = lastUp ? 'var(--bull)' : 'var(--bear)';

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('class', 'mdl-stats-spark');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', '1.75');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('class', 'mdl-stats-spark-path');
    svg.appendChild(path);
    return { svg: svg, path: path };
  }

  // ---- count-up ---------------------------------------------------------
  // Final formatted value is placed in the DOM first (correct even if JS
  // timing/animation never runs). Animation only replaces it in-place, and
  // only when the metric is below the fold at mount time (never resets a
  // number already on screen — the build-337 first-paint rule).
  function animateCountUp(el, target, decimals) {
    var dur = 900;
    var start = null;
    function frame(t) {
      if (start === null) start = t;
      var k = Math.min(1, (t - start) / dur);
      var eased = 1 - Math.pow(1 - k, 3);
      el.textContent = fmtValue(target * eased, decimals);
      if (k < 1) requestAnimationFrame(frame);
      else el.textContent = fmtValue(target, decimals);
    }
    requestAnimationFrame(frame);
  }

  function belowFold(el) {
    var r = el.getBoundingClientRect();
    return r.top >= (window.innerHeight || document.documentElement.clientHeight);
  }

  function clearSlot(slot) {
    if (activeTeardown) { try { activeTeardown(); } catch (e) {} activeTeardown = null; }
    slot.innerHTML = '';
    slot.hidden = true;
  }

  function buildCard(slot, stats, isDemo) {
    var metrics = validMetrics(stats.metrics);
    if (metrics.length === 0) return false;
    var equity = validEquity(stats.equity);

    var card = document.createElement('section');
    card.className = 'mdl-stats-card';
    card.setAttribute('aria-label', 'Backtest statistics');

    if (isDemo) {
      var badge = document.createElement('div');
      badge.className = 'mdl-stats-demo-badge';
      badge.textContent = 'DEMO DATA';
      card.appendChild(badge);
    }

    var head = document.createElement('div');
    head.className = 'mdl-stats-head';
    var title = (typeof stats.title === 'string' && stats.title.trim()) ? stats.title.trim() : 'Backtest summary';
    var h3 = document.createElement('h3');
    h3.textContent = title;
    head.appendChild(h3);
    if ((typeof stats.period === 'string' && stats.period.trim()) || (typeof stats.sample === 'string' && stats.sample.trim())) {
      var meta = document.createElement('div');
      meta.className = 'mdl-stats-meta';
      meta.textContent = [stats.period, stats.sample].filter(function (s) {
        return typeof s === 'string' && s.trim();
      }).join(' · ');
      head.appendChild(meta);
    }
    card.appendChild(head);

    // sr-only summary sentence (the sparkline SVG itself is aria-hidden)
    var sr = document.createElement('p');
    sr.className = 'sr-only';
    sr.textContent = 'Backtest metrics: ' + metrics.map(function (m) {
      return m.label + ' ' + fmtValue(m.value, m.decimals) + (m.unit || '');
    }).join(', ') + '.';
    card.appendChild(sr);

    var grid = document.createElement('div');
    grid.className = 'mdl-stats-grid';
    var counters = []; // { el, m }
    metrics.forEach(function (m) {
      var cell = document.createElement('div');
      cell.className = 'mdl-stats-cell';
      var val = document.createElement('div');
      val.className = 'mdl-stats-val';
      var finalText = fmtValue(m.value, m.decimals) + (m.unit || '');
      val.textContent = finalText;
      var lab = document.createElement('div');
      lab.className = 'mdl-stats-lab';
      lab.textContent = m.label;
      cell.appendChild(val);
      cell.appendChild(lab);
      grid.appendChild(cell);
      counters.push({ el: val, m: m });
    });
    card.appendChild(grid);

    var sparkPath = null;
    if (equity) {
      var sparkWrap = document.createElement('div');
      sparkWrap.className = 'mdl-stats-sparkwrap';
      var built = sparklineSvg(equity);
      sparkWrap.appendChild(built.svg);
      sparkPath = built.path;
      card.appendChild(sparkWrap);
    }

    // disclaimers: default always, extra optional, body-copy colour (ink-2)
    var disc = document.createElement('p');
    disc.className = 'mdl-stats-disclaimer';
    disc.textContent = DEFAULT_DISCLAIMER;
    card.appendChild(disc);
    if (typeof stats.disclaimer === 'string' && stats.disclaimer.trim()) {
      var extra = document.createElement('p');
      extra.className = 'mdl-stats-disclaimer';
      extra.textContent = stats.disclaimer.trim();
      card.appendChild(extra);
    }

    slot.appendChild(card);
    slot.hidden = false;

    // ---- motion: count-up + sparkline draw-in ------------------------------
    if (reduced || !('IntersectionObserver' in window)) {
      return true; // final numbers/static sparkline already in place
    }

    if (sparkPath) {
      var len = 0;
      try { len = sparkPath.getTotalLength(); } catch (e) { len = 0; }
      if (len > 0) {
        sparkPath.style.strokeDasharray = len;
        sparkPath.style.strokeDashoffset = len;
      }
    }

    // If the whole card is already on screen at mount, never hide/replay —
    // leave the final values and a fully drawn sparkline in place.
    if (!belowFold(card)) {
      if (sparkPath) { sparkPath.style.strokeDashoffset = 0; }
      return true;
    }

    var played = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting || played) return;
        played = true;
        counters.forEach(function (c) {
          c.el.textContent = fmtValue(0, c.m.decimals) + (c.m.unit || '');
          animateCountUp(c.el, c.m.value, c.m.decimals);
        });
        if (sparkPath) {
          sparkPath.style.transition = 'stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1)';
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { sparkPath.style.strokeDashoffset = 0; });
          });
        }
        io.disconnect();
      });
    }, { threshold: 0.25 });
    io.observe(card);
    activeTeardown = function () { io.disconnect(); };
    return true;
  }

  function isDemoRequest() {
    var host = location.hostname;
    var localHost = (host === 'localhost' || host === '127.0.0.1');
    if (!localHost) return false;
    return new URLSearchParams(location.search).get('statsdemo') === '1';
  }

  function renderFromModel(m) {
    var slot = document.getElementById(SLOT_ID);
    if (!slot) return;
    clearSlot(slot);

    if (isDemoRequest()) {
      fetch('tools/fixtures/model-stats-demo.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (fixture) {
          if (!fixture || fixture.approved !== true) return;
          buildCard(slot, fixture, true);
        })
        .catch(function (e) { console.error('Stryker: stats demo fixture failed', e); });
      return;
    }

    var stats = m && m.stats;
    if (!stats || stats.approved !== true) return; // strict: render nothing
    buildCard(slot, stats, false);
  }

  document.addEventListener('stryker:model-rendered', function (e) {
    try { renderFromModel(e.detail && e.detail.model); }
    catch (err) { console.error('Stryker: model-stats render failed', err); }
  });

})();
