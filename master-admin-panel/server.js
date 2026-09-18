'use strict';
// Master Admin Panel - zero-dependency Node server.
// Serves the SPA, a JSON API, a tiny analytics collector and a background
// scheduler that probes sites, runs audits and pushes alerts to a webhook.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { Store } = require('./lib/store');
const money = require('./lib/money');
const { audit, probe } = require('./lib/audit');
const { buildAlerts, notify } = require('./lib/alerts');

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC = path.join(__dirname, 'public');
const store = new Store(DATA_DIR);

const DEFAULT_SETTINGS = { currency: 'USD', renewalWarnDays: 14, checkIntervalMin: 10, auditIntervalHours: 12, webhookUrl: process.env.ALERT_WEBHOOK_URL || '', keepChecks: 1000, panelName: 'Master Admin' };
const settings = () => ({ ...DEFAULT_SETTINGS, ...store.get('settings', () => ({})) });

// ---------------------------------------------------------------- auth ----
const auth = () => store.get('auth', () => ({ hash: null, salt: null, sessions: {} }));
if (process.env.ADMIN_PASSWORD && !auth().hash) setPassword(process.env.ADMIN_PASSWORD);
function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
function setPassword(pw) {
  const a = auth(); a.salt = crypto.randomBytes(16).toString('hex'); a.hash = hashPw(pw, a.salt); a.sessions = {}; store.set('auth', a);
}
function checkPassword(pw) {
  const a = auth(); if (!a.hash) return false;
  const h = Buffer.from(hashPw(pw, a.salt)); const e = Buffer.from(a.hash);
  return h.length === e.length && crypto.timingSafeEqual(h, e);
}
function newSession() {
  const a = auth(); const token = crypto.randomBytes(32).toString('hex');
  a.sessions[token] = { createdAt: Date.now(), expires: Date.now() + 30 * 86400000 };
  for (const [k, v] of Object.entries(a.sessions)) if (v.expires < Date.now()) delete a.sessions[k];
  store.set('auth', a); return token;
}
function sessionOk(req) {
  const m = /(?:^|;\s*)map_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return false;
  const s = auth().sessions[m[1]];
  return !!(s && s.expires > Date.now());
}
function logout(req) {
  const m = /(?:^|;\s*)map_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (m) { const a = auth(); delete a.sessions[m[1]]; store.set('auth', a); }
}

// ------------------------------------------------------------- helpers ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, { 'content-type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', ...headers });
  res.end(data);
}
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}
function clean(str, max = 500) { return typeof str === 'string' ? str.trim().slice(0, max) : ''; }
function validUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; } }
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || ''; }

// ---------------------------------------------------------- collections ----
const state = () => ({
  sites: store.list('sites'), subscriptions: store.list('subscriptions'), tasks: store.list('tasks'),
  audits: store.get('audits', () => ({})), checks: store.get('checks', () => ({})), pageviews: store.get('pageviews', () => ({})),
});

