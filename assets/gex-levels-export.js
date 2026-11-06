// GEX+ "Download levels" (ZoroOptions S3). Pro: pick symbol, date range (90 days max), step, format; downloads
// /api/zo/levels-export (stream 2: CSV/JSON of past Call Ceiling / Put Floor / Flip Line / Zoro Range snapshots).
// Not Pro -> the plan modal. ?fixture=1 reads tools/tests/fixtures/zoro/levels-export.csv (local tests only).
// Education only. Not financial advice.
(function () {
  'use strict';
  var btn = document.getElementById('gex-dl-btn'), dlg = document.getElementById('gex-dl');
  if (!btn || !dlg) return;
  // ships with ZoroOptions: hidden until the launch flag (app-nav.js strykerZoLive) is on
  if (!(window.strykerZoLive && window.strykerZoLive())) { btn.hidden = true; return; }
  var FIXTURE = new URLSearchParams(location.search).has('fixture');
  var $ = function (id) { return document.getElementById(id); };
  var form = $('gex-dl-form'), msg = $('gex-dl-msg'), go = $('gex-dl-go');
  function etDay(offset) {
    var d = new Date(Date.now() + (offset || 0) * 864e5);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  function say(t, bad) { msg.textContent = t; msg.classList.toggle('is-bad', !!bad); }
  btn.addEventListener('click', function () {
    var to = $('gex-dl-to'), from = $('gex-dl-from');
    to.max = from.max = etDay(0); to.min = from.min = etDay(-89);
    if (!to.value) to.value = etDay(0);
    if (!from.value) from.value = etDay(-6);
    var tab = document.querySelector('#gex-tabs .gex-tab.is-on');
    var cur = tab && tab.dataset.m;
    if (cur && [].some.call($('gex-dl-u').options, function (o) { return o.value === cur; })) $('gex-dl-u').value = cur;
    say('');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  });
  $('gex-dl-x').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = $('gex-dl-from').value, t = $('gex-dl-to').value;
    if (!f || !t) return say('Pick both dates.', true);
    if (f > t) return say('The start date is after the end date.', true);
    if ((Date.parse(t) - Date.parse(f)) / 864e5 + 1 > 90) return say('Pick 90 days or fewer.', true);
    var q = new URLSearchParams({ u: $('gex-dl-u').value, from: f, to: t, step: $('gex-dl-step').value, format: $('gex-dl-fmt').value });
    var url = FIXTURE ? '/tools/tests/fixtures/zoro/levels-export.csv' : '/api/zo/levels-export?' + q;
    go.disabled = true; say('Preparing the file…');
    var hp = window.strykerGexHeaders && !FIXTURE ? window.strykerGexHeaders() : Promise.resolve({});
    hp.then(function (h) { return fetch(url, { headers: h, cache: 'no-store' }); }).then(function (r) {
      if (r.status === 401 || r.status === 403) {
        dlg.close();
        if (window.openPlanUpgradeModal) window.openPlanUpgradeModal('Downloading GEX levels is part of Pro.'); else location.href = 'pricing.html';
        return null;
      }
      if (r.status === 429) { say('Too many downloads. Try again in a minute.', true); return null; }
      if (r.status === 404) { say('No stored levels for that range.', true); return null; }
      if (!r.ok) return r.text().then(function (b) { var m = ''; try { m = JSON.parse(b).error; } catch (x) {} say(m ? 'Could not build the file: ' + m + '.' : 'Could not build the file. Try again later.', true); return null; });
      var cd = r.headers.get('content-disposition') || '', m = /filename="?([^";]+)"?/.exec(cd);
      var name = m ? m[1] : 'zoro-levels-' + q.get('u') + '-' + f + '_' + t + '-' + q.get('step') + '.' + q.get('format');
      return r.blob().then(function (b) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        say('Downloaded ' + name + '.');
        window.__gexDlLast = { name: name, size: b.size, query: q.toString() };
      });
    }).catch(function () { say('Could not reach the server. Check your connection.', true); })
      .then(function () { go.disabled = false; });
  });
})();
