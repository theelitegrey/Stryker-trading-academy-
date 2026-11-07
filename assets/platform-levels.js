// "Use our levels in your platform" page (platform-levels.html). Pro only; the server checks Pro on every call (/api/lv/*), this file only shows the result.
// Data: /api/lv/pack (the member's sign-in token) and the private link /api/lv/feed/<secret>.<ext> (made with POST /api/lv/token).
// Education only. Not financial advice.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SYMS = ['SPX', 'SPY', 'QQQ', 'ES', 'NQ'];
  var KEY = 'tz_lv_secret';
  var st = { u: 'SPX', inc: ['gex', 'em', 'nodes', 'dp'], pack: null, secret: null, active: false };
  var SCRIPT = '/assets/platform-levels/';

  // Each platform: what it needs and the three steps. kind: 'link' (reads the link), 'file' (reads a saved file), 'paste' (text is pasted in).
  var PLATFORMS = [
    { id: 'tv', name: 'TradingView', sub: 'Pine script, levels pasted as text', actions: [['copy', 'Copy levels', 'tv'], ['get', 'Download script', 'tradezoro-levels.pine']],
      steps: ['Press Copy levels here. Then download the script and open Pine Editor in TradingView, paste the script and press Add to chart.', 'Open the script settings (the gear on its name) and paste the copied text into "Pasted levels".', 'Lines appear on the chart. Paste a fresh copy whenever you want the newest levels.'] },
    { id: 'nt8', name: 'NinjaTrader 8', sub: 'Indicator that reads your private link', actions: [['get', 'Download indicator', 'TradeZoroLevels.cs'], ['link', 'Copy link', 'csv']],
      steps: ['Download the indicator and copy it to Documents\\NinjaTrader 8\\bin\\Custom\\Indicators. In the NinjaScript Editor press F5.', 'Add "TradeZoro levels" to a chart. Paste your link into "Levels link" (or a saved CSV path into "Or a file path").', 'Lines refresh every few minutes on their own. Turn your link off here at any time.'] },
    { id: 'sc', name: 'Sierra Chart', sub: 'Study that draws lines from a CSV file', actions: [['file', 'Download levels file', 'csv', 'tradezoro-levels.csv'], ['get', 'Download study', 'TradeZoroLevelsSierra.cpp']],
      steps: ['Save the levels file anywhere. Copy the study file to your Sierra Chart ACS_Source folder, then Analysis > Build Custom Studies DLL > Build.', 'Add the study "TradeZoro levels" to a chart and pick the levels file in its settings.', 'Download a new file over the old one to update. The study re-reads it every minute.'] },
    { id: 'tos', name: 'thinkorswim', sub: 'thinkScript with today\'s values', actions: [['copy', 'Copy thinkScript', 'tos'], ['file', 'Download as text', 'tos', 'tradezoro-levels.ts']],
      steps: ['Press Copy thinkScript. In thinkorswim open Charts > Studies > Edit Studies > Create.', 'Delete the sample code, paste the script, name it "TradeZoroLevels" and press OK.', 'Add it to the chart. The values are fixed, so paste a fresh copy to update.'] },
    { id: 'mt5', name: 'MetaTrader 5', sub: 'Indicator that reads a CSV file', actions: [['file', 'Download levels file', 'csv', 'tradezoro-levels.csv'], ['get', 'Download indicator', 'TradeZoroLevels.mq5']],
      steps: ['In MetaTrader choose File > Open Data Folder. Put the levels file in MQL5\\Files and the indicator in MQL5\\Indicators.', 'Open the indicator in MetaEditor and press F7 (compile). Drag "TradeZoro levels" onto a chart.', 'Save a new levels file over the old one to update. It is re-read every minute.'] },
    { id: 'ct', name: 'cTrader', sub: 'Indicator that reads your private link', actions: [['get', 'Download indicator', 'TradeZoroLevelsCtrader.cs'], ['link', 'Copy link', 'csv']],
      steps: ['In cTrader open Algo, choose Indicators > New, and replace the code with the downloaded file. Press Build.', 'Add the indicator to a chart. Paste your link into "Levels link".', 'Lines refresh on their own. Turn your link off here at any time.'] },
    { id: 'qt', name: 'Quantower', sub: 'Indicator that reads your private link', actions: [['get', 'Download indicator', 'TradeZoroLevelsQuantower.cs'], ['link', 'Copy link', 'csv']],
      steps: ['Put the downloaded file in a new folder under Quantower\\Settings\\Scripts\\Indicators and build it from the Algo panel.', 'Add "TradeZoro levels" to a chart. Paste your link into "Levels link".', 'Lines refresh on their own. Turn your link off here at any time.'] },
    { id: 'bm', name: 'Bookmap', sub: 'Price, name and colour list (CSV)', actions: [['file', 'Download price list', 'prices', 'tradezoro-prices.csv']],
      steps: ['Download the price list. Each row is a price, a name and a colour.', 'In Bookmap open your price-level tool (or add-on) and import the list, or type the prices in as alerts or lines.', 'Download a new list when you want the newest levels.'] },
    { id: 'gen', name: 'TrendSpider and other tools', sub: 'Plain CSV or JSON for anything else', actions: [['file', 'Download CSV', 'csv', 'tradezoro-levels.csv'], ['file', 'Download JSON', 'json', 'tradezoro-levels.json']],
      steps: ['Download the CSV (or JSON). Columns: symbol, type, label, price, value, day, updated.', 'Draw the prices as horizontal lines or alerts with your tool, or import them as a list.', 'Download a new file to update. If your tool can read a web link, use your private link above.'] }
  ];

  var ICON = { get: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>' };
  var CHEV = '<svg class="pl-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function headers() { return window.strykerGexHeaders ? window.strykerGexHeaders() : Promise.resolve({}); }
  function api(path, opt) {
    return headers().then(function (h) {
      var o = Object.assign({ cache: 'no-store' }, opt || {});
      o.headers = Object.assign({}, h, o.headers || {});
      return fetch(path, o);
    });
  }
  function qs(fmt) { return 'u=' + st.u + '&inc=' + (st.inc.length ? st.inc.join(',') : 'gex') + (fmt ? '&format=' + fmt : ''); }
  function packUrl(fmt) { return '/api/lv/pack?' + qs(fmt); }
  function linkUrl(ext) { return location.origin + '/api/lv/feed/' + st.secret + '.' + (ext || 'csv') + '?u=' + st.u + '&inc=' + st.inc.join(','); }

  // ---- wall (not Pro / signed out) ----
  function wall(kind) {
    var w = $('pl-wall'); $('pl-app').hidden = true; w.hidden = false; w.innerHTML = '';
    if (kind === 'signin') {
      w.innerHTML = '<section class="pl-card"><h2>Sign in to use this page</h2><p class="pl-sub">Levels for your platform are part of Pro. Sign in with your account to continue.</p><div class="pl-row"><a class="pl-btn pl-primary" href="login.html?next=platform-levels">Sign in</a></div></section>';
    } else if (window.strykerPlanLock) w.appendChild(window.strykerPlanLock.card('levels', 'platform-levels'));
    else w.innerHTML = '<section class="pl-card"><h2>Levels for your platform are part of Pro</h2><div class="pl-row"><a class="pl-btn pl-primary" href="pricing.html">See plans</a></div></section>';
  }
  function signedIn() { try { return !!(window.firebase && firebase.apps.length && firebase.auth().currentUser); } catch (e) { return false; } }

  // ---- preview ----
  function ago(iso) {
    var m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
    return m < 1 ? 'Updated just now' : m < 60 ? 'Updated ' + m + ' min ago' : m < 1440 ? 'Updated ' + Math.floor(m / 60) + ' h ago' : 'Updated ' + Math.floor(m / 1440) + ' d ago';
  }
  var GROUPS = { gex: 'GEX levels', em: 'Zoro Range', nodes: 'Zoro Levels', dp: 'Dark pool levels' };
  var GKEY = { call_ceiling: 'gex', flip_line: 'gex', put_floor: 'gex', pin_strike: 'gex', zoro_level: 'nodes', dark_pool: 'dp' };
  function renderPrev(j) {
    var el = $('pl-prev');
    if (!j || !j.levels || !j.levels.length) { el.innerHTML = '<p class="pl-hint">No levels for this choice right now.</p>'; return; }
    var rows = '', lastG = '';
    j.levels.forEach(function (r) {
      var g = GKEY[r.type] || 'em';
      if (g !== lastG) { rows += '<tr class="pl-g"><th colspan="2" scope="colgroup">' + GROUPS[g] + '</th></tr>'; lastG = g; }
      rows += '<tr><td><i style="background:' + esc(r.color) + '" aria-hidden="true"></i>' + esc(r.label) + '</td><td>' + esc(r.price) + '</td></tr>';
    });
    el.innerHTML = '<div class="pl-tw"><table class="pl-tbl"><thead><tr><th scope="col">Level</th><th scope="col">Price</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="pl-hint">' + esc(j.symbol) + (j.day ? ' · ' + esc(j.day) : '') + ' · ' + esc(ago(j.updated)) + (j.notes && j.notes.length ? ' · ' + esc(j.notes.join(' ')) : '') + '</p>';
  }
  var loadSeq = 0;
  function loadPrev() {
    var n = ++loadSeq;
    return api(packUrl('json')).then(function (r) {
      if (n !== loadSeq) return;
      if (r.status === 403) { wall(signedIn() ? 'pro' : 'signin'); return; }
      if (r.status === 429) { $('pl-prev').innerHTML = '<p class="pl-hint">Too many requests. Try again in a minute.</p>'; return; }
      if (r.status === 404 || r.status === 503) { $('pl-prev').innerHTML = '<p class="pl-hint">No levels are available for this symbol right now.</p>'; st.pack = null; return; }
      if (!r.ok) { $('pl-prev').innerHTML = '<p class="pl-hint">Could not load levels. Try again later.</p>'; return; }
      return r.json().then(function (j) { st.pack = j; renderPrev(j); });
    }).catch(function () { $('pl-prev').innerHTML = '<p class="pl-hint">Could not reach the server. Check your connection.</p>'; });
  }

  // ---- symbol + include ----
  function drawSyms() {
    $('pl-syms').innerHTML = SYMS.map(function (s) { return '<button type="button" data-u="' + s + '" aria-pressed="' + (s === st.u) + '">' + s + '</button>'; }).join('');
  }
  $('pl-syms').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-u]'); if (!b) return;
    st.u = b.dataset.u; drawSyms(); loadPrev(); showUrl();
  });
  document.querySelector('.pl-checks').addEventListener('change', function () {
    var inc = [].map.call(document.querySelectorAll('.pl-checks input:checked'), function (c) { return c.dataset.inc; });
    if (!inc.length) { this.querySelector('input').checked = true; inc = ['gex']; }
    st.inc = inc; loadPrev(); showUrl();
  });

  // ---- downloads / copies ----
  function toast(msg, bad) {
    var m = $('pl-flash'); if (!m) { m = document.createElement('div'); m.id = 'pl-flash'; m.setAttribute('role', 'status'); m.setAttribute('aria-live', 'polite'); document.body.appendChild(m); }
    m.textContent = msg; m.className = 'pl-flash is-on' + (bad ? ' is-bad' : '');
    clearTimeout(toast.t); toast.t = setTimeout(function () { m.className = 'pl-flash'; }, 2600);
  }
  function fetchText(fmt) {
    return api(packUrl(fmt)).then(function (r) {
      if (r.status === 403) { wall(signedIn() ? 'pro' : 'signin'); return null; }
      if (r.status === 429) { toast('Too many requests. Try again in a minute.', true); return null; }
      if (!r.ok) { toast('No levels are available right now.', true); return null; }
      return r.text();
    }).catch(function () { toast('Could not reach the server.', true); return null; });
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallbackCopy(t); });
    return Promise.resolve(fallbackCopy(t));
  }
  function fallbackCopy(t) {
    try { var a = document.createElement('textarea'); a.value = t; a.setAttribute('readonly', ''); a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select(); var ok = document.execCommand('copy'); a.remove(); return ok; } catch (e) { return false; }
  }
  function save(name, text, type) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function act(a) {
    var kind = a[0];
    if (kind === 'get') { var l = document.createElement('a'); l.href = SCRIPT + a[2]; l.download = a[2]; document.body.appendChild(l); l.click(); l.remove(); toast('Downloaded ' + a[2] + '.'); return; }
    if (kind === 'link') {
      if (!st.secret) { toast('Make your link first (above).', true); $('pl-make').focus(); return; }
      copyText(linkUrl(a[2])).then(function (ok) { toast(ok ? 'Link copied.' : 'Could not copy. Select the link above and copy it.', !ok); }); return;
    }
    fetchText(a[2]).then(function (t) {
      if (t === null) return;
      if (kind === 'copy') copyText(t).then(function (ok) { toast(ok ? 'Copied.' : 'Could not copy on this device. Use the download instead.', !ok); });
      else { var nm = a[3].replace(/\.(csv|json|ts)$/, '-' + st.u + '.$1'); save(nm, t, a[2] === 'json' ? 'application/json' : 'text/plain'); toast('Downloaded ' + nm + '.'); }
    });
  }

  // ---- platforms list ----
  function drawList() {
    $('pl-list').innerHTML = PLATFORMS.map(function (p) {
      return '<details class="pl-row-d" data-p="' + p.id + '"><summary><span class="pl-ic">' + ICON.get + '</span><span class="pl-tx"><b>' + esc(p.name) + '</b><small>' + esc(p.sub) + '</small></span>' + CHEV + '</summary>' +
        '<div class="pl-body"><ol class="pl-steps">' + p.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
        '<div class="pl-row">' + p.actions.map(function (a, i) { return '<button type="button" class="pl-btn' + (i === 0 ? ' pl-primary' : '') + '" data-p="' + p.id + '" data-a="' + i + '">' + esc(a[1]) + '</button>'; }).join('') + '</div></div></details>';
    }).join('');
  }
  $('pl-list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-a]'); if (!b) return;
    var p = PLATFORMS.filter(function (x) { return x.id === b.dataset.p; })[0];
    act(p.actions[+b.dataset.a]);
  });

  // ---- private link ----
  function msg(t, bad) { var m = $('pl-link-msg'); m.textContent = t || ''; m.classList.toggle('is-bad', !!bad); }
  function showUrl() {
    var on = st.active, has = !!st.secret;
    $('pl-link').hidden = !(on && has);
    $('pl-off').hidden = !on;
    $('pl-make').textContent = on ? 'Make a new link' : 'Make my link';
    if (on && has) $('pl-url').value = linkUrl('csv');
    if (on && !has) msg('Your link is on, but this device does not have a copy of it. Make a new link to copy it here (the old one stops working).');
  }
  function when(ms) { try { return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  function loadLink() {
    try { st.secret = localStorage.getItem(KEY) || null; } catch (e) { st.secret = null; }
    return api('/api/lv/token').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      st.active = !!(j && j.active);
      if (!st.active) { st.secret = null; try { localStorage.removeItem(KEY); } catch (e) {} }
      showUrl();
      if (st.active) msg('Link works until ' + when(j.exp) + ' while your Pro plan stays active.' + (j.last ? ' Last used ' + ago(new Date(j.last).toISOString()).replace('Updated ', '').toLowerCase() + '.' : ''));
    }).catch(function () {});
  }
  $('pl-make').addEventListener('click', function () {
    if (st.active && !confirm('Make a new link? The old link stops working at once, so update your platform with the new one.')) return;
    var b = this; b.disabled = true; msg('Making your link…');
    api('/api/lv/token', { method: 'POST' }).then(function (r) {
      if (r.status === 403) { wall(signedIn() ? 'pro' : 'signin'); return null; }
      if (r.status === 429) { msg('Too many requests. Try again in a minute.', true); return null; }
      if (!r.ok) { msg('Could not make a link. Try again later.', true); return null; }
      return r.json();
    }).then(function (j) {
      if (!j) return;
      st.secret = j.secret; st.active = true;
      try { localStorage.setItem(KEY, j.secret); } catch (e) {}
      showUrl(); msg('Link ready. Copy it into your platform. It works until ' + when(j.exp) + ' while your Pro plan stays active.');
    }).catch(function () { msg('Could not reach the server.', true); }).then(function () { b.disabled = false; });
  });
  $('pl-off').addEventListener('click', function () {
    var b = this; b.disabled = true;
    api('/api/lv/token', { method: 'DELETE' }).then(function (r) {
      if (!r.ok) { msg('Could not turn the link off. Try again.', true); return; }
      st.active = false; st.secret = null; try { localStorage.removeItem(KEY); } catch (e) {}
      showUrl(); msg('Link turned off. It no longer returns anything.');
    }).catch(function () { msg('Could not reach the server.', true); }).then(function () { b.disabled = false; });
  });
  $('pl-copy-url').addEventListener('click', function () { copyText($('pl-url').value).then(function (ok) { toast(ok ? 'Link copied.' : 'Could not copy. Select the link and copy it.', !ok); }); });
  $('pl-url').addEventListener('focus', function () { this.select(); });

  drawSyms(); drawList();
  loadPrev().then(function () { if (!$('pl-wall').hidden) return; return loadLink(); });
})();