function sanitizeSite(b, existing = {}) {
  const url = validUrl(b.url ?? existing.url);
  if (!url) throw new Error('A valid http(s) URL is required');
  return {
    name: clean(b.name ?? existing.name, 120) || new URL(url).hostname, url,
    category: clean(b.category ?? existing.category, 60), host: clean(b.host ?? existing.host, 120), registrar: clean(b.registrar ?? existing.registrar, 120),
    stack: clean(b.stack ?? existing.stack, 120), repo: clean(b.repo ?? existing.repo, 300), notes: clean(b.notes ?? existing.notes, 5000),
    tags: Array.isArray(b.tags) ? b.tags.map(t => clean(t, 30)).filter(Boolean).slice(0, 20) : (existing.tags || []),
    analytics: { provider: clean(b.analytics?.provider ?? existing.analytics?.provider, 30) || 'none', url: clean(b.analytics?.url ?? existing.analytics?.url, 500) },
    trackingEnabled: b.trackingEnabled ?? existing.trackingEnabled ?? true,
    credentialsNote: clean(b.credentialsNote ?? existing.credentialsNote, 500),
  };
}
function sanitizeSub(b, existing = {}) {
  const amount = Number(b.amount ?? existing.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Amount must be a non-negative number');
  const cycle = clean(b.cycle ?? existing.cycle, 20) || 'monthly';
  if (!(cycle in money.CYCLE_MONTHS)) throw new Error('Invalid billing cycle');
  const date = (v) => { if (v === '' || v === null) return null; if (v === undefined) return undefined; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };
  return {
    name: clean(b.name ?? existing.name, 120) || 'Untitled', vendor: clean(b.vendor ?? existing.vendor, 120), category: clean(b.category ?? existing.category, 40) || 'other',
    siteIds: Array.isArray(b.siteIds) ? b.siteIds.map(s => clean(s, 40)).filter(Boolean) : (existing.siteIds || []),
    amount, currency: (clean(b.currency ?? existing.currency, 3) || settings().currency).toUpperCase(), cycle,
    startDate: date(b.startDate) ?? existing.startDate ?? null, nextRenewal: date(b.nextRenewal) ?? existing.nextRenewal ?? null, endDate: date(b.endDate) ?? existing.endDate ?? null,
    autoRenew: b.autoRenew ?? existing.autoRenew ?? true, paymentMethod: clean(b.paymentMethod ?? existing.paymentMethod, 80),
    status: clean(b.status ?? existing.status, 20) || 'active', url: clean(b.url ?? existing.url, 500), notes: clean(b.notes ?? existing.notes, 5000),
  };
}

// ------------------------------------------------------------- summary ----
function summary() {
  const st = state(); const cfg = settings(); const now = new Date();
  const active = st.subscriptions.filter(s => !['cancelled', 'expired'].includes(s.status));
  const monthly = active.reduce((a, s) => a + money.monthlyCost(s), 0);
  const byCategory = {}; const bySite = {};
  for (const s of active) {
    byCategory[s.category || 'other'] = (byCategory[s.category || 'other'] || 0) + money.monthlyCost(s);
    const ids = s.siteIds?.length ? s.siteIds : ['__shared'];
    for (const id of ids) bySite[id] = (bySite[id] || 0) + money.monthlyCost(s) / ids.length;
  }
  const upcoming = st.subscriptions.map(s => ({ ...s, next: money.nextRenewal(s, now) })).filter(s => s.next)
    .map(s => ({ id: s.id, name: s.name, vendor: s.vendor, amount: s.amount, currency: s.currency, cycle: s.cycle, autoRenew: s.autoRenew, status: s.status, date: s.next.toISOString().slice(0, 10), days: money.daysUntil(s.next, now), siteIds: s.siteIds }))
    .sort((a, b) => a.days - b.days);
  // 12 months: 5 past, current, 6 future
  const months = [];
  for (let i = -5; i <= 6; i++) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
    const cats = {};
    let total = 0;
    for (const s of st.subscriptions) for (const c of money.chargesBetween(s, from, to)) { cats[s.category || 'other'] = (cats[s.category || 'other'] || 0) + c.amount; total += c.amount; }
    months.push({ month: from.toISOString().slice(0, 7), total, byCategory: cats, future: i > 0 });
  }
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const spentYtd = st.subscriptions.reduce((a, s) => a + money.chargesBetween(s, yearStart, now).reduce((x, c) => x + c.amount, 0), 0);
  const sites = st.sites.map(s => {
    const a = st.audits[s.id]; const hist = st.checks[s.id] || [];
    const upCount = hist.filter(c => c.up).length;
    const pv = st.pageviews[s.id] || {}; let views30 = 0; let views7 = 0;
    for (const [d, v] of Object.entries(pv)) { const age = (now - new Date(d)) / 86400000; if (age <= 30) views30 += v.v; if (age <= 7) views7 += v.v; }
    return { ...s, audit: a ? { t: a.t, score: a.score, up: a.http.ok, status: a.http.status, ms: a.http.ms, sslDays: a.ssl?.daysLeft ?? null, domainDays: a.domain?.daysLeft ?? null, issues: a.issues?.length || 0 } : null,
      uptime: hist.length ? Math.round(1000 * upCount / hist.length) / 10 : null, lastCheck: hist[hist.length - 1] || null, monthlyCost: bySite[s.id] || 0, views30, views7,
      sparkline: hist.slice(-40).map(c => c.up ? c.ms : -1) };
  });
  return { now: now.toISOString(), settings: cfg, totals: { monthly, yearly: monthly * 12, spentYtd, activeSubs: active.length, sites: st.sites.length, sitesUp: sites.filter(s => s.audit ? s.audit.up : s.lastCheck?.up).length, sitesDown: sites.filter(s => (s.audit && !s.audit.up) || (s.lastCheck && !s.lastCheck.up)).length, openTasks: st.tasks.filter(t => !t.done).length },
    byCategory, bySite, upcoming, months, sites, alerts: buildAlerts(st, cfg, now), tasks: st.tasks };
}

