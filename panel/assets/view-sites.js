/* Master Panel — Sites & health.
 * The registry of every property, joined against the health feed produced by
 * the panel-health workflow: status, latency, uptime, TLS expiry and the audit
 * scorecard. A site the workflow does not know about is labelled as such
 * rather than rendered as if it were passing.
 */
(function () {
  'use strict';

  var SITE_FIELDS = [
    { key: 'name', label: 'Name', required: true, placeholder: 'Stryker Trading Academy' },
    { key: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://example.com' },
    { key: 'group', label: 'Group', placeholder: 'Stryker, client work, internal' },
    { key: 'critical', label: 'Business critical', type: 'checkbox', value: true,
      help: 'Critical sites raise a red alert when a check fails, not a warning.' },
    { key: 'platform', label: 'Hosting / platform', placeholder: 'Cloudflare Pages, Vercel, VPS' },
    { key: 'registrar', label: 'Domain registrar', placeholder: 'Cloudflare, GoDaddy' },
    { key: 'repo', label: 'Repository', type: 'url' },
    { key: 'stack', label: 'Stack', placeholder: 'Static + Firebase, WordPress, Next.js' },
    { key: 'launchedAt', label: 'Launched', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' }
  ];

  function editSite(row) {
    PANEL.formModal({
      title: row ? 'Edit site' : 'Add site',
      fields: SITE_FIELDS,
      values: row || { critical: true },
      onSave: function (v) {
        return PANEL.save('sites', row && row.id, v).then(function () {
          PANEL.toast('ok', 'Site saved.');
          PANEL.render();
        });
      },
      onDelete: row ? function () {
        return PANEL.remove('sites', row.id).then(function () {
          PANEL.toast('ok', 'Site removed.');
          PANEL.render();
        });
      } : null
    });
  }

  function scoreTone(n) { return n >= 85 ? 'ok' : n >= 60 ? 'warn' : 'bad'; }

  function sparkline(rows) {
    if (!rows || !rows.length) return '';
    var slice = rows.slice(-40);
    var max = Math.max.apply(null, slice.map(function (r) { return r.ms || 0; }).concat([1]));
    return '<div class="spark">' + slice.map(function (r) {
      var h = r.ok ? Math.max(3, Math.round((r.ms || 0) / max * 20)) : 20;
      return '<i class="' + (r.ok ? '' : 'down') + '" style="height:' + h + 'px" title="' +
        PANEL.esc(new Date(r.t).toLocaleString() + ' — ' + (r.ok ? (r.ms + ' ms') : 'down')) + '"></i>';
    }).join('') + '</div>';
  }

  function details(site, entry, feed) {
    var checks = (entry && entry.audit && entry.audit.checks) || [];
    var up7 = entry ? PANEL.health.uptime(feed, entry.id, 7) : null;
    var up30 = entry ? PANEL.health.uptime(feed, entry.id, 30) : null;

    PANEL.formModal({
      title: site.name || site.url,
      fields: [],
      saveLabel: 'Close',
      onSave: function () { }
    });
    document.getElementById('modal-body').innerHTML =
      '<div class="stack">' +
      (entry ? '<div class="grid g3">' +
        mini('Status', entry.ok ? 'Healthy' : 'Failing', entry.ok ? 'ok' : 'bad') +
        mini('Response', entry.ms != null ? entry.ms + ' ms' : '—') +
        mini('Audit score', (entry.audit ? entry.audit.score : '—') + ' / 100',
          entry.audit ? scoreTone(entry.audit.score) : '') +
        mini('Uptime 7d', up7 ? up7.pct.toFixed(2) + '%' : '—') +
        mini('Uptime 30d', up30 ? up30.pct.toFixed(2) + '%' : '—') +
        mini('TLS expires', entry.tls && entry.tls.daysLeft != null ? entry.tls.daysLeft + ' days' : '—',
          entry.tls && entry.tls.daysLeft != null && entry.tls.daysLeft < 21 ? 'bad' : '') +
      '</div>' : '<p class="t-sub">No health data for this site yet.</p>') +

      (checks.length ? '<div><h3 style="font-size:13px;margin-bottom:8px">Audit</h3><div class="checks">' +
        checks.map(function (c) {
          return '<div class="check"><span class="check-dot ' +
            (c.status === 'pass' ? '' : c.status === 'warn' ? 'warn' : c.status === 'skip' ? 'skip' : 'bad') +
            '"></span><div><b>' + PANEL.esc(c.label) + '</b><br><span>' + PANEL.esc(c.detail || '') + '</span></div></div>';
        }).join('') + '</div></div>' : '') +

      (entry && entry.headers ? '<div><h3 style="font-size:13px;margin:6px 0 8px">Response headers</h3>' +
        '<div class="table-wrap"><table><tbody>' + Object.keys(entry.headers).map(function (k) {
          return '<tr><td class="t-sub mono" style="width:38%">' + PANEL.esc(k) + '</td>' +
            '<td class="mono" style="font-size:11.5px;word-break:break-all">' + PANEL.esc(entry.headers[k]) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' : '') +

      (entry && entry.paths && entry.paths.length ? '<div><h3 style="font-size:13px;margin:6px 0 8px">Extra paths</h3>' +
        '<div class="table-wrap"><table><tbody>' + entry.paths.map(function (p) {
          return '<tr><td class="mono t-sub">' + PANEL.esc(p.path) + '</td>' +
            '<td><span class="tag ' + (p.ok ? 'ok' : 'bad') + '">' + PANEL.esc(p.status || p.error || '—') + '</span></td>' +
            '<td class="num t-sub">' + (p.ms != null ? p.ms + ' ms' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' : '') +
      '</div>';
    var foot = document.getElementById('modal-foot');
    foot.innerHTML = '<span class="row-end"></span><button class="btn" id="m-close-detail">Close</button>';
    document.getElementById('m-close-detail').onclick = PANEL.closeModal;
  }

  function mini(label, val, tone) {
    return '<div class="stat ' + (tone || '') + '" style="padding:10px 12px">' +
      '<div class="stat-label">' + PANEL.esc(label) + '</div>' +
      '<div class="stat-val" style="font-size:16px">' + PANEL.esc(val) + '</div></div>';
  }

  PANEL.view('sites', {
    title: 'Sites & health',
    render: function (host) {
      return Promise.all([PANEL.loadAll(), PANEL.health.fetch()]).then(function (r) {
        var feed = r[1];
        var sites = PANEL.get('sites').slice().sort(function (a, b) {
          return (a.name || '').localeCompare(b.name || '');
        });

        // Sites the workflow probes but the registry has never seen. Offer to
        // import them rather than pretending the two lists are the same thing.
        var unknown = (feed && feed.sites || []).filter(function (e) {
          return !sites.some(function (s) { return PANEL.health.normalise(s.url) === PANEL.health.normalise(e.url); });
        });

        host.innerHTML =
          '<div class="stack">' +

          (feed ? '' :
            '<div class="card" style="border-color:rgba(245,197,66,.35)">' +
            '<div class="card-head"><h2>Server-side checks are not running yet</h2></div>' +
            '<p class="t-sub" style="margin:0 0 10px">A browser cannot read another origin\'s status code, headers or TLS certificate, ' +
            'so status, uptime, security headers and certificate expiry all come from the <code>panel-health</code> GitHub workflow. ' +
            'Add your sites to <code>panel/sites.json</code> and run the workflow once; the panel picks the feed up automatically.</p>' +
            '<p class="t-sub" style="margin:0">Until then, use <b>Ping</b> below — it can tell you reachable or not reachable, and nothing more.</p>' +
            '</div>') +

          (feed ? '<div class="grid g4">' + summary(feed, sites) + '</div>' : '') +

          '<div class="card">' +
            '<div class="card-head"><h2>Sites</h2>' +
              '<span class="row-end"></span>' +
              (feed ? '<span class="t-sub">Checked ' + PANEL.esc(PANEL.fmtWhen(feed.generatedAt)) + '</span>' : '') +
              '<button class="btn btn-sm btn-primary" id="site-add">Add site</button></div>' +
            (sites.length ? table(sites, feed) : '<p class="empty">No sites yet. Add the first property you want to watch.</p>') +
          '</div>' +

          (unknown.length ? '<div class="card"><div class="card-head"><h2>Monitored but not in the registry</h2></div>' +
            '<p class="t-sub" style="margin:0 0 10px">The health workflow is checking these, but the panel has no record for them.</p>' +
            unknown.map(function (e) {
              return '<div class="row" style="padding:7px 0;border-bottom:1px solid var(--line-soft)">' +
                '<span class="t-main">' + PANEL.esc(e.name || e.url) + '</span>' +
                '<span class="t-sub">' + PANEL.esc(e.url) + '</span>' +
                '<span class="row-end"></span>' +
                '<button class="btn btn-sm" data-import="' + PANEL.esc(e.url) + '" data-name="' + PANEL.esc(e.name || '') + '">Add to registry</button></div>';
            }).join('') + '</div>' : '') +

          '</div>';

        host.querySelector('#site-add').onclick = function () { editSite(null); };

        host.querySelectorAll('[data-edit-site]').forEach(function (b) {
          b.onclick = function () {
            editSite(sites.filter(function (s) { return s.id === b.getAttribute('data-edit-site'); })[0]);
          };
        });
        host.querySelectorAll('[data-detail]').forEach(function (b) {
          b.onclick = function () {
            var site = sites.filter(function (s) { return s.id === b.getAttribute('data-detail'); })[0];
            details(site, PANEL.health.bySiteUrl(feed, site.url), feed);
          };
        });
        host.querySelectorAll('[data-ping]').forEach(function (b) {
          b.onclick = function () {
            var url = b.getAttribute('data-ping');
            b.disabled = true; b.textContent = 'Pinging…';
            PANEL.health.ping(url).then(function (res) {
              b.disabled = false; b.textContent = 'Ping';
              PANEL.toast(res.reachable ? 'ok' : 'error',
                res.reachable ? 'Reachable in ' + res.ms + ' ms (opaque response — no status code available).'
                  : 'Not reachable from this browser after ' + res.ms + ' ms.');
            });
          };
        });
        host.querySelectorAll('[data-import]').forEach(function (b) {
          b.onclick = function () {
            PANEL.save('sites', null, {
              name: b.getAttribute('data-name') || b.getAttribute('data-import'),
              url: b.getAttribute('data-import'), critical: true
            }).then(function () { PANEL.toast('ok', 'Added.'); PANEL.render(); });
          };
        });
      });
    }
  });

  function summary(feed, sites) {
    var entries = feed.sites || [];
    var down = entries.filter(function (e) { return !e.ok; }).length;
    var avg = entries.filter(function (e) { return e.ms != null; });
    var avgMs = avg.length ? Math.round(avg.reduce(function (n, e) { return n + e.ms; }, 0) / avg.length) : null;
    var scores = entries.filter(function (e) { return e.audit; });
    var avgScore = scores.length ? Math.round(scores.reduce(function (n, e) { return n + e.audit.score; }, 0) / scores.length) : null;
    var soonest = entries.filter(function (e) { return e.tls && e.tls.daysLeft != null; })
      .sort(function (a, b) { return a.tls.daysLeft - b.tls.daysLeft; })[0];

    var unmonitored = sites.filter(function (x) {
      return !entries.some(function (e) { return PANEL.health.normalise(e.url) === PANEL.health.normalise(x.url); });
    }).length;

    return st('Sites tracked', String(sites.length),
      entries.length + ' probed server-side' + (unmonitored ? ', ' + unmonitored + ' not monitored' : '')) +
      st('Down right now', String(down),
        down ? 'Needs attention' : (unmonitored ? 'Every monitored site is passing' : 'All checks passing'),
        down ? 'bad' : 'good') +
      st('Average response', avgMs != null ? avgMs + ' ms' : '—', 'Across all probes') +
      st('Average audit', avgScore != null ? avgScore + ' / 100' : '—',
        soonest ? 'Nearest TLS expiry ' + soonest.tls.daysLeft + 'd' : '',
        avgScore != null ? (avgScore >= 85 ? 'good' : avgScore >= 60 ? 'warn' : 'bad') : '');
  }
  function st(label, val, foot, tone) {
    return '<div class="stat ' + (tone || '') + '"><div class="stat-label">' + PANEL.esc(label) + '</div>' +
      '<div class="stat-val">' + PANEL.esc(val) + '</div>' +
      '<div class="stat-foot">' + PANEL.esc(foot || '') + '</div></div>';
  }

  function table(sites, feed) {
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>Site</th><th>Status</th><th class="num">Response</th><th>Recent</th>' +
      '<th class="num">Uptime 7d</th><th class="num">Audit</th><th>TLS</th><th></th>' +
      '</tr></thead><tbody>' +
      sites.map(function (s) {
        var e = PANEL.health.bySiteUrl(feed, s.url);
        var up = e ? PANEL.health.uptime(feed, e.id, 7) : null;
        var href = PANEL.safeUrl(s.url);
        return '<tr>' +
          '<td><span class="t-main">' + PANEL.esc(s.name || '—') + '</span>' +
            (s.critical ? ' <span class="tag bad" style="font-size:10px">critical</span>' : '') +
            '<br><span class="t-sub">' + PANEL.esc(s.url) + '</span>' +
            (s.group ? ' <span class="tag" style="font-size:10px">' + PANEL.esc(s.group) + '</span>' : '') + '</td>' +
          '<td>' + (e ? '<span class="tag ' + (e.ok ? 'ok' : 'bad') + '">' + (e.ok ? 'healthy' : 'failing') + '</span>'
            : '<span class="tag">not monitored</span>') + '</td>' +
          '<td class="num">' + (e && e.ms != null ? e.ms + ' ms' : '—') + '</td>' +
          '<td>' + (up ? sparkline(up.rows) : '<span class="t-sub">—</span>') + '</td>' +
          '<td class="num">' + (up ? up.pct.toFixed(1) + '%' : '—') + '</td>' +
          '<td class="num">' + (e && e.audit
            ? '<span class="tag ' + scoreTone(e.audit.score) + '">' + e.audit.score + '</span>' : '—') + '</td>' +
          '<td class="t-sub">' + (e && e.tls && e.tls.daysLeft != null
            ? (e.tls.daysLeft < 21 ? '<span class="tag warn">' + e.tls.daysLeft + 'd</span>' : e.tls.daysLeft + 'd') : '—') + '</td>' +
          '<td style="text-align:right;white-space:nowrap">' +
            (href ? '<a class="btn btn-sm" href="' + PANEL.esc(href) + '" target="_blank" rel="noopener">Open</a> ' : '') +
            '<button class="btn btn-sm" data-ping="' + PANEL.esc(href) + '">Ping</button> ' +
            '<button class="btn btn-sm" data-detail="' + PANEL.esc(s.id) + '">Details</button> ' +
            '<button class="btn btn-sm" data-edit-site="' + PANEL.esc(s.id) + '">Edit</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }
})();
