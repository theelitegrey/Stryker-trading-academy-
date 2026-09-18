/* Master Admin Panel - single-file SPA (no build step). */
(() => {
'use strict';
// ------------------------------------------------------------ utilities ----
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Safe extends String { get __raw() { return true; } get v() { return this.toString(); } }
// Tagged template: escapes interpolations unless they are Safe (nested h``/raw()) or arrays of them.
const h = (strings, ...vals) => new Safe(strings.reduce((out, str, i) => out + str + (i < vals.length ? (vals[i] && vals[i].__raw ? vals[i].v : Array.isArray(vals[i]) ? vals[i].map(x => x && x.__raw ? x.v : esc(x)).join('') : esc(vals[i])) : ''), ''));
const raw = (v) => new Safe(v == null ? '' : String(v));
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const CATEGORIES = ['hosting', 'domain', 'saas', 'api', 'email', 'cdn', 'analytics', 'storage', 'assets', 'marketing', 'security', 'other'];
const CYCLES = ['monthly', 'yearly', 'quarterly', 'weekly', 'biannual', 'biennial', 'one-time'];
const STATUSES = ['active', 'trial', 'paused', 'cancelled', 'expired'];
let S = { summary: null, settings: {}, sites: [], subs: [], tasks: [], auth: null, route: '#dashboard' };
const money = (n, cur) => { cur = cur || S.settings.currency || 'USD'; try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n || 0); } catch { return `${cur} ${(n || 0).toFixed(2)}`; } };
const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const ago = (d) => { if (!d) return 'never'; const s = (Date.now() - new Date(d)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const daysWord = (d) => d == null ? '—' : d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d}d`;
const sevOf = (days, c = 3, w = 14) => days == null ? '' : days <= c ? 'critical' : days <= w ? 'warn' : 'good';
const scoreSev = (s) => s == null ? '' : s >= 80 ? 'good' : s >= 60 ? 'warn' : 'critical';
const siteName = (id) => S.sites.find(s => s.id === id)?.name || (id === '__shared' ? 'Shared / unassigned' : id || '—');
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : '';
// Fixed slot per category (colour follows the entity); everything past the 8 slots folds to neutral.
const CAT_SLOT = { hosting: 0, domain: 1, saas: 2, api: 3, email: 4, cdn: 5, analytics: 6, storage: 7 };
const catColor = (c) => c in CAT_SLOT ? SERIES[CAT_SLOT[c]] : 'var(--text-3)';

function toast(msg, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3500); }
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && !path.startsWith('/auth')) { S.auth = { configured: true, authenticated: false }; renderLogin(); throw new Error('Unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
async function refresh() {
  const [summary, sites, subs, tasks, settings] = await Promise.all([api('/summary'), api('/sites'), api('/subscriptions'), api('/tasks'), api('/settings')]);
  Object.assign(S, { summary, sites, subs, tasks, settings });
}

// --------------------------------------------------------------- charts ----
// Tooltip layer shared by all charts.
const tip = document.createElement('div'); tip.className = 'tooltip'; tip.style.display = 'none'; document.body.appendChild(tip);
document.addEventListener('mousemove', (e) => { const el = e.target.closest?.('[data-tip]'); if (el) { tip.innerHTML = el.dataset.tip; tip.style.display = 'block'; const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8); tip.style.left = x + 'px'; tip.style.top = (e.clientY - tip.offsetHeight - 10 < 0 ? e.clientY + 14 : e.clientY - tip.offsetHeight - 10) + 'px'; } else tip.style.display = 'none'; });
const nice = (max) => { if (max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const n = max / p; const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10; return step * p; };

// Stacked vertical bars: data = [{label, parts:{key:val}, future}], keys in fixed order.
function stackedBars(data, keys, { height = 220, fmt = (v) => v, colors = {} } = {}) {
  const W = 720, H = height, pl = 48, pr = 8, pt = 12, pb = 28;
  const max = nice(Math.max(1, ...data.map(d => keys.reduce((a, k) => a + (d.parts[k] || 0), 0))));
  const iw = (W - pl - pr) / data.length, bw = Math.min(46, iw * 0.62);
  const y = (v) => pt + (H - pt - pb) * (1 - v / max);
  const ticks = 4; let out = '<g class="grid">';
  for (let i = 0; i <= ticks; i++) { const v = max * i / ticks; out += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`; }
  out += '</g>';
  data.forEach((d, i) => {
    const x = pl + i * iw + (iw - bw) / 2; let acc = 0;
    const total = keys.reduce((a, k) => a + (d.parts[k] || 0), 0);
    const tipHtml = `<b>${esc(d.label)}${d.future ? ' (projected)' : ''}</b>Total ${esc(fmt(total))}` + keys.filter(k => d.parts[k]).map(k => `<br>${esc(cap(k))}: ${esc(fmt(d.parts[k]))}`).join('');
    keys.forEach((k) => {
      const v = d.parts[k] || 0; if (!v) return;
      const y1 = y(acc + v), y0 = y(acc); acc += v;
      out += `<rect class="bar" x="${x}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1 - 2)}" fill="${colors[k] || catColor(k)}" ${d.future ? 'opacity=".55"' : ''} rx="2"></rect>`;
    });
    if (total) out += `<text x="${x + bw / 2}" y="${y(total) - 4}" text-anchor="middle" style="font-size:10px">${esc(fmt(total))}</text>`;
    out += `<rect class="hit" x="${pl + i * iw}" y="${pt}" width="${iw}" height="${H - pt - pb}" data-tip="${esc(tipHtml)}"></rect>`;
    out += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" ${d.future ? 'opacity=".7"' : ''}>${esc(d.label)}</text>`;
  });
  out += `<g class="axis"><line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}"/></g>`;
  const used = keys.filter(k => data.some(d => d.parts[k]));
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Stacked bar chart">${out}</svg><div class="legend">${used.map(k => `<span><i style="background:${colors[k] || catColor(k)}"></i>${esc(cap(k))}</span>`).join('')}</div></div>`;
}
// Multi-series line chart: series = [{name, values:[{x:label, y}]}]
function lineChart(series, { height = 200, fmt = (v) => v, area = true } = {}) {
  const W = 720, H = height, pl = 44, pr = 10, pt = 12, pb = 26;
  const n = series[0]?.values.length || 0; if (!n) return '<div class="empty">No data yet</div>';
  const max = nice(Math.max(1, ...series.flatMap(s => s.values.map(v => v.y))));
  const x = (i) => pl + (W - pl - pr) * (n === 1 ? 0.5 : i / (n - 1));
  const y = (v) => pt + (H - pt - pb) * (1 - v / max);
  let out = '<g class="grid">';
  for (let i = 0; i <= 4; i++) { const v = max * i / 4; out += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`; }
  out += '</g>';
  series.forEach((s, si) => {
    const pts = s.values.map((v, i) => `${x(i)},${y(v.y)}`).join(' ');
    if (area && si === 0) out += `<polygon points="${x(0)},${y(0)} ${pts} ${x(n - 1)},${y(0)}" fill="${SERIES[si]}" opacity=".08"></polygon>`;
    out += `<polyline points="${pts}" fill="none" stroke="${SERIES[si]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
  });
  const every = Math.ceil(n / 8);
  series[0].values.forEach((v, i) => {
    const tipHtml = `<b>${esc(v.x)}</b>` + series.map(s => `${esc(s.name)}: ${esc(fmt(s.values[i].y))}`).join('<br>');
    const w = (W - pl - pr) / Math.max(1, n - 1);
    out += `<rect class="hit" x="${x(i) - w / 2}" y="${pt}" width="${w}" height="${H - pt - pb}" data-tip="${esc(tipHtml)}"></rect>`;
    if (i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2)) out += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(v.x)}</text>`;
  });
  series.forEach((s, si) => { const last = s.values[n - 1]; out += `<circle cx="${x(n - 1)}" cy="${y(last.y)}" r="4" fill="${SERIES[si]}" stroke="var(--surface)" stroke-width="2"></circle>`; });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">${out}</svg>${series.length > 1 ? `<div class="legend">${series.map((s, i) => `<span><i style="background:${SERIES[i]}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}</div>`;
}
function hbars(rows, { fmt = (v) => v, color = () => 'var(--s1)' } = {}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  if (!rows.length) return '<div class="empty">Nothing here yet</div>';
  return rows.map(r => `<div class="hbar"><span class="lbl" title="${esc(r.label)}">${esc(r.label)}</span><div class="track"><div class="fill" style="width:${100 * r.value / max}%;background:${color(r)}"></div></div><span class="num right">${esc(fmt(r.value))}</span></div>`).join('');
}
function sparkline(vals) {
  if (!vals?.length) return '<span class="dim small">no checks</span>';
  const w = 110, hgt = 26, bw = w / Math.max(vals.length, 20); const max = Math.max(1, ...vals.filter(v => v > 0));
  return `<svg class="spark" viewBox="0 0 ${w} ${hgt}">${vals.map((v, i) => v < 0 ? `<rect x="${i * bw}" y="0" width="${bw - 1}" height="${hgt}" fill="var(--critical)"/>` : `<rect x="${i * bw}" y="${hgt - Math.max(3, hgt * v / max)}" width="${bw - 1}" height="${Math.max(3, hgt * v / max)}" fill="var(--good)" opacity=".8"/>`).join('')}</svg>`;
}

// ---------------------------------------------------------------- modal ----
function modal(title, bodyHtml, { onSubmit, submitLabel = 'Save', extraFoot = '' } = {}) {
  const root = $('#modal-root');
  root.innerHTML = h`<div class="modal-bg"><form class="modal" novalidate><h2>${title}</h2>${raw(bodyHtml)}<div class="foot"><span class="left">${raw(extraFoot)}</span><button type="button" class="btn" data-close>Cancel</button>${onSubmit ? h`<button class="btn primary" type="submit">${submitLabel}</button>` : ''}</div></form></div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('.modal-bg').addEventListener('click', (e) => { if (e.target.classList.contains('modal-bg') || e.target.closest('[data-close]')) close(); });
  const form = root.querySelector('form');
  form.addEventListener('submit', async (e) => { e.preventDefault(); if (!onSubmit) return close(); const btn = form.querySelector('[type=submit]'); btn.disabled = true; try { await onSubmit(formData(form), form); close(); } catch (err) { toast(err.message, true); btn.disabled = false; } });
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  setTimeout(() => form.querySelector('input,select,textarea')?.focus(), 30);
  return { form, close };
}
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.dataset.multi) { o[el.name] = o[el.name] || []; if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked; }
    else if (el.type === 'number') o[el.name] = el.value === '' ? null : Number(el.value);
    else o[el.name] = el.value;
  }
  return o;
}
const field = (label, inner, full) => h`<div class="field${full ? ' full' : ''}"><label>${label}</label>${raw(inner)}</div>`;
const input = (name, val = '', attrs = '') => h`<input class="input" name="${name}" value="${val ?? ''}" ${raw(attrs)}>`;
const select = (name, opts, val, attrs = '') => h`<select class="input" name="${name}" ${raw(attrs)}>${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, cap(o)]; return h`<option value="${v}" ${v === val ? raw('selected') : ''}>${l}</option>`; })}</select>`;
const confirmDialog = (msg) => new Promise((res) => { modal('Are you sure?', h`<p>${msg}</p>`, { onSubmit: async () => res(true), submitLabel: 'Delete' }); const bg = $('#modal-root .modal-bg'); bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) res(false); }); $('#modal-root [type=submit]').classList.add('danger'); });

// ---------------------------------------------------------------- icons ----
const I = {
  dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="12" width="8" height="9" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/></svg>',
  sites: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  subs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  audit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20h18M6 16v-5M11 16V8M16 16v-3M21 16V5"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/></svg>',
  cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
};
const NAV = [['#dashboard', 'Dashboard', 'dash'], ['#sites', 'Websites', 'sites'], ['#subscriptions', 'Subscriptions', 'subs'], ['#calendar', 'Renewal calendar', 'cal'], ['#audits', 'Health & audits', 'audit'], ['#analytics', 'Analytics', 'chart'], ['#tasks', 'Tasks', 'tasks'], ['#settings', 'Settings', 'cog']];

// --------------------------------------------------------------- render ----
function shell(content, title, actions = '') {
  const alerts = S.summary?.alerts?.length || 0;
  const cur = location.hash.split('/')[0] || '#dashboard';
  $('#app').innerHTML = h`<div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><span class="logo">${raw(I.audit)}</span>${S.settings.panelName || 'Master Admin'}</div>
      <nav class="nav">${NAV.map(([href, label, ic]) => h`<a href="${href}" class="${href === cur ? 'active' : ''}">${raw(I[ic])}${label}${href === '#dashboard' && alerts ? h`<span class="badge ${S.summary.alerts.some(a => a.sev === 'critical') ? 'critical' : 'warn'}">${alerts}</span>` : ''}</a>`)}</nav>
      <div class="foot"><button class="btn ghost sm" id="theme" title="Toggle theme">${raw(I.sun)}</button><button class="btn ghost sm" id="logout" title="Log out">${raw(I.out)} Log out</button></div>
    </aside>
    <main class="main">
      <div class="topbar"><div style="display:flex;align-items:center;gap:10px"><button class="btn ghost menu-btn" id="menu">${raw(I.menu)}</button><h1>${title}</h1></div><div class="actions">${raw(actions)}</div></div>
      ${raw(content)}
    </main></div>`;
  $('#menu').onclick = () => $('#sidebar').classList.toggle('open');
  $('#theme').onclick = () => { const cur = document.documentElement.dataset.theme; const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark' : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark'); document.documentElement.dataset.theme = next; try { localStorage.setItem('theme', next); } catch {} };
  $('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); };
  $('.main').addEventListener('click', () => $('#sidebar').classList.remove('open'));
}
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch {}

// ---------------------------------------------------------------- login ----
function renderLogin() {
  const setup = !S.auth.configured;
  $('#app').innerHTML = h`<div class="login"><div class="card"><div class="brand"><span class="logo">${raw(I.audit)}</span>Master Admin</div>
    <h2 style="text-align:center;margin-bottom:6px">${setup ? 'Create your admin password' : 'Sign in'}</h2>
    <p class="muted small" style="text-align:center;margin:0 0 16px">${setup ? 'This is a fresh install. Choose a password of at least 8 characters.' : 'Enter the admin password to continue.'}</p>
    <form id="login" class="stack" style="gap:10px"><input class="input" type="password" name="password" placeholder="Password" autocomplete="${setup ? 'new-password' : 'current-password'}" required minlength="8">
    ${setup ? raw('<input class="input" type="password" name="confirm" placeholder="Confirm password" required minlength="8">') : ''}
    <button class="btn primary" type="submit">${setup ? 'Set password & continue' : 'Sign in'}</button></form></div></div>`;
  $('#login').onsubmit = async (e) => {
    e.preventDefault(); const d = formData(e.target);
    try { if (setup && d.password !== d.confirm) throw new Error('Passwords do not match'); await api(setup ? '/auth/setup' : '/auth/login', { method: 'POST', body: { password: d.password } }); await boot(); } catch (err) { toast(err.message, true); }
  };
}

// --------------------------------------------------------------- router ----
const routes = {};
async function route() {
  if (!S.auth?.authenticated) return renderLogin();
  const [name, id] = location.hash.replace(/^#/, '').split('/');
  const view = routes[name] || routes.dashboard;
  try { await refresh(); await view(id); } catch (e) { if (e.message !== 'Unauthorized') { toast(e.message, true); console.error(e); } }
}
window.addEventListener('hashchange', route);
async function boot() {
  S.auth = await api('/auth/status');
  if (!S.auth.authenticated) return renderLogin();
  if (!location.hash) location.hash = '#dashboard';
  await route();
  setInterval(() => { if (S.auth?.authenticated && !$('#modal-root').innerHTML) route(); }, 120000);
}
Object.assign(window, { __panel: { S, routes, route, api, modal, field, input, select, confirmDialog, toast, h, raw, esc, money, fmtDate, ago, daysWord, sevOf, scoreSev, siteName, cap, catColor, stackedBars, lineChart, hbars, sparkline, shell, I, CATEGORIES, CYCLES, STATUSES, SERIES, refresh, boot, formData } });
})();
