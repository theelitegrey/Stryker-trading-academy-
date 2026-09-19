/* Master Panel — Spend & subscriptions.
 *
 * Two records, deliberately kept apart:
 *   subscriptions — a recurring commitment. Answers "what am I on the hook for".
 *   expenses      — money that actually left an account. Answers "what did I pay".
 * Mixing them is how a run-rate quietly becomes a fantasy: a cancelled tool
 * still shows in last month's spend, and a renewal you have not paid yet must
 * not show at all.
 */
(function () {
  'use strict';

  function siteOptions(withShared) {
    var opts = withShared ? [{ value: '', label: 'Shared / all sites' }] : [];
    return opts.concat(PANEL.get('sites').map(function (s) {
      return { value: s.id, label: s.name || s.url };
    }));
  }
  function siteName(id) {
    if (!id) return 'Shared';
    var s = PANEL.get('sites').filter(function (x) { return x.id === id; })[0];
    return s ? (s.name || s.url) : 'Unknown site';
  }

  var SUB_FIELDS = function () {
    return [
      { key: 'vendor', label: 'Vendor', required: true, placeholder: 'Cloudflare, Figma, Razorpay…' },
      { key: 'plan', label: 'Plan / product', placeholder: 'Pages Pro, Team seat ×3' },
      { key: 'category', label: 'Category', type: 'select', options: PANEL.money.CATEGORIES },
      { key: 'siteId', label: 'Site', type: 'select', options: siteOptions(true) },
      { key: 'amount', label: 'Amount per cycle', type: 'number', required: true },
      { key: 'currency', label: 'Currency', type: 'select', options: PANEL.money.CURRENCIES },
      { key: 'cycle', label: 'Billing cycle', type: 'select', options: PANEL.money.CYCLES },
      { key: 'status', label: 'Status', type: 'select', options: PANEL.money.STATUSES },
      { key: 'startDate', label: 'Started on', type: 'date' },
      { key: 'renewsOn', label: 'Next renewal', type: 'date', help: 'Leave empty to derive it from the start date and cycle.' },
      { key: 'endsOn', label: 'Ends / expires on', type: 'date', help: 'Trial end, domain expiry, or the date a cancelled plan stops working.' },
      { key: 'autoRenew', label: 'Auto-renews', type: 'checkbox', value: true },
      { key: 'paymentMethod', label: 'Paid with', placeholder: 'Visa ••4821, PayPal, UPI' },
      { key: 'url', label: 'Account URL', type: 'url' },
      { key: 'cancelUrl', label: 'Cancel / manage URL', type: 'url' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ];
  };

  function editSub(row) {
    PANEL.formModal({
      title: row ? 'Edit subscription' : 'New subscription',
      fields: SUB_FIELDS(),
      values: row || { currency: PANEL.cfg().baseCurrency, cycle: 'monthly', status: 'active', autoRenew: true, startDate: PANEL.today() },
      onSave: function (v) {
        return PANEL.save('subscriptions', row && row.id, v).then(function () {
          PANEL.toast('ok', 'Subscription saved.');
          PANEL.render();
        });
      },
      onDelete: row ? function () {
        return PANEL.remove('subscriptions', row.id).then(function () {
          PANEL.toast('ok', 'Deleted.');
          PANEL.render();
        });
      } : null
    });
  }

  function editExpense(row, preset) {
    PANEL.formModal({
      title: row ? 'Edit expense' : 'Record a payment',
      fields: [
        { key: 'date', label: 'Date paid', type: 'date', required: true },
        { key: 'vendor', label: 'Vendor', required: true },
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        { key: 'currency', label: 'Currency', type: 'select', options: PANEL.money.CURRENCIES },
        { key: 'category', label: 'Category', type: 'select', options: PANEL.money.CATEGORIES },
        { key: 'siteId', label: 'Site', type: 'select', options: siteOptions(true) },
        { key: 'invoice', label: 'Invoice / reference', placeholder: 'INV-2291' },
        { key: 'note', label: 'Note', type: 'textarea' }
      ],
      values: row || Object.assign({ date: PANEL.today(), currency: PANEL.cfg().baseCurrency }, preset || {}),
      onSave: function (v) {
        return PANEL.save('expenses', row && row.id, v).then(function () {
          PANEL.toast('ok', 'Expense recorded.');
          PANEL.render();
        });
      },
      onDelete: row ? function () {
        return PANEL.remove('expenses', row.id).then(function () {
          PANEL.toast('ok', 'Deleted.');
          PANEL.render();
        });
      } : null
    });
  }

  // ---- breakdown helper: {key, monthly} sorted desc -------------------
  function breakdown(subs, keyFn) {
    var map = {};
    subs.forEach(function (s) {
      var k = keyFn(s) || 'Uncategorised';
      map[k] = (map[k] || 0) + PANEL.money.monthlyBase(s);
    });
    return Object.keys(map).map(function (k) { return { key: k, monthly: map[k] }; })
      .filter(function (r) { return r.monthly > 0.005; })
      .sort(function (a, b) { return b.monthly - a.monthly; });
  }

  function breakdownHtml(rows, total) {
    if (!rows.length) return '<p class="empty">Nothing recurring yet.</p>';
    return rows.map(function (r) {
      var pct = total > 0 ? r.monthly / total * 100 : 0;
      return '<div style="margin-bottom:11px">' +
        '<div class="row" style="gap:8px;margin-bottom:4px">' +
          '<span class="t-main" style="font-size:12.5px">' + PANEL.esc(r.key) + '</span>' +
          '<span class="row-end mono t-sub">' + PANEL.money.fmtBase(r.monthly) + '/mo · ' + Math.round(pct) + '%</span>' +
        '</div>' +
        '<div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '</div>';
    }).join('');
  }

  PANEL.view('money', {
    title: 'Spend & subscriptions',
    render: function (host) {
      return PANEL.loadAll().then(function () {
        var subs = PANEL.get('subscriptions');
        var expenses = PANEL.get('expenses').slice().sort(function (a, b) {
          return (a.date < b.date) ? 1 : -1;
        });

        var active = subs.filter(function (s) { return s.status === 'active'; });
        var monthly = subs.reduce(function (n, s) { return n + PANEL.money.monthlyBase(s); }, 0);
        var thisMonth = PANEL.money.monthKey(new Date());
        var spent = PANEL.money.spentInMonth(expenses, thisMonth);
        var next30 = PANEL.money.forecast(subs, 30)
          .reduce(function (n, f) { return n + f.amountBase; }, 0);
        var budget = PANEL.cfg().monthlyBudget || 0;

        var months = PANEL.money.lastMonths(6);
        var series = months.map(function (m) { return PANEL.money.spentInMonth(expenses, m); });
        var peak = Math.max.apply(null, series.concat([1]));

        host.innerHTML =
          '<div class="stack">' +

          '<div class="grid g4">' +
            stat('Monthly run-rate', PANEL.money.fmtBase(monthly), active.length + ' active subscription' + (active.length === 1 ? '' : 's')) +
            stat('Annualised', PANEL.money.fmtBase(monthly * 12), 'If nothing changes') +
            stat('Paid this month', PANEL.money.fmtBase(spent),
              budget ? (spent > budget ? 'Over a ' + PANEL.money.fmtBase(budget) + ' budget' : PANEL.money.fmtBase(budget - spent) + ' left of budget')
                : 'No budget set', budget && spent > budget ? 'bad' : '') +
            stat('Due in 30 days', PANEL.money.fmtBase(next30), 'Across all vendors') +
          '</div>' +

          '<div class="grid g2">' +
            '<div class="card"><div class="card-head"><h2>Cost per site</h2></div>' +
              breakdownHtml(breakdown(subs, function (s) { return siteName(s.siteId); }), monthly) + '</div>' +
            '<div class="card"><div class="card-head"><h2>Cost per category</h2></div>' +
              breakdownHtml(breakdown(subs, function (s) { return s.category; }), monthly) + '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><h2>Recorded spend, last 6 months</h2>' +
              '<span class="row-end t-sub">Base currency ' + PANEL.esc(PANEL.cfg().baseCurrency) + '</span></div>' +
            '<div class="chart">' + months.map(function (m, i) {
              return '<div class="chart-col" title="' + PANEL.esc(PANEL.money.monthLabel(m)) + ': ' + PANEL.money.fmtBase(series[i]) + '">' +
                '<span class="t-sub mono" style="font-size:10px">' + (series[i] ? PANEL.fmtNum(Math.round(series[i])) : '') + '</span>' +
                '<div class="chart-bar" style="height:' + Math.max(2, series[i] / peak * 86) + 'px"></div>' +
                '<span class="chart-x">' + PANEL.esc(PANEL.money.monthLabel(m)) + '</span></div>';
            }).join('') + '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><h2>Subscriptions</h2>' +
              '<span class="row-end"></span>' +
              '<button class="btn btn-sm" id="sub-csv">Export CSV</button>' +
              '<button class="btn btn-sm btn-primary" id="sub-add">Add subscription</button></div>' +
            (subs.length ? subsTable(subs) : '<p class="empty">No subscriptions yet. Add the first one to start the run-rate.</p>') +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><h2>Expenses</h2>' +
              '<span class="row-end"></span>' +
              '<button class="btn btn-sm" id="exp-csv">Export CSV</button>' +
              '<button class="btn btn-sm btn-primary" id="exp-add">Record payment</button></div>' +
            (expenses.length ? expTable(expenses.slice(0, 60)) : '<p class="empty">No payments recorded yet.</p>') +
            (expenses.length > 60 ? '<p class="t-sub" style="margin-top:10px">Showing the 60 most recent of ' + expenses.length + '. Export the CSV for the full ledger.</p>' : '') +
          '</div>' +

          '</div>';

        host.querySelector('#sub-add').onclick = function () { editSub(null); };
        host.querySelector('#exp-add').onclick = function () { editExpense(null); };
        host.querySelector('#sub-csv').onclick = function () {
          PANEL.csv([['Vendor', 'Plan', 'Category', 'Site', 'Amount', 'Currency', 'Cycle', 'Monthly (' + PANEL.cfg().baseCurrency + ')', 'Status', 'Started', 'Next charge', 'Ends', 'Auto-renew', 'Paid with', 'Notes']]
            .concat(subs.map(function (s) {
              return [s.vendor, s.plan, s.category, siteName(s.siteId), s.amount, s.currency, s.cycle,
                Math.round(PANEL.money.monthlyBase(s) * 100) / 100, s.status, s.startDate,
                PANEL.money.nextCharge(s) || '', s.endsOn, s.autoRenew === false ? 'no' : 'yes', s.paymentMethod, s.notes];
            })), 'subscriptions-' + PANEL.today() + '.csv');
        };
        host.querySelector('#exp-csv').onclick = function () {
          PANEL.csv([['Date', 'Vendor', 'Amount', 'Currency', 'Base (' + PANEL.cfg().baseCurrency + ')', 'Category', 'Site', 'Invoice', 'Note']]
            .concat(expenses.map(function (e) {
              return [e.date, e.vendor, e.amount, e.currency,
                Math.round(PANEL.money.toBase(e.amount, e.currency) * 100) / 100,
                e.category, siteName(e.siteId), e.invoice, e.note];
            })), 'expenses-' + PANEL.today() + '.csv');
        };

        host.querySelectorAll('[data-sub]').forEach(function (btn) {
          btn.onclick = function () {
            editSub(subs.filter(function (s) { return s.id === btn.getAttribute('data-sub'); })[0]);
          };
        });
        host.querySelectorAll('[data-pay]').forEach(function (btn) {
          btn.onclick = function () {
            var s = subs.filter(function (x) { return x.id === btn.getAttribute('data-pay'); })[0];
            if (!s) return;
            editExpense(null, {
              vendor: s.vendor, amount: s.amount, currency: s.currency,
              category: s.category, siteId: s.siteId, note: s.plan || ''
            });
          };
        });
        host.querySelectorAll('[data-exp]').forEach(function (btn) {
          btn.onclick = function () {
            editExpense(expenses.filter(function (e) { return e.id === btn.getAttribute('data-exp'); })[0]);
          };
        });
      });
    }
  });

  function stat(label, val, foot, tone) {
    return '<div class="stat ' + (tone || '') + '"><div class="stat-label">' + PANEL.esc(label) + '</div>' +
      '<div class="stat-val">' + PANEL.esc(val) + '</div>' +
      '<div class="stat-foot">' + PANEL.esc(foot) + '</div></div>';
  }

  function subsTable(subs) {
    var sorted = subs.slice().sort(function (a, b) {
      var an = PANEL.money.nextCharge(a) || '9999', bn = PANEL.money.nextCharge(b) || '9999';
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>Vendor</th><th>Site</th><th>Category</th><th class="num">Amount</th>' +
      '<th class="num">Per month</th><th>Next charge</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' +
      sorted.map(function (s) {
        var next = PANEL.money.nextCharge(s);
        var days = next ? PANEL.daysUntil(next) : null;
        var cycle = PANEL.money.CYCLES.filter(function (c) { return c.value === s.cycle; })[0];
        var tone = s.status === 'active' ? 'ok' : s.status === 'trial' ? 'info'
          : s.status === 'paused' ? 'warn' : '';
        return '<tr>' +
          '<td><span class="t-main">' + PANEL.esc(s.vendor || '—') + '</span>' +
            (s.plan ? '<br><span class="t-sub">' + PANEL.esc(s.plan) + '</span>' : '') +
            (s.autoRenew === false ? ' <span class="tag warn">no auto-renew</span>' : '') + '</td>' +
          '<td class="t-sub">' + PANEL.esc(siteName(s.siteId)) + '</td>' +
          '<td class="t-sub">' + PANEL.esc(s.category || '—') + '</td>' +
          '<td class="num">' + PANEL.esc(PANEL.money.fmt(s.amount, s.currency)) +
            '<br><span class="t-sub">' + PANEL.esc(cycle ? cycle.label.toLowerCase() : s.cycle || '') + '</span></td>' +
          '<td class="num">' + PANEL.money.fmtBase(PANEL.money.monthlyBase(s)) + '</td>' +
          '<td>' + (next
            ? PANEL.fmtDate(next) + '<br><span class="t-sub">' + (days <= 0 ? 'today' : 'in ' + days + 'd') + '</span>'
            : '<span class="t-sub">—</span>') + '</td>' +
          '<td><span class="tag ' + tone + '">' + PANEL.esc(s.status || 'active') + '</span></td>' +
          '<td style="text-align:right;white-space:nowrap">' +
            '<button class="btn btn-sm" data-pay="' + PANEL.esc(s.id) + '">Log payment</button> ' +
            '<button class="btn btn-sm" data-sub="' + PANEL.esc(s.id) + '">Edit</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function expTable(rows) {
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th>Date</th><th>Vendor</th><th>Site</th><th>Category</th><th class="num">Amount</th><th class="num">Base</th><th></th>' +
      '</tr></thead><tbody>' +
      rows.map(function (e) {
        return '<tr>' +
          '<td class="mono t-sub">' + PANEL.esc(e.date || '—') + '</td>' +
          '<td><span class="t-main">' + PANEL.esc(e.vendor || '—') + '</span>' +
            (e.note ? '<br><span class="t-sub">' + PANEL.esc(e.note) + '</span>' : '') + '</td>' +
          '<td class="t-sub">' + PANEL.esc(siteName(e.siteId)) + '</td>' +
          '<td class="t-sub">' + PANEL.esc(e.category || '—') + '</td>' +
          '<td class="num">' + PANEL.esc(PANEL.money.fmt(e.amount, e.currency)) + '</td>' +
          '<td class="num t-sub">' + PANEL.money.fmtBase(PANEL.money.toBase(e.amount, e.currency)) + '</td>' +
          '<td style="text-align:right"><button class="btn btn-sm" data-exp="' + PANEL.esc(e.id) + '">Edit</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }
})();
