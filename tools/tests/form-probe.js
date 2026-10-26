// Site-wide form-control probe (Owner 2026-10-26 "form controls sweep").
// Opens every page at 390 and 1440, dark and day theme, signed in as a member (richstub) or an admin
// for *-admin pages, then flags per page:
//   native   : select/date/checkbox/radio/file controls with appearance != none, text inputs whose
//              computed background is near-white/grey on the dark theme (also hidden ones, from style)
//   rowmis   : visible inputs sharing a row (same form/grid parent, overlapping vertically) whose
//              heights or tops differ by > 3 px
//   details  : <details><summary> still drawing the browser triangle
//   whitebtn : <button> with a near-white/grey background on the dark theme and no .btn class
//   hscroll  : document wider than the viewport at 390
//   clip     : a form control whose text is wider than its box (value/placeholder cut)
// Writes JSON to OUT/probe-<tag>.json and a screenshot per flagged page/viewport.
//   OUT=<dir> TAG=before PAGES=a.html,b.html ROOT_DIR=<repo> node form-probe.js
const R = require('./bt-rig.js');
const fs = require('fs');
const path = require('path');

const DEFAULT_PAGES = ['index.html', 'features.html', 'features-charts.html', 'login.html', 'signup.html', 'dashboard-user.html',
  'settings.html', 'profile.html', 'trade-journal.html', 'backtests.html', 'replay.html', 'gex.html', 'scanner.html', 'courses.html',
  'chapter.html', 'learn.html', 'checkout.html', 'support.html', 'contact.html', 'referrals.html', 'giveaways.html', 'messages.html',
  'trading-floor.html', 'economic-calendar.html', 'market-brief.html', 'global-monitor.html', 'smart-money.html', 'live-sessions.html',
  'indicators.html', 'models.html', 'roadmap.html', 'achievements.html', 'leaderboard.html', 'paper-review.html',
  'dashboard-admin.html', 'settings-admin.html', 'students-admin.html', 'access-admin.html', 'appearance-admin.html', 'billing-admin.html',
  'bots-admin.html', 'chapters-admin.html', 'chapter-editor.html', 'commerce-admin.html', 'coupons-admin.html', 'giveaways-admin.html',
  'indicators-admin.html', 'indicator-editor.html', 'logs-admin.html', 'models-admin.html', 'model-editor.html', 'moderation-admin.html',
  'notes-admin.html', 'orders-admin.html', 'pages-admin.html', 'page-editor.html', 'referrals-admin.html', 'roadmap-admin.html',
  'seo-admin.html', 'sessions-admin.html', 'support-admin.html', 'x-admin.html', 'prop-firm-cheat-sheet.html', 'cheat-sheet.html'];

const ADMIN_INIT = () => {
  const wrap = () => {
    const db = window.__stubDb; if (!db || db.__adm) return; db.__adm = 1;
    const col = db.collection;
    db.collection = (p) => { const c = col(p); if (String(p).split('/').pop() !== 'admins') return c; const d0 = c.doc; c.doc = (id) => { const d = d0(id); d.get = () => Promise.resolve({ id, exists: true, data: () => ({ role: 'admin' }) }); return d; }; return c; };
  };
  wrap(); document.addEventListener('DOMContentLoaded', wrap);
};

