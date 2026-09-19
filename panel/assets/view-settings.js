/* Master Panel — Settings & backup.
 * Base currency, FX rates, thresholds, where the health feed lives, and a
 * full JSON export/import of everything the panel owns.
 */
(function () {
  'use strict';

  var COLLECTIONS = ['sites', 'subscriptions', 'expenses', 'incidents', 'tasks'];

  PANEL.view('settings', {
    title: 'Settings & backup',
    render: function (host) {
      return PANEL.loadAll().then(function () {
        var c = PANEL.cfg();
        var used = {};
        PANEL.get('subscriptions').concat(PANEL.get('expenses')).forEach(function (r) {
          if (r.currency) used[r.currency] = true;
        });
        var currencies = Object.keys(
          PANEL.money.CURRENCIES.concat(Object.keys(used)).reduce(function (m, k) { m[k] = 1; return m; }, {})
        );

        host.innerHTML =
          '<div class="stack">' +

          '<div class="card">' +
            '<div class="card-head"><h2>Money</h2></div>' +
            '<p class="card-sub">Every total in the panel is shown in the base currency. Rates are yours to maintain — ' +
              'the panel never calls an FX service, so a figure never changes behind your back.</p>' +
            '<div class="grid g3">' +
              field('Base currency', '<select id="s-base">' + currencies.map(function (k) {
                return '<option value="' + PANEL.esc(k) + '"' + (c.baseCurrency === k ? ' selected' : '') + '>' + PANEL.esc(k) + '</option>';
              }).join('') + '</select>') +
              field('Monthly budget (' + PANEL.esc(c.baseCurrency) + ')',
                '<input type="number" step="any" id="s-budget" value="' + PANEL.esc(c.monthlyBudget || 0) + '">') +
              field('Warn before a renewal (days)', '<input type="number" id="s-renew" value="' + PANEL.esc(c.renewalWarnDays) + '">') +
            '</div>' +
            '<h3 style="font-size:13px;margin:14px 0 8px">Rates — 1 unit equals this much ' + PANEL.esc(c.baseCurrency) + '</h3>' +
            '<div class="grid g4">' + currencies.map(function (k) {
              return field(k, '<input type="number" step="any" data-rate="' + PANEL.esc(k) + '" value="' +
                PANEL.esc((c.rates || {})[k] != null ? c.rates[k] : '') + '">');
            }).join('') + '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><h2>Monitoring</h2></div>' +
            '<p class="card-sub">Where the panel reads server-side check results from. The workflow that writes this feed is ' +
              '<code>.github/workflows/panel-health.yml</code>.</p>' +
            '<div class="grid g3">' +
              field('Repository', '<input id="s-repo" value="' + PANEL.esc(c.healthRepo) + '">') +
              field('Branch', '<input id="s-branch" value="' + PANEL.esc(c.healthBranch) + '">') +
              field('Warn before TLS expiry (days)', '<input type="number" id="s-ssl" value="' + PANEL.esc(c.sslWarnDays) + '">') +
            '</div>' +
            '<div class="row" style="margin-top:12px">' +
              '<button class="btn btn-sm" id="s-test">Test the feed</button>' +
              '<span class="t-sub" id="s-test-out"></span></div>' +
          '</div>' +

          '<div class="row"><button class="btn btn-primary" id="s-save">Save settings</button></div>' +

          '<div class="card">' +
            '<div class="card-head"><h2>Backup</h2></div>' +
            '<p class="card-sub">Everything the panel owns — sites, subscriptions, expenses, incidents, tasks and these settings — ' +
              'as one JSON file. Import merges by record id: a record with the same id is overwritten, anything else is added.</p>' +
            '<div class="row">' +
              '<button class="btn" id="s-export">Export JSON</button>' +
              '<label class="btn" style="cursor:pointer">Import JSON<input type="file" id="s-import" accept="application/json" hidden></label>' +
              '<span class="t-sub" id="s-import-out"></span>' +
            '</div>' +
            '<div class="grid g4" style="margin-top:14px">' + COLLECTIONS.map(function (n) {
              return '<div class="stat" style="padding:10px 12px"><div class="stat-label">' + n + '</div>' +
                '<div class="stat-val" style="font-size:16px">' + PANEL.get(n).length + '</div></div>';
            }).join('') + '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><h2>Access</h2></div>' +
            '<p class="card-sub">Signed in as <b>' + PANEL.esc(PANEL.user ? PANEL.user.email : '—') + '</b>. ' +
              'Admin access is granted by the <code>admins</code> collection in Firestore — the same roster the main ' +
              'admin suite uses, managed from Users → Roles &amp; access on the site.</p>' +
          '</div>' +

          '</div>';

        host.querySelector('#s-save').onclick = function () {
          var rates = {};
          host.querySelectorAll('[data-rate]').forEach(function (i) {
            var v = parseFloat(i.value);
            if (!isNaN(v) && v > 0) rates[i.getAttribute('data-rate')] = v;
          });
          PANEL.saveSettings({
            baseCurrency: host.querySelector('#s-base').value,
            monthlyBudget: Number(host.querySelector('#s-budget').value) || 0,
            renewalWarnDays: Number(host.querySelector('#s-renew').value) || 14,
            sslWarnDays: Number(host.querySelector('#s-ssl').value) || 21,
            healthRepo: host.querySelector('#s-repo').value.trim(),
            healthBranch: host.querySelector('#s-branch').value.trim(),
            rates: rates
          }).then(function () {
            PANEL.toast('ok', 'Settings saved.');
            PANEL.render();
          }).catch(function (err) {
            PANEL.toast('error', 'Could not save: ' + (err.code || err.message));
          });
        };

        host.querySelector('#s-test').onclick = function () {
          var out = host.querySelector('#s-test-out');
          out.textContent = 'Checking…';
          PANEL.health.fetch(true).then(function (feed) {
            out.textContent = feed
              ? 'Feed found: ' + (feed.sites || []).length + ' sites, generated ' + PANEL.fmtWhen(feed.generatedAt) + '.'
              : 'No feed at that location yet — run the panel-health workflow once.';
          });
        };

        host.querySelector('#s-export').onclick = function () {
          var dump = { exportedAt: new Date().toISOString(), settings: PANEL.cfg() };
          COLLECTIONS.forEach(function (n) { dump[n] = PANEL.get(n); });
          PANEL.download(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }),
            'master-panel-backup-' + PANEL.today() + '.json');
        };

        host.querySelector('#s-import').onchange = function (ev) {
          var file = ev.target.files[0];
          if (!file) return;
          var out = host.querySelector('#s-import-out');
          file.text().then(function (txt) {
            var dump;
            try { dump = JSON.parse(txt); } catch (e) { out.textContent = 'That file is not valid JSON.'; return; }
            var total = COLLECTIONS.reduce(function (n, k) { return n + ((dump[k] || []).length); }, 0);
            if (!total) { out.textContent = 'Nothing to import.'; return; }
            if (!confirm('Import ' + total + ' records? Records with a matching id will be overwritten.')) return;
            out.textContent = 'Importing…';
            var jobs = [];
            COLLECTIONS.forEach(function (k) {
              (dump[k] || []).forEach(function (row) {
                var id = row.id;
                var data = Object.assign({}, row);
                delete data.id;
                jobs.push(PANEL.save(k, id, data));
              });
            });
            if (dump.settings) jobs.push(PANEL.saveSettings(dump.settings));
            Promise.all(jobs).then(function () {
              out.textContent = 'Imported ' + total + ' records.';
              PANEL.toast('ok', 'Import complete.');
              PANEL.loadAll(true).then(PANEL.render);
            }).catch(function (err) {
              out.textContent = 'Import failed: ' + (err.code || err.message);
            });
          });
        };
      });
    }
  });

  function field(label, input) {
    return '<label class="field"><span>' + PANEL.esc(label) + '</span>' + input + '</label>';
  }
})();
