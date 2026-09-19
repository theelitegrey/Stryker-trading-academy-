/* Master Panel — money: currency conversion, recurrence maths, forecasting.
 *
 * Every figure in the panel that mixes currencies or billing cycles comes
 * through here, so there is one definition of "what does this cost a month"
 * and one place to correct it.
 */
PANEL.money = (function () {
  'use strict';

  var SYMBOL = { USD: '$', INR: '₹', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$' };
  var CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'AUD', 'CAD'];
  var CYCLES = [
    { value: 'monthly',   label: 'Monthly',        months: 1 },
    { value: 'quarterly', label: 'Quarterly',      months: 3 },
    { value: 'biannual',  label: 'Every 6 months', months: 6 },
    { value: 'yearly',    label: 'Yearly',         months: 12 },
    { value: 'biennial',  label: 'Every 2 years',  months: 24 },
    { value: 'weekly',    label: 'Weekly',         months: 0 },
    { value: 'oneoff',    label: 'One-off',        months: 0 }
  ];
  var CATEGORIES = [
    'Hosting', 'Domain', 'SaaS', 'API / data', 'Marketing', 'Design',
    'Email', 'Security', 'Contractor', 'Hardware', 'Other'
  ];
  var STATUSES = ['active', 'trial', 'paused', 'cancelled', 'expired'];

  function symbol(c) { return SYMBOL[c] || (c ? c + ' ' : '$'); }

  /* Convert to the base currency using the editable rates in Settings.
     Rates are "1 unit of X = N base units". An unknown currency converts at
     1:1 and is flagged in Settings rather than silently distorting a total. */
  function toBase(amount, currency) {
    var c = PANEL.cfg();
    var rate = (c.rates || {})[currency || c.baseCurrency];
    if (rate == null) rate = 1;
    return (Number(amount) || 0) * rate;
  }
  function fmtBase(amount) {
    var c = PANEL.cfg();
    return symbol(c.baseCurrency) + PANEL.fmtNum(Math.round(amount || 0));
  }
  function fmt(amount, currency) {
    return symbol(currency) + PANEL.fmtNum(amount, Number(amount) % 1 ? 2 : 0);
  }

  function cycleMonths(cycle) {
    var c = CYCLES.filter(function (x) { return x.value === cycle; })[0];
    return c ? c.months : 1;
  }

  /* What this subscription costs per month, in base currency.
     Cancelled, expired and paused lines cost nothing; a one-off is a single
     charge and belongs in the forecast, not in a recurring run-rate. */
  function monthlyBase(sub) {
    if (!sub) return 0;
    if (sub.status && sub.status !== 'active' && sub.status !== 'trial') return 0;
    if (sub.status === 'trial') return 0;              // not billing yet
    var amt = toBase(sub.amount, sub.currency);
    if (sub.cycle === 'weekly') return amt * 52 / 12;
    if (sub.cycle === 'oneoff') return 0;
    var m = cycleMonths(sub.cycle || 'monthly') || 1;
    return amt / m;
  }
  function yearlyBase(sub) { return monthlyBase(sub) * 12; }

  function addCycle(date, cycle) {
    var d = new Date(date.getTime());
    if (cycle === 'weekly') { d.setDate(d.getDate() + 7); return d; }
    var m = cycleMonths(cycle || 'monthly') || 1;
    var day = d.getDate();
    d.setMonth(d.getMonth() + m);
    // A 31st renewal in a 30-day month lands on the 1st without this clamp.
    if (d.getDate() < day) d.setDate(0);
    return d;
  }

  /* The next date money actually leaves the account, as an ISO string.
     Returns null when nothing more is owed (cancelled, ended, or a one-off
     that has already been paid). */
  function nextCharge(sub, fromISO) {
    if (!sub) return null;
    if (sub.status === 'cancelled' || sub.status === 'expired' || sub.status === 'paused') return null;
    var from = PANEL.parseISO(fromISO || PANEL.today());
    var seed = PANEL.parseISO(sub.renewsOn || sub.startDate);
    if (!seed) return null;

    if (sub.cycle === 'oneoff') return seed >= from ? PANEL.iso(seed) : null;

    var end = PANEL.parseISO(sub.endsOn);
    var d = seed, guard = 0;
    while (d < from && guard++ < 400) d = addCycle(d, sub.cycle);
    if (end && d > end) return null;
    return PANEL.iso(d);
  }

  /* Every charge due in the next `days` days, oldest first, including a
     subscription that bills more than once inside the window. */
  function forecast(subs, days) {
    var out = [];
    var from = PANEL.parseISO(PANEL.today());
    var until = new Date(from.getTime() + days * PANEL.DAY);
    subs.forEach(function (s) {
      var nextISO = nextCharge(s);
      if (!nextISO) return;
      var d = PANEL.parseISO(nextISO), guard = 0;
      var end = PANEL.parseISO(s.endsOn);
      while (d <= until && guard++ < 60) {
        if (end && d > end) break;
        out.push({
          date: PANEL.iso(d),
          sub: s,
          amountBase: toBase(s.amount, s.currency),
          amount: Number(s.amount) || 0,
          currency: s.currency
        });
        if (s.cycle === 'oneoff') break;
        d = addCycle(d, s.cycle);
      }
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  /* Spend actually recorded in a month, base currency. `month` is 'YYYY-MM'. */
  function spentInMonth(expenses, month) {
    return expenses.reduce(function (sum, e) {
      return String(e.date || '').slice(0, 7) === month ? sum + toBase(e.amount, e.currency) : sum;
    }, 0);
  }
  function monthKey(d) { return PANEL.iso(d).slice(0, 7); }
  function monthLabel(key) {
    var p = key.split('-');
    return new Date(+p[0], +p[1] - 1, 1)
      .toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  function lastMonths(n) {
    var out = [], d = new Date();
    d.setDate(1);
    for (var i = 0; i < n; i++) {
      out.unshift(monthKey(d));
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }

  return {
    SYMBOL: SYMBOL, CURRENCIES: CURRENCIES, CYCLES: CYCLES,
    CATEGORIES: CATEGORIES, STATUSES: STATUSES,
    symbol: symbol, toBase: toBase, fmt: fmt, fmtBase: fmtBase,
    cycleMonths: cycleMonths, monthlyBase: monthlyBase, yearlyBase: yearlyBase,
    addCycle: addCycle, nextCharge: nextCharge, forecast: forecast,
    spentInMonth: spentInMonth, lastMonths: lastMonths,
    monthKey: monthKey, monthLabel: monthLabel
  };
})();
