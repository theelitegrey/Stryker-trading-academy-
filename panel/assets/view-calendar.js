/* Master Panel — Renewal calendar.
 * A month grid of every charge that is coming, plus the 90-day cash view.
 * Charges are computed, never stored: change a cycle and the calendar moves.
 */
(function () {
  'use strict';

  var offset = 0;   // months from the current month, reset on every navigation

  function monthMatrix(year, month) {
    var first = new Date(year, month, 1);
    var start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));   // weeks start Monday
    var days = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getTime());
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }

  PANEL.view('calendar', {
    title: 'Renewal calendar',
    render: function (host) {
      return PANEL.loadAll().then(function () {
        var subs = PANEL.get('subscriptions');
        var base = new Date();
        base.setDate(1);
        base.setMonth(base.getMonth() + offset);
        var year = base.getFullYear(), month = base.getMonth();

        // Forecast far enough ahead to cover whatever month is on screen.
        var horizon = Math.max(120, (offset + 2) * 31);
        var charges = PANEL.money.forecast(subs, horizon);
        var byDate = {};
        charges.forEach(function (c) { (byDate[c.date] = byDate[c.date] || []).push(c); });

        var monthTotal = charges.filter(function (c) {
          return c.date.slice(0, 7) === PANEL.money.monthKey(base);
        }).reduce(function (n, c) { return n + c.amountBase; }, 0);

        var next90 = charges.filter(function (c) { return PANEL.daysUntil(c.date) <= 90; });
        var t30 = sum(charges, 30), t60 = sum(charges, 60), t90 = sum(charges, 90);

        var days = monthMatrix(year, month);
        var todayISO = PANEL.today();

        host.innerHTML =
          '<div class="stack">' +

          '<div class="grid g4">' +
            s('Due in 30 days', PANEL.money.fmtBase(t30), count(charges, 30) + ' charges') +
            s('Due in 60 days', PANEL.money.fmtBase(t60), count(charges, 60) + ' charges') +
            s('Due in 90 days', PANEL.money.fmtBase(t90), count(charges, 90) + ' charges') +
            s('This view', PANEL.money.fmtBase(monthTotal),
              base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head">' +
              '<button class="btn btn-sm" id="cal-prev">‹</button>' +
              '<h2 style="min-width:170px;text-align:center">' +
                PANEL.esc(base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) + '</h2>' +
              '<button class="btn btn-sm" id="cal-next">›</button>' +
              '<span class="row-end"></span>' +
              '<button class="btn btn-sm" id="cal-today">Today</button>' +
              '<button class="btn btn-sm" id="cal-ics">Download .ics</button>' +
            '</div>' +
            '<div class="cal">' +
              ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) {
                return '<div class="cal-dow">' + d + '</div>';
              }).join('') +
              days.map(function (d) {
                var key = PANEL.iso(d);
                var items = byDate[key] || [];
                var out = d.getMonth() !== month;
                return '<div class="cal-day' + (out ? ' out' : '') + (key === todayISO ? ' today' : '') + '">' +
                  '<div class="cal-num">' + d.getDate() + '</div>' +
                  items.slice(0, 4).map(function (c) {
                    var cls = key < todayISO ? 'over' : PANEL.daysUntil(key) <= (PANEL.cfg().renewalWarnDays || 14) ? 'due' : '';
                    return '<span class="cal-item ' + cls + '" title="' +
                      PANEL.esc((c.sub.vendor || '') + ' — ' + PANEL.money.fmt(c.amount, c.currency)) + '">' +
                      PANEL.esc(c.sub.vendor || 'charge') + '</span>';
                  }).join('') +
                  (items.length > 4 ? '<span class="cal-item">+' + (items.length - 4) + ' more</span>' : '') +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card-head"><h2>Next 90 days, in order</h2></div>' +
            (next90.length ? '<div class="table-wrap"><table><thead><tr>' +
              '<th>Date</th><th>In</th><th>Vendor</th><th>Plan</th><th class="num">Amount</th><th class="num">Base</th><th>Auto</th>' +
              '</tr></thead><tbody>' + next90.map(function (c) {
                var d = PANEL.daysUntil(c.date);
                return '<tr>' +
                  '<td class="mono t-sub">' + PANEL.esc(c.date) + '</td>' +
                  '<td>' + (d <= 0 ? '<span class="tag bad">today</span>'
                    : d <= (PANEL.cfg().renewalWarnDays || 14) ? '<span class="tag warn">' + d + ' days</span>'
                      : '<span class="t-sub">' + d + ' days</span>') + '</td>' +
                  '<td class="t-main">' + PANEL.esc(c.sub.vendor || '—') + '</td>' +
                  '<td class="t-sub">' + PANEL.esc(c.sub.plan || '—') + '</td>' +
                  '<td class="num">' + PANEL.esc(PANEL.money.fmt(c.amount, c.currency)) + '</td>' +
                  '<td class="num t-sub">' + PANEL.money.fmtBase(c.amountBase) + '</td>' +
                  '<td>' + (c.sub.autoRenew === false
                    ? '<span class="tag warn">manual</span>' : '<span class="tag ok">auto</span>') + '</td>' +
                '</tr>';
              }).join('') + '</tbody></table></div>'
              : '<p class="empty">Nothing due in the next 90 days.</p>') +
          '</div>' +

          '</div>';

        host.querySelector('#cal-prev').onclick = function () { offset--; PANEL.render(); };
        host.querySelector('#cal-next').onclick = function () { offset++; PANEL.render(); };
        host.querySelector('#cal-today').onclick = function () { offset = 0; PANEL.render(); };
        host.querySelector('#cal-ics').onclick = function () { exportIcs(charges); };
      });
    }
  });

  function sum(charges, days) {
    return charges.filter(function (c) { return PANEL.daysUntil(c.date) <= days; })
      .reduce(function (n, c) { return n + c.amountBase; }, 0);
  }
  function count(charges, days) {
    return charges.filter(function (c) { return PANEL.daysUntil(c.date) <= days; }).length;
  }
  function s(label, val, foot) {
    return '<div class="stat"><div class="stat-label">' + PANEL.esc(label) + '</div>' +
      '<div class="stat-val">' + PANEL.esc(val) + '</div>' +
      '<div class="stat-foot">' + PANEL.esc(foot) + '</div></div>';
  }

  /* All-day VEVENTs, one per upcoming charge, so the renewals can live in
     whatever calendar you actually look at every morning. */
  function exportIcs(charges) {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stryker//Master Panel//EN', 'CALSCALE:GREGORIAN'];
    charges.forEach(function (c, i) {
      var d = c.date.replace(/-/g, '');
      var end = PANEL.iso(new Date(PANEL.parseISO(c.date).getTime() + PANEL.DAY)).replace(/-/g, '');
      lines.push('BEGIN:VEVENT');
      lines.push('UID:panel-' + (c.sub.id || i) + '-' + d + '@strykertrading.com');
      lines.push('DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z');
      lines.push('DTSTART;VALUE=DATE:' + d);
      lines.push('DTEND;VALUE=DATE:' + end);
      lines.push('SUMMARY:' + ics((c.sub.vendor || 'Subscription') + ' — ' + PANEL.money.fmt(c.amount, c.currency)));
      lines.push('DESCRIPTION:' + ics([c.sub.plan, c.sub.paymentMethod, c.sub.cancelUrl].filter(Boolean).join(' · ')));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    PANEL.download(new Blob([lines.join('\r\n')], { type: 'text/calendar' }), 'renewals-' + PANEL.today() + '.ics');
  }
  function ics(v) {
    return String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }
})();
