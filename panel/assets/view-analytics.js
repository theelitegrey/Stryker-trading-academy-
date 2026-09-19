/* Master Panel — Analytics.
 *
 * Two different things are on this page and they are labelled as such:
 *   BUSINESS — read live from the academy's own Firestore (students, orders,
 *   plans). This is first-party truth, not a sampled estimate.
 *   TRAFFIC  — only present if the health workflow was given a Cloudflare Web
 *   Analytics token. Without it the card says so instead of showing zeroes.
 *
 * Spend from the panel is joined against revenue here, because "what did this
 * month cost" and "what did this month earn" are the same question.
 */
(function () {
  'use strict';

  var biz = null;

  function loadBusiness(force) {
    if (biz && !force) return Promise.resolve(biz);
    var db = PANEL.db;
    return Promise.all([
      db.collection('students').limit(3000).get().catch(function () { return { forEach: function () { }, size: 0 }; }),
      db.collection('orders').orderBy('createdAt', 'desc').limit(1000).get().catch(function () { return { forEach: function () { }, size: 0 }; }),
      db.collection('plans').get().catch(function () { return { forEach: function () { }, size: 0 }; })
    ]).then(function (r) {
      var students = [], orders = [], plans = [];
      r[0].forEach(function (d) { students.push(Object.assign({ id: d.id }, d.data())); });
      r[1].forEach(function (d) { orders.push(Object.assign({ id: d.id }, d.data())); });
      r[2].forEach(function (d) { plans.push(Object.assign({ id: d.id }, d.data())); });
      biz = { students: students, orders: orders, plans: plans };
      return biz;
    });
  }

  function millis(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (v.toMillis) return v.toMillis();
    if (v.seconds) return v.seconds * 1000;
    var d = new Date(v);
    return isNaN(d) ? 0 : d.getTime();
  }

  PANEL.view('analytics', {
    title: 'Analytics',
    render: function (host) {
      return Promise.all([PANEL.loadAll(), loadBusiness(), PANEL.health.fetch()]).then(function (r) {
        var b = r[1], feed = r[2];
        var months = PANEL.money.lastMonths(6);

        // --- revenue from orders, spend from the panel's own ledger ------
        var revenue = {}, orderCount = {};
        b.orders.forEach(function (o) {
          var ms = millis(o.createdAt);
          if (!ms) return;
          var key = PANEL.money.monthKey(new Date(ms));
          var amt = PANEL.money.toBase(o.finalAmount != null ? o.finalAmount : 0, o.currency || 'USD');
          revenue[key] = (revenue[key] || 0) + amt;
          orderCount[key] = (orderCount[key] || 0) + 1;
        });
        var expenses = PANEL.get('expenses');
        var spendSeries = months.map(function (m) { return PANEL.money.spentInMonth(expenses, m); });
        var revSeries = months.map(function (m) { return revenue[m] || 0; });
        var peak = Math.max.apply(null, revSeries.concat(spendSeries).concat([1]));

        var thisMonth = PANEL.money.monthKey(new Date());
        var revNow = revenue[thisMonth] || 0;
        var spendNow = PANEL.money.spentInMonth(expenses, thisMonth);
        var runRate = PANEL.get('subscriptions').reduce(function (n, s) { return n + PANEL.money.monthlyBase(s); }, 0);

        // --- signups ------------------------------------------------------
        var signups = {};
        b.students.forEach(function (s) {
          var ms = millis(s.createdAt);
          if (!ms) return;
          signups[PANEL.money.monthKey(new Date(ms))] = (signups[PANEL.money.monthKey(new Date(ms))] || 0) + 1;
        });
        var signupSeries = months.map(function (m) { return signups[m] || 0; });
        var signupPeak = Math.max.apply(null, signupSeries.concat([1]));
        var new30 = b.students.filter(function (s) {
          return millis(s.createdAt) > Date.now() - 30 * PANEL.DAY;
        }).length;

        // --- plan mix ------------------------------------------------------
        var mix = {};
        b.students.forEach(function (s) {
          var p = s.plan || 'none';
          mix[p] = (mix[p] || 0) + 1;
        });
        var mixRows = Object.keys(mix).map(function (k) { return { plan: k, n: mix[k] }; })
          .sort(function (a, b2) { return b2.n - a.n; });

        host.innerHTML =
          '<div class="stack">' +

          '<div class="grid g4">' +
            st('Students', PANEL.fmtNum(b.students.length), new30 + ' new in 30 days') +
            st('Revenue this month', PANEL.money.fmtBase(revNow), (orderCount[thisMonth] || 0) + ' orders') +
            st('Spend this month', PANEL.money.fmtBase(spendNow), 'Recorded payments') +
            st('Net this month', PANEL.money.fmtBase(revNow - spendNow),
              'Run-rate cost ' + PANEL.money.fmtBase(runRate) + '/mo',
              revNow - spendNow >= 0 ? 'good' : 'bad') +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><h2>Revenue against spend</h2>' +
              '<span class="row-end t-sub"><span style="color:var(--gold-bright)">▮</span> revenue &nbsp; ' +
              '<span style="color:var(--teal)">▮</span> spend</span></div>' +
            '<div class="chart">' + months.map(function (m, i) {
              return '<div class="chart-col">' +
                '<div class="chart-pair">' +
                  '<div class="chart-bar" style="height:' + Math.max(2, revSeries[i] / peak * 90) + 'px" title="revenue ' + PANEL.money.fmtBase(revSeries[i]) + '"></div>' +
                  '<div class="chart-bar alt" style="height:' + Math.max(2, spendSeries[i] / peak * 90) + 'px" title="spend ' + PANEL.money.fmtBase(spendSeries[i]) + '"></div>' +
                '</div>' +
                '<span class="chart-x">' + PANEL.esc(PANEL.money.monthLabel(m)) + '</span></div>';
            }).join('') + '</div>' +
            '<p class="t-sub" style="margin:10px 0 0">Revenue is the sum of <code>orders.finalAmount</code> converted to ' +
              PANEL.esc(PANEL.cfg().baseCurrency) + '. Spend is what you recorded in this panel.</p>' +
          '</div>' +

          '<div class="grid g2">' +
            '<div class="card"><div class="card-head"><h2>Signups per month</h2></div>' +
              '<div class="chart">' + months.map(function (m, i) {
                return '<div class="chart-col" title="' + signupSeries[i] + ' signups">' +
                  '<span class="t-sub mono" style="font-size:10px">' + (signupSeries[i] || '') + '</span>' +
                  '<div class="chart-bar" style="height:' + Math.max(2, signupSeries[i] / signupPeak * 86) + 'px"></div>' +
                  '<span class="chart-x">' + PANEL.esc(PANEL.money.monthLabel(m)) + '</span></div>';
              }).join('') + '</div></div>' +

            '<div class="card"><div class="card-head"><h2>Plan mix</h2></div>' +
              (mixRows.length ? '<div class="table-wrap"><table><thead><tr><th>Plan</th><th class="num">Students</th><th class="num">Share</th></tr></thead><tbody>' +
                mixRows.map(function (row) {
                  return '<tr><td class="t-main">' + PANEL.esc(row.plan) + '</td>' +
                    '<td class="num">' + PANEL.fmtNum(row.n) + '</td>' +
                    '<td class="num t-sub">' + Math.round(row.n / b.students.length * 100) + '%</td></tr>';
                }).join('') + '</tbody></table></div>' : '<p class="empty">No students yet.</p>') + '</div>' +
          '</div>' +

          trafficCard(feed) +

          '<p class="t-sub">Business figures read live from Firestore (students capped at 3000, orders at the 1000 most recent). ' +
            'Nothing on this page is cached server-side.</p>' +
          '</div>';
      });
    }
  });

  function trafficCard(feed) {
    var a = feed && feed.analytics;
    if (!a || !a.sites || !a.sites.length) {
      return '<div class="card"><div class="card-head"><h2>Traffic</h2></div>' +
        '<p class="t-sub" style="margin:0">Traffic numbers come from Cloudflare Web Analytics through the health workflow. ' +
        'Add a <code>CF_ANALYTICS_TOKEN</code> repository secret and a <code>zoneTag</code> per site in ' +
        '<code>panel/sites.json</code>, and this card fills in. Until then it stays empty rather than showing invented numbers.</p></div>';
    }
    return '<div class="card"><div class="card-head"><h2>Traffic — last 7 days</h2>' +
      '<span class="row-end t-sub">Cloudflare Web Analytics</span></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Site</th><th class="num">Visits</th><th class="num">Page views</th>' +
      '<th class="num">Unique visitors</th></tr></thead><tbody>' +
      a.sites.map(function (s) {
        return '<tr><td class="t-main">' + PANEL.esc(s.name || s.url) + '</td>' +
          '<td class="num">' + PANEL.fmtNum(s.visits) + '</td>' +
          '<td class="num">' + PANEL.fmtNum(s.pageViews) + '</td>' +
          '<td class="num">' + PANEL.fmtNum(s.uniques) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function st(label, val, foot, tone) {
    return '<div class="stat ' + (tone || '') + '"><div class="stat-label">' + PANEL.esc(label) + '</div>' +
      '<div class="stat-val">' + PANEL.esc(val) + '</div>' +
      '<div class="stat-foot">' + PANEL.esc(foot || '') + '</div></div>';
  }
})();
