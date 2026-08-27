// Stryker Trading Academy — Admin dashboard: AI ops brief
// A deterministic operations digest across the whole site: outstanding admin
// work, urgent team notes, site build/version health, and the Global Monitor
// data pipeline's freshness — composed into one prioritised readout so the
// day starts with "what actually needs me". Everything is computed from live
// state; nothing is stored.
// Depends on: admin-tasks.js (loadAdminTaskCounts), progress.js (db).

(function () {
  var MON_URL = 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data/monitor-data.json';

  function esc(s){
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function line(sev, html){
    var col = sev === 'crit' ? '#e5484d' : sev === 'warn' ? '#f5a524' : sev === 'good' ? '#03c988' : '#7fb4ff';
    return { sev: sev, html: '<div class="dov-brief-line"><i style="background:' + col + '"></i><span>' + html + '</span></div>' };
  }

  function checkBuild(){
    var meta = document.querySelector('meta[name="stryker-build"]');
    var pageBuild = meta ? parseInt(meta.content, 10) : null;
    return fetch('assets/version.json?t=' + Date.now())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v || !pageBuild) return null;
        return v.build > pageBuild
          ? line('warn', 'A newer site build (<b>' + v.build + '</b>) is deployed — this tab is on ' + pageBuild + '. Refresh to catch up.')
          : line('good', 'Site healthy on build <b>' + pageBuild + '</b> — deployed version matches this page.');
      })
      .catch(function () { return null; });
  }

  function checkMonitor(){
    return fetch(MON_URL + '?t=' + Math.floor(Date.now() / 300000))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.generatedAt) return line('warn', 'Global Monitor data feed unreachable — students may see stale market data.');
        var mins = Math.round((Date.now() - d.generatedAt) / 60000);
        if (mins > 120) return line('warn', 'Global Monitor data is <b>' + Math.round(mins / 60) + 'h old</b> — check the monitor-data workflow on GitHub.');
        return line('good', 'Global Monitor pipeline fresh (updated ' + mins + ' min ago).');
      })
      .catch(function () { return line('warn', 'Global Monitor data feed unreachable — students may see stale market data.'); });
  }

  function checkNotes(){
    if (typeof db === 'undefined' || !db) return Promise.resolve(null);
    return db.collection('adminNotes').limit(200).get()
      .then(function (snap) {
        var urgent = [], high = 0;
        snap.forEach(function (doc) {
          var n = doc.data();
          if (n.done) return;
          if (n.priority === 'urgent') urgent.push(n.text || '');
          else if (n.priority === 'high') high++;
        });
        if (urgent.length) {
          return line('crit', '<b>' + urgent.length + ' urgent note' + (urgent.length === 1 ? '' : 's') + ':</b> ' +
            esc(String(urgent[0]).slice(0, 80)) + (urgent.length > 1 ? ' (+' + (urgent.length - 1) + ' more)' : '') +
            ' — <a href="notes-admin.html">open notes</a>');
        }
        if (high) return line('warn', high + ' high-priority note' + (high === 1 ? '' : 's') + ' open — <a href="notes-admin.html">review</a>');
        return null;
      })
      .catch(function () { return null; });
  }

  function checkTasks(){
    if (typeof loadAdminTaskCounts !== 'function') return Promise.resolve([]);
    return loadAdminTaskCounts().then(function (tasks) {
      var out = [];
      tasks.forEach(function (t) {
        if (!t.count || t.key === 'notifications') return;
        var sev = t.src.tone === 'urgent' ? 'crit' : 'warn';
        out.push(line(sev, esc(t.src.label(t.count)) + ' — <a href="' + t.src.link + '">deal with it</a>'));
      });
      return out;
    }).catch(function () { return []; });
  }

  function render(){
    var host = document.getElementById('admin-ai-body');
    if (!host) return;
    var dateEl = document.getElementById('admin-ai-date');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

    Promise.all([checkTasks(), checkNotes(), checkBuild(), checkMonitor()]).then(function (r) {
      var lines = [].concat(r[0]).concat([r[1], r[2], r[3]]).filter(Boolean);
      var order = { crit: 0, warn: 1, info: 2, good: 3 };
      lines.sort(function (a, b) { return order[a.sev] - order[b.sev]; });
      var actionable = lines.filter(function (l) { return l.sev === 'crit' || l.sev === 'warn'; }).length;
      var chip = document.getElementById('admin-ai-chip');
      if (chip) {
        chip.textContent = actionable ? actionable + ' NEED ACTION' : 'ALL CLEAR';
        chip.style.color = actionable ? '#f5a524' : '#03c988';
        chip.style.borderColor = actionable ? 'rgba(245,165,36,0.4)' : 'rgba(3,201,136,0.4)';
      }
      host.innerHTML = lines.length
        ? lines.map(function (l) { return l.html; }).join('')
        : '<div class="dov-brief-line"><i style="background:#03c988"></i><span>All quiet — nothing needs you right now.</span></div>';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.getElementById('admin-ai-body')) return;
    if (typeof guardAdminPage === 'function') guardAdminPage(render);
    else render();
  });
})();
