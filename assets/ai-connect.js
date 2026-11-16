// TradeZoro — "Connect your AI to ZoroCharts" pages (Owner order 15 Nov 2026, roadmap ai-chart-agent).
// One script for three pages, picked by <body data-ai-page>:
//   setup    /ai             how to connect each AI app (tap-to-copy), no sign-in needed
//   consent  /ai/consent     the OAuth consent screen an AI app sends the member to (sign-in required)
//   agents   /charts/agents  the member's AI connections + personal tokens (create, name, access, last used, revoke)
// Talks only to /api/ai/* on this site (workers/ai-agent via functions/_ai-proxy.js) with the member's Firebase ID token in
// the Authorization header. A personal token is shown ONCE, right after it is made, and is never stored by this page.
// Depends on: firebase auth (assets/auth.js), window.showToast (assets/toast.js). Styles: assets/style.css (.aic-*).
(function () {
  'use strict';
  var ORIGIN = location.hostname === 'tradezoro.com' || !/^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? 'https://tradezoro.com' : location.origin;
  var MCP = ORIGIN + '/mcp';
  var page = document.body.getAttribute('data-ai-page');
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var toast = function (m, t) { try { window.showToast && window.showToast(t || 'info', m); } catch (e) {} };
  var SCOPE_TEXT = { 'mcp:read': 'Read charts', 'mcp:chart': 'Control charts', 'mcp:alerts': 'Alerts and watchlists' };
  var COPY_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

  function copyText(text, btn) {
    var done = function () {
      if (btn) { var l = btn.querySelector('.aic-copy-l'); if (l) { l.textContent = 'Copied'; setTimeout(function () { l.textContent = 'Copy'; }, 1600); } }
      toast('Copied', 'success');
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Select the text and copy it.', 'error'); } ta.remove();
    }
  }
  function copyRow(text, label) {
    return '<div class="aic-copy"><code class="aic-code" tabindex="0">' + esc(text) + '</code>' +
      '<button type="button" class="aic-copy-b" data-copy="' + esc(text) + '" aria-label="Copy ' + esc(label || 'text') + '">' + COPY_SVG + '<span class="aic-copy-l">Copy</span></button></div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]'); if (b) copyText(b.getAttribute('data-copy'), b);
  });

  function user() { try { return firebase.auth().currentUser; } catch (e) { return null; } }
  function whenAuth() {
    return new Promise(function (res) {
      try { var off = firebase.auth().onAuthStateChanged(function (u) { off(); res(u); }); } catch (e) { res(null); }
    });
  }
  function api(path, body) {
    var u = user(); if (!u) return Promise.reject(Object.assign(new Error('Please sign in.'), { code: 'signin' }));
    return u.getIdToken().then(function (t) {
      return fetch('/api/ai/' + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(body || {}) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var er = new Error(d.error || 'Something went wrong. Try again.'); er.code = d.code || ''; er.status = r.status; throw er; }
        return d;
      });
    });
  }
  function toLogin() {
    try { sessionStorage.setItem('stryker_return_to', location.pathname + location.search); } catch (e) {}
    location.href = '/login';
  }
  // "sign in again": a fresh sign-in is needed for consent and new tokens (keeps a stolen session from minting access).
  function reLogin() {
    try { sessionStorage.setItem('stryker_return_to', location.pathname + location.search); } catch (e) {}
    try { firebase.auth().signOut().then(function () { location.href = '/login'; }, function () { location.href = '/login'; }); } catch (e) { location.href = '/login'; }
  }
  function markOn() { try { localStorage.setItem('tz_ai_on', '1'); localStorage.removeItem('tz_ai_check'); } catch (e) {} }
  function when(ms) {
    if (!ms) return 'Never';
    var d = Date.now() - ms;
    if (d < 90000) return 'Just now';
    if (d < 3600000) return Math.round(d / 60000) + ' min ago';
    if (d < 86400000) return Math.round(d / 3600000) + ' h ago';
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ---------------------------------------------------------------- setup page
  function renderClients(host, fold) {
    var cursor = JSON.stringify({ mcpServers: { tradezoro: { url: MCP } } }, null, 2);
    var codex = '[mcp_servers.tradezoro]\nurl = "' + MCP + '"\nbearer_token_env_var = "TRADEZORO_TOKEN"';
    var CLIENTS = [
      { id: 'claude', name: 'Claude (web and desktop)', steps: ['Open Settings, then Connectors.', 'Choose Add custom connector, name it TradeZoro and paste this address:'], copy: MCP, label: 'connector address', after: 'Press Connect, sign in to TradeZoro and choose the access you want.' },
      { id: 'chatgpt', name: 'ChatGPT', steps: ['Open Settings, then Apps and Connectors. Turn on Developer mode under Advanced if your plan asks for it.', 'Create a connector named TradeZoro with this address and OAuth sign-in:'], copy: MCP, label: 'connector address', after: 'Sign in to TradeZoro when ChatGPT asks, then choose the access you want.' },
      { id: 'claude-code', name: 'Claude Code', steps: ['Run this once in your terminal:'], copy: 'claude mcp add --transport http tradezoro ' + MCP, label: 'command', after: 'Then type /mcp in Claude Code and pick tradezoro to sign in.' },
      { id: 'cursor', name: 'Cursor', steps: ['Open Settings, then MCP, then Add new MCP server, and paste this into mcp.json:'], copy: cursor, label: 'Cursor config', after: 'Cursor opens TradeZoro to sign in. If it can\u2019t, make a personal token on the AI agents page and add "headers": {"Authorization": "Bearer <your token>"}.' },
      { id: 'codex', name: 'Codex', steps: ['Make a personal token on the AI agents page, set it as TRADEZORO_TOKEN in your shell, then add this to ~/.codex/config.toml:'], copy: codex, label: 'Codex config', after: 'Restart Codex. It reads the token from your shell; the token never goes into the file.' }
    ];
    host.innerHTML = CLIENTS.map(function (c) {
      var inner = '<ol class="aic-steps">' + c.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
        copyRow(c.copy, c.label) + '<p class="aic-note">' + esc(c.after) + '</p>';
      if (fold) return '<details class="aic-fold" id="aic-' + c.id + '"><summary>' + esc(c.name) + '</summary>' + inner + '</details>';
      return '<section class="aic-card" id="aic-' + c.id + '" aria-labelledby="aic-h-' + c.id + '"><h2 class="aic-h2" id="aic-h-' + c.id + '">' + esc(c.name) + '</h2>' + inner + '</section>';
    }).join('');
  }
  function setup() {
    var host = $('#aic-clients'); if (!host) return;
    renderClients(host);
    var url = $('#aic-url'); if (url) url.innerHTML = copyRow(MCP, 'connector address');
    var tryIt = $('#aic-try'); if (tryIt) tryIt.innerHTML = copyRow('Using TradeZoro, switch my chart to NQ on the 5 minute timeframe and add EMA 20.', 'example request');
  }

  // ---------------------------------------------------------------- consent page
  function consent() {
    var box = $('#aic-consent'); if (!box) return;
    var q = new URLSearchParams(location.search), rid = q.get('r') || '', err = q.get('e');
    var show = function (html) { box.innerHTML = html; };
    if (err || !rid) {
      show('<h1 class="aic-h1">Can\u2019t connect</h1><p class="aic-lead">' + esc(err || 'This page opens from your AI app when you connect TradeZoro.') + '</p><div class="aic-actions"><a class="btn btn-ghost aic-btn" href="/ai">How to connect</a></div>');
      return;
    }
    whenAuth().then(function (u) {
      if (!u) { toLogin(); return; }
      return api('request', { r: rid }).then(function (d) { render(d, u); });
    }).catch(function (e) {
      show('<h1 class="aic-h1">Can\u2019t connect</h1><p class="aic-lead">' + esc(e.message) + '</p><div class="aic-actions"><a class="btn btn-ghost aic-btn" href="/ai">How to connect</a></div>');
    });
    function render(d, u) {
      var want = d.scope || ['mcp:read'];
      var control = want.indexOf('mcp:chart') >= 0 && d.verified, alerts = want.indexOf('mcp:alerts') >= 0 && d.verified;
      var warn = d.verified ? '' : '<div class="aic-warn" role="note"><b>Unverified app.</b> TradeZoro can\u2019t confirm who made this app. Only continue if you started this from an AI app you trust. It will send you back to <b>' + esc(d.redirect) + '</b>.</div>';
      show('<p class="aic-eyebrow">Connect your AI to ZoroCharts</p>' +
        '<h1 class="aic-h1">' + esc(d.client) + ' wants to use your charts</h1>' +
        '<p class="aic-lead">Signed in as <b>' + esc(u.email || 'you') + '</b>. ' + (d.verified ? 'You\u2019ll go back to <b>' + esc(d.redirect) + '</b> afterwards.' : '') + '</p>' + warn +
        '<fieldset class="aic-choices"><legend class="aic-legend">Access</legend>' +
        choice('radio', 'aic-acc', 'read', !control, 'Read only', 'See your open chart: symbol, timeframe, indicators, candles, drawings, a picture of the chart.') +
        choice('radio', 'aic-acc', 'chart', control, 'Read and control charts', 'Also change the symbol, timeframe and layout, add or change indicators and drawings. Each change shows on your chart.') +
        choice('checkbox', 'aic-alerts', 'alerts', alerts, 'Alerts and watchlists', 'Create, list and delete your price alerts, and edit your watchlist.') +
        '</fieldset>' +
        '<p class="aic-note">No trading: an AI app can never place orders through TradeZoro. You can pause or disconnect it on the chart, and remove it any time on <a href="/charts/agents">AI agents</a>. Education only. Not financial advice.</p>' +
        '<div class="aic-actions"><button type="button" class="btn btn-ghost aic-btn" id="aic-deny">Cancel</button><button type="button" class="btn btn-primary aic-btn" id="aic-allow">Allow</button></div>' +
        '<p class="aic-err" id="aic-err" role="alert" hidden></p>');
      if (!d.recent) needRecent();
      $('#aic-deny').addEventListener('click', function () { api('deny', { r: rid }).then(function (x) { location.href = x.redirect; }, function () { location.href = '/ai'; }); });
      $('#aic-allow').addEventListener('click', function () {
        var b = this; b.disabled = true;
        var scope = ['mcp:read'];
        var acc = document.querySelector('input[name=aic-acc]:checked');
        if (acc && acc.value === 'chart') scope.push('mcp:chart');
        if ($('input[name=aic-alerts]').checked) scope.push('mcp:alerts');
        api('approve', { r: rid, scope: scope }).then(function (x) {
          markOn();
          show('<h1 class="aic-h1">Connected</h1><p class="aic-lead">Going back to ' + esc(d.client) + '\u2026 Keep a ZoroCharts tab open so it can work on your chart.</p>');
          location.href = x.redirect;
        }, function (e) {
          b.disabled = false;
          if (e.code === 'recent-login') return needRecent();
          var el = $('#aic-err'); el.hidden = false; el.textContent = e.message;
        });
      });
    }
    function needRecent() {
      var el = $('#aic-err'); el.hidden = false;
      el.innerHTML = 'For your safety, please sign in again before you allow access. <button type="button" class="aic-link" id="aic-relogin">Sign in again</button>';
      $('#aic-relogin').addEventListener('click', reLogin);
    }
  }
  function choice(type, name, value, on, title, desc) {
    var id = name + '-' + value;
    return '<label class="aic-choice" for="' + id + '"><input type="' + type + '" id="' + id + '" name="' + name + '" value="' + value + '"' + (on ? ' checked' : '') + '>' +
      '<span class="aic-choice-t"><b>' + esc(title) + '</b><span>' + esc(desc) + '</span></span></label>';
  }

  // ---------------------------------------------------------------- agents page
  var AGENTS_HTML = '<section class="aic-card" aria-labelledby="aic-h-list"><h2 class="aic-h2" id="aic-h-list">Connected</h2><p class="aic-note" id="aic-tabs"></p><ul class="aic-rows" id="aic-list"><li class="aic-empty">Loading\u2026</li></ul></section>' +
    '<section class="aic-card" aria-labelledby="aic-h-new"><h2 class="aic-h2" id="aic-h-new">Personal token</h2>' +
    '<p class="aic-note">For AI apps that take a token instead of a sign-in (for example Codex, or Cursor without sign-in). Send it as <code>Authorization: Bearer &lt;token&gt;</code> to <code>' + MCP + '</code>.</p>' +
    '<form id="aic-new" class="aic-form" autocomplete="off">' +
    '<label class="aic-field"><span>Name</span><input id="aic-tname" maxlength="40" required placeholder="e.g. Codex on my laptop"></label>' +
    '<fieldset class="aic-choices"><legend class="aic-legend">Access</legend>' +
    choice('radio', 'aic-tacc', 'read', true, 'Read only', 'See your open chart.') +
    choice('radio', 'aic-tacc', 'chart', false, 'Read and control charts', 'Also change symbol, timeframe, layout, indicators and drawings.') +
    choice('checkbox', 'aic-talerts', 'alerts', false, 'Alerts and watchlists', 'Create, list and delete alerts; edit your watchlist.') +
    '</fieldset><label class="aic-field"><span>Expires after</span><select id="aic-tdays"><option value="30">30 days</option><option value="90" selected>90 days</option></select></label>' +
    '<div class="aic-actions"><button type="submit" class="btn btn-primary aic-btn">Create token</button></div></form><div id="aic-token" hidden></div></section>';
  function agents() {
    var host = $('#aic-agents'); if (!host) return;
    host.innerHTML = AGENTS_HTML;
    whenAuth().then(function (u) { if (!u) { toLogin(); return; } mountAgents(host); });
  }
  // The connections list + personal-token form, used by the /charts/agents page and by the chart popup.
  // opts.onChange(): called after a token is made or an app removed. Returns { load }.
  function mountAgents(root, opts) {
    opts = opts || {};
    var list = $('#aic-list', root), form = $('#aic-new', root);
    function $r(s) { return $(s, root); }
    load();
    function load() {
      api('grants', {}).then(function (d) {
        var g = d.grants || [];
        var tabs = $r('#aic-tabs');
        if (tabs) tabs.textContent = d.tabs ? (d.tabs === 1 ? '1 chart tab is ready for your AI.' : d.tabs + ' chart tabs are ready for your AI.') : 'No chart tab is connected right now. Open Charts to let your AI work on it.';
        if (!g.length) { list.innerHTML = '<p class="aic-empty">No AI apps connected yet. Connect one from the <a href="/ai">setup page</a>, or make a personal token below.</p>'; return; }
        list.innerHTML = g.map(function (x) {
          var scope = (x.scope || []).map(function (s) { return SCOPE_TEXT[s] || s; }).join(' \u00b7 ');
          var exp = x.expired ? 'Expired' : x.expires ? 'Ends ' + new Date(x.expires).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
          return '<li class="aic-row"><div class="aic-row-t"><b>' + esc(x.name) + '</b><span class="aic-tag">' + (x.kind === 'personal' ? 'Personal token' : x.verified ? 'Connected app' : 'Unverified app') + '</span></div>' +
            '<div class="aic-row-m">' + esc(scope) + '</div><div class="aic-row-m">Last used ' + esc(when(x.lastUsed)) + (exp ? ' \u00b7 ' + esc(exp) : '') + '</div>' +
            '<button type="button" class="btn btn-ghost aic-btn aic-btn-sm" data-revoke="' + esc(x.id) + '" data-name="' + esc(x.name) + '">Remove</button></li>';
        }).join('');
      }, function (e) { list.innerHTML = '<p class="aic-empty">' + esc(e.message) + '</p>'; });
    }
    list.addEventListener('click', function (e) {
      var b = e.target.closest('[data-revoke]'); if (!b) return;
      if (!confirm('Remove ' + b.getAttribute('data-name') + '? It stops working at once.')) return;
      b.disabled = true;
      api('grant/delete', { id: b.getAttribute('data-revoke') }).then(function () { toast('Removed. It can\u2019t use your charts any more.', 'success'); load(); if (opts.onChange) opts.onChange(); }, function (er) { b.disabled = false; toast(er.message, 'error'); });
    });
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      var scope = ['mcp:read'];
      var acc = form.querySelector('input[name=aic-tacc]:checked');
      if (acc && acc.value === 'chart') scope.push('mcp:chart');
      if (form.querySelector('input[name=aic-talerts]').checked) scope.push('mcp:alerts');
      api('personal', { name: $r('#aic-tname').value, scope: scope, days: Number(form.querySelector('select').value) }).then(function (d) {
        btn.disabled = false; markOn(); form.reset(); if (opts.onChange) opts.onChange();
        var out = $r('#aic-token');
        out.hidden = false;
        out.innerHTML = '<p class="aic-note"><b>Copy your token now.</b> It is shown only once. Treat it like a password: anyone with it can use your charts with the access you chose.</p>' + copyRow(d.token, 'personal token');
        load();
      }, function (er) {
        btn.disabled = false;
        if (er.code === 'recent-login') { var o = $r('#aic-token'); o.hidden = false; o.innerHTML = '<p class="aic-note">For your safety, sign in again before you make a token. <button type="button" class="aic-link" id="aic-relogin">Sign in again</button></p>'; $r('#aic-relogin').addEventListener('click', reLogin); return; }
        toast(er.message, 'error');
      });
    });
    return { load: load };
  }

  // for the chart popup (assets/chart-ai-popup.js), which loads this file on demand
  window.STRYKER_AIC = { MCP: MCP, renderClients: renderClients, mountAgents: mountAgents, AGENTS_HTML: AGENTS_HTML, whenAuth: whenAuth, user: user };

  function start() { if (page === 'setup') setup(); else if (page === 'consent') consent(); else if (page === 'agents') agents(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