// ------------------------------------------------------------ analytics ----
function collect(req, url) {
  const siteId = clean(url.searchParams.get('s'), 40);
  const site = store.find('sites', siteId);
  if (!site || site.trackingEnabled === false) return;
  const p = clean(url.searchParams.get('p'), 200) || '/';
  let ref = clean(url.searchParams.get('r'), 200);
  try { ref = ref ? new URL(ref).hostname.replace(/^www\./, '') : 'direct'; } catch { ref = 'direct'; }
  try { if (ref === new URL(site.url).hostname.replace(/^www\./, '')) ref = 'internal'; } catch { /* keep */ }
  const ua = req.headers['user-agent'] || '';
  if (/bot|crawl|spider|slurp|preview|headless/i.test(ua)) return;
  const device = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop';
  const day = new Date().toISOString().slice(0, 10);
  // daily-rotating salted hash of ip+ua for uniques; nothing personal stored
  const salt = store.get('salt', () => crypto.randomBytes(16).toString('hex'));
  const visitor = crypto.createHash('sha256').update(`${salt}|${day}|${clientIp(req)}|${ua}`).digest('hex').slice(0, 16);
  const pv = store.get('pageviews', () => ({}));
  pv[siteId] = pv[siteId] || {};
  const d = pv[siteId][day] = pv[siteId][day] || { v: 0, u: 0, paths: {}, refs: {}, ua: {}, visitors: {} };
  d.v += 1; d.paths[p] = (d.paths[p] || 0) + 1; d.refs[ref] = (d.refs[ref] || 0) + 1; d.ua[device] = (d.ua[device] || 0) + 1;
  d.visitors = d.visitors || {};
  if (!d.visitors[visitor] && Object.keys(d.visitors).length < 50000) { d.visitors[visitor] = 1; d.u = Object.keys(d.visitors).length; }
  // trim path/ref cardinality
  for (const k of ['paths', 'refs']) if (Object.keys(d[k]).length > 300) { const e = Object.entries(d[k]).sort((a, b) => b[1] - a[1]).slice(0, 200); d[k] = Object.fromEntries(e); }
  // drop visitor sets older than 2 days to keep the file small
  for (const [dd, val] of Object.entries(pv[siteId])) if (val.visitors && (Date.now() - new Date(dd)) > 2 * 86400000) delete val.visitors;
  store.touch('pageviews');
}
function analytics(siteId, days) {
  const pv = store.get('pageviews', () => ({}))[siteId] || {};
  const out = { days: [], paths: {}, refs: {}, ua: {}, totalViews: 0, totalUniques: 0 };
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const v = pv[d] || { v: 0, u: 0, paths: {}, refs: {}, ua: {} };
    out.days.push({ date: d, views: v.v, uniques: v.u });
    out.totalViews += v.v; out.totalUniques += v.u;
    for (const k of ['paths', 'refs', 'ua']) for (const [key, n] of Object.entries(v[k] || {})) out[k][key] = (out[k][key] || 0) + n;
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => ({ key: k, n }));
  out.paths = top(out.paths); out.refs = top(out.refs); out.ua = top(out.ua);
  return out;
}

