/* Master Panel — Alerts, incidents and tasks.
 * Alerts are derived and never stored: fix the cause and the alert disappears.
 * Incidents and tasks are written by you, because an outage's story and a
 * follow-up are facts no probe can infer.
 */
(function () {
  'use strict';

  function siteOptions() {
    return [{ value: '', label: '— none —' }].concat(PANEL.get('sites').map(function (s) {
      return { value: s.id, label: s.name || s.url };
    }));
  }
  function siteName(id) {
    var s = PANEL.get('sites').filter(function (x) { return x.id === id; })[0];
    return s ? (s.name || s.url) : '—';
  }

  function editIncident(row) {
    PANEL.formModal({
      title: row ? 'Edit incident' : 'Log incident',
      fields: [
        { key: 'title', label: 'What happened', required: true, placeholder: 'Checkout returned 500 for all card payments' },
        { key: 'siteId', label: 'Site', type: 'select', options: siteOptions() },
        { key: 'severity', label: 'Severity', type: 'select', options: [
          { value: 'major', label: 'Major — users blocked' },
          { value: 'minor', label: 'Minor — degraded' }
        ] },
        { key: 'startedAt', label: 'Started', type: 'date', required: true },
        { key: 'resolvedAt', label: 'Resolved', type: 'date', help: 'Leave empty while it is still open.' },
        { key: 'cause', label: 'Root cause', type: 'textarea' },
        { key: 'fix', label: 'Fix / follow-up', type: 'textarea' }
      ],
      values: row || { startedAt: PANEL.today(), severity: 'minor' },
      onSave: function (v) {
        return PANEL.save('incidents', row && row.id, v).then(function () {
          PANEL.toast('ok', 'Incident saved.'); PANEL.render();
        });
      },
      onDelete: row ? function () {
        return PANEL.remove('incidents', row.id).then(function () { PANEL.render(); });
      } : null
    });
  }

  function editTask(row) {
    PANEL.formModal({
      title: row ? 'Edit task' : 'New task',
      fields: [
        { key: 'title', label: 'Task', required: true },
        { key: 'siteId', label: 'Site', type: 'select', options: siteOptions() },
        { key: 'priority', label: 'Priority', type: 'select', options: ['high', 'normal', 'low'] },
        { key: 'due', label: 'Due', type: 'date' },
        { key: 'notes', label: 'Notes', type: 'textarea' }
      ],
      values: row || { priority: 'normal' },
      onSave: function (v) {
        return PANEL.save('tasks', row && row.id, v).then(function () { PANEL.render(); });
      },
      onDelete: row ? function () {
        return PANEL.remove('tasks', row.id).then(function () { PANEL.render(); });
      } : null
    });
  }

  PANEL.view('ops', {
    title: 'Alerts, incidents & tasks',
    render: function (host) {
      return Promise.all([PANEL.loadAll(), PANEL.health.fetch()]).then(function (r) {
        var alerts = PANEL.health.build(r[1]);
        var incidents = PANEL.get('incidents').slice().sort(function (a, b) {
          return (a.startedAt < b.startedAt) ? 1 : -1;
        });
        var open = incidents.filter(function (i) { return !i.resolvedAt; });
        var tasks = PANEL.get('tasks').slice().sort(function (a, b) {
          if (!!a.done !== !!b.done) return a.done ? 1 : -1;
          return (a.due || '9999') < (b.due || '9999') ? -1 : 1;
        });

        host.innerHTML =
          '<div class="stack">' +

          '<div class="card">' +
            '<div class="card-head"><h2>Alerts</h2><span class="row-end t-sub">' +
              alerts.filter(function (a) { return a.severity === 'bad'; }).length + ' urgent · ' +
              alerts.filter(function (a) { return a.severity === 'warn'; }).length + ' warnings</span></div>' +
            (alerts.length ? alerts.map(function (a) {
              return '<div class="row" style="align-items:flex-start;gap:9px;padding:9px 0;border-bottom:1px solid var(--line-soft)">' +
                '<span class="check-dot ' + (a.severity === 'bad' ? 'bad' : 'warn') + '" style="margin-top:6px"></span>' +
                '<div style="flex:1;min-width:0"><span class="t-main">' + PANEL.esc(a.title) + '</span>' +
                '<br><span class="t-sub">' + PANEL.esc(a.detail) + '</span></div>' +
                '<a class="btn btn-sm" href="#/' + PANEL.esc(a.route) + '">Open</a></div>';
            }).join('') : '<p class="empty">Nothing needs attention. Renewals, certificates, budgets and checks are all inside their thresholds.</p>') +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><h2>Incidents</h2>' +
              '<span class="row-end"></span>' +
              (open.length ? '<span class="tag bad">' + open.length + ' open</span>' : '<span class="tag ok">none open</span>') +
              '<button class="btn btn-sm btn-primary" id="inc-add">Log incident</button></div>' +
            (incidents.length ? '<div class="table-wrap"><table><thead><tr>' +
              '<th>Incident</th><th>Site</th><th>Severity</th><th>Started</th><th>Duration</th><th></th></tr></thead><tbody>' +
              incidents.map(function (i) {
                var dur = i.resolvedAt
                  ? Math.max(0, Math.round((PANEL.parseISO(i.resolvedAt) - PANEL.parseISO(i.startedAt)) / PANEL.DAY)) + ' d'
                  : '<span class="tag bad">open</span>';
                return '<tr><td><span class="t-main">' + PANEL.esc(i.title) + '</span>' +
                  (i.cause ? '<br><span class="t-sub">' + PANEL.esc(i.cause) + '</span>' : '') + '</td>' +
                  '<td class="t-sub">' + PANEL.esc(siteName(i.siteId)) + '</td>' +
                  '<td><span class="tag ' + (i.severity === 'major' ? 'bad' : 'warn') + '">' + PANEL.esc(i.severity || 'minor') + '</span></td>' +
                  '<td class="mono t-sub">' + PANEL.esc(i.startedAt || '—') + '</td>' +
                  '<td>' + dur + '</td>' +
                  '<td style="text-align:right;white-space:nowrap">' +
                    (i.resolvedAt ? '' : '<button class="btn btn-sm" data-resolve="' + PANEL.esc(i.id) + '">Resolve</button> ') +
                    '<button class="btn btn-sm" data-inc="' + PANEL.esc(i.id) + '">Edit</button></td></tr>';
              }).join('') + '</tbody></table></div>'
              : '<p class="empty">No incidents logged. Log one when something breaks — the history is what turns "it feels flaky" into a decision.</p>') +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><h2>Tasks</h2><span class="row-end"></span>' +
              '<button class="btn btn-sm btn-primary" id="task-add">New task</button></div>' +
            (tasks.length ? tasks.map(function (t) {
              var overdue = !t.done && t.due && PANEL.daysUntil(t.due) < 0;
              return '<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line-soft)">' +
                '<input type="checkbox" style="width:auto" data-done="' + PANEL.esc(t.id) + '"' + (t.done ? ' checked' : '') + '>' +
                '<span class="' + (t.done ? 't-sub' : 't-main') + '" style="' + (t.done ? 'text-decoration:line-through' : '') + '">' +
                  PANEL.esc(t.title) + '</span>' +
                (t.priority === 'high' && !t.done ? ' <span class="tag bad">high</span>' : '') +
                (t.siteId ? ' <span class="tag">' + PANEL.esc(siteName(t.siteId)) + '</span>' : '') +
                '<span class="row-end"></span>' +
                (t.due ? '<span class="' + (overdue ? 'tag bad' : 't-sub') + '">' + PANEL.esc(PANEL.fmtDate(t.due)) + '</span>' : '') +
                '<button class="btn btn-sm" data-task="' + PANEL.esc(t.id) + '">Edit</button></div>';
            }).join('') : '<p class="empty">No tasks.</p>') +
          '</div>' +

          '</div>';

        host.querySelector('#inc-add').onclick = function () { editIncident(null); };
        host.querySelector('#task-add').onclick = function () { editTask(null); };
        host.querySelectorAll('[data-inc]').forEach(function (b) {
          b.onclick = function () {
            editIncident(incidents.filter(function (i) { return i.id === b.getAttribute('data-inc'); })[0]);
          };
        });
        host.querySelectorAll('[data-resolve]').forEach(function (b) {
          b.onclick = function () {
            PANEL.save('incidents', b.getAttribute('data-resolve'), { resolvedAt: PANEL.today() })
              .then(function () { PANEL.toast('ok', 'Marked resolved.'); PANEL.render(); });
          };
        });
        host.querySelectorAll('[data-task]').forEach(function (b) {
          b.onclick = function () {
            editTask(tasks.filter(function (t) { return t.id === b.getAttribute('data-task'); })[0]);
          };
        });
        host.querySelectorAll('[data-done]').forEach(function (cb) {
          cb.onchange = function () {
            PANEL.save('tasks', cb.getAttribute('data-done'), { done: cb.checked })
              .then(function () { PANEL.render(); });
          };
        });
      });
    }
  });
})();
