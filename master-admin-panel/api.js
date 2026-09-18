/* Local API: the same routes the views used against the Node server, now
   computed in the browser from JSON files on the GitHub data branch.
   sites.json is plain (the Actions monitor needs it); vault.json holds
   subscriptions, tasks and settings and is AES-encrypted unless disabled. */
(() => {
'use strict';
const money = window.PanelMoney, { buildAlerts } = window.PanelAlerts;
const CFG = window.PANEL_CONFIG;
const DEFAULT_SETTINGS = { currency: 'USD', renewalWarnDays: 14, checkIntervalMin: 10, auditIntervalHours: 12, panelName: 'Master Admin', encrypt: true, keepChecks: 1000 };
const st = { gh: null, pass: null, sitesDoc: { config: {}, sites: [] }, vault: { subscriptions: [], tasks: [], settings: {} }, audits: {}, checks: {}, vaultEncrypted: true, loaded: false };
const P = () => `${CFG.dir}/`;
const uid = () => crypto.getRandomValues(new Uint32Array(2)).reduce((a, n) => a + n.toString(16).padStart(8, '0'), '');
const clean = (s, max = 500) => typeof s === 'string' ? s.trim().slice(0, max) : '';
const validUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; } };
const settings = () => ({ ...DEFAULT_SETTINGS, ...st.vault.settings });
const bad = (msg) => { const e = new Error(msg); e.status = 400; throw e; };

// ------------------------------------------------------------ persistence --
async function load(gh, pass) {
  st.gh = gh; st.pass = pass;
  if (!await gh.branchExists()) await gh.createBranch();
  const [sitesDoc, vault, audits, checks] = await Promise.all([gh.readJson(P() + 'sites.json'), gh.readJson(P() + 'vault.json'), gh.readJson(P() + 'audits.json'), gh.readJson(P() + 'checks.json')]);
  st.sitesDoc = sitesDoc || { config: {}, sites: [] };
  st.audits = audits || {}; st.checks = checks || {};
  if (!vault) { st.vault = { subscriptions: [], tasks: [], settings: {} }; st.vaultEncrypted = true; st.loaded = true; return { fresh: true }; }
  if (vault.enc) { if (!pass) return { needsPassword: true }; st.vault = await window.PanelCrypto.decryptJson(vault, pass); st.vaultEncrypted = true; }
  else { st.vault = { subscriptions: [], tasks: [], settings: {}, ...vault, enc: undefined }; st.vaultEncrypted = false; }
  st.loaded = true; return { ok: true };
}
async function refreshMonitor() {
  const [audits, checks] = await Promise.all([st.gh.readJson(P() + 'audits.json'), st.gh.readJson(P() + 'checks.json')]);
  st.audits = audits || {}; st.checks = checks || {};
}
async function saveSites(msg) {
  const cfg = settings();
  st.sitesDoc.config = { checkIntervalMin: cfg.checkIntervalMin, auditIntervalHours: cfg.auditIntervalHours, renewalWarnDays: cfg.renewalWarnDays, keepChecks: cfg.keepChecks };
  await st.gh.writeJson(P() + 'sites.json', st.sitesDoc, msg || 'panel: update sites');
}
async function saveVault(msg) {
  const plain = { subscriptions: st.vault.subscriptions, tasks: st.vault.tasks, settings: st.vault.settings };
  const encrypt = settings().encrypt !== false;
  if (encrypt && !st.pass) bad('A vault password is required to save encrypted data');
  const doc = encrypt ? await window.PanelCrypto.encryptJson(plain, st.pass) : { v: 1, enc: false, ...plain };
  st.vaultEncrypted = encrypt;
  await st.gh.writeJson(P() + 'vault.json', doc, msg || 'panel: update vault');
}