// ------------------------------------------------------------- scheduler ----
const running = new Set();
async function runAudit(site) {
  if (running.has(site.id)) return store.get('audits', () => ({}))[site.id];
  running.add(site.id);
  try {
    const result = await audit(site.url);
    const audits = store.get('audits', () => ({})); audits[site.id] = result; store.set('audits', audits);
    recordCheck(site.id, { t: result.t, up: result.http.ok, status: result.http.status, ms: result.http.ms, error: result.http.error });
    return result;
  } finally { running.delete(site.id); }
}
function recordCheck(siteId, c) {
  const checks = store.get('checks', () => ({}));
  const list = checks[siteId] = checks[siteId] || [];
  list.push(c);
  const keep = Number(settings().keepChecks) || 1000;
  if (list.length > keep) list.splice(0, list.length - keep);
  store.set('checks', checks);
}
async function tick() {
  const cfg = settings();
  const sites = store.list('sites');
  const audits = store.get('audits', () => ({}));
  for (const site of sites) {
    const last = audits[site.id]?.t ? new Date(audits[site.id].t) : null;
    if (!last || (Date.now() - last) > cfg.auditIntervalHours * 3600000) runAudit(site).catch(() => {});
    else probe(site.url).then(c => recordCheck(site.id, c)).catch(() => {});
  }
  setTimeout(dispatchAlerts, 30000);
}
async function dispatchAlerts() {
  const cfg = settings(); if (!cfg.webhookUrl) return;
  const st = state(); const alerts = buildAlerts(st, cfg);
  const sent = store.get('notified', () => ({}));
  const fresh = alerts.filter(a => !sent[a.key]);
  if (!fresh.length) return;
  if (await notify(cfg.webhookUrl, fresh)) { for (const a of fresh) sent[a.key] = Date.now(); store.set('notified', sent); }
}
let timer = null;
function schedule() {
  clearInterval(timer);
  timer = setInterval(tick, Math.max(1, Number(settings().checkIntervalMin) || 10) * 60000);
}

