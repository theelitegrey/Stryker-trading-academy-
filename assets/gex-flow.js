// TradeZoro — GEX page: "Options volume by strike" panel (gex.html) — classic script, no dependencies.
// Depends on: GET /api/gex/flow/:name (functions/api/gex/flow/[name].js: calls vs puts volume per strike from
// the compact Cboe chain our server already records every 2 min in market hours; no new data source);
// assets/plan-limits.js (window.strykerPlanTier, optional); assets/plan-lock.js (optional); the page's market
// tabs (#gex-tabs) are only READ, to follow the selected market.
// SHOWS (Owner order 2026-10-24, "features like deepcharts", batch 2): for SPX / QQQ / SPY, per expiry (the
// chain's first three) or all three together: call volume (right) vs put volume (left) for the strikes around
// spot, the put/call volume ratio, and the busiest call / put strikes. Volume only: Cboe's chain has no buyer /
// seller side and no traded premium, so nothing here says "bought", "sold", "bullish" or "bearish".
// PLAN: same as the Options analytics panel: Free = SPX, QQQ / SPY = Pro. WORDING: "updated X min ago" only.
// Education only. Not financial advice.
(function () {
  'use strict';
  var API = '/api/gex/flow/';
  var REFRESH_MS = 2 * 60 * 1000;
  var MKTS = ['SPX', 'QQQ', 'SPY'], FREE = ['SPX'];
  var EACH = 10;   // strikes each side of spot
  var root, cur = 'SPX', exp = 0, tier = null, data = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function fmtK(v) { if (!fin(v)) return '–'; var a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e4 ? Math.round(v / 1e3) + 'K' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v)); }
  function fmtK0(v) { return fin(v) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '–'; }
  function agoText(t) {
    if (!fin(t)) return '';
    var min = Math.max(0, Math.floor((Date.now() / 1000 - t) / 60));
    if (min < 1) return 'Options volume updated just now';
    if (min < 120) return 'Options volume updated ' + min + ' min ago';
    var h = Math.floor(min / 60);
    return h < 48 ? 'Options volume updated ' + h + ' h ago' : 'Options volume updated ' + Math.floor(h / 24) + ' days ago';
  }
  function shortDate(iso) { var p = String(iso).split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1] + ' ' + (+p[2]); }
  function near(rows, spot) {
    var i = 0; while (i < rows.length && rows[i][0] < spot) i++;
    return rows.slice(Math.max(0, i - EACH), i + EACH);
  }
  function top(rows, k) { return rows.filter(function (r) { return r[k] > 0; }).sort(function (a, b) { return b[k] - a[k] || a[0] - b[0]; }).slice(0, 3); }

  function bars(rows, spot) {
    var mx = 1; rows.forEach(function (r) { mx = Math.max(mx, r[1], r[2]); });
    var spotDone = false, html = '';
    rows.slice().reverse().forEach(function (r) {   // highest strike on top, like a price ladder
      if (!spotDone && r[0] < spot) { html += '<div class="gexf-spot" role="presentation"><span>spot ' + fmtK0(spot) + '</span></div>'; spotDone = true; }
      var cw = (r[1] / mx * 100).toFixed(1), pw = (r[2] / mx * 100).toFixed(1);
      html += '<div class="gexf-row" title="' + esc(fmtK0(r[0]) + ': calls ' + fmtK0(r[1]) + ', puts ' + fmtK0(r[2]) + ' (OI ' + fmtK0(r[3]) + ' / ' + fmtK0(r[4]) + ')') + '">' +
        '<span class="gexf-pv">' + (r[2] ? fmtK(r[2]) : '') + '</span>' +
        '<span class="gexf-put"><i style="width:' + pw + '%"></i></span>' +
        '<b class="gexf-k">' + fmtK0(r[0]) + '</b>' +
        '<span class="gexf-call"><i style="width:' + cw + '%"></i></span>' +
        '<span class="gexf-cv">' + (r[1] ? fmtK(r[1]) : '') + '</span></div>';
    });
    if (!spotDone) html += '<div class="gexf-spot" role="presentation"><span>spot ' + fmtK0(spot) + '</span></div>';
    return '<div class="gexf-main"><div class="gexf-head"><span>Put volume</span><span>Strike</span><span>Call volume</span></div><div class="gexf-ladder">' + html + '</div></div>';
  }

  function render() {
    if (!root) return;
    var body = root.querySelector('.gexf-body');
    root.querySelectorAll('.gexf-tab').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.u === cur);
      b.classList.toggle('is-locked', !!(tier && tier.free && FREE.indexOf(b.dataset.u) < 0));
    });
    setAgo(null);
    if (tier && tier.free && FREE.indexOf(cur) < 0) {
      body.innerHTML = '';
      if (window.strykerPlanLock) body.appendChild(window.strykerPlanLock.card('options', 'gex-flow'));
      else body.innerHTML = '<div class="gexo-empty">' + esc(cur) + ' options volume is part of Pro. The Free plan covers SPX.</div>';
      return;
    }
    var d = data[cur];
    if (!d) { body.innerHTML = '<div class="gexo-empty">Loading ' + esc(cur) + ' options volume…</div>'; return; }
    if (d.error) { body.innerHTML = '<div class="gexo-empty">Options volume is not available right now. It is read from the option chain we record every 2 minutes while the US cash market is open.</div>'; return; }
    var list = d.expiries.concat([d.all]);
    if (exp >= list.length) exp = 0;
    var e = list[exp];
    var chips = list.map(function (x, i) {
      var lab = x.x === 'all' ? 'All 3' : (x.dte === 0 ? '0DTE' : shortDate(x.x));
      return '<button type="button" class="gexf-exp' + (i === exp ? ' is-on' : '') + '" data-i="' + i + '">' + esc(lab) + '</button>';
    }).join('');
    var tc = top(e.rows, 1), tp = top(e.rows, 2);
    var tl = function (a, k) { return a.length ? a.map(function (r, j) { return '<span>' + (j + 1) + '. ' + fmtK0(r[0]) + ' <small>' + fmtK(r[k]) + '</small></span>'; }).join('') : '<span>–</span>'; };
    var rowsNear = near(e.rows, d.spot);
    body.innerHTML =
      '<div class="gexf-exps" role="group" aria-label="Expiry">' + chips + '</div>' +
      '<div class="gexo-stats gexf-stats">' +
        '<div class="gexo-stat"><span>Call volume</span><b class="gexf-c">' + fmtK(e.calls) + '</b><small>all strikes, ' + (e.x === 'all' ? '3 expiries' : 'expiry ' + esc(shortDate(e.x))) + '</small></div>' +
        '<div class="gexo-stat"><span>Put volume</span><b class="gexf-p">' + fmtK(e.puts) + '</b><small>open interest ' + fmtK(e.poi) + ' puts / ' + fmtK(e.coi) + ' calls</small></div>' +
        '<div class="gexo-stat"><span>Put/call (volume)</span><b>' + (fin(e.pc) ? e.pc.toFixed(2) : '–') + '</b><small>puts traded per call</small></div>' +
      '</div>' +
      '<div class="gexf-wrap">' + (rowsNear.length ? bars(rowsNear, d.spot) : '<div class="gexo-empty">No strikes near spot in this expiry.</div>') +
        '<div class="gexf-tops"><div><h5>Busiest call strikes</h5>' + tl(tc, 1) + '</div><div><h5>Busiest put strikes</h5>' + tl(tp, 2) + '</div></div></div>' +
      '<p class="gexo-note">Session ' + esc(d.chain_day ? shortDate(d.chain_day) : '–') + ' (Cboe chain time ' + esc(String(d.chain_time || '').slice(11, 16)) + ' New York). Volume = contracts traded that session, per strike, ' + EACH + ' strikes each side of spot (±5% kept). The chain has no buyer / seller side, so this shows how much traded, not who was buying.</p>';
    setAgo(d.fetched_at);
  }
  function setAgo(t) { var a = root && root.querySelector('.gexf-ago'); if (a) a.textContent = t ? agoText(t) : ''; }

  function load(u, force) {
    var e = data[u];
    if (!force && e && !e.error && Date.now() - (e._at || 0) < REFRESH_MS - 5000) { render(); return; }
    fetch(API + u, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { error: 'HTTP ' + r.status }; })
      .catch(function (err) { return { error: String(err && err.message || err) }; })
      .then(function (j) {
        if (j && !j.error && Array.isArray(j.expiries)) j._at = Date.now();
        else if (data[u] && !data[u].error) j = data[u];
        else j = { error: (j && j.error) || 'bad reply' };
        data[u] = j; if (u === cur) render();
      });
    render();
  }
  function select(u) {
    if (MKTS.indexOf(u) < 0 || u === cur) return;
    cur = u; exp = 0;
    if (!(tier && tier.free && FREE.indexOf(u) < 0)) load(u); else render();
  }
  function mount() {
    var host = document.getElementById('gex-flow');
    if (!host) return;
    root = host;
    host.innerHTML =
      '<div class="gexo-head"><div><h3>Options volume by strike</h3><span class="gexo-ago gexf-ago" aria-live="polite"></span></div>' +
      '<div class="gexo-tabs" role="tablist" aria-label="Options market">' + MKTS.map(function (m) { return '<button type="button" class="gexo-tab gexf-tab" role="tab" data-u="' + m + '">' + m + '</button>'; }).join('') + '</div></div>' +
      '<div class="gexf-body"></div>' +
      '<p class="gex-edu">Education only. Not financial advice.</p>';
    host.querySelector('.gexo-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-u]'); if (b) select(b.dataset.u); });
    host.querySelector('.gexf-body').addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) { exp = +b.dataset.i; render(); } });
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
    setInterval(function () { if (document.visibilityState !== 'hidden') load(cur); }, REFRESH_MS);
    setInterval(function () { var d = data[cur]; if (d && !d.error) setAgo(d.fetched_at); }, 60000);
  }
  window.__gexFlow = { agoText: agoText, near: near, top: top, select: function (u) { select(u); }, expiry: function (i) { exp = i; render(); }, state: function () { return { cur: cur, exp: exp, tier: tier, data: data }; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