// -------------------------------------------------------------- sanitise --
function sanitizeSite(b, existing = {}) {
  const url = validUrl(b.url ?? existing.url); if (!url) bad('A valid http(s) URL is required');
  return { name: clean(b.name ?? existing.name, 120) || new URL(url).hostname, url, category: clean(b.category ?? existing.category, 60), host: clean(b.host ?? existing.host, 120), registrar: clean(b.registrar ?? existing.registrar, 120), stack: clean(b.stack ?? existing.stack, 120), repo: clean(b.repo ?? existing.repo, 300), notes: clean(b.notes ?? existing.notes, 5000),
    tags: Array.isArray(b.tags) ? b.tags.map(t => clean(t, 30)).filter(Boolean).slice(0, 20) : (existing.tags || []),
    analytics: { provider: clean(b.analytics?.provider ?? existing.analytics?.provider, 30) || 'none', url: clean(b.analytics?.url ?? existing.analytics?.url, 500) }, credentialsNote: clean(b.credentialsNote ?? existing.credentialsNote, 500) };
}
function sanitizeSub(b, existing = {}) {
  const amount = Number(b.amount ?? existing.amount); if (!Number.isFinite(amount) || amount < 0) bad('Amount must be a non-negative number');
  const cycle = clean(b.cycle ?? existing.cycle, 20) || 'monthly'; if (!(cycle in money.CYCLE_MONTHS)) bad('Invalid billing cycle');
  const date = (v) => { if (v === '' || v === null) return null; if (v === undefined) return undefined; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };
  return { name: clean(b.name ?? existing.name, 120) || 'Untitled', vendor: clean(b.vendor ?? existing.vendor, 120), category: clean(b.category ?? existing.category, 40) || 'other',
    siteIds: Array.isArray(b.siteIds) ? b.siteIds.map(s => clean(s, 40)).filter(Boolean) : (existing.siteIds || []), amount, currency: (clean(b.currency ?? existing.currency, 3) || settings().currency).toUpperCase(), cycle,
    startDate: date(b.startDate) ?? existing.startDate ?? null, nextRenewal: date(b.nextRenewal) ?? existing.nextRenewal ?? null, endDate: date(b.endDate) ?? existing.endDate ?? null,
    autoRenew: b.autoRenew ?? existing.autoRenew ?? true, paymentMethod: clean(b.paymentMethod ?? existing.paymentMethod, 80), status: clean(b.status ?? existing.status, 20) || 'active', url: clean(b.url ?? existing.url, 500), notes: clean(b.notes ?? existing.notes, 5000) };
}
const stamp = (o) => { const now = new Date().toISOString(); return { id: uid(), createdAt: now, updatedAt: now, ...o }; };
function upd(list, id, patch) { const i = list.findIndex(x => x.id === id); if (i < 0) return null; list[i] = { ...list[i], ...patch, id, updatedAt: new Date().toISOString() }; return list[i]; }

// --------------------------------------------------------------- summary --
const state = () => ({ sites: st.sitesDoc.sites, subscriptions: st.vault.subscriptions, tasks: st.vault.tasks, audits: st.audits, checks: st.checks });
function summary() {
  const s = state(); const cfg = settings(); const now = new Date();
  const active = s.subscriptions.filter(x => !['cancelled', 'expired'].includes(x.status));
  const monthly = active.reduce((a, x) => a + money.monthlyCost(x), 0);
  const byCategory = {}, bySite = {};
  for (const x of active) { const c = x.category || 'other'; byCategory[c] = (byCategory[c] || 0) + money.monthlyCost(x); const ids = x.siteIds?.length ? x.siteIds : ['__shared']; for (const id of ids) bySite[id] = (bySite[id] || 0) + money.monthlyCost(x) / ids.length; }
  const upcoming = s.subscriptions.map(x => ({ ...x, next: money.nextRenewal(x, now) })).filter(x => x.next).map(x => ({ id: x.id, name: x.name, vendor: x.vendor, amount: x.amount, currency: x.currency, cycle: x.cycle, autoRenew: x.autoRenew, status: x.status, date: x.next.toISOString().slice(0, 10), days: money.daysUntil(x.next, now), siteIds: x.siteIds })).sort((a, b) => a.days - b.days);
  const months = [];
  for (let i = -5; i <= 6; i++) { const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)), to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1)); const cats = {}; let total = 0; for (const x of s.subscriptions) for (const c of money.chargesBetween(x, from, to)) { cats[x.category || 'other'] = (cats[x.category || 'other'] || 0) + c.amount; total += c.amount; } months.push({ month: from.toISOString().slice(0, 7), total, byCategory: cats, future: i > 0 }); }
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const spentYtd = s.subscriptions.reduce((a, x) => a + money.chargesBetween(x, yearStart, now).reduce((y, c) => y + c.amount, 0), 0);
  const sites = s.sites.map(site => { const a = s.audits[site.id]; const hist = s.checks[site.id] || []; const upCount = hist.filter(c => c.up).length;
    return { ...site, audit: a ? { t: a.t, score: a.score, up: a.http.ok, status: a.http.status, ms: a.http.ms, sslDays: a.ssl?.daysLeft ?? null, domainDays: a.domain?.daysLeft ?? null, issues: a.issues?.length || 0 } : null, uptime: hist.length ? Math.round(1000 * upCount / hist.length) / 10 : null, lastCheck: hist[hist.length - 1] || null, monthlyCost: bySite[site.id] || 0, sparkline: hist.slice(-40).map(c => c.up ? c.ms : -1) }; });
  return { now: now.toISOString(), settings: cfg, totals: { monthly, yearly: monthly * 12, spentYtd, activeSubs: active.length, sites: s.sites.length, sitesUp: sites.filter(x => x.audit ? x.audit.up : x.lastCheck?.up).length, sitesDown: sites.filter(x => (x.audit && !x.audit.up) || (x.lastCheck && !x.lastCheck.up)).length, openTasks: s.tasks.filter(t => !t.done).length }, byCategory, bySite, upcoming, months, sites, alerts: buildAlerts(s, cfg, now), tasks: s.tasks, vaultEncrypted: st.vaultEncrypted };
}

