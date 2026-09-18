#!/usr/bin/env node
'use strict';
// GitHub Actions entry point. Reads the site list from the data branch,
// probes / audits every site, writes results back, and sends new alerts.
//
//   node scripts/monitor.js                 one pass over all sites
//   SITE=<id> node scripts/monitor.js       force a full audit of one site
//   MODE=relay node scripts/monitor.js      loop for ~5.5 h (see workflow)
//
// Env: GITHUB_REPOSITORY, GITHUB_TOKEN (contents: write), PANEL_BRANCH,
// PANEL_DIR, PANEL_ALERT_WEBHOOK_URL (optional), PANEL_ALERT_ISSUES (optional).
const { audit, probe } = require('../lib/audit');
const { buildAlerts, notify } = require('../lib/alerts');

const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = process.env.PANEL_BRANCH || 'panel-data';
const DIR = (process.env.PANEL_DIR || 'panel').replace(/\/$/, '');
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
if (!REPO || !TOKEN) { console.error('GITHUB_REPOSITORY and GITHUB_TOKEN are required'); process.exit(1); }

const shas = {};
async function gh(path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${TOKEN}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'master-admin-panel-monitor', ...(opts.body ? { 'content-type': 'application/json' } : {}) } });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(`${data.message || res.statusText} (${path})`); e.status = res.status; throw e; }
  return data;
}
async function readJson(name) {
  try { const f = await gh(`/repos/${REPO}/contents/${DIR}/${name}?ref=${BRANCH}`); shas[name] = f.sha; return JSON.parse(Buffer.from(f.content, 'base64').toString('utf8')); }
  catch (e) { if (e.status === 404) return null; throw e; }
}
async function writeJson(name, obj, message) {
  const body = { message, branch: BRANCH, content: Buffer.from(JSON.stringify(obj, null, 2) + '\n').toString('base64') };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (shas[name]) body.sha = shas[name];
    try { const r = await gh(`/repos/${REPO}/contents/${DIR}/${name}`, { method: 'PUT', body: JSON.stringify(body) }); shas[name] = r.content.sha; return; }
    catch (e) { if (e.status !== 409 && e.status !== 422) throw e; await readJson(name); }
  }
  throw new Error(`could not write ${name} after retries`);
}
async function ensureBranch() {
  try { await gh(`/repos/${REPO}/branches/${BRANCH}`); return; } catch (e) { if (e.status !== 404) throw e; }
  const blob = await gh(`/repos/${REPO}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: '# Master Admin Panel data\n\nManaged by the panel and its GitHub Actions monitor. Do not edit by hand.\n', encoding: 'utf-8' }) });
  const tree = await gh(`/repos/${REPO}/git/trees`, { method: 'POST', body: JSON.stringify({ tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }] }) });
  const commit = await gh(`/repos/${REPO}/git/commits`, { method: 'POST', body: JSON.stringify({ message: 'panel: initialise data branch', tree: tree.sha, parents: [] }) });
  await gh(`/repos/${REPO}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commit.sha }) });
  console.log(`created orphan branch ${BRANCH}`);
}

async function openIssues(alerts) {
  if (process.env.PANEL_ALERT_ISSUES !== '1' || !alerts.length) return;
  for (const a of alerts) {
    try { await gh(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title: `[panel] ${a.title}`, body: `${a.detail || ''}\n\nSeverity: **${a.sev}** · kind: ${a.kind} · ${a.date}\n\n_Opened by the Master Admin Panel monitor._`, labels: ['panel-alert'] }) }); }
    catch (e) { console.warn('issue creation failed:', e.message); }
  }
}

