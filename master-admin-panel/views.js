/* Views for the Master Admin Panel. Loaded after app.js. */
(() => {
'use strict';
const P = window.__panel;
const { S, routes, route, api, modal, field, input, select, confirmDialog, toast, h, raw, esc, money, fmtDate, ago, daysWord, sevOf, scoreSev, siteName, cap, catColor, stackedBars, lineChart, hbars, sparkline, shell, I, CATEGORIES, CYCLES, STATUSES, SERIES } = P;
const btn = (label, cls, attrs = '', icon = '') => h`<button class="btn ${cls}" ${raw(attrs)}>${raw(icon)}${label}</button>`;
const monthLabel = (ym) => new Date(ym + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
const alertHtml = (a) => h`<div class="alert ${a.sev}"><span class="dot ${a.sev}"></span><div><div class="t">${a.title}</div><div class="d">${a.detail || ''} · ${fmtDate(a.date)}</div></div>${a.ref ? h`<a class="btn sm" href="${a.ref.type === 'site' ? '#sites/' + a.ref.id : a.ref.type === 'task' ? '#tasks' : '#subscriptions/' + a.ref.id}">Open</a>` : ''}</div>`;

// ------------------------------------------------------------ dashboard ----
routes.dashboard = async () => {
  const s = S.summary, t = s.totals;
  const renew30 = s.upcoming.filter(u => u.days <= 30);
  const due30 = renew30.reduce((a, u) => a + u.amount, 0);
  const months = s.months.map(m => ({ label: monthLabel(m.month), parts: m.byCategory, future: m.future }));
  const cats = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]);
  const bySite = Object.entries(s.bySite).sort((a, b) => b[1] - a[1]);
  const content = h`<div class="stack">
    <div class="tiles">
      <div class="tile"><div class="label">Monthly burn</div><div class="value num">${money(t.monthly)}</div><div class="sub">${money(t.yearly)} / year · ${t.activeSubs} active subscriptions</div></div>
      <div class="tile"><div class="label">Spent this year</div><div class="value num">${money(t.spentYtd)}</div><div class="sub">Charges since Jan 1</div></div>
      <div class="tile ${sevOf(renew30[0]?.days, 3, 7) === 'critical' ? 'critical' : ''}"><div class="label">Due in next 30 days</div><div class="value num">${money(due30)}</div><div class="sub">${renew30.length} renewal${renew30.length === 1 ? '' : 's'}${renew30[0] ? ` · next ${daysWord(renew30[0].days)}` : ''}</div></div>
      <div class="tile ${t.sitesDown ? 'critical' : 'good'}"><div class="label">Websites</div><div class="value num">${t.sitesUp}<span class="muted" style="font-size:16px;font-weight:500">/${t.sites} up</span></div><div class="sub">${t.sitesDown ? `${t.sitesDown} down` : 'All reachable'}</div></div>
      <div class="tile"><div class="label">Alerts</div><div class="value num" style="color:${s.alerts.some(a => a.sev === 'critical') ? 'var(--critical)' : s.alerts.length ? 'var(--warn)' : 'var(--good)'}">${s.alerts.length}</div><div class="sub">${s.alerts.filter(a => a.sev === 'critical').length} critical · ${t.openTasks} open tasks</div></div>
    </div>
    <div class="grid g23">
      <div class="card"><div class="card-head"><h2>Spend by month</h2><span class="small dim">5 past · current · 6 projected</span></div>${raw(stackedBars(months, CATEGORIES.filter(c => months.some(m => m.parts[c])).concat(Object.keys(s.byCategory).filter(c => !CATEGORIES.includes(c))), { fmt: (v) => money(v) }))}</div>
      <div class="card"><div class="card-head"><h2>Needs attention</h2><a class="small" href="#audits">audits →</a></div>${s.alerts.length ? h`<div class="alert-list">${s.alerts.slice(0, 8).map(alertHtml)}</div>${s.alerts.length > 8 ? h`<p class="small dim" style="margin:8px 0 0">${s.alerts.length - 8} more…</p>` : ''}` : raw('<div class="empty">All clear. Nothing needs attention.</div>')}</div>
    </div>
    <div class="card"><div class="card-head"><h2>Website status</h2><div style="display:flex;gap:8px">${btn('Run all audits', 'sm', 'id="audit-all"', I.refresh)}<a class="btn sm" href="#sites">Manage</a></div></div>
      <div class="site-grid">${s.sites.map(siteCard)}${!s.sites.length ? raw('<div class="empty">No websites yet. Add one under Websites.</div>') : ''}</div></div>
    <div class="grid g3">
      <div class="card"><h2>Upcoming renewals</h2>${s.upcoming.length ? h`<div class="table-wrap"><table class="compact"><thead><tr><th>Service</th><th>When</th><th class="right">Amount</th></tr></thead><tbody>${s.upcoming.slice(0, 10).map(u => h`<tr class="clickable" onclick="location.hash='#subscriptions/${u.id}'"><td><div class="name">${u.name}</div><div class="small dim">${u.vendor}${u.autoRenew === false ? ' · manual renew' : ''}</div></td><td><span class="badge ${sevOf(u.days)}">${daysWord(u.days)}</span><div class="small dim">${fmtDate(u.date)}</div></td><td class="right num">${money(u.amount, u.currency)}</td></tr>`)}</tbody></table></div>` : raw('<div class="empty">No recurring subscriptions.</div>')}</div>
      <div class="card"><h2>Monthly cost by category</h2>${raw(hbars(cats.map(([k, v]) => ({ label: cap(k), value: v, key: k })), { fmt: (v) => money(v), color: (r) => catColor(r.key) }))}</div>
      <div class="card"><h2>Monthly cost by website</h2>${raw(hbars(bySite.map(([k, v]) => ({ label: siteName(k), value: v })), { fmt: (v) => money(v) }))}</div>
    </div></div>`;
  shell(content, 'Dashboard', h`<span class="small dim">Updated ${ago(s.now)}</span>${btn('Refresh', '', 'onclick="__panel.route()"', I.refresh)}`);
  $('#audit-all').onclick = (e) => P.runMonitor(e.target);
};
function siteCard(s) {
  const a = s.audit; const up = a ? a.up : s.lastCheck?.up;
  return h`<div class="site-card" onclick="location.hash='#sites/${s.id}'">
    <div class="row"><div style="min-width:0"><div style="font-weight:600;display:flex;align-items:center;gap:8px"><span class="dot ${up == null ? '' : up ? 'good' : 'critical'}"></span>${s.name}</div><div class="url">${s.url.replace(/^https?:\/\//, '')}</div></div>${a ? h`<span class="score ${scoreSev(a.score)}">${a.score}</span>` : raw('<span class="badge">pending</span>')}</div>
    <div class="kv"><span>Uptime<b>${s.uptime == null ? '—' : s.uptime + '%'}</b></span><span>Response<b>${a?.ms ?? s.lastCheck?.ms ?? '—'}<span class="small muted" style="font-weight:400"> ms</span></b></span><span>Cost / mo<b>${money(s.monthlyCost)}</b></span></div>
    <div class="row"><span>${raw(sparkline(s.sparkline))}</span><span class="small dim">${a?.sslDays != null ? `TLS ${a.sslDays}d` : ''}${a?.domainDays != null ? ` · domain ${a.domainDays}d` : ''}</span></div></div>`;
}
const $ = (sel, root = document) => root.querySelector(sel);

// ----------------------------------------------------------------- sites ----
routes.sites = async (id) => {
  if (id) return siteDetail(id);
  const rows = S.summary.sites;
  const content = h`<div class="card">${rows.length ? h`<div class="table-wrap"><table><thead><tr><th>Website</th><th>Status</th><th>Score</th><th>Uptime</th><th>TLS</th><th>Domain</th><th>Host / stack</th><th class="right">Cost / mo</th><th></th></tr></thead><tbody>
    ${rows.map(s => { const a = s.audit; const up = a ? a.up : s.lastCheck?.up; return h`<tr class="clickable" onclick="location.hash='#sites/${s.id}'">
      <td><div class="name">${s.name}</div><div class="small dim">${s.url.replace(/^https?:\/\//, '')}</div></td>
      <td><span class="badge ${up == null ? '' : up ? 'good' : 'critical'}">${up == null ? 'pending' : up ? `up · ${a?.ms ?? s.lastCheck?.ms} ms` : 'down'}</span></td>
      <td>${a ? h`<span class="badge ${scoreSev(a.score)}">${a.score}/100</span>` : '—'}</td>
      <td class="num">${s.uptime == null ? '—' : s.uptime + '%'}</td>
      <td>${a?.sslDays != null ? h`<span class="badge ${sevOf(a.sslDays, 7, 21)}">${a.sslDays}d</span>` : '—'}</td>
      <td>${a?.domainDays != null ? h`<span class="badge ${sevOf(a.domainDays, 14, 45)}">${a.domainDays}d</span>` : '—'}</td>
      <td class="small">${[s.host, s.stack].filter(Boolean).join(' · ') || '—'}</td>
      <td class="right num">${money(s.monthlyCost)}</td>
      <td><button class="btn sm ghost" onclick="event.stopPropagation();__panel.editSite('${s.id}')">Edit</button></td></tr>`; })}</tbody></table></div>` : raw('<div class="empty">No websites yet. Click “Add website” to start.</div>')}</div>`;
  shell(content, 'Websites', btn('Add website', 'primary', 'onclick="__panel.editSite()"', I.plus));
};
P.editSite = (id) => {
  const s = id ? S.sites.find(x => x.id === id) : { analytics: {}, tags: [] };
  const body = h`<div class="form-grid">
    ${raw(field('Name', input('name', s.name, 'required placeholder="My site"')))}${raw(field('URL', input('url', s.url || 'https://', 'required type="url"')))}
    ${raw(field('Category', input('category', s.category, 'placeholder="business, personal, client…" list="cats"')))}${raw(field('Tags (comma separated)', input('tags', (s.tags || []).join(', '))))}
    ${raw(field('Hosting provider', input('host', s.host, 'placeholder="Vercel, Hetzner…"')))}${raw(field('Registrar', input('registrar', s.registrar)))}
    ${raw(field('Stack', input('stack', s.stack, 'placeholder="Next.js, WordPress…"')))}${raw(field('Repository URL', input('repo', s.repo)))}
    ${raw(field('Analytics provider', select('analytics_provider', [['none', 'None / built-in only'], ['plausible', 'Plausible'], ['ga4', 'Google Analytics 4'], ['umami', 'Umami'], ['matomo', 'Matomo'], ['fathom', 'Fathom'], ['cloudflare', 'Cloudflare Web Analytics'], ['other', 'Other']], s.analytics?.provider || 'none')))}${raw(field('Analytics dashboard link', input('analytics_url', s.analytics?.url, 'placeholder="https://dash.cloudflare.com/…/web-analytics/…"')))}
    ${raw(field('Where are the credentials? (never store secrets here)', input('credentialsNote', s.credentialsNote, 'placeholder="1Password vault → Sites"'), true))}
    ${raw(field('Notes', h`<textarea class="input" name="notes">${s.notes || ''}</textarea>`, true))}
    </div>
    <datalist id="cats">${['business', 'personal', 'client', 'project', 'landing', 'internal'].map(c => h`<option value="${c}">`)}</datalist>`;
  modal(id ? 'Edit website' : 'Add website', body, {
    extraFoot: id ? btn('Delete', 'danger', `type="button" onclick="__panel.deleteSite('${id}')"`) : '',
    onSubmit: async (d) => {
      const payload = { ...d, tags: d.tags.split(',').map(t => t.trim()).filter(Boolean), analytics: { provider: d.analytics_provider, url: d.analytics_url } };
      await api(id ? `/sites/${id}` : '/sites', { method: id ? 'PUT' : 'POST', body: payload });
      toast(id ? 'Website updated' : 'Website added. First audit is running.'); route();
    } });
};
P.deleteSite = async (id) => { if (!await confirmDialog('Delete this website and its audit history? Subscriptions linked to it are kept.')) return; await api(`/sites/${id}`, { method: 'DELETE' }); toast('Website deleted'); location.hash = '#sites'; };

async function siteDetail(id) {
  const site = S.sites.find(s => s.id === id); if (!site) { location.hash = '#sites'; return; }
  const [a, checks] = await Promise.all([api(`/sites/${id}/audit`), api(`/sites/${id}/checks?limit=200`)]);
  const subs = S.subs.filter(s => (s.siteIds || []).includes(id));
  const tasks = S.tasks.filter(t => t.siteId === id);
  const upPct = checks.length ? Math.round(1000 * checks.filter(c => c.up).length / checks.length) / 10 : null;
  const yes = (v) => v ? raw('<span class="ok">✓ yes</span>') : raw('<span class="bad">✗ no</span>');
  const content = h`<div class="stack">
    <div class="tiles">
      <div class="tile"><div class="label">Health score</div><div class="value" style="color:var(--${a ? { good: 'good', warn: 'warn', critical: 'critical' }[scoreSev(a.score)] : 'text-3'})">${a ? a.score + '/100' : '—'}</div><div class="sub">${a ? `${a.issues.length} issue${a.issues.length === 1 ? '' : 's'} · audited ${ago(a.t)}` : 'Not audited yet'}</div></div>
      <div class="tile"><div class="label">Uptime (last ${checks.length} checks)</div><div class="value num">${upPct == null ? '—' : upPct + '%'}</div><div class="sub">${a ? `Last response ${a.http.ms} ms · HTTP ${a.http.status}` : ''}</div></div>
      <div class="tile"><div class="label">TLS certificate</div><div class="value num" style="color:var(--${a?.ssl ? { good: 'good', warn: 'warn', critical: 'critical' }[sevOf(a.ssl.daysLeft, 7, 21)] || 'text' : 'text-3'})">${a?.ssl?.daysLeft != null ? a.ssl.daysLeft + 'd' : '—'}</div><div class="sub">${a?.ssl ? (a.ssl.ok ? `${a.ssl.issuer || ''} · until ${fmtDate(a.ssl.validTo)}` : a.ssl.error) : 'no TLS'}</div></div>
      <div class="tile"><div class="label">Domain expiry</div><div class="value num" style="color:var(--${a?.domain?.daysLeft != null ? { good: 'good', warn: 'warn', critical: 'critical' }[sevOf(a.domain.daysLeft, 14, 45)] : 'text-3'})">${a?.domain?.daysLeft != null ? a.domain.daysLeft + 'd' : '—'}</div><div class="sub">${a?.domain?.expires ? `${a.domain.registrar || ''} · ${fmtDate(a.domain.expires)}` : (a?.domain?.error || 'unknown')}</div></div>
      <div class="tile"><div class="label">Cost</div><div class="value num">${money(subs.reduce((x, s) => x + s.monthlyCost / Math.max(1, s.siteIds.length), 0))}<span class="muted" style="font-size:13px;font-weight:500">/mo</span></div><div class="sub">${subs.length} subscription${subs.length === 1 ? '' : 's'}</div></div>
    </div>
    <div class="grid g23">
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Audit findings</h2>${btn('Re-run audit', 'sm', 'id="reaudit"', I.refresh)}</div>
          ${a ? (a.issues.length ? h`<ul class="issues">${a.issues.map(i => h`<li><span class="badge ${i.sev === 'critical' ? 'critical' : i.sev === 'warn' ? 'warn' : ''}">${i.sev}</span><span>${i.msg}</span></li>`)}</ul>` : raw('<div class="empty">No issues found. Nice.</div>')) : raw('<div class="empty">No audit yet. Click “Re-run audit”.</div>')}</div>
        <div class="card"><h2>Response time (ms)</h2>${raw(lineChart([{ name: 'ms', values: checks.slice(-60).map(c => ({ x: new Date(c.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), y: c.up ? c.ms : 0 })) }], { height: 160 }))}
          <div class="checks-list" style="margin-top:10px">${checks.slice(-6).reverse().map(c => h`<div class="checkrow"><span class="dot ${c.up ? 'good' : 'critical'}"></span><span class="num" style="width:60px">${c.ms} ms</span><span class="muted">HTTP ${c.status || '—'}${c.error ? ' · ' + c.error : ''}</span><span class="dim small" style="margin-left:auto">${ago(c.t)}</span></div>`)}</div></div>
        <div class="card"><div class="card-head"><h2>Analytics</h2>${site.analytics?.url ? h`<a class="btn sm" target="_blank" rel="noopener" href="${site.analytics.url}">${raw(I.ext)} Open ${cap(site.analytics.provider)}</a>` : btn('Link a provider', 'sm', `onclick="__panel.editSite('${id}')"`)}</div>
          <p class="small muted" style="margin:0">${site.analytics?.url ? `Traffic for this site is tracked in ${cap(site.analytics.provider)}. The button opens its dashboard.` : 'No analytics provider linked yet. Edit the site and paste the dashboard URL of Cloudflare Web Analytics, Plausible, GA4, Umami or similar so it is one click away from here.'}</p></div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Details</h2>${btn('Edit', 'sm', `onclick="__panel.editSite('${id}')"`)}</div>
          <dl class="kv-list"><dt>URL</dt><dd><a href="${site.url}" target="_blank" rel="noopener">${site.url}</a></dd><dt>Category</dt><dd>${site.category || '—'}</dd><dt>Host</dt><dd>${site.host || '—'}</dd><dt>Registrar</dt><dd>${site.registrar || a?.domain?.registrar || '—'}</dd><dt>Stack</dt><dd>${site.stack || a?.seo?.generator || '—'}</dd><dt>Repository</dt><dd>${site.repo ? h`<a href="${site.repo}" target="_blank" rel="noopener">${site.repo.replace(/^https?:\/\//, '')}</a>` : '—'}</dd><dt>Tags</dt><dd>${(site.tags || []).map(t => h`<span class="tag">${t}</span>`)}</dd><dt>Credentials</dt><dd>${site.credentialsNote || '—'}</dd><dt>Notes</dt><dd class="wrap" style="white-space:pre-wrap">${site.notes || '—'}</dd></dl></div>
        ${a ? h`<div class="card"><h2>Technical audit</h2>
          <h3 style="margin:6px 0">HTTP</h3><dl class="kv-list"><dt>Status</dt><dd>${a.http.status || a.http.error}</dd><dt>Final URL</dt><dd class="wrap">${a.http.finalUrl || '—'}</dd><dt>Server</dt><dd>${a.headers?.server || '—'}${a.headers?.poweredBy ? ` · ${a.headers.poweredBy}` : ''}</dd><dt>Compression</dt><dd>${a.headers?.contentEncoding || 'none'}</dd><dt>Page size</dt><dd>${a.seo?.sizeKB ?? '—'} KB</dd></dl>
          <h3 style="margin:12px 0 6px">Security headers</h3><dl class="kv-list"><dt>HSTS</dt><dd>${yes(a.headers?.hsts)}</dd><dt>CSP</dt><dd>${yes(a.headers?.csp)}</dd><dt>X-Frame-Options</dt><dd>${yes(a.headers?.xFrameOptions)}</dd><dt>nosniff</dt><dd>${yes(a.headers?.xContentTypeOptions)}</dd><dt>Referrer-Policy</dt><dd>${yes(a.headers?.referrerPolicy)}</dd><dt>Permissions-Policy</dt><dd>${yes(a.headers?.permissionsPolicy)}</dd></dl>
          <h3 style="margin:12px 0 6px">SEO basics</h3><dl class="kv-list"><dt>Title</dt><dd class="wrap">${a.seo?.title || '—'} <span class="dim small">(${a.seo?.titleLength || 0})</span></dd><dt>Description</dt><dd class="wrap">${a.seo?.description || '—'} <span class="dim small">(${a.seo?.descriptionLength || 0})</span></dd><dt>Canonical</dt><dd class="wrap">${a.seo?.canonical || '—'}</dd><dt>H1 count</dt><dd>${a.seo?.h1Count ?? '—'}</dd><dt>Images w/o alt</dt><dd>${a.seo?.imagesMissingAlt ?? '—'} of ${a.seo?.imageCount ?? '—'}</dd><dt>Viewport</dt><dd>${yes(a.seo?.viewport)}</dd><dt>Lang</dt><dd>${a.seo?.lang || '—'}</dd><dt>robots.txt</dt><dd>${yes(a.robotsTxt)}</dd><dt>sitemap.xml</dt><dd>${yes(a.sitemap)}</dd></dl>
          <h3 style="margin:12px 0 6px">DNS</h3><dl class="kv-list"><dt>A</dt><dd class="wrap mono">${(a.dns?.a || []).join(', ') || '—'}</dd><dt>AAAA</dt><dd class="wrap mono">${(a.dns?.aaaa || []).join(', ') || '—'}</dd><dt>CNAME</dt><dd class="mono">${a.dns?.cname || '—'}</dd><dt>MX</dt><dd class="wrap mono">${(a.dns?.mx || []).join(', ') || '—'}</dd><dt>NS</dt><dd class="wrap mono">${(a.dns?.ns || []).join(', ') || '—'}</dd><dt>SPF</dt><dd class="wrap mono">${(a.dns?.txt || []).join(' ') || '—'}</dd></dl>
          ${a.domain && !a.domain.error ? h`<h3 style="margin:12px 0 6px">Domain (RDAP)</h3><dl class="kv-list"><dt>Domain</dt><dd>${a.domain.domain}</dd><dt>Registrar</dt><dd>${a.domain.registrar || '—'}</dd><dt>Created</dt><dd>${fmtDate(a.domain.created)}</dd><dt>Expires</dt><dd>${fmtDate(a.domain.expires)}</dd><dt>Status</dt><dd class="wrap small">${(a.domain.status || []).join(', ')}</dd></dl>` : ''}
          <p class="small dim" style="margin:12px 0 0">Audit took ${Math.round((a.durationMs || 0) / 100) / 10}s.</p></div>` : ''}
        <div class="card"><div class="card-head"><h2>Subscriptions</h2>${btn('Add', 'sm', `onclick="__panel.editSub(null,'${id}')"`, I.plus)}</div>
          ${subs.length ? h`<table><tbody>${subs.map(s => h`<tr class="clickable" onclick="location.hash='#subscriptions/${s.id}'"><td class="wrap"><div class="name">${s.name} ${s.status !== 'active' ? h`<span class="badge ${s.status === 'trial' ? 'warn' : ''}">${s.status}</span>` : ''}</div><div class="small dim">${s.vendor} · ${s.cycle}${s.next ? ` · renews ${fmtDate(s.next)}` : ''}</div></td><td class="right num">${money(s.amount, s.currency)}</td></tr>`)}</tbody></table>` : raw('<div class="empty">No subscriptions linked.</div>')}</div>
        <div class="card tasks"><div class="card-head"><h2>Tasks</h2></div>${raw(taskList(tasks, id))}</div>
      </div></div></div>`;
  shell(content, site.name, h`<a class="btn" href="${site.url}" target="_blank" rel="noopener">${raw(I.ext)} Open site</a>${btn('Edit', '', `onclick="__panel.editSite('${id}')"`)}`);
  $('#reaudit').onclick = (e) => P.runMonitor(e.target, id);
  bindTasks(id);
}

// --------------------------------------------------------- subscriptions ----
let subFilter = { site: '', category: '', status: 'live', q: '' };
routes.subscriptions = async (id) => {
  if (id && S.subs.find(s => s.id === id) && !$('#modal-root').innerHTML) { P.editSub(id); }
  const live = (s) => !['cancelled', 'expired'].includes(s.status);
  let rows = S.subs.filter(s => (!subFilter.site || (s.siteIds || []).includes(subFilter.site)) && (!subFilter.category || s.category === subFilter.category) && (subFilter.status === 'all' || (subFilter.status === 'live' ? live(s) : s.status === subFilter.status)) && (!subFilter.q || `${s.name} ${s.vendor} ${s.notes}`.toLowerCase().includes(subFilter.q.toLowerCase())));
  rows.sort((a, b) => (a.next || '9999').localeCompare(b.next || '9999'));
  const total = rows.reduce((a, s) => a + s.monthlyCost, 0);
  const content = h`<div class="stack">
    <div class="tiles"><div class="tile"><div class="label">Filtered monthly total</div><div class="value num">${money(total)}</div><div class="sub">${money(total * 12)} / year · ${rows.length} shown</div></div>
      <div class="tile"><div class="label">All active</div><div class="value num">${money(S.summary.totals.monthly)}</div><div class="sub">${S.summary.totals.activeSubs} subscriptions</div></div>
      <div class="tile"><div class="label">Not auto-renewing</div><div class="value num">${S.subs.filter(s => live(s) && s.autoRenew === false && s.cycle !== 'one-time').length}</div><div class="sub">need manual renewal</div></div>
      <div class="tile"><div class="label">Trials / ending</div><div class="value num">${S.subs.filter(s => live(s) && (s.status === 'trial' || s.endDate)).length}</div><div class="sub">with an end date</div></div></div>
    <div class="card"><div class="filters"><input class="input" id="f-q" placeholder="Search…" value="${subFilter.q}">${raw(select('site', [['', 'All websites'], ...S.sites.map(s => [s.id, s.name])], subFilter.site, 'id="f-site"'))}${raw(select('category', [['', 'All categories'], ...CATEGORIES], subFilter.category, 'id="f-cat"'))}${raw(select('status', [['live', 'Active & trials'], ['all', 'All statuses'], ...STATUSES], subFilter.status, 'id="f-status"'))}<span style="margin-left:auto" class="small dim">Click a row to edit</span></div>
      ${rows.length ? h`<div class="table-wrap"><table><thead><tr><th>Service</th><th>Category</th><th>Websites</th><th class="right">Amount</th><th>Cycle</th><th class="right">/ month</th><th>Next renewal</th><th>Ends</th><th>Status</th><th>Payment</th></tr></thead><tbody>
        ${rows.map(s => { const d = s.next ? Math.ceil((new Date(s.next) - Date.now()) / 86400000) : null; return h`<tr class="clickable" onclick="__panel.editSub('${s.id}')">
          <td><div class="name">${s.name}</div><div class="small dim">${s.vendor || ''}</div></td><td><span class="badge" style="border-color:${catColor(s.category)};color:${catColor(s.category)}">${s.category}</span></td>
          <td class="small">${(s.siteIds || []).map(siteName).join(', ') || raw('<span class="dim">shared</span>')}</td><td class="right num">${money(s.amount, s.currency)}</td><td>${s.cycle}</td><td class="right num">${s.cycle === 'one-time' ? '—' : money(s.monthlyCost)}</td>
          <td>${s.next ? h`<span class="badge ${sevOf(d)}">${daysWord(d)}</span> <span class="small dim">${fmtDate(s.next)}</span>` : '—'}${s.autoRenew === false && s.cycle !== 'one-time' && live(s) ? raw('<div class="small" style="color:var(--warn)">manual renew</div>') : ''}</td>
          <td class="small">${s.endDate ? fmtDate(s.endDate) : '—'}</td><td><span class="badge ${s.status === 'active' ? 'good' : s.status === 'trial' ? 'warn' : ''}">${s.status}</span></td><td class="small">${s.paymentMethod || '—'}</td></tr>`; })}</tbody></table></div>` : raw('<div class="empty">No subscriptions match.</div>')}</div></div>`;
  shell(content, 'Subscriptions & expenses', h`${btn('Export JSON', '', 'onclick="__panel.exportJson()"')}${btn('Add subscription', 'primary', 'onclick="__panel.editSub()"', I.plus)}`);
  const upd = () => { subFilter = { q: $('#f-q').value, site: $('#f-site').value, category: $('#f-cat').value, status: $('#f-status').value }; routes.subscriptions(); };
  $('#f-q').oninput = upd; for (const k of ['#f-site', '#f-cat', '#f-status']) $(k).onchange = upd;
  if (subFilter.q) { const el = $('#f-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
};
P.editSub = (id, presetSite) => {
  const s = id ? S.subs.find(x => x.id === id) : { siteIds: presetSite ? [presetSite] : [], cycle: 'monthly', status: 'active', autoRenew: true, currency: S.settings.currency, startDate: new Date().toISOString().slice(0, 10) };
  if (!s) return;
  const body = h`<div class="form-grid">
    ${raw(field('Service name', input('name', s.name, 'required placeholder="Vercel Pro"')))}${raw(field('Vendor', input('vendor', s.vendor, 'placeholder="Vercel"')))}
    ${raw(field('Category', select('category', CATEGORIES, s.category || 'hosting')))}${raw(field('Status', select('status', STATUSES, s.status)))}
    ${raw(field('Amount', input('amount', s.amount ?? '', 'type="number" step="0.01" min="0" required')))}${raw(field('Currency', input('currency', s.currency || S.settings.currency, 'maxlength="3" style="text-transform:uppercase"')))}
    ${raw(field('Billing cycle', select('cycle', CYCLES, s.cycle)))}${raw(field('Payment method', input('paymentMethod', s.paymentMethod, 'placeholder="Visa •• 4242"')))}
    ${raw(field('Start date', input('startDate', s.startDate, 'type="date"')))}${raw(field('Next renewal (anchor date)', input('nextRenewal', s.nextRenewal, 'type="date"')))}
    ${raw(field('End / cancellation date', input('endDate', s.endDate, 'type="date"')))}${raw(field('Billing page URL', input('url', s.url, 'placeholder="https://…/billing"')))}
    <div class="field full"><label>Linked websites</label><div style="display:flex;gap:10px;flex-wrap:wrap">${S.sites.map(w => h`<label class="check"><input type="checkbox" name="siteIds" data-multi="1" value="${w.id}" ${(s.siteIds || []).includes(w.id) ? raw('checked') : ''}> ${w.name}</label>`)}${!S.sites.length ? raw('<span class="dim small">No websites yet</span>') : ''}</div></div>
    ${raw(field('Notes', h`<textarea class="input" name="notes">${s.notes || ''}</textarea>`, true))}
    <label class="check full"><input type="checkbox" name="autoRenew" ${s.autoRenew !== false ? raw('checked') : ''}> Auto-renews (uncheck to get a manual-renewal warning)</label></div>`;
  modal(id ? 'Edit subscription' : 'Add subscription', body, {
    extraFoot: id ? btn('Delete', 'danger', `type="button" onclick="__panel.deleteSub('${id}')"`) : '',
    onSubmit: async (d) => { await api(id ? `/subscriptions/${id}` : '/subscriptions', { method: id ? 'PUT' : 'POST', body: d }); toast('Saved'); if (location.hash.startsWith('#subscriptions/')) location.hash = '#subscriptions'; else route(); } });
  if (id && !location.hash.startsWith('#subscriptions/')) { /* opened from elsewhere */ }
  $('#modal-root .modal-bg').addEventListener('click', (e) => { if ((e.target.classList.contains('modal-bg') || e.target.closest('[data-close]')) && location.hash.startsWith('#subscriptions/')) location.hash = '#subscriptions'; });
};
P.deleteSub = async (id) => { if (!await confirmDialog('Delete this subscription?')) return; await api(`/subscriptions/${id}`, { method: 'DELETE' }); toast('Deleted'); if (location.hash.startsWith('#subscriptions/')) location.hash = '#subscriptions'; else route(); };

// -------------------------------------------------------------- calendar ----
routes.calendar = async () => {
  const from = new Date(); from.setDate(1); const to = new Date(from); to.setMonth(to.getMonth() + 6);
  const items = await api(`/calendar?from=${from.toISOString()}&to=${to.toISOString()}`);
  const byMonth = {};
  for (const it of items) { const m = it.date.slice(0, 7); (byMonth[m] = byMonth[m] || []).push(it); }
  const today = new Date().toISOString().slice(0, 10);
  const content = h`<div class="grid g23"><div class="card"><h2>Next 6 months of charges</h2>
    ${Object.keys(byMonth).length ? Object.entries(byMonth).map(([m, list]) => { const days = {}; for (const it of list) (days[it.date] = days[it.date] || []).push(it); return h`<div class="cal-month"><h3><span>${new Date(m + '-15').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span><span class="num">${money(list.reduce((a, i) => a + i.amount, 0))}</span></h3>
      ${Object.entries(days).map(([d, its]) => h`<div class="cal-day"><div><div style="font-weight:600">${new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</div>${d < today ? raw('<span class="small dim">paid</span>') : d === today ? raw('<span class="badge warn">today</span>') : ''}</div><div class="items">${its.map(i => h`<div><a href="#subscriptions/${i.id}">${i.name}</a> <span class="small dim">${i.vendor} · ${i.category}${i.autoRenew === false && i.status !== 'cancelled' ? raw(' · <span style="color:var(--warn)">manual</span>') : ''}</span></div>`)}</div><div class="num right">${its.map(i => h`<div>${money(i.amount, i.currency)}</div>`)}</div></div>`)}</div>`; }) : raw('<div class="empty">No charges in this window.</div>')}</div>
    <div class="stack"><div class="card"><h2>Monthly totals</h2>${raw(stackedBars(S.summary.months.map(m => ({ label: monthLabel(m.month), parts: m.byCategory, future: m.future })), Object.keys(S.summary.byCategory).concat(CATEGORIES).filter((c, i, a) => a.indexOf(c) === i), { fmt: (v) => money(v), height: 200 }))}</div>
    <div class="card"><h2>Renewal rules</h2><p class="small muted" style="margin:0 0 6px">Warnings fire ${S.settings.renewalWarnDays} days before a renewal or end date. Subscriptions with auto-renew off are flagged so you can renew manually. Cancelled items stop projecting once past their end date.</p><a class="small" href="#settings">Change warning window →</a></div></div></div>`;
  shell(content, 'Renewal calendar', btn('Add subscription', 'primary', 'onclick="__panel.editSub()"', I.plus));
};

// ---------------------------------------------------------------- audits ----
routes.audits = async () => {
  const rows = S.summary.sites.slice().sort((a, b) => (a.audit?.score ?? 101) - (b.audit?.score ?? 101));
  const scored = rows.filter(r => r.audit);
  const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.audit.score, 0) / scored.length) : null;
  const content = h`<div class="stack">
    <div class="tiles"><div class="tile"><div class="label">Average health</div><div class="value num">${avg == null ? '—' : avg + '/100'}</div><div class="sub">${scored.length} of ${rows.length} audited</div></div>
      <div class="tile ${rows.some(r => r.audit && !r.audit.up) ? 'critical' : 'good'}"><div class="label">Down</div><div class="value num">${rows.filter(r => r.audit && !r.audit.up).length}</div><div class="sub">unreachable sites</div></div>
      <div class="tile"><div class="label">TLS expiring ≤ 21d</div><div class="value num">${rows.filter(r => r.audit?.sslDays != null && r.audit.sslDays <= 21).length}</div><div class="sub">certificates</div></div>
      <div class="tile"><div class="label">Domains expiring ≤ 45d</div><div class="value num">${rows.filter(r => r.audit?.domainDays != null && r.audit.domainDays <= 45).length}</div><div class="sub">registrations</div></div>
      <div class="tile"><div class="label">Open issues</div><div class="value num">${scored.reduce((a, r) => a + r.audit.issues, 0)}</div><div class="sub">across all audits</div></div></div>
    <div class="card"><div class="card-head"><h2>Audit results</h2><span class="small dim" id="mon-status">Uptime probes every ${S.settings.checkIntervalMin} min, full audits every ${S.settings.auditIntervalHours}h, via GitHub Actions</span></div>
      ${rows.length ? h`<div class="table-wrap"><table><thead><tr><th>Website</th><th>Score</th><th>Status</th><th>Uptime</th><th>Response</th><th>TLS</th><th>Domain</th><th>Issues</th><th>Last audit</th><th></th></tr></thead><tbody>
      ${rows.map(s => { const a = s.audit; return h`<tr class="clickable" onclick="location.hash='#sites/${s.id}'"><td><div class="name">${s.name}</div><div class="small dim">${s.url.replace(/^https?:\/\//, '')}</div></td>
        <td>${a ? h`<span class="score ${scoreSev(a.score)}" style="width:34px;height:34px;font-size:12px">${a.score}</span>` : '—'}</td>
        <td>${a ? h`<span class="badge ${a.up ? 'good' : 'critical'}">${a.up ? 'up' : 'down'} · ${a.status || 'ERR'}</span>` : raw('<span class="badge">pending</span>')}</td>
        <td class="num">${s.uptime == null ? '—' : s.uptime + '%'}</td><td class="num">${a ? a.ms + ' ms' : '—'}</td>
        <td>${a?.sslDays != null ? h`<span class="badge ${sevOf(a.sslDays, 7, 21)}">${a.sslDays}d</span>` : '—'}</td><td>${a?.domainDays != null ? h`<span class="badge ${sevOf(a.domainDays, 14, 45)}">${a.domainDays}d</span>` : '—'}</td>
        <td class="num">${a ? a.issues : '—'}</td><td class="small dim">${a ? ago(a.t) : '—'}</td>
        <td><button class="btn sm ghost" onclick="event.stopPropagation();__panel.reaudit('${s.id}',this)">Re-run</button></td></tr>`; })}</tbody></table></div>` : raw('<div class="empty">Add websites first.</div>')}</div>
    <div class="card"><h2>What the audit checks</h2><div class="grid g3 small muted"><div><b>Availability</b><br>HTTP status, redirects, response time, uptime history from periodic probes.</div><div><b>Security</b><br>TLS validity and expiry, HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, leaked X-Powered-By, mixed content.</div><div><b>SEO & hygiene</b><br>Title, meta description, canonical, viewport, H1s, alt text, lang, favicon, robots.txt, sitemap.xml, HTML weight.</div><div><b>DNS</b><br>A/AAAA/CNAME/MX/NS records and SPF.</div><div><b>Domain</b><br>Registrar, creation and expiry via RDAP.</div><div><b>Score</b><br>Starts at 100, deducts per finding weighted by severity. Below 60 raises an alert.</div></div></div></div>`;
  shell(content, 'Health & audits', btn('Run all audits', 'primary', 'id="audit-all"', I.refresh));
  $('#audit-all').onclick = (e) => P.runMonitor(e.target);
  api('/monitor/status').then(r => { if (r) $('#mon-status').innerHTML = h`Last monitor run: <a href="${r.url}" target="_blank" rel="noopener">${r.status === 'completed' ? (r.conclusion || 'done') : r.status}</a> · ${ago(r.at)}`; }).catch(() => {});
};
P.reaudit = (id, el) => P.runMonitor(el, id);
// Trigger the GitHub Actions monitor (optionally for one site) and refresh when it has run.
P.runMonitor = async (el, siteId) => {
  if (el) { el.disabled = true; el.textContent = 'Queued…'; }
  try {
    await api(siteId ? `/sites/${siteId}/audit` : '/audit/all', { method: 'POST' });
    toast('Monitor workflow queued on GitHub Actions. Results land in about 1–2 minutes; this page refreshes itself.');
    let tries = 0; const poll = async () => { tries++; try { await window.PanelApi.refreshMonitor(); } catch {} if (tries < 6 && !$('#modal-root').innerHTML) setTimeout(poll, 25000); route(); };
    setTimeout(poll, 45000);
  } catch (e) { toast(e.message, true); if (el) { el.disabled = false; el.textContent = 'Retry'; } }
};
P.exportJson = async () => { const data = await api('/export'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `admin-panel-export-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };

// ------------------------------------------------------------- analytics ----
routes.analytics = async () => {
  const rows = S.sites.map(site => ({ site, a: S.summary.sites.find(x => x.id === site.id) }));
  const content = h`<div class="stack">
    <div class="card"><h2>Analytics per website</h2><p class="small muted" style="margin:0 0 12px">There is no server in this GitHub-only setup to receive pageviews, so each site links to the analytics provider it already uses. Cloudflare Web Analytics is free and needs one script tag; Plausible, GA4, Umami, Matomo and Fathom work the same way.</p>
      ${rows.length ? h`<div class="table-wrap"><table><thead><tr><th>Website</th><th>Provider</th><th>Status</th><th>Uptime</th><th>Health</th><th></th></tr></thead><tbody>
        ${rows.map(({ site, a }) => h`<tr><td><div class="name">${site.name}</div><div class="small dim">${site.url.replace(/^https?:\/\//, '')}</div></td>
          <td>${site.analytics?.provider && site.analytics.provider !== 'none' ? h`<span class="badge accent">${cap(site.analytics.provider)}</span>` : raw('<span class="dim">none</span>')}</td>
          <td>${a?.audit ? h`<span class="badge ${a.audit.up ? 'good' : 'critical'}">${a.audit.up ? 'up' : 'down'}</span>` : '—'}</td><td class="num">${a?.uptime == null ? '—' : a.uptime + '%'}</td><td>${a?.audit ? h`<span class="badge ${scoreSev(a.audit.score)}">${a.audit.score}/100</span>` : '—'}</td>
          <td style="text-align:right">${site.analytics?.url ? h`<a class="btn sm" target="_blank" rel="noopener" href="${site.analytics.url}">${raw(I.ext)} Open dashboard</a>` : btn('Link provider', 'sm', `onclick="__panel.editSite('${site.id}')"`)}</td></tr>`)}</tbody></table></div>` : raw('<div class="empty">Add websites first.</div>')}</div>
    <div class="card"><h2>Set up Cloudflare Web Analytics (free)</h2><ol class="small muted" style="margin:0;padding-left:18px"><li>Cloudflare dashboard → Web Analytics → Add a site → pick the hostname.</li><li>Paste the beacon script it gives you before <code>&lt;/body&gt;</code> on the site (or enable automatic injection for Cloudflare Pages / proxied sites).</li><li>Copy the analytics page URL and paste it into the site's "Analytics dashboard link" here.</li></ol></div></div>`;
  shell(content, 'Analytics');
};

// ----------------------------------------------------------------- tasks ----
function taskList(tasks, siteId) {
  const sorted = tasks.slice().sort((a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999'));
  return h`<ul>${sorted.map(t => { const d = t.due ? Math.ceil((new Date(t.due) - Date.now()) / 86400000) : null; return h`<li class="${t.done ? 'done' : ''}"><input type="checkbox" data-task="${t.id}" ${t.done ? raw('checked') : ''}><span class="title">${t.title}${!siteId && t.siteId ? h` <a class="small" href="#sites/${t.siteId}">${siteName(t.siteId)}</a>` : ''}</span>${t.due ? h`<span class="badge ${t.done ? '' : sevOf(d, 0, 3)}">${t.done ? fmtDate(t.due) : daysWord(d)}</span>` : ''}<button class="btn sm ghost" data-del="${t.id}" title="Delete">✕</button></li>`; })}</ul>
    ${!sorted.length ? raw('<div class="empty" style="margin-bottom:10px">No tasks.</div>') : ''}
    <form class="inline-form" id="task-form" style="margin-top:10px"><input class="input" name="title" placeholder="New task…" required>${!siteId ? raw(select('siteId', [['', 'No website'], ...S.sites.map(s => [s.id, s.name])], '')) : ''}<input class="input" type="date" name="due" style="flex:0 0 150px">${raw(btn('Add', 'primary', 'type="submit"'))}</form>`;
}
function bindTasks(siteId) {
  document.querySelectorAll('[data-task]').forEach(cb => cb.onchange = async () => { await api(`/tasks/${cb.dataset.task}`, { method: 'PUT', body: { done: cb.checked } }); route(); });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await api(`/tasks/${b.dataset.del}`, { method: 'DELETE' }); route(); });
  const f = $('#task-form'); if (f) f.onsubmit = async (e) => { e.preventDefault(); const d = P.formData ? P.formData(f) : Object.fromEntries(new FormData(f)); await api('/tasks', { method: 'POST', body: { ...d, siteId: siteId || d.siteId || null } }); route(); };
}
routes.tasks = async () => {
  const open = S.tasks.filter(t => !t.done), done = S.tasks.filter(t => t.done);
  const content = h`<div class="grid g23"><div class="card tasks"><div class="card-head"><h2>To do</h2><span class="small dim">${open.length} open · ${done.length} done</span></div>${raw(taskList(S.tasks))}</div>
    <div class="card"><h2>Suggested from audits</h2>${(() => { const sugg = S.summary.alerts.filter(a => ['audit', 'ssl', 'domain', 'renewal'].includes(a.kind)).slice(0, 8); return sugg.length ? h`<div class="alert-list">${sugg.map(a => h`<div class="alert ${a.sev}"><span class="dot ${a.sev}"></span><div><div class="t">${a.title}</div><div class="d">${a.detail || ''}</div></div>${btn('Add task', 'sm', `onclick="__panel.quickTask(${JSON.stringify(a.title)},${JSON.stringify(a.ref?.type === 'site' ? a.ref.id : '')})"`)}</div>`)}</div>` : raw('<div class="empty">Nothing suggested right now.</div>'); })()}</div></div>`;
  shell(content, 'Tasks');
  bindTasks();
};
P.quickTask = async (title, siteId) => { await api('/tasks', { method: 'POST', body: { title, siteId: siteId || null } }); toast('Task added'); route(); };

// -------------------------------------------------------------- settings ----
routes.settings = async () => {
  const st = S.settings; const CFG = P.CFG;
  const hasDemo = S.sites.some(s => s.id.startsWith('demo-'));
  const content = h`<div class="grid g2">
    <div class="stack">
    <div class="card"><h2>General</h2><form id="f-general" class="form-grid">
      ${raw(field('Panel name', input('panelName', st.panelName)))}${raw(field('Default currency (ISO code)', input('currency', st.currency, 'maxlength="3" style="text-transform:uppercase"')))}
      ${raw(field('Renewal warning (days ahead)', input('renewalWarnDays', st.renewalWarnDays, 'type="number" min="1" max="120"')))}${raw(field('Uptime probe interval (minutes)', input('checkIntervalMin', st.checkIntervalMin, 'type="number" min="5" max="1440"')))}
      ${raw(field('Full audit interval (hours)', input('auditIntervalHours', st.auditIntervalHours, 'type="number" min="1" max="720"')))}${raw(field('Probe history to keep (per site)', input('keepChecks', st.keepChecks, 'type="number" min="50" max="5000"')))}
      <div class="full" style="display:flex;justify-content:flex-end">${raw(btn('Save settings', 'primary', 'type="submit"'))}</div></form></div>
    <div class="card"><h2>Vault & encryption</h2>
      <p class="small muted" style="margin:0 0 10px">Subscriptions, tasks and settings are stored in <span class="mono">${CFG.dir}/vault.json</span> on the <span class="mono">${CFG.branch}</span> branch. With encryption on they are AES-256 encrypted in your browser before being committed, so the repository can stay public. Sites and audit results are stored in plain JSON because the Actions monitor needs to read them.</p>
      <label class="check" style="margin-bottom:12px"><input type="checkbox" id="encrypt" ${st.encrypt !== false ? raw('checked') : ''}> Encrypt the vault <span class="dim small">(turn off only if this repository is private and you want Actions to send renewal alerts too)</span></label>
      <form id="f-pw" class="form-grid">${raw(field('New vault password (8+ chars)', input('password', '', 'type="password" minlength="8" autocomplete="new-password" required')))}${raw(field('Confirm', input('confirm', '', 'type="password" minlength="8" autocomplete="new-password" required')))}<div class="full" style="display:flex;justify-content:flex-end">${raw(btn('Change vault password', 'primary', 'type="submit"'))}</div></form></div>
    </div>
    <div class="stack">
      <div class="card"><h2>GitHub Actions monitor</h2><p class="small muted" style="margin:0 0 10px">Uptime probes, audits and alerts run in <span class="mono">.github/workflows/${CFG.workflow}</span>. Alerts are posted to a webhook if the repository secret <span class="mono">PANEL_ALERT_WEBHOOK_URL</span> is set (Slack, Discord or any JSON endpoint), and opened as GitHub issues if the repository variable <span class="mono">PANEL_ALERT_ISSUES</span> is <span class="mono">1</span>. Set both under the repository's Settings → Secrets and variables → Actions.</p>
        <div id="mon-status" class="small dim">Checking last run…</div><div style="margin-top:10px">${raw(btn('Run monitor now', '', 'id="run-now"', I.refresh))} <a class="btn" target="_blank" rel="noopener" href="https://github.com/${CFG.owner}/${CFG.repo}/actions/workflows/${CFG.workflow}">${raw(I.ext)} Open in GitHub</a></div></div>
      <div class="card"><h2>This device</h2><p class="small muted" style="margin:0 0 10px">The GitHub token ${P.store.get('map_token') ? 'is remembered in this browser' : 'is kept for this tab only'}. The vault password is never stored; it is kept in memory until you lock the panel or close the tab.</p><div style="display:flex;gap:8px;flex-wrap:wrap">${raw(btn('Forget token on this device', 'danger', 'id="forget"'))}</div></div>
      <div class="card"><h2>Data</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${raw(btn('Export everything (JSON)', '', 'onclick="__panel.exportJson()"'))}<label class="btn">Import JSON<input type="file" id="import" accept="application/json" hidden></label>${hasDemo ? raw(btn('Remove demo data', 'danger', 'id="rm-demo"')) : raw(btn('Load demo data', '', 'id="add-demo"'))}</div>
        <p class="small dim" style="margin:10px 0 0">Every change is a commit on the <span class="mono">${CFG.branch}</span> branch, so the history of your data is <a target="_blank" rel="noopener" href="https://github.com/${CFG.owner}/${CFG.repo}/commits/${CFG.branch}">in git</a>. Import adds records that don't exist yet and never overwrites.</p></div>
    </div></div>`;
  shell(content, 'Settings');
  $('#f-general').onsubmit = async (e) => { e.preventDefault(); try { await api('/settings', { method: 'PUT', body: P.formData($('#f-general')) }); toast('Settings saved'); route(); } catch (err) { toast(err.message, true); } };
  $('#encrypt').onchange = async (e) => { try { if (!e.target.checked && !await confirmDialog('Store subscriptions, tasks and settings as plain JSON in the repository? Anyone who can read the repo will see them.')) { e.target.checked = true; return; } await api('/settings', { method: 'PUT', body: { encrypt: e.target.checked } }); toast(e.target.checked ? 'Vault encrypted' : 'Vault stored as plain JSON'); } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; } };
  $('#f-pw').onsubmit = async (e) => { e.preventDefault(); const d = P.formData($('#f-pw')); if (d.password !== d.confirm) return toast('Passwords do not match', true); try { await api('/vault/password', { method: 'POST', body: { password: d.password } }); try { sessionStorage.setItem('map_pass', d.password); } catch {} toast('Vault password changed'); $('#f-pw').reset(); } catch (err) { toast(err.message, true); } };
  $('#run-now').onclick = (e) => P.runMonitor(e.target);
  $('#forget').onclick = () => { P.forget(true); location.hash = ''; location.reload(); };
  $('#import').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const body = JSON.parse(await f.text()); const r = await api('/import', { method: 'POST', body }); toast(`Imported ${r.imported} records`); route(); } catch (err) { toast('Import failed: ' + err.message, true); } };
  if ($('#rm-demo')) $('#rm-demo').onclick = async () => { if (!await confirmDialog('Remove all demo sites, subscriptions and tasks?')) return; await api('/demo', { method: 'DELETE' }); toast('Demo data removed'); route(); };
  if ($('#add-demo')) $('#add-demo').onclick = async () => { await api('/demo', { method: 'POST' }); toast('Demo data added and a monitor run queued'); route(); };
  api('/monitor/status').then(r => { $('#mon-status').innerHTML = r ? h`Last run: <a href="${r.url}" target="_blank" rel="noopener">${r.status === 'completed' ? (r.conclusion || 'done') : r.status}</a> · ${ago(r.at)}` : 'The monitor has not run yet. Merge the workflow to main, then press “Run monitor now”.'; }).catch(e => { $('#mon-status').textContent = 'Could not read workflow runs: ' + e.message; });
};

P.boot();
})();