// ------------------------------------------------------------------ API ----
async function api(req, res, url) {
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [root, id, sub] = parts; const m = req.method;
  const body = ['POST', 'PUT', 'PATCH'].includes(m) ? await readBody(req) : {};

  // --- public (unauthenticated) ---
  if (root === 'auth') {
    if (id === 'status') return send(res, 200, { configured: !!auth().hash, authenticated: sessionOk(req), panelName: settings().panelName });
    if (id === 'setup' && m === 'POST') {
      if (auth().hash) return send(res, 409, { error: 'Password already set' });
      if (clean(body.password, 200).length < 8) return send(res, 400, { error: 'Password must be at least 8 characters' });
      setPassword(body.password); const token = newSession();
      return send(res, 200, { ok: true }, { 'set-cookie': cookie(token, req) });
    }
    if (id === 'login' && m === 'POST') {
      await new Promise(r => setTimeout(r, 300)); // slow brute force a little
      if (!checkPassword(String(body.password || ''))) return send(res, 401, { error: 'Wrong password' });
      return send(res, 200, { ok: true }, { 'set-cookie': cookie(newSession(), req) });
    }
    if (id === 'logout' && m === 'POST') { logout(req); return send(res, 200, { ok: true }, { 'set-cookie': 'map_session=; Path=/; Max-Age=0' }); }
  }
  if (!sessionOk(req)) return send(res, 401, { error: 'Unauthorized' });

  // --- authenticated ---
  if (root === 'auth' && id === 'password' && m === 'POST') {
    if (!checkPassword(String(body.current || ''))) return send(res, 401, { error: 'Current password is wrong' });
    if (clean(body.password, 200).length < 8) return send(res, 400, { error: 'Password must be at least 8 characters' });
    setPassword(body.password); return send(res, 200, { ok: true }, { 'set-cookie': cookie(newSession(), req) });
  }
  if (root === 'summary') return send(res, 200, summary());
  if (root === 'settings') {
    if (m === 'GET') return send(res, 200, settings());
    if (m === 'PUT') {
      const cur = settings(); const next = { ...cur };
      for (const k of ['currency', 'panelName']) if (k in body) next[k] = clean(body[k], 40);
      for (const k of ['renewalWarnDays', 'checkIntervalMin', 'auditIntervalHours', 'keepChecks']) if (k in body) next[k] = Math.max(1, Number(body[k]) || cur[k]);
      if ('webhookUrl' in body) next.webhookUrl = body.webhookUrl ? (validUrl(body.webhookUrl) || '') : '';
      store.set('settings', next); schedule(); return send(res, 200, next);
    }
  }
  if (root === 'sites') {
    if (!id && m === 'GET') return send(res, 200, store.list('sites'));
    if (!id && m === 'POST') { const site = store.insert('sites', sanitizeSite(body)); runAudit(site).catch(() => {}); return send(res, 201, site); }
    const site = store.find('sites', id); if (!site) return send(res, 404, { error: 'Not found' });
    if (sub === 'audit' && m === 'POST') return send(res, 200, await runAudit(site));
    if (sub === 'audit') return send(res, 200, store.get('audits', () => ({}))[id] || null);
    if (sub === 'checks') return send(res, 200, (store.get('checks', () => ({}))[id] || []).slice(-Number(url.searchParams.get('limit') || 300)));
    if (sub === 'analytics') return send(res, 200, analytics(id, Math.min(365, Number(url.searchParams.get('days') || 30))));
    if (m === 'PUT') { const upd = store.update('sites', id, sanitizeSite(body, site)); if (body.url && body.url !== site.url) runAudit(upd).catch(() => {}); return send(res, 200, upd); }
    if (m === 'DELETE') {
      store.remove('sites', id);
      for (const k of ['audits', 'checks', 'pageviews']) { const o = store.get(k, () => ({})); delete o[id]; store.set(k, o); }
      return send(res, 200, { ok: true });
    }
    return send(res, 200, site);
  }
  if (root === 'subscriptions') {
    if (!id && m === 'GET') return send(res, 200, store.list('subscriptions').map(s => ({ ...s, monthlyCost: money.monthlyCost(s), next: money.nextRenewal(s)?.toISOString().slice(0, 10) || null })));
    if (!id && m === 'POST') return send(res, 201, store.insert('subscriptions', sanitizeSub(body)));
    const s = store.find('subscriptions', id); if (!s) return send(res, 404, { error: 'Not found' });
    if (m === 'PUT') return send(res, 200, store.update('subscriptions', id, sanitizeSub(body, s)));
    if (m === 'DELETE') { store.remove('subscriptions', id); return send(res, 200, { ok: true }); }
    return send(res, 200, s);
  }
  if (root === 'tasks') {
    if (!id && m === 'GET') return send(res, 200, store.list('tasks'));
    if (!id && m === 'POST') { if (!clean(body.title, 200)) return send(res, 400, { error: 'Title required' }); return send(res, 201, store.insert('tasks', { title: clean(body.title, 200), siteId: clean(body.siteId, 40) || null, due: body.due ? clean(body.due, 10) : null, done: false, notes: clean(body.notes, 2000) })); }
    if (m === 'PUT') { const p = {}; if ('title' in body) p.title = clean(body.title, 200); if ('done' in body) p.done = !!body.done; if ('due' in body) p.due = body.due ? clean(body.due, 10) : null; if ('siteId' in body) p.siteId = clean(body.siteId, 40) || null; if ('notes' in body) p.notes = clean(body.notes, 2000); const t = store.update('tasks', id, p); return t ? send(res, 200, t) : send(res, 404, { error: 'Not found' }); }
    if (m === 'DELETE') { store.remove('tasks', id); return send(res, 200, { ok: true }); }
  }
  if (root === 'calendar') {
    const from = new Date(url.searchParams.get('from') || Date.now()); const to = new Date(url.searchParams.get('to') || (Date.now() + 90 * 86400000));
    const items = [];
    for (const s of store.list('subscriptions')) for (const c of money.chargesBetween(s, from, to)) items.push({ date: c.date.toISOString().slice(0, 10), amount: c.amount, currency: s.currency, name: s.name, vendor: s.vendor, category: s.category, id: s.id, autoRenew: s.autoRenew, status: s.status, siteIds: s.siteIds });
    items.sort((a, b) => a.date.localeCompare(b.date));
    return send(res, 200, items);
  }
  if (root === 'audit' && id === 'all' && m === 'POST') { for (const s of store.list('sites')) runAudit(s).catch(() => {}); return send(res, 202, { ok: true, queued: store.list('sites').length }); }
  if (root === 'alerts') {
    if (id === 'test' && m === 'POST') { const ok = await notify(settings().webhookUrl, [{ sev: 'warn', title: 'Test alert from Master Admin Panel', detail: 'Webhook is working.' }]); return send(res, ok ? 200 : 502, { ok }); }
    return send(res, 200, buildAlerts(state(), settings()));
  }
  if (root === 'export') {
    const name = `admin-panel-export-${new Date().toISOString().slice(0, 10)}.json`;
    return send(res, 200, { exportedAt: new Date().toISOString(), sites: store.list('sites'), subscriptions: store.list('subscriptions'), tasks: store.list('tasks'), settings: settings(), audits: store.get('audits', () => ({})), pageviews: store.get('pageviews', () => ({})) }, { 'content-disposition': `attachment; filename="${name}"` });
  }
  if (root === 'import' && m === 'POST') {
    let n = 0;
    for (const s of body.sites || []) { try { if (!store.find('sites', s.id)) { store.insert('sites', { ...sanitizeSite(s), id: s.id }); n++; } } catch { /* skip bad rows */ } }
    for (const s of body.subscriptions || []) { try { if (!store.find('subscriptions', s.id)) { store.insert('subscriptions', { ...sanitizeSub(s), id: s.id }); n++; } } catch { /* skip */ } }
    for (const t of body.tasks || []) if (t.title && !store.find('tasks', t.id)) { store.insert('tasks', { id: t.id, title: clean(t.title, 200), siteId: t.siteId || null, due: t.due || null, done: !!t.done }); n++; }
    return send(res, 200, { ok: true, imported: n });
  }
  if (root === 'demo' && m === 'DELETE') {
    for (const s of store.list('sites').filter(s => s.id.startsWith('demo-'))) { store.remove('sites', s.id); for (const k of ['audits', 'checks', 'pageviews']) { const o = store.get(k, () => ({})); delete o[s.id]; store.set(k, o); } }
    store.set('subscriptions', store.list('subscriptions').filter(s => !(s.siteIds || []).some(x => x.startsWith('demo-'))));
    store.set('tasks', store.list('tasks').filter(t => !(t.siteId || '').startsWith('demo-')));
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Unknown API route' });
}
function cookie(token, req) {
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  return `map_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`;
}

// --------------------------------------------------------------- server ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/collect') {
      collect(req, url);
      return send(res, 204, '', { 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    }
    if (url.pathname === '/track.js') {
      res.writeHead(200, { 'content-type': MIME['.js'], 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' });
      return res.end(fs.readFileSync(path.join(PUBLIC, 'track.js')));
    }
    if (url.pathname === '/healthz') return send(res, 200, { ok: true, uptime: process.uptime() });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    // static
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const abs = path.join(PUBLIC, file);
    if (!abs.startsWith(PUBLIC) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    const status = /required|must be|Invalid|invalid|too large/i.test(e.message) ? 400 : 500;
    if (status === 500) console.error(e);
    send(res, status, { error: e.message });
  }
});

if (require.main === module) {
  if (process.env.SEED_DEMO === '1' && !store.get('meta', () => ({})).seeded && store.list('sites').length === 0) {
    require('./lib/seed')(store); store.flush(); console.log('Seeded demo data (remove it from Settings).');
  }
  server.listen(PORT, () => {
    console.log(`Master Admin Panel → http://localhost:${PORT}  (data: ${DATA_DIR})`);
    schedule(); setTimeout(tick, 3000);
  });
  const bye = () => { store.flush(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
module.exports = { server, store, summary, api };
