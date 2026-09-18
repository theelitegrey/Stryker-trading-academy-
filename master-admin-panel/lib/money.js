(function () {
'use strict';
// Subscription cost normalisation and renewal maths.
const CYCLE_MONTHS = { weekly: 12 / 52, monthly: 1, quarterly: 3, biannual: 6, yearly: 12, biennial: 24, 'one-time': 0 };

function monthlyCost(sub) {
  const m = CYCLE_MONTHS[sub.cycle];
  if (!m) return 0;
  if (sub.status === 'cancelled' || sub.status === 'expired') return 0;
  return Number(sub.amount || 0) / m;
}
function yearlyCost(sub) { return monthlyCost(sub) * 12; }

function addCycle(date, cycle, n = 1) {
  const d = new Date(date);
  switch (cycle) {
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7 * n); break;
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + n); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3 * n); break;
    case 'biannual': d.setUTCMonth(d.getUTCMonth() + 6 * n); break;
    case 'yearly': d.setUTCFullYear(d.getUTCFullYear() + n); break;
    case 'biennial': d.setUTCFullYear(d.getUTCFullYear() + 2 * n); break;
    default: return null;
  }
  return d;
}

// Next renewal on/after `now` computed from the anchor (nextRenewal or startDate).
function nextRenewal(sub, now = new Date()) {
  if (sub.cycle === 'one-time' || !CYCLE_MONTHS[sub.cycle]) return null;
  if (sub.status === 'cancelled' || sub.status === 'expired') return null;
  let d = new Date(sub.nextRenewal || sub.startDate || now);
  if (Number.isNaN(d.getTime())) return null;
  let guard = 0;
  while (d < now && guard++ < 600) d = addCycle(d, sub.cycle);
  if (sub.endDate && d > new Date(sub.endDate)) return null;
  return d;
}

function daysUntil(date, now = new Date()) {
  if (!date) return null;
  return Math.ceil((new Date(date) - now) / 86400000);
}

// Charges falling inside [from, to) - used for calendar and monthly spend chart.
function chargesBetween(sub, from, to) {
  const out = [];
  if (sub.cycle === 'one-time') {
    const d = new Date(sub.startDate || sub.nextRenewal);
    if (d >= from && d < to) out.push({ date: d, amount: Number(sub.amount || 0) });
    return out;
  }
  if (!CYCLE_MONTHS[sub.cycle]) return out;
  let d = new Date(sub.nextRenewal || sub.startDate || from);
  if (Number.isNaN(d.getTime())) return out;
  // rewind to before `from`
  let guard = 0;
  while (d > from && guard++ < 600) d = addCycle(d, sub.cycle, -1);
  guard = 0;
  while (d < to && guard++ < 600) {
    const start = sub.startDate ? new Date(sub.startDate) : null;
    const end = sub.endDate ? new Date(sub.endDate) : null;
    const cancelled = sub.status === 'cancelled' || sub.status === 'expired';
    if (d >= from && (!start || d >= start) && (!end || d <= end) && !(cancelled && d > new Date())) {
      out.push({ date: new Date(d), amount: Number(sub.amount || 0) });
    }
    d = addCycle(d, sub.cycle);
  }
  return out;
}

const __exports = { CYCLE_MONTHS, monthlyCost, yearlyCost, nextRenewal, daysUntil, chargesBetween, addCycle };
if (typeof module !== 'undefined') module.exports = __exports; else window.PanelMoney = __exports;
})();
