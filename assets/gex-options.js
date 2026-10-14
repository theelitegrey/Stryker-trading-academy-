// TradeZoro — GEX page: "Options analytics" panel (gex.html) — classic script, no dependencies.
// Depends on: the book-recorder Worker GET /opt-analytics?u=SPX|QQQ|SPY (workers/book-recorder/
// src/options.js; computed on our server by opt-feeder/opt_feeder.py from InsightSentry option
// chains + the Cboe chain); assets/plan-limits.js (window.strykerPlanTier, optional);
// assets/plan-lock.js (strykerPlanLock.card, optional); the page's market tabs (#gex-tabs,
// assets/gex.js) are only READ to follow the selected market (gex.js is not edited).
//
// WHAT IT SHOWS (Owner-approved 2026-10-14, InsightSentry options analytics):
//   - Expected move from the ATM straddle for 0DTE / 1DTE / the weekly / the monthly expiry,
//     as an index/ETF range and mapped to ES (SPX, SPY) or NQ (QQQ).
//   - IV rank and IV percentile (VIX for SPX/SPY, VXN for QQQ, against its last 252 daily closes),
//     the 30-day ATM IV and the 30-day 25-delta skew.
//   - ATM IV term structure and 25-delta skew per expiry (small SVG charts).
//   - Put/call ratio by volume and by open interest (Cboe chain, expiries <= 31 days).
// PLAN: same split as the GEX page: Free = SPX; QQQ and SPY are Pro (lock card). Client-side only.
// WORDING: "updated X min ago" only; never live / real-time / delayed. Education only.
(function () {
  'use strict';
  var API = 'https://book-recorder.theelitegrey.workers.dev/opt-analytics?u=';
  var REFRESH_MS = 5 * 60 * 1000;
  var MKTS = ['SPX', 'QQQ', 'SPY'];
  var FREE = ['SPX'];
  var root, cur = 'SPX', tier = null, data = {}, timer = 0, agoTimer = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function fmt(v, dp) { if (!fin(v)) return '–'; return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  function pct(v, dp) { return fin(v) ? fmt(v * 100, dp == null ? 1 : dp) + '%' : '–'; }
  function dpFor(v) { return Math.abs(v) >= 1000 ? 2 : 2; }

  function agoText(t) {
    if (!fin(t)) return 'Options data: time unknown';
    var min = Math.max(0, Math.floor((Date.now() / 1000 - t) / 60));
    if (min < 1) return 'Options data updated just now';
    if (min < 120) return 'Options data updated ' + min + ' min ago';
    var h = Math.floor(min / 60);
    if (h < 48) return 'Options data updated ' + h + ' h ago';
    return 'Options data updated ' + Math.floor(h / 24) + ' days ago';
  }

  // ---- pure helpers (exported on window for tests) --------------------------------------------
  // IV-rank wording: low / mid / high thirds.
  function rankBand(r) { return !fin(r) ? '' : r < 33.4 ? 'low' : r < 66.7 ? 'mid' : 'high'; }
  // SVG polyline path for points [[x, y], ...] scaled into w x h with padding.
  function scale(points, w, h, pad, yMin, yMax) {
    var xs = points.map(function (p) { return p[0]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    if (x1 === x0) x1 = x0 + 1;
    if (yMax === yMin) { yMax += 0.01; yMin -= 0.01; }
    return points.map(function (p) {
      return [pad.l + (p[0] - x0) / (x1 - x0) * (w - pad.l - pad.r), pad.t + (1 - (p[1] - yMin) / (yMax - yMin)) * (h - pad.t - pad.b)];
    });
  }
  function niceTicks(lo, hi, n) {
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / n)));
    [1, 2, 2.5, 5, 10].some(function (m) { if (span / (step * m) <= n) { step *= m; return true; } return false; });
    var out = [], v = Math.ceil(lo / step) * step;
    for (; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  // x axis in days: log-ish (sqrt) so 0DTE..1 year all show.
  function xd(days) { return Math.sqrt(Math.max(days, 0)); }

  function lineChart(id, series, opts) {
    var w = 560, h = 190, pad = { l: 40, r: 12, t: 12, b: 26 };
    var all = [];
    series.forEach(function (s) { s.pts.forEach(function (p) { all.push(p[1]); }); });
    if (!all.length) return '<div class="gexo-empty">Not enough option data for this chart yet.</div>';
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (opts.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    var padY = (hi - lo) * 0.12 || 0.01; lo -= padY; hi += padY;
    var svg = '<svg class="gexo-svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="' + esc(opts.label) + '">';
    niceTicks(lo, hi, 4).forEach(function (t) {
      var y = pad.t + (1 - (t - lo) / (hi - lo)) * (h - pad.t - pad.b);
      svg += '<line x1="' + pad.l + '" x2="' + (w - pad.r) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="gexo-grid' + (opts.zero && t === 0 ? ' is-zero' : '') + '"/>';
      svg += '<text x="' + (pad.l - 6) + '" y="' + (y + 3.5).toFixed(1) + '" class="gexo-ylab" text-anchor="end">' + (opts.yfmt ? opts.yfmt(t) : t) + '</text>';
    });
    var allX = []; series.forEach(function (s) { s.pts.forEach(function (p) { allX.push(p[0]); }); });
    var xs0 = Math.min.apply(null, allX), xs1 = Math.max.apply(null, allX);
    (opts.xticks || []).forEach(function (t) {
      if (t[0] < xs0 - 1e-9 || t[0] > xs1 + 1e-9) return;
      var x = pad.l + (t[0] - xs0) / ((xs1 - xs0) || 1) * (w - pad.l - pad.r);
      svg += '<text x="' + x.toFixed(1) + '" y="' + (h - 8) + '" class="gexo-xlab" text-anchor="middle">' + esc(t[1]) + '</text>';
    });
    series.forEach(function (s) {
      var pts = scale(s.pts.concat([[xs0, s.pts[0][1]], [xs1, s.pts[0][1]]]), w, h, pad, lo, hi).slice(0, s.pts.length);
      if (opts.bars) {
        var bw = Math.max(3, Math.min(14, (w - pad.l - pad.r) / s.pts.length * 0.6));
        var y0 = pad.t + (1 - (0 - lo) / (hi - lo)) * (h - pad.t - pad.b);
        pts.forEach(function (p, i) {
          var v = s.pts[i][1];
          svg += '<rect x="' + (p[0] - bw / 2).toFixed(1) + '" y="' + Math.min(p[1], y0).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, Math.abs(y0 - p[1])).toFixed(1) + '" class="' + (v >= 0 ? 'gexo-bar-pos' : 'gexo-bar-neg') + '"><title>' + esc(s.tips[i]) + '</title></rect>';
        });
      } else {
        svg += '<polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" class="gexo-line ' + (s.cls || '') + '"/>';
        pts.forEach(function (p, i) { svg += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.6" class="gexo-dot ' + (s.cls || '') + '"><title>' + esc(s.tips[i]) + '</title></circle>'; });
      }
    });
    return svg + '</svg>';
  }
  var XT = [[0, '0d'], [xd(1), '1d'], [xd(7), '1w'], [xd(30), '1m'], [xd(90), '3m'], [xd(180), '6m'], [xd(365), '1y']];

  function shortDate(iso) {
    var p = String(iso).split('-'); var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1];
    return m + ' ' + (+p[2]);
  }

  function renderEm(d) {
    var futRoot = d.fut && d.fut.root;
    // the same expiry as weekly and monthly (third-Friday weeks): one row, both names
    var list = [];
    (d.em || []).forEach(function (r) {
      var prev = list[list.length - 1];
      if (prev && prev.x === r.x) prev.k = prev.k + ' · ' + r.k; else list.push(Object.assign({}, r));
    });
    var rows = list.map(function (r) {
      var f = r.fut;
      return '<tr><th scope="row"><b>' + esc(r.k).split(' · ').join('&nbsp;/ ') + '</b><small>' + esc(shortDate(r.x)) + '</small></th>' +
        '<td class="gexo-num"><b>±' + fmt(r.em, 2) + '</b> <span class="gexo-pct">' + fmt(r.pct, 2) + '%</span><small>' + fmt(r.lo, 2) + ' – ' + fmt(r.hi, 2) + '</small></td>' +
        (futRoot ? '<td class="gexo-num gexo-fut">' + (f ? '<b>±' + fmt(f.em, 2) + '</b><small>' + fmt(f.lo, 2) + '–' + fmt(f.hi, 2) + '</small>' : '–') + '</td>' : '') +
        '</tr>';
    }).join('');
    return '<div class="gexo-tablewrap"><table class="gexo-table"><thead><tr><th>Expiry</th><th>' + esc(d.u) + ' move · range</th>' +
      (futRoot ? '<th>' + esc(futRoot) + ' move · range</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function stat(label, val, sub, cls) {
    return '<div class="gexo-stat ' + (cls || '') + '"><span>' + esc(label) + '</span><b>' + val + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  }

  function render() {
    if (!root) return;
    var body = root.querySelector('.gexo-body');
    var tabs = root.querySelectorAll('.gexo-tab');
    tabs.forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.u === cur);
      b.classList.toggle('is-locked', !!(tier && tier.free && FREE.indexOf(b.dataset.u) < 0));
    });
    if (tier && tier.free && FREE.indexOf(cur) < 0) {
      body.innerHTML = '';
      if (window.strykerPlanLock) body.appendChild(window.strykerPlanLock.card('options', 'gex-options'));
      else body.innerHTML = '<div class="gexo-empty">' + esc(cur) + ' options analytics are part of Pro. The Free plan covers SPX.</div>';
      setAgo(null);
      return;
    }
    var d = data[cur];
    if (!d) { body.innerHTML = '<div class="gexo-empty">Loading ' + esc(cur) + ' options data…</div>'; setAgo(null); return; }
    if (d.error) { body.innerHTML = '<div class="gexo-empty">Options analytics are not available right now. They are computed every 5 minutes while the US cash market is open.</div>'; setAgo(null); return; }
    var ivx = d.ivx || {}, pc = d.pc || {};
    var band = rankBand(ivx.rank);
    var stats =
      stat('IV rank (' + esc(ivx.name || 'IV index') + ')', fin(ivx.rank) ? fmt(ivx.rank, 0) : '–', fin(ivx.now) ? esc(ivx.name) + ' ' + fmt(ivx.now, 2) + ' · 1y ' + fmt(ivx.lo, 1) + '–' + fmt(ivx.hi, 1) : '', band ? 'is-' + band : '') +
      stat('IV percentile', fin(ivx.pct) ? fmt(ivx.pct, 0) + '%' : '–', 'of the last ' + (ivx.n || 252) + ' days were lower') +
      stat('30-day ATM IV', pct(d.atm30), esc(d.u) + ' options') +
      stat('25Δ skew (30d)', fin(d.skew30) ? (d.skew30 >= 0 ? '+' : '') + fmt(d.skew30 * 100, 1) + ' pts' : '–', 'put IV minus call IV') +
      stat('Put/call (volume)', fin(pc.vol) ? fmt(pc.vol, 2) : '–', fin(pc.vol_first) ? 'nearest expiry ' + fmt(pc.vol_first, 2) : '') +
      stat('Put/call (open interest)', fin(pc.oi) ? fmt(pc.oi, 2) : '–', 'expiries ≤ 31 days');
    var term = (d.term || []).filter(function (r) { return fin(r[2]); });
    var termChart = lineChart('term', [{ pts: term.map(function (r) { return [xd(r[1]), r[2] * 100]; }), tips: term.map(function (r) { return shortDate(r[0]) + ': ATM IV ' + pct(r[2]); }), cls: 'is-mint' }],
      { label: 'ATM implied volatility by expiry', xticks: XT, yfmt: function (t) { return t + '%'; } });
    var sk = (d.term || []).filter(function (r) { return fin(r[3]) && fin(r[4]); });
    var skewChart = lineChart('skew', [{ pts: sk.map(function (r) { return [xd(r[1]), (r[3] - r[4]) * 100]; }), tips: sk.map(function (r) { return shortDate(r[0]) + ': 25Δ put ' + pct(r[3]) + ', call ' + pct(r[4]) + ', skew ' + fmt((r[3] - r[4]) * 100, 1) + ' pts'; }) }],
      { label: '25-delta skew by expiry', xticks: XT, bars: true, zero: true, yfmt: function (t) { return t; } });
    var hist = (d.hist || []).filter(function (h) { return fin(h[1]); });
    body.innerHTML =
      '<div class="gexo-section"><h4>Expected move <small>from the ATM straddle</small></h4>' + renderEm(d) + '</div>' +
      '<div class="gexo-stats">' + stats + '</div>' +
      '<div class="gexo-charts">' +
        '<figure class="gexo-fig"><figcaption>Term structure <small>ATM IV by expiry</small></figcaption>' + termChart + '</figure>' +
        '<figure class="gexo-fig"><figcaption>Skew <small>25Δ put IV − 25Δ call IV, points</small></figcaption>' + skewChart + '</figure>' +
      '</div>' +
      (hist.length > 1 ? '<p class="gexo-note">Our own daily ATM IV history: ' + hist.length + ' days recorded so far.</p>' : '') +
      '<p class="gexo-note">Range = spot ± the at-the-money straddle price (about a one-standard-deviation move; price stays inside it roughly two times in three). Futures ranges use the futures/' + esc(d.u) + ' price ratio at the same moment. Put/call from the Cboe chain (expiries ≤ 31 days, strikes ±10%).</p>';
    setAgo(d.t);
  }
  function setAgo(t) { var a = root && root.querySelector('.gexo-ago'); if (a) a.textContent = t ? agoText(t) : ''; }

  function load(u, force) {
    var e = data[u];
    if (!force && e && !e.error && Date.now() - (e._at || 0) < REFRESH_MS - 5000) { render(); return; }
    fetch(API + u, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { error: 'HTTP ' + r.status }; })
      .catch(function (err) { return { error: String(err && err.message || err) }; })
      .then(function (j) {
        if (j && !j.error) j._at = Date.now();
        else if (data[u] && !data[u].error) j = data[u];   // keep the last good copy
        data[u] = j; if (u === cur) render();
      });
    render();
  }

  function select(u) {
    if (MKTS.indexOf(u) < 0 || u === cur) return;
    cur = u;
    if (!(tier && tier.free && FREE.indexOf(u) < 0)) load(u); else render();
  }

  function mount() {
    var host = document.getElementById('gex-options');
    if (!host) return;
    root = host;
    host.innerHTML =
      '<div class="gexo-head"><div><h3>Options analytics</h3><span class="gexo-ago" aria-live="polite"></span></div>' +
      '<div class="gexo-tabs" role="tablist" aria-label="Options market">' + MKTS.map(function (m) { return '<button type="button" class="gexo-tab" role="tab" data-u="' + m + '">' + m + '</button>'; }).join('') + '</div></div>' +
      '<div class="gexo-body"></div>' +
      '<p class="gex-edu">Education only. Not financial advice.</p>';
    host.querySelector('.gexo-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-u]'); if (b) select(b.dataset.u); });
    // follow the page's market tabs (SPX / QQQ / SPY; GLD has no options analytics)
    var pageTabs = document.getElementById('gex-tabs');
    if (pageTabs) pageTabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]');
      if (b && MKTS.indexOf(b.dataset.m) >= 0) setTimeout(function () { var on = pageTabs.querySelector('.gex-tab.is-on'); if (on && on.dataset.m === b.dataset.m) select(b.dataset.m); }, 0);
    });
    var t0 = setTimeout(function () { tier = { free: false, unknown: true }; render(); }, 8000);
    try {
      if (typeof window.strykerPlanTier === 'function') window.strykerPlanTier().then(function (t) { clearTimeout(t0); tier = t || { free: false }; render(); }, function () { clearTimeout(t0); tier = { free: false }; render(); });
      else { clearTimeout(t0); tier = { free: false }; }
    } catch (e) { clearTimeout(t0); tier = { free: false }; }
    load(cur);
    timer = setInterval(function () { if (document.visibilityState !== 'hidden') load(cur); }, REFRESH_MS);
    agoTimer = setInterval(function () { var d = data[cur]; if (d && !d.error) setAgo(d.t); }, 60000);
  }

  window.__gexOptions = { rankBand: rankBand, niceTicks: niceTicks, agoText: agoText, lineChart: lineChart, select: function (u) { select(u); }, state: function () { return { cur: cur, tier: tier, data: data }; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