const PROBE = () => {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  const lum = (c) => { const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?/.exec(c || ''); if (!m) return null; if (m[4] !== undefined && Number(m[4]) < 0.3) return null; return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255; };
  const sel = (el) => { let s = el.tagName.toLowerCase(); if (el.id) return s + '#' + el.id; if (el.name) s += '[name=' + el.name + ']'; if (el.type && el.tagName === 'INPUT') s += '[type=' + el.type + ']'; const c = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; if (c) s += '.' + c; const p = el.parentElement; const pc = p && (p.id ? '#' + p.id : (typeof p.className === 'string' && p.className ? '.' + p.className.trim().split(/\s+/)[0] : p.tagName.toLowerCase())); return pc + ' > ' + s; };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
  const out = { native: [], rowmis: [], details: [], whitebtn: [], clip: [] };
  const ctrls = Array.from(document.querySelectorAll('input, select, textarea')).filter((el) => !['hidden', 'submit', 'button', 'reset', 'image', 'range', 'color'].includes(el.type));
  ctrls.forEach((el) => {
    if (el.closest('[aria-hidden="true"] svg, canvas, #stkc-root canvas')) return;
    const cs = getComputedStyle(el); const t = el.tagName === 'SELECT' ? 'select' : (el.type || 'text');
    const v = vis(el); const reasons = [];
    const ap = cs.appearance || cs.webkitAppearance;
    const r0 = el.getBoundingClientRect(); const hiddenTrick = Number(cs.opacity) < 0.05 || (v && r0.width <= 2 && r0.height <= 2);
    if (!hiddenTrick) {
      if (t === 'select' && !el.multiple && !(el.size > 1)) { if (ap !== 'none') reasons.push('native select'); else if (cs.backgroundImage === 'none') reasons.push('select without arrow'); }
      if ((t === 'checkbox' || t === 'radio') && ap !== 'none') reasons.push('native ' + t);
      if (t === 'file') { const fb = getComputedStyle(el, '::file-selector-button'); const L = lum(fb.backgroundColor); if (dark && (L === null || L > 0.5)) reasons.push('native file button'); }
      if (/date|time|month|week/.test(t) && dark && cs.colorScheme.indexOf('dark') < 0) reasons.push('light picker (color-scheme ' + cs.colorScheme + ')');
    }
    if (reasons.length) out.native.push({ el: sel(el), t, visible: v, reasons });
    if (v && t === 'select' && el.selectedOptions && el.selectedOptions[0]) { const cv = window.__pcv || (window.__pcv = document.createElement("canvas")); const g = cv.getContext('2d'); g.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; const tw = g.measureText(el.selectedOptions[0].text).width; const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); if (tw > room + 2) out.clip.push({ el: sel(el), text: el.selectedOptions[0].text.slice(0, 30), tw: Math.round(tw), room: Math.round(room) }); }
    if (v && ['text', 'email', 'password', 'number', 'search', 'tel', 'url', 'select'].includes(t) && el.scrollWidth > el.clientWidth + 2 && t !== 'select' && !el.value && el.placeholder) out.clip.push({ el: sel(el), sw: el.scrollWidth, cw: el.clientWidth });
  });
  // rows: group visible text-like controls by their nearest grid/flex-row container
  const vctrls = ctrls.filter((el) => vis(el) && !['checkbox', 'radio', 'file'].includes(el.type) && el.tagName !== 'TEXTAREA');
  const groups = new Map();
  vctrls.forEach((el) => { let p = el.parentElement; for (let i = 0; i < 4 && p; i++) { const d = getComputedStyle(p).display; if (/grid/.test(d) || (/flex/.test(d) && !/column/.test(getComputedStyle(p).flexDirection))) break; p = p.parentElement; } if (!p) return; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(el); });
  groups.forEach((els, p) => {
    if (els.length < 2) return;
    const rows = []; els.forEach((el) => { const r = el.getBoundingClientRect(); const row = rows.find((rw) => Math.abs(rw.c - (r.top + r.height / 2)) < Math.max(r.height, rw.h) * 0.75); if (row) row.items.push({ el, r }); else rows.push({ c: r.top + r.height / 2, h: r.height, items: [{ el, r }] }); });
    rows.forEach((rw) => { if (rw.items.length < 2) return; const tops = rw.items.map((i) => i.r.top), hs = rw.items.map((i) => i.r.height); if (Math.max(...tops) - Math.min(...tops) > 3 || Math.max(...hs) - Math.min(...hs) > 3) out.rowmis.push({ group: sel(p), items: rw.items.map((i) => sel(i.el) + ' t' + Math.round(i.r.top) + ' h' + Math.round(i.r.height)) }); });
  });
  document.querySelectorAll('details > summary').forEach((s) => { const cs = getComputedStyle(s); if (cs.display === 'list-item' && cs.listStyleType !== 'none') { const m = getComputedStyle(s, '::marker'); if (m && m.content !== '""' && m.content !== 'none' && !/content:\s*""/.test(m.content)) out.details.push({ el: sel(s.parentElement), text: s.textContent.trim().slice(0, 40), visible: vis(s) }); } });
  if (dark) document.querySelectorAll('button, a[role=button]').forEach((b) => { if (!vis(b)) return; const cs = getComputedStyle(b); const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/.exec(cs.backgroundColor); const sat = m ? Math.max(m[1], m[2], m[3]) - Math.min(m[1], m[2], m[3]) : 99; const L = lum(cs.backgroundColor); if (L !== null && L > 0.6 && sat < 30 && !b.classList.contains('btn') && !b.closest('canvas')) out.whitebtn.push({ el: sel(b), text: b.textContent.trim().slice(0, 30), bg: cs.backgroundColor }); });
  out.hscroll = document.documentElement.scrollWidth > innerWidth + 1 ? document.documentElement.scrollWidth : 0;
  return out;
};

module.exports = { PROBE };
if (require.main === module) (async () => {
  const OUT = process.env.OUT || '/tmp'; const TAG = process.env.TAG || 'run'; fs.mkdirSync(OUT, { recursive: true });
  const pages = (process.env.PAGES ? process.env.PAGES.split(',') : DEFAULT_PAGES);
  const srv = await R.serve(process.env.ROOT_DIR); const b = await R.launch(); const res = {};
  const combos = (process.env.COMBOS || 'desktop:dark,phone:dark,desktop:day,phone:day').split(',');
  for (const combo of combos) {
    const [dev, theme] = combo.split(':');
    for (const isAdmin of [false, true]) {
      const list = pages.filter((p) => /-admin|-editor/.test(p) === isAdmin); if (!list.length) continue;
      const init = () => { try { localStorage.setItem('stryker_cookie_consent', '1'); localStorage.setItem('stryker_cookies', 'accepted'); } catch (e) {} };
      const themeInit = theme === 'day' ? () => { try { localStorage.setItem('stryker_theme', 'day'); } catch (e) {} } : () => { try { localStorage.setItem('stryker_theme', 'night'); } catch (e) {} };
      const { ctx, p } = await R.page(b, srv, dev, themeInit);
      await ctx.addInitScript(init); if (isAdmin) await ctx.addInitScript(ADMIN_INIT);
      for (const pg of list) {
        const key = pg + ' ' + dev + ' ' + theme;
        try {
          await p.goto(srv.base + '/' + pg, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await p.waitForTimeout(Number(process.env.WAIT || 2200));
          const r = await p.evaluate(PROBE);
          r.url = p.url().replace(srv.base, '');
          const n = r.native.length + r.rowmis.length + r.details.length + r.whitebtn.length + r.clip.length + (r.hscroll ? 1 : 0);
          r.count = n; res[key] = r;
          if (n && process.env.SHOTS !== '0') { const f = path.join(OUT, TAG + '-' + pg.replace('.html', '') + '-' + dev + '-' + theme + '.png'); await p.screenshot({ path: f }); r.shot = f; }
        } catch (e) { res[key] = { error: String(e).slice(0, 200) }; }
      }
      await ctx.close();
    }
  }
  fs.writeFileSync(path.join(OUT, 'probe-' + TAG + '.json'), JSON.stringify(res, null, 1));
  console.log('pages', Object.keys(res).length);
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
