/* Master Panel — Overview.
 * One screen that answers: what is broken, what is about to cost money, and
 * what is the whole estate costing. Everything here links to the view that
 * can act on it.
 */
(function () {
  'use strict';

  PANEL.view('overview', {
    title: 'Overview',
    render: function (host) {
      return Promise.all([PANEL.loadAll(), PANEL.health.fetch()]).then(function (r) {
        var feed = r[1];
        var alerts = PANEL.health.build(feed);

        var sites = PANEL.get('sites');
        var subs = PANEL.get('subscriptions');
        var expenses = PANEL.get('expenses');

        var monthly = subs.reduce(function (n, s) { return n + PANEL.money.monthlyBase(s); }, 0);
        var due30 = PANEL.money.forecast(subs, 30);
        var due30Total = due30.reduce(function (n, f) { return n + f.amountBase; }, 0);
        var thisMonth = PANEL.money.monthKey(new Date());
        var spent = PANEL.money.spentInMonth(expenses, thisMonth);

        var entries = (feed && feed.sites) || [];
        var down = entries.filter(function (e) { return !e.ok; });

        host.innerHTML =
          '<div class="stack">' +

          '<div class="grid g4">' +
            st('Monthly run-rate', PANEL.money.fmtBase(monthly),
              subs.filter(function (s) { return s.status === 'active'; }).length + ' active subscriptions') +
            st('Due in 30 days', PANEL.money.fmtBase(due30Total), due30.length + ' charges ahead') +
            st('Paid this month', PANEL.money.fmtBase(spent), 'Recorded payments') +
            st('Sites', String(sites.length),
              !feed ? 'health feed not connected'
                : down.length ? down.length + ' failing checks'
                  : entries.length + ' of ' + sites.length + ' monitored, all passing',
              down.length ? 'bad' : (feed ? 'good' : '')) +
          '</div>' +

          '<div class="grid g2">' +
            '<div class="card">' +
              '<div class="card-head"><h2>Needs attention</h2>' +
                '<span class="row-end"><a class="btn btn-sm" href="#/ops">All alerts</a></span></div>' +
              (alerts.length ? alerts.slice(0, 7).map(function (a) {
                return '<a href="#/' + PANEL.esc(a.route) + '" class="row" style="align-items:flex-start;gap:9px;padding:8px 0;border-bottom:1px solid var(--line-soft);color:inherit">' +
                  '<span class="check-dot ' + (a.severity === 'bad' ? 'bad' : 'warn') + '" style="margin-top:6px"></span>' +
                  '<span style="flex:1;min-width:0"><span class="t-main">' + PANEL.esc(a.title) + '</span>' +
                  '<br><span class="t-sub">' + PANEL.esc(a.detail) + '</span></span></a>';
              }).join('') + (alerts.length > 7 ? '<p class="t-sub" style="margin:10px 0 0">+ ' + (alerts.length - 7) + ' more</p>' : '')
                : '<p class="empty">Nothing is failing, nothing expires soon, and no renewal is inside its warning window.</p>') +
            '</div>' +

            '<div class="card">' +
              '<div class="card-head"><h2>Next charges</h2>' +
                '<span class="row-end"><a class="btn btn-sm" href="#/calendar">Calendar</a></span></div>' +
              (due30.length ? due30.slice(0, 8).map(function (c) {
                var d = PANEL.daysUntil(c.date);
                return '<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line-soft)">' +
                  '<span class="t-main">' + PANEL.esc(c.sub.vendor || '—') + '</span>' +
                  '<span class="t-sub">' + PANEL.esc(c.sub.plan || '') + '</span>' +
                  '<span class="row-end"></span>' +
                  '<span class="mono">' + PANEL.esc(PANEL.money.fmt(c.amount, c.currency)) + '</span>' +
                  '<span class="' + (d <= 2 ? 'tag bad' : d <= (PANEL.cfg().renewalWarnDays || 14) ? 'tag warn' : 't-sub') + '">' +
                    (d <= 0 ? 'today' : 'in ' + d + 'd') + '</span></div>';
              }).join('') : '<p class="empty">No charges in the next 30 days.</p>') +
            '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><h2>Estate</h2>' +
              '<span class="row-end"><a class="btn btn-sm" href="#/sites">Sites &amp; health</a></span></div>' +
            (sites.length ? '<div class="table-wrap"><table><thead><tr>' +
              '<th>Site</th><th>Status</th><th class="num">Cost / month</th><th class="num">Response</th><th class="num">Audit</th>' +
              '</tr></thead><tbody>' + sites.map(function (s) {
                var e = PANEL.health.bySiteUrl(feed, s.url);
                var cost = subs.filter(function (x) { return x.siteId === s.id; })
                  .reduce(function (n, x) { return n + PANEL.money.monthlyBase(x); }, 0);
                return '<tr><td><span class="t-main">' + PANEL.esc(s.name || s.url) + '</span>' +
                  '<br><span class="t-sub">' + PANEL.esc(s.url) + '</span></td>' +
                  '<td>' + (e ? '<span class="tag ' + (e.ok ? 'ok' : 'bad') + '">' + (e.ok ? 'healthy' : 'failing') + '</span>'
                    : '<span class="tag">not monitored</span>') + '</td>' +
                  '<td class="num">' + PANEL.money.fmtBase(cost) + '</td>' +
                  '<td class="num t-sub">' + (e && e.ms != null ? e.ms + ' ms' : '—') + '</td>' +
                  '<td class="num">' + (e && e.audit ? e.audit.score : '—') + '</td></tr>';
              }).join('') + '</tbody></table></div>'
              : '<p class="empty">No sites yet. <a href="#/sites">Add the first one</a> to start tracking cost and health per property.</p>') +
          '</div>' +

          '</div>';
      });
    }
  });

  function st(label, val, foot, tone) {
    return '<div class="stat ' + (tone || '') + '"><div class="stat-label">' + PANEL.esc(label) + '</div>' +
      '<div class="stat-val">' + PANEL.esc(val) + '</div>' +
      '<div class="stat-foot">' + PANEL.esc(foot || '') + '</div></div>';
  }
})();