// ------------------------------------------------------------------ routes --
async function api(path, opts = {}) {
  const [p, qs] = path.split('?'); const q = new URLSearchParams(qs || '');
  const [root, id, sub] = p.replace(/^\//, '').split('/'); const m = (opts.method || 'GET').toUpperCase(); const body = opts.body || {};
  const V = st.vault, sites = st.sitesDoc.sites;
  if (root === 'summary') return summary();
  if (root === 'settings') {
    if (m === 'GET') return settings();
    const next = { ...V.settings }; for (const k of ['currency', 'panelName']) if (k in body) next[k] = clean(body[k], 40);
    for (const k of ['renewalWarnDays', 'checkIntervalMin', 'auditIntervalHours', 'keepChecks']) if (k in body) next[k] = Math.max(1, Number(body[k]) || settings()[k]);
    if ('encrypt' in body) next.encrypt = !!body.encrypt;
    V.settings = next; await saveVault('panel: update settings'); await saveSites('panel: update monitor config'); return settings();
  }
  if (root === 'sites') {
    if (!id && m === 'GET') return sites;
    if (!id && m === 'POST') { const site = stamp(sanitizeSite(body)); sites.push(site); await saveSites(`panel: add site ${site.name}`); dispatch({ site: site.id }).catch(() => {}); return site; }
    const site = sites.find(x => x.id === id); if (!site) bad('Site not found');
    if (sub === 'audit' && m === 'POST') { await dispatch({ site: id }); return { queued: true }; }
    if (sub === 'audit') return st.audits[id] || null;
    if (sub === 'checks') return (st.checks[id] || []).slice(-Number(q.get('limit') || 300));
    if (m === 'PUT') { const u = upd(sites, id, sanitizeSite(body, site)); await saveSites(`panel: update site ${u.name}`); return u; }
    if (m === 'DELETE') { st.sitesDoc.sites = sites.filter(x => x.id !== id); await saveSites(`panel: remove site ${site.name}`); return { ok: true }; }
    return site;
  }
  if (root === 'subscriptions') {
    const withCalc = (x) => ({ ...x, monthlyCost: money.monthlyCost(x), next: money.nextRenewal(x)?.toISOString().slice(0, 10) || null });
    if (!id && m === 'GET') return V.subscriptions.map(withCalc);
    if (!id && m === 'POST') { const s = stamp(sanitizeSub(body)); V.subscriptions.push(s); await saveVault(`panel: add subscription ${s.name}`); return s; }
    const s = V.subscriptions.find(x => x.id === id); if (!s) bad('Subscription not found');
    if (m === 'PUT') { const u = upd(V.subscriptions, id, sanitizeSub(body, s)); await saveVault(`panel: update subscription ${u.name}`); return u; }
    if (m === 'DELETE') { V.subscriptions = V.subscriptions.filter(x => x.id !== id); await saveVault(`panel: remove subscription ${s.name}`); return { ok: true }; }
    return withCalc(s);
  }
  if (root === 'tasks') {
    if (!id && m === 'GET') return V.tasks;
    if (!id && m === 'POST') { if (!clean(body.title, 200)) bad('Title required'); const t = stamp({ title: clean(body.title, 200), siteId: clean(body.siteId, 40) || null, due: body.due ? clean(body.due, 10) : null, done: false, notes: clean(body.notes, 2000) }); V.tasks.push(t); await saveVault('panel: add task'); return t; }
    if (m === 'PUT') { const patch = {}; if ('title' in body) patch.title = clean(body.title, 200); if ('done' in body) patch.done = !!body.done; if ('due' in body) patch.due = body.due ? clean(body.due, 10) : null; if ('siteId' in body) patch.siteId = clean(body.siteId, 40) || null; const t = upd(V.tasks, id, patch); if (!t) bad('Task not found'); await saveVault('panel: update task'); return t; }
    if (m === 'DELETE') { V.tasks = V.tasks.filter(x => x.id !== id); await saveVault('panel: remove task'); return { ok: true }; }
  }
  if (root === 'calendar') {
    const from = new Date(q.get('from') || Date.now()), to = new Date(q.get('to') || Date.now() + 90 * 86400000); const items = [];
    for (const s of V.subscriptions) for (const c of money.chargesBetween(s, from, to)) items.push({ date: c.date.toISOString().slice(0, 10), amount: c.amount, currency: s.currency, name: s.name, vendor: s.vendor, category: s.category, id: s.id, autoRenew: s.autoRenew, status: s.status, siteIds: s.siteIds });
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }
  if (root === 'audit' && id === 'all') { await dispatch({}); return { queued: true }; }
  if (root === 'monitor' && id === 'refresh') { await refreshMonitor(); return { ok: true }; }
  if (root === 'monitor' && id === 'status') { const run = await st.gh.lastRun(CFG.workflow); return run ? { status: run.status, conclusion: run.conclusion, at: run.run_started_at || run.created_at, url: run.html_url } : null; }
  if (root === 'alerts') return buildAlerts(state(), settings());
  if (root === 'export') return { exportedAt: new Date().toISOString(), sites, subscriptions: V.subscriptions, tasks: V.tasks, settings: settings(), audits: st.audits };
  if (root === 'import') {
    let n = 0;
    for (const s of body.sites || []) { try { if (!sites.find(x => x.id === s.id)) { sites.push({ ...stamp(sanitizeSite(s)), id: s.id || uid() }); n++; } } catch { /* skip */ } }
    for (const s of body.subscriptions || []) { try { if (!V.subscriptions.find(x => x.id === s.id)) { V.subscriptions.push({ ...stamp(sanitizeSub(s)), id: s.id || uid() }); n++; } } catch { /* skip */ } }
    for (const t of body.tasks || []) if (t.title && !V.tasks.find(x => x.id === t.id)) { V.tasks.push(stamp({ id: t.id, title: clean(t.title, 200), siteId: t.siteId || null, due: t.due || null, done: !!t.done })); n++; }
    await saveSites('panel: import'); await saveVault('panel: import'); return { ok: true, imported: n };
  }
  if (root === 'demo' && m === 'POST') { const d = window.PanelDemo(); for (const s of d.sites) if (!sites.find(x => x.id === s.id)) sites.push(s); V.subscriptions.push(...d.subscriptions); V.tasks.push(...d.tasks); await saveSites('panel: add demo data'); await saveVault('panel: add demo data'); dispatch({}).catch(() => {}); return { ok: true }; }
  if (root === 'demo' && m === 'DELETE') { st.sitesDoc.sites = sites.filter(s => !s.id.startsWith('demo-')); V.subscriptions = V.subscriptions.filter(s => !(s.siteIds || []).some(x => x.startsWith('demo-'))); V.tasks = V.tasks.filter(t => !(t.siteId || '').startsWith('demo-')); await saveSites('panel: remove demo data'); await saveVault('panel: remove demo data'); return { ok: true }; }
  if (root === 'vault' && id === 'password' && m === 'POST') { if (clean(body.password, 200).length < 8) bad('Password must be at least 8 characters'); st.pass = body.password; V.settings.encrypt = true; await saveVault('panel: rotate vault password'); return { ok: true }; }
  bad(`Unknown route ${m} ${path}`);
}
async function dispatch(inputs) { return st.gh.dispatch(CFG.workflow, Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, String(v)]))); }

window.PanelApi = { api, load, refreshMonitor, settings, state: st, saveVault, saveSites, dispatch };
})();