async function pass(forceSite) {
  const sitesDoc = (await readJson('sites.json')) || { config: {}, sites: [] };
  const cfg = { checkIntervalMin: 10, auditIntervalHours: 12, renewalWarnDays: 14, keepChecks: 1000, ...sitesDoc.config };
  const audits = (await readJson('audits.json')) || {};
  const checks = (await readJson('checks.json')) || {};
  const sites = forceSite ? sitesDoc.sites.filter(s => s.id === forceSite) : sitesDoc.sites;
  if (!sites.length) { console.log(forceSite ? `site ${forceSite} not found` : 'no sites configured yet'); return cfg; }
  console.log(`${new Date().toISOString()} checking ${sites.length} site(s)`);
  await Promise.all(sites.map(async (site) => {
    const last = audits[site.id]?.t ? Date.parse(audits[site.id].t) : 0;
    const full = forceSite || !last || (Date.now() - last) > cfg.auditIntervalHours * 3600000;
    try {
      let check;
      if (full) { const a = await audit(site.url); audits[site.id] = a; check = { t: a.t, up: a.http.ok, status: a.http.status, ms: a.http.ms, error: a.http.error }; console.log(`  audit ${site.name}: ${a.http.ok ? 'up' : 'DOWN'} score ${a.score} (${a.issues.length} issues)`); }
      else { check = await probe(site.url); console.log(`  probe ${site.name}: ${check.up ? 'up' : 'DOWN'} ${check.ms} ms`); }
      const list = checks[site.id] = checks[site.id] || []; list.push(check); if (list.length > cfg.keepChecks) list.splice(0, list.length - cfg.keepChecks);
    } catch (e) { console.warn(`  ${site.name}: ${e.message}`); }
  }));
  // prune history of deleted sites
  for (const id of Object.keys(checks)) if (!sitesDoc.sites.some(s => s.id === id)) { delete checks[id]; delete audits[id]; }
  await writeJson('audits.json', audits, `monitor: audits ${new Date().toISOString()}`);
  await writeJson('checks.json', checks, `monitor: checks ${new Date().toISOString()}`);

  // alerts: site-based always; renewal-based only when the vault is stored in plain JSON
  const vault = await readJson('vault.json');
  const plain = vault && vault.enc === false ? vault : null;
  const state = { sites: sitesDoc.sites, subscriptions: plain?.subscriptions || [], tasks: plain?.tasks || [], audits, checks };
  const alerts = buildAlerts(state, { ...cfg, ...(plain?.settings || {}) });
  const notified = (await readJson('notified.json')) || {};
  const fresh = alerts.filter(a => !notified[a.key]);
  if (fresh.length) {
    console.log(`${fresh.length} new alert(s):`); for (const a of fresh) console.log(`  [${a.sev}] ${a.title}`);
    let delivered = false;
    if (process.env.PANEL_ALERT_WEBHOOK_URL) delivered = await notify(process.env.PANEL_ALERT_WEBHOOK_URL, fresh);
    await openIssues(fresh);
    if (delivered || process.env.PANEL_ALERT_ISSUES === '1') { for (const a of fresh) notified[a.key] = Date.now(); }
    // forget resolved alerts so they can fire again if they come back
    for (const k of Object.keys(notified)) if (!alerts.some(a => a.key === k)) delete notified[k];
    await writeJson('notified.json', notified, 'monitor: alert state');
  }
  return cfg;
}

(async () => {
  await ensureBranch();
  const forceSite = process.env.SITE || '';
  if (process.env.MODE !== 'relay' || forceSite) { await pass(forceSite); return; }
  // relay: keep probing inside one job for ~5.5 h, then the workflow re-dispatches itself
  const started = Date.now(); const budget = Number(process.env.RELAY_MINUTES || 330) * 60000;
  for (;;) {
    let cfg; try { cfg = await pass(); } catch (e) { console.error('pass failed:', e.message); cfg = { checkIntervalMin: 10 }; }
    const wait = Math.max(5, Number(cfg.checkIntervalMin) || 10) * 60000;
    if (Date.now() - started + wait > budget) break;
    await new Promise(r => setTimeout(r, wait));
  }
})().catch(e => { console.error(e); process.exit(1); });
