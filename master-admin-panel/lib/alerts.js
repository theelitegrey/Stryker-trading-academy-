'use strict';
// Derive actionable alerts from the current state, and push new ones to a webhook.
const { nextRenewal, daysUntil } = require('./money');

function buildAlerts(state, settings, now = new Date()) {
  const warnDays = Number(settings.renewalWarnDays || 14);
  const alerts = [];
  const siteName = (id) => state.sites.find(s => s.id === id)?.name || null;

  for (const sub of state.subscriptions) {
    const nr = nextRenewal(sub, now);
    const d = daysUntil(nr, now);
    if (nr && d <= warnDays) {
      alerts.push({ key: `renew:${sub.id}:${nr.toISOString().slice(0, 10)}`, sev: d <= 3 ? 'critical' : 'warn', kind: 'renewal',
        title: `${sub.name} renews in ${d} day${d === 1 ? '' : 's'}`, detail: `${sub.currency || settings.currency} ${sub.amount} · ${sub.cycle}${sub.autoRenew === false ? ' · NOT auto-renewing' : ''}`,
        date: nr.toISOString(), ref: { type: 'subscription', id: sub.id } });
    }
    if (sub.endDate) {
      const e = daysUntil(sub.endDate, now);
      if (e >= 0 && e <= warnDays) alerts.push({ key: `end:${sub.id}`, sev: e <= 3 ? 'critical' : 'warn', kind: 'ending', title: `${sub.name} ends in ${e} day${e === 1 ? '' : 's'}`, detail: sub.status === 'trial' ? 'Trial ending' : 'Contract end date', date: sub.endDate, ref: { type: 'subscription', id: sub.id } });
    }
  }
  for (const site of state.sites) {
    const a = state.audits[site.id];
    if (a) {
      if (!a.http.ok) alerts.push({ key: `down:${site.id}`, sev: 'critical', kind: 'down', title: `${site.name} is down`, detail: a.http.error || `HTTP ${a.http.status}`, date: a.t, ref: { type: 'site', id: site.id } });
      if (a.ssl && a.ssl.daysLeft != null && a.ssl.daysLeft <= 21) alerts.push({ key: `ssl:${site.id}:${a.ssl.daysLeft <= 7 ? 'c' : 'w'}`, sev: a.ssl.daysLeft <= 7 ? 'critical' : 'warn', kind: 'ssl', title: `${site.name} TLS cert expires in ${a.ssl.daysLeft} days`, detail: a.ssl.issuer || '', date: a.ssl.validTo, ref: { type: 'site', id: site.id } });
      if (a.ssl && !a.ssl.ok && a.http.ok) alerts.push({ key: `sslerr:${site.id}`, sev: 'critical', kind: 'ssl', title: `${site.name} has a TLS error`, detail: a.ssl.error || '', date: a.t, ref: { type: 'site', id: site.id } });
      if (a.domain && a.domain.daysLeft != null && a.domain.daysLeft <= 45) alerts.push({ key: `domain:${site.id}:${a.domain.daysLeft <= 14 ? 'c' : 'w'}`, sev: a.domain.daysLeft <= 14 ? 'critical' : 'warn', kind: 'domain', title: `${a.domain.domain} domain expires in ${a.domain.daysLeft} days`, detail: a.domain.registrar || '', date: a.domain.expires, ref: { type: 'site', id: site.id } });
      if (a.http.ok && a.score < 60) alerts.push({ key: `score:${site.id}`, sev: 'warn', kind: 'audit', title: `${site.name} audit score is ${a.score}/100`, detail: (a.issues || []).slice(0, 3).map(i => i.msg).join(' · '), date: a.t, ref: { type: 'site', id: site.id } });
    }
    const hist = state.checks[site.id] || [];
    const recent = hist.slice(-3);
    if (recent.length === 3 && recent.every(c => !c.up) && !(a && !a.http.ok)) {
      alerts.push({ key: `down:${site.id}`, sev: 'critical', kind: 'down', title: `${site.name} failed the last 3 checks`, detail: recent[2].error || `HTTP ${recent[2].status}`, date: recent[2].t, ref: { type: 'site', id: site.id } });
    }
  }
  for (const t of state.tasks) {
    if (!t.done && t.due) {
      const d = daysUntil(t.due, now);
      if (d < 0) alerts.push({ key: `task:${t.id}`, sev: 'warn', kind: 'task', title: `Overdue task: ${t.title}`, detail: siteName(t.siteId) || '', date: t.due, ref: { type: 'task', id: t.id } });
    }
  }
  const order = { critical: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => order[a.sev] - order[b.sev] || new Date(a.date) - new Date(b.date));
  return alerts;
}

async function notify(webhookUrl, alerts) {
  if (!webhookUrl || !alerts.length) return false;
  const lines = alerts.map(a => `${a.sev === 'critical' ? '🔴' : '🟠'} ${a.title}${a.detail ? ` — ${a.detail}` : ''}`);
  const text = `Master Admin Panel alerts:\n${lines.join('\n')}`;
  const body = /discord/i.test(webhookUrl) ? { content: text.slice(0, 1900) } : { text, alerts };
  try {
    const res = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.ok;
  } catch { return false; }
}

module.exports = { buildAlerts, notify };
