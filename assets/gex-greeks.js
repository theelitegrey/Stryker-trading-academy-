// TradeZoro — GEX+ page: "Delta, vanna and charm exposure" panel (gex.html #gex-greeks). Classic script, no dependencies.
// DATA: GET /api/zo/profile?u=<SPX|QQQ|SPY|GLD>&x=<all|0|1> (Pro, same token as the rest of GEX+: window.strykerGexHeaders).
//   Computed on our server by the ZoroOptions feeder from the Cboe chain it already pulls (every 2 min): Black-Scholes greeks per
//   contract, summed per strike with the GEX sign convention. Columns: k, gex, dex, vanna, charm, cvol, pvol, coi, poi, gexv ($M).
// Expiry toggle: All expiries (<= 31 days) / 0DTE (today's expiry only) / Next expiry. "GEX from today's volume" = gamma x volume.
// Follows the page's market tabs (#gex-tabs). Wording: "updated X min ago" only. Education only. Not financial advice.
(function () {
  'use strict';
  var API = '/api/zo/profile';
  var MKTS = ['SPX', 'QQQ', 'SPY', 'GLD'];
  var REFRESH_MS = 2 * 60 * 1000;
  var EXPS = [['all', 'All expiries'], ['0dte', '0DTE'], ['next', 'Next expiry']];
  var root, cur = 'SPX', exp = 'all', cache = {}, timer = 0;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  // $M -> "+$1.2B" / "-$350M" / "+$40K"
  function money(m) {
    if (!fin(m)) return '–';
    var a = Math.abs(m), s = m < 0 ? '-' : '+';
    if (a >= 1000) return s + '$' + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'B';
    if (a >= 1) return s + '$' + a.toFixed(a >= 100 ? 0 : 1) + 'M';
    return s + '$' + Math.round(a * 1000) + 'K';
  }
  function ago(t) {
    if (!fin(t)) return '';
    var m = Math.max(0, Math.floor((Date.now() / 1000 - t) / 60));
    if (m < 1) return 'Live';
    if (m < 120) return 'Updated ' + m + ' min ago';
    var h = Math.floor(m / 60);
    return h < 48 ? 'Updated ' + h + ' h ago' : 'Updated ' + Math.floor(h / 24) + ' days ago';
  }
  function etDay(t) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t * 1000)).slice(0, 10); }
  // pure: toggle + the feeder's first-expiry profile -> feeder mode ('all'|'0'|'1') or { none }
  function modeFor(e, p0) {
    if (e === 'all') return 'all';
    if (!p0 || !p0.expiry || !fin(p0.t)) return null;
    var today = p0.expiry[0] === etDay(p0.t);
    if (e === '0dte') return today ? '0' : { none: true };
    return today ? '1' : '0';
  }
  function cols(p) { var o = {}; (p.cols || []).forEach(function (c, i) { o[c] = (p.rows || []).map(function (r) { return r[i]; }); }); return o; }

  function get(u, x) {
    var k = u + ':' + x, e = cache[k];
    if (e && (e.p || Date.now() - e.at < REFRESH_MS - 5000)) return e.p || Promise.resolve(e.d);
    var p = (window.strykerGexHeaders ? window.strykerGexHeaders() : Promise.resolve({}))
      .then(function (hd) { return fetch(API + '?u=' + encodeURIComponent(u) + '&x=' + x, { cache: 'no-store', headers: Object.assign({ accept: 'application/json' }, hd) }); })
      .then(function (r) { return r.json().then(function (j) { return r.ok ? j : { error: r.status === 403 ? 'pro' : (j && j.error) || 'HTTP ' + r.status }; }); })
      .catch(function (err) { return { error: String(err && err.message || err) }; })
      .then(function (j) { var prev = cache[k] || {}; cache[k] = j && !j.error ? { d: j, at: Date.now() } : { d: prev.d || j, at: prev.at || 0 }; return cache[k].d; });
    cache[k] = Object.assign({}, e || {}, { p: p });
    return p;
  }

  function tile(label, v, unit, sub) {
    return '<div class="gexo-stat gexg-stat"><span>' + esc(label) + '</span><b class="' + (fin(v) ? (v >= 0 ? 'gexg-pos' : 'gexg-neg') : '') + '">' + money(v) + (unit ? '<i>' + esc(unit) + '</i>' : '') + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
  }
  function body(html) { var b = root.querySelector('.gexg-body'); if (b) b.innerHTML = html; }
  function render(p, mode) {
    var seg = root.querySelectorAll('.gexg-exp');
    seg.forEach(function (b) { var on = b.dataset.x === exp; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    root.querySelector('.gexo-ago').textContent = p && !p.error ? ago(p.t) : '';
    if (mode && mode.none) return body('<div class="gexo-empty">' + esc(cur) + ' has no same-day expiry today, so there is no 0DTE view. Pick All expiries or Next expiry.</div>');
    if (!p) return body('<div class="gexo-empty">Loading ' + esc(cur) + ' exposures…</div>');
    if (p.error === 'pro' || p.teaser || (p.cols && p.cols.indexOf('dex') < 0)) return body('<div class="gexo-empty">Delta, vanna and charm exposure are part of Pro.</div>');
    if (p.error || !p.rows) return body('<div class="gexo-empty">Exposure data for ' + esc(cur) + ' is not available right now. It is computed every 2 minutes while the US cash market is open.</div>');
    var c = cols(p), T = p.tot || {}, hasV = !!c.gexv;
    var xs = p.expiry || [], expTxt = exp === 'all' ? xs.length + ' expiries up to ' + String(xs[xs.length - 1] || '').slice(5) : 'expiry ' + String(xs[0] || '').slice(5);
    var tiles = tile('Net GEX', T.gex, ' /1%', 'gamma × open interest') +
      (hasV ? tile('GEX from today\u2019s volume', T.gexv, ' /1%', 'gamma × today\u2019s volume') : '') +
      tile('Delta exposure', T.dex, '', 'dealer delta, $ of underlying') +
      tile('Vanna exposure', T.vanna, ' /vol pt', 'delta change per 1 IV point') +
      tile('Charm exposure', T.charm, ' /day', 'delta change by tomorrow');
    // strike table: the 25 strikes nearest spot, high to low
    var idx = c.k.map(function (k, i) { return i; }).sort(function (a, b) { return Math.abs(c.k[a] - p.spot) - Math.abs(c.k[b] - p.spot); }).slice(0, 25).sort(function (a, b) { return c.k[b] - c.k[a]; });
    var cell = function (v) { return '<td class="gexo-num ' + (fin(v) && v < 0 ? 'gexg-neg' : 'gexg-pos') + '">' + money(v) + '</td>'; };
    var spotRow = -1; idx.forEach(function (i, j) { if (spotRow < 0 && c.k[i] < p.spot) spotRow = j; });
    var rows = idx.map(function (i, j) {
      return '<tr' + (j === spotRow ? ' class="gexg-spot"' : '') + '><th class="gexo-num">' + esc(c.k[i]) + '</th>' + cell(c.gex[i]) + (hasV ? cell(c.gexv[i]) : '') + cell(c.dex[i]) + cell(c.vanna[i]) + cell(c.charm[i]) + '</tr>';
    }).join('');
    body('<p class="gexg-scope">' + esc(cur) + ' · ' + esc(expTxt) + ' · spot ' + esc(p.spot) + '</p>' +
      '<div class="gexo-stats gexg-stats">' + tiles + '</div>' +
      '<div class="gexo-tablewrap gexg-tablewrap"><table class="gexo-table gexg-table"><thead><tr><th>Strike</th><th>Net GEX</th>' + (hasV ? '<th>GEX vol</th>' : '') + '<th>DEX</th><th>Vanna</th><th>Charm</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<details class="gexg-how"><summary>How it\u2019s calculated</summary><p>Each option\u2019s delta, gamma, vanna and charm come from the Black-Scholes model at the chain\u2019s spot and the time left to the 16:00 ET close of its expiry, using the option\u2019s implied volatility (where the chain has none, the volatility that prices the option at its bid/ask mid). Each value is multiplied by open interest and the 100-share contract size, then summed per strike within 6% of spot.</p>' +
      '<p>Same sign convention as our GEX: dealers are assumed long the calls and short the puts, so calls count plus and puts minus for gamma, vanna and charm; delta exposure is delta × open interest × 100 × spot, with put deltas already negative. Units: GEX in $ per 1% move, vanna in $ of delta per 1 point of implied volatility, charm in $ of delta per calendar day. GEX from today\u2019s volume swaps open interest for today\u2019s traded volume. These are model estimates, not dealer positions.</p></details>');
  }

  function load() {
    if (!root) return;
    var u = cur, e = exp;
    if (e === 'all') return get(u, 'all').then(function (p) { if (u === cur && e === exp) render(p); });
    render(null);
    get(u, '0').then(function (p0) {
      if (u !== cur || e !== exp) return;
      if (!p0 || p0.error) return render(p0);
      var m = modeFor(e, p0);
      if (m && m.none) return render(p0, m);
      (m === '0' ? Promise.resolve(p0) : get(u, m)).then(function (p) { if (u === cur && e === exp) render(p); });
    });
  }

  function mount() {
    var host = document.getElementById('gex-greeks');
    if (!host) return;
    root = host;
    host.innerHTML = '<div class="gexo-head"><div><h3>Delta, vanna and charm exposure</h3><span class="gexo-ago" aria-live="polite"></span></div>' +
      '<div class="gexo-tabs gexg-exps" role="group" aria-label="Expiries">' + EXPS.map(function (x) { return '<button type="button" class="gexo-tab gexg-exp" data-x="' + x[0] + '" aria-pressed="false">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="gexg-body"></div><p class="gex-edu">Education only. Not financial advice.</p>';
    host.querySelector('.gexg-exps').addEventListener('click', function (e) { var b = e.target.closest('[data-x]'); if (b && b.dataset.x !== exp) { exp = b.dataset.x; load(); } });
    var tabs = document.getElementById('gex-tabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]');
      if (b && MKTS.indexOf(b.dataset.m) >= 0) setTimeout(function () { var on = tabs.querySelector('.gex-tab.is-on'); if (on && on.dataset.m === b.dataset.m && on.dataset.m !== cur) { cur = on.dataset.m; load(); } }, 0);
    });
    load();
    timer = setInterval(function () { if (document.visibilityState !== 'hidden') load(); }, REFRESH_MS);
  }
  window.__gexGreeks = { money: money, modeFor: modeFor, etDay: etDay, state: function () { return { cur: cur, exp: exp }; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
