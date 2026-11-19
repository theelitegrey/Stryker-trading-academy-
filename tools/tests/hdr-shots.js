// Header + /download shots and alignment measurements (Owner 19 Nov header/download brief).
// Usage: node tools/tests/hdr-shots.js <outdir> [base]  (needs a static server on the repo root)
const { launch } = require('./lib');
const stub = require('./stub.js');
const ANON = process.env.ANON === '1';
const fs = require('fs');
const OUT = process.argv[2] || 'shots';
const BASE = process.argv[3] || 'http://localhost:8817';
const PAGES = (process.env.PAGES || 'index,pricing,features/charts,about,download').split(',');
const WIDTHS = (process.env.WIDTHS || '1440,1024,390').split(',').map(Number);
const THEMES = (process.env.THEMES || 'dark,light').split(',');
const FULL = process.env.FULL === '1';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch();
  const report = [];
  let errors = 0;
  for (const theme of THEMES) for (const w of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_cookie_ok', '1'); } catch (e) {} }, theme);
    await ctx.addInitScript(stub);
    if (ANON) await ctx.addInitScript(() => { const t = setInterval(() => { if (window.__stubAuth) { window.__stubAuth.currentUser = null; window.__stubAuth.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; clearInterval(t); } }, 0); });
    // Firebase CDN is not needed for layout; stub it so the page renders offline.
    await ctx.route(/gstatic\.com|googleapis|firebase|google-analytics|googletagmanager/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    for (const pg of PAGES) {
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
      await p.goto(`${BASE}/${pg}.html`, { waitUntil: 'load' });
      await p.waitForTimeout(900);
      const name = `${pg.replace(/\//g, '-')}-${w}-${theme}`;
      const m = await p.evaluate(() => {
        const h = document.getElementById('site-nav'); if (!h) return { none: 1 };
        const cs = getComputedStyle(h), r = h.getBoundingClientRect();
        const sel = ['#theme', '.nav-theme-btn', '.dl-menu > summary', '.hn-cta .btn-primary', '.nav-cta .btn-primary', '.nav-cta .btn-ghost', '.hn-login', '.hn-tog', '.nav-toggle', '.hn-brand img', '.brand-mark', '.nav-login', '.hn-links > a', '.hn-prod > summary', '.nav-links > a'];
        const items = [];
        for (const s of sel) h.querySelectorAll(s).forEach((e) => { const b = e.getBoundingClientRect(); if (b.width && b.height && getComputedStyle(e).display !== 'none') items.push({ s, h: +b.height.toFixed(1), w: +b.width.toFixed(1), cy: +(b.top + b.height / 2).toFixed(1), x: +b.left.toFixed(1) }); });
        return { bg: cs.backgroundColor, border: cs.borderBottomColor + ' ' + cs.borderBottomWidth, pos: cs.position, h: r.height, cls: h.className, items, sx: document.documentElement.scrollWidth, vw: innerWidth };
      });
      await p.screenshot({ path: `${OUT}/${name}-top.png`, fullPage: FULL });
      await p.mouse.wheel(0, 600); await p.waitForTimeout(500);
      const m2 = await p.evaluate(() => { const h = document.getElementById('site-nav'); if (!h) return {}; const cs = getComputedStyle(h); return { bg: cs.backgroundColor, border: cs.borderBottomColor + ' ' + cs.borderBottomWidth, cls: h.className, top: h.getBoundingClientRect().top }; });
      if (!FULL) await p.screenshot({ path: `${OUT}/${name}-scrolled.png` });
      report.push({ name, top: m, scrolled: m2, errs });
      errors += errs.length;
      await p.close();
    }
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  for (const r of report) {
    const t = r.top; if (t.none) { console.log(r.name, 'no #site-nav'); continue; }
    const cys = t.items.map((i) => i.cy), hs = t.items.filter(i=>!/brand|img/.test(i.s)).map((i) => i.h);
    console.log(r.name, '| top bg', t.bg, '| border', t.border, '| scrolled bg', r.scrolled.bg, r.scrolled.border, '| sx', t.sx, '/', t.vw, '| cy span', (Math.max(...cys) - Math.min(...cys)).toFixed(1), '| heights', [...new Set(hs)].join(','), r.errs.length ? 'ERR ' + r.errs.join(' ; ') : '');
  }
  console.log('page errors:', errors);
})();
